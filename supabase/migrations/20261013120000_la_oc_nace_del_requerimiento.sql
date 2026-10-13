-- =============================================================================
-- LA ORDEN DE COMPRA NACE DEL REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- Desde 20261013100000 el RQ pasa primero por Almacén y solo los que quedan
-- SIN STOCK le llegan a Logística. Hasta aquí Logística podía marcar que lo
-- estaba comprando, pero la orden de compra salía aparte, como directa, sin
-- que nada dijera qué requerimiento atendía: el RQ y la OC vivían en dos
-- listas que nadie cruzaba, igual que en el Excel.
--
-- Desde aquí Logística GENERA LA OC DESDE EL RQ: elige qué insumos del
-- requerimiento cubre esa orden (de a uno o todos), el código interno viaja
-- del RQ a la OC y el motivo se arma con el número y la justificación del RQ.
-- La orden sigue el mismo circuito que la directa (Gerencia aprueba, el
-- conductor la recoge y la deja en almacén) y el RQ pasa solo a EN ATENCIÓN con
-- la función del circuito. Cada insumo guarda con qué OC se compró; si Gerencia
-- rechaza esa OC, el insumo vuelve a quedar libre para otra. Cuando llega lo
-- comprado, Almacén lo deja listo con lo suyo (rq_marcar_listo_en_almacen).
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Con qué orden se compró cada insumo -------------------------------------------
alter table public.requerimiento_lineas
  add column if not exists orden_compra_id uuid references public.ordenes_compra_materiales(id) on delete restrict,
  add column if not exists atendida_en     timestamptz,
  add column if not exists atendida_por    uuid references public.usuarios(id) on delete restrict;
comment on column public.requerimiento_lineas.orden_compra_id is
  'La orden de compra que Logística generó para este insumo. Vacía mientras no se compra, o si esa compra se rechazó y todavía no hay otra.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_rq_linea_atendida') then
    alter table public.requerimiento_lineas add constraint ck_rq_linea_atendida check (
      (orden_compra_id is null) = (atendida_en is null) and (orden_compra_id is null) = (atendida_por is null));
  end if;
end $$;

-- Cumple (b): la lista de órdenes de compra pregunta qué RQ atiende cada una.
create index if not exists ix_rq_linea_oc on public.requerimiento_lineas (orden_compra_id) where orden_compra_id is not null;

-- 2. Generar la OC desde el RQ ---------------------------------------------------
-- p_items: los números de insumo que cubre esta orden; vacío = todos los libres.
-- Los demás argumentos son los de la OC directa (20261012150000), menos el
-- motivo y el código interno, que salen del requerimiento.
create or replace function public.emitir_compra_del_requerimiento(
  p_id uuid, p_requerimiento_id uuid, p_items smallint[],
  p_proveedor_id uuid, p_referencia text, p_detalles jsonb,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq      public.requerimientos%rowtype;
  v_area    text;
  v_numero  text;
  v_ocupada text;
  v_n       integer;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_rq from public.requerimientos where id = p_requerimiento_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'POR_ATENDER' then
    raise exception 'Almacén todavía no revisó el stock del requerimiento %: la orden se genera cuando quede sin stock.', v_rq.numero
      using errcode = 'check_violation';
  end if;
  if v_rq.estado not in ('SIN_STOCK', 'EN_ATENCION') then
    raise exception 'El requerimiento % ya está %: no se le generan más compras.', v_rq.numero,
      lower(replace(v_rq.estado, '_', ' ')) using errcode = 'check_violation';
  end if;
  if p_items is not null and exists (
       select 1 from unnest(p_items) i where not exists (
         select 1 from public.requerimiento_lineas l where l.requerimiento_id = p_requerimiento_id and l.item = i)) then
    raise exception 'Alguno de los insumos marcados no es de este requerimiento. Recarga la pantalla.' using errcode = 'check_violation';
  end if;

  -- Un insumo que ya tiene su compra viva no se pisa; si esa compra se rechazó,
  -- queda libre. Sin lista, se toman los libres y los ocupados se dejan en paz.
  if p_items is not null then
    select string_agg(l.item::text, ', ' order by l.item) into v_ocupada
      from public.requerimiento_lineas l
      join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
     where l.requerimiento_id = p_requerimiento_id and c.aprobacion <> 'RECHAZADA' and c.id <> p_id
       and l.item = any (p_items);
    if v_ocupada is not null then
      raise exception 'Los insumos % ya tienen su orden de compra: desmárcalos o espera a que Gerencia la rechace.', v_ocupada
        using errcode = 'check_violation';
    end if;
  end if;
  if not exists (
       select 1 from public.requerimiento_lineas l
       left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
      where l.requerimiento_id = p_requerimiento_id
        and (p_items is null or l.item = any (p_items))
        and (c.id is null or c.id = p_id or c.aprobacion = 'RECHAZADA')) then
    raise exception 'Todos los insumos del requerimiento % ya tienen su orden de compra.', v_rq.numero using errcode = 'check_violation';
  end if;

  -- La OC es una directa más: Gerencia la aprueba y el conductor la recoge. El
  -- motivo y el código interno salen del RQ. Un reintento devuelve la misma OC.
  select nombre into v_area from public.areas where id = v_rq.area_id;
  perform public.emitir_compra_directa(
    p_id, p_proveedor_id, p_referencia,
    left('Atiende el requerimiento ' || v_rq.numero || ' de ' || coalesce(v_area, 'el área') || ': ' || v_rq.justificacion, 500),
    p_detalles, p_fecha, p_condicion, p_dias, p_moneda, p_con_factura, v_rq.codigo_interno);
  select numero into v_numero from public.ordenes_compra_materiales where id = p_id;

  update public.requerimiento_lineas l
     set orden_compra_id = p_id, atendida_en = now(), atendida_por = public.usuario_actual()
   where l.requerimiento_id = p_requerimiento_id
     and (p_items is null or l.item = any (p_items))
     and (l.orden_compra_id is null
          or exists (select 1 from public.ordenes_compra_materiales c where c.id = l.orden_compra_id and c.aprobacion = 'RECHAZADA'));
  get diagnostics v_n = row_count;

  -- El RQ pasa a EN ATENCIÓN con la función del circuito (avisa a Almacén).
  if v_rq.estado = 'SIN_STOCK' then
    perform public.rq_marcar_en_atencion(p_requerimiento_id, 'Orden ' || coalesce(v_numero, ''));
  end if;
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_del_requerimiento(uuid, uuid, smallint[], uuid, text, jsonb, date, text, integer, text, boolean) from public, anon;
grant execute on function public.emitir_compra_del_requerimiento(uuid, uuid, smallint[], uuid, text, jsonb, date, text, integer, text, boolean) to authenticated;
