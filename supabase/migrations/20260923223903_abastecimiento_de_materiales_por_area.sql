-- Diseño hoy define qué materiales lleva cada OT, pero esa lista se detiene
-- antes de Requerimientos, Logística y Almacén. Este circuito conserva el plano
-- y el área destino desde el origen, sigue compras parciales y registra cada
-- ingreso y despacho en un kardex inmutable. No registra costos ni cambia
-- inventario fuera de las funciones transaccionales de abajo.

alter table public.ot_materiales add column if not exists area_destino text;

update public.ot_materiales m
   set area_destino = case upper(coalesce(a.codigo, ''))
     when 'MTZ' then 'MTZ'
     when 'ACB' then 'ACB'
     else 'PRD'
   end
  from public.ot_etapas e
  join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
  join public.areas a on a.id = ec.area_id
 where m.etapa_id = e.id and m.area_destino is null;

update public.ot_materiales set area_destino = 'PRD' where area_destino is null;
alter table public.ot_materiales alter column area_destino set default 'PRD';
alter table public.ot_materiales alter column area_destino set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.ot_materiales'::regclass
       and conname = 'ck_ot_materiales_area_destino'
  ) then
    alter table public.ot_materiales add constraint ck_ot_materiales_area_destino
      check (area_destino in ('MTZ', 'PRD', 'ACB'));
  end if;
end $$;

comment on column public.ot_materiales.area_destino is
  'Área que debe recibir el material de esta línea: MTZ (Maestranza), PRD (Producción) o ACB (Acabados).';

create or replace view public.v_ot_materiales as
select m.id,
       m.orden_id,
       m.plano_id,
       p.numero_plano,
       p.nombre as plano_nombre,
       m.etapa_id,
       ec.nombre as etapa,
       a.nombre as area,
       m.material_id,
       mat.codigo as material_codigo,
       mat.descripcion as material,
       mat.especificacion_tecnica,
       um.codigo as unidad,
       m.cantidad,
       m.observacion,
       m.creado_por,
       m.creado_en,
       m.area_destino
  from public.ot_materiales m
  join public.materiales mat on mat.id = m.material_id
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
  left join public.ot_planos p on p.id = m.plano_id
  left join public.ot_etapas e on e.id = m.etapa_id
  left join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
  left join public.areas a on a.id = ec.area_id;
comment on view public.v_ot_materiales is
  'Materiales definidos por Diseño para la OT, vinculados a plano, etapa y área que debe recibirlos.';
alter view public.v_ot_materiales set (security_invoker = on);
revoke all on public.v_ot_materiales from public, anon, authenticated;
grant select on public.v_ot_materiales to authenticated;

insert into public.permisos (codigo, modulo, descripcion) values
  ('requerimientos.ver', 'Requerimientos', 'Consultar materiales solicitados para las órdenes de trabajo'),
  ('requerimientos.crear', 'Requerimientos', 'Solicitar al almacén los materiales definidos por Diseño'),
  ('compras.ver', 'Logística', 'Consultar compras de materiales y sus entregas'),
  ('compras.crear', 'Logística', 'Registrar órdenes de compra de materiales'),
  ('almacen.ver', 'Almacén', 'Consultar existencias y movimientos de materiales'),
  ('almacen.recibir', 'Almacén', 'Registrar la llegada de materiales comprados'),
  ('almacen.despachar', 'Almacén', 'Entregar materiales a la persona responsable de un área')
on conflict (codigo) do update
  set modulo = excluded.modulo, descripcion = excluded.descripcion;

with asignaciones(rol, permiso) as (
  values
    ('DISENO', 'requerimientos.ver'), ('DISENO', 'requerimientos.crear'),
    ('SUPERVISOR', 'requerimientos.ver'), ('SUPERVISOR', 'requerimientos.crear'),
    ('JEFE_PRODUCCION', 'requerimientos.ver'), ('JEFE_PRODUCCION', 'requerimientos.crear'),
    ('JEFE_TALLER', 'requerimientos.ver'), ('JEFE_TALLER', 'requerimientos.crear'),
    ('GERENTE', 'requerimientos.ver'), ('GERENTE', 'requerimientos.crear'),
    ('GERENTE', 'compras.ver'), ('GERENTE', 'compras.crear'),
    ('GERENTE', 'almacen.ver'), ('GERENTE', 'almacen.recibir'), ('GERENTE', 'almacen.despachar'),
    ('ALMACENERO', 'requerimientos.ver'), ('ALMACENERO', 'compras.ver'),
    ('ALMACENERO', 'almacen.ver'), ('ALMACENERO', 'almacen.recibir'), ('ALMACENERO', 'almacen.despachar'),
    ('COMPRADOR', 'requerimientos.ver'), ('COMPRADOR', 'compras.ver'), ('COMPRADOR', 'compras.crear')
)
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, a.permiso
  from asignaciones a join public.roles r on r.codigo = a.rol
on conflict do nothing;

create table if not exists public.requerimientos_materiales (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  area_destino text not null check (area_destino in ('MTZ', 'PRD', 'ACB')),
  solicitado_por uuid not null default public.usuario_actual()
    references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_requerimiento_material_area unique (orden_id, area_destino)
);
comment on table public.requerimientos_materiales is
  'Solicitud por OT y área. Sus líneas nacen de la lista técnica de Diseño y mantienen el destino de taller.';

create table if not exists public.requerimiento_material_detalles (
  id uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.requerimientos_materiales(id) on delete restrict,
  ot_material_id uuid not null references public.ot_materiales(id) on delete restrict,
  cantidad_solicitada public.cantidad not null check (cantidad_solicitada > 0),
  creado_en timestamptz not null default now(),
  constraint uq_requerimiento_material_origen unique (ot_material_id),
  constraint uq_requerimiento_material_detalle unique (id, requerimiento_id)
);
comment on table public.requerimiento_material_detalles is
  'Cantidad solicitada por línea de plano. Una línea de Diseño se solicita una sola vez y queda congelada al entrar al circuito.';

create table if not exists public.ordenes_compra_materiales (
  id uuid primary key default gen_random_uuid(),
  requerimiento_id uuid not null references public.requerimientos_materiales(id) on delete restrict,
  proveedor text not null check (length(btrim(proveedor)) between 2 and 160),
  referencia text not null check (length(btrim(referencia)) between 2 and 100),
  fecha_estimada date,
  creado_por uuid not null default public.usuario_actual()
    references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  constraint uq_oc_material_referencia unique (proveedor, referencia),
  constraint uq_oc_material_id_req unique (id, requerimiento_id)
);
comment on table public.ordenes_compra_materiales is
  'Seguimiento de la compra emitida por Logística. referencia conserva el número del documento del proveedor o de su orden.';

create table if not exists public.orden_compra_material_detalles (
  id uuid primary key default gen_random_uuid(),
  orden_compra_id uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
  requerimiento_id uuid not null references public.requerimientos_materiales(id) on delete restrict,
  requerimiento_detalle_id uuid not null references public.requerimiento_material_detalles(id) on delete restrict,
  cantidad public.cantidad not null check (cantidad > 0),
  creado_en timestamptz not null default now(),
  constraint uq_oc_material_linea unique (orden_compra_id, requerimiento_detalle_id),
  constraint uq_oc_material_detalle unique (id, requerimiento_detalle_id),
  constraint fk_oc_material_header_req foreign key (orden_compra_id, requerimiento_id)
    references public.ordenes_compra_materiales(id, requerimiento_id) on delete restrict,
  constraint fk_oc_material_req_linea foreign key (requerimiento_detalle_id, requerimiento_id)
    references public.requerimiento_material_detalles(id, requerimiento_id) on delete restrict
);

create table if not exists public.movimientos_materiales (
  id uuid primary key,
  tipo text not null check (tipo in ('INGRESO', 'DESPACHO')),
  requerimiento_detalle_id uuid not null references public.requerimiento_material_detalles(id) on delete restrict,
  orden_compra_detalle_id uuid,
  cantidad public.cantidad not null check (cantidad > 0),
  documento_referencia text,
  responsable_id uuid references public.usuarios(id) on delete restrict,
  registrado_por uuid not null default public.usuario_actual()
    references public.usuarios(id) on delete restrict,
  registrado_en timestamptz not null default now(),
  constraint fk_mov_material_oc foreign key (orden_compra_detalle_id, requerimiento_detalle_id)
    references public.orden_compra_material_detalles(id, requerimiento_detalle_id) on delete restrict,
  constraint ck_movimiento_material_origen check (
    (tipo = 'INGRESO' and orden_compra_detalle_id is not null and responsable_id is null
      and nullif(btrim(documento_referencia), '') is not null)
    or
    (tipo = 'DESPACHO' and orden_compra_detalle_id is null and responsable_id is not null)
  )
);
comment on table public.movimientos_materiales is
  'Kardex inmutable por OT y material. Un ingreso acredita una compra recibida; un despacho descuenta stock y registra a quién se entregó.';

create index if not exists ix_requerimientos_materiales_area_fecha on public.requerimientos_materiales(area_destino, creado_en desc);
create index if not exists ix_req_material_detalle_req on public.requerimiento_material_detalles(requerimiento_id);
create index if not exists ix_oc_material_req on public.ordenes_compra_materiales(requerimiento_id);
create index if not exists ix_oc_material_detalle_oc on public.orden_compra_material_detalles(orden_compra_id);
create index if not exists ix_oc_material_detalle_req on public.orden_compra_material_detalles(requerimiento_detalle_id);
create index if not exists ix_movimientos_materiales_req on public.movimientos_materiales(requerimiento_detalle_id, registrado_en desc);
create index if not exists ix_movimientos_materiales_oc on public.movimientos_materiales(orden_compra_detalle_id)
  where orden_compra_detalle_id is not null;

do $$ declare t text;
begin
  foreach t in array array[
    'requerimientos_materiales', 'requerimiento_material_detalles',
    'ordenes_compra_materiales', 'orden_compra_material_detalles'
  ] loop
    perform public.activar_timestamps(t);
    perform public.activar_auditoria(t);
    perform public.activar_registro_de_prueba(t);
  end loop;
  perform public.activar_registro_de_prueba('movimientos_materiales');
end $$;

alter table public.requerimientos_materiales enable row level security;
alter table public.requerimiento_material_detalles enable row level security;
alter table public.ordenes_compra_materiales enable row level security;
alter table public.orden_compra_material_detalles enable row level security;
alter table public.movimientos_materiales enable row level security;

create or replace function public.puede_ver_area_material(p_area text)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.es_admin()
    or public.tiene_permiso('diseno.planos')
    or public.tiene_permiso('produccion.cualquier_area')
    or public.tiene_permiso('almacen.ver')
    or public.tiene_permiso('compras.ver')
    or exists (
      select 1 from public.usuarios u join public.areas a on a.id = u.area_id
       where u.id = public.usuario_actual() and u.activo and a.codigo = p_area
    );
$$;
revoke all on function public.puede_ver_area_material(text) from public, anon;
grant execute on function public.puede_ver_area_material(text) to authenticated;

drop policy if exists ver_requerimientos_materiales on public.requerimientos_materiales;
create policy ver_requerimientos_materiales on public.requerimientos_materiales
  for select to authenticated using (
    public.tiene_permiso('requerimientos.ver') and public.puede_ver_area_material(area_destino)
  );
drop policy if exists ver_requerimiento_material_detalles on public.requerimiento_material_detalles;
create policy ver_requerimiento_material_detalles on public.requerimiento_material_detalles
  for select to authenticated using (exists (
    select 1 from public.requerimientos_materiales r
     where r.id = requerimiento_id
       and public.tiene_permiso('requerimientos.ver')
       and public.puede_ver_area_material(r.area_destino)
  ));
drop policy if exists ver_ordenes_compra_materiales on public.ordenes_compra_materiales;
create policy ver_ordenes_compra_materiales on public.ordenes_compra_materiales
  for select to authenticated using (
    (public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir'))
    and exists (select 1 from public.requerimientos_materiales r
      where r.id = requerimiento_id and public.puede_ver_area_material(r.area_destino))
  );
drop policy if exists ver_orden_compra_material_detalles on public.orden_compra_material_detalles;
create policy ver_orden_compra_material_detalles on public.orden_compra_material_detalles
  for select to authenticated using (exists (
    select 1 from public.ordenes_compra_materiales oc
    join public.requerimientos_materiales r on r.id = oc.requerimiento_id
    where oc.id = orden_compra_id
      and (public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir'))
      and public.puede_ver_area_material(r.area_destino)
  ));
drop policy if exists ver_movimientos_materiales on public.movimientos_materiales;
create policy ver_movimientos_materiales on public.movimientos_materiales
  for select to authenticated using (
    public.tiene_permiso('almacen.ver') or (
      public.tiene_permiso('requerimientos.ver') and exists (
      select 1 from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      where d.id = requerimiento_detalle_id and public.puede_ver_area_material(r.area_destino)
    ))
  );

revoke all on public.requerimientos_materiales, public.requerimiento_material_detalles,
  public.ordenes_compra_materiales, public.orden_compra_material_detalles,
  public.movimientos_materiales from public, anon, authenticated;
grant select on public.requerimientos_materiales, public.requerimiento_material_detalles,
  public.ordenes_compra_materiales, public.orden_compra_material_detalles,
  public.movimientos_materiales to authenticated;

create or replace function public.crear_requerimiento_material(
  p_orden_id uuid, p_area_destino text, p_materiales uuid[]
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_requerimiento uuid; v_insertados integer;
begin
  perform public.exigir_permiso('requerimientos.crear');
  if p_area_destino not in ('MTZ', 'PRD', 'ACB') or coalesce(cardinality(p_materiales), 0) = 0
     or cardinality(p_materiales) > 100 then
    raise exception 'Elige un área y al menos un material de la orden.' using errcode = 'check_violation';
  end if;
  if not public.puede_ver_area_material(p_area_destino) then
    raise exception 'Solo puedes solicitar materiales para tu área.' using errcode = 'insufficient_privilege';
  end if;
  if (select count(distinct x) from unnest(p_materiales) x) <> cardinality(p_materiales) then
    raise exception 'Hay materiales repetidos en la solicitud.' using errcode = 'unique_violation';
  end if;
  if not exists (select 1 from public.ordenes_trabajo o where o.id = p_orden_id and o.estado::text <> 'ANULADA') then
    raise exception 'La orden no existe o está anulada.' using errcode = 'foreign_key_violation';
  end if;
  if (select count(*) from public.ot_materiales m
       where m.id = any(p_materiales) and m.orden_id = p_orden_id and m.area_destino = p_area_destino)
       <> cardinality(p_materiales) then
    raise exception 'Cada material debe pertenecer a esta orden y al área elegida.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.requerimiento_material_detalles d
      where d.ot_material_id = any(p_materiales)
        and not exists (select 1 from public.requerimientos_materiales r
          where r.id = d.requerimiento_id and r.orden_id = p_orden_id and r.area_destino = p_area_destino)) then
    raise exception 'Uno de los materiales ya fue solicitado para otra área u orden.' using errcode = 'unique_violation';
  end if;

  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (p_orden_id, p_area_destino, public.usuario_actual())
  on conflict (orden_id, area_destino) do update set actualizado_en = now()
  returning id into v_requerimiento;

  insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
  select v_requerimiento, m.id, m.cantidad from public.ot_materiales m
   where m.id = any(p_materiales)
  on conflict (ot_material_id) do nothing;
  get diagnostics v_insertados = row_count;
  if v_insertados = 0 and not exists (
    select 1 from public.requerimiento_material_detalles d
     where d.requerimiento_id = v_requerimiento and d.ot_material_id = any(p_materiales)
  ) then
    raise exception 'No se agregó ningún material al requerimiento.' using errcode = 'check_violation';
  end if;
  return v_requerimiento;
end;
$$;

create or replace function public.crear_orden_compra_material(
  p_id uuid, p_requerimiento_id uuid, p_proveedor text, p_referencia text,
  p_detalles jsonb, p_fecha_estimada date default null
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_orden uuid; v_linea record; v_pendiente numeric;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or length(btrim(coalesce(p_proveedor, ''))) not between 2 and 160
     or length(btrim(coalesce(p_referencia, ''))) not between 2 and 100
     or jsonb_typeof(p_detalles) <> 'array' or jsonb_array_length(p_detalles) = 0
     or jsonb_array_length(p_detalles) > 100 then
    raise exception 'Completa proveedor, referencia y líneas de compra.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_compra_materiales where id = p_id) then return p_id; end if;
  perform 1 from public.requerimientos_materiales where id = p_requerimiento_id for update;
  if not found then raise exception 'El requerimiento ya no está disponible.' using errcode = 'foreign_key_violation'; end if;
  if (select count(distinct x.id) from jsonb_to_recordset(p_detalles) as x(id uuid, cantidad numeric))
       <> jsonb_array_length(p_detalles) then
    raise exception 'Revisa que no haya líneas repetidas en la compra.' using errcode = 'unique_violation';
  end if;
  for v_linea in select * from jsonb_to_recordset(p_detalles) as x(id uuid, cantidad numeric) loop
    if v_linea.cantidad is null or v_linea.cantidad <= 0 then
      raise exception 'La cantidad comprada debe ser mayor que cero.' using errcode = 'check_violation';
    end if;
    perform 1 from public.requerimiento_material_detalles d
      where d.id = v_linea.id and d.requerimiento_id = p_requerimiento_id for update;
    if not found then raise exception 'La línea de material no pertenece a este requerimiento.' using errcode = 'foreign_key_violation'; end if;
    select d.cantidad_solicitada - coalesce(sum(ocd.cantidad), 0) into v_pendiente
      from public.requerimiento_material_detalles d
      left join public.orden_compra_material_detalles ocd on ocd.requerimiento_detalle_id = d.id
     where d.id = v_linea.id group by d.id;
    if v_linea.cantidad > v_pendiente then
      raise exception 'La cantidad excede lo que falta comprar de esta línea (%).', v_pendiente using errcode = 'check_violation';
    end if;
  end loop;
  insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, fecha_estimada, creado_por)
  values (p_id, p_requerimiento_id, btrim(p_proveedor), btrim(p_referencia), p_fecha_estimada, public.usuario_actual());
  insert into public.orden_compra_material_detalles
    (orden_compra_id, requerimiento_id, requerimiento_detalle_id, cantidad)
  select p_id, p_requerimiento_id, x.id, x.cantidad
    from jsonb_to_recordset(p_detalles) as x(id uuid, cantidad numeric);
  return p_id;
end;
$$;

create or replace function public.registrar_recepcion_material(
  p_id uuid, p_orden_compra_detalle_id uuid, p_cantidad public.cantidad,
  p_documento_referencia text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_req uuid; v_pendiente numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad <= 0
     or length(btrim(coalesce(p_documento_referencia, ''))) not between 2 and 100 then
    raise exception 'Indica una cantidad recibida y el documento del proveedor.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_materiales where id = p_id) then return p_id; end if;
  select requerimiento_detalle_id into v_req from public.orden_compra_material_detalles
   where id = p_orden_compra_detalle_id for update;
  if not found then raise exception 'La línea de compra no existe.' using errcode = 'foreign_key_violation'; end if;
  select ocd.cantidad - coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0)
    into v_pendiente from public.orden_compra_material_detalles ocd
    left join public.movimientos_materiales m on m.orden_compra_detalle_id = ocd.id
   where ocd.id = p_orden_compra_detalle_id group by ocd.id;
  if p_cantidad > v_pendiente then
    raise exception 'La recepción supera lo pendiente de esta compra (%).', v_pendiente using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, orden_compra_detalle_id, cantidad, documento_referencia, registrado_por)
  values (p_id, 'INGRESO', v_req, p_orden_compra_detalle_id, p_cantidad,
          btrim(p_documento_referencia), public.usuario_actual());
  return p_id;
end;
$$;

create or replace function public.despachar_material(
  p_id uuid, p_requerimiento_detalle_id uuid, p_cantidad public.cantidad,
  p_responsable_id uuid
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_material uuid; v_area text; v_solicitada numeric; v_recibida numeric; v_despachada numeric; v_stock numeric;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_cantidad is null or p_cantidad <= 0 or p_responsable_id is null then
    raise exception 'Indica la cantidad y quién recibe el material.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_materiales where id = p_id) then return p_id; end if;
  select om.material_id, r.area_destino, d.cantidad_solicitada
    into v_material, v_area, v_solicitada
    from public.requerimiento_material_detalles d
    join public.requerimientos_materiales r on r.id = d.requerimiento_id
    join public.ot_materiales om on om.id = d.ot_material_id
   where d.id = p_requerimiento_detalle_id for update of d;
  if not found then raise exception 'La línea del requerimiento no existe.' using errcode = 'foreign_key_violation'; end if;
  perform 1 from public.materiales where id = v_material for update;
  select coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0),
         coalesce(sum(m.cantidad) filter (where m.tipo = 'DESPACHO'), 0)
    into v_recibida, v_despachada from public.movimientos_materiales m
    where m.requerimiento_detalle_id = p_requerimiento_detalle_id;
  if p_cantidad > v_recibida - v_despachada then
    raise exception 'No hay suficiente material recibido para este requerimiento.' using errcode = 'check_violation';
  end if;
  if p_cantidad > v_solicitada - v_despachada then
    raise exception 'La entrega supera la cantidad solicitada.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
      where u.id = p_responsable_id and u.activo and a.codigo = v_area) then
    raise exception 'La persona debe estar activa y pertenecer al área %.', v_area using errcode = 'check_violation';
  end if;
  select coalesce(sum(case when tipo = 'INGRESO' then cantidad else -cantidad end), 0)
    into v_stock from public.movimientos_materiales where exists (
      select 1 from public.requerimiento_material_detalles d
      join public.ot_materiales om on om.id = d.ot_material_id
      where d.id = movimientos_materiales.requerimiento_detalle_id and om.material_id = v_material
    );
  if p_cantidad > v_stock then
    raise exception 'El almacén no tiene saldo suficiente de este material.' using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, cantidad, responsable_id, registrado_por)
  values (p_id, 'DESPACHO', p_requerimiento_detalle_id, p_cantidad, p_responsable_id, public.usuario_actual());
  return p_id;
end;
$$;

revoke all on function public.crear_requerimiento_material(uuid, text, uuid[]) from public, anon;
revoke all on function public.crear_orden_compra_material(uuid, uuid, text, text, jsonb, date) from public, anon;
revoke all on function public.registrar_recepcion_material(uuid, uuid, public.cantidad, text) from public, anon;
revoke all on function public.despachar_material(uuid, uuid, public.cantidad, uuid) from public, anon;
grant execute on function public.crear_requerimiento_material(uuid, text, uuid[]) to authenticated;
grant execute on function public.crear_orden_compra_material(uuid, uuid, text, text, jsonb, date) to authenticated;
grant execute on function public.registrar_recepcion_material(uuid, uuid, public.cantidad, text) to authenticated;
grant execute on function public.despachar_material(uuid, uuid, public.cantidad, uuid) to authenticated;

create or replace view public.v_atencion_materiales with (security_invoker = true) as
select r.id as requerimiento_id, d.id as detalle_id, r.orden_id, o.numero as numero_ot,
       r.area_destino, d.ot_material_id, p.numero_plano, p.nombre as plano,
       m.material_id, mat.codigo as material_codigo, mat.descripcion as material,
       um.codigo as unidad,
       d.cantidad_solicitada,
       coalesce(compra.cantidad_comprada, 0)::public.cantidad as cantidad_comprada,
       coalesce(mov.cantidad_recibida, 0)::public.cantidad as cantidad_recibida,
       coalesce(mov.cantidad_despachada, 0)::public.cantidad as cantidad_despachada,
       case
         when coalesce(mov.cantidad_despachada, 0) >= d.cantidad_solicitada then 'ATENDIDO'
         when coalesce(mov.cantidad_recibida, 0) > coalesce(mov.cantidad_despachada, 0) then 'EN_ALMACEN'
         when coalesce(compra.cantidad_comprada, 0) > coalesce(mov.cantidad_recibida, 0) then 'EN_COMPRA'
         else 'SOLICITADO'
       end as estado,
       coalesce(entrega.responsables, '') as responsables,
       r.solicitado_por, r.creado_en
  from public.requerimientos_materiales r
  join public.requerimiento_material_detalles d on d.requerimiento_id = r.id
  join public.ot_materiales m on m.id = d.ot_material_id
  join public.materiales mat on mat.id = m.material_id
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
  join public.ordenes_trabajo o on o.id = r.orden_id
  left join public.ot_planos p on p.id = m.plano_id
  left join lateral (
    select sum(ocd.cantidad) as cantidad_comprada
      from public.orden_compra_material_detalles ocd
     where ocd.requerimiento_detalle_id = d.id
  ) compra on true
  left join lateral (
    select sum(x.cantidad) filter (where x.tipo = 'INGRESO') as cantidad_recibida,
           sum(x.cantidad) filter (where x.tipo = 'DESPACHO') as cantidad_despachada
      from public.movimientos_materiales x where x.requerimiento_detalle_id = d.id
  ) mov on true
  left join lateral (
    select string_agg(distinct u.nombres || ' ' || u.apellidos, ', ' order by u.nombres || ' ' || u.apellidos) as responsables
      from public.movimientos_materiales x join public.usuarios u on u.id = x.responsable_id
     where x.requerimiento_detalle_id = d.id and x.tipo = 'DESPACHO'
  ) entrega on true;
comment on view public.v_atencion_materiales is
  'Avance por línea desde diseño: solicitado, comprado, recibido, despachado, área y responsables. No expone importes.';
revoke all on public.v_atencion_materiales from public, anon, authenticated;
grant select on public.v_atencion_materiales to authenticated;

create or replace view public.v_existencias_materiales with (security_invoker = true) as
select om.material_id, mat.codigo, mat.descripcion, um.codigo as unidad,
       sum(case when m.tipo = 'INGRESO' then m.cantidad else -m.cantidad end)::public.cantidad as existencia
  from public.movimientos_materiales m
  join public.requerimiento_material_detalles d on d.id = m.requerimiento_detalle_id
  join public.ot_materiales om on om.id = d.ot_material_id
  join public.materiales mat on mat.id = om.material_id
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
 group by om.material_id, mat.codigo, mat.descripcion, um.codigo;
revoke all on public.v_existencias_materiales from public, anon, authenticated;
grant select on public.v_existencias_materiales to authenticated;

create or replace view public.v_orden_compra_material_pendiente with (security_invoker = true) as
select ocd.id, oc.requerimiento_id, ocd.requerimiento_detalle_id,
       oc.proveedor, oc.referencia, oc.fecha_estimada,
       ocd.cantidad as cantidad_comprada,
       coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0)::public.cantidad as cantidad_recibida,
       greatest(ocd.cantidad - coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0), 0)::public.cantidad as cantidad_pendiente
  from public.orden_compra_material_detalles ocd
  join public.ordenes_compra_materiales oc on oc.id = ocd.orden_compra_id
  left join public.movimientos_materiales m on m.orden_compra_detalle_id = ocd.id
 group by ocd.id, oc.requerimiento_id, ocd.requerimiento_detalle_id,
          oc.proveedor, oc.referencia, oc.fecha_estimada, ocd.cantidad;
revoke all on public.v_orden_compra_material_pendiente from public, anon, authenticated;
grant select on public.v_orden_compra_material_pendiente to authenticated;

drop policy if exists alcance_materiales_tecnicos on public.ot_materiales;
create policy alcance_materiales_tecnicos on public.ot_materiales as restrictive for select to authenticated
  using (public.puede_ver_area_material(area_destino));

create or replace function public.fn_ot_material_bloquear_edicion_solicitada()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.requerimiento_material_detalles d where d.ot_material_id = old.id) then
      raise exception 'Este material ya forma parte de un requerimiento. No se puede quitar de la lista de Diseño.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if exists (select 1 from public.requerimiento_material_detalles d where d.ot_material_id = old.id)
     and (new.material_id is distinct from old.material_id
       or new.cantidad is distinct from old.cantidad
       or new.observacion is distinct from old.observacion
       or new.area_destino is distinct from old.area_destino
       or new.plano_id is distinct from old.plano_id
       or new.etapa_id is distinct from old.etapa_id) then
    raise exception 'Este material ya forma parte de un requerimiento. No se puede cambiar su línea de Diseño.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_material_bloquear_edicion_solicitada() from public, anon, authenticated;
drop trigger if exists trg_ot_material_bloquear_edicion_solicitada on public.ot_materiales;
create trigger trg_ot_material_bloquear_edicion_solicitada
  before update or delete on public.ot_materiales
  for each row execute function public.fn_ot_material_bloquear_edicion_solicitada();
