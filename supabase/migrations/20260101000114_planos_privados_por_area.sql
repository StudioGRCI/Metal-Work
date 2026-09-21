-- Diseño entrega una versión revisada a un área concreta. Un enlace anónimo
-- de OneDrive no permite garantizar esto: los PDF de trabajo son privados.
-- No se modifica ni importa ningún documento real de OneDrive.
insert into public.permisos(codigo, modulo, descripcion)
values ('diseno.revisar','diseno','Revisar y aprobar versiones de planos de otra persona')
on conflict (codigo) do nothing;
insert into public.roles_permisos(rol_id, permiso_codigo)
select id,'diseno.revisar' from public.roles where codigo in ('GERENTE','JEFE_PRODUCCION')
on conflict do nothing;

create table if not exists public.ot_plano_versiones (
  id uuid primary key,
  plano_id uuid not null references public.ot_planos(id),
  area_id uuid not null references public.areas(id),
  revision integer not null check (revision > 0),
  nombre_archivo text not null check (length(nombre_archivo) between 1 and 200),
  ruta_storage text not null unique,
  estado text not null default 'POR_REVISAR' check (estado in ('POR_REVISAR','OBSERVADO','APROBADO','RECIBIDO')),
  vigente boolean not null default false,
  observacion text check (length(observacion) <= 1000),
  creado_por uuid not null references public.usuarios(id),
  revisado_por uuid references public.usuarios(id),
  revisado_en timestamptz,
  recibido_por uuid references public.usuarios(id),
  recibido_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (plano_id, area_id, revision),
  check (revisado_por is distinct from creado_por),
  check ((estado='POR_REVISAR') = (revisado_por is null and revisado_en is null)),
  check ((estado='RECIBIDO') = (recibido_por is not null and recibido_en is not null)),
  check (not vigente or estado in ('APROBADO','RECIBIDO')),
  check (estado <> 'OBSERVADO' or length(trim(observacion)) > 0)
);
-- Consultas reales: versión vigente de un plano para un área y bandeja del área.
create unique index if not exists uq_plano_version_vigente on public.ot_plano_versiones(plano_id,area_id) where vigente;
create index if not exists ix_plano_version_area on public.ot_plano_versiones(area_id,creado_en desc);
alter table public.ot_plano_versiones enable row level security;
revoke all on public.ot_plano_versiones from public, anon, authenticated;
grant select on public.ot_plano_versiones to authenticated;
select public.activar_timestamps('ot_plano_versiones');
select public.activar_auditoria('ot_plano_versiones');
select public.activar_registro_de_prueba('ot_plano_versiones');

-- Definer evita recursión entre la lectura del plano y sus versiones.
create or replace function public.puede_ver_version_plano(p_id uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists (
    select 1 from public.ot_plano_versiones v
    join public.ot_planos p on p.id=v.plano_id
    join public.usuarios u on u.id=public.usuario_actual() and u.activo
    where v.id=p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.revisar')
        or (v.estado in ('APROBADO','RECIBIDO') and public.puede_hoja_de_area(v.area_id)))
  );
$$;
create or replace function public.puede_ver_plano_tecnico(p_id uuid)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists (
    select 1 from public.ot_planos p
    join public.usuarios u on u.id=public.usuario_actual() and u.activo
    where p.id=p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.revisar')
        or exists (select 1 from public.ot_plano_versiones v where v.plano_id=p.id
          and v.estado in ('APROBADO','RECIBIDO') and public.puede_hoja_de_area(v.area_id)))
  );
$$;
revoke all on function public.puede_ver_version_plano(uuid), public.puede_ver_plano_tecnico(uuid) from public,anon;
grant execute on function public.puede_ver_version_plano(uuid), public.puede_ver_plano_tecnico(uuid) to authenticated;
drop policy if exists ver_versiones_planos on public.ot_plano_versiones;
create policy ver_versiones_planos on public.ot_plano_versiones for select to authenticated using(public.puede_ver_version_plano(id));
-- Restrictivas: también cierran las lecturas directas y las vistas invoker.
drop policy if exists alcance_plano_tecnico on public.ot_planos;
create policy alcance_plano_tecnico on public.ot_planos as restrictive for select to authenticated using(public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.revisar') or public.puede_ver_plano_tecnico(id));
drop policy if exists alcance_pieza_tecnica on public.ot_piezas;
create policy alcance_pieza_tecnica on public.ot_piezas as restrictive for select to authenticated using(public.puede_ver_plano_tecnico(plano_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('planos-privados','planos-privados',false,20971520,array['application/pdf'])
on conflict(id) do nothing;
create or replace function public.archivo_plano_vinculado(p_ruta text)
returns boolean language sql stable security definer set search_path='public' as $$
  select exists(select 1 from public.ot_plano_versiones where ruta_storage=p_ruta);
$$;
revoke all on function public.archivo_plano_vinculado(text) from public,anon;
grant execute on function public.archivo_plano_vinculado(text) to authenticated;
drop policy if exists planos_subir on storage.objects;
create policy planos_subir on storage.objects for insert to authenticated with check (
  bucket_id='planos-privados' and public.tiene_permiso('diseno.planos')
  and (storage.foldername(name))[1]=public.usuario_actual()::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
);
drop policy if exists planos_leer on storage.objects;
create policy planos_leer on storage.objects for select to authenticated using (
  bucket_id='planos-privados' and exists(select 1 from public.ot_plano_versiones v where v.ruta_storage=name)
);
drop policy if exists planos_limpiar_huerfano on storage.objects;
create policy planos_limpiar_huerfano on storage.objects for delete to authenticated using (
  bucket_id='planos-privados' and owner_id=public.usuario_actual()::text
  and not public.archivo_plano_vinculado(name)
);

create or replace function public.registrar_version_plano(p_id uuid,p_plano uuid,p_area uuid,p_nombre text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_orden uuid; v_revision integer; v_ruta text; v_existente public.ot_plano_versiones;
begin
  perform public.exigir_permiso('diseno.planos');
  select orden_id into v_orden from public.ot_planos where id=p_plano for update;
  if v_orden is null or not public.puede_ver_orden(v_orden) then raise exception 'No tienes acceso a este plano.' using errcode='42501'; end if;
  if not exists(select 1 from public.ordenes_trabajo where id=v_orden and estado not in ('BORRADOR','ENTREGADA','FACTURADA','ANULADA')) then
    raise exception 'La orden debe estar aprobada y abierta para recibir planos.';
  end if;
  select * into v_existente from public.ot_plano_versiones where id=p_id;
  if found then
    if v_existente.creado_por=public.usuario_actual() and v_existente.plano_id=p_plano and v_existente.area_id=p_area and v_existente.nombre_archivo=p_nombre then return p_id; end if;
    raise exception 'La solicitud ya se usó para otro archivo.';
  end if;
  if not exists(select 1 from public.areas where id=p_area and codigo in ('MTZ','PRD','ACB','CAL','ALM','REQ')) then raise exception 'Elige un área destinataria del taller.'; end if;
  v_ruta:=public.usuario_actual()::text||'/'||p_id::text||'.pdf';
  if not exists(select 1 from storage.objects where bucket_id='planos-privados' and name=v_ruta
    and owner_id=public.usuario_actual()::text and metadata->>'mimetype'='application/pdf') then
    raise exception 'Primero carga el PDF del plano.';
  end if;
  select coalesce(max(revision),0)+1 into v_revision from public.ot_plano_versiones where plano_id=p_plano and area_id=p_area;
  insert into public.ot_plano_versiones(id,plano_id,area_id,revision,nombre_archivo,ruta_storage,creado_por)
  values(p_id,p_plano,p_area,v_revision,p_nombre,v_ruta,public.usuario_actual());
  return p_id;
end;
$$;

create or replace function public.revisar_version_plano(p_id uuid,p_aprobar boolean,p_observacion text default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v public.ot_plano_versiones; v_plano uuid; v_orden uuid;
begin
  perform public.exigir_permiso('diseno.revisar');
  select plano_id into v_plano from public.ot_plano_versiones where id=p_id;
  select orden_id into v_orden from public.ot_planos where id=v_plano for update;
  select * into v from public.ot_plano_versiones where id=p_id for update;
  if v.id is null or not public.puede_ver_version_plano(p_id) then raise exception 'No tienes acceso a esta versión.' using errcode='42501'; end if;
  if v.creado_por=public.usuario_actual() then raise exception 'Otra persona debe revisar el plano que cargaste.' using errcode='42501'; end if;
  if v.estado <> 'POR_REVISAR' then
    if v.revisado_por=public.usuario_actual() and ((p_aprobar and v.estado in ('APROBADO','RECIBIDO')) or (not p_aprobar and v.estado='OBSERVADO')) then return p_id; end if;
    raise exception 'Esta versión ya fue revisada. Recarga la pantalla.';
  end if;
  if not exists(select 1 from public.ordenes_trabajo where id=v_orden and estado not in ('BORRADOR','ENTREGADA','FACTURADA','ANULADA')) then raise exception 'La orden ya no acepta revisiones de planos.'; end if;
  if p_aprobar is null then raise exception 'Indica si apruebas u observas el plano.'; end if;
  if not p_aprobar and nullif(trim(p_observacion),'') is null then raise exception 'Explica qué debe corregir Diseño.'; end if;
  if p_aprobar then
    if exists(select 1 from public.ot_plano_versiones where plano_id=v.plano_id and area_id=v.area_id and revision>v.revision and vigente) then raise exception 'Ya existe una revisión más reciente aprobada.'; end if;
    update public.ot_plano_versiones set vigente=false where plano_id=v.plano_id and area_id=v.area_id and vigente;
  end if;
  update public.ot_plano_versiones set estado=case when p_aprobar then 'APROBADO' else 'OBSERVADO' end,
    vigente=p_aprobar,observacion=nullif(trim(p_observacion),''),revisado_por=public.usuario_actual(),revisado_en=now() where id=p_id;
  -- La entrega física del plano la sigue registrando Diseño en Cumplimiento.
  -- Aprobar el archivo no inventa la recepción del área ni una fecha de entrega.
  return p_id;
end;
$$;

create or replace function public.recibir_version_plano(p_id uuid)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v public.ot_plano_versiones;
begin
  select * into v from public.ot_plano_versiones where id=p_id for update;
  if v.id is null or not public.puede_ver_version_plano(p_id) or not public.puede_hoja_de_area(v.area_id)
    or not (public.tiene_permiso('produccion.actividades') or public.tiene_permiso('produccion.cualquier_area')) then
    raise exception 'La recepción la confirma el responsable del área destinataria.' using errcode='42501';
  end if;
  if not v.vigente then raise exception 'Esta versión fue sustituida. Consulta el plano vigente.'; end if;
  if v.estado='RECIBIDO' then return p_id; end if;
  if v.estado<>'APROBADO' then raise exception 'Solo puedes recibir un plano aprobado.'; end if;
  update public.ot_plano_versiones set estado='RECIBIDO',recibido_por=public.usuario_actual(),recibido_en=now() where id=p_id;
  return p_id;
end;
$$;
revoke all on function public.registrar_version_plano(uuid,uuid,uuid,text), public.revisar_version_plano(uuid,boolean,text), public.recibir_version_plano(uuid) from public,anon;
grant execute on function public.registrar_version_plano(uuid,uuid,uuid,text), public.revisar_version_plano(uuid,boolean,text), public.recibir_version_plano(uuid) to authenticated;
