-- =============================================================================
-- EL DÍA ENTERO EN UNA PANTALLA
-- -----------------------------------------------------------------------------
-- El jefe de producción recibe el avance diario de las tres áreas, y hasta hoy
-- solo podía leerlo orden por orden: entrar a la OT, abrir la pestaña, mirar el
-- diario, salir, entrar a la siguiente. Con dos unidades se aguanta; con las
-- que caben en el taller, no.
--
-- Lo que le hace falta es la jornada completa de un vistazo: qué reportó cada
-- área hoy, sobre qué orden, en cuánto quedó cada actividad —el acumulado, que
-- es lo que pregunta después de «¿cuánto avanzaste?»— y, sobre todo, **quién no
-- reportó**, que es la mitad que ninguna lista de reportes enseña.
--
-- Dos vistas, y ninguna trae al cliente: el taller no tiene `clientes.ver` y un
-- join a esa tabla le escondería la fila entera. Ya pasó una vez —la orden
-- respondía 404 al supervisor— y no se repite.
-- =============================================================================

-- =============================================================================
-- 1. LO QUE SE REPORTÓ, CON SU DÍA Y SU DUEÑO
-- =============================================================================
create or replace view public.v_ot_avance_diario as
select
  av.id,
  av.fecha,
  av.avance_pct,
  av.nota,
  av.creado_en,
  a.id                as actividad_id,
  a.nombre            as actividad,
  a.referencia,
  a.peso_pct,
  ar.id               as area_id,
  ar.codigo           as area_codigo,
  ar.nombre           as area,
  o.id                as orden_id,
  o.numero            as orden_numero,
  o.estado::text      as orden_estado,
  o.descripcion       as orden_descripcion,
  av.reportado_por,
  nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
                      as reportado_por_nombre,
  -- En cuánto quedó la actividad contando este reporte. El diario es
  -- incremental —«hoy avancé 15 %»— y el acumulado lo suma el sistema.
  (select sum(x.avance_pct)
     from public.ot_actividad_avances x
    where x.actividad_id = a.id)  as acumulado_pct
from public.ot_actividad_avances av
join public.ot_actividades   a  on a.id = av.actividad_id
join public.areas            ar on ar.id = a.area_id
join public.ordenes_trabajo  o  on o.id = a.orden_id
left join public.usuarios    u  on u.id = av.reportado_por;

comment on view public.v_ot_avance_diario is
  'El parte de la jornada: cada avance reportado con su área, su orden, quién lo escribió y en cuánto quedó la actividad.';

alter view public.v_ot_avance_diario set (security_invoker = on);
grant select on public.v_ot_avance_diario to authenticated;

-- =============================================================================
-- 2. LA HOJA DE CADA ÁREA, CON EL NÚMERO DE SU ORDEN
-- -----------------------------------------------------------------------------
-- La vista ya existía (migración 090) y le faltaban dos datos para servir fuera
-- del detalle de la orden: de qué orden es la hoja y cómo está esa orden. Sin
-- eso, «Maestranza no reportó hoy» no dice en qué unidad.
--
-- Las columnas nuevas van al final, que es lo único que `create or replace`
-- admite, y el `select` explícito de la pantalla que ya la usa no se entera.
-- =============================================================================
create or replace view public.v_ot_avance_areas as
select
  v.orden_id,
  v.area_id,
  v.area_codigo,
  v.area,
  count(*)                                   as actividades,
  count(*) filter (where v.terminada)        as terminadas,
  sum(v.peso_pct)                            as peso_repartido,
  case
    when sum(v.peso_pct) = 0 then 0
    else round(sum(v.peso_pct * v.avance_pct) / sum(v.peso_pct), 1)
  end                                        as avance_pct,
  max(v.ultimo_reporte)                      as ultimo_reporte,
  o.numero                                   as orden_numero,
  o.estado::text                             as orden_estado
from public.v_ot_actividades v
join public.ordenes_trabajo o on o.id = v.orden_id
group by v.orden_id, v.area_id, v.area_codigo, v.area, o.numero, o.estado;

comment on view public.v_ot_avance_areas is
  'Cuánto lleva cada área de lo suyo en una orden. Cada área tiene su propio 100 %: no se suman entre ellas.';

alter view public.v_ot_avance_areas set (security_invoker = on);
grant select on public.v_ot_avance_areas to authenticated;

-- =============================================================================
-- 3. COMPROBACIÓN
-- -----------------------------------------------------------------------------
-- Una vista sin `security_invoker` corre como su dueño y enseña las filas que el
-- RLS de las tablas escondía. Es la puerta que se abre sin querer.
-- =============================================================================
do $$
declare v_abiertas text;
begin
  select string_agg(c.relname, ', ') into v_abiertas
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
     and c.relname in ('v_ot_avance_diario', 'v_ot_avance_areas')
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%';

  if v_abiertas is not null then
    raise exception 'Estas vistas corren como su dueño y se saltan el RLS: %', v_abiertas;
  end if;
end $$;
