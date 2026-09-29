-- Inicio limpio de avisos solicitado el 29/09/2026.
-- La copia permite recuperar una notificación sin volver a mostrarla en la campana.
create table if not exists public.notificaciones_archivo_20260929 (
  id uuid primary key,
  usuario_id uuid not null,
  titulo text not null,
  cuerpo text,
  ruta text,
  origen_tabla text,
  origen_id uuid,
  leida_en timestamptz,
  creado_en timestamptz not null,
  archivado_en timestamptz not null default now()
);
create index if not exists ix_notificaciones_archivo_20260929_usuario
  on public.notificaciones_archivo_20260929 (usuario_id, creado_en desc);
alter table public.notificaciones_archivo_20260929 enable row level security;
drop policy if exists ver_notificaciones_archivo_20260929 on public.notificaciones_archivo_20260929;
create policy ver_notificaciones_archivo_20260929 on public.notificaciones_archivo_20260929
  for select to authenticated
  using (public.tiene_permiso('usuarios.gestionar'));
revoke all on public.notificaciones_archivo_20260929 from public, anon, authenticated;
grant select on public.notificaciones_archivo_20260929 to authenticated;

insert into public.notificaciones_archivo_20260929
  (id,usuario_id,titulo,cuerpo,ruta,origen_tabla,origen_id,leida_en,creado_en)
select id,usuario_id,titulo,cuerpo,ruta,origen_tabla,origen_id,leida_en,creado_en
  from public.notificaciones
on conflict (id) do nothing;
delete from public.notificaciones n
  using public.notificaciones_archivo_20260929 a where a.id = n.id;
