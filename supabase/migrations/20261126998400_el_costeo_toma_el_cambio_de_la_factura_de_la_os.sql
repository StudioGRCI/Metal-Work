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
-- factura y sigue igual. No se toca nada más: el costo, el cierre del costeo y
-- la pantalla ya convierten cada línea con el cambio de su fecha.
--
-- Lo que no iguala: la OS que quedó fija (su detracción ya se depositó o ya se
-- pagó entera) guarda el monto en soles con el cambio que había ese día; si
-- Contabilidad corrige después ese cambio, el costeo toma el corregido y la OS
-- no. Y la OS sin factura que se emitió antes de que se registrara el cambio de
-- su día sigue con el de la víspera, mientras el costeo ya usa el de su día:
-- era así antes y se acaba cuando llega su factura.
--
-- Idempotente: `create or replace` de una función que nadie llama desde afuera.

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
