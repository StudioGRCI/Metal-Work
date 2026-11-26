-- =============================================================================
-- CADA COMPRA CONTRA SU FECHA
-- -----------------------------------------------------------------------------
-- Logística emite la OC con la fecha en que el proveedor prometió entregar
-- (`fecha_estimada`, la «Entrega estimada» del formulario y del PDF) y la OS con
-- la fecha en que el trabajo debe volver (`fecha_fin`). Hasta hoy esas fechas se
-- guardaban y nadie las comparaba con lo que de verdad pasó: la OC atrasada se
-- veía igual que la que llegó a tiempo, y la que llegó a medias no decía qué
-- faltaba (Plan 4. Logística, entrega 4.1).
--
-- Esta migración no guarda nada nuevo: cruza la fecha prometida con la llegada
-- que ya se anota.
--
--   · La OC llega cuando el conductor la deja en el almacén
--     (`entregado_almacen_en`) y queda completa cuando de cada línea ya entró lo
--     pedido, con la misma cuenta que usa Almacén al validar
--     (`cuenta_de_la_linea_de_compra`): lo pedido menos lo que entró neto y menos
--     lo devuelto que ya no se repone. Lo devuelto que el proveedor repone
--     todavía falta. Su fecha real es la del último ingreso que la completó.
--   · La OS vuelve cuando Logística la marca conforme (`conformidad_en`).
--   · Los días de atraso se cuentan por fecha de Lima: de la completa, lo que
--     pasó de la fecha prometida a la real; de la abierta, de la prometida a hoy.
--     La rechazada y la anulada no se atrasan.
--   · Atrasada es la vigente, con fecha prometida ya pasada, que todavía no
--     llegó completa. La que llegó tarde no está atrasada: llegó con atraso.
--
-- Quién las lee: quien ya lee el listado de OC y el de OS, con el mismo alcance
-- fila por fila. Son `security definer` porque leen los movimientos del almacén,
-- que Logística no lee directo; sin importes.
--
-- Idempotente: solo `create or replace` de funciones nuevas.
-- =============================================================================

-- =============================================================================
-- 1. LA FECHA DE LIMA DE UNA HORA
-- =============================================================================
create or replace function public.fecha_de_lima(p_en timestamptz)
returns date
language sql
immutable
set search_path to 'public'
as $$
  select (p_en at time zone 'America/Lima')::date;
$$;

comment on function public.fecha_de_lima(timestamptz) is
  'La fecha del taller (Lima) de esa hora. La hora del servidor es UTC: de 7 p. m. a medianoche de Lima allá ya es mañana.';

revoke all on function public.fecha_de_lima(timestamptz) from public, anon;
grant execute on function public.fecha_de_lima(timestamptz) to authenticated;

-- =============================================================================
-- 2. EL PLAZO DE CADA ORDEN DE COMPRA
-- =============================================================================
create or replace function public.plazos_de_compras(p_ids uuid[])
returns table (
  documento   uuid,
  esperada    date,
  llego_en    timestamptz,
  completa_en timestamptz,
  dias_atraso integer,
  atrasada    boolean,
  por_llegar  jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_hoy constant date := public.fecha_de_lima(now());
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el plazo de hasta 500 órdenes de compra a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with oc as (
    select c.id, c.fecha_estimada, c.entregado_almacen_en, c.creado_en,
           c.aprobacion not in ('RECHAZADA', 'ANULADA') as vigente
      from public.ordenes_compra_materiales c
     where c.id = any(p_ids)
       -- El mismo alcance que el listado de OC: Logística todas; quien solo
       -- consulta, las directas y las de las áreas que le tocan.
       and (public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('tesoreria.ver_documentos')
            or c.requerimiento_id is null
            or exists (select 1 from public.requerimientos_materiales r
                        where r.id = c.requerimiento_id and public.puede_ver_area_material(r.area_destino)))
  ),
  -- Lo que a cada línea le falta llegar: lo pedido menos lo que entró neto y
  -- menos lo devuelto que ya no se repone (eso no viene más por esta OC).
  lineas as (
    select d.orden_compra_id as oc, d.id, d.cantidad,
           greatest(d.cantidad - k.sin_reponer - k.neto, 0) as falta,
           coalesce(d.material_id, om.material_id) as material_id
      from public.orden_compra_material_detalles d
      left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
      left join public.ot_materiales om on om.id = rd.ot_material_id
     cross join lateral public.cuenta_de_la_linea_de_compra(d.id) k
     where d.orden_compra_id = any(p_ids)
  ),
  cuenta as (
    select l.oc,
           count(*) as n,
           count(*) filter (where l.falta > 0) as con_falta,
           (select max(m.registrado_en) from public.movimientos_materiales m
             where m.tipo = 'INGRESO' and m.orden_compra_detalle_id in (select x.id from lineas x where x.oc = l.oc)) as ultimo_ingreso
      from lineas l
     group by l.oc
  ),
  -- La OC de antes del conductor la marcaba entregada Logística, sin ingreso por
  -- línea: con su entrega marcada y sin nada en el almacén, se da por completa.
  antigua as (
    select o.id as oc
      from oc o
     where o.entregado_almacen_en is not null
       and not exists (select 1 from public.ingresos_pendientes_almacen ip where ip.orden_compra_id = o.id)
       and not exists (select 1 from public.movimientos_materiales m
                         join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
                        where d.orden_compra_id = o.id and m.tipo = 'INGRESO')
  ),
  estado as (
    select o.id, o.fecha_estimada as esperada, o.entregado_almacen_en as llego_en, o.vigente,
           case
             when a.oc is not null then o.entregado_almacen_en
             when o.entregado_almacen_en is not null and coalesce(c.con_falta, 0) = 0
               then greatest(o.entregado_almacen_en, c.ultimo_ingreso)
           end as completa_en
      from oc o
      left join cuenta c on c.oc = o.id
      left join antigua a on a.oc = o.id
  )
  select e.id, e.esperada, e.llego_en, e.completa_en,
         case
           when e.esperada is null then null
           when e.completa_en is not null then greatest(public.fecha_de_lima(e.completa_en) - e.esperada, 0)
           when e.vigente then greatest(v_hoy - e.esperada, 0)
         end::integer,
         (e.vigente and e.completa_en is null and e.esperada is not null and e.esperada < v_hoy),
         -- Lo que falta, solo de la que llegó a medias: antes de llegar falta todo.
         case when e.llego_en is not null and e.completa_en is null then (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'material', coalesce(mat.descripcion, 'Material sin catálogo'),
                    'unidad', um.codigo,
                    'pedido', l.cantidad,
                    'falta', l.falta) order by mat.descripcion), '[]'::jsonb)
             from lineas l
             left join public.materiales mat on mat.id = l.material_id
             left join public.unidades_medida um on um.id = mat.unidad_medida_id
            where l.oc = e.id and l.falta > 0)
         end
    from estado e;
end;
$$;

comment on function public.plazos_de_compras(uuid[]) is
  'De cada OC: la fecha que prometió el proveedor, cuándo llegó al almacén y cuándo quedó completa, los días de atraso por fecha de Lima, si está atrasada (vigente, vencida y sin llegar completa) y, de la que llegó a medias, lo que falta por material. Lo lee quien lee el listado de OC, con el mismo alcance. Sin importes.';

revoke all on function public.plazos_de_compras(uuid[]) from public, anon;
grant execute on function public.plazos_de_compras(uuid[]) to authenticated;

-- =============================================================================
-- 3. EL PLAZO DE CADA ORDEN DE SERVICIO
-- =============================================================================
create or replace function public.plazos_de_servicios(p_ids uuid[])
returns table (
  documento   uuid,
  esperada    date,
  completa_en timestamptz,
  dias_atraso integer,
  atrasada    boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_hoy constant date := public.fecha_de_lima(now());
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('compras.detraccion')
          or public.tiene_permiso('tesoreria.ver_documentos') or public.es_aprobador_compras()) then
    raise exception 'No tienes permiso para ver las órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el plazo de hasta 500 órdenes de servicio a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with os as (
    select s.id, s.fecha_fin as esperada,
           case when s.estado = 'CONFORME' then s.conformidad_en end as completa_en,
           s.estado in ('EMITIDA', 'EN_EJECUCION') and s.aprobacion <> 'RECHAZADA' as abierta
      from public.ordenes_servicio s
     where s.id = any(p_ids)
  )
  select o.id, o.esperada, o.completa_en,
         case
           when o.esperada is null then null
           when o.completa_en is not null then greatest(public.fecha_de_lima(o.completa_en) - o.esperada, 0)
           when o.abierta then greatest(v_hoy - o.esperada, 0)
         end::integer,
         (o.abierta and o.esperada is not null and o.esperada < v_hoy)
    from os o;
end;
$$;

comment on function public.plazos_de_servicios(uuid[]) is
  'De cada OS: la fecha en que el trabajo debía volver (fecha_fin), cuándo volvió conforme, los días de atraso por fecha de Lima y si está atrasada (emitida o en ejecución, no rechazada, con la fecha ya pasada). Lo lee quien lee el listado de OS. Sin importes.';

revoke all on function public.plazos_de_servicios(uuid[]) from public, anon;
grant execute on function public.plazos_de_servicios(uuid[]) to authenticated;
