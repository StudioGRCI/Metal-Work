-- Costos coordina materiales, controles de ingreso/salida y solicitudes a Tesorería.
-- Ninguno de estos permisos concede liberación financiera ni salida física.
insert into public.permisos (codigo, modulo, descripcion) values
  ('costos.controlar_ot', 'Costos', 'Registrar listas de ingreso y salida de una OT'),
  ('costos.solicitar_pago', 'Costos', 'Solicitar a Tesorería atención de pagos de materiales o salida'),
  ('costos.ver', 'Costos', 'Consultar controles y solicitudes de pago de una OT')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('COSTOS_MATERIALES', 'Costos y Materiales', 'Reporta materiales y prepara controles y solicitudes financieras; no aprueba pagos', 45, true),
  ('SUPERVISOR_GENERAL', 'Supervisor General Metal Work', 'Consulta transversal de la operación sin permisos de edición ni aprobación', 55, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
where (r.codigo = 'COSTOS_MATERIALES' and p.codigo in
  ('ordenes.listar', 'ordenes.ver', 'produccion.ver', 'requerimientos.ver',
   'almacen.ver', 'compras.ver', 'costos.ver', 'costos.controlar_ot', 'costos.solicitar_pago'))
   or (r.codigo = 'SUPERVISOR_GENERAL' and p.codigo in
  ('ordenes.listar', 'ordenes.ver', 'produccion.ver', 'requerimientos.ver',
   'almacen.ver', 'compras.ver', 'clientes.ver', 'cotizaciones.ver_pdf_comercial',
   'costos.ver', 'auditoria.ver'))
on conflict do nothing;

create table if not exists public.ot_checklists (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  tipo text not null check (tipo in ('INGRESO', 'SALIDA')),
  identidad_verificada boolean not null default false,
  documentos_verificados boolean not null default false,
  materiales_verificados boolean not null default false,
  condicion_verificada boolean not null default false,
  observacion text not null default '' check (length(observacion) <= 2000),
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  completado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (orden_id, tipo),
  constraint ck_checklist_completo check (
    completado_en is null or
    (identidad_verificada and documentos_verificados and materiales_verificados and condicion_verificada)
  )
);
create index if not exists idx_ot_checklists_registrado_por on public.ot_checklists(registrado_por);
alter table public.ot_checklists enable row level security;
revoke all on public.ot_checklists from public, anon, authenticated;
grant select, insert, update on public.ot_checklists to authenticated;
create policy ver_checklists on public.ot_checklists for select to authenticated
  using (public.puede_ver_orden(orden_id));
create policy crear_checklists on public.ot_checklists for insert to authenticated
  with check (public.tiene_permiso('costos.controlar_ot') and registrado_por = public.usuario_actual());
create policy editar_checklists on public.ot_checklists for update to authenticated
  using (public.tiene_permiso('costos.controlar_ot'))
  with check (public.tiene_permiso('costos.controlar_ot') and registrado_por = public.usuario_actual());

create or replace function public.fn_proteger_checklist_ot() returns trigger
language plpgsql set search_path = 'public' as $$
declare v_estado text;
begin
  select estado::text into v_estado from public.ordenes_trabajo where id = new.orden_id for share;
  if v_estado is null or v_estado in ('ANULADA', 'ENTREGADA', 'FACTURADA') then
    raise exception 'La lista no se puede modificar: la OT ya está cerrada o no existe.';
  end if;
  if tg_op = 'UPDATE' then
    if old.completado_en is not null then
      raise exception 'La lista completada no se modifica; registra una observación en la OT.';
    end if;
    new.orden_id := old.orden_id;
    new.tipo := old.tipo;
    new.registrado_por := old.registrado_por;
    new.creado_en := old.creado_en;
  end if;
  if new.identidad_verificada and new.documentos_verificados
     and new.materiales_verificados and new.condicion_verificada then
    new.completado_en := coalesce(new.completado_en, now());
  else
    new.completado_en := null;
  end if;
  return new;
end $$;
revoke all on function public.fn_proteger_checklist_ot() from public, anon, authenticated;
create trigger proteger_checklist_ot before insert or update on public.ot_checklists
for each row execute function public.fn_proteger_checklist_ot();
select public.activar_timestamps('ot_checklists');
select public.activar_auditoria('ot_checklists');

create table if not exists public.ot_solicitudes_tesoreria (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  tipo text not null check (tipo in ('MATERIALES', 'SALIDA_OT')),
  concepto text not null check (length(btrim(concepto)) between 10 and 1000),
  monto numeric(14,2),
  moneda text check (moneda in ('PEN', 'USD')),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'ATENDIDA', 'OBSERVADA')),
  respuesta text check (respuesta is null or length(btrim(respuesta)) between 3 and 2000),
  solicitado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  atendido_por uuid references public.usuarios(id) on delete restrict,
  atendido_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_solicitud_monto check (
    (tipo = 'MATERIALES' and monto > 0 and moneda is not null)
    or (tipo = 'SALIDA_OT' and monto is null and moneda is null)),
  constraint ck_solicitud_respuesta check (
    (estado = 'PENDIENTE' and respuesta is null and atendido_por is null and atendido_en is null)
    or (estado <> 'PENDIENTE' and respuesta is not null and atendido_por is not null and atendido_en is not null))
);
create index if not exists idx_solicitudes_tesoreria_orden on public.ot_solicitudes_tesoreria(orden_id, creado_en desc);
create index if not exists idx_solicitudes_tesoreria_pendientes on public.ot_solicitudes_tesoreria(creado_en)
  where estado = 'PENDIENTE';
create index if not exists idx_solicitudes_tesoreria_autor on public.ot_solicitudes_tesoreria(solicitado_por);
create index if not exists idx_solicitudes_tesoreria_atendedor on public.ot_solicitudes_tesoreria(atendido_por);
alter table public.ot_solicitudes_tesoreria enable row level security;
revoke all on public.ot_solicitudes_tesoreria from public, anon, authenticated;
grant select, insert, update on public.ot_solicitudes_tesoreria to authenticated;
create policy ver_solicitudes_tesoreria on public.ot_solicitudes_tesoreria for select to authenticated
  using (public.puede_ver_orden(orden_id) and
    (public.tiene_permiso('costos.ver') or public.tiene_permiso('tesoreria.ver_documentos') or public.es_admin()));
create policy crear_solicitudes_tesoreria on public.ot_solicitudes_tesoreria for insert to authenticated
  with check (public.tiene_permiso('costos.solicitar_pago') and solicitado_por = public.usuario_actual()
    and estado = 'PENDIENTE');
create policy responder_solicitudes_tesoreria on public.ot_solicitudes_tesoreria for update to authenticated
  using (public.tiene_permiso('tesoreria.liberar') and estado = 'PENDIENTE')
  with check (public.tiene_permiso('tesoreria.liberar') and atendido_por = public.usuario_actual()
    and estado in ('ATENDIDA', 'OBSERVADA'));

create or replace function public.fn_proteger_solicitud_tesoreria() returns trigger
language plpgsql set search_path = 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'SALIDA_OT' and not exists (
      select 1 from public.ot_checklists c where c.orden_id = new.orden_id
        and c.tipo = 'SALIDA' and c.completado_en is not null
    ) then
      raise exception 'Completa primero la lista de salida de la OT antes de solicitar su liberación.';
    end if;
    return new;
  end if;
  if old.estado <> 'PENDIENTE' or
    (to_jsonb(new) - array['estado','respuesta','atendido_por','atendido_en','actualizado_en'])
      is distinct from
    (to_jsonb(old) - array['estado','respuesta','atendido_por','atendido_en','actualizado_en']) then
    raise exception 'Tesorería solo puede responder una solicitud pendiente; el pedido original queda en el historial.';
  end if;
  new.atendido_por := public.usuario_actual();
  new.atendido_en := now();
  return new;
end $$;
revoke all on function public.fn_proteger_solicitud_tesoreria() from public, anon, authenticated;
create trigger proteger_solicitud_tesoreria before insert or update on public.ot_solicitudes_tesoreria
for each row execute function public.fn_proteger_solicitud_tesoreria();
select public.activar_timestamps('ot_solicitudes_tesoreria');
select public.activar_auditoria('ot_solicitudes_tesoreria');
