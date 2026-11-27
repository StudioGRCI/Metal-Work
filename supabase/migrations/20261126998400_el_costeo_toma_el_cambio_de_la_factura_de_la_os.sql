-- El costeo del código interno pasa la OS en dólares a soles con el cambio de su factura
--
-- Por qué existe. Desde la migración 20261126947000, la orden de servicio en
-- dólares toma el tipo de cambio de la fecha de su factura para su monto en
-- soles y su detracción. El costeo de su código interno seguía pasándola a
-- soles con el cambio del día en que se emitió: la misma OS decía S/ 3 800 en
-- Compras › Servicios y en Tesorería, y pesaba S/ 3 700 en el costo de la
-- unidad. Gerencia decidió el 2026-11-26 que el costeo use el mismo cambio que
-- la OS.
--
-- Cómo. En el costeo, la fecha de cada línea es el día cuyo cambio le toca
-- (igual que el gasto del mes, que lleva el día en que se registró). La línea
-- de la OS llevaba el día en que se emitió; ahora lleva el día de su cambio, el
-- mismo que dice `cambio_de_los_servicios`: la fecha de su factura o, mientras
-- no la tiene, el día en que se emitió. La OS en soles nunca tiene día de
-- factura y sigue igual. El costo y el cierre del costeo no se tocan: ya
-- convierten cada línea con el cambio de su fecha.
--
-- Lo que esa fecha movía sin querer, y se deja como estaba. La «última
-- actividad» del código (`codigos_internos_resumen`: el orden de la lista y
-- «con movimiento en 30 días» del Inicio de Gerencia) tomaba la fecha más
-- reciente de todas las líneas: con la factura de hace cinco días de una OS
-- de hace cuarenta, el código «se movía» sin que nadie hubiera hecho nada. La
-- línea de la OS sale de esa cuenta; el día en que se emitió ya lo aporta
-- `codigo_interno_documentos`, así que da lo mismo que antes.
--
-- Y la pantalla tiene que decir con qué cambio va cada OS en dólares sin
-- deducirlo: `codigo_interno_cambio_de_servicios` da, por OS, el día que le
-- toca, el día del cambio registrado que de verdad usa el costeo (el último
-- hasta ese día, como `cambio_del_dia`; vacío si no hay ninguno en diez días) y
-- el día en que se emitió.
--
-- Lo que no iguala con el monto en soles de la OS:
--   · La OS que quedó fija (su detracción ya se depositó, o ya se pagó entera)
--     guarda el monto con el cambio que había ese día. Si Contabilidad registra
--     o corrige después el cambio de su día, el costeo toma el nuevo y la OS no.
--   · La OS sin factura sale del último cambio que había al emitirla: si el de
--     su día se registró después, el costeo usa el de su día y la OS el de la
--     víspera; y si ya tiene un adelanto, corregir el cambio tampoco la mueve.
--     Era así antes de esta migración y se acaba cuando llega su factura.
--   · La OS sin factura emitida cuando el último cambio tenía más de diez días:
--     la OS tiene soles y el costeo la deja «sin cambio». También era así.
--
-- Idempotente: `create or replace` de tres funciones. Las dos que ya existían
-- se comparan antes con el texto que el repositorio conoce.

do $$
declare
  v record;
  v_actual text;
begin
  for v in
    select * from (values
    ('codigo_interno_lineas_servicio', '1fed61b528ee23fe13b4d2f6b57d8dec', '109524342413bc3bb597ade0a0525e07'),
    ('codigos_internos_resumen', '5bfdeb0fc957d1130717d22f19d901cb', '6c11b3dc461e67cf0cadc9f90f3716fe')
    ) as t(nombre, antes, despues)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = v.nombre;
    if v_actual is null then
      raise exception 'No existe la función public.%: esta migración la espera.', v.nombre;
    end if;
    if v_actual not in (v.antes, v.despues) then
      raise exception 'La función public.% tiene en esta base un texto que el repositorio no conoce (md5 %). Revisar antes de reemplazarla.', v.nombre, v_actual;
    end if;
  end loop;
end $$;

create or replace function public.codigo_interno_lineas_servicio(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql
stable
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  return query
  select public.normalizar_codigo_interno(s.codigo_interno),
         case when s.aprobacion = 'APROBADA' then 'SERVICIOS' else 'SERVICIOS_POR_APROBAR' end,
         -- El día cuyo cambio le toca: el de su factura; sin ella, el día en que se emitió.
         coalesce(s.fecha_cambio, public.fecha_de_lima(s.creado_en)),
         s.descripcion::text, s.proveedor::text, 1::numeric, 'servicio'::text, null::numeric,
         s.monto, s.moneda::text, s.monto, 0, s.numero::text, s.id
    from public.ordenes_servicio s
   where s.codigo_interno is not null
     and s.estado <> 'ANULADA' and s.aprobacion <> 'RECHAZADA'
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(s.codigo_interno) = public.normalizar_codigo_interno(p_codigo));
end;
$$;

comment on function public.codigo_interno_lineas_servicio(text) is
  'Las órdenes de servicio de un código interno (o de todos) como líneas del costeo: SERVICIOS si Gerencia la aprobó, SERVICIOS_POR_APROBAR si espera. Sin IGV, en su moneda. La fecha de la línea es el día cuyo tipo de cambio le toca a la OS: el de su factura o, sin ella, el día en que se emitió (20261126998400). Sin las rechazadas ni las anuladas. No pide permiso: la llaman codigo_interno_lineas y codigos_internos_servicios.';

revoke all on function public.codigo_interno_lineas_servicio(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.codigos_internos_resumen()
 RETURNS TABLE(codigo text, requerimientos integer, compras integer, salidas integer, reportes integer, vehiculos integer, unidades integer, ordenes integer, ultima_actividad date, ultimo_reporte date, trabajos integer, trabajos_terminados integer, avance_medio numeric, horas numeric, horas_sin_costo numeric, mano_obra numeric, materiales_pen numeric, materiales_usd numeric, materiales_sin_precio integer, compras_pen numeric, compras_usd numeric, compras_sin_precio integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with costeo as (
    select * from public.codigo_interno_costeo(null)
  ), avance as (
    select * from public.codigo_interno_avance(null)
  ), docs as (
    select * from public.codigo_interno_documentos(null)
  ), ultimo as (
    select distinct on (a.codigo, lower(regexp_replace(btrim(a.trabajo), '\s+', ' ', 'g'))) a.codigo, a.avance
      from avance a
     order by a.codigo, lower(regexp_replace(btrim(a.trabajo), '\s+', ' ', 'g')), a.fecha desc, a.creado_en desc, a.trabajo_orden
  ), por_costeo as (
    select k.codigo,
           count(*) filter (where k.fuente = 'COMPRAS')::integer as compras,
           count(*) filter (where k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO')
                             and exists (select 1 from public.movimientos_materiales m where m.id = k.referencia_id))::integer as salidas,
           coalesce(sum(k.horas) filter (where k.fuente in ('MANO_OBRA', 'MANO_OBRA_SIN_COSTO')), 0)::numeric as horas,
           coalesce(sum(k.horas) filter (where k.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo,
           coalesce(sum(k.monto) filter (where k.fuente = 'MANO_OBRA'), 0)::numeric as mano_obra,
           coalesce(sum(k.monto) filter (where k.fuente = 'MATERIALES' and k.moneda = 'PEN'), 0)::numeric as materiales_pen,
           coalesce(sum(k.monto) filter (where k.fuente = 'MATERIALES' and k.moneda = 'USD'), 0)::numeric as materiales_usd,
           count(*) filter (where k.fuente = 'MATERIALES_SIN_PRECIO')::integer as materiales_sin_precio,
           coalesce(sum(k.monto) filter (where k.fuente = 'COMPRAS' and k.moneda = 'PEN'), 0)::numeric as compras_pen,
           coalesce(sum(k.monto) filter (where k.fuente = 'COMPRAS' and k.moneda = 'USD'), 0)::numeric as compras_usd,
           coalesce(sum(k.sin_precio) filter (where k.fuente = 'COMPRAS'), 0)::integer as compras_sin_precio,
           -- La OS no entra aquí: su línea lleva el día de su cambio, no el de su emisión, y
           -- la fecha en que se emitió ya la cuenta codigo_interno_documentos (20261126998400).
           max(k.fecha) filter (where k.fuente not in ('SERVICIOS', 'SERVICIOS_POR_APROBAR')) as ultima
      from costeo k group by k.codigo
  ), por_avance as (
    select a.codigo, count(distinct a.reporte_id)::integer as reportes, max(a.fecha) as ultimo_reporte
      from avance a group by a.codigo
  ), por_trabajo as (
    select u.codigo, count(*)::integer as trabajos, count(*) filter (where u.avance = 100)::integer as terminados,
           round(avg(u.avance))::numeric as avance_medio
      from ultimo u group by u.codigo
  ), por_docs as (
    select d.codigo,
           count(*) filter (where d.tipo = 'REQUERIMIENTO' and d.estado <> 'ANULADO')::integer as requerimientos,
           count(*) filter (where d.tipo = 'VEHICULO')::integer as vehiculos,
           count(*) filter (where d.tipo = 'UNIDAD')::integer as unidades,
           count(*) filter (where d.tipo = 'OT')::integer as ordenes,
           max(d.fecha) as ultima
      from docs d group by d.codigo
  ), codigos as (
    select k.codigo from costeo k union select a.codigo from avance a union select d.codigo from docs d
  )
  select c.codigo,
         coalesce(d.requerimientos, 0), coalesce(k.compras, 0), coalesce(k.salidas, 0), coalesce(a.reportes, 0),
         coalesce(d.vehiculos, 0), coalesce(d.unidades, 0), coalesce(d.ordenes, 0),
         greatest(k.ultima, a.ultimo_reporte, d.ultima), a.ultimo_reporte,
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), t.avance_medio,
         coalesce(k.horas, 0), coalesce(k.horas_sin_costo, 0), coalesce(k.mano_obra, 0),
         coalesce(k.materiales_pen, 0), coalesce(k.materiales_usd, 0), coalesce(k.materiales_sin_precio, 0),
         coalesce(k.compras_pen, 0), coalesce(k.compras_usd, 0), coalesce(k.compras_sin_precio, 0)
    from codigos c
    left join por_costeo k on k.codigo = c.codigo
    left join por_avance a on a.codigo = c.codigo
    left join por_trabajo t on t.codigo = c.codigo
    left join por_docs d on d.codigo = c.codigo
   where c.codigo is not null
   order by 9 desc nulls last, 1;
end;
$function$;

-- Con qué cambio va en el costeo cada OS en dólares del código.
create or replace function public.codigo_interno_cambio_de_servicios(p_codigo text)
returns table (orden_servicio_id uuid, dia date, registrado_el date, emitida_el date)
language plpgsql
stable
security definer
rows 20
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  select l.referencia_id,
         l.fecha,
         -- El mismo que toma cambio_del_dia: el último registrado hasta ese día, de no más de diez días.
         (select t.fecha
            from public.tipos_de_cambio t
           where t.fecha <= l.fecha and t.fecha > l.fecha - 10
           order by t.fecha desc
           limit 1),
         public.fecha_de_lima(s.creado_en)
    from public.codigo_interno_lineas_servicio(p_codigo) l
    join public.ordenes_servicio s on s.id = l.referencia_id
   where l.moneda <> 'PEN';
end;
$$;

comment on function public.codigo_interno_cambio_de_servicios(text) is
  'Con qué tipo de cambio pasa a soles en el costeo cada orden de servicio en otra moneda de un código interno (o de todos): `dia` es el día que le toca (el de su factura o, sin ella, el día en que se emitió), `registrado_el` el día del cambio registrado que de verdad se usa (el último hasta `dia`, de no más de diez días, como cambio_del_dia; vacío si no hay ninguno y la línea queda sin pasar a soles) y `emitida_el` el día en que se emitió. Las OS en soles no vienen. Pide codigos_internos.ver, como codigo_interno_costeo (20261126998400).';

revoke all on function public.codigo_interno_cambio_de_servicios(text) from public, anon;
grant execute on function public.codigo_interno_cambio_de_servicios(text) to authenticated;
