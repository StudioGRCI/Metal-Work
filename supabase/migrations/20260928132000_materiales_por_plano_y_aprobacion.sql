-- La lista nueva de Diseño nace de un plano. Maestranza y Acabados pueden
-- proponer materiales, pero Diseño debe aprobarlos antes de que Almacén los
-- atienda. Las líneas anteriores conservan su vínculo opcional y su circuito.

-- El esquema anterior había instalado trg_timestamps en estas tablas sin la
-- columna actualizado_en. Las primeras actualizaciones de este flujo deben
-- tener dónde registrar su hora, o fallan después de pasar los permisos.
alter table public.requerimiento_material_detalles
  add column if not exists actualizado_en timestamptz not null default now();
alter table public.orden_compra_material_detalles
  add column if not exists actualizado_en timestamptz not null default now();
alter table public.ordenes_compra_materiales
  add column if not exists actualizado_en timestamptz not null default now();

create or replace function public.fn_material_nuevo_exige_plano()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.plano_id is null then
    raise exception 'Elige el plano que necesita este material.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_material_nuevo_exige_plano() from public, anon, authenticated;
drop trigger if exists trg_material_nuevo_exige_plano on public.ot_materiales;
create trigger trg_material_nuevo_exige_plano before insert on public.ot_materiales
  for each row execute function public.fn_material_nuevo_exige_plano();

alter table public.requerimiento_material_detalles
  add column if not exists aprobacion_diseno text not null default 'APROBADO';
alter table public.requerimiento_material_detalles
  add column if not exists aprobado_por uuid references public.usuarios(id);
alter table public.requerimiento_material_detalles
  add column if not exists aprobado_en timestamptz;
alter table public.requerimiento_material_detalles
  add column if not exists decision_almacen text not null default 'COMPRA';
alter table public.requerimiento_material_detalles
  add column if not exists revisado_por uuid references public.usuarios(id);
alter table public.requerimiento_material_detalles
  add column if not exists revisado_en timestamptz;

alter table public.requerimiento_material_detalles alter column decision_almacen set default 'PENDIENTE';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_req_material_aprobacion'
      and conrelid = 'public.requerimiento_material_detalles'::regclass) then
    alter table public.requerimiento_material_detalles add constraint ck_req_material_aprobacion
      check (aprobacion_diseno in ('PROPUESTO', 'APROBADO', 'RECHAZADO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_req_material_decision'
      and conrelid = 'public.requerimiento_material_detalles'::regclass) then
    alter table public.requerimiento_material_detalles add constraint ck_req_material_decision
      check (decision_almacen in ('PENDIENTE', 'STOCK', 'COMPRA'));
  end if;
end $$;

create or replace function public.fn_material_propuesta_inicial()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if not public.tiene_permiso('diseno.planos') and not public.es_admin() then
    new.aprobacion_diseno := 'PROPUESTO';
  else
    new.aprobacion_diseno := 'APROBADO';
    new.aprobado_por := public.usuario_actual();
    new.aprobado_en := now();
  end if;
  new.decision_almacen := 'PENDIENTE';
  return new;
end;
$$;
revoke all on function public.fn_material_propuesta_inicial() from public, anon, authenticated;
drop trigger if exists trg_material_propuesta_inicial on public.requerimiento_material_detalles;
create trigger trg_material_propuesta_inicial before insert on public.requerimiento_material_detalles
  for each row execute function public.fn_material_propuesta_inicial();

create or replace function public.resolver_propuesta_material(p_detalle uuid, p_aprobar boolean)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('diseno.planos');
  if not exists (select 1 from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ordenes_trabajo o on o.id = r.orden_id
      where d.id = p_detalle and o.estado::text <> 'ANULADA') then
    raise exception 'No se puede aprobar material de una OT anulada.'
      using errcode = 'check_violation';
  end if;
  update public.requerimiento_material_detalles
     set aprobacion_diseno = case when p_aprobar then 'APROBADO' else 'RECHAZADO' end,
         aprobado_por = public.usuario_actual(), aprobado_en = now()
   where id = p_detalle and aprobacion_diseno = 'PROPUESTO'
   returning id into v_id;
  if v_id is null then
    raise exception 'La propuesta no está pendiente de Diseño.' using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;
revoke all on function public.resolver_propuesta_material(uuid, boolean) from public, anon;
grant execute on function public.resolver_propuesta_material(uuid, boolean) to authenticated;

create or replace function public.revisar_stock_requerimiento(p_detalle uuid, p_decision text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_id uuid; v_material uuid; v_saldo numeric; v_cantidad numeric; v_reservado numeric;
begin
  perform public.exigir_permiso('almacen.ver');
  if p_decision not in ('STOCK', 'COMPRA') then
    raise exception 'Elige stock disponible o derivar a Logística.' using errcode = 'check_violation';
  end if;
  select d.id, m.material_id, d.cantidad_solicitada into v_id, v_material, v_cantidad
    from public.requerimiento_material_detalles d
    join public.ot_materiales m on m.id = d.ot_material_id
    join public.ordenes_trabajo o on o.id = m.orden_id
   where d.id = p_detalle and d.aprobacion_diseno = 'APROBADO'
     and o.estado::text <> 'ANULADA' for update of d;
  if v_id is null then
    raise exception 'Diseño todavía no aprobó este material.' using errcode = 'check_violation';
  end if;
  perform 1 from public.materiales where id = v_material for update;
  select coalesce(sum(case when mov.tipo = 'INGRESO' then mov.cantidad else -mov.cantidad end), 0)
    into v_saldo from public.movimientos_materiales mov
    join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
    join public.ot_materiales m on m.id = d.ot_material_id where m.material_id = v_material;
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
   where id = p_detalle and decision_almacen = 'PENDIENTE';
  if not found then
    raise exception 'Almacén ya revisó esta línea.' using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;
revoke all on function public.revisar_stock_requerimiento(uuid, text) from public, anon;
grant execute on function public.revisar_stock_requerimiento(uuid, text) to authenticated;

-- Una compra no puede saltar la revisión de Diseño y Almacén, aunque se
-- invoque directamente la función anterior desde PostgREST.
create or replace function public.fn_compra_exige_derivacion()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if not exists (select 1 from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ordenes_trabajo o on o.id = r.orden_id
      where d.id = new.requerimiento_detalle_id and d.aprobacion_diseno = 'APROBADO'
        and d.decision_almacen = 'COMPRA' and o.estado::text <> 'ANULADA') then
    raise exception 'Almacén debe derivar a Logística un material aprobado antes de comprarlo.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_exige_derivacion() from public, anon, authenticated;
drop trigger if exists trg_compra_exige_derivacion on public.orden_compra_material_detalles;
create trigger trg_compra_exige_derivacion before insert on public.orden_compra_material_detalles
  for each row execute function public.fn_compra_exige_derivacion();

-- Precio declarado en la línea de compra. Queda sin valor hasta que Logística
-- lo registre; no se infiere del catálogo ni del inventario histórico.
alter table public.orden_compra_material_detalles add column if not exists precio_unitario numeric(14,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_compra_material_precio'
      and conrelid = 'public.orden_compra_material_detalles'::regclass) then
    alter table public.orden_compra_material_detalles add constraint ck_compra_material_precio
      check (precio_unitario is null or precio_unitario >= 0);
  end if;
end $$;

create or replace function public.fijar_precio_compra_material(p_detalle uuid, p_precio numeric)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('compras.crear');
  if p_precio is null or p_precio < 0 or p_precio > 999999999999.99 then
    raise exception 'Indica el precio unitario válido.' using errcode = 'check_violation';
  end if;
  update public.orden_compra_material_detalles set precio_unitario = round(p_precio, 2)
   where id = p_detalle and precio_unitario is null returning id into v_id;
  if v_id is null then
    raise exception 'El precio ya está registrado o la compra no existe.' using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;
revoke all on function public.fijar_precio_compra_material(uuid, numeric) from public, anon;
grant execute on function public.fijar_precio_compra_material(uuid, numeric) to authenticated;

-- El stock del almacén es global por insumo. Una línea marcada STOCK puede
-- despacharse con saldo recibido para otra OT; el bloqueo del material serializa
-- despachos concurrentes y evita vender dos veces el mismo saldo.
create or replace function public.despachar_material(
  p_id uuid, p_requerimiento_detalle_id uuid, p_cantidad public.cantidad,
  p_responsable_id uuid
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_material uuid; v_area text; v_decision text; v_solicitada numeric; v_despachada numeric; v_stock numeric; v_recibida numeric;
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
  select coalesce(sum(m.cantidad), 0) into v_despachada
    from public.movimientos_materiales m
   where m.requerimiento_detalle_id = p_requerimiento_detalle_id and m.tipo = 'DESPACHO';
  if v_decision = 'COMPRA' then
    select coalesce(sum(m.cantidad), 0) into v_recibida from public.movimientos_materiales m
     where m.requerimiento_detalle_id = p_requerimiento_detalle_id and m.tipo = 'INGRESO';
    if p_cantidad > v_recibida - v_despachada then
      raise exception 'Almacén debe confirmar la recepción de esta compra antes de despacharla.'
        using errcode = 'check_violation';
    end if;
  end if;
  if p_cantidad > v_solicitada - v_despachada then
    raise exception 'La entrega supera la cantidad solicitada.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
      where u.id = p_responsable_id and u.activo and a.codigo = v_area) then
    raise exception 'La persona debe estar activa y pertenecer al área %.', v_area using errcode = 'check_violation';
  end if;
  select coalesce(sum(case when mov.tipo = 'INGRESO' then mov.cantidad else -mov.cantidad end), 0)
    into v_stock from public.movimientos_materiales mov
    join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
    join public.ot_materiales om on om.id = d.ot_material_id
   where om.material_id = v_material;
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

create or replace function public.proponer_material_de_area(
  p_orden uuid, p_plano uuid, p_material uuid, p_cantidad public.cantidad,
  p_observacion text default null
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_area text; v_linea uuid; v_requerimiento uuid; v_detalle uuid;
begin
  perform public.exigir_permiso('requerimientos.crear');
  select a.codigo into v_area from public.usuarios u
    join public.areas a on a.id = u.area_id
   where u.id = public.usuario_actual() and u.activo;
  if v_area not in ('MTZ', 'ACB') then
    raise exception 'Solo Maestranza y Acabados proponen materiales a Diseño.' using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta orden.' using errcode = 'insufficient_privilege';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or length(coalesce(p_observacion, '')) > 500 then
    raise exception 'Indica cantidad positiva y observación de hasta 500 caracteres.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ot_planos p join public.ordenes_trabajo o on o.id = p.orden_id
      where p.id = p_plano and p.orden_id = p_orden
        and o.estado::text not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')) then
    raise exception 'Elige un plano de una orden activa.' using errcode = 'check_violation';
  end if;
  insert into public.ot_materiales
    (orden_id, plano_id, material_id, cantidad, area_destino, observacion, creado_por)
  values (p_orden, p_plano, p_material, p_cantidad, v_area, nullif(btrim(p_observacion), ''), public.usuario_actual())
  returning id into v_linea;
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (p_orden, v_area, public.usuario_actual())
  on conflict (orden_id, area_destino) do update set actualizado_en = now()
  returning id into v_requerimiento;
  insert into public.requerimiento_material_detalles
    (requerimiento_id, ot_material_id, cantidad_solicitada)
  values (v_requerimiento, v_linea, p_cantidad) returning id into v_detalle;
  return v_detalle;
end;
$$;
revoke all on function public.proponer_material_de_area(uuid, uuid, uuid, public.cantidad, text) from public, anon;
grant execute on function public.proponer_material_de_area(uuid, uuid, uuid, public.cantidad, text) to authenticated;

-- Las compras antiguas ya pudieron recibirse. Las nuevas exigen que
-- Logística avise la entrega al almacén antes del ingreso físico.
do $$ begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ordenes_compra_materiales'
      and column_name = 'entregado_almacen_en') then
    alter table public.ordenes_compra_materiales add column entregado_almacen_en timestamptz;
    -- Compras anteriores a este circuito ya pudieron ingresar a Almacén.
    update public.ordenes_compra_materiales set entregado_almacen_en = creado_en;
  end if;
end $$;
alter table public.ordenes_compra_materiales
  add column if not exists entregado_almacen_por uuid references public.usuarios(id);

create or replace function public.marcar_compra_entregada_almacen(p_compra uuid)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('compras.crear');
  if exists (select 1 from public.orden_compra_material_detalles
      where orden_compra_id = p_compra and precio_unitario is null) then
    raise exception 'Registra el precio unitario de cada insumo antes de entregar la compra a Almacén.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.documentos_compra_material
      where orden_compra_id = p_compra and tipo = 'FACTURA') then
    raise exception 'Adjunta la factura de la compra para Tesorería antes de entregarla a Almacén.'
      using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set entregado_almacen_en = now(), entregado_almacen_por = public.usuario_actual()
   where id = p_compra and entregado_almacen_en is null returning id into v_id;
  if v_id is null then
    if exists (select 1 from public.ordenes_compra_materiales where id = p_compra
      and entregado_almacen_en is not null) then return p_compra; end if;
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  return v_id;
end;
$$;
revoke all on function public.marcar_compra_entregada_almacen(uuid) from public, anon;
grant execute on function public.marcar_compra_entregada_almacen(uuid) to authenticated;

create or replace function public.fn_recepcion_compra_entregada()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if new.tipo = 'INGRESO' and not exists (
    select 1 from public.orden_compra_material_detalles d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
    where d.id = new.orden_compra_detalle_id and c.entregado_almacen_en is not null
  ) then
    raise exception 'Logística debe marcar la entrega de la compra a Almacén antes de recibirla.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_recepcion_compra_entregada() from public, anon, authenticated;
drop trigger if exists trg_recepcion_compra_entregada on public.movimientos_materiales;
create trigger trg_recepcion_compra_entregada before insert on public.movimientos_materiales
  for each row execute function public.fn_recepcion_compra_entregada();
