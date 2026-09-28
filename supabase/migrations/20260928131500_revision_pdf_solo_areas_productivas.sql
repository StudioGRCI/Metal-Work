-- Los PDF de trabajo se entregan solo a las áreas que fabrican y reportan
-- el plano. Diseño deja una nota de envío distinta de la observación del revisor.
alter table public.ot_plano_versiones add column if not exists nota_envio text;
alter table public.ot_plano_versiones drop constraint if exists ck_plano_version_nota_envio;
alter table public.ot_plano_versiones add constraint ck_plano_version_nota_envio
  check (nota_envio is null or length(btrim(nota_envio)) <= 1000);
comment on column public.ot_plano_versiones.nota_envio is
  'Indicación de Diseño al enviar esta versión a revisión; no sustituye la observación del revisor.';

create or replace function public.validar_area_revision_plano()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if not exists (
    select 1 from public.areas a
    where a.id = new.area_id and a.codigo in ('PRD', 'MTZ', 'ACB') and a.activo
  ) then
    raise exception 'El plano solo se envía a Producción, Maestranza o Acabados.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_area_revision_plano() from public, anon, authenticated;
drop trigger if exists trg_validar_area_revision_plano on public.ot_plano_versiones;
create trigger trg_validar_area_revision_plano
  before insert on public.ot_plano_versiones
  for each row execute function public.validar_area_revision_plano();

create or replace function public.registrar_version_plano_con_nota(
  p_id uuid, p_plano uuid, p_area uuid, p_nombre text, p_nota text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_nota text; v_actual text;
begin
  perform public.exigir_permiso('diseno.planos');
  if p_nota is not null and length(btrim(p_nota)) > 1000 then
    raise exception 'La observación para revisión admite hasta 1000 caracteres.'
      using errcode = 'check_violation';
  end if;
  v_nota := nullif(btrim(p_nota), '');
  perform public.registrar_version_plano(p_id, p_plano, p_area, p_nombre);
  select nota_envio into v_actual from public.ot_plano_versiones where id = p_id for update;
  if v_actual is not null and v_actual is distinct from v_nota then
    raise exception 'Esta versión ya tiene otra observación de envío.'
      using errcode = 'unique_violation';
  end if;
  update public.ot_plano_versiones set nota_envio = v_nota
    where id = p_id and nota_envio is distinct from v_nota;
  return p_id;
end;
$$;
revoke all on function public.registrar_version_plano_con_nota(uuid,uuid,uuid,text,text)
  from public, anon;
grant execute on function public.registrar_version_plano_con_nota(uuid,uuid,uuid,text,text)
  to authenticated;

-- El área destinataria puede leer el PDF pendiente para revisarlo. La
-- autorización no depende del botón que aparezca en la interfaz.
create or replace function public.puede_ver_version_plano(p_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.ot_plano_versiones v
    join public.ot_planos p on p.id = v.plano_id
    join public.usuarios u on u.id = public.usuario_actual() and u.activo
    where v.id = p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos')
        or (public.tiene_permiso('produccion.actividades')
          and public.puede_hoja_de_area(v.area_id))
        or (v.estado in ('APROBADO', 'RECIBIDO')
          and public.puede_hoja_de_area(v.area_id)))
  );
$$;
revoke all on function public.puede_ver_version_plano(uuid) from public, anon;
grant execute on function public.puede_ver_version_plano(uuid) to authenticated;

create or replace function public.puede_ver_plano_tecnico(p_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.ot_planos p
    join public.usuarios u on u.id = public.usuario_actual() and u.activo
    where p.id = p_id and public.puede_ver_orden(p.orden_id)
      and (public.es_admin() or public.tiene_permiso('diseno.planos')
        or exists (select 1 from public.ot_plano_versiones v where v.plano_id = p.id
          and public.puede_hoja_de_area(v.area_id)
          and (v.estado in ('APROBADO', 'RECIBIDO')
            or public.tiene_permiso('produccion.actividades'))))
  );
$$;
revoke all on function public.puede_ver_plano_tecnico(uuid) from public, anon;
grant execute on function public.puede_ver_plano_tecnico(uuid) to authenticated;

create or replace function public.revisar_version_plano(
  p_id uuid, p_aprobar boolean, p_observacion text default null
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v public.ot_plano_versiones; v_orden uuid;
begin
  perform public.exigir_permiso('produccion.actividades');
  select * into v from public.ot_plano_versiones where id = p_id for update;
  if v.id is null or not public.puede_hoja_de_area(v.area_id) then
    raise exception 'La revisión corresponde al responsable del área destinataria.'
      using errcode = 'insufficient_privilege';
  end if;
  select orden_id into v_orden from public.ot_planos where id = v.plano_id for update;
  if not public.puede_ver_orden(v_orden) then
    raise exception 'No tienes acceso a este plano.' using errcode = 'insufficient_privilege';
  end if;
  if v.creado_por = public.usuario_actual() then
    raise exception 'Otra persona debe revisar el plano que cargaste.'
      using errcode = 'insufficient_privilege';
  end if;
  if v.estado <> 'POR_REVISAR' then
    if v.revisado_por = public.usuario_actual()
      and ((p_aprobar and v.estado in ('APROBADO', 'RECIBIDO'))
        or (not p_aprobar and v.estado = 'OBSERVADO')) then
      return p_id;
    end if;
    raise exception 'Esta versión ya fue revisada. Recarga la pantalla.';
  end if;
  if not exists (select 1 from public.ordenes_trabajo
      where id = v_orden and estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA')) then
    raise exception 'La orden ya no acepta revisiones de planos.';
  end if;
  if p_aprobar is null then
    raise exception 'Indica si apruebas u observas el plano.';
  end if;
  if not p_aprobar and nullif(btrim(p_observacion), '') is null then
    raise exception 'Explica qué debe corregir Diseño.';
  end if;
  if p_observacion is not null and length(btrim(p_observacion)) > 1000 then
    raise exception 'La observación admite hasta 1000 caracteres.';
  end if;
  if p_aprobar then
    if exists (select 1 from public.ot_plano_versiones
        where plano_id = v.plano_id and area_id = v.area_id and revision > v.revision and vigente) then
      raise exception 'Ya existe una revisión más reciente aprobada.';
    end if;
    update public.ot_plano_versiones set vigente = false
      where plano_id = v.plano_id and area_id = v.area_id and vigente;
  end if;
  update public.ot_plano_versiones
    set estado = case when p_aprobar then 'APROBADO' else 'OBSERVADO' end,
        vigente = p_aprobar,
        observacion = nullif(btrim(p_observacion), ''),
        revisado_por = public.usuario_actual(), revisado_en = now()
    where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.revisar_version_plano(uuid,boolean,text) from public, anon;
grant execute on function public.revisar_version_plano(uuid,boolean,text) to authenticated;
