-- =============================================================================
-- LA ORDEN DE COMPRA JUNTA LOS INSUMOS DE VARIOS REQUERIMIENTOS
-- -----------------------------------------------------------------------------
-- Gerencia, el 2026-10-15: que la OC se arme «por insumos en vez de RQ», para
-- que no haya varias órdenes de compra: «que se pueda generar una orden de
-- compra por diferentes insumos anexados a su código de RQ; así tendríamos
-- varios RQ para una orden de compra». Hasta hoy «Generar OC» armaba la orden
-- con los insumos de un solo RQ: si tres áreas pedían discos de corte al mismo
-- proveedor, salían tres órdenes.
--
-- Desde aquí:
--   · Quien compra (Logística los RQ de operación; la administradora los RQA)
--     marca lo que falta de varios RQ del mismo tipo y emite UNA orden para un
--     proveedor. Cada línea de la OC es un material y junta lo que falta de él
--     en cada RQ.
--   · Cada insumo queda enlazado a la línea de la OC que lo compra
--     (`requerimiento_lineas.orden_compra_detalle_id`): sigue anexado a su RQ y
--     a su código interno.
--   · En el costeo de cada código, cada línea de la OC se reparte entre los
--     códigos de los insumos que cubre, en proporción a lo que faltaba de cada
--     uno. La OC de un solo código sale igual que antes.
--   · La OC con insumos de varios códigos no tiene un código propio
--     (`codigo_interno` vacío): el código es el de cada insumo. No se corrige en
--     la OC sino en el RQ, con su justificante.
--   · Cada RQ que entra en la orden pasa a «En compra», como antes.
--
-- La función de antes (`emitir_compra_del_requerimiento`, un RQ por orden)
-- queda para la pantalla que está en uso hasta el despliegue.
-- Sin DROP ni borrados: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Qué línea de la OC compra cada insumo ------------------------------------------------
-- (b) el costeo de cada código busca los insumos de cada línea de OC, y (c) la
-- línea se borra cuando Gerencia rechaza la OC (`rechazar_compra`): el enlace
-- se vacía solo y el insumo queda libre para otra orden.
alter table public.requerimiento_lineas
  add column if not exists orden_compra_detalle_id uuid
    references public.orden_compra_material_detalles(id) on delete set null;
comment on column public.requerimiento_lineas.orden_compra_detalle_id is
  'La línea de la OC que compra este insumo. Una línea junta el mismo material de varios RQ; la parte de cada código sale de lo que faltaba de cada insumo. Vacía en las OC de antes del 2026-10-16, que enlazan solo la OC.';
create index if not exists ix_rq_linea_detalle_oc on public.requerimiento_lineas (orden_compra_detalle_id)
  where orden_compra_detalle_id is not null;

-- 2. Emitir la OC con insumos de varios RQ ---------------------------------------------------
-- p_lineas, una por material:
--   [{material_id, cantidad, precio, insumos: [id de requerimiento_lineas, …]}, …]
-- La cantidad es la que se compra (lo que falta, o más si el proveedor vende
-- por paquete); el precio, sin IGV. Un reintento con el mismo p_id devuelve la
-- misma orden.
create or replace function public.emitir_compra_de_requerimientos(
  p_id uuid, p_lineas jsonb, p_proveedor_id uuid, p_referencia text,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_insumos  uuid[];
  v_tipos    text[];
  v_codigos  text[];
  v_malo     text;
  v_rqs      integer;
  v_motivo   text;
  v_codigo   text;
  v_numero   text;
  v_n        integer;
  v_rq       record;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or p_lineas is null or jsonb_typeof(p_lineas) <> 'array'
     or jsonb_array_length(p_lineas) not between 1 and 100 then
    raise exception 'Marca los insumos que compra esta orden: de uno a cien materiales.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) x
              where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'insumos') is distinct from 'array'
                 or jsonb_array_length(x->'insumos') = 0
                 or coalesce(x->>'material_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Cada material de la orden cubre al menos un insumo de un requerimiento. Vuelve a cargar la pantalla.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) x, jsonb_array_elements(x->'insumos') i
              where jsonb_typeof(i) <> 'string'
                 or (i #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'No se reconocieron los insumos marcados. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  select array_agg((i #>> '{}')::uuid) into v_insumos
    from jsonb_array_elements(p_lineas) x, jsonb_array_elements(x->'insumos') i;
  if cardinality(v_insumos) > 300 then
    raise exception 'Una orden cubre hasta 300 insumos.' using errcode = 'check_violation';
  end if;
  if cardinality(v_insumos) <> (select count(distinct u) from unnest(v_insumos) u) then
    raise exception 'Un insumo va en una sola línea de la orden.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.requerimiento_lineas where id = any (v_insumos)) <> cardinality(v_insumos) then
    raise exception 'Alguno de los insumos marcados ya no está. Recarga la pantalla.' using errcode = 'check_violation';
  end if;

  -- Los RQ se bloquean en orden, para que dos órdenes a la vez no se crucen.
  perform 1 from public.requerimientos r
   where r.id in (select l.requerimiento_id from public.requerimiento_lineas l where l.id = any (v_insumos))
   order by r.id
     for update;

  -- Un tipo por orden, y lo compra quien le toca.
  select array_agg(distinct r.tipo) into v_tipos
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos);
  if cardinality(v_tipos) > 1 then
    raise exception 'Una orden junta insumos de requerimientos del mismo tipo: los de operación en una y los de Administración en otra.'
      using errcode = 'check_violation';
  end if;
  perform public.rq_exigir(v_tipos[1], 'COMPRAR');

  -- Cada RQ, revisado por Almacén y todavía abierto.
  select string_agg(distinct r.numero, ', ') into v_malo
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos) and r.estado = 'POR_ATENDER';
  if v_malo is not null then
    raise exception 'Almacén todavía no revisó el stock de %: la orden se genera con lo que falte.', v_malo
      using errcode = 'check_violation';
  end if;
  select string_agg(distinct r.numero || ' (' || lower(replace(r.estado, '_', ' ')) || ')', ', ') into v_malo
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos) and r.estado not in ('SIN_STOCK', 'EN_ATENCION');
  if v_malo is not null then
    raise exception 'Ya no se compra para %: desmarca sus insumos.', v_malo using errcode = 'check_violation';
  end if;

  -- Lo que Almacén tiene completo no se compra.
  select string_agg(format('el %s del %s', l.item, r.numero), ', ' order by r.numero, l.item) into v_malo
    from public.requerimiento_lineas l join public.requerimientos r on r.id = l.requerimiento_id
   where l.id = any (v_insumos) and l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad;
  if v_malo is not null then
    raise exception 'Almacén ya tiene completo %: no se compra. Desmárcalo.', v_malo using errcode = 'check_violation';
  end if;

  -- Un insumo que ya tiene su compra viva no se pisa; si esa compra se rechazó, queda libre.
  select string_agg(format('el %s del %s (%s)', l.item, r.numero, coalesce(c.numero, c.referencia)), ', '
                    order by r.numero, l.item) into v_malo
    from public.requerimiento_lineas l
    join public.requerimientos r on r.id = l.requerimiento_id
    join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
   where l.id = any (v_insumos) and c.aprobacion <> 'RECHAZADA' and c.id <> p_id;
  if v_malo is not null then
    raise exception 'Ya va en otra orden de compra %: desmárcalo o espera a que Gerencia la rechace.', v_malo
      using errcode = 'check_violation';
  end if;

  -- El motivo dice qué RQ atiende; el código es el de los RQ si es uno solo.
  select count(distinct r.id),
         array_agg(distinct public.normalizar_codigo_interno(r.codigo_interno))
    into v_rqs, v_codigos
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos);
  if v_rqs = 1 then
    select 'Atiende el requerimiento ' || r.numero || ' de ' || coalesce(a.nombre, 'el área') || ': ' || r.justificacion,
           btrim(r.codigo_interno)
      into v_motivo, v_codigo
      from public.requerimientos r
      left join public.areas a on a.id = r.area_id
     where r.id = (select l.requerimiento_id from public.requerimiento_lineas l where l.id = v_insumos[1]);
  else
    select 'Atiende los requerimientos ' || string_agg(x.numero || ' (' || x.area || ')', ', ' order by x.numero) || '.',
           min(x.codigo)
      into v_motivo, v_codigo
      from (select distinct r.numero, coalesce(a.nombre, 'sin área') as area, btrim(r.codigo_interno) as codigo
              from public.requerimientos r
              join public.requerimiento_lineas l on l.requerimiento_id = r.id
              left join public.areas a on a.id = r.area_id
             where l.id = any (v_insumos)) x;
  end if;

  -- La OC es una directa más: Gerencia la aprueba y el conductor la recoge.
  perform public.emitir_compra_directa(
    p_id, p_proveedor_id, p_referencia, left(v_motivo, 500),
    (select jsonb_agg(jsonb_build_object('material_id', x->>'material_id', 'cantidad', x->'cantidad', 'precio', x->'precio'))
       from jsonb_array_elements(p_lineas) x),
    p_fecha, p_condicion, p_dias, p_moneda, p_con_factura, v_codigo);
  -- Con insumos de varios códigos, la orden no tiene uno propio: es el de cada insumo.
  if cardinality(v_codigos) > 1 then
    update public.ordenes_compra_materiales set codigo_interno = null where id = p_id and codigo_interno is not null;
  end if;
  select numero into v_numero from public.ordenes_compra_materiales where id = p_id;

  -- Cada insumo, a la línea de su material.
  update public.requerimiento_lineas l
     set orden_compra_id = p_id, orden_compra_detalle_id = d.id,
         atendida_en = now(), atendida_por = public.usuario_actual()
    from (select (i #>> '{}')::uuid as insumo, (x->>'material_id')::uuid as material
            from jsonb_array_elements(p_lineas) x, jsonb_array_elements(x->'insumos') i) s
    join public.orden_compra_material_detalles d
      on d.orden_compra_id = p_id and d.material_id = s.material and d.requerimiento_detalle_id is null
   where l.id = s.insumo;
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_insumos) then
    raise exception 'No se pudieron enlazar todos los insumos a la orden. Recarga la pantalla.' using errcode = 'check_violation';
  end if;

  -- Cada RQ que esperaba su compra pasa a «En compra» (avisa a Almacén).
  for v_rq in
    select distinct r.id from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
     where l.id = any (v_insumos) and r.estado = 'SIN_STOCK'
  loop
    perform public.rq_marcar_en_atencion(v_rq.id, 'Orden ' || coalesce(v_numero, ''));
  end loop;
  return p_id;
end;
$$;
comment on function public.emitir_compra_de_requerimientos(uuid, jsonb, uuid, text, date, text, integer, text, boolean) is
  'Una orden de compra con los insumos que faltan de uno o varios RQ del mismo tipo: una línea por material, con los insumos que cubre. Exige compras.crear; los de operación los compra Logística y los RQA la administradora.';
revoke all on function public.emitir_compra_de_requerimientos(uuid, jsonb, uuid, text, date, text, integer, text, boolean) from public, anon;
grant execute on function public.emitir_compra_de_requerimientos(uuid, jsonb, uuid, text, date, text, integer, text, boolean) to authenticated;

-- 3. Los insumos de cada OC, para las pantallas y el PDF ---------------------------------------
-- Una fila por insumo: el RQ, su código interno y cuánto faltaba. También los de
-- las OC de antes, que enlazan solo la OC (sin línea). Solo números y códigos:
-- la ven todos los que ven las compras, aunque no lean los requerimientos.
create or replace function public.insumos_de_compras(p_ids uuid[])
returns table (orden_compra_id uuid, detalle_id uuid, requerimiento_id uuid, requerimiento text, area text,
               codigo_interno text, item integer, cantidad numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('compras.recojo') or public.tiene_permiso('adquisiciones.ver')
          or public.tiene_permiso('almacen.recibir')) then
    raise exception 'No tiene permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  return query
  select l.orden_compra_id, l.orden_compra_detalle_id, r.id, r.numero::text, a.nombre::text, btrim(r.codigo_interno)::text,
         l.item::integer, greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0)::numeric
    from public.requerimiento_lineas l
    join public.requerimientos r on r.id = l.requerimiento_id
    left join public.areas a on a.id = r.area_id
   where l.orden_compra_id = any (p_ids)
   order by l.orden_compra_id, r.numero, l.item;
end;
$$;
comment on function public.insumos_de_compras(uuid[]) is
  'Los insumos de RQ que atiende cada OC: su RQ, su código interno y cuánto faltaba. Para el «Para» de las listas y el destino de cada línea del PDF. La ve quien ve las compras.';
revoke all on function public.insumos_de_compras(uuid[]) from public, anon;
grant execute on function public.insumos_de_compras(uuid[]) to authenticated;

-- 4. El costeo de cada código: cada línea de OC, repartida entre los códigos de sus insumos ----
-- La misma función de la 20261016100000 (con los servicios y los subcontratos al
-- final); cambia solo cómo se arman las compras.
create or replace function public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with tareo as (
    select public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.fecha, t.horas, t.costo, t.trabajador_id,
           l.reporte_id, l.trabajo_id, case when l.id is null then t.labor end as labor
      from public.tareos t
      left join public.reporte_diario_personal l on l.id = t.reporte_linea_id
     where p_mano_obra and t.anulado_en is null
  ), espera as (
    -- Una línea de un reporte vigente que no tiene tareo: su persona no tiene costo mensual.
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, l.fecha, l.horas, l.trabajador_id,
           l.reporte_id, l.trabajo_id, null::text as labor
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where p_mano_obra and r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
  ), horas as (
    select 'MANO_OBRA'::text as fuente, x.codigo, x.fecha, x.horas, x.costo, x.trabajador_id, x.reporte_id, x.trabajo_id, x.labor from tareo x
    union all
    select 'MANO_OBRA_SIN_COSTO', e.codigo, e.fecha, e.horas, null::numeric, e.trabajador_id, e.reporte_id, e.trabajo_id, e.labor from espera e
  ), salida as (
    select m.id, m.registrado_en, m.material_id, m.precio_unitario, m.moneda, m.documento_referencia, rq.numero as rq_numero,
           public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno, u.codigo_interno, uo.codigo_interno,
                                                     case when m.unidad_id is null then m.codigo_unidad end)) as codigo,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad
      from public.movimientos_materiales m
      left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
      left join public.requerimientos rq on rq.id = rl.requerimiento_id
      left join public.unidades u on u.id = m.unidad_id
      left join public.ordenes_trabajo ot on ot.id = m.orden_id
      left join public.unidades uo on uo.id = ot.unidad_id
     where m.tipo in ('SALIDA', 'DESPACHO')
  ), valorizada as (
    -- El mismo orden que el costeo de la OT: precio congelado, último ingreso con
    -- precio hasta ese día, y el precio que fijó Logística (el vigente ese día, o
    -- el primero después).
    select s.*,
           coalesce(s.precio_unitario, ing.precio_unitario, val.precio)::numeric as precio,
           case when s.precio_unitario is not null then coalesce(s.moneda, ing.moneda, val.moneda)
                when ing.precio_unitario is not null then ing.moneda
                else val.moneda end as moneda_val
      from salida s
      left join lateral (
        select i.precio_unitario, i.moneda from public.movimientos_materiales i
         where i.material_id = s.material_id and i.tipo = 'INGRESO' and i.precio_unitario is not null
           and i.moneda in ('PEN', 'USD') and i.registrado_en <= s.registrado_en
         order by i.registrado_en desc, i.id
         limit 1) ing on true
      left join lateral (
        select v.precio, v.moneda from public.valorizaciones_material v
         where v.material_id = s.material_id
         order by (v.vigente_desde > s.registrado_en),
                  case when v.vigente_desde <= s.registrado_en then v.vigente_desde end desc nulls last,
                  v.vigente_desde, v.id
         limit 1) val on true
     where s.codigo is not null and s.cantidad > 0
       and (v_codigo is null or s.codigo = v_codigo)
  ), porcion as (
    -- Lo que faltaba de los insumos que cubre cada línea de OC, por el código de su RQ.
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    -- La parte de la línea que va a cada código; si nada faltaba, a partes iguales.
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), compra_linea as (
    -- La línea sin insumos (la directa, o la OC de antes) va entera al código de la OC.
    select c.id, coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           d.id as detalle_id, d.precio_unitario,
           d.cantidad * d.precio_unitario * coalesce(r.parte, 1) as importe
      from public.ordenes_compra_materiales c
      left join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
      left join reparto r on r.detalle_id = d.id
     where c.aprobacion <> 'RECHAZADA'
  ), compra as (
    select l.codigo, c.id, coalesce(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(l.importe) filter (where l.precio_unitario is not null), 0)::numeric as monto,
           count(l.detalle_id) filter (where l.precio_unitario is null)::integer as sin_precio,
           count(l.detalle_id)::numeric as lineas
      from compra_linea l
      join public.ordenes_compra_materiales c on c.id = l.id
     where l.codigo is not null
     group by l.codigo, c.id
  )
  select h.codigo, h.fuente, h.fecha,
         coalesce(tr.descripcion, case when h.reporte_id is not null then 'Personal general del reporte' end,
                  h.labor, 'Horas cargadas por Recursos Humanos')::text,
         coalesce(rd.asunto, 'Cargadas por Recursos Humanos')::text,
         count(distinct h.trabajador_id)::numeric,
         case when count(distinct h.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         sum(h.horas)::numeric, null::numeric, 'PEN'::text,
         case when h.fuente = 'MANO_OBRA' then round(sum(h.costo), 2) end,
         0, null::text, h.reporte_id
    from horas h
    left join public.reporte_diario_trabajos tr on tr.id = h.trabajo_id
    left join public.reportes_diarios rd on rd.id = h.reporte_id
   where h.codigo is not null and (v_codigo is null or h.codigo = v_codigo)
   group by h.codigo, h.fuente, h.fecha, h.reporte_id, h.trabajo_id, h.labor, tr.descripcion, rd.asunto
  union all
  select v.codigo, case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end,
         (v.registrado_en at time zone 'America/Lima')::date, mat.descripcion::text, v.documento_referencia::text,
         v.cantidad, um.codigo::text, null::numeric, v.precio, v.moneda_val::text,
         case when v.precio is null then null else round(v.cantidad * v.precio, 2) end,
         case when v.precio is null then 1 else 0 end, v.rq_numero::text, v.id
    from valorizada v
    join public.materiales mat on mat.id = v.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
  union all
  select c.codigo, 'COMPRAS', c.fecha, c.proveedor::text, null::text, c.lineas,
         case when c.lineas = 1 then 'línea' else 'líneas' end::text, null::numeric, null::numeric, c.moneda::text,
         round(c.monto, 2), c.sin_precio, c.numero::text, c.id
    from compra c
   where c.codigo is not null and (v_codigo is null or c.codigo = v_codigo)
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales, compras (no van al total; la OC con insumos de varios códigos se reparte entre ellos), órdenes de servicio y recibos por honorarios de los subcontratos. Solo la llaman codigo_interno_costeo (Gerencia), codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin los servicios ni los subcontratos) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- 5. Las OC de un código: los RQ de ESE código ------------------------------------------------
-- La misma función de la 20261015160000. Una OC que junta varios códigos sale
-- en cada uno con su parte, y nombra solo los RQ de ese código.
create or replace function public.codigo_interno_compras(p_codigo text)
returns table (id uuid, numero text, fecha date, proveedor text, aprobacion text, recojo text,
               entregado_almacen_en timestamptz, validaciones text[], moneda text, monto numeric,
               lineas integer, sin_precio integer, requerimientos text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('codigos_internos.ver') or public.tiene_permiso('codigos_internos.gasto')) then
    raise exception 'No tiene el permiso codigos_internos.ver ni codigos_internos.gasto para realizar esta operación'
      using errcode = 'insufficient_privilege';
  end if;
  if v_codigo is null then
    return;
  end if;
  return query
  select c.id, k.documento, k.fecha, c.proveedor::text, c.aprobacion::text, c.recojo::text, c.entregado_almacen_en,
         coalesce((select array_agg(i.estado::text) from public.ingresos_pendientes_almacen i where i.orden_compra_id = c.id),
                  '{}'::text[]),
         k.moneda, k.monto, k.cantidad::integer, k.sin_precio,
         coalesce(
           (select string_agg(distinct q.numero, ', ') from public.requerimiento_lineas rl
              join public.requerimientos q on q.id = rl.requerimiento_id
             where rl.orden_compra_id = c.id and public.normalizar_codigo_interno(q.codigo_interno) = v_codigo),
           (select string_agg(distinct q.numero, ', ') from public.requerimiento_lineas rl
              join public.requerimientos q on q.id = rl.requerimiento_id where rl.orden_compra_id = c.id))::text
    from public.codigo_interno_lineas(p_codigo, false) k
    join public.ordenes_compra_materiales c on c.id = k.referencia_id
   where k.fuente = 'COMPRAS'
   order by k.fecha desc, k.documento;
end;
$$;
comment on function public.codigo_interno_compras(text) is
  'Las órdenes de compra de un código interno, sin IGV y sin las rechazadas, con su aprobación, su recojo y su ingreso al almacén. La OC que junta varios códigos sale con la parte de este. Exige codigos_internos.ver o codigos_internos.gasto.';
revoke all on function public.codigo_interno_compras(text) from public, anon;
grant execute on function public.codigo_interno_compras(text) to authenticated;

-- 6. Corregir la OC: el código de un insumo se corrige en su RQ ---------------------------------
-- La misma función de la 20261016602000. En la OC que compra insumos de RQ, el
-- código es el de cada insumo: la OC no lo cambia (y la de varios códigos no
-- tiene uno propio).
create or replace function public.corregir_orden_compra(
  p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_antes   jsonb;
  v_despues jsonb;
  v_x       jsonb;
  v_det     public.orden_compra_material_detalles%rowtype;
  v_cant    numeric;
  v_precio  numeric;
  v_factura boolean;
  v_codigo  text;
  v_tiene_precio boolean;
  v_por_insumo boolean;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_oc from public.ordenes_compra_materiales where id = p_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;
  end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden % está rechazada: no se corrige. Genera otra.', coalesce(v_oc.numero, v_oc.referencia)
      using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  v_antes := jsonb_build_object('con_factura', v_oc.con_factura, 'codigo_interno', v_oc.codigo_interno, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('detalle_id', d.id, 'material_id', d.material_id, 'cantidad', d.cantidad,
                                                  'precio_unitario', d.precio_unitario) order by d.creado_en, d.id), '[]'::jsonb)
       from public.orden_compra_material_detalles d where d.orden_compra_id = p_id));

  v_factura := coalesce((p_cambios->>'con_factura')::boolean, v_oc.con_factura);
  v_codigo := coalesce(btrim(p_cambios->>'codigo_interno'), v_oc.codigo_interno);
  v_por_insumo := exists (select 1 from public.requerimiento_lineas rl
                            join public.orden_compra_material_detalles d on d.id = rl.orden_compra_detalle_id
                           where d.orden_compra_id = p_id);
  if v_por_insumo then
    if v_codigo is distinct from v_oc.codigo_interno then
      raise exception 'Cada insumo de la % lleva el código interno de su requerimiento: si está mal, corrige el requerimiento.',
        coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
    end if;
    if v_factura is null then
      raise exception 'Indica si la compra viene con factura o sin factura.' using errcode = 'check_violation';
    end if;
  else
    perform public.validar_datos_de_compra(v_factura, v_codigo);
  end if;
  if v_factura is distinct from v_oc.con_factura and public.compra_tiene_comprobante(v_oc) then
    raise exception 'La compra % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',
      coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales set con_factura = v_factura, codigo_interno = v_codigo
   where id = p_id and (con_factura is distinct from v_factura or codigo_interno is distinct from v_codigo);

  for v_x in select value from jsonb_array_elements(coalesce(p_cambios->'lineas', '[]'::jsonb)) loop
    begin
      select * into v_det from public.orden_compra_material_detalles
       where id = (v_x->>'detalle_id')::uuid and orden_compra_id = p_id for update;
      v_cant := nullif(v_x->>'cantidad', '')::numeric;
      v_tiene_precio := v_x ? 'precio_unitario';
      v_precio := nullif(v_x->>'precio_unitario', '')::numeric;
    exception when others then
      raise exception 'Revisa las líneas que corriges.' using errcode = 'check_violation';
    end;
    if v_det.id is null then
      raise exception 'Esa línea no es de esta orden. Recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if (v_cant is not null and v_cant is distinct from v_det.cantidad)
       or (v_tiene_precio and v_precio is distinct from v_det.precio_unitario) then
      if exists (select 1 from public.movimientos_materiales m where m.orden_compra_detalle_id = v_det.id) then
        raise exception 'Una línea de la % ya entró al almacén: su cantidad y su precio quedaron en el kardex.',
          coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
      end if;
      if v_cant is not null and (v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3)) then
        raise exception 'Cada cantidad debe ser mayor que cero, con hasta tres decimales.' using errcode = 'check_violation';
      end if;
      if v_tiene_precio and (v_precio is null or v_precio < 0 or v_precio > 999999999 or v_precio <> round(v_precio, 2)) then
        raise exception 'Cada precio va en soles o dólares sin IGV, de 0 en adelante, con hasta dos decimales.' using errcode = 'check_violation';
      end if;
      update public.orden_compra_material_detalles
         set cantidad = coalesce(v_cant, cantidad),
             precio_unitario = case when v_tiene_precio then v_precio else precio_unitario end
       where id = v_det.id;
    end if;
    v_det := null;
  end loop;

  select * into v_oc from public.ordenes_compra_materiales where id = p_id;
  v_despues := jsonb_build_object('con_factura', v_oc.con_factura, 'codigo_interno', v_oc.codigo_interno, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('detalle_id', d.id, 'material_id', d.material_id, 'cantidad', d.cantidad,
                                                  'precio_unitario', d.precio_unitario) order by d.creado_en, d.id), '[]'::jsonb)
       from public.orden_compra_material_detalles d where d.orden_compra_id = p_id));
  perform public.registrar_correccion(p_correccion, 'ORDEN_COMPRA', p_id, coalesce(v_oc.numero, v_oc.referencia), p_motivo,
                                      p_justificante, p_nombre, v_antes, v_despues);
  return p_id;
end $$;
revoke all on function public.corregir_orden_compra(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_orden_compra(uuid, uuid, text, text, text, jsonb) to authenticated;
