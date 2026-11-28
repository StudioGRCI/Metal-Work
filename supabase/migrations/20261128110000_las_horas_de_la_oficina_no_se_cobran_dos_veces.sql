-- =============================================================================
-- LAS HORAS DE LA OFICINA EN PLANTA U OFICINA NO SE COBRAN DOS VECES
-- -----------------------------------------------------------------------------
-- Lo encontró la auditoría del reporte de Gerencia (Resultados de Metal Work),
-- el 2026-11-28, y DKS eligió cómo arreglarlo el mismo día.
--
-- A una persona de planilla administrativa se le reparte entre las unidades
-- todo lo que se le pagó en el mes (sueldos_oficina_del_mes), menos lo que cargó
-- en horas a una unidad, que ya va en la mano de obra de esa unidad. Pero si
-- cargaba horas a PLANTA, OFICINA o TODOS LOS ACTIVOS, ese tramo no se le
-- restaba: el sueldo entero iba a las unidades y esas horas salían además, con
-- su costo, en la mano de obra de PLANTA (gasto operativo, 20261127190000) o de
-- OFICINA (gasto de oficina). Ejemplo: S/ 3 000 de sueldo y 40 h a PLANTA por
-- S/ 500; las unidades llevaban S/ 3 000 y el gasto operativo S/ 500, y Metal
-- Work contaba S/ 3 500.
--
-- Desde aquí se le resta todo lo que cargó en horas, a cualquier código: las
-- unidades llevan S/ 2 500 y PLANTA S/ 500. El costo de cada carrocería queda
-- con lo que de verdad fue para ella («costeo mejor por unidad», DKS,
-- 2026-10-20), y la oficina se costea como la gente de taller, cuyas horas van
-- siempre al código al que se cargan.
--
-- Producción no tiene tareos, pagos de la oficina ni horas (consultado el
-- 2026-11-28): no cambia ningún número ya calculado ni cerrado.
--
-- Sin DROP. Idempotente.
-- =============================================================================

-- La función no se pisa si producción la cambió a mano (skill esquema › Trampas).
do $$
declare
  v_actual text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_actual
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'sueldos_oficina_del_mes';
  if v_actual is null then
    raise exception 'No existe la función public.sueldos_oficina_del_mes: esta migración la espera.';
  end if;
  if v_actual not in ('020e773c777505f8d635fb065f42f11d', '5a6213c199628fa14f33635d182c9998') then
    raise exception 'La función public.sueldos_oficina_del_mes tiene en esta base un texto que el repositorio no conoce (md5 %). Revisar antes de reemplazarla.', v_actual;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.sueldos_oficina_del_mes(p_periodo date DEFAULT NULL::date)
 RETURNS TABLE(periodo date, personas integer, monto numeric, sin_pago integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with mes as (
    select date_trunc('month', p_periodo)::date as periodo where p_periodo is not null
    union
    select distinct h.periodo from public.horas_por_codigo_del_mes(null) h where p_periodo is null
  ), pago as (
    -- Los días que el pago cubre dentro del mes: de ahí se restan las horas.
    select m.periodo, p.trabajador_id,
           greatest(p.desde, m.periodo) as desde,
           least(p.hasta, (m.periodo + interval '1 month' - interval '1 day')::date) as hasta,
           round((p.monto + p.aportes) * (least(p.hasta, (m.periodo + interval '1 month' - interval '1 day')::date) - p.desde + 1) / (p.hasta - p.desde + 1), 2)
           - round((p.monto + p.aportes) * greatest(0, least(p.hasta, m.periodo - 1) - p.desde + 1) / (p.hasta - p.desde + 1), 2) as parte
      from mes m
      join public.oficina_pagos p on p.anulado_en is null
                                 and p.desde < (m.periodo + interval '1 month')::date and p.hasta >= m.periodo
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = p.id)
  ), neto as (
    -- A lo pagado a cada persona en el mes se le resta lo que cargó en horas,
    -- a una unidad o a PLANTA, OFICINA o TODOS LOS ACTIVOS, en los días que sus
    -- pagos cubren, y solo en esos: si pasó a planilla de taller a mitad de mes,
    -- sus horas de después no se comen lo que se le pagó antes. Esas horas ya
    -- van en la mano de obra del código al que se cargaron (20261128110000).
    select g.periodo, g.trabajador_id,
           greatest(sum(g.parte) - coalesce((select sum(t.costo) from public.tareos t
                                               where t.trabajador_id = g.trabajador_id and t.anulado_en is null
                                                 and exists (select 1 from pago c
                                                              where c.periodo = g.periodo and c.trabajador_id = g.trabajador_id
                                                                and t.fecha between c.desde and c.hasta)), 0), 0) as monto
      from pago g
     group by g.periodo, g.trabajador_id
  ), horas as (
    -- El primer mes con horas por código: desde ahí también faltan los pagos.
    select min(h.periodo) as desde from public.horas_por_codigo_del_mes(null) h
  ), falta as (
    -- Los días que trabajó en el mes hasta hoy (en el periodo de ahora o en uno
    -- anterior, si volvió a entrar) y que ningún pago cubre.
    select m.periodo, w.id
      from mes m
      cross join horas hh
      join public.trabajadores w on (w.activo or w.fecha_baja is not null) and w.planilla = 'ADMINISTRATIVA'
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id)
       and exists (select 1
                     from generate_series(greatest(m.periodo, least(public.inicio_registro_pagos_oficina(w.id), hh.desde)),
                                          least((m.periodo + interval '1 month' - interval '1 day')::date,
                                                (now() at time zone 'America/Lima')::date),
                                          interval '1 day') d(dia)
                    where ((w.fecha_ingreso is null or d.dia::date >= w.fecha_ingreso)
                           and (w.fecha_baja is null or d.dia::date <= w.fecha_baja)
                           or exists (select 1 from public.trabajador_periodos q
                                       where q.trabajador_id = w.id and (q.ingreso is null or d.dia::date >= q.ingreso)
                                         and d.dia::date <= q.baja))
                      and not exists (select 1 from public.oficina_pagos p
                                       where p.trabajador_id = w.id and p.anulado_en is null
                                         and d.dia::date between p.desde and p.hasta
                                         and not exists (select 1 from public.pruebas_filas f
                                                          where f.tabla = 'oficina_pagos' and f.fila_id = p.id)))
  )
  select m.periodo,
         (select count(*) from neto n where n.periodo = m.periodo)::integer,
         coalesce((select round(sum(n.monto), 2) from neto n where n.periodo = m.periodo), 0),
         (select count(*) from falta f where f.periodo = m.periodo)::integer
    from mes m;
end;
$function$;

revoke all on function public.sueldos_oficina_del_mes(date) from public, anon, authenticated;
