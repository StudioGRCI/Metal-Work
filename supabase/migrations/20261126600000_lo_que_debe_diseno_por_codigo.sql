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
-- Y la fecha comprometida del plano contra la real, por área (Maestranza y
-- Producción). La fecha comprometida no cambia de dueño (decisión del plan):
-- sigue siendo la que Diseño pone a su etapa de esa área —el día en que el
-- área empieza, y para empezar necesita sus planos—, y la real es cuando subió
-- el primer plano de esa área. Aquí nadie escribe ninguna fecha.
--
-- La lista la ven Diseño y, en lectura, Supervisión y Administración (decisión
-- del plan), con el mismo permiso que ya deja ver las etapas de cada código
-- (`puede_ver_codigos_de_diseno`). Devuelve solo si cada punto está y cuándo:
-- ni el contenido de los planos, ni los DXF, ni importes.
--
-- Idempotente. Sin DROP.
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
  comprometido      date,
  entregado_en      timestamptz,
  situacion         text,
  dias              integer
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
begin
  if not public.puede_ver_codigos_de_diseno() then
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
    select e.codigo_interno as codigo, e.area_id, e.inicio_plan, e.creado_en
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
  -- Por área de Maestranza y Producción: la fecha que Diseño comprometió (el
  -- primer inicio de su etapa ahí) y cuándo subió el primer plano de esa área.
  area as (
    select pe.codigo, a.codigo as area, a.nombre as area_nombre, a.orden_secuencia,
           (select min(et.inicio_plan) from etapa et where et.codigo = pe.codigo and et.area_id = a.id) as comprometido,
           (select min(pl.subido_en) from plano pl where pl.codigo = pe.codigo and pl.area_id = a.id) as entregado_en,
           exists (select 1 from etapa et where et.codigo = pe.codigo and et.area_id = a.id)
             or exists (select 1 from plano pl where pl.codigo = pe.codigo and pl.area_id = a.id) as aplica
      from pedido pe
      cross join public.areas a
     where a.codigo in ('MTZ', 'PRD')
  )
  select pe.codigo,
         coalesce(o.tiene_ot, false),
         o.ficha_en,
         coalesce(pl.n, 0), pl.en,
         coalesce(m.n, 0), m.en,
         coalesce(et.n, 0), et.en,
         coalesce(x.n, 0), x.en,
         ar.area, ar.area_nombre, ar.comprometido, ar.entregado_en,
         case
           when ar.area is null then null
           when ar.comprometido is null then case when ar.entregado_en is null then 'SIN_FECHA' else 'ENTREGADO_SIN_FECHA' end
           when ar.entregado_en is not null then
             case when (ar.entregado_en at time zone 'America/Lima')::date <= ar.comprometido then 'A_TIEMPO' else 'TARDE' end
           when ar.comprometido < v_hoy then 'VENCIDO'
           else 'PENDIENTE'
         end,
         case
           when ar.area is null or ar.comprometido is null then null
           when ar.entregado_en is not null then greatest((ar.entregado_en at time zone 'America/Lima')::date - ar.comprometido, 0)
           when ar.comprometido < v_hoy then v_hoy - ar.comprometido
           else ar.comprometido - v_hoy
         end
    from pedido pe
    left join orden o on o.codigo = pe.codigo
    left join planos pl on pl.codigo = pe.codigo
    left join material m on m.codigo = pe.codigo
    left join etapas et on et.codigo = pe.codigo
    left join dxf x on x.codigo = pe.codigo
    -- Una fila por área que aplica; sin ninguna, una sola fila con el área vacía.
    left join lateral (
      select a2.area, a2.area_nombre, a2.comprometido, a2.entregado_en, a2.orden_secuencia
        from area a2 where a2.codigo = pe.codigo and a2.aplica
      union all
      select null, null, null, null, null
       where not exists (select 1 from area a3 where a3.codigo = pe.codigo and a3.aplica)
    ) ar on true
   order by pe.codigo, ar.orden_secuencia nulls first;
end;
$$;

comment on function public.lo_que_debe_diseno(text[]) is
  'Lo que Diseño entrega por código interno, punto por punto (ficha técnica de la OT, planos, materiales, etapas de Diseño y DXF): cuántos hay y desde cuándo. Y por área (Maestranza, Producción), la fecha comprometida del plano —el primer inicio de la etapa de Diseño en esa área— contra la subida del primer plano, con su situación (A_TIEMPO, TARDE, PENDIENTE, VENCIDO, SIN_FECHA, ENTREGADO_SIN_FECHA) y los días de atraso o los que faltan, por fecha de Lima. Una fila por área que aplica; sin ninguna, una fila con el área vacía. La leen quienes ven los códigos de Diseño (puede_ver_codigos_de_diseno). Sin contenido de planos ni DXF ni importes.';

revoke all on function public.lo_que_debe_diseno(text[]) from public, anon;
grant execute on function public.lo_que_debe_diseno(text[]) to authenticated;
