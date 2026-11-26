-- =============================================================================
-- LO QUE DISEÑO LE DEBE AL TALLER, POR CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- Plan 6 (Diseño e Ingeniería), entrega 6.1. Hasta hoy, quien abría un código
-- veía cuántos planos, materiales y etapas tenía, o «Diseño todavía no cargó
-- planos ni etapas», sin saber qué faltaba. El taller pregunta otra cosa: de lo
-- que Diseño entrega por cada unidad, ¿qué ya está y qué no? Son cinco puntos:
--
--   1. La ficha técnica del camión o tracto, adjunta a la OT (FICHA_VEHICULO).
--   2. Los planos (al menos uno vigente).
--   3. La lista de materiales (el metrado).
--   4. Las etapas de Diseño (el par Habilitado y Ensamblaje).
--   5. Los DXF para el corte.
--
-- Las etapas cuentan como entregadas solo con las dos: Habilitado en
-- Maestranza y Ensamblaje en Producción. Con una sola, falta la otra.
--
-- Y la fecha comprometida del plano contra la real, por área (Maestranza y
-- Producción). La fecha comprometida no cambia de dueño (decisión del plan):
-- sale de la etapa que Diseño pone en esa área. El plano no tiene fecha propia,
-- y el área lo necesita para empezar: la fecha es el primer inicio de esa etapa
-- (la pantalla dice «lo necesita el …, cuando empieza Habilitado»; la que el
-- formulario de etapas llama «Comprometida» es el fin, cuando la etapa termina).
-- La real es cuando subió el primer plano vigente de esa área. Límite: el plano
-- no dice de qué juego es, así que con varios juegos (Chasis, Furgón) se mide
-- el primero; el plano del juego siguiente no sale vencido. Aquí nadie escribe
-- ninguna fecha. «Por vencer» es lo mismo que en las etapas: hasta tres días
-- hábiles (`limite_por_vencer`).
--
-- La lista la ven Diseño y, en lectura, Supervisión y Administración (decisión
-- del plan): Diseño (`diseno.codigos`), Gerencia y Administración
-- (`codigos_internos.ver`), el supervisor de cada área
-- (`codigos_internos.area`) y Supervisión general con el Gerente de producción
-- (`codigos_internos.seguimiento`). Almacén tiene ese mismo permiso de
-- seguimiento y no la ve: no la pidió el plan, y por RLS no lee la OT, la
-- ficha ni los DXF que esta lista cuenta. Devuelve solo si cada punto está y
-- cuándo: ni el contenido de los planos, ni los DXF, ni importes.
--
-- Es `security definer` aunque solo lee, y cruza a sabiendas dos límites del
-- RLS: el supervisor de un área ve aquí que el plano de la otra área está y
-- cuándo subió (por RLS solo lee los de la suya), y Administración ve cuántos
-- DXF hay (por RLS no lee `codigo_dxf`). Son cantidades y fechas, nunca el
-- archivo, y es lo que el plan pidió que vieran en lectura.
--
-- Idempotente. Sin DROP: en producción la función no existía.
-- =============================================================================

create or replace function public.lo_que_debe_diseno(p_codigos text[])
returns table (
  codigo            text,
  tiene_ot          boolean,
  ficha_en          timestamptz,
  planos            integer,
  planos_en         timestamptz,
  materiales        integer,
  materiales_en     timestamptz,
  etapas            integer,
  etapas_en         timestamptz,
  dxf               integer,
  dxf_en            timestamptz,
  area              text,
  area_nombre       text,
  tiene_etapa       boolean,
  etapa             text,
  comprometido      date,
  entregado_en      timestamptz,
  situacion         text,
  dias              integer,
  por_vencer        boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
rows 100
as $$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_por_vencer date := public.limite_por_vencer();
begin
  if not (public.es_admin()
          or public.tiene_permiso('diseno.codigos')
          or public.tiene_permiso('codigos_internos.ver')
          or public.tiene_permiso('codigos_internos.area')
          or (public.tiene_permiso('codigos_internos.seguimiento') and public.mi_rol() is distinct from 'ALMACENERO')) then
    raise exception 'No tienes permiso para ver lo que Diseño lleva en cada código.' using errcode = 'insufficient_privilege';
  end if;
  if p_codigos is null or cardinality(p_codigos) = 0 then
    return;
  end if;
  if cardinality(p_codigos) > 3000 then
    raise exception 'Pide lo de hasta 3000 códigos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with pedido as (
    select distinct public.normalizar_codigo_interno(x) as codigo
      from unnest(p_codigos) as x
     where public.normalizar_codigo_interno(x) is not null
  ),
  -- La OT del código (no anulada) y su ficha técnica: la más antigua.
  orden as (
    select pe.codigo, true as tiene_ot,
           min(a.creado_en) filter (where a.tipo = 'FICHA_VEHICULO') as ficha_en
      from pedido pe
      join public.unidades u on public.normalizar_codigo_interno(u.codigo_interno) = pe.codigo
      join public.ordenes_trabajo o on o.unidad_id = u.id and o.estado <> 'ANULADA'
      left join public.ot_adjuntos a on a.orden_id = o.id and a.tipo = 'FICHA_VEHICULO'
     group by pe.codigo
  ),
  -- Cada plano vigente con su primera revisión: cuándo llegó al área.
  plano as (
    select p.codigo_interno as codigo, p.area_id, min(r.subido_en) as subido_en
      from public.codigo_planos p
      join public.codigo_plano_revisiones r on r.plano_id = p.id
     where p.anulado_en is null and p.codigo_interno in (select pe.codigo from pedido pe)
     group by p.codigo_interno, p.id, p.area_id
  ),
  planos as (
    select pl.codigo, count(*)::integer as n, min(pl.subido_en) as en from plano pl group by pl.codigo
  ),
  material as (
    select m.codigo_interno as codigo, count(*)::integer as n, min(m.creado_en) as en
      from public.codigo_materiales m
     where m.quitado_en is null and m.codigo_interno in (select pe.codigo from pedido pe)
     group by m.codigo_interno
  ),
  -- Las etapas de Diseño: las de arriba que no agregó un área.
  etapa as (
    select e.codigo_interno as codigo, e.area_id, e.inicio_plan, e.creado_en, e.nombre, e.orden
      from public.codigo_etapas e
     where e.quitada_en is null and e.padre_id is null and not e.de_area
       and e.codigo_interno in (select pe.codigo from pedido pe)
  ),
  etapas as (
    select et.codigo, count(*)::integer as n, min(et.creado_en) as en from etapa et group by et.codigo
  ),
  dxf as (
    select x.codigo_interno as codigo, count(*)::integer as n, min(x.subido_en) as en
      from public.codigo_dxf x
     where x.quitado_en is null and x.codigo_interno in (select pe.codigo from pedido pe)
     group by x.codigo_interno
  ),
  -- Por área de Maestranza y Producción: la etapa de Diseño que da la fecha (la
  -- que empieza primero), su inicio, y cuándo subió el primer plano de esa área.
  etapa_area as (
    select et.codigo, et.area_id, min(et.inicio_plan) as comprometido,
           (array_agg(et.nombre order by et.inicio_plan nulls last, et.orden, et.creado_en))[1] as etapa
      from etapa et group by et.codigo, et.area_id
  ),
  plano_area as (
    select pl.codigo, pl.area_id, min(pl.subido_en) as entregado_en from plano pl group by pl.codigo, pl.area_id
  ),
  area as (
    select pe.codigo, a.codigo as area, a.nombre as area_nombre, a.orden_secuencia,
           ea.area_id is not null as tiene_etapa, ea.etapa, ea.comprometido, pa.entregado_en
      from pedido pe
      cross join public.areas a
      left join etapa_area ea on ea.codigo = pe.codigo and ea.area_id = a.id
      left join plano_area pa on pa.codigo = pe.codigo and pa.area_id = a.id
     where a.codigo in ('MTZ', 'PRD')
  )
  select pe.codigo,
         coalesce(o.tiene_ot, false),
         o.ficha_en,
         coalesce(pl.n, 0), pl.en,
         coalesce(m.n, 0), m.en,
         coalesce(et.n, 0), et.en,
         coalesce(x.n, 0), x.en,
         ar.area, ar.area_nombre, ar.tiene_etapa, ar.etapa, ar.comprometido, ar.entregado_en,
         case
           when ar.comprometido is null then case when ar.entregado_en is null then 'SIN_FECHA' else 'ENTREGADO_SIN_FECHA' end
           when ar.entregado_en is not null then
             case when (ar.entregado_en at time zone 'America/Lima')::date <= ar.comprometido then 'A_TIEMPO' else 'TARDE' end
           when ar.comprometido < v_hoy then 'VENCIDO'
           else 'PENDIENTE'
         end,
         case
           when ar.comprometido is null then null
           when ar.entregado_en is not null then greatest((ar.entregado_en at time zone 'America/Lima')::date - ar.comprometido, 0)
           when ar.comprometido < v_hoy then v_hoy - ar.comprometido
           else ar.comprometido - v_hoy
         end,
         ar.entregado_en is null and ar.comprometido >= v_hoy and ar.comprometido <= v_por_vencer
    from pedido pe
    left join orden o on o.codigo = pe.codigo
    left join planos pl on pl.codigo = pe.codigo
    left join material m on m.codigo = pe.codigo
    left join etapas et on et.codigo = pe.codigo
    left join dxf x on x.codigo = pe.codigo
    -- Siempre dos filas: Maestranza y Producción, tengan o no su etapa.
    join area ar on ar.codigo = pe.codigo
   order by pe.codigo, ar.orden_secuencia;
end;
$$;

comment on function public.lo_que_debe_diseno(text[]) is
  'Lo que Diseño entrega por código interno, punto por punto (ficha técnica de la OT, planos, materiales, etapas de Diseño y DXF): cuántos hay y desde cuándo. Una fila por área (Maestranza y Producción, siempre las dos): si tiene su etapa de Diseño y cuál da la fecha, la fecha en que el área necesita el plano —el primer inicio de esa etapa— contra la subida del primer plano vigente, con su situación (A_TIEMPO, TARDE, PENDIENTE, VENCIDO, SIN_FECHA, ENTREGADO_SIN_FECHA), los días de atraso o los que faltan y si está por vencer, por fecha de Lima. Con varios juegos de planos mide el primero. La leen Diseño, Gerencia, Administración, los supervisores, Supervisión general y el Gerente de producción; Almacén no. Sin contenido de planos ni DXF ni importes.';

revoke all on function public.lo_que_debe_diseno(text[]) from public, anon;
grant execute on function public.lo_que_debe_diseno(text[]) to authenticated;
