-- =============================================================================
-- CADA CÓDIGO INTERNO CON SU PORCENTAJE DE AVANCE
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-15) que en «Códigos internos» cada código tenga su
-- porcentaje de avance y que no haya desfases. Hasta hoy la lista solo daba un
-- porcentaje si algún supervisor había subido un reporte diario del código, y
-- ese porcentaje era el promedio del último avance de cada trabajo, juntando
-- todas las áreas. Eso decía cosas que no eran:
--
--   * Maestranza termina el corte y el habilitado (100 %) y la unidad sale al
--     100 %, aunque Producción y Acabados no empezaron y el Control de etapas
--     de Diseño dice «1 de 6 terminadas».
--   * Un trabajo que dos áreas llaman igual («Soldadura» en Maestranza y en
--     Producción) contaba como uno solo: el último reporte pisaba al otro.
--   * Sin reporte diario no había porcentaje, aunque Diseño ya hubiera marcado
--     etapas terminadas.
--
-- Desde ahora el avance del código sale del CONTROL DE ETAPAS que arma Diseño
-- (migración 20261015200000), la misma hoja «Control de plazos» de la empresa:
--
--   * Cada etapa pesa lo mismo.
--   * La etapa TERMINADA (Diseño o el supervisor del área marcó su fin) vale 100.
--   * La que no terminó vale lo que su área reporta del código en el reporte
--     diario: el promedio del último avance de cada trabajo de esa área, el
--     mismo número que Gerencia ve en la pestaña «Etapas». Sin reporte, 0.
--   * El avance del código es el promedio de sus etapas, en entero.
--
-- Si Diseño todavía no armó las etapas del código, el avance sale de los
-- reportes diarios, trabajo por trabajo y área por área. Si no hay ni etapas ni
-- reportes, el código no aparece aquí y la pantalla lo muestra en 0 % diciendo
-- por qué. PLANTA no es una unidad: no tiene avance.
--
-- El resumen de la lista (`codigos_internos_resumen`) sigue igual: su avance
-- medio ya no lo lee ninguna pantalla. Lee esta función, solo Gerencia.
-- Solo agrega una función: no cambia ni quita nada de lo que ya está.
-- =============================================================================

create or replace function public.codigos_internos_avance(p_codigo text default null)
returns table (codigo text, avance integer, fuente text, etapas integer, etapas_terminadas integer,
               trabajos integer, trabajos_terminados integer, ultimo_reporte date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with etapa as (
    -- Las mismas filas que la pestaña «Etapas»: la regla no se repite en otro lado.
    select e.codigo,
           count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           avg(case when e.fin_real is not null then 100 else coalesce(e.avance_reportado, 0) end) as avance
      from public.codigo_interno_etapas(v_codigo) e
     group by e.codigo
  ), fila as (
    -- Las mismas filas que la pestaña «Avance»: los reportes vigentes.
    select * from public.codigo_interno_avance(v_codigo)
  ), ultimo as (
    -- El último avance de cada trabajo, área por área: «Soldadura» de Maestranza
    -- y «Soldadura» de Producción son dos trabajos.
    select distinct on (f.codigo, f.area, lower(regexp_replace(btrim(f.trabajo), '\s+', ' ', 'g'))) f.codigo, f.avance
      from fila f
     order by f.codigo, f.area, lower(regexp_replace(btrim(f.trabajo), '\s+', ' ', 'g')), f.fecha desc, f.creado_en desc,
              f.trabajo_orden
  ), trabajo as (
    select u.codigo, count(*)::integer as trabajos, count(*) filter (where u.avance = 100)::integer as terminados,
           avg(u.avance) as avance
      from ultimo u
     group by u.codigo
  ), reporte as (
    select f.codigo, max(f.fecha) as ultimo from fila f group by f.codigo
  )
  select coalesce(e.codigo, t.codigo),
         round(coalesce(e.avance, t.avance))::integer,
         case when e.codigo is not null then 'ETAPAS' else 'REPORTES' end,
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0),
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), r.ultimo
    from etapa e
    full join trabajo t on t.codigo = e.codigo
    left join reporte r on r.codigo = coalesce(e.codigo, t.codigo)
   where coalesce(e.codigo, t.codigo) is not null and coalesce(e.codigo, t.codigo) <> 'PLANTA'
   order by 1;
end;
$$;
comment on function public.codigos_internos_avance(text) is
  'El porcentaje de avance de cada código interno (o de uno): el promedio de sus etapas de Diseño, donde la terminada vale 100 y la que no, lo que su área reporta en el reporte diario (0 sin reporte). Sin etapas, el promedio del último avance de cada trabajo de los reportes diarios, área por área. Sin PLANTA. Exige codigos_internos.ver.';
revoke all on function public.codigos_internos_avance(text) from public, anon;
grant execute on function public.codigos_internos_avance(text) to authenticated;
