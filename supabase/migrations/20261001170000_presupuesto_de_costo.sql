-- =============================================================================
-- EL PRESUPUESTO DE COSTO DE CADA CARROCERÍA Y SU SEMÁFORO
-- -----------------------------------------------------------------------------
-- El costo de una OT ya se ve en vivo y en soles, y el margen contra el precio.
-- Falta la pregunta de Gerencia mientras la unidad se fabrica: «¿vamos dentro
-- de lo que se puede gastar?». Hasta hoy la respuesta llegaba con el costeo,
-- que la casa hace cuando la unidad ya culminó (docs/ANALISIS-ONEDRIVE.md,
-- § 12): tarde para corregir nada.
--
-- El tope sale de la regla con que la casa arma el precio en su hoja RESUMEN:
-- precio de venta sin IGV = egresos + 15 % de utilidad. Leída al revés, lo que
-- se puede gastar en la unidad es el precio sin IGV ÷ 1.15. Así toda OT con
-- cotización (y su IGV confirmado) tiene presupuesto sin que nadie lo cargue.
--
-- Gerencia o Administración lo fijan a mano cuando la regla no vale: una
-- unidad que se vendió con menos utilidad, un adicional aprobado, una OT del
-- taller o una garantía sin cotización. Siempre con motivo; la auditoría
-- guarda el anterior. Volver al de la cotización deja la fila con el monto
-- vacío y su motivo: no se borra nada.
--
-- El semáforo no compara el gasto con el avance: el material se compra al
-- empezar y con 30 % de avance ya puede estar gastada la mitad; un semáforo
-- así pondría en rojo toda unidad que arranca. Compara el gasto con el tope:
--   · EXCEDIDO  el costo pasó el presupuesto;
--   · AJUSTADO  ya se gastó el 90 % o más y la unidad no llega al 90 % de avance;
--   · EN_RANGO  lo demás.
-- El avance va al lado, para que quien mira lo juzgue.
--
-- Lo ven quienes ven el margen (`costos.ver` y el precio): con el presupuesto
-- y la regla del 15 % se deduce el precio, que Costos y Materiales no ve.
--
-- De paso, `margen_ot` usa el costo cerrado cuando la OT lo tiene: así lo
-- decía 20261001152000_cierre_de_costo y no lo hacía. Lo que llegue después
-- del cierre se ve como diferencia contra él, sin mover el margen.
--
-- `fijado_por` no lleva índice: la aplicación no filtra por esa columna y una
-- cuenta no se borra en ningún flujo (ver la skill `datos`).
-- =============================================================================

create table if not exists public.ot_presupuestos (
  id             uuid primary key default gen_random_uuid(),
  orden_id       uuid not null unique references public.ordenes_trabajo(id) on delete restrict,
  monto_pen      numeric(14,2) check (monto_pen is null or monto_pen > 0),
  motivo         text not null check (length(btrim(motivo)) between 5 and 500),
  fijado_por     uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  fijado_en      timestamptz not null default now(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.ot_presupuestos is
  'Presupuesto de costo fijado a mano para una OT. Sin fila, o con el monto vacío, vale el de la cotización: precio sin IGV ÷ 1.15.';
comment on column public.ot_presupuestos.monto_pen is
  'Lo que se puede gastar en la unidad, en soles. Vacío: vuelve al presupuesto que sale de la cotización.';

alter table public.ot_presupuestos enable row level security;
revoke all on public.ot_presupuestos from public, anon, authenticated;
grant select on public.ot_presupuestos to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ot_presupuestos' and policyname = 'ot_presupuestos_lectura') then
    create policy ot_presupuestos_lectura on public.ot_presupuestos for select to authenticated
      using ((public.es_admin()
              or (public.tiene_permiso('costos.ver') and public.tiene_permiso('cotizaciones.ver_pdf_comercial')))
             and public.puede_ver_orden(orden_id));
  end if;
end $$;

select public.activar_timestamps('ot_presupuestos');
select public.activar_auditoria('ot_presupuestos');
select public.activar_registro_de_prueba('ot_presupuestos');

-- Gerencia (`cotizaciones.revisar`) o Administración (`ordenes.editar`), y
-- además ver el costo y el precio: es la cifra contra la que se los mide.
create or replace function public.fijar_presupuesto_ot(p_orden uuid, p_monto numeric, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estado text;
  v_numero text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not (public.es_admin()
          or ((public.tiene_permiso('cotizaciones.revisar') or public.tiene_permiso('ordenes.editar'))
              and public.tiene_permiso('costos.ver')
              and public.tiene_permiso('cotizaciones.ver_pdf_comercial'))) then
    raise exception 'El presupuesto de una OT lo fijan Gerencia o Administración.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;

  select o.estado::text, o.numero into v_estado, v_numero
    from public.ordenes_trabajo o where o.id = p_orden for update;
  if not found then
    raise exception 'La OT no existe.';
  end if;
  if v_estado = 'ANULADA' then
    raise exception 'La OT % está anulada: ya no lleva presupuesto.', v_numero;
  end if;
  if p_monto is not null and p_monto <= 0 then
    raise exception 'El presupuesto tiene que ser mayor que cero.';
  end if;
  if p_monto is null and v_motivo = '' then
    v_motivo := 'Vuelve al presupuesto de la cotización';
  end if;
  if length(v_motivo) < 5 then
    raise exception 'Escribe por qué la OT % lleva este presupuesto.', v_numero;
  end if;
  if length(v_motivo) > 500 then
    raise exception 'El motivo del presupuesto no puede pasar de 500 letras.';
  end if;

  insert into public.ot_presupuestos (orden_id, monto_pen, motivo, fijado_por, fijado_en)
  values (p_orden, round(p_monto, 2), v_motivo, public.usuario_actual(), now())
  on conflict (orden_id) do update
    set monto_pen = excluded.monto_pen,
        motivo = excluded.motivo,
        fijado_por = excluded.fijado_por,
        fijado_en = excluded.fijado_en;
end;
$$;

revoke all on function public.fijar_presupuesto_ot(uuid, numeric, text) from public, anon;
grant execute on function public.fijar_presupuesto_ot(uuid, numeric, text) to authenticated;

-- El margen con el costo cerrado cuando lo hay. Misma firma: solo cambia de
-- dónde sale el costo.
create or replace function public.margen_ot(p_orden uuid)
returns table (
  moneda_venta         text,
  precio_venta         numeric,
  incluye_igv          boolean,
  precio_neto          numeric,
  cambio_venta         numeric,
  precio_neto_pen      numeric,
  costo_pen            numeric,
  margen_pen           numeric,
  margen_pct           numeric,
  despachos_sin_precio integer,
  lineas_sin_cambio    integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- La tasa del IGV en el Perú desde 2011.
  c_igv constant numeric := 0.18;
  v_moneda text;
  v_precio numeric;
  v_igv boolean;
  v_fecha date;
  v_neto numeric;
  v_cambio numeric;
  v_neto_pen numeric;
  v_costo numeric;
  v_cerrado numeric;
  v_sin_precio integer;
  v_sin_cambio integer;
begin
  perform public.exigir_permiso('costos.ver');
  if not (public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')) then
    raise exception 'El margen se calcula con el precio de venta, que tu puesto no ve.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;

  select c.moneda::text, c.monto_venta,
         case when i.version = c.version then i.incluye_igv end,
         o.fecha_registro::date
    into v_moneda, v_precio, v_igv, v_fecha
    from public.ordenes_trabajo o
    left join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id and c.estado <> 'ANULADA'
    left join public.cotizaciones_pdf_igv i on i.cotizacion_id = c.id
   where o.id = p_orden;

  select coalesce(sum(s.monto_pen), 0),
         count(*) filter (where s.fuente = 'MATERIALES_SIN_PRECIO'),
         count(*) filter (where s.moneda = 'USD' and s.monto_pen is null)
    into v_costo, v_sin_precio, v_sin_cambio
    from public.costeo_ot_en_soles(p_orden) s;

  -- Con el costo cerrado, el margen es el de ese costo.
  select c.costo_pen into v_cerrado from public.ot_cierres_costo c where c.orden_id = p_orden;
  if found then
    v_costo := v_cerrado;
    v_sin_precio := 0;
    v_sin_cambio := 0;
  end if;

  v_neto := case when v_igv then round(v_precio / (1 + c_igv), 2)
                 when v_igv = false then v_precio end;
  -- Un precio en dólares se pasa con el cambio de COMPRA del día en que se
  -- registró la OT: es cuando la venta quedó comprometida.
  v_cambio := case when v_moneda = 'USD' then public.cambio_del_dia(v_fecha, 'COMPRA') end;
  v_neto_pen := case when v_moneda = 'PEN' then v_neto
                     when v_moneda = 'USD' then round(v_neto * v_cambio, 2) end;

  return query select
    v_moneda, v_precio, v_igv, v_neto, v_cambio, v_neto_pen, v_costo,
    case when v_neto_pen is not null then v_neto_pen - v_costo end,
    case when v_neto_pen > 0 then round((v_neto_pen - v_costo) / v_neto_pen * 100, 1) end,
    v_sin_precio, v_sin_cambio;
end;
$$;

revoke all on function public.margen_ot(uuid) from public, anon;
grant execute on function public.margen_ot(uuid) to authenticated;

-- El presupuesto de una OT, lo gastado contra él y su semáforo. Una fila
-- siempre; sin presupuesto, el monto y el semáforo salen vacíos. Las llaves
-- son las del margen: las pide `margen_ot`, que corre con la identidad de
-- quien llama.
create or replace function public.presupuesto_ot(p_orden uuid)
returns table (
  presupuesto_pen  numeric,
  origen           text,
  motivo           text,
  fijado_en        timestamptz,
  fijado_por       text,
  utilidad_pct     numeric,
  precio_neto_pen  numeric,
  costo_pen        numeric,
  consumido_pct    numeric,
  avance_pct       numeric,
  margen_pct       numeric,
  semaforo         text,
  costo_incompleto boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- La utilidad estándar de la hoja RESUMEN de la casa.
  c_utilidad constant numeric := 0.15;
  m record;
  v_manual numeric;
  v_motivo text;
  v_en timestamptz;
  v_por text;
  v_avance numeric;
  v_presupuesto numeric;
  v_origen text;
begin
  select * into m from public.margen_ot(p_orden);

  select p.monto_pen, p.motivo, p.fijado_en,
         coalesce(nullif(btrim(u.cargo), ''), btrim(concat_ws(' ', u.nombres, u.apellidos)))
    into v_manual, v_motivo, v_en, v_por
    from public.ot_presupuestos p
    left join public.usuarios u on u.id = p.fijado_por
   where p.orden_id = p_orden;

  select o.avance_porcentaje into v_avance from public.ordenes_trabajo o where o.id = p_orden;

  if v_manual is not null then
    v_presupuesto := v_manual;
    v_origen := 'MANUAL';
  elsif m.precio_neto_pen is not null then
    v_presupuesto := round(m.precio_neto_pen / (1 + c_utilidad), 2);
    v_origen := 'COTIZACION';
  end if;

  return query select
    v_presupuesto, v_origen, v_motivo, v_en, v_por, c_utilidad * 100,
    m.precio_neto_pen, m.costo_pen,
    case when v_presupuesto > 0 then round(m.costo_pen / v_presupuesto * 100, 1) end,
    coalesce(v_avance, 0),
    m.margen_pct,
    case when v_presupuesto is null then null
         when m.costo_pen > v_presupuesto then 'EXCEDIDO'
         when m.costo_pen >= v_presupuesto * 0.9 and coalesce(v_avance, 0) < 90 then 'AJUSTADO'
         else 'EN_RANGO' end,
    (m.despachos_sin_precio > 0 or m.lineas_sin_cambio > 0);
end;
$$;

revoke all on function public.presupuesto_ot(uuid) from public, anon;
grant execute on function public.presupuesto_ot(uuid) to authenticated;
