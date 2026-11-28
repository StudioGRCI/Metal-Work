-- =============================================================================
-- LOS RESULTADOS DE METAL WORK: CADA CARROCERÍA Y EL TOTAL DE LA EMPRESA
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-27: «con eso de gasto operativo que son cosas para taller
-- cambiaría los reportes que ve Gerencia: ahora vería por código interno para
-- ver el ingreso y la ganancia por carrocería, y después estarían los equipos,
-- que es el conjunto de todo». «Los equipos» es el total de Metal Work (lo
-- eligió por tarjeta el 27/11). Entrega 3 del plan del gasto operativo; las
-- decisiones G a L las aprobó el 28/11 («Ok, con las recomendaciones»).
--
-- Qué cuenta en un periodo (un día, un mes o un año):
--
--   · El ingreso de cada código: sus facturas de venta vigentes emitidas en el
--     periodo, sin IGV (÷ 1,18: todas gravadas, decisión K) y en soles con el
--     tipo de cambio de compra del día de la factura (decisión H), el mismo con
--     que el costeo pasa a soles la venta en dólares. La factura en dólares sin
--     cambio registrado no suma: se dice cuánto falta.
--   · El costo de cada código, en proporción a lo facturado (decisión G): un
--     adelanto del 50 % de la unidad lleva el 50 % de su costo, y la factura que
--     completa la unidad, el resto. Lo facturado se mide contra la parte de la
--     unidad en su cotización, con IGV y en su moneda, como Facturación
--     (`facturacion_por_unidad`); lo facturado de más ya no lleva costo. El
--     costo es el que Gerencia congeló al cerrar el costeo, o el de hoy si sigue
--     abierto: por eso un mes es provisional hasta que sus códigos se cierran.
--     Sin precio de la unidad (la cotización sin monto o en otra moneda), el
--     costo se reparte entre sus facturas por lo facturado hasta hoy, y se dice.
--   · Después, el total de Metal Work resta, una sola vez y al final:
--       - el gasto operativo de cada área (lo cargado a PLANTA, migración
--         20261127190000, con la misma regla de qué suma);
--       - el gasto de oficina: lo cargado a OFICINA (decisión J). El sueldo de
--         la oficina sigue repartido por horas en el costo de cada unidad
--         (decisión D del plan);
--       - lo que no se repartió a ninguna unidad (decisión I): lo que sigue
--         cargado a TODOS LOS ACTIVOS (salió en un mes en que ningún código
--         trabajó), los gastos del mes por horas de un mes sin horas en ninguna
--         unidad, y el sueldo de la oficina de ese mes. Sin esto, la ganancia de
--         ese mes salía mayor que la real. Los gastos registrados antes con tasa
--         o en partes iguales se reparten como se registraron y no entran aquí.
--     Lo comprado no se resta: entra al almacén y cuenta cuando sale (decisión B).
--
-- La lectura la tienen Gerencia y Contabilidad (decisión E), con el permiso
-- nuevo `resultados.ver`. Solo lectura. Sin DROP. Idempotente.
-- =============================================================================

-- 1. El permiso -------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('resultados.ver', 'Costos',
   'Consultar los resultados de Metal Work por día, mes o año: el ingreso, el costo y la ganancia de cada código interno, y el total de la empresa menos el gasto operativo, el de oficina y lo que no se repartió')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'resultados.ver' from public.roles r where r.codigo in ('GERENTE', 'CONTABILIDAD')
on conflict do nothing;

-- 2. Lo que lleva cada factura de su unidad: sin permiso, lo llama solo el reporte --
-- Una fila por parte de factura vigente (`v_facturas_venta_por_unidad`), con lo
-- que pesa en soles sin IGV y qué parte del costo de su código le toca.
create or replace function public.resultados_facturas_calculado(p_hasta date)
returns table (parte_id uuid, factura_id uuid, codigo text, fecha date, cliente text, numero text, moneda text,
               monto numeric, sin_igv numeric, cambio numeric, soles numeric, parte_del_costo numeric,
               sin_precio_de_venta boolean)
language plpgsql stable rows 100 set search_path to 'public' as $$
-- plpgsql y no sql: la llama el reporte, que se abre seguido (skill datos › Rendimiento).
#variable_conflict use_column
declare
  c_igv constant numeric := 0.18;
begin
  return query
  with fx as (
    select p.id, p.factura_id, public.normalizar_codigo_interno(p.codigo_interno) as codigo, p.cotizacion_pdf_id as cot,
           p.numero_de_unidad as unidad, p.fecha_emision as fecha, p.cliente, p.numero, p.moneda::text as moneda,
           p.monto::numeric as monto, p.creado_en
      from public.v_facturas_venta_por_unidad p
     where p.anulada_en is null
       and public.normalizar_codigo_interno(p.codigo_interno) is not null
       -- Hasta el último día pedido: lo facturado antes también cuenta, para saber
       -- cuánto del costo ya se llevaron las facturas anteriores.
       and (p_hasta is null or p.fecha_emision <= p_hasta)
  ), precio as (
    -- La parte de la unidad en su cotización, con IGV y en su moneda: la cuenta de Facturación.
    select c.id as cot, coalesce(c.moneda::text, 'PEN') as moneda, greatest(coalesce(c.cantidad_unidades, 1), 1)::integer as unidades,
           case when c.monto_venta is null then null
                when ig.incluye_igv = false then round(c.monto_venta::numeric * (1 + c_igv), 2)
                else c.monto_venta::numeric end as total
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id and ig.version = c.version
     where c.id in (select fx.cot from fx)
  ), unidades as (
    -- Cuántas unidades de cotización facturadas tiene el código: casi siempre una.
    select fx.codigo, count(distinct (fx.cot, fx.unidad))::numeric as n from fx group by fx.codigo
  ), medida as (
    select fx.*,
           case when pr.moneda = fx.moneda then public.parte_de_unidad(pr.total, pr.unidades, fx.unidad) end as de_la_unidad,
           u.n as unidades_del_codigo
      from fx
      join unidades u on u.codigo = fx.codigo
      left join precio pr on pr.cot = fx.cot
  ), con_precio as (
    select m.*, bool_and(coalesce(m.de_la_unidad > 0, false)) over (partition by m.codigo) as hay_precio,
           sum(m.monto) over (partition by m.codigo) as facturado_del_codigo
      from medida m
  ), fraccion as (
    select c.*,
           case when c.hay_precio then c.monto / c.de_la_unidad / c.unidades_del_codigo
                when c.facturado_del_codigo > 0 then c.monto / c.facturado_del_codigo end as fraccion
      from con_precio c
  ), acumulada as (
    select f.*, sum(f.fraccion) over (partition by f.codigo order by f.fecha, f.creado_en, f.id) as hasta_aqui
      from fraccion f
  )
  select a.id, a.factura_id, a.codigo, a.fecha, a.cliente, a.numero, a.moneda, a.monto,
         round(a.monto / (1 + c_igv), 2),
         case when a.moneda = 'USD' then public.cambio_del_dia(a.fecha, 'COMPRA') end,
         case when a.moneda = 'PEN' then round(a.monto / (1 + c_igv), 2)
              when a.moneda = 'USD' then round(a.monto / (1 + c_igv) * public.cambio_del_dia(a.fecha, 'COMPRA'), 2) end,
         -- Lo que esta factura se lleva del costo: hasta completar la unidad, nunca más.
         greatest(least(a.hasta_aqui, 1) - least(a.hasta_aqui - a.fraccion, 1), 0),
         not a.hay_precio
    from acumulada a;
end $$;

revoke all on function public.resultados_facturas_calculado(date) from public, anon, authenticated;

comment on function public.resultados_facturas_calculado(date) is
  'Cálculo interno del reporte de resultados (migración 20261128100000): cada parte de factura de venta vigente hasta una fecha, sin IGV y en soles al cambio de compra de su día, con la parte del costo de su código que le toca. No se le da a nadie: lo llama resultados_metal_work.';

-- 3. El reporte --------------------------------------------------------------------
-- Una fila por código facturado en el periodo (CODIGO), por área del gasto
-- operativo (GASTO_OPERATIVO), por grupo del gasto de oficina (OFICINA) y por
-- cada cosa sin repartir (SIN_REPARTIR). `soles` es lo que se resta o se suma;
-- vacío cuando no se puede decir todavía (falta el cambio), y entonces la
-- pantalla lo cuenta aparte en vez de sumarlo.
create or replace function public.resultados_metal_work(p_desde date, p_hasta date)
returns table (tipo text, clave text, nombre text, cliente text, facturas integer,
               facturado_soles numeric, facturado_usd_sin_cambio numeric, facturas_sin_cambio integer,
               parte_del_costo numeric, costo_del_codigo numeric, costo_cerrado boolean, sin_precio_de_venta boolean,
               costo_incompleto integer, soles numeric, ganancia numeric, lineas integer, lineas_sin_cambio integer)
language plpgsql stable security definer rows 100 set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.usuario_actual() is null or public.es_admin() or public.tiene_permiso('resultados.ver')) then
    raise exception 'No tienes permiso para ver los resultados de Metal Work.' using errcode = 'insufficient_privilege';
  end if;
  if p_desde is null or p_hasta is null then
    raise exception 'Elige el día, el mes o el año del reporte.';
  end if;
  if p_hasta < p_desde then
    raise exception 'El periodo termina antes de empezar: revisa las fechas.';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'El reporte llega hasta un año a la vez: elige un año, un mes o un día.';
  end if;

  return query
  with fx as (
    select * from public.resultados_facturas_calculado(p_hasta)
  ), del_periodo as (
    select f.codigo,
           string_agg(distinct f.cliente, ' · ') as cliente,
           count(distinct f.factura_id)::integer as facturas,
           coalesce(sum(f.soles), 0)::numeric as soles,
           coalesce(sum(f.sin_igv) filter (where f.soles is null), 0)::numeric as usd_sin_cambio,
           count(distinct f.factura_id) filter (where f.soles is null)::integer as sin_cambio,
           sum(f.parte_del_costo)::numeric as parte,
           bool_or(f.sin_precio_de_venta) as sin_precio
      from fx f
     where f.fecha between p_desde and p_hasta
     group by f.codigo
  ), costo as (
    select k.codigo,
           -- Cerrado, el costo que Gerencia congeló; abierto, el de hoy.
           case when k.cierre_id is not null then k.costo_cerrado_pen else k.costo_pen end as costo,
           k.cierre_id is not null as cerrado,
           case when k.cierre_id is not null then 0
                else k.materiales_sin_precio + k.lineas_sin_cambio + case when k.horas_sin_costo > 0 then 1 else 0 end end as incompleto
      from public.codigos_internos_costo_calculado(null) k
     where k.codigo in (select d.codigo from del_periodo d)
  ), codigos as (
    select d.*, coalesce(k.costo, 0) as costo, coalesce(k.cerrado, false) as cerrado, coalesce(k.incompleto, 0) as incompleto,
           round(coalesce(k.costo, 0) * d.parte, 2) as costo_del_periodo
      from del_periodo d
      left join costo k on k.codigo = d.codigo
  ), operativo as (
    select g.area_id, coalesce(sum(g.soles), 0)::numeric as soles, count(*)::integer as lineas,
           count(*) filter (where g.soles is null and g.monto is not null)::integer as sin_cambio
      from public.gasto_operativo_lineas_calculado(p_desde, p_hasta) g
     where g.suma
     group by g.area_id
  ), lineas_de as (
    -- Lo cargado a OFICINA y a TODOS LOS ACTIVOS, con la regla de qué suma del costeo
    -- (`codigos_internos_costo_calculado`) y lo comprado fuera.
    select c.codigo, k.fuente, k.moneda, k.monto, k.referencia_id, k.fecha,
           case
             when k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO', 'MERMA') then 'MATERIALES'
             when k.fuente in ('MANO_OBRA', 'MANO_OBRA_SIN_COSTO', 'RECARGO_EXTRAS') then 'MANO_OBRA'
             when k.fuente in ('SERVICIOS', 'SERVICIOS_POR_APROBAR') then 'SERVICIOS'
             when k.fuente in ('SUBCONTRATOS', 'SUBCONTRATOS_POR_PAGAR') then 'SUBCONTRATOS'
             when k.fuente = 'CAJA' then 'CAJA'
             when k.fuente = 'GASTOS_DEL_MES' then 'GASTOS_DEL_MES'
             else 'OTROS'
           end as grupo
      from unnest(array['OFICINA', 'TODOS LOS ACTIVOS']) as c(codigo)
      cross join lateral public.codigo_interno_lineas(c.codigo, true) k
     where k.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                        'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA')
       and k.monto is not null
       and k.fecha between p_desde and p_hasta
  ), en_soles as (
    select l.*,
           case when l.moneda = 'PEN' then l.monto
                when l.moneda = 'USD' then public.soles_de_la_linea_del_costeo(l.fuente, l.referencia_id, l.fecha, l.monto) end as soles
      from lineas_de l
  ), gasto_sin_horas as (
    -- Un gasto del mes POR HORAS de un mes en que ninguna unidad tiene horas: no
    -- lo lleva nadie todavía. Con el día en que se registró, como su línea del costeo.
    select g.monto, g.moneda::text as moneda, (g.creado_en at time zone 'America/Lima')::date as fecha
      from public.gastos_generales_mes g
     where g.estado = 'ACTIVO' and g.reparto = 'HORAS'
       and (g.creado_en at time zone 'America/Lima')::date between p_desde and p_hasta
       and not exists (select 1 from public.horas_por_codigo_del_mes(g.periodo) h)
  ), oficina_sin_horas as (
    -- El sueldo de la oficina de ese mes, con la fecha de su línea (el 1 del mes).
    select o.monto, o.periodo
      from public.sueldos_oficina_del_mes(null) o
     where o.monto > 0 and o.periodo between p_desde and p_hasta
       and not exists (select 1 from public.horas_por_codigo_del_mes(o.periodo) h)
  )
  select 'CODIGO'::text, c.codigo, null::text, c.cliente, c.facturas,
         c.soles, c.usd_sin_cambio, c.sin_cambio,
         round(c.parte, 4), c.costo, c.cerrado, c.sin_precio, c.incompleto,
         c.costo_del_periodo,
         -- Con una factura sin cambio no se sabe el ingreso: la ganancia no se adivina.
         case when c.sin_cambio = 0 then c.soles - c.costo_del_periodo end,
         null::integer, null::integer
    from codigos c
  union all
  select 'GASTO_OPERATIVO', o.area_id::text, coalesce(a.nombre, 'Planta, sin área')::text, null, null,
         null, null, null, null, null, null, null, null,
         o.soles, null, o.lineas, o.sin_cambio
    from operativo o
    left join public.areas a on a.id = o.area_id
  union all
  select 'OFICINA', s.grupo, null, null, null, null, null, null, null, null, null, null, null,
         coalesce(sum(s.soles), 0), null, count(*)::integer, count(*) filter (where s.soles is null)::integer
    from en_soles s
   where s.codigo = 'OFICINA'
   group by s.grupo
  union all
  select 'SIN_REPARTIR', 'TODOS_LOS_ACTIVOS', null, null, null, null, null, null, null, null, null, null, null,
         coalesce(sum(s.soles), 0), null, count(*)::integer, count(*) filter (where s.soles is null)::integer
    from en_soles s
   where s.codigo = 'TODOS LOS ACTIVOS'
  having count(*) > 0
  union all
  select 'SIN_REPARTIR', 'GASTOS_DEL_MES', null, null, null, null, null, null, null, null, null, null, null,
         coalesce(sum(case when g.moneda = 'PEN' then g.monto
                           else round(g.monto * public.cambio_del_dia(g.fecha, 'VENTA'), 2) end), 0),
         null, count(*)::integer,
         count(*) filter (where g.moneda <> 'PEN' and public.cambio_del_dia(g.fecha, 'VENTA') is null)::integer
    from gasto_sin_horas g
  having count(*) > 0
  union all
  select 'SIN_REPARTIR', 'SUELDOS_OFICINA', null, null, null, null, null, null, null, null, null, null, null,
         coalesce(sum(o.monto), 0), null, count(*)::integer, 0
    from oficina_sin_horas o
  having count(*) > 0
  order by 1, 2;
end $$;

revoke all on function public.resultados_metal_work(date, date) from public, anon;
grant execute on function public.resultados_metal_work(date, date) to authenticated;

comment on function public.resultados_metal_work(date, date) is
  'Los resultados de Metal Work entre dos fechas (hasta un año): cada código interno facturado con su ingreso sin IGV en soles, la parte de su costo que le toca por lo facturado y su ganancia; y lo que el total resta al final: el gasto operativo por área, el gasto de oficina y lo que no se repartió a ninguna unidad. Exige resultados.ver (Gerencia y Contabilidad). Migración 20261128100000.';

notify pgrst, 'reload schema';
