-- Cada área registra gastos externos de su OT. Costos suma solo los aprobados;
-- las compras de Almacén se valorizan al despachar y no se vuelven a cargar aquí.
insert into public.permisos (codigo, modulo, descripcion) values
  ('costos.registrar_gasto', 'Costos', 'Registrar comprobantes de gastos del área en la OT'),
  ('costos.revisar_gasto', 'Costos', 'Aprobar u observar gastos de las áreas')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
where (r.codigo = 'SUPERVISOR' and p.codigo = 'costos.registrar_gasto')
   or (r.codigo = 'ADMINISTRACION' and p.codigo in ('costos.ver','costos.revisar_gasto'))
on conflict do nothing;

create table if not exists public.ot_gastos_areas (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  area_id uuid not null references public.areas(id) on delete restrict,
  tipo text not null check (tipo in ('SERVICIO','TRANSPORTE','VIATICO','SUBCONTRATO','OTRO')),
  descripcion text not null check (length(btrim(descripcion)) between 10 and 500),
  fecha date not null,
  monto numeric(14,2) not null check (monto > 0),
  moneda text not null check (moneda in ('PEN','USD')),
  comprobante_ruta text not null,
  comprobante_nombre text not null check (length(btrim(comprobante_nombre)) between 1 and 200),
  estado text not null default 'PENDIENTE' check (estado in ('PENDIENTE','APROBADO','OBSERVADO')),
  observacion_revision text,
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  revisado_por uuid references public.usuarios(id) on delete restrict,
  revisado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_gasto_ruta check (comprobante_ruta like 'ot/' || orden_id::text || '/gastos/' || id::text || '.pdf'),
  constraint ck_gasto_revision check (
    (estado = 'PENDIENTE' and revisado_por is null and revisado_en is null and observacion_revision is null)
    or (estado = 'APROBADO' and revisado_por is not null and revisado_en is not null)
    or (estado = 'OBSERVADO' and revisado_por is not null and revisado_en is not null
        and length(btrim(coalesce(observacion_revision,''))) >= 5)
  ),
  unique (comprobante_ruta)
);
-- La pantalla filtra por OT; esta FK necesita el índice para no recorrer años de gastos.
create index if not exists idx_ot_gastos_orden_fecha on public.ot_gastos_areas(orden_id, fecha desc);
alter table public.ot_gastos_areas enable row level security;
revoke all on public.ot_gastos_areas from public, anon, authenticated;
grant select, insert, update on public.ot_gastos_areas to authenticated;
drop policy if exists ver_ot_gastos_areas on public.ot_gastos_areas;
create policy ver_ot_gastos_areas on public.ot_gastos_areas for select to authenticated
  using (public.puede_ver_orden(orden_id) and
    (public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.revisar_gasto')
     or (public.tiene_permiso('costos.registrar_gasto') and exists (
       select 1 from public.usuarios u where u.id = public.usuario_actual()
         and u.activo and u.area_id = ot_gastos_areas.area_id))));
drop policy if exists crear_ot_gastos_areas on public.ot_gastos_areas;
create policy crear_ot_gastos_areas on public.ot_gastos_areas for insert to authenticated
  with check (public.tiene_permiso('costos.registrar_gasto')
    and public.puede_ver_orden(orden_id)
    and registrado_por = public.usuario_actual()
    and estado = 'PENDIENTE'
    and exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
       where u.id = public.usuario_actual() and u.activo and u.area_id = ot_gastos_areas.area_id
         and a.codigo in ('PRD','MTZ','ACB')));
drop policy if exists revisar_ot_gastos_areas on public.ot_gastos_areas;
create policy revisar_ot_gastos_areas on public.ot_gastos_areas for update to authenticated
  using (public.tiene_permiso('costos.revisar_gasto') and estado = 'PENDIENTE')
  with check (public.tiene_permiso('costos.revisar_gasto') and estado in ('APROBADO','OBSERVADO')
    and revisado_por = public.usuario_actual());

create or replace function public.fn_proteger_ot_gasto() returns trigger
language plpgsql set search_path = 'public' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.ordenes_trabajo o where o.id = new.orden_id
      and o.estado not in ('ANULADA','ENTREGADA','FACTURADA')) then
      raise exception 'Esta OT ya está cerrada; no admite gastos nuevos.';
    end if;
    return new;
  end if;
  if old.estado <> 'PENDIENTE' or
     (to_jsonb(new) - array['estado','observacion_revision','revisado_por','revisado_en','actualizado_en'])
       is distinct from
     (to_jsonb(old) - array['estado','observacion_revision','revisado_por','revisado_en','actualizado_en']) then
    raise exception 'Administración solo puede revisar el gasto pendiente; el comprobante original queda en el historial.';
  end if;
  new.revisado_por := public.usuario_actual();
  new.revisado_en := now();
  return new;
end $$;
revoke all on function public.fn_proteger_ot_gasto() from public, anon, authenticated;
drop trigger if exists proteger_ot_gasto on public.ot_gastos_areas;
create trigger proteger_ot_gasto before insert or update on public.ot_gastos_areas
  for each row execute function public.fn_proteger_ot_gasto();
select public.activar_timestamps('ot_gastos_areas');
select public.activar_auditoria('ot_gastos_areas');
select public.activar_registro_de_prueba('ot_gastos_areas');

create or replace function public.fn_gasto_ot_bitacora() returns trigger
language plpgsql security definer set search_path = 'public' as $$
begin
  perform public.ot_registrar_evento_interna(new.orden_id, 'DOCUMENTO',
    case when tg_op = 'INSERT' then 'Se registró un gasto del área para revisión.'
      when new.estado = 'APROBADO' then 'Administración aprobó un gasto del área.'
      else 'Administración observó un gasto del área.' end,
    jsonb_build_object('gasto_id',new.id,'area_id',new.area_id,'estado',new.estado),
    null, public.usuario_actual());
  return null;
end $$;
revoke all on function public.fn_gasto_ot_bitacora() from public, anon, authenticated;
drop trigger if exists gasto_ot_bitacora on public.ot_gastos_areas;
create trigger gasto_ot_bitacora after insert or update of estado on public.ot_gastos_areas
  for each row execute function public.fn_gasto_ot_bitacora();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('gastos-ot','gastos-ot',false,15728640,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists mw_subir_gastos_ot on storage.objects;
create policy mw_subir_gastos_ot on storage.objects for insert to authenticated
  with check (bucket_id='gastos-ot' and public.orden_de_ruta(name) is not null
    and name like 'ot/' || public.orden_de_ruta(name)::text || '/gastos/%.pdf'
    and public.puede_ver_orden(public.orden_de_ruta(name))
    and public.tiene_permiso('costos.registrar_gasto'));
drop policy if exists mw_leer_gastos_ot on storage.objects;
create policy mw_leer_gastos_ot on storage.objects for select to authenticated
  using (bucket_id='gastos-ot' and exists (
    select 1 from public.ot_gastos_areas g where g.comprobante_ruta=objects.name));
drop policy if exists mw_borrar_gastos_ot on storage.objects;
create policy mw_borrar_gastos_ot on storage.objects for delete to authenticated
  using (bucket_id='gastos-ot' and owner_id=(auth.uid())::text
    and not exists (select 1 from public.ot_gastos_areas g where g.comprobante_ruta=objects.name));
