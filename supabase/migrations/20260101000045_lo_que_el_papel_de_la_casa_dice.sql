-- =============================================================================
-- LO QUE EL PAPEL DE LA CASA DICE, Y TRES PUERTAS QUE SEGUÍAN MAL CERRADAS
-- -----------------------------------------------------------------------------
-- Del barrido de los documentos reales de la empresa salieron tres cosas que la
-- base tenía que resolver antes que la pantalla, y una cuarta que se descubrió
-- comprobando: el circuito de tres manos termina en «abrir la orden», y ese paso
-- solo funcionaba entrando como administrador.
-- =============================================================================

-- ------------------------------- 1. abrir la orden, sin ser el administrador
-- `generar_presupuesto_desde_cotizacion` arrastra las partidas al presupuesto de
-- la OT, y la tabla de presupuesto exige `costos.editar`. Ese permiso lo tiene
-- Costos y nadie más: ni el jefe de taller ni Administración, que son quienes
-- abren órdenes. Resultado: la orden se creaba, el presupuesto no bajaba, y la
-- pantalla respondía «La orden se creó, pero no se pudo arrastrar el
-- presupuesto». Esa OT queda sin costo esperado y su desviación se mide contra
-- el precio de venta con IGV en vez de contra el costo.
--
-- La función pasa a correr con permisos propios y a exigir adentro el permiso
-- que de verdad corresponde: el de abrir órdenes. Se le revoca a todo el mundo
-- salvo a quien entra por la aplicación, como manda la convención del proyecto.
alter function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean)
  security definer;
alter function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean)
  set search_path to 'public';

revoke all on function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean)
  from public, anon;
grant execute on function public.generar_presupuesto_desde_cotizacion(uuid, numeric, boolean)
  to authenticated;

-- ------------------------- 2. una cotización, tantas órdenes como unidades
-- La cotización no amarraba cuántas órdenes podía abrir: la misma se podía
-- convertir dos veces y quedaban dos OT cobrando el mismo papel.
--
-- Pero prohibir la segunda sin más sería falso, y lo dicen sus propios archivos:
-- se emite una orden por unidad física. La cotización 3571-2026 de las
-- ambulancias abrió diez, de la 2882 a la 2891. Lo que manda es la cantidad
-- cotizada —el mismo número que se imprime en el papel— y por eso el candado
-- cuenta unidades en vez de prohibir.
create or replace function public.fn_ot_una_por_unidad_cotizada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_permitidas numeric;
  v_abiertas   int;
  v_numero     text;
begin
  if new.cotizacion_id is null then
    return new;
  end if;

  select greatest(coalesce(c.concepto_cantidad, 1), 1), c.numero
    into v_permitidas, v_numero
    from public.cotizaciones c
   where c.id = new.cotizacion_id;

  select count(*) into v_abiertas
    from public.ordenes_trabajo o
   where o.cotizacion_id = new.cotizacion_id
     and o.estado <> 'ANULADA'
     and o.id <> new.id;

  if v_abiertas >= v_permitidas then
    raise exception
      'La cotización % es por % unidad(es) y ya tiene % orden(es) abierta(s). Si son más unidades, corrige la cantidad en la cotización.',
      v_numero, v_permitidas, v_abiertas
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_ot_una_por_unidad_cotizada() from public, anon, authenticated;

drop trigger if exists trg_ot_una_por_unidad_cotizada on public.ordenes_trabajo;
create trigger trg_ot_una_por_unidad_cotizada
  before insert on public.ordenes_trabajo
  for each row execute function public.fn_ot_una_por_unidad_cotizada();

comment on function public.fn_ot_una_por_unidad_cotizada is
  'Una cotización abre tantas órdenes como unidades cotizó, ni una más. Las anuladas no cuentan.';

-- --------------------------------- 3. lo que el papel de la casa sí escribe
-- Cuatro datos que están en todas sus cotizaciones y que el sistema no tenía
-- dónde guardar, así que se escribían a mano en «observaciones» o se perdían.
alter table public.cotizaciones
  add column if not exists plazo_desde      text,
  add column if not exists garantia_texto   text,
  add column if not exists peso_tolerancia  text,
  add column if not exists no_incluye       text;

comment on column public.cotizaciones.plazo_desde is
  'Desde cuándo cuenta el plazo de entrega: «después de emitida la orden de compra», «a partir del abono en cuenta». Sin esto la fecha comprometida es una adivinanza.';
comment on column public.cotizaciones.garantia_texto is
  'La garantía como la escribe la casa, que se parte por sistema: «01 año contra fallas de fabricación / 6 meses en sistema hidráulico». Un número de meses no alcanza.';
comment on column public.cotizaciones.peso_tolerancia is
  'La tolerancia del peso, que la empresa siempre escribe: «+/- 5%», «+/- 3%». Sin ella el peso impreso se lee como exacto.';
comment on column public.cotizaciones.no_incluye is
  'Las advertencias en negativo: «NO INCLUYE AROS NI LLANTAS», «NO INCLUYE TOMA FUERZA». No son accesorios y no caben en la lista de lo que sí se entrega.';

-- ------------------------------------- 4. las notas de cierre, como catálogo
-- La nota final de sus cotizaciones habla siempre de lo mismo: certificados,
-- expediente para registros públicos, tarjeta de propiedad, placas, plaqueta de
-- fabricante. Media docena de textos que se repiten y que hoy alguien vuelve a
-- teclear en cada cotización, con lo que cada una dice una cosa distinta.
create table if not exists public.notas_cotizacion (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  texto          text not null,
  orden          int  not null default 0,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.notas_cotizacion is
  'Los textos de cierre que la empresa repite en sus cotizaciones. Se eligen de acá en vez de volver a escribirlos.';

insert into public.notas_cotizacion (codigo, texto, orden) values
  ('CERT_MONTAJE',   'Se entrega certificado de montaje de la unidad.', 1),
  ('CERT_FABRICA',   'Se entrega certificado de fabricación y garantía.', 2),
  ('CERT_PRESION',   'Se entrega certificado de prueba de presión.', 3),
  ('EXPEDIENTE',     'Se entrega el expediente para registros públicos.', 4),
  ('TARJETA',        'Incluye el trámite de la tarjeta de propiedad.', 5),
  ('PLACAS',         'Incluye el trámite de placas de rodaje.', 6),
  ('PLAQUETA',       'Se coloca la plaqueta de fabricante.', 7),
  ('BONIFICACION',   'Se entregan los certificados de bonificación.', 8)
on conflict (codigo) do nothing;

alter table public.notas_cotizacion enable row level security;

-- Es vocabulario de la casa: lo lee cualquiera que cotice, y lo mantiene quien
-- administra la configuración.
drop policy if exists ver_notas_cotizacion    on public.notas_cotizacion;
drop policy if exists crear_notas_cotizacion  on public.notas_cotizacion;
drop policy if exists editar_notas_cotizacion on public.notas_cotizacion;
drop policy if exists borrar_notas_cotizacion on public.notas_cotizacion;

create policy ver_notas_cotizacion on public.notas_cotizacion
  for select to authenticated using (true);

create policy crear_notas_cotizacion on public.notas_cotizacion
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

create policy editar_notas_cotizacion on public.notas_cotizacion
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('configuracion.editar'))
  with check (public.es_admin() or public.tiene_permiso('configuracion.editar'));

create policy borrar_notas_cotizacion on public.notas_cotizacion
  for delete to authenticated
  using (public.es_admin() or public.tiene_permiso('configuracion.editar'));

grant select, insert, update, delete on public.notas_cotizacion to authenticated;

select public.activar_timestamps('notas_cotizacion');
