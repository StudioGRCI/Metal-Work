-- El conteo físico corrige el saldo registrado sin inventar una compra.
create table if not exists public.conteos_inventario (
  id uuid primary key,
  material_id uuid not null references public.materiales(id) on delete restrict,
  cantidad_fisica public.cantidad not null check (cantidad_fisica >= 0),
  ajuste numeric not null,
  motivo text not null check (length(btrim(motivo)) between 10 and 300),
  registrado_por uuid not null references public.usuarios(id) on delete restrict,
  registrado_en timestamptz not null default now()
);
create index if not exists idx_conteos_inventario_material
  on public.conteos_inventario(material_id);
create index if not exists idx_conteos_inventario_usuario
  on public.conteos_inventario(registrado_por);
alter table public.conteos_inventario enable row level security;
revoke all on public.conteos_inventario from public, anon, authenticated;
grant select on public.conteos_inventario to authenticated;
create policy conteos_inventario_almacen_lee on public.conteos_inventario
  for select to authenticated using (public.tiene_permiso('almacen.ver'));

create or replace function public.saldo_registrado_material(p_material uuid)
returns numeric language plpgsql stable security definer set search_path = 'public' as $$
declare v_saldo numeric;
begin
  perform public.exigir_permiso('almacen.ver');
  select coalesce((select sum(case when mov.tipo = 'INGRESO' then mov.cantidad else -mov.cantidad end)
    from public.movimientos_materiales mov
    join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
    join public.ot_materiales om on om.id = d.ot_material_id
    where om.material_id = p_material), 0)
    + coalesce((select sum(c.ajuste) from public.conteos_inventario c
      where c.material_id = p_material), 0) into v_saldo;
  return v_saldo;
end;
$$;
revoke all on function public.saldo_registrado_material(uuid) from public, anon;
grant execute on function public.saldo_registrado_material(uuid) to authenticated;

create or replace function public.registrar_conteo_almacen(
  p_id uuid, p_material uuid, p_cantidad_fisica public.cantidad, p_motivo text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_saldo numeric; v_conteo public.conteos_inventario%rowtype;
begin
  perform public.exigir_permiso('almacen.ver');
  if p_id is null or p_material is null or p_cantidad_fisica is null or p_cantidad_fisica < 0
     or length(btrim(coalesce(p_motivo, ''))) not between 10 and 300 then
    raise exception 'Indica cantidad física y un motivo de 10 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_conteo from public.conteos_inventario where id = p_id;
  if found then
    if v_conteo.material_id = p_material and v_conteo.cantidad_fisica = p_cantidad_fisica
       and v_conteo.motivo = btrim(p_motivo) then return p_id; end if;
    raise exception 'El conteo ya existe con otros datos.' using errcode = 'unique_violation';
  end if;
  perform 1 from public.materiales where id = p_material and activo for update;
  if not found then raise exception 'El material no está activo.' using errcode = 'check_violation'; end if;
  v_saldo := public.saldo_registrado_material(p_material);
  insert into public.conteos_inventario
    (id, material_id, cantidad_fisica, ajuste, motivo, registrado_por)
  values (p_id, p_material, p_cantidad_fisica, p_cantidad_fisica - v_saldo,
          btrim(p_motivo), public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.registrar_conteo_almacen(uuid, uuid, public.cantidad, text) from public, anon;
grant execute on function public.registrar_conteo_almacen(uuid, uuid, public.cantidad, text) to authenticated;

create or replace view public.v_existencias_materiales with (security_invoker = true) as
  with movimientos as (
    select om.material_id,
      sum(case when mov.tipo = 'INGRESO' then mov.cantidad else -mov.cantidad end) as saldo
    from public.movimientos_materiales mov
    join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
    join public.ot_materiales om on om.id = d.ot_material_id
    group by om.material_id
  ), conteos as (
    select material_id, sum(ajuste) as ajuste
    from public.conteos_inventario group by material_id
  )
  select mat.id as material_id, mat.codigo, mat.descripcion, um.codigo as unidad,
    (coalesce(movimientos.saldo, 0) + coalesce(conteos.ajuste, 0))::public.cantidad as existencia
  from public.materiales mat
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
  left join movimientos on movimientos.material_id = mat.id
  left join conteos on conteos.material_id = mat.id
  where movimientos.material_id is not null or conteos.material_id is not null;

create or replace function public.revisar_stock_requerimiento(p_detalle uuid, p_decision text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_material uuid; v_actual text; v_saldo numeric; v_cantidad numeric; v_reservado numeric;
begin
  perform public.exigir_permiso('almacen.ver');
  if p_decision not in ('STOCK', 'COMPRA') then
    raise exception 'Elige stock disponible o derivar a Logística.' using errcode = 'check_violation';
  end if;
  select m.material_id, d.cantidad_solicitada, d.decision_almacen
    into v_material, v_cantidad, v_actual
    from public.requerimiento_material_detalles d
    join public.ot_materiales m on m.id = d.ot_material_id
    join public.ordenes_trabajo o on o.id = m.orden_id
   where d.id = p_detalle and d.aprobacion_diseno = 'APROBADO'
     and o.estado::text <> 'ANULADA' for update of d;
  if v_material is null then
    raise exception 'Diseño todavía no aprobó este material.' using errcode = 'check_violation';
  end if;
  if v_actual not in ('PENDIENTE', 'COMPRA') or
     (v_actual = 'COMPRA' and p_decision <> 'STOCK') then
    raise exception 'Almacén ya revisó esta línea.' using errcode = 'check_violation';
  end if;
  if v_actual = 'COMPRA' and exists (select 1 from public.orden_compra_material_detalles
      where requerimiento_detalle_id = p_detalle) then
    raise exception 'La compra ya comenzó; no se puede cambiar a stock.' using errcode = 'check_violation';
  end if;
  perform 1 from public.materiales where id = v_material for update;
  v_saldo := public.saldo_registrado_material(v_material);
  select coalesce(sum(greatest(d.cantidad_solicitada - coalesce(salidas.cantidad, 0), 0)), 0)
    into v_reservado from public.requerimiento_material_detalles d
    join public.ot_materiales m on m.id = d.ot_material_id
    left join lateral (select sum(x.cantidad) as cantidad from public.movimientos_materiales x
      where x.requerimiento_detalle_id = d.id and x.tipo = 'DESPACHO') salidas on true
   where m.material_id = v_material and d.decision_almacen = 'STOCK' and d.id <> p_detalle;
  if p_decision = 'STOCK' and v_saldo - v_reservado < v_cantidad then
    raise exception 'No hay stock libre suficiente (% disponible); deriva a Logística.', v_saldo - v_reservado
      using errcode = 'check_violation';
  end if;
  update public.requerimiento_material_detalles
     set decision_almacen = p_decision, revisado_por = public.usuario_actual(), revisado_en = now()
   where id = p_detalle and decision_almacen = v_actual;
  if not found then raise exception 'No se pudo guardar la decisión de Almacén.' using errcode = 'check_violation'; end if;
  return p_detalle;
end;
$$;
revoke all on function public.revisar_stock_requerimiento(uuid, text) from public, anon;
grant execute on function public.revisar_stock_requerimiento(uuid, text) to authenticated;

create or replace function public.despachar_material(p_id uuid, p_requerimiento_detalle_id uuid,
  p_cantidad public.cantidad, p_responsable_id uuid)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_material uuid; v_area text; v_decision text; v_solicitada numeric;
  v_despachada numeric; v_stock numeric; v_recibida numeric;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_cantidad is null or p_cantidad <= 0 or p_responsable_id is null then
    raise exception 'Indica la cantidad y quién recibe el material.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_materiales where id = p_id) then return p_id; end if;
  select om.material_id, r.area_destino, d.decision_almacen, d.cantidad_solicitada
    into v_material, v_area, v_decision, v_solicitada
    from public.requerimiento_material_detalles d
    join public.requerimientos_materiales r on r.id = d.requerimiento_id
    join public.ot_materiales om on om.id = d.ot_material_id
    join public.ordenes_trabajo o on o.id = r.orden_id
   where d.id = p_requerimiento_detalle_id and d.aprobacion_diseno = 'APROBADO'
     and d.decision_almacen in ('STOCK', 'COMPRA')
     and o.estado::text <> 'ANULADA' for update of d;
  if not found then
    raise exception 'Diseño y Almacén deben aprobar el material antes del despacho.' using errcode = 'check_violation';
  end if;
  perform 1 from public.materiales where id = v_material for update;
  select coalesce(sum(m.cantidad), 0) into v_despachada from public.movimientos_materiales m
   where m.requerimiento_detalle_id = p_requerimiento_detalle_id and m.tipo = 'DESPACHO';
  if v_decision = 'COMPRA' then
    select coalesce(sum(m.cantidad), 0) into v_recibida from public.movimientos_materiales m
     where m.requerimiento_detalle_id = p_requerimiento_detalle_id and m.tipo = 'INGRESO';
    if p_cantidad > v_recibida - v_despachada then
      raise exception 'Almacén debe confirmar la recepción de esta compra antes de despacharla.' using errcode = 'check_violation';
    end if;
  end if;
  if p_cantidad > v_solicitada - v_despachada then
    raise exception 'La entrega supera la cantidad solicitada.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
      where u.id = p_responsable_id and u.activo and a.codigo = v_area) then
    raise exception 'La persona debe estar activa y pertenecer al área %.', v_area using errcode = 'check_violation';
  end if;
  v_stock := public.saldo_registrado_material(v_material);
  if p_cantidad > v_stock then
    raise exception 'El almacén no tiene saldo suficiente de este material (% disponible).', v_stock
      using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, cantidad, responsable_id, registrado_por)
  values (p_id, 'DESPACHO', p_requerimiento_detalle_id, p_cantidad, p_responsable_id, public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.despachar_material(uuid, uuid, public.cantidad, uuid) from public, anon;
grant execute on function public.despachar_material(uuid, uuid, public.cantidad, uuid) to authenticated;
