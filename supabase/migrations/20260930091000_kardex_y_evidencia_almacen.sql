-- El stock es del almacén, aunque un ingreso no nazca de una OT. El despacho
-- conserva destinatario y foto, y reserva solo el saldo que realmente existe.
alter table public.movimientos_materiales
  alter column requerimiento_detalle_id drop not null,
  add column if not exists material_id uuid references public.materiales(id) on delete restrict,
  add column if not exists origen text not null default 'COMPRA',
  add column if not exists foto_ruta text,
  add column if not exists recibido_por_nombre text,
  add column if not exists cantidad_de_stock numeric(14,3) not null default 0,
  add column if not exists precio_unitario numeric(14,4),
  add column if not exists moneda text,
  add column if not exists devolucion_de uuid references public.movimientos_materiales(id) on delete restrict;
alter table public.requerimiento_material_detalles add column if not exists cantidad_stock numeric(14,3);

alter table public.movimientos_materiales drop constraint if exists ck_movimiento_material_origen;
alter table public.movimientos_materiales add constraint ck_movimiento_material_origen check (
  (tipo = 'INGRESO' and responsable_id is null and nullif(btrim(documento_referencia),'') is not null
    and ((orden_compra_detalle_id is not null and requerimiento_detalle_id is not null and origen='COMPRA')
      or (orden_compra_detalle_id is null and material_id is not null and origen in ('SALDO_INICIAL','INGRESO_GENERAL','DEVOLUCION'))))
  or (tipo='DESPACHO' and requerimiento_detalle_id is not null and orden_compra_detalle_id is null and responsable_id is not null)
);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='ck_movimiento_material_valores' and conrelid='public.movimientos_materiales'::regclass) then
    alter table public.movimientos_materiales add constraint ck_movimiento_material_valores check (
      cantidad_de_stock between 0 and cantidad and (precio_unitario is null or precio_unitario>=0)
      and (moneda is null or moneda in ('PEN','USD'))
      and (origen<>'DEVOLUCION' or devolucion_de is not null)
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='ck_requerimiento_reserva' and conrelid='public.requerimiento_material_detalles'::regclass) then
    alter table public.requerimiento_material_detalles add constraint ck_requerimiento_reserva
      check (cantidad_stock between 0 and cantidad_solicitada);
  end if;
end $$;
-- Las consultas del kardex y las reservas filtran por material. No existe
-- otro índice con material_id como primera columna en movimientos.
create index if not exists idx_movimientos_material_directo on public.movimientos_materiales(material_id,registrado_en);
create unique index if not exists idx_movimientos_foto on public.movimientos_materiales(foto_ruta) where foto_ruta is not null;
create index if not exists idx_movimientos_devolucion on public.movimientos_materiales(devolucion_de) where devolucion_de is not null;

create or replace function public.identificar_material_movimiento()
returns trigger language plpgsql set search_path='public' as $$
declare v_material uuid;
begin
  if new.requerimiento_detalle_id is not null then
    select om.material_id into v_material from public.requerimiento_material_detalles d
      join public.ot_materiales om on om.id=d.ot_material_id where d.id=new.requerimiento_detalle_id;
    if new.material_id is not null and new.material_id<>v_material then raise exception 'El material no coincide con la solicitud.'; end if;
    new.material_id:=v_material;
  end if;
  if new.material_id is null then raise exception 'Identifica el material del movimiento.'; end if;
  perform 1 from public.materiales where id=new.material_id for update;
  if new.tipo='INGRESO' and new.origen='COMPRA' then
    select d.precio_unitario,c.moneda into new.precio_unitario,new.moneda
      from public.orden_compra_material_detalles d join public.ordenes_compra_materiales c on c.id=d.orden_compra_id
      where d.id=new.orden_compra_detalle_id;
  end if;
  return new;
end $$;
revoke all on function public.identificar_material_movimiento() from public,anon,authenticated;
drop trigger if exists trg_identificar_material_movimiento on public.movimientos_materiales;
create trigger trg_identificar_material_movimiento before insert on public.movimientos_materiales
for each row execute function public.identificar_material_movimiento();

create or replace function public.fn_recepcion_compra_entregada()
returns trigger language plpgsql set search_path='public' as $$
begin
  if new.tipo='INGRESO' and new.origen='COMPRA' and not exists (
    select 1 from public.orden_compra_material_detalles d join public.ordenes_compra_materiales c on c.id=d.orden_compra_id
    where d.id=new.orden_compra_detalle_id and c.entregado_almacen_en is not null
  ) then raise exception 'Logística debe marcar la entrega de la compra a Almacén antes de recibirla.'; end if;
  return new;
end $$;
revoke all on function public.fn_recepcion_compra_entregada() from public,anon,authenticated;

create or replace function public.saldo_registrado_material(p_material uuid)
returns numeric language plpgsql stable security definer set search_path='public' as $$
begin
  perform public.exigir_permiso('almacen.ver');
  return coalesce((select sum(case when mov.tipo='INGRESO' then mov.cantidad else -mov.cantidad end)
    from public.movimientos_materiales mov
    left join public.requerimiento_material_detalles d on d.id=mov.requerimiento_detalle_id
    left join public.ot_materiales om on om.id=d.ot_material_id
    where coalesce(mov.material_id,om.material_id)=p_material),0)
    + coalesce((select sum(c.ajuste) from public.conteos_inventario c where c.material_id=p_material),0);
end $$;
revoke all on function public.saldo_registrado_material(uuid) from public,anon;
grant execute on function public.saldo_registrado_material(uuid) to authenticated;

create or replace view public.v_existencias_materiales with(security_invoker=true) as
with movimientos as (
  select coalesce(mov.material_id,om.material_id) material_id,
    sum(case when mov.tipo='INGRESO' then mov.cantidad else -mov.cantidad end) saldo
  from public.movimientos_materiales mov
  left join public.requerimiento_material_detalles d on d.id=mov.requerimiento_detalle_id
  left join public.ot_materiales om on om.id=d.ot_material_id group by coalesce(mov.material_id,om.material_id)
), conteos as (select material_id,sum(ajuste) ajuste from public.conteos_inventario group by material_id),
reservas as (
  select om.material_id,sum(greatest(coalesce(d.cantidad_stock,case when d.decision_almacen='STOCK' then d.cantidad_solicitada else 0 end)+coalesce(s.ingresado,0)-coalesce(s.cantidad,0),0)) reservado
  from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id
  join public.ordenes_trabajo ot on ot.id=om.orden_id
  left join lateral(select sum(x.cantidad) filter(where x.tipo='DESPACHO') cantidad,
      sum(x.cantidad) filter(where x.tipo='INGRESO' and x.origen='COMPRA') ingresado
    from public.movimientos_materiales x where x.requerimiento_detalle_id=d.id) s on true
  where ot.estado::text<>'ANULADA' and d.decision_almacen in ('STOCK','COMPRA') group by om.material_id
)
select mat.id material_id,mat.codigo,mat.descripcion,um.codigo unidad,
  (coalesce(m.saldo,0)+coalesce(c.ajuste,0))::public.cantidad existencia,
  coalesce(r.reservado,0)::numeric reservado,
  greatest(coalesce(m.saldo,0)+coalesce(c.ajuste,0)-coalesce(r.reservado,0),0)::numeric disponible
from public.materiales mat left join public.unidades_medida um on um.id=mat.unidad_medida_id
left join movimientos m on m.material_id=mat.id left join conteos c on c.material_id=mat.id left join reservas r on r.material_id=mat.id
where mat.activo and (m.material_id is not null or c.material_id is not null or r.material_id is not null);
revoke all on public.v_existencias_materiales from public,anon;
grant select on public.v_existencias_materiales to authenticated;

create or replace function public.registrar_ingreso_almacen(p_id uuid,p_material uuid,p_cantidad numeric,p_origen text,p_documento text,p_precio numeric,p_moneda text,p_devolucion uuid default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_existente public.movimientos_materiales%rowtype; v_original public.movimientos_materiales%rowtype; v_devuelto numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad<=0 or p_cantidad<>round(p_cantidad,3)
     or p_origen is null or p_origen not in ('SALDO_INICIAL','INGRESO_GENERAL','DEVOLUCION')
     or length(btrim(coalesce(p_documento,''))) not between 2 and 100
     or (p_precio is not null and (p_precio<0 or p_precio<>round(p_precio,4))) or p_moneda is null or p_moneda not in ('PEN','USD') then
    raise exception 'Indica material, cantidad, origen, documento y precio válidos.';
  end if;
  perform 1 from public.materiales where id=p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;
  select * into v_existente from public.movimientos_materiales where id=p_id;
  if found then
    if v_existente.registrado_por=public.usuario_actual() and v_existente.material_id=p_material and v_existente.cantidad=p_cantidad
      and v_existente.origen=p_origen and v_existente.documento_referencia=btrim(p_documento)
      and v_existente.precio_unitario is not distinct from p_precio and v_existente.moneda=p_moneda
      and v_existente.devolucion_de is not distinct from p_devolucion then return p_id; end if;
    raise exception 'El ingreso ya existe con otros datos. Recarga antes de volver a intentar.';
  end if;
  if p_origen='DEVOLUCION' then
    select * into v_original from public.movimientos_materiales where id=p_devolucion and tipo='DESPACHO' and material_id=p_material for update;
    if not found then raise exception 'Selecciona el despacho original de este material.'; end if;
    select coalesce(sum(cantidad),0) into v_devuelto from public.movimientos_materiales where devolucion_de=p_devolucion;
    if v_devuelto+p_cantidad>v_original.cantidad then raise exception 'La devolución supera lo entregado en el despacho original.'; end if;
    p_precio:=v_original.precio_unitario;
    p_moneda:=coalesce(v_original.moneda,p_moneda);
  elsif p_devolucion is not null then raise exception 'Solo una devolución puede vincularse a un despacho.';
  end if;
  insert into public.movimientos_materiales(id,tipo,material_id,cantidad,origen,documento_referencia,registrado_por,precio_unitario,moneda,devolucion_de)
    values(p_id,'INGRESO',p_material,p_cantidad,p_origen,btrim(p_documento),public.usuario_actual(),p_precio,p_moneda,p_devolucion);
  return p_id;
end $$;
revoke all on function public.registrar_ingreso_almacen(uuid,uuid,numeric,text,text,numeric,text,uuid) from public,anon;
grant execute on function public.registrar_ingreso_almacen(uuid,uuid,numeric,text,text,numeric,text,uuid) to authenticated;

create or replace function public.revisar_stock_requerimiento(p_detalle uuid,p_decision text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_material uuid; v_cantidad numeric; v_actual text; v_libre numeric; v_reserva numeric;
begin
  perform public.exigir_permiso('almacen.ver');
  if p_decision is null or p_decision not in ('STOCK','COMPRA') then raise exception 'Elige stock o derivar el faltante a Logística.'; end if;
  select om.material_id,d.cantidad_solicitada,d.decision_almacen into v_material,v_cantidad,v_actual
    from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id
    join public.ordenes_trabajo ot on ot.id=om.orden_id
    where d.id=p_detalle and d.aprobacion_diseno='APROBADO' and ot.estado::text<>'ANULADA' for update of d;
  if not found then raise exception 'Diseño debe aprobar el material antes de revisar el stock.'; end if;
  perform 1 from public.materiales where id=v_material for update;
  if v_actual=p_decision then return p_detalle; end if;
  if v_actual<>'PENDIENTE' and (v_actual<>'COMPRA' or p_decision<>'STOCK'
    or exists(select 1 from public.orden_compra_material_detalles where requerimiento_detalle_id=p_detalle)
    or exists(select 1 from public.movimientos_materiales where requerimiento_detalle_id=p_detalle)) then
    raise exception 'La revisión ya tiene una compra o despacho. Consulta su seguimiento.';
  end if;
  select coalesce(sum(greatest(coalesce(d.cantidad_stock,case when d.decision_almacen='STOCK' then d.cantidad_solicitada else 0 end)+coalesce(s.ingresado,0)-coalesce(s.cantidad,0),0)),0)
    into v_reserva from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id
    join public.ordenes_trabajo ot on ot.id=om.orden_id
    left join lateral(select sum(x.cantidad) filter(where x.tipo='DESPACHO') cantidad,
        sum(x.cantidad) filter(where x.tipo='INGRESO' and x.origen='COMPRA') ingresado
      from public.movimientos_materiales x where x.requerimiento_detalle_id=d.id) s on true
    where om.material_id=v_material and d.id<>p_detalle and d.decision_almacen in ('STOCK','COMPRA') and ot.estado::text<>'ANULADA';
  v_libre:=greatest(public.saldo_registrado_material(v_material)-v_reserva,0);
  if p_decision='STOCK' and v_libre<v_cantidad then raise exception 'Stock libre: %. Reserva lo disponible y deriva el faltante a Logística.',v_libre; end if;
  if p_decision='COMPRA' and v_libre>=v_cantidad then raise exception 'Hay stock suficiente. Atiende la solicitud desde Almacén.'; end if;
  update public.requerimiento_material_detalles set decision_almacen=p_decision,cantidad_stock=least(v_libre,v_cantidad),revisado_por=public.usuario_actual(),revisado_en=now() where id=p_detalle;
  return p_detalle;
end $$;
revoke all on function public.revisar_stock_requerimiento(uuid,text) from public,anon;
grant execute on function public.revisar_stock_requerimiento(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('evidencias-almacen','evidencias-almacen',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
drop policy if exists almacen_subir_evidencia on storage.objects;
create policy almacen_subir_evidencia on storage.objects for insert to authenticated with check(
  bucket_id='evidencias-almacen' and owner_id=(select auth.uid())::text
  and (select public.tiene_permiso('almacen.despachar')) and split_part(name,'/',1)=(select auth.uid())::text);
drop policy if exists almacen_leer_evidencia on storage.objects;
create policy almacen_leer_evidencia on storage.objects for select to authenticated using(
  bucket_id='evidencias-almacen' and ((owner_id=(select auth.uid())::text and (select public.tiene_permiso('almacen.despachar')))
    or exists(select 1 from public.movimientos_materiales m where m.foto_ruta=objects.name)));
drop policy if exists almacen_retirar_evidencia_suelta on storage.objects;
create policy almacen_retirar_evidencia_suelta on storage.objects for delete to authenticated using(
  bucket_id='evidencias-almacen' and owner_id=(select auth.uid())::text
  and not exists(select 1 from public.movimientos_materiales m where m.foto_ruta=objects.name));

create or replace function public.despachar_material_con_foto(p_id uuid,p_detalle uuid,p_cantidad numeric,p_responsable uuid,p_recibe text,p_foto text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_material uuid; v_area text; v_solicitada numeric; v_reserva numeric; v_despachada numeric; v_de_stock numeric;
  v_recibida numeric; v_salida_stock numeric; v_stock numeric; v_objeto storage.objects%rowtype; v_existente public.movimientos_materiales%rowtype;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_cantidad is null or p_cantidad<=0 or p_cantidad<>round(p_cantidad,3)
    or length(btrim(coalesce(p_recibe,''))) not between 3 and 160
    or p_foto is null or p_foto not in (auth.uid()::text||'/'||p_id::text||'.jpg',auth.uid()::text||'/'||p_id::text||'.png',auth.uid()::text||'/'||p_id::text||'.webp') then
    raise exception 'Indica cantidad, destinatario y foto de esta entrega.';
  end if;
  select om.material_id,r.area_destino,d.cantidad_solicitada,coalesce(d.cantidad_stock,case when d.decision_almacen='STOCK' then d.cantidad_solicitada else 0 end)
    into v_material,v_area,v_solicitada,v_reserva from public.requerimiento_material_detalles d
    join public.requerimientos_materiales r on r.id=d.requerimiento_id join public.ot_materiales om on om.id=d.ot_material_id
    join public.ordenes_trabajo ot on ot.id=r.orden_id
    where d.id=p_detalle and d.aprobacion_diseno='APROBADO' and d.decision_almacen in ('STOCK','COMPRA') and ot.estado::text<>'ANULADA' for update of d;
  if not found then raise exception 'Diseño y Almacén deben revisar el material antes de despacharlo.'; end if;
  perform 1 from public.materiales where id=v_material for update;
  select * into v_existente from public.movimientos_materiales where id=p_id;
  if found then
    if v_existente.registrado_por=public.usuario_actual() and v_existente.requerimiento_detalle_id=p_detalle and v_existente.cantidad=p_cantidad
      and v_existente.responsable_id=p_responsable and v_existente.foto_ruta=p_foto and v_existente.recibido_por_nombre=btrim(p_recibe) then return p_id; end if;
    raise exception 'Ese despacho ya existe con otros datos. Recarga la solicitud.';
  end if;
  select * into v_objeto from storage.objects where bucket_id='evidencias-almacen' and name=p_foto;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text or v_objeto.metadata->>'mimetype' not in ('image/jpeg','image/png','image/webp')
    or coalesce((v_objeto.metadata->>'size')::bigint,0) not between 1 and 10485760 then raise exception 'Carga una foto válida antes de confirmar el despacho.'; end if;
  select coalesce(sum(cantidad) filter(where tipo='DESPACHO'),0),coalesce(sum(cantidad) filter(where tipo='INGRESO'),0),
    coalesce(sum(cantidad_de_stock) filter(where tipo='DESPACHO'),0) into v_despachada,v_recibida,v_salida_stock
    from public.movimientos_materiales where requerimiento_detalle_id=p_detalle;
  v_de_stock:=least(p_cantidad,greatest(v_reserva-v_salida_stock,0));
  if p_cantidad>v_solicitada-v_despachada then raise exception 'La entrega supera la cantidad solicitada.'; end if;
  if p_cantidad-v_de_stock>v_recibida-(v_despachada-v_salida_stock) then raise exception 'Confirma la recepción de la compra antes de entregar el faltante.'; end if;
  if not exists(select 1 from public.usuarios u join public.areas a on a.id=u.area_id where u.id=p_responsable and u.activo and a.codigo=v_area) then
    raise exception 'El destinatario debe pertenecer al área que solicitó el material.';
  end if;
  v_stock:=public.saldo_registrado_material(v_material);
  if p_cantidad>v_stock then raise exception 'No hay saldo físico suficiente para este despacho.'; end if;
  insert into public.movimientos_materiales(id,tipo,requerimiento_detalle_id,material_id,cantidad,responsable_id,registrado_por,
    origen,cantidad_de_stock,foto_ruta,recibido_por_nombre)
    values(p_id,'DESPACHO',p_detalle,v_material,p_cantidad,p_responsable,public.usuario_actual(),'DESPACHO',v_de_stock,p_foto,btrim(p_recibe));
  return p_id;
end $$;
revoke all on function public.despachar_material_con_foto(uuid,uuid,numeric,uuid,text,text) from public,anon;
grant execute on function public.despachar_material_con_foto(uuid,uuid,numeric,uuid,text,text) to authenticated;
-- La función antigua se retirará de authenticated después del despliegue del
-- formulario con foto; hasta entonces se conserva compatibilidad de lectura.
