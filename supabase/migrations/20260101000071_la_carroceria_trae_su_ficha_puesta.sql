-- =============================================================================
-- LA CARROCERÍA TRAE SU FICHA PUESTA
-- -----------------------------------------------------------------------------
-- «En la cotización de trabajo ya se tienen modelos de OT de casi la mayoría
-- de carrocerías: lo que quieren es que, si seleccionan una carrocería, ya
-- haya algo y solo se edite si varía.» Hoy la ficha preescrita existe
-- (plantillas_ficha, migración 024) pero hay que ir a buscarla con un botón,
-- y el que no sabe que está, la vuelve a escribir.
--
-- Tres cosas cambian:
--
--   1. Una plantilla puede ser la PREDETERMINADA de su carrocería. Cuando una
--      carrocería tiene varias —la tolva semirroquera de 15, 17 y 24 m³— la
--      cotización nace con la predeterminada y desde la ficha se cambia.
--   2. Al elegir la carrocería, la cotización recibe su ficha y sus accesorios
--      SOLA, siempre que todavía no tenga ficha escrita: lo escrito a mano no
--      se pisa nunca. Si la carrocería tiene una sola plantilla activa, esa; si
--      tiene varias, la predeterminada; si no tiene ninguna, nada.
--   3. Una función sembradora deja una plantilla exactamente igual a lo que se
--      le pasa, para que las que salen de las OT de la casa (migración 072) se
--      puedan volver a cargar sin duplicar.
-- =============================================================================

alter table public.plantillas_ficha
  add column if not exists predeterminada boolean not null default false,
  add column if not exists tipo_unidad public.tipo_unidad_carroceria,
  add column if not exists capacidad_habitual text,
  -- De qué OT de la casa salió. Es la trazabilidad de la plantilla: cuando
  -- alguien dude de un espesor, acá dice dónde mirar.
  add column if not exists fuentes text[] not null default '{}';

comment on column public.plantillas_ficha.predeterminada is
  'La que baja sola a la cotización cuando la carrocería tiene varias plantillas.';
comment on column public.plantillas_ficha.fuentes is
  'Las OT de la casa de las que se transcribió: «OT 2902», «OT 2904»…';

-- Una sola predeterminada por carrocería.
create unique index if not exists uq_plantilla_predeterminada
  on public.plantillas_ficha (tipo_carroceria_id)
  where predeterminada and activa;

-- =============================================================================
-- LA SEMBRADORA
-- -----------------------------------------------------------------------------
-- Reemplaza la plantilla entera: quien la vuelve a correr deja lo mismo.
-- Las líneas llegan como arreglo JSON en el orden en que la empresa las
-- escribe: [{"seccion":"SOLDADURA","etiqueta":null,"detalle":"..."}, …]; la
-- función numera sección y línea por ese orden. Los accesorios igual:
-- [{"cantidad":1,"unidad":"unid","descripcion":"…","incluye":false}, …].
-- =============================================================================
create or replace function public.sembrar_plantilla_ficha(
  p_tipo_codigo     text,
  p_nombre          text,
  p_descripcion     text,
  p_lineas          jsonb,
  p_accesorios      jsonb,
  p_tipo_unidad     text default null,
  p_capacidad       text default null,
  p_fuentes         text[] default '{}',
  p_predeterminada  boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo      uuid;
  v_plantilla uuid;
  v_seccion   text := '';
  v_n_seccion int  := 0;
  v_n_linea   int  := 0;
  l           jsonb;
  a           jsonb;
  v_orden_acc int  := 0;
begin
  select id into v_tipo from public.tipos_carroceria where codigo = p_tipo_codigo;
  if v_tipo is null then
    raise exception 'No existe la carrocería % en el catálogo', p_tipo_codigo;
  end if;

  insert into public.plantillas_ficha
    (tipo_carroceria_id, nombre, descripcion, activa, tipo_unidad, capacidad_habitual, fuentes, predeterminada)
  values
    (v_tipo, p_nombre, p_descripcion, true, p_tipo_unidad::public.tipo_unidad_carroceria, p_capacidad, p_fuentes, false)
  on conflict (tipo_carroceria_id, nombre) do update
    set descripcion        = excluded.descripcion,
        activa             = true,
        tipo_unidad        = excluded.tipo_unidad,
        capacidad_habitual = excluded.capacidad_habitual,
        fuentes            = excluded.fuentes
  returning id into v_plantilla;

  -- La predeterminada se asigna después de tener el id, para que el índice
  -- parcial no choque con la que lo era hasta ahora.
  if p_predeterminada then
    update public.plantillas_ficha set predeterminada = false
     where tipo_carroceria_id = v_tipo and id <> v_plantilla and predeterminada;
    update public.plantillas_ficha set predeterminada = true where id = v_plantilla;
  end if;

  delete from public.plantilla_ficha_lineas     where plantilla_id = v_plantilla;
  delete from public.plantilla_ficha_accesorios where plantilla_id = v_plantilla;

  for l in select * from jsonb_array_elements(coalesce(p_lineas, '[]'::jsonb)) loop
    if coalesce(l->>'seccion', '') <> v_seccion then
      v_seccion   := coalesce(l->>'seccion', '');
      v_n_seccion := v_n_seccion + 1;
      v_n_linea   := 0;
    end if;
    v_n_linea := v_n_linea + 1;

    insert into public.plantilla_ficha_lineas
      (plantilla_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
    values
      (v_plantilla, v_seccion, v_n_seccion, v_n_linea,
       nullif(btrim(coalesce(l->>'etiqueta', '')), ''),
       btrim(l->>'detalle'));
  end loop;

  for a in select * from jsonb_array_elements(coalesce(p_accesorios, '[]'::jsonb)) loop
    v_orden_acc := v_orden_acc + 1;
    insert into public.plantilla_ficha_accesorios
      (plantilla_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    values
      (v_plantilla, v_orden_acc,
       greatest(coalesce((a->>'cantidad')::numeric, 1), 0.01),
       coalesce(nullif(btrim(a->>'unidad'), ''), 'unid'),
       btrim(a->>'descripcion'),
       coalesce((a->>'incluye')::boolean, true));
  end loop;

  return v_plantilla;
end;
$$;

comment on function public.sembrar_plantilla_ficha is
  'Deja una plantilla de ficha técnica igual a lo que se le pasa: líneas en orden, accesorios y de qué OT salió.';

revoke all on function public.sembrar_plantilla_ficha(text, text, text, jsonb, jsonb, text, text, text[], boolean)
  from public, anon, authenticated;

-- =============================================================================
-- LA FICHA BAJA SOLA AL ELEGIR LA CARROCERÍA
-- -----------------------------------------------------------------------------
-- Después de escribir la cotización —no antes— porque las líneas apuntan a su
-- id. Solo cuando la carrocería es nueva o cambió, y solo si la cotización no
-- tiene ficha: lo que alguien escribió a mano no se pisa. Cambiar de plantilla
-- a propósito sigue siendo el botón de la ficha, que sí reemplaza.
-- =============================================================================
create or replace function public.plantilla_de_la_carroceria(p_tipo uuid)
returns uuid
language sql
stable
set search_path to 'public'
as $$
  select id
    from public.plantillas_ficha
   where tipo_carroceria_id = p_tipo and activa
   order by predeterminada desc, nombre
   limit 1
$$;

comment on function public.plantilla_de_la_carroceria is
  'La plantilla que baja sola: la predeterminada, o la única activa. Con varias y ninguna predeterminada, la primera por nombre.';

create or replace function public.fn_cotizacion_traer_ficha_del_tipo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_plantilla uuid;
begin
  if new.tipo_carroceria_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.tipo_carroceria_id is not distinct from old.tipo_carroceria_id then
    return null;
  end if;
  if exists (select 1 from public.cotizacion_especificaciones where cotizacion_id = new.id) then
    return null;
  end if;

  v_plantilla := public.plantilla_de_la_carroceria(new.tipo_carroceria_id);
  if v_plantilla is null then
    return null;
  end if;

  insert into public.cotizacion_especificaciones
    (cotizacion_id, seccion, orden_seccion, orden_linea, etiqueta, detalle)
  select new.id, l.seccion, l.orden_seccion, l.orden_linea, l.etiqueta, l.detalle
    from public.plantilla_ficha_lineas l
   where l.plantilla_id = v_plantilla;

  -- Los accesorios solo si tampoco había: son la otra mitad de la misma ficha.
  if not exists (select 1 from public.cotizacion_accesorios where cotizacion_id = new.id) then
    insert into public.cotizacion_accesorios
      (cotizacion_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select new.id, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.plantilla_ficha_accesorios a
     where a.plantilla_id = v_plantilla;
  end if;

  return null;
end;
$$;

comment on function public.fn_cotizacion_traer_ficha_del_tipo is
  'Al elegir la carrocería, la cotización recibe la ficha y los accesorios de su plantilla si todavía no tiene ficha.';

drop trigger if exists trg_cotizacion_traer_ficha_del_tipo on public.cotizaciones;
create trigger trg_cotizacion_traer_ficha_del_tipo
  after insert or update of tipo_carroceria_id on public.cotizaciones
  for each row execute function public.fn_cotizacion_traer_ficha_del_tipo();

revoke all on function public.fn_cotizacion_traer_ficha_del_tipo() from public, anon, authenticated;

-- =============================================================================
-- LAS DOS PLANTILLAS QUE YA HABÍA, SOBRE LAS CARROCERÍAS VIVAS
-- -----------------------------------------------------------------------------
-- La migración 046 trajo los treinta tipos de la casa con su código de tres
-- letras y dejó dados de baja los genéricos (PLATAFORMA, CAMA_BAJA…). Las dos
-- fichas de la 024 seguían colgadas de esos: la de la plataforma, de un tipo
-- inactivo que ya no se puede elegir. Se mueven a los códigos vivos.
-- =============================================================================
update public.plantillas_ficha p
   set tipo_carroceria_id = v.id
  from public.tipos_carroceria v, public.tipos_carroceria t
 where p.tipo_carroceria_id = t.id
   and t.codigo = 'PLATAFORMA' and v.codigo = 'PLA'
   and not exists (select 1 from public.plantillas_ficha q where q.tipo_carroceria_id = v.id and q.nombre = p.nombre);

-- Las listas de verificación igual: la del tipo genérico pasa a valer para el
-- vivo si el vivo no tiene la suya.
insert into public.plantillas_verificacion (tipo_carroceria_id, numero, descripcion)
select v.id, pv.numero, pv.descripcion
  from public.plantillas_verificacion pv
  join public.tipos_carroceria t on t.id = pv.tipo_carroceria_id
  join (values ('PLATAFORMA', 'PLA'), ('CAMA_BAJA', 'CB'), ('PORTACONTENEDOR', 'PC'),
               ('CISTERNA', 'CIA'), ('CISTERNA', 'COM'), ('FURGON_FRIGORIFICO', 'FRG'),
               ('FURGON', 'FUA'), ('FURGON', 'FUL'), ('BARANDA', 'BAR'),
               ('TOLVA_VOLQUETE', 'VPP'), ('TOLVA_VOLQUETE', 'VSC'), ('TOLVA_VOLQUETE', 'VPC')) as m(viejo, nuevo)
    on m.viejo = t.codigo
  join public.tipos_carroceria v on v.codigo = m.nuevo
 where not exists (select 1 from public.plantillas_verificacion x where x.tipo_carroceria_id = v.id)
on conflict do nothing;
