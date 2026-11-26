-- =============================================================================
-- EL CUMPLIMIENTO DE CADA PROVEEDOR (Plan 4, entrega 4.3)
-- =============================================================================
-- Logística elige a quién comprarle mirando el padrón, y hasta hoy el padrón
-- no decía cómo le fue con cada uno. Pedido: «en la ficha del proveedor,
-- cuántas compras, cuántas a tiempo y cuántas devueltas, de solo lectura, para
-- quien ya ve el padrón. Sin importes para quien no los ve hoy».
--
-- Cómo se cuenta, para que nadie tenga que adivinarlo:
--   · Compras: las OC aprobadas (o que no pedían aprobación) y las OS aprobadas
--     que no se anularon. La que espera a Gerencia, la rechazada y la anulada
--     no cuentan: al proveedor todavía no se le pidió nada, o ya no.
--   · A tiempo, de las que ya llegaron: la OC llegó cuando se dejó en almacén
--     lo último que la completaba (la misma fecha de la entrega 4.1: lo que
--     Almacén tarda en validar no es del proveedor, y la reposición de algo
--     devuelto no mueve esa fecha); la OS, cuando volvió conforme. Se compara
--     con la fecha que el proveedor prometió AL EMITIRLA, no con la corregida
--     después (entrega 4.2): corregirla le dice a Logística cuándo llega, no
--     borra que llegó tarde. La que no tenía fecha prometida no se mide.
--   · Devueltas: las OC de las que Almacén le devolvió algo, se reponga o no.
-- Solo cuentas, sin un sol: nada de importes.
--
-- Para contar igual que la lista de OC, el cálculo del plazo de la 4.1 y la
-- 4.2 sale a una función interna sin permiso (`plazos_de_compras_calculados`)
-- y `plazos_de_compras` queda como su envoltorio con el permiso y el alcance
-- del listado: da lo mismo que antes, columna por columna. Si el cálculo
-- llamara a `plazos_de_compras`, el padrón pediría `compras.ver` y, peor, el
-- alcance por área de quien mira le cambiaría las cifras a cada proveedor.
-- Sin DROP: solo `create or replace` y funciones nuevas.

-- =============================================================================
-- 1. EL CÁLCULO DEL PLAZO DE CADA OC, SIN PERMISO
-- =============================================================================
create or replace function public.plazos_de_compras_calculados(p_ids uuid[])
returns table (
  documento     uuid,
  original      date,
  esperada      date,
  vigente       boolean,
  llego_en      timestamptz,
  llego_todo_en timestamptz,
  completa_en   timestamptz,
  por_llegar    jsonb,
  por_validar   boolean
)
language sql
stable
set search_path to 'public'
as $$
  with oc as (
    select c.id, c.fecha_estimada as original, public.fecha_prometida_de_compra(c.id, null) as fecha_estimada,
           c.entregado_almacen_en, c.aprobacion not in ('RECHAZADA', 'ANULADA') as vigente
      from public.ordenes_compra_materiales c
     where c.id = any(p_ids)
  ),
  -- Lo que a cada línea le falta llegar: lo pedido menos lo que entró neto,
  -- menos lo devuelto que ya no se repone y lo devuelto que espera reposición
  -- (eso ya llegó una vez: el plazo se mide hasta la primera vez que llegó todo).
  lineas as (
    select d.orden_compra_id as oc, d.id, d.cantidad,
           greatest(d.cantidad - k.sin_reponer - k.por_reponer - k.neto - coalesce(pv.cantidad, 0), 0) as falta,
           coalesce(pv.cantidad, 0) as por_validar,
           coalesce(d.material_id, om.material_id) as material_id
      from public.orden_compra_material_detalles d
      left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
      left join public.ot_materiales om on om.id = rd.ot_material_id
     cross join lateral public.cuenta_de_la_linea_de_compra(d.id) k
      left join lateral (select sum(ip.cantidad) as cantidad from public.ingresos_pendientes_almacen ip
                          where ip.orden_compra_detalle_id = d.id and ip.estado = 'PENDIENTE') pv on true
     where d.orden_compra_id = any(p_ids)
  ),
  cuenta as (
    select l.oc,
           count(*) filter (where l.falta > 0) as con_falta,
           count(*) filter (where l.por_validar > 0) as con_por_validar,
           (select max(ip.dejado_en) from public.ingresos_pendientes_almacen ip
             where ip.orden_compra_id = l.oc and ip.estado = 'PENDIENTE') as ultimo_por_validar,
           (select max(coalesce(ip.dejado_en, m.registrado_en)) from public.movimientos_materiales m
              left join public.ingresos_pendientes_almacen ip on ip.movimiento_id = m.id
             where m.tipo = 'INGRESO' and m.repone_devolucion is null
               and m.orden_compra_detalle_id in (select x.id from lineas x where x.oc = l.oc)) as ultimo_ingreso
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
    select o.id, o.original, o.fecha_estimada as esperada, o.vigente, o.entregado_almacen_en as llego_en,
           coalesce(c.con_por_validar, 0) > 0 as por_validar,
           case
             when a.oc is not null then o.entregado_almacen_en
             when o.entregado_almacen_en is not null and coalesce(c.con_falta, 0) = 0 and coalesce(c.con_por_validar, 0) = 0
               then greatest(o.entregado_almacen_en, c.ultimo_ingreso)
           end as completa_en,
           -- Ya llegó todo y falta que Almacén lo valide: la demora de Almacén no es
           -- del proveedor, así que el plazo se cuenta hasta que se dejó.
           case when o.entregado_almacen_en is not null and coalesce(c.con_falta, 0) = 0
                then greatest(o.entregado_almacen_en, c.ultimo_ingreso, c.ultimo_por_validar) end as llego_todo_en
      from oc o
      left join cuenta c on c.oc = o.id
      left join antigua a on a.oc = o.id
  )
  select e.id, e.original, e.esperada, e.vigente, e.llego_en, e.llego_todo_en, e.completa_en,
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
         end,
         e.por_validar
    from estado e;
$$;

comment on function public.plazos_de_compras_calculados(uuid[]) is
  'El cálculo del plazo de cada OC, sin permiso ni alcance: la fecha prometida al emitirla y la que vale hoy, cuándo llegó, cuándo llegó todo (aunque falte validar), cuándo quedó completa, lo que falta de la que llegó a medias y si hay ingresos por validar. Ayudante interno de plazos_de_compras y cumplimiento_de_proveedores; nadie lo llama directo.';

revoke all on function public.plazos_de_compras_calculados(uuid[]) from public, anon, authenticated;

-- =============================================================================
-- 2. EL PLAZO DE LA LISTA DE OC, IGUAL QUE ANTES
-- =============================================================================
create or replace function public.plazos_de_compras(p_ids uuid[])
returns table (
  documento   uuid,
  esperada    date,
  llego_en    timestamptz,
  completa_en timestamptz,
  dias_atraso integer,
  atrasada    boolean,
  por_llegar  jsonb,
  por_validar boolean
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
  select p.documento, p.esperada, p.llego_en, p.completa_en,
         case
           when p.esperada is null then null
           when p.completa_en is not null then greatest(public.fecha_de_lima(p.completa_en) - p.esperada, 0)
           when p.llego_todo_en is not null then greatest(public.fecha_de_lima(p.llego_todo_en) - p.esperada, 0)
           when p.vigente then greatest(v_hoy - p.esperada, 0)
         end::integer,
         (p.vigente and p.completa_en is null and p.llego_todo_en is null and p.esperada is not null and p.esperada < v_hoy),
         p.por_llegar,
         p.por_validar
    from public.plazos_de_compras_calculados(array(
           select c.id
             from public.ordenes_compra_materiales c
            where c.id = any(p_ids)
              -- El mismo alcance que el listado de OC: Logística todas; quien solo
              -- consulta, las directas y las de las áreas que le tocan.
              and (public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('tesoreria.ver_documentos')
                   or c.requerimiento_id is null
                   or exists (select 1 from public.requerimientos_materiales r
                               where r.id = c.requerimiento_id and public.puede_ver_area_material(r.area_destino))))) p;
end;
$$;

comment on function public.plazos_de_compras(uuid[]) is
  'De cada OC: la fecha prometida que vale hoy (la corregida, si se corrigió), cuándo llegó al almacén y cuándo quedó completa (cuando se dejó lo último que la completó, no cuando se validó), los días de atraso por fecha de Lima, si está atrasada (vigente, vencida y sin llegar completa), de la que llegó a medias lo que falta por material y si tiene ingresos que Almacén todavía no valida. Lo lee quien lee el listado de OC, con el mismo alcance. Sin importes. El cálculo vive en plazos_de_compras_calculados.';

revoke all on function public.plazos_de_compras(uuid[]) from public, anon;
grant execute on function public.plazos_de_compras(uuid[]) to authenticated;

-- =============================================================================
-- 3. EL CUMPLIMIENTO DE CADA PROVEEDOR
-- =============================================================================
create or replace function public.cumplimiento_de_proveedores(p_ids uuid[])
returns table (
  proveedor uuid,
  compras   integer,
  medidas   integer,
  a_tiempo  integer,
  devueltas integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('proveedores.ver')) then
    raise exception 'No tienes permiso para ver el padrón de proveedores.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 100 then
    raise exception 'Pide el cumplimiento de hasta 100 proveedores a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with oc as (
    select c.id, c.proveedor_id
      from public.ordenes_compra_materiales c
     where c.proveedor_id = any(p_ids)
       and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
  ),
  -- La OC llegó cuando quedó completa, o cuando se dejó lo último aunque Almacén
  -- no lo haya validado todavía. Contra la fecha prometida al emitirla.
  oc_plazo as (
    select o.proveedor_id, p.original, coalesce(p.completa_en, p.llego_todo_en) as llego,
           exists (select 1 from public.movimientos_materiales m
                     join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
                    where d.orden_compra_id = o.id and m.tipo = 'DEVOLUCION_PROVEEDOR') as devuelta
      from oc o
      join public.plazos_de_compras_calculados(array(select x.id from oc x)) p on p.documento = o.id
  ),
  os_plazo as (
    select s.proveedor_id, s.fecha_fin as original,
           case when s.estado = 'CONFORME' then s.conformidad_en end as llego,
           false as devuelta
      from public.ordenes_servicio s
     where s.proveedor_id = any(p_ids)
       and s.aprobacion = 'APROBADA'
       and s.estado <> 'ANULADA'
  ),
  todas as (
    select * from oc_plazo
    union all
    select * from os_plazo
  )
  select pr.id,
         count(t.proveedor_id)::integer,
         count(*) filter (where t.llego is not null and t.original is not null)::integer,
         count(*) filter (where t.llego is not null and t.original is not null
                            and public.fecha_de_lima(t.llego) <= t.original)::integer,
         count(*) filter (where t.devuelta)::integer
    from unnest(p_ids) as pr(id)
    left join todas t on t.proveedor_id = pr.id
   group by pr.id;
end;
$$;

comment on function public.cumplimiento_de_proveedores(uuid[]) is
  'De cada proveedor: cuántas compras se le hicieron (OC aprobadas u OS aprobadas no anuladas), cuántas de las que ya llegaron tenían fecha prometida (medidas), cuántas de esas llegaron a tiempo contra la fecha prometida al emitirlas (la OC cuando se dejó lo último en almacén, la OS cuando volvió conforme; por fecha de Lima) y de cuántas OC Almacén le devolvió algo. Lo lee quien ve el padrón (proveedores.ver). Solo cuentas, sin importes.';

revoke all on function public.cumplimiento_de_proveedores(uuid[]) from public, anon;
grant execute on function public.cumplimiento_de_proveedores(uuid[]) to authenticated;
