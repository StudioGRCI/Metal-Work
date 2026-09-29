-- METAL WORK (usnbwnemfqyjjkzdizgv): corregir una COT aprobada conserva
-- la versión aprobada anterior, también si ya tiene OT o liberación financiera.
alter table public.cotizaciones_pdf_versiones
  add column if not exists estado_al_archivar text not null default 'RECHAZADA'
  check (estado_al_archivar in ('POR_REVISAR','APROBADA','RECHAZADA'));

create or replace function public.fn_cotizacion_pdf_revision()
returns trigger language plpgsql set search_path = 'public' as $$
declare
  v_revisa constant boolean := public.es_admin() or public.tiene_permiso('cotizaciones.revisar');
  v_autor boolean;
  v_cambia boolean;
  v_archivo_nuevo boolean;
  v_ignorar constant text[] := array['estado','observacion','revisado_por','revisado_en','actualizado_en'];
  v_campos_correccion constant text[] := array[
    'cliente_id','tipo_carroceria_id','nombre_archivo','ruta_storage','mime_type',
    'tamano_bytes','monto_venta','moneda','motivo_correccion','estado','observacion',
    'revisado_por','revisado_en','version','archivo_subido_en','actualizado_en'
  ];
begin
  if tg_op = 'INSERT' then
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    new.version := 1;
    new.archivo_subido_en := now();
    return new;
  end if;

  v_autor := public.es_admin() or old.registrado_por = public.usuario_actual();
  v_archivo_nuevo := new.ruta_storage is distinct from old.ruta_storage;
  new.numero := old.numero;
  new.registrado_por := old.registrado_por;
  new.version := old.version;
  new.archivo_subido_en := case when v_archivo_nuevo then now() else old.archivo_subido_en end;

  if v_archivo_nuevo then
    if not v_autor or not public.tiene_permiso('cotizaciones.crear') then
      raise exception 'Solo quien registró la cotización puede subir su corrección.' using errcode = 'insufficient_privilege';
    end if;
    if old.estado = 'ANULADA' then
      raise exception 'Una cotización anulada no se puede corregir.';
    end if;
    if length(btrim(coalesce(new.motivo_correccion,''))) < 5 then
      raise exception 'Indica por qué corriges la cotización.';
    end if;
    if (to_jsonb(new) - v_campos_correccion) is distinct from (to_jsonb(old) - v_campos_correccion) then
      raise exception 'La corrección solo admite datos comerciales y el archivo; no cambia la identidad de la cotización.';
    end if;
    new.version := old.version + 1;
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    return new;
  end if;

  if new.estado is distinct from old.estado or new.observacion is distinct from old.observacion then
    if not v_revisa then
      raise exception 'La cotización la aprueba o la rechaza Gerencia.' using errcode = 'insufficient_privilege';
    end if;
    if new.estado in ('APROBADA','RECHAZADA') and old.estado <> 'POR_REVISAR' then
      raise exception 'Gerencia solo revisa una versión pendiente; Ventas debe subir una corrección primero.';
    end if;
    if new.estado = 'POR_REVISAR' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  v_cambia := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);
  if v_cambia then
    raise exception 'Para corregir la cotización %, adjunta una nueva versión e indica el motivo.', old.numero;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_cotizacion_pdf_revision() from public, anon, authenticated;

create or replace function public.fn_cotizacion_pdf_guarda_version()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if new.version = old.version + 1 and new.ruta_storage is distinct from old.ruta_storage then
    insert into public.cotizaciones_pdf_versiones (
      cotizacion_id, version, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
      subido_en, observacion, rechazado_por, rechazado_en, estado_al_archivar)
    values (
      old.id, old.version, old.nombre_archivo, old.ruta_storage, old.mime_type, old.tamano_bytes,
      old.archivo_subido_en,
      case when old.estado = 'RECHAZADA' then coalesce(old.observacion, new.motivo_correccion, 'Corrección')
        else 'Corrección: ' || new.motivo_correccion end,
      old.revisado_por, old.revisado_en, old.estado::text);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_cotizacion_pdf_guarda_version() from public, anon, authenticated;

create or replace view public.v_cotizaciones_pdf_versiones as
select v.id, v.cotizacion_id, v.version, v.nombre_archivo, v.ruta_storage,
       v.mime_type, v.tamano_bytes, v.subido_en, v.observacion, v.rechazado_en,
       public.puesto_de(v.rechazado_por) as rechazado_por_nombre,
       v.estado_al_archivar
  from public.cotizaciones_pdf_versiones v;
alter view public.v_cotizaciones_pdf_versiones set (security_invoker = on);
grant select on public.v_cotizaciones_pdf_versiones to authenticated;
