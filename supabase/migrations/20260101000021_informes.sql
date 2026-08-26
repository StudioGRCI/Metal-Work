-- =============================================================================
-- INFORMES DE GESTIÓN
-- -----------------------------------------------------------------------------
-- Hasta acá cada pantalla contestaba una pregunta del día: qué se hizo hoy, qué
-- falta, cuánto va costando esta unidad. Los informes contestan la otra
-- pregunta, la del mes: si el taller gana o pierde plata, si entrega cuando
-- promete, en qué se va el acero y quién sostiene la producción.
--
-- Cada informe es una función con rango de fechas. Van como definidoras porque
-- cruzan datos de varias áreas, y cada una exige por su cuenta el permiso que
-- corresponde: el de reportes para las de taller, y además el de costos para
-- las que muestran plata.
-- =============================================================================

-- ---------------------------------------------------------------- producción
-- Quién sostuvo la producción en el período: horas puestas, en cuántas unidades
-- y cuánto costó esa mano de obra. Solo cuenta lo aprobado, igual que el costeo.
create or replace function public.informe_produccion(
  p_desde date,
  p_hasta date
)
returns table (
  usuario_id      uuid,
  operario        text,
  especialidad    text,
  dias_trabajados int,
  ordenes         int,
  horas_normales  numeric,
  horas_extra     numeric,
  horas_totales   numeric,
  costo           numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('reportes.ver');

  return query
  select d.usuario_id,
         (u.nombres || ' ' || u.apellidos)::text,
         d.especialidad::text,
         count(distinct d.fecha)::int,
         count(distinct d.orden_id)::int,
         round(sum(d.horas), 2),
         round(sum(d.horas_extra), 2),
         round(sum(d.horas_totales), 2),
         round(sum(d.costo_hora_hombre), 2)
    from public.v_ot_mano_obra_detalle d
    join public.usuarios u on u.id = d.usuario_id
   where d.fecha between p_desde and p_hasta
   group by d.usuario_id, u.nombres, u.apellidos, d.especialidad
   order by sum(d.horas_totales) desc;
end;
$$;

comment on function public.informe_produccion(date, date) is
  'Horas de taller del período por persona y especialidad, con su costo. Solo cuenta partes aprobados.';

-- -------------------------------------------------------------- cumplimiento
-- Si el taller entrega cuando promete. Es el informe que se lleva a la reunión
-- con el cliente, y el que dice si los plazos que se ofrecen son realistas.
create or replace function public.informe_cumplimiento(
  p_desde date,
  p_hasta date
)
returns table (
  orden_id       uuid,
  numero         text,
  cliente        text,
  placa          text,
  tipo_trabajo   text,
  comprometida   date,
  entregada      date,
  dias_atraso    int,
  a_tiempo       boolean,
  dias_en_taller int
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('reportes.ver');

  return query
  select o.id,
         o.numero::text,
         c.razon_social::text,
         u.placa::text,
         o.tipo_trabajo::text,
         o.fecha_entrega_comprometida,
         e.fecha_entrega,
         greatest(coalesce(e.fecha_entrega - o.fecha_entrega_comprometida, 0), 0)::int,
         (o.fecha_entrega_comprometida is null
          or e.fecha_entrega <= o.fecha_entrega_comprometida),
         greatest(
           e.fecha_entrega
           - least(coalesce(o.fecha_inicio_real::date, o.fecha_registro::date),
                   o.fecha_registro::date),
           0)::int
    from public.ot_entregas e
    join public.ordenes_trabajo o on o.id = e.orden_id
    join public.clientes c        on c.id = o.cliente_id
    left join public.unidades u   on u.id = o.unidad_id
   where e.fecha_entrega between p_desde and p_hasta
   order by e.fecha_entrega desc;
end;
$$;

comment on function public.informe_cumplimiento(date, date) is
  'Unidades entregadas en el período y si salieron dentro del plazo prometido.';

-- ------------------------------------------------------------- rentabilidad
-- Lo que deja cada unidad. Lleva permiso de costos además del de reportes: la
-- jefatura de taller ve el avance, no el margen.
create or replace function public.informe_rentabilidad(
  p_desde date,
  p_hasta date
)
returns table (
  orden_id         uuid,
  numero           text,
  cliente          text,
  tipo_trabajo     text,
  estado           text,
  moneda           text,
  presupuesto      numeric,
  costo_total      numeric,
  costo_materiales numeric,
  costo_mano_obra  numeric,
  costo_servicios  numeric,
  valor_venta      numeric,
  utilidad         numeric,
  margen_porcentaje numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('reportes.ver');
  perform public.exigir_permiso('costos.ver');

  return query
  select m.orden_id,
         m.numero::text,
         m.cliente::text,
         m.tipo_trabajo::text,
         m.estado::text,
         m.moneda::text,
         round(m.presupuesto, 2),
         round(m.costo_total, 2),
         round(m.costo_materiales, 2),
         round(m.costo_mano_obra, 2),
         round(m.costo_servicios, 2),
         round(m.valor_venta, 2),
         round(m.utilidad, 2),
         round(m.margen_porcentaje, 2)
    from public.v_ot_margen m
   where coalesce(m.fecha_fin_real::date, m.fecha_registro::date) between p_desde and p_hasta
   order by m.utilidad;
end;
$$;

comment on function public.informe_rentabilidad(date, date) is
  'Costo, venta y margen de cada unidad del período, de la que menos deja a la que más.';

-- ---------------------------------------------------------------- comercial
-- Cuánto se cotizó, cuánto se cerró y con qué velocidad. Es lo que dice si el
-- problema del taller es que no llegan trabajos o que no se cierran.
create or replace function public.informe_comercial(
  p_desde date,
  p_hasta date
)
returns table (
  vendedor_id       uuid,
  vendedor          text,
  cotizaciones      int,
  monto_cotizado    numeric,
  aprobadas         int,
  monto_aprobado    numeric,
  rechazadas        int,
  pendientes        int,
  tasa_cierre       numeric,
  dias_a_decision   numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('reportes.ver');
  perform public.exigir_permiso('cotizaciones.ver');

  return query
  select q.vendedor_id,
         coalesce(v.nombres || ' ' || v.apellidos, 'Sin vendedor asignado')::text,
         count(*)::int,
         round(sum(q.total), 2),
         count(*) filter (where q.estado = 'APROBADA')::int,
         round(coalesce(sum(q.total) filter (where q.estado = 'APROBADA'), 0), 2),
         count(*) filter (where q.estado = 'RECHAZADA')::int,
         count(*) filter (where q.estado in ('BORRADOR', 'ENVIADA'))::int,
         round(
           100.0 * count(*) filter (where q.estado = 'APROBADA')
           / nullif(count(*) filter (where q.estado in ('APROBADA', 'RECHAZADA')), 0), 1),
         -- Desde que se emitió la cotización hasta que el cliente decidió. Se
         -- cuenta contra la fecha del documento, no contra cuándo se cargó al
         -- sistema, que puede ser mucho después.
         round(avg(
           greatest(q.fecha_aprobacion::date - q.fecha_emision, 0)
         ) filter (where q.fecha_aprobacion is not null)::numeric, 1)
    from public.cotizaciones q
    left join public.usuarios v on v.id = q.vendedor_id
   where q.fecha_emision between p_desde and p_hasta
   group by q.vendedor_id, v.nombres, v.apellidos
   order by sum(q.total) desc;
end;
$$;

comment on function public.informe_comercial(date, date) is
  'Cotizaciones del período por vendedor: cuánto se ofreció, cuánto se cerró y en cuántos días se decidió.';

-- ------------------------------------------------------- consumo de material
-- En qué se va el acero. Ordenado por plata, que es como se decide qué comprar
-- mejor y qué stock vale la pena tener.
create or replace function public.informe_consumo_materiales(
  p_desde date,
  p_hasta date
)
returns table (
  material_id   uuid,
  codigo        text,
  descripcion   text,
  categoria     text,
  unidad        text,
  cantidad      numeric,
  costo         numeric,
  ordenes       int,
  salidas       int
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('reportes.ver');

  return query
  select d.material_id,
         mt.codigo::text,
         mt.descripcion::text,
         cat.nombre::text,
         um.codigo::text,
         round(sum(d.cantidad), 4),
         round(sum(d.cantidad * coalesce(d.costo_unitario, 0)), 2),
         count(distinct mv.orden_id)::int,
         count(*)::int
    from public.movimiento_detalle d
    join public.movimientos_almacen mv on mv.id = d.movimiento_id
    join public.materiales mt          on mt.id = d.material_id
    left join public.categorias_material cat on cat.id = mt.categoria_id
    left join public.unidades_medida um      on um.id = mt.unidad_medida_id
   -- La salida a la OT es el consumo; la merma también sale del almacén y
   -- también cuesta, así que cuenta. La devolución no: vuelve al estante.
   where mv.tipo in ('SALIDA_OT', 'SALIDA_MERMA')
     and mv.estado = 'CONFIRMADO'
     and mv.fecha between p_desde and p_hasta
   group by d.material_id, mt.codigo, mt.descripcion, cat.nombre, um.codigo
   order by sum(d.cantidad * coalesce(d.costo_unitario, 0)) desc;
end;
$$;

comment on function public.informe_consumo_materiales(date, date) is
  'Material que salió del almacén en el período, del que más plata representa al que menos.';

-- --------------------------------------------------------------- subcontratos
-- Cuánto se manda a hacer afuera y quién cumple. Sirve para negociar el año que
-- viene y para saber a quién no volver a darle trabajo urgente.
create or replace function public.informe_subcontratos(
  p_desde date,
  p_hasta date
)
returns table (
  proveedor_id  uuid,
  proveedor     text,
  ordenes       int,
  monto         numeric,
  conformes     int,
  atrasadas     int,
  dias_promedio numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('reportes.ver');
  perform public.exigir_permiso('costos.ver');

  return query
  select s.proveedor_id,
         p.razon_social::text,
         count(*)::int,
         round(sum(coalesce(s.monto_base, s.monto)), 2),
         count(*) filter (where s.estado in ('CONFORME', 'PAGADO'))::int,
         count(*) filter (
           where s.fecha_entrega is not null
             and coalesce(s.fecha_conformidad, current_date) > s.fecha_entrega
         )::int,
         round(avg(s.fecha_conformidad - s.fecha)
               filter (where s.fecha_conformidad is not null)::numeric, 1)
    from public.servicios_terceros s
    join public.proveedores p on p.id = s.proveedor_id
   where s.fecha between p_desde and p_hasta
     and s.estado <> 'ANULADO'
   group by s.proveedor_id, p.razon_social
   order by sum(coalesce(s.monto_base, s.monto)) desc;
end;
$$;

comment on function public.informe_subcontratos(date, date) is
  'Trabajo mandado afuera en el período, por proveedor, con lo que se le pagó y cómo cumplió.';

-- ---------------------------------------------------------------- resumen
-- Las cifras de la portada: lo que la gerencia mira primero. Devuelve una sola
-- fila y calla lo que la persona no puede ver.
create or replace function public.informe_resumen(
  p_desde date,
  p_hasta date
)
returns table (
  ordenes_abiertas   int,
  ordenes_entregadas int,
  entregas_a_tiempo  int,
  horas_taller       numeric,
  unidades_atrasadas int,
  costo_periodo      numeric,
  venta_periodo      numeric,
  utilidad_periodo   numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_costos boolean;
begin
  perform public.exigir_permiso('reportes.ver');
  v_costos := public.es_admin() or public.tiene_permiso('costos.ver');

  return query
  select
    (select count(*)::int from public.ordenes_trabajo
      where estado in ('APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA', 'CONTROL_CALIDAD')),
    (select count(*)::int from public.ot_entregas
      where fecha_entrega between p_desde and p_hasta),
    (select count(*)::int from public.ot_entregas e
       join public.ordenes_trabajo o on o.id = e.orden_id
      where e.fecha_entrega between p_desde and p_hasta
        and (o.fecha_entrega_comprometida is null
             or e.fecha_entrega <= o.fecha_entrega_comprometida)),
    (select round(coalesce(sum(horas_totales), 0), 1)
       from public.v_ot_mano_obra_detalle where fecha between p_desde and p_hasta),
    (select count(*)::int from public.ot_resumen where dias_atraso > 0),
    case when v_costos then
      (select round(coalesce(sum(costo_total), 0), 2) from public.v_ot_margen m
        where coalesce(m.fecha_fin_real::date, m.fecha_registro::date) between p_desde and p_hasta)
    end,
    case when v_costos then
      (select round(coalesce(sum(valor_venta), 0), 2) from public.v_ot_margen m
        where coalesce(m.fecha_fin_real::date, m.fecha_registro::date) between p_desde and p_hasta)
    end,
    case when v_costos then
      (select round(coalesce(sum(utilidad), 0), 2) from public.v_ot_margen m
        where coalesce(m.fecha_fin_real::date, m.fecha_registro::date) between p_desde and p_hasta)
    end;
end;
$$;

comment on function public.informe_resumen(date, date) is
  'Las cifras de portada del período. Deja en blanco las de plata si la persona no puede verlas.';

-- ---------------------------------------------------------------- permisos
do $$
declare f text;
begin
  foreach f in array array[
    'informe_produccion', 'informe_cumplimiento', 'informe_rentabilidad',
    'informe_comercial', 'informe_consumo_materiales', 'informe_subcontratos',
    'informe_resumen'
  ] loop
    execute format('revoke all on function public.%I(date, date) from public, anon', f);
    execute format('grant execute on function public.%I(date, date) to authenticated', f);
  end loop;
end;
$$;
