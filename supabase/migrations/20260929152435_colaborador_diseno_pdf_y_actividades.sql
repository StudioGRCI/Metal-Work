-- Cuenta compartida de colaboradores: solo consulta planos y sube versiones
-- cuando Diseño asignó nominalmente el plano a un COLABORADOR.
insert into public.permisos (codigo, modulo, descripcion)
values ('diseno.subir_pdf', 'diseno', 'Ver planos y cargar versiones PDF de los planos asignados a colaboradores')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema)
values ('DISENO_COLABORADOR', 'Colaboradores de Diseño',
  'Cuenta compartida: consulta la OT y carga PDF de planos con colaborador nominal asignado', 20, true)
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
where r.codigo = 'DISENO_COLABORADOR'
  and p.codigo in ('ordenes.ver', 'ordenes.listar', 'diseno.subir_pdf')
on conflict do nothing;

drop policy if exists alcance_plano_tecnico on public.ot_planos;
create policy alcance_plano_tecnico on public.ot_planos as restrictive for select to authenticated
using (public.es_admin() or public.tiene_permiso('diseno.planos')
  or public.tiene_permiso('diseno.revisar') or public.tiene_permiso('diseno.subir_pdf')
  or public.puede_ver_plano_tecnico(id));

create or replace function public.puede_ver_version_plano(p_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.ot_plano_versiones v
    join public.ot_planos p on p.id = v.plano_id
    join public.usuarios u on u.id = public.usuario_actual() and u.activo
    where v.id = p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos')
        or public.tiene_permiso('diseno.subir_pdf')
        or (public.tiene_permiso('produccion.actividades')
          and public.puede_hoja_de_area(v.area_id))
        or (v.estado in ('APROBADO', 'RECIBIDO')
          and public.puede_hoja_de_area(v.area_id)))
  );
$$;
revoke all on function public.puede_ver_version_plano(uuid) from public, anon;
grant execute on function public.puede_ver_version_plano(uuid) to authenticated;

drop policy if exists planos_subir on storage.objects;
create policy planos_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'planos-privados'
  and (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf'))
  and (storage.foldername(name))[1] = public.usuario_actual()::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$'
);

drop policy if exists planos_leer on storage.objects;
create policy planos_leer on storage.objects for select to authenticated using (
  bucket_id = 'planos-privados' and (
    exists(select 1 from public.ot_plano_versiones v where v.ruta_storage = name
      and public.puede_ver_version_plano(v.id))
    or (owner_id = public.usuario_actual()::text
      and (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf'))
      and not public.archivo_plano_vinculado(name))
  )
);

create or replace function public.registrar_version_plano(p_id uuid,p_plano uuid,p_area uuid,p_nombre text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_orden uuid; v_revision integer; v_ruta text;
  v_existente public.ot_plano_versiones; v_integrante uuid;
begin
  if not (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')) then
    raise exception 'Solo Diseño puede adjuntar versiones de planos.' using errcode='42501';
  end if;
  select orden_id, integrante_diseno_id into v_orden, v_integrante
    from public.ot_planos where id=p_plano for update;
  if v_orden is null or not public.puede_ver_orden(v_orden) then
    raise exception 'No tienes acceso a este plano.' using errcode='42501';
  end if;
  if not public.tiene_permiso('diseno.planos') and not exists (
    select 1 from public.ot_equipo_diseno e
    where e.id = v_integrante and e.orden_id = v_orden and e.funcion = 'COLABORADOR'
  ) then
    raise exception 'Diseño debe asignar un colaborador a este plano antes de cargar el PDF.' using errcode='42501';
  end if;
  if not exists(select 1 from public.ordenes_trabajo where id=v_orden
    and estado not in ('BORRADOR','ENTREGADA','FACTURADA','ANULADA')) then
    raise exception 'La orden debe estar aprobada y abierta para recibir planos.';
  end if;
  select * into v_existente from public.ot_plano_versiones where id=p_id;
  if found then
    if v_existente.creado_por=public.usuario_actual() and v_existente.plano_id=p_plano
       and v_existente.area_id=p_area and v_existente.nombre_archivo=p_nombre then return p_id; end if;
    raise exception 'La solicitud ya se usó para otro archivo.';
  end if;
  if not exists(select 1 from public.areas where id=p_area and codigo in ('MTZ','PRD','ACB')) then
    raise exception 'Elige Producción, Maestranza o Acabados para revisar el plano.';
  end if;
  v_ruta:=public.usuario_actual()::text||'/'||p_id::text||'.pdf';
  if not exists(select 1 from storage.objects where bucket_id='planos-privados' and name=v_ruta
    and owner_id=public.usuario_actual()::text and metadata->>'mimetype'='application/pdf') then
    raise exception 'Primero carga el PDF del plano.';
  end if;
  select coalesce(max(revision),0)+1 into v_revision from public.ot_plano_versiones
    where plano_id=p_plano and area_id=p_area;
  insert into public.ot_plano_versiones(id,plano_id,area_id,revision,nombre_archivo,ruta_storage,creado_por)
  values(p_id,p_plano,p_area,v_revision,p_nombre,v_ruta,public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.registrar_version_plano(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.registrar_version_plano(uuid,uuid,uuid,text) to authenticated;

create or replace function public.registrar_version_plano_con_nota(
  p_id uuid, p_plano uuid, p_area uuid, p_nombre text, p_nota text)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_nota text; v_actual text;
begin
  if p_nota is not null and length(btrim(p_nota)) > 1000 then
    raise exception 'La observación para revisión admite hasta 1000 caracteres.' using errcode='check_violation';
  end if;
  v_nota := nullif(btrim(p_nota), '');
  perform public.registrar_version_plano(p_id, p_plano, p_area, p_nombre);
  select nota_envio into v_actual from public.ot_plano_versiones where id = p_id for update;
  if v_actual is not null and v_actual is distinct from v_nota then
    raise exception 'Esta versión ya tiene otra observación de envío.' using errcode='unique_violation';
  end if;
  update public.ot_plano_versiones set nota_envio = v_nota
    where id = p_id and nota_envio is distinct from v_nota;
  return p_id;
end;
$$;
revoke all on function public.registrar_version_plano_con_nota(uuid,uuid,uuid,text,text) from public, anon;
grant execute on function public.registrar_version_plano_con_nota(uuid,uuid,uuid,text,text) to authenticated;
