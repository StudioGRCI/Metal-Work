-- Los PDF de colaboradores pasan por Diseño antes de llegar al área.
-- Los PDF históricos conservan su visibilidad actual.
alter table public.ot_plano_versiones
  add column if not exists revision_diseno text not null default 'APROBADO';
alter table public.ot_plano_versiones
  add column if not exists revision_diseno_por uuid references public.usuarios(id);
alter table public.ot_plano_versiones
  add column if not exists revision_diseno_en timestamptz;
alter table public.ot_plano_versiones
  add column if not exists observacion_diseno text;

alter table public.ot_plano_versiones drop constraint if exists ck_version_revision_diseno;
alter table public.ot_plano_versiones add constraint ck_version_revision_diseno check (
  revision_diseno in ('PENDIENTE', 'APROBADO', 'OBSERVADO')
  and (revision_diseno_por is null) = (revision_diseno_en is null)
  and (revision_diseno <> 'OBSERVADO' or length(btrim(observacion_diseno)) > 0)
  and (observacion_diseno is null or length(btrim(observacion_diseno)) <= 1000)
);
create index if not exists ix_versiones_pendientes_diseno
  on public.ot_plano_versiones (creado_en desc) where revision_diseno = 'PENDIENTE';

create or replace function public.marcar_revision_diseno_nueva()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if public.tiene_permiso('diseno.subir_pdf') and not public.tiene_permiso('diseno.planos') then
    new.revision_diseno := 'PENDIENTE';
  else
    new.revision_diseno := 'APROBADO';
  end if;
  return new;
end;
$$;
revoke all on function public.marcar_revision_diseno_nueva() from public, anon, authenticated;
drop trigger if exists trg_marcar_revision_diseno_nueva on public.ot_plano_versiones;
create trigger trg_marcar_revision_diseno_nueva before insert on public.ot_plano_versiones
  for each row execute function public.marcar_revision_diseno_nueva();

create or replace function public.resolver_revision_diseno(
  p_version uuid, p_aprobar boolean, p_observacion text default null
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v public.ot_plano_versiones; v_orden uuid;
begin
  perform public.exigir_permiso('diseno.planos');
  select * into v from public.ot_plano_versiones where id = p_version for update;
  if v.id is null then raise exception 'No existe esa versión del plano.'; end if;
  select orden_id into v_orden from public.ot_planos where id = v.plano_id;
  if not public.puede_ver_orden(v_orden) then
    raise exception 'No tienes acceso a este plano.' using errcode = '42501';
  end if;
  if v.creado_por = public.usuario_actual() then
    raise exception 'Otra persona debe aprobar el PDF que cargaste.' using errcode = '42501';
  end if;
  if p_aprobar is null then raise exception 'Indica si apruebas u observas el PDF.'; end if;
  if not p_aprobar and nullif(btrim(p_observacion), '') is null then
    raise exception 'Explica qué debe corregir el colaborador.';
  end if;
  if p_observacion is not null and length(btrim(p_observacion)) > 1000 then
    raise exception 'La observación admite hasta 1000 caracteres.';
  end if;
  if v.revision_diseno <> 'PENDIENTE' then
    if v.revision_diseno_por = public.usuario_actual()
      and ((p_aprobar and v.revision_diseno = 'APROBADO')
        or (not p_aprobar and v.revision_diseno = 'OBSERVADO')) then return p_version; end if;
    raise exception 'Esta versión ya fue revisada por Diseño. Recarga la pantalla.';
  end if;
  if v.estado <> 'POR_REVISAR' then
    raise exception 'Esta versión ya pasó a otra revisión. Recarga la pantalla.';
  end if;
  if not exists (select 1 from public.ordenes_trabajo where id = v_orden
    and estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA')) then
    raise exception 'La orden ya no acepta revisiones de planos.';
  end if;
  update public.ot_plano_versiones set
    revision_diseno = case when p_aprobar then 'APROBADO' else 'OBSERVADO' end,
    revision_diseno_por = public.usuario_actual(), revision_diseno_en = now(),
    observacion_diseno = case when p_aprobar then null else btrim(p_observacion) end
    where id = p_version;
  return p_version;
end;
$$;
revoke all on function public.resolver_revision_diseno(uuid, boolean, text) from public, anon;
grant execute on function public.resolver_revision_diseno(uuid, boolean, text) to authenticated;

-- El RPC de revisión del área usa SECURITY DEFINER; el trigger protege también
-- esa entrada directa cuando el PDF aún espera al jefe de Diseño.
create or replace function public.impedir_revision_area_antes_diseno()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if old.estado = 'POR_REVISAR' and new.estado is distinct from old.estado
    and old.revision_diseno <> 'APROBADO' then
    raise exception 'Jefatura de Diseño debe aprobar el PDF antes de enviarlo al área.';
  end if;
  return new;
end;
$$;
revoke all on function public.impedir_revision_area_antes_diseno() from public, anon, authenticated;
drop trigger if exists trg_revision_area_antes_diseno on public.ot_plano_versiones;
create trigger trg_revision_area_antes_diseno before update of estado on public.ot_plano_versiones
  for each row execute function public.impedir_revision_area_antes_diseno();

-- La versión pendiente es visible para Diseño y colaboradores, no para el área.
create or replace function public.puede_ver_version_plano(p_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.ot_plano_versiones v
    join public.ot_planos p on p.id = v.plano_id
    join public.usuarios u on u.id = public.usuario_actual() and u.activo
    where v.id = p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos')
        or public.tiene_permiso('supervision.general')
        or public.tiene_permiso('diseno.subir_pdf')
        or (v.revision_diseno = 'APROBADO' and public.puede_hoja_de_area(v.area_id)
          and (public.tiene_permiso('produccion.actividades')
            or v.estado in ('APROBADO', 'RECIBIDO'))))
  );
$$;
revoke all on function public.puede_ver_version_plano(uuid) from public, anon;
grant execute on function public.puede_ver_version_plano(uuid) to authenticated;
