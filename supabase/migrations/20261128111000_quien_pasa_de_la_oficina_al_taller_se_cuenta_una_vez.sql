-- =============================================================================
-- QUIEN PASA DE LA OFICINA AL TALLER A MITAD DE MES SE CUENTA UNA VEZ
-- -----------------------------------------------------------------------------
-- Sigue a la 20261128110000, que resta del sueldo de la oficina todas las horas
-- que esa persona cargó en los días que cubre un pago de la oficina (decisión
-- de DKS, 2026-11-28). La auditoría de ese cambio encontró el caso que quedaba:
--
-- Desde noviembre de 2026 la planilla de taller ajusta el costo
-- (planilla_al_costo): a lo que se le pagó a cada persona en la planilla de
-- taller del mes le resta lo que ya entró por sus horas, y esas horas eran TODAS
-- las del mes. Si alguien pasa de la planilla administrativa a la de taller a
-- mitad de mes, las horas de su tramo de oficina se restaban dos veces: del
-- sueldo de la oficina y del ajuste de la planilla de taller. Ejemplo de la
-- auditoría: 1 200 por la primera quincena en la oficina (10 h a PLANTA, 100) y
-- 1 300 por la segunda en el taller (80 h a una unidad, 900); se contaba
-- 1 100 + 900 + 400 = 2 400 de los 2 500 pagados.
--
-- Desde aquí el ajuste de la planilla de taller, y el reparto de ese ajuste por
-- las horas de cada persona (codigo_interno_lineas_planilla), dejan fuera las
-- horas de los días que cubre un pago de la oficina: esas ya se restaron allá.
-- El caso al revés (de taller a oficina a mitad de mes) es de antes y no se
-- toca aquí: planilla_al_costo mira la planilla que la ficha tiene hoy.
--
-- También se ponen al día los comentarios de sueldos_oficina_del_mes y de
-- gastos_del_mes_oficina, que seguían diciendo «menos lo cargado a una unidad».
--
-- Producción no tiene tareos, pagos de la oficina ni planillas de taller con
-- personas (consultado el 2026-11-28): no cambia ningún número.
--
-- Sin DROP. Idempotente.
-- =============================================================================

-- Las funciones no se pisan si producción las cambió a mano (skill esquema › Trampas).
do $$
declare
  v record;
  v_actual text;
begin
  for v in
    select * from (values
    ('planilla_al_costo', '872545e02b67235abd99c9a2df9da850', '29fe187e4ebdfa93d0e8ff1665f6656b'),
    ('codigo_interno_lineas_planilla', 'ebbbddb776c9b89ad4dd203a4969b066', '219ca16061db318e161d37d9cef1a616')
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

CREATE OR REPLACE FUNCTION public.planilla_al_costo(p_planilla uuid DEFAULT NULL::uuid)
 RETURNS TABLE(planilla_id uuid, periodo date, persona_id uuid, nombre text, trabajador_id uuid, como text, costo numeric, horas numeric, costo_horas numeric, recargo numeric, ajuste numeric, codigos integer, mes_con_horas boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with persona as (
    select p.id as planilla_id, p.periodo, pp.id as persona_id, pp.nombre, pp.monto as costo,
           public.trabajador_de_planilla(pp.nombre, pp.documento) as trabajador_id
      from public.planillas p
      join public.planilla_personas pp on pp.planilla_id = p.id
     where p.tipo = 'TALLER' and p.moneda = 'PEN'
       and ((p_planilla is null and p.estado = 'CERRADA') or p.id = p_planilla)
  ), hora as (
    -- Sin las horas de los días que cubre un pago de la oficina: si pasó de la
    -- planilla administrativa a la de taller a mitad de mes, esas ya se restaron
    -- del sueldo de la oficina (20261128110000) y no se restan otra vez aquí.
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo, sum(t.horas) as horas, sum(t.costo) as costo,
           count(distinct public.normalizar_codigo_interno(t.codigo_interno)) as codigos
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select x.trabajador_id from persona x)
       and not exists (select 1 from public.oficina_pagos op
                        where op.trabajador_id = t.trabajador_id and op.anulado_en is null
                          and t.fecha between op.desde and op.hasta
                          and not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = op.id))
     group by t.trabajador_id, date_trunc('month', t.fecha)
  ), reporte as (
    -- Las horas del reporte que no hicieron tareo: su ficha no tiene costo mensual.
    select l.trabajador_id, date_trunc('month', l.fecha)::date as periodo, sum(l.horas) as horas,
           count(distinct public.normalizar_codigo_interno(r.codigo_interno)) as codigos
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and l.trabajador_id in (select x.trabajador_id from persona x)
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
     group by l.trabajador_id, date_trunc('month', l.fecha)
  ), extra as (
    select d.trabajador_id, d.fecha,
           d.valor_hora * (d.horas_tramo1 * d.recargo_tramo1 + d.horas_tramo2 * d.recargo_tramo2) / 100 as recargo
      from public.planilla_diaria_detalle d
      join public.planilla_diaria_personas pp on pp.id = d.persona_id
      join public.planillas_diarias p on p.id = pp.planilla_id
     where d.concepto = 'EXTRAS' and p.anulado_en is null
       and d.trabajador_id in (select x.trabajador_id from persona x)
  ), jornada as (
    -- Las mismas horas validadas con que codigo_interno_lineas_recargo reparte el recargo.
    select l.trabajador_id, l.fecha, sum(l.horas) as total,
           sum(l.horas) filter (where public.normalizar_codigo_interno(r.codigo_interno) is not null) as con_codigo
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and r.observado_en is null
       and r.visto_gerencia_en is not null and r.visto_rrhh_en is not null
       and l.trabajador_id in (select x.trabajador_id from persona x)
     group by l.trabajador_id, l.fecha
  ), recargo as (
    select e.trabajador_id, date_trunc('month', e.fecha)::date as periodo,
           round(sum(e.recargo * coalesce(j.con_codigo, 0) / j.total), 2) as recargo
      from extra e
      join jornada j on j.trabajador_id = e.trabajador_id and j.fecha = e.fecha and j.total > 0
     group by e.trabajador_id, date_trunc('month', e.fecha)
  ), mes as (
    select distinct m.periodo from public.horas_por_codigo_del_mes(null) m
     where m.periodo in (select x.periodo from persona x)
  ), cuenta as (
    select x.*, w.planilla as planilla_ficha,
           case when x.periodo < public.planilla_ajuste_desde() then 'ANTES'
                when x.trabajador_id is null then 'SIN_FICHA'
                when w.planilla = 'ADMINISTRATIVA' then 'OFICINA'
                when coalesce(h.horas, 0) > 0 then 'HORAS'
                when coalesce(r.horas, 0) > 0 then 'SIN_COSTO'
                else 'SIN_HORAS' end as como,
           coalesce(h.horas, r.horas, 0) as horas, coalesce(h.costo, 0) as costo_horas, coalesce(c.recargo, 0) as recargo,
           coalesce(h.codigos, r.codigos, 0) as codigos,
           exists (select 1 from mes m where m.periodo = x.periodo) as mes_con_horas
      from persona x
      left join public.trabajadores w on w.id = x.trabajador_id
      left join hora h on h.trabajador_id = x.trabajador_id and h.periodo = x.periodo
      left join reporte r on r.trabajador_id = x.trabajador_id and r.periodo = x.periodo
      left join recargo c on c.trabajador_id = x.trabajador_id and c.periodo = x.periodo
  )
  select c.planilla_id, c.periodo, c.persona_id, c.nombre, c.trabajador_id, c.como, c.costo, c.horas, c.costo_horas, c.recargo,
         case c.como when 'ANTES' then 0
                     when 'OFICINA' then 0
                     when 'HORAS' then c.costo - c.costo_horas - c.recargo
                     when 'SIN_COSTO' then c.costo - c.recargo
                     else c.costo end,
         c.codigos::integer, c.mes_con_horas
    from cuenta c;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_planilla(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with persona as (
    select a.* from public.planilla_al_costo(null) a
     where a.como in ('HORAS', 'SIN_COSTO', 'SIN_FICHA', 'SIN_HORAS') and a.ajuste <> 0
  ), suya as (
    -- Las horas de cada persona en cada código: las del tareo y, sin costo
    -- mensual, las del reporte (las mismas que horas_por_codigo_del_mes).
    -- Sin las de los días que cubre un pago de la oficina, como planilla_al_costo.
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo,
           public.normalizar_codigo_interno(t.codigo_interno) as codigo, sum(t.horas) as horas
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select p.trabajador_id from persona p where p.como = 'HORAS')
       and not exists (select 1 from public.oficina_pagos op
                        where op.trabajador_id = t.trabajador_id and op.anulado_en is null
                          and t.fecha between op.desde and op.hasta
                          and not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = op.id))
     group by 1, 2, 3
    union all
    select l.trabajador_id, date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno), sum(l.horas)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and l.trabajador_id in (select p.trabajador_id from persona p where p.como = 'SIN_COSTO')
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
     group by 1, 2, 3
  ), parte as (
    select p.planilla_id, p.periodo, p.persona_id, s.codigo, p.ajuste * s.horas / p.horas as monto, false as de_todos
      from persona p
      join suya s on s.trabajador_id = p.trabajador_id and s.periodo = p.periodo
     where p.como in ('HORAS', 'SIN_COSTO') and s.codigo is not null
    union all
    select p.planilla_id, p.periodo, p.persona_id, m.codigo, p.ajuste * m.horas / m.total, true
      from persona p
      join public.horas_por_codigo_del_mes(null) m on m.periodo = p.periodo
     where p.como in ('SIN_FICHA', 'SIN_HORAS')
  )
  select x.codigo, 'MANO_OBRA'::text, x.periodo,
         ('Ajuste de la planilla de taller ' || to_char(x.periodo, 'MM/YYYY'))::text,
         -- El mes en curso todavía recibe horas, como los gastos del mes: su parte es provisional.
         (case when x.periodo >= date_trunc('month', now() at time zone 'America/Lima')::date
               then 'Por ahora: el mes no termina. ' else '' end
          || case when bool_and(x.de_todos)
               then 'Costo real (bruto más EsSalud) de quien no cargó horas propias ese mes, repartido por las horas de todos'
               when bool_or(x.de_todos)
               then 'Costo real (bruto más EsSalud) menos lo que ya entró por horas y por el recargo de las extras, repartido por las horas de cada persona; quien no cargó horas propias, por las de todos'
               else 'Costo real (bruto más EsSalud) menos lo que ya entró por horas y por el recargo de las extras, repartido por las horas de cada persona' end)::text,
         count(distinct x.persona_id)::numeric,
         case when count(distinct x.persona_id) = 1 then 'persona' else 'personas' end::text,
         null::numeric, null::numeric, 'PEN'::text, round(sum(x.monto), 2), 0, null::text, x.planilla_id
    from parte x
   where public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo)
   group by x.codigo, x.periodo, x.planilla_id
  having round(sum(x.monto), 2) <> 0;
end;
$function$;

revoke all on function public.planilla_al_costo(uuid) from public, anon, authenticated;
revoke all on function public.codigo_interno_lineas_planilla(text) from public, anon, authenticated;

comment on function public.sueldos_oficina_del_mes(date) is
  'El sueldo de la oficina de cada mes (o del mes de p_periodo): la parte, por días, de cada pago de oficina_pagos que cae en el mes (con aportes), menos lo que esa persona cargó en horas, a cualquier código (una unidad, PLANTA, OFICINA o TODOS LOS ACTIVOS), en los días que ese pago cubre (20261128110000); y cuántas personas de planilla administrativa tienen días trabajados del mes, desde inicio_registro_pagos_oficina(persona) y hasta hoy, sin pago. No pide permiso: la llaman el costeo y gastos_del_mes_oficina.';
comment on function public.gastos_del_mes_oficina(date) is
  'El sueldo de la oficina del mes de p_periodo que se reparte entre las unidades, sumado (de los pagos registrados, sin lo que esa gente ya cargó en horas a cualquier código), y a cuántas personas les faltan días pagados. Exige costos.ver, costos.gastos_generales o codigos_internos.ver.';
