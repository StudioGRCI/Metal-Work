-- =============================================================================
-- LOS DXF DE CORTE, TAMBIÉN SUELTOS
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-20: «deben agregar lo que son dibujos para corte en plasma, son
-- archivos .DXF para que Diseño suba y Maestranza descargue para generar los
-- cortes». La 20261106100000 (observaciones de Diseño) los recibía solo
-- comprimidos en .zip, .rar o .7z; DKS eligió «sueltos y también comprimidos».
--
-- * Diseño sube el .dxf suelto, varios a la vez, o el comprimido de siempre.
-- * Los que elige juntos van con un mismo envío y una descripción, y a los
--   supervisores de Maestranza y de Producción les llega un solo aviso que
--   los cuenta, no uno por archivo.
-- * Un envío que se subió al código equivocado se quita entero. Se quita, no se
--   borra: queda en el historial.
--
-- Va aparte de la 20261106100000 y no la reescribe: corre igual si aquella ya
-- estaba aplicada o si entra en el mismo despliegue. Ni los DXF ni su tabla
-- estaban en producción el 2026-11-20.
-- =============================================================================

-- El envío: los archivos que Diseño eligió juntos.
alter table public.codigo_dxf add column if not exists envio uuid;
update public.codigo_dxf set envio = id where envio is null;
alter table public.codigo_dxf alter column envio set not null;
comment on column public.codigo_dxf.envio is
  'Los archivos que Diseño subió juntos, con una misma descripción. El aviso a Maestranza y Producción es uno por envío.';
-- (b) El registro junta los archivos de un envío para el aviso, y «Quitar los N» los quita juntos.
create index if not exists idx_codigo_dxf_envio on public.codigo_dxf (envio);

-- El .dxf suelto además del comprimido.
alter table public.codigo_dxf drop constraint if exists ck_codigo_dxf;
alter table public.codigo_dxf add constraint ck_codigo_dxf check (
  codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
  and char_length(btrim(descripcion)) between 2 and 200
  and char_length(btrim(nombre_archivo)) between 1 and 200
  and ruta ~ '^[0-9a-f-]{36}\.(dxf|zip|rar|7z)$'
  and tamano_bytes between 1 and 52428800
  and (quitado_en is null) = (quitado_por is null));
comment on table public.codigo_dxf is
  'Los DXF que Diseño genera para el corte de cada código interno: el .dxf suelto o comprimido (.zip, .rar, .7z). Los sube Diseño; los ven Diseño y los supervisores de Maestranza y de Producción. Se quitan, no se borran.';

-- 50 MB por archivo. El .dxf sube con el tipo que le pone la pantalla (`application/dxf`).
update storage.buckets
   set allowed_mime_types = array['application/dxf', 'image/vnd.dxf', 'application/zip', 'application/x-zip-compressed',
                                  'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed']
 where id = 'dxf-codigo';

-- La ruta es {id}.{dxf|zip|rar|7z}: la política de subir se rehace con el .dxf.
drop policy if exists dxf_codigo_subir on storage.objects;
create policy dxf_codigo_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'dxf-codigo' and owner_id = (select auth.uid())::text
  and (select public.tiene_permiso('diseno.codigos'))
  and name ~ '^[0-9a-f-]{36}\.(dxf|zip|rar|7z)$');

-- Diseño registra cada archivo que el navegador ya subió: el .dxf suelto o el
-- comprimido. Los que eligió juntos traen el mismo envío y la misma
-- descripción, y llegan en un solo aviso. El mismo pedido otra vez (la
-- respuesta no llegó) contesta con el mismo id. La de antes no llevaba el envío.
drop function if exists public.registrar_dxf_codigo(uuid, text, text, text);
create or replace function public.registrar_dxf_codigo(p_id uuid, p_codigo text, p_descripcion text, p_nombre_archivo text, p_envio uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_codigo  text;
  v_desc    text := regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g');
  v_archivo text := btrim(coalesce(p_nombre_archivo, ''));
  v_ext     text := lower(substring(btrim(coalesce(p_nombre_archivo, '')) from '\.([A-Za-z0-9]+)$'));
  v_ruta    text;
  v_objeto  storage.objects%rowtype;
  v_hay     public.codigo_dxf%rowtype;
  v_cuerpo  text;
  v_n       integer;
  v_dest    uuid[];
begin
  perform public.exigir_permiso('diseno.codigos');
  v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  if p_id is null or p_envio is null then
    raise exception 'Vuelve a elegir el archivo.' using errcode = 'check_violation';
  end if;
  if v_ext is null or v_ext not in ('dxf', 'zip', 'rar', '7z') then
    raise exception 'Sube el .dxf, o los DXF comprimidos en .zip, .rar o .7z.' using errcode = 'check_violation';
  end if;
  v_ruta := p_id::text || '.' || v_ext;

  select * into v_hay from public.codigo_dxf where id = p_id;
  if found then
    -- El mismo envío otra vez (el doble toque, la red que reintenta): es todo
    -- lo que el envío lleva. Con otra descripción u otro nombre no es el mismo.
    if v_hay.subido_por = v_yo and v_hay.codigo_interno = v_codigo and v_hay.ruta = v_ruta
       and v_hay.descripcion = v_desc and v_hay.nombre_archivo = v_archivo and v_hay.envio = p_envio then
      return p_id;
    end if;
    if v_hay.subido_por = v_yo and v_hay.codigo_interno = v_codigo then
      raise exception 'Ese archivo ya quedó registrado como «%» la primera vez que lo enviaste: recarga la pantalla.', v_hay.descripcion
        using errcode = 'check_violation';
    end if;
    raise exception 'Ese archivo ya quedó registrado en otro código: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 2 and 200 then
    raise exception 'Escribe qué traen los DXF, por ejemplo «Corte de planchas del chasis».' using errcode = 'check_violation';
  end if;
  if char_length(v_archivo) not between 1 and 200 then
    raise exception 'Vuelve a elegir el archivo.' using errcode = 'check_violation';
  end if;
  -- Los archivos del mismo envío se registran uno tras otro (el aviso se arma
  -- con todos): el bloqueo va antes de mirar el envío, para que dos llamadas a
  -- la vez con otra descripción no pasen las dos.
  perform pg_advisory_xact_lock(hashtext('codigo_dxf:' || p_envio::text));
  -- Un envío es de una persona, un código y una descripción: no se le suman archivos de otro.
  if exists (select 1 from public.codigo_dxf d
              where d.envio = p_envio
                and (d.subido_por is distinct from v_yo or d.codigo_interno <> v_codigo or d.descripcion <> v_desc)) then
    raise exception 'Ese envío ya quedó con otros datos: recarga la pantalla y vuelve a elegir los archivos.' using errcode = 'check_violation';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'dxf-codigo' and name = v_ruta;
  if not found or v_objeto.owner_id is distinct from v_yo::text
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 52428800 then
    raise exception 'El archivo no terminó de subir: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;

  insert into public.codigo_dxf (id, codigo_interno, descripcion, nombre_archivo, ruta, envio, tamano_bytes, subido_por)
  values (p_id, v_codigo, v_desc, v_archivo, v_ruta, p_envio, (v_objeto.metadata->>'size')::bigint, v_yo);

  -- El aviso a los supervisores de Maestranza, que corta, y de Producción, que
  -- ensambla: uno por envío, que dice cuántos archivos trae y los primeros.
  select count(*), string_agg(x.nombre_archivo, ', ' order by x.subido_en, x.nombre_archivo) filter (where x.n <= 5)
    into v_n, v_cuerpo
    from (select d.nombre_archivo, d.subido_en, row_number() over (order by d.subido_en, d.nombre_archivo) as n
            from public.codigo_dxf d where d.envio = p_envio and d.quitado_en is null) x;
  v_cuerpo := v_desc || ' (' || case when v_n = 1 then v_cuerpo
                                     else v_n || ' archivos: ' || v_cuerpo || case when v_n > 5 then ' y ' || (v_n - 5) || ' más' else '' end
                                end || ').';

  select coalesce(array_agg(u.id), '{}') into v_dest
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'codigos_internos.area'
   where u.activo and u.id is distinct from v_yo
     and (u.area_id in (select a.id from public.areas a where a.codigo in ('MTZ', 'PRD'))
          or exists (select 1 from public.roles_permisos x where x.rol_id = u.rol_id and x.permiso_codigo = 'produccion.cualquier_area'));

  -- Quien ya tiene el aviso de este envío (de un archivo anterior) lo ve
  -- actualizado y otra vez sin leer; los demás lo reciben nuevo.
  update public.notificaciones n
     set cuerpo = v_cuerpo, leida_en = null
   where n.usuario_id = any (v_dest) and n.origen_tabla = 'codigo_dxf'
     and n.origen_id in (select d.id from public.codigo_dxf d where d.envio = p_envio and d.id <> p_id);

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select x.id, 'DXF nuevos: ' || v_codigo, v_cuerpo, '/planos?q=' || replace(v_codigo, '/', '%2F'), 'codigo_dxf', p_id
    from unnest(v_dest) as x(id)
   where not exists (select 1 from public.notificaciones n
                      where n.usuario_id = x.id and n.origen_tabla = 'codigo_dxf'
                        and n.origen_id in (select d.id from public.codigo_dxf d where d.envio = p_envio and d.id <> p_id));
  return p_id;
end;
$$;
comment on function public.registrar_dxf_codigo(uuid, text, text, text, uuid) is
  'Diseño registra un DXF (.dxf suelto, o comprimido en .zip, .rar o .7z, hasta 50 MB) ya subido a dxf-codigo/{id}.{ext} para un código interno, y avisa a Maestranza y a Producción: un aviso por envío. Exige diseno.codigos.';
revoke all on function public.registrar_dxf_codigo(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.registrar_dxf_codigo(uuid, text, text, text, uuid) to authenticated;

-- Un envío entero que se subió al código equivocado: se quitan todos sus
-- archivos de una vez, no uno por uno. Quedan en el historial.
create or replace function public.quitar_dxf_envio(p_envio uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_n integer;
begin
  perform public.exigir_permiso('diseno.codigos');
  if not exists (select 1 from public.codigo_dxf where envio = p_envio) then
    raise exception 'Esos archivos ya no están. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  update public.codigo_dxf set quitado_en = now(), quitado_por = public.usuario_actual()
   where envio = p_envio and quitado_en is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.quitar_dxf_envio(uuid) from public, anon;
grant execute on function public.quitar_dxf_envio(uuid) to authenticated;
