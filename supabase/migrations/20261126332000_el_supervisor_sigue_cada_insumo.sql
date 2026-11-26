-- =============================================================================
-- EL SUPERVISOR SIGUE CADA INSUMO DE SU REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- El supervisor pide el material de cada unidad desde «RQ por unidad» y después
-- no sabe por dónde va cada insumo sin preguntar a Almacén o a Logística: si
-- Diseño lo autorizó, si ya va en una compra, cuándo llega, quién se lo llevó
-- del almacén (Plan 1, Supervisión, entrega 1.2, 2026-11-26).
--
-- La etapa de cada insumo ya la da `avance_de_requerimientos` (por revisar, en
-- compra, en camino, en almacén, entregado). Faltaban la fecha y quién lo
-- recibió, que viven en la compra y en el kardex, tablas que el supervisor no
-- lee; y el visto de Diseño, que ya da `metrado_de_requerimientos`, va aquí
-- también para leer todo de una vez:
--
--   visto_diseno    si lo que pide se pasa del metrado de Diseño, en qué va su
--                   visto: SIN_SUSTENTO, POR_AUTORIZAR, AUTORIZADO o RECHAZADO
--                   (`metrado_por_linea`). Vacío si entra en el metrado, si no
--                   aplica o si Almacén ya lo revisó en regla: no espera a nadie.
--   fecha_esperada  la fecha en que Logística espera la compra
--                   (`ordenes_compra_materiales.fecha_estimada`), solo de la OC
--                   vigente del insumo. De la compra no sale nada más: ni el
--                   proveedor ni el precio (decisión de DKS en el plan).
--   recibido_por    el nombre que Almacén escribió al entregarlo
--   recibido_en     (`movimientos_materiales.recibido_por_nombre` de las
--                   salidas de ese insumo), y cuándo fue la última. La salida
--                   que se devolvió entera no cuenta: nadie se lo quedó.
--
-- Quién la lee: solo el RQ de su área. Con `requerimientos.area`, los RQ del
-- área de su cuenta; con `requerimientos.administracion`, los de tipo
-- ADMINISTRACION, aunque su cuenta no tenga área (lo pidió el Plan 8 para el
-- RQA, para no cambiarle la forma después). Lo demás no sale, aunque se pida
-- por id. Es `security definer` porque lee la compra y el kardex, que el
-- supervisor no lee: por eso el alcance lo pone ella. El check 474 lo prueba
-- con cada puesto.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

create or replace function public.seguimiento_de_insumos(p_ids uuid[])
returns table (
  requerimiento_id uuid,
  item             integer,
  visto_diseno     text,
  fecha_esperada   date,
  recibido_por     text,
  recibido_en      timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_admin  constant boolean := public.es_admin();
  v_area   constant boolean := public.tiene_permiso('requerimientos.area');
  v_rqa    constant boolean := public.tiene_permiso('requerimientos.administracion');
  v_mi_area constant uuid   := (select u.area_id from public.usuarios u where u.id = public.usuario_actual());
begin
  if not (v_admin or v_area or v_rqa) then
    raise exception 'No tienes permiso para seguir los insumos de un requerimiento.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el seguimiento de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with rq as (
    select r.id
      from public.requerimientos r
     where r.id = any(p_ids)
       and (v_admin
            or (v_area and v_mi_area is not null and r.area_id = v_mi_area)
            or (v_rqa and r.tipo = 'ADMINISTRACION'))
  ),
  visto as (
    select m.linea_id, m.estado
      from public.metrado_por_linea((select array_agg(id) from rq)) m
     where m.estado in ('SIN_SUSTENTO', 'POR_AUTORIZAR', 'AUTORIZADO', 'RECHAZADO')
  ),
  salidas as (
    select s.requerimiento_linea_id as linea_id,
           string_agg(distinct btrim(s.recibido_por_nombre), ', ') as quienes,
           max(s.registrado_en) as ultima
      from public.movimientos_materiales s
     where s.tipo = 'SALIDA'
       and s.requerimiento_linea_id in (select l.id from public.requerimiento_lineas l where l.requerimiento_id in (select id from rq))
       and nullif(btrim(s.recibido_por_nombre), '') is not null
       -- Lo devuelto vuelve como ingreso con `devolucion_de` (como en `entregado_de_requerimientos`).
       and s.cantidad > coalesce((select sum(d.cantidad) from public.movimientos_materiales d
                                   where d.devolucion_de = s.id and d.tipo = 'INGRESO'), 0)
     group by s.requerimiento_linea_id
  )
  select l.requerimiento_id,
         l.item::integer,
         v.estado,
         case when c.aprobacion is distinct from 'RECHAZADA' and c.aprobacion is distinct from 'ANULADA' then c.fecha_estimada end,
         s.quienes,
         s.ultima
    from public.requerimiento_lineas l
    join rq on rq.id = l.requerimiento_id
    left join visto v on v.linea_id = l.id
    left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
    left join salidas s on s.linea_id = l.id;
end;
$$;

comment on function public.seguimiento_de_insumos(uuid[]) is
  'Lo que el supervisor no lee de cada insumo de sus RQ: el visto de Diseño si se pasa del metrado, la fecha en que se espera su compra (solo la fecha: ni proveedor ni precio) y quién lo recibió del almacén y cuándo. Solo los RQ del área de quien llama (requerimientos.area) y los de tipo ADMINISTRACION para quien tiene requerimientos.administracion.';

revoke all on function public.seguimiento_de_insumos(uuid[]) from public, anon;
grant execute on function public.seguimiento_de_insumos(uuid[]) to authenticated;
