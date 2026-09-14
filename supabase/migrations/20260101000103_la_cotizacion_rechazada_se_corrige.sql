-- =============================================================================
-- LA COTIZACIÓN RECHAZADA SE CORRIGE, Y SE PUEDE SUBIR EN WORD
-- -----------------------------------------------------------------------------
-- «Que en cotización en PDF también se pueda subir en Word, por si Gerencia
-- rechaza y anota una observación; igualmente el vendedor debe ver esa
-- observación.»
--
-- La cotización se arma en Word. Cuando Gerencia la rechaza, lo que el vendedor
-- corrige es ese Word, y hasta ahora no tenía qué hacer con la corrección: solo
-- podía quitar la rechazada y subir otra, y con eso se perdía lo que Gerencia
-- había observado y Gerencia no sabía que era la misma cotización corregida.
--
-- Queda así:
--   · La cotización se sube en PDF o en Word (.docx, y .doc por si acaso).
--   · Rechazada, el vendedor ve la observación y sube la corrección en la misma
--     cotización: vuelve a «Por revisar» con el mismo número y una versión más.
--   · Nada se pisa: cada archivo rechazado queda guardado como una versión, con
--     la observación que Gerencia le hizo, quién y cuándo. Gerencia ve qué había
--     pedido antes de aprobar la corrección.
--   · La corrección la sube quien subió la cotización. Gerencia no reescribe el
--     papel del vendedor: lo observa.
-- =============================================================================

-- =============================================================================
-- 1. WORD TAMBIÉN
-- =============================================================================
update storage.buckets
   set allowed_mime_types = array[
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/msword'
   ]
 where id = 'cotizaciones-pdf';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones_pdf'::regclass and conname = 'ck_cotizacion_pdf_tipo') then
    alter table public.cotizaciones_pdf
      add constraint ck_cotizacion_pdf_tipo check (
        mime_type is null or mime_type in (
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/msword'));
  end if;
end $$;

comment on table public.cotizaciones_pdf is
  'La cotización que la casa arma en Word y manda en PDF: se sube en cualquiera de los dos. El sistema guarda lo poco que necesita —cliente, carrocería, número y el archivo— y la traza: quién la subió, quién la aprobó, qué orden salió de ella y, si Gerencia la rechazó, cada versión con su observación.';

-- =============================================================================
-- 2. LA VERSIÓN, Y CUÁNDO SE SUBIÓ EL ARCHIVO QUE ESTÁ
-- =============================================================================
alter table public.cotizaciones_pdf add column if not exists version integer not null default 1;
alter table public.cotizaciones_pdf add column if not exists archivo_subido_en timestamptz;
-- El relleno es técnico y no es una corrección: el disparador de revisión lo
-- tomaría por un cambio a una cotización ya revisada y lo rechazaría (pasó en
-- la primera aplicación, con la 3522-2025 ya aprobada). Se aparta solo aquí.
alter table public.cotizaciones_pdf disable trigger trg_cotizacion_pdf_revision;
update public.cotizaciones_pdf set archivo_subido_en = creado_en where archivo_subido_en is null;
alter table public.cotizaciones_pdf enable trigger trg_cotizacion_pdf_revision;
alter table public.cotizaciones_pdf alter column archivo_subido_en set default now();
alter table public.cotizaciones_pdf alter column archivo_subido_en set not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones_pdf'::regclass and conname = 'ck_cotizacion_pdf_version') then
    alter table public.cotizaciones_pdf add constraint ck_cotizacion_pdf_version check (version >= 1);
  end if;
end $$;

comment on column public.cotizaciones_pdf.version is
  'Cuántas veces se subió: 1 la primera, y una más con cada corrección después de un rechazo.';

-- =============================================================================
-- 3. LAS VERSIONES QUE GERENCIA RECHAZÓ
-- -----------------------------------------------------------------------------
-- Las escribe el sistema al subir la corrección, nunca una persona: no hay
-- política de escritura. Se van con la cotización si se quita (que solo puede
-- pasar si nunca tuvo orden).
-- =============================================================================
create table if not exists public.cotizaciones_pdf_versiones (
  id             uuid primary key default gen_random_uuid(),
  cotizacion_id  uuid not null references public.cotizaciones_pdf(id) on delete cascade,
  version        integer not null,
  nombre_archivo text not null,
  ruta_storage   text not null,
  mime_type      text,
  tamano_bytes   bigint,
  subido_en      timestamptz not null,
  observacion    text not null,
  rechazado_por  uuid references public.usuarios(id) on delete set null,
  rechazado_en   timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  -- La primera columna es la llave foránea: este índice ya sirve para buscar
  -- las versiones de una cotización y para el borrado en cascada.
  constraint uq_cotizacion_pdf_version unique (cotizacion_id, version),
  constraint uq_cotizacion_pdf_version_ruta unique (ruta_storage)
);

comment on table public.cotizaciones_pdf_versiones is
  'Cada archivo de una cotización que Gerencia rechazó, con la observación que le hizo. Lo escribe el sistema al subir la corrección.';

alter table public.cotizaciones_pdf_versiones enable row level security;

drop policy if exists ver_cotizaciones_pdf_versiones on public.cotizaciones_pdf_versiones;
create policy ver_cotizaciones_pdf_versiones on public.cotizaciones_pdf_versiones
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('cotizaciones.ver'));

revoke all on public.cotizaciones_pdf_versiones from anon, public;
revoke insert, update, delete on public.cotizaciones_pdf_versiones from authenticated;
grant select on public.cotizaciones_pdf_versiones to authenticated;

select public.activar_timestamps('cotizaciones_pdf_versiones');
select public.activar_auditoria('cotizaciones_pdf_versiones');

-- =============================================================================
-- 4. QUIÉN CORRIGE, Y QUÉ SE PUEDE TOCAR
-- -----------------------------------------------------------------------------
-- Lo mismo que en la 101, con la corrección delante: rechazada → por revisar
-- con un archivo nuevo, y solo quien la subió. Sin archivo nuevo, el vendedor
-- no la puede devolver a Gerencia: lo dice.
-- =============================================================================
create or replace function public.fn_cotizacion_pdf_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_revisa  constant boolean := public.es_admin() or public.tiene_permiso('cotizaciones.revisar');
  v_ignorar constant text[] := array['estado', 'observacion', 'revisado_por', 'revisado_en', 'actualizado_en'];
  v_autor   boolean;
  v_cambia  boolean;
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

  -- Lo que pone el sistema no lo cambia nadie a mano.
  new.registrado_por := old.registrado_por;
  new.version := old.version;
  new.archivo_subido_en := case when new.ruta_storage is distinct from old.ruta_storage
                                then now() else old.archivo_subido_en end;

  -- La corrección de una rechazada.
  if old.estado = 'RECHAZADA' and new.estado = 'POR_REVISAR' then
    if new.ruta_storage is distinct from old.ruta_storage then
      if not v_autor then
        raise exception 'La corrección de la cotización % la sube quien la subió.', old.numero
          using errcode = 'insufficient_privilege';
      end if;
      new.observacion := null;
      new.revisado_por := null;
      new.revisado_en := null;
      new.version := old.version + 1;
      return new;
    elsif not v_revisa then
      raise exception 'Para volver a mandar la cotización % a Gerencia, sube el archivo corregido.', old.numero
        using errcode = 'check_violation';
    end if;
  end if;

  if new.estado is distinct from old.estado or new.observacion is distinct from old.observacion then
    if not v_revisa then
      raise exception 'La cotización la aprueba o la rechaza Gerencia.'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from public.ordenes_trabajo o
                where o.cotizacion_pdf_id = old.id and o.estado <> 'ANULADA') then
      raise exception 'La cotización % ya tiene su orden de trabajo: queda como está.', old.numero
        using errcode = 'check_violation';
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
  if v_cambia and old.estado <> 'POR_REVISAR' then
    raise exception 'La cotización % ya la revisó Gerencia: para cambiarla, sube una nueva.', old.numero
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_revision() from public, anon, authenticated;

-- El vendedor llega a su cotización rechazada para corregirla.
drop policy if exists editar_cotizaciones_pdf on public.cotizaciones_pdf;
create policy editar_cotizaciones_pdf on public.cotizaciones_pdf
  for update to authenticated
  using (public.es_admin()
         or public.tiene_permiso('cotizaciones.revisar')
         or (registrado_por = public.usuario_actual() and estado in ('POR_REVISAR', 'RECHAZADA')))
  with check (public.es_admin()
              or public.tiene_permiso('cotizaciones.revisar')
              or registrado_por = public.usuario_actual());

-- =============================================================================
-- 5. EL ARCHIVO RECHAZADO SE GUARDA COMO VERSIÓN
-- =============================================================================
create or replace function public.fn_cotizacion_pdf_guarda_version()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.estado = 'RECHAZADA' and new.estado = 'POR_REVISAR' and new.version = old.version + 1 then
    insert into public.cotizaciones_pdf_versiones (
      cotizacion_id, version, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
      subido_en, observacion, rechazado_por, rechazado_en)
    values (
      old.id, old.version, old.nombre_archivo, old.ruta_storage, old.mime_type, old.tamano_bytes,
      old.archivo_subido_en, coalesce(old.observacion, 'Sin observación'), old.revisado_por, old.revisado_en);
  end if;
  return null;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_guarda_version() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pdf_guarda_version on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_guarda_version after update on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_guarda_version();

-- =============================================================================
-- 6. LOS AVISOS: LA CORRECCIÓN LE LLEGA A GERENCIA
-- -----------------------------------------------------------------------------
-- Sin esto, volver a «por revisar» caía en la rama de «rechazada» y al vendedor
-- le llegaba «Gerencia rechazó tu cotización» justo cuando la corregía.
-- =============================================================================
create or replace function public.fn_cotizacion_pdf_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cliente text;
  v_quien   text;
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  select nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
    into v_quien from public.usuarios u where u.id = new.registrado_por;

  if tg_op = 'INSERT' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s.', coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente')),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    return null;
  end if;

  if new.estado is not distinct from old.estado then
    return null;
  end if;

  if new.estado = 'POR_REVISAR' then
    if new.version > old.version then
      perform public.notificar_a_permiso(
        'cotizaciones.revisar',
        'Cotización corregida',
        format('%s subió la corrección de la %s de %s (versión %s). Lo que habías observado: %s',
               coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente'), new.version,
               coalesce(old.observacion, 'sin observación')),
        '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
    return null;
  end if;

  perform public.notificar_a_usuario(
    new.registrado_por,
    case when new.estado = 'APROBADA' then 'Gerencia aprobó tu cotización' else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA'
         then format('La %s de %s: Administración ya puede emitir la orden.', new.numero, coalesce(v_cliente, 'un cliente'))
         else format('La %s: %s. Corrígela y sube la corrección.', new.numero, coalesce(new.observacion, 'sin motivo')) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());

  if new.estado = 'APROBADA' then
    perform public.notificar_a_permiso(
      'ordenes.crear',
      'Cotización aprobada: falta la OT',
      format('La %s de %s ya está aprobada: emite la orden de trabajo.', new.numero, coalesce(v_cliente, 'un cliente')),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
  end if;

  return null;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;

-- =============================================================================
-- 7. EL ARCHIVO DE UNA VERSIÓN TAMPOCO SE BORRA SUELTO
-- -----------------------------------------------------------------------------
-- La 102 dejaba borrar el archivo que no nombra ninguna cotización. Uno
-- rechazado lo nombra su versión: sin esta línea, el vendedor podría borrar el
-- papel que Gerencia rechazó y dejar la observación sin su archivo.
-- =============================================================================
drop policy if exists mw_borrar_cotizaciones_pdf on storage.objects;
create policy mw_borrar_cotizaciones_pdf on storage.objects
  for delete to authenticated
  using (bucket_id = 'cotizaciones-pdf'
         and (public.es_admin()
              or ((owner_id = (auth.uid())::text or public.tiene_permiso('cotizaciones.revisar'))
                  and not exists (select 1 from public.cotizaciones_pdf c
                                   where c.ruta_storage = objects.name)
                  and not exists (select 1 from public.cotizaciones_pdf_versiones v
                                   where v.ruta_storage = objects.name))));

-- =============================================================================
-- 8. LA LISTA
-- =============================================================================
create or replace view public.v_cotizaciones_pdf as
select c.id,
       c.numero,
       c.estado::text as estado,
       c.observacion,
       c.cliente_id,
       cl.razon_social as cliente,
       c.tipo_carroceria_id,
       tc.nombre as carroceria,
       c.nombre_archivo,
       c.ruta_storage,
       c.tamano_bytes,
       c.creado_en,
       c.registrado_por,
       nullif(btrim(coalesce(v.nombres, '') || ' ' || coalesce(v.apellidos, '')), '') as registrado_por_nombre,
       c.revisado_en,
       nullif(btrim(coalesce(g.nombres, '') || ' ' || coalesce(g.apellidos, '')), '') as revisado_por_nombre,
       o.id as orden_id,
       o.numero as orden_numero,
       o.estado::text as orden_estado,
       exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id) as tuvo_orden,
       c.version,
       c.mime_type,
       c.archivo_subido_en
  from public.cotizaciones_pdf c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
  left join public.usuarios v on v.id = c.registrado_por
  left join public.usuarios g on g.id = c.revisado_por
  left join lateral (
    select o.id, o.numero, o.estado
      from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
     limit 1
  ) o on true;

alter view public.v_cotizaciones_pdf set (security_invoker = on);
grant select on public.v_cotizaciones_pdf to authenticated;

-- El historial de una cotización, con el nombre de quien rechazó.
create or replace view public.v_cotizaciones_pdf_versiones as
select v.id,
       v.cotizacion_id,
       v.version,
       v.nombre_archivo,
       v.ruta_storage,
       v.mime_type,
       v.tamano_bytes,
       v.subido_en,
       v.observacion,
       v.rechazado_en,
       nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') as rechazado_por_nombre
  from public.cotizaciones_pdf_versiones v
  left join public.usuarios u on u.id = v.rechazado_por;

alter view public.v_cotizaciones_pdf_versiones set (security_invoker = on);
grant select on public.v_cotizaciones_pdf_versiones to authenticated;

-- =============================================================================
-- 9. COMPROBACIONES
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.cotizaciones_pdf_versiones'::regclass and relrowsecurity) then
    raise exception 'cotizaciones_pdf_versiones quedó sin seguridad por fila';
  end if;
  if has_table_privilege('authenticated', 'public.cotizaciones_pdf_versiones', 'insert') then
    raise exception 'las versiones las escribe el sistema: authenticated no puede insertar';
  end if;
  if has_table_privilege('anon', 'public.cotizaciones_pdf_versiones', 'select') then
    raise exception 'cotizaciones_pdf_versiones quedó abierta al rol anónimo';
  end if;
  if coalesce((select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_cotizaciones_pdf_versiones'::regclass), '')
       not similar to '%security_invoker=(on|true)%' then
    raise exception 'v_cotizaciones_pdf_versiones corre como su dueño y se salta el RLS';
  end if;
  if not exists (select 1 from storage.buckets
                  where id = 'cotizaciones-pdf'
                    and 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any(allowed_mime_types)) then
    raise exception 'el bucket de cotizaciones no acepta Word';
  end if;
end $$;
