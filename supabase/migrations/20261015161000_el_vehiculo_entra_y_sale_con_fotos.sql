-- =============================================================================
-- EL VEHÍCULO ENTRA Y SALE DE LA PLANTA CON SUS FOTOS
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-14) que al registrar el ingreso de un vehículo se le
-- tomen fotos, hasta 15, y lo mismo al salir. Es la evidencia de cómo llegó y
-- cómo se fue: un golpe, una llanta, un espejo que faltaba. Sin foto, después
-- nadie puede decir si el daño ya venía o se hizo en la planta.
--
--   * Cada ingreso y cada salida llevan de 1 a 15 fotos. El registro no entra
--     sin al menos una: la foto es la razón de registrarlo.
--   * Las fotos se achican en el teléfono y van primero al almacenamiento, a
--     {cuenta}/{registro}/ingreso/… o …/salida/…; después la función que
--     registra el ingreso o la salida las anota, en la misma transacción.
--   * Las ve quien ve el registro de vehículos (Requerimientos, Gerencia,
--     Administración, Supervisión general). Como el registro, no se cambian ni
--     se borran: si el ingreso se anotó mal, se anula y sus fotos quedan.
--   * Los vehículos que ya están en planta entraron sin fotos; su salida sí las
--     lleva.
--
-- Las funciones de antes (sin fotos) no se pueden borrar —el conector de
-- producción no deja pasar un DROP—: ahora contestan que se recargue la
-- pantalla, para que una pestaña vieja no registre sin fotos.
-- =============================================================================

-- 1. Las fotos ------------------------------------------------------------------------
create table if not exists public.registro_vehiculo_fotos (
  id              uuid primary key default gen_random_uuid(),
  registro_id     uuid not null,
  momento         text not null,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint registro_vehiculo_fotos_registro_id_fkey foreign key (registro_id) references public.registro_vehiculos(id) on delete restrict,
  -- También es el índice de la llave hacia el registro.
  constraint uq_registro_vehiculo_foto_orden unique (registro_id, momento, orden),
  -- Una foto, un registro; y la política de Storage la busca por su ruta.
  constraint uq_registro_vehiculo_foto_ruta unique (ruta),
  constraint ck_registro_vehiculo_foto check (
    momento in ('INGRESO', 'SALIDA')
    and orden between 1 and 15
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.registro_vehiculo_fotos is
  'De 1 a 15 fotos del ingreso y de la salida de cada vehículo, en el bucket fotos-vehiculos con la ruta {cuenta}/{registro}/ingreso|salida/…. No se cambian ni se borran.';

select public.activar_timestamps('registro_vehiculo_fotos');
select public.activar_auditoria('registro_vehiculo_fotos');
select public.activar_registro_de_prueba('registro_vehiculo_fotos');

create or replace function public.fn_vehiculo_foto_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Las fotos del ingreso y de la salida de un vehículo no se cambian ni se borran: quedan como evidencia.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_vehiculo_foto_guardia() from public, anon, authenticated;
create or replace trigger trg_vehiculo_foto_guardia
  before update or delete on public.registro_vehiculo_fotos
  for each row execute function public.fn_vehiculo_foto_guardia();

-- Quien ve el registro ve sus fotos: la consulta al registro pasa por su política.
alter table public.registro_vehiculo_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'registro_vehiculo_fotos'
                   and policyname = 'ver_registro_vehiculo_fotos') then
    create policy ver_registro_vehiculo_fotos on public.registro_vehiculo_fotos for select to authenticated
      using (exists (select 1 from public.registro_vehiculos v where v.id = registro_id));
  end if;
end $$;
revoke all on public.registro_vehiculo_fotos from public, anon, authenticated;
grant select on public.registro_vehiculo_fotos to authenticated;

-- 2. Las fotos en Storage --------------------------------------------------------------
-- Ya achicadas en el teléfono pesan unos cientos de KB: 5 MB es de sobra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-vehiculos', 'fotos-vehiculos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- La ruta es {cuenta}/{registro}/{ingreso|salida}/{foto}: cada cuenta sube solo a
-- su carpeta y solo quien registra vehículos. La foto la ve quien la subió y
-- quien ve el registro que la nombra; una suelta (subida y quitada del
-- formulario, o de un formulario que se cerró) la retira su dueño mientras
-- ningún registro la nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vehiculo_subir_foto') then
    create policy vehiculo_subir_foto on storage.objects for insert to authenticated with check (
      bucket_id = 'fotos-vehiculos' and owner_id = (select auth.uid())::text
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (select public.tiene_permiso('vehiculos.registrar')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vehiculo_ver_foto') then
    create policy vehiculo_ver_foto on storage.objects for select to authenticated using (
      bucket_id = 'fotos-vehiculos'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.registro_vehiculo_fotos f where f.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'vehiculo_quitar_foto_suelta') then
    create policy vehiculo_quitar_foto_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fotos-vehiculos' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.registro_vehiculo_fotos f where f.ruta = objects.name));
  end if;
end $$;

-- 3. Anotar las fotos de un ingreso o una salida -------------------------------------------
-- p_fotos: ["{cuenta}/{registro}/ingreso/{foto}.jpg", …], ya subidas a fotos-vehiculos.
-- La llaman las dos funciones de abajo, nadie más.
create or replace function public.vehiculo_anotar_fotos(p_registro uuid, p_momento text, p_fotos jsonb)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_carpeta text := lower(p_momento);
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if p_momento not in ('INGRESO', 'SALIDA') then
    raise exception 'Las fotos van con el ingreso o con la salida.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_fotos) <> 'array' or jsonb_array_length(v_fotos) = 0 then
    raise exception 'Toma al menos una foto del vehículo al %.', case p_momento when 'INGRESO' then 'entrar' else 'salir' end
      using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 15 then
    raise exception 'Van hasta 15 fotos al %.', case p_momento when 'INGRESO' then 'entrar' else 'salir' end
      using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_registro::text || '/' || v_carpeta || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos del vehículo.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-vehiculos' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.registro_vehiculo_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.registro_vehiculo_fotos (registro_id, momento, orden, ruta, mime_type, tamano_bytes)
    values (p_registro, p_momento, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
end;
$$;
revoke all on function public.vehiculo_anotar_fotos(uuid, text, jsonb) from public, anon, authenticated;

-- 4. El ingreso, con sus fotos --------------------------------------------------------------
-- Las mismas reglas de siempre (migración 20261012141000) y, al final, las fotos.
-- Un reintento con el mismo p_id devuelve el ingreso que ya entró con sus fotos.
create or replace function public.registrar_ingreso_vehiculo(
  p_id uuid, p_placa text, p_chasis text, p_codigo_interno text, p_unidad text, p_empresa text,
  p_motivo text, p_ingreso_en timestamptz, p_observacion text, p_fotos jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_placa  text := public.normalizar_placa(p_placa);
  v_chasis text := nullif(upper(btrim(coalesce(p_chasis, ''))), '');
  v_codigo text := nullif(btrim(coalesce(p_codigo_interno, '')), '');
  v_cuando timestamptz := coalesce(p_ingreso_en, now());
  v_actual public.registro_vehiculos%rowtype;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del ingreso.' using errcode = 'check_violation';
  end if;
  if coalesce(v_placa, v_chasis, v_codigo) is null then
    raise exception 'Anota la placa, el número de chasis o el código interno: sin eso no se sabe qué vehículo entró.'
      using errcode = 'check_violation';
  end if;
  if v_placa is not null and char_length(v_placa) not between 3 and 15 then
    raise exception 'La placa % no parece válida.', v_placa using errcode = 'check_violation';
  end if;
  if v_chasis is not null and char_length(v_chasis) not between 3 and 40 then
    raise exception 'El número de chasis va de 3 a 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_unidad, ''))) not between 2 and 120 then
    raise exception 'Describe el vehículo: tipo, marca o carrocería.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_empresa, ''))) not between 2 and 160 then
    raise exception 'Anota la empresa o el dueño del vehículo.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO', 'COCHERA', 'OTRO') then
    raise exception 'Elige el motivo del ingreso.' using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de ingreso no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < now() - interval '30 days' then
    raise exception 'Solo se registran ingresos de los últimos 30 días.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.registro_vehiculos where id = p_id;
  if found then
    if v_actual.ingreso_por = public.usuario_actual() and v_actual.placa is not distinct from v_placa
       and v_actual.chasis is not distinct from v_chasis then
      return p_id;
    end if;
    raise exception 'Este ingreso ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  if v_placa is not null and exists (select 1 from public.registro_vehiculos
                                       where placa = v_placa and salida_en is null and anulado_en is null) then
    raise exception 'El vehículo de placa % ya está en la planta: marca primero su salida.', v_placa
      using errcode = 'unique_violation';
  end if;
  if v_chasis is not null and exists (select 1 from public.registro_vehiculos
                                        where chasis = v_chasis and salida_en is null and anulado_en is null) then
    raise exception 'El chasis % ya está en la planta: marca primero su salida.', v_chasis
      using errcode = 'unique_violation';
  end if;

  insert into public.registro_vehiculos
    (id, placa, chasis, codigo_interno, unidad, empresa, motivo, ingreso_en, observacion_ingreso, ingreso_por)
  values
    (p_id, v_placa, v_chasis, v_codigo, btrim(p_unidad), btrim(p_empresa), p_motivo, v_cuando,
     nullif(btrim(coalesce(p_observacion, '')), ''), public.usuario_actual());
  perform public.vehiculo_anotar_fotos(p_id, 'INGRESO', p_fotos);
  return p_id;
end;
$$;
revoke all on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb) from public, anon;
grant execute on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text, jsonb) to authenticated;

-- 5. La salida, con sus fotos ----------------------------------------------------------------
create or replace function public.registrar_salida_vehiculo(p_id uuid, p_salida_en timestamptz, p_observacion text, p_fotos jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_reg    public.registro_vehiculos%rowtype;
  v_cuando timestamptz := coalesce(p_salida_en, now());
begin
  perform public.exigir_permiso('vehiculos.registrar');
  select * into v_reg from public.registro_vehiculos where id = p_id for update;
  if not found then raise exception 'El registro del vehículo no existe.'; end if;
  if v_reg.anulado_en is not null then
    raise exception 'Ese ingreso está anulado.' using errcode = 'check_violation';
  end if;
  if v_reg.salida_en is not null then return p_id; end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de salida no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < v_reg.ingreso_en then
    raise exception 'La salida no puede ser anterior al ingreso (%).',
      to_char(v_reg.ingreso_en at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI') using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.registro_vehiculos
     set salida_en = v_cuando, salida_por = public.usuario_actual(),
         observacion_salida = nullif(btrim(coalesce(p_observacion, '')), '')
   where id = p_id;
  perform public.vehiculo_anotar_fotos(p_id, 'SALIDA', p_fotos);
  return p_id;
end;
$$;
revoke all on function public.registrar_salida_vehiculo(uuid, timestamptz, text, jsonb) from public, anon;
grant execute on function public.registrar_salida_vehiculo(uuid, timestamptz, text, jsonb) to authenticated;

-- 6. Las de antes, sin fotos, ya no registran -------------------------------------------------
create or replace function public.registrar_ingreso_vehiculo(
  p_id uuid, p_placa text, p_chasis text, p_codigo_interno text, p_unidad text, p_empresa text,
  p_motivo text, p_ingreso_en timestamptz, p_observacion text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('vehiculos.registrar');
  raise exception 'El ingreso del vehículo ahora lleva sus fotos: recarga la pantalla y vuelve a registrarlo.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text) from public, anon;

create or replace function public.registrar_salida_vehiculo(p_id uuid, p_salida_en timestamptz, p_observacion text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('vehiculos.registrar');
  raise exception 'La salida del vehículo ahora lleva sus fotos: recarga la pantalla y vuelve a marcarla.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.registrar_salida_vehiculo(uuid, timestamptz, text) from public, anon;
