-- =============================================================================
-- SSOMA: EL PUESTO Y EL REPORTE DE INCIDENTE
-- -----------------------------------------------------------------------------
-- DKS pidió el 2026-11-25 el área de SSOMA (Plan 15, entrega 15.1). Hasta hoy
-- SSOMA existía solo como área (código SST), sin puesto ni pantallas, y la
-- carpeta «18) SSOMA (SST)» del SIG está vacía. Lo que nace aquí:
--
--   * EL PUESTO DE SSOMA (rol `SSOMA`): lleva los reportes de seguridad. No se
--     crea ninguna cuenta: la da de alta el administrador.
--   * EL REPORTE DE INCIDENTE (RI-0001-2026): un accidente, un incidente o una
--     condición insegura, con el área, el lugar, cuándo pasó, qué pasó y hasta
--     cuatro fotos. LO REPORTA CUALQUIER PERSONA CON CUENTA, desde su teléfono.
--     Sigue el registro de accidentes de trabajo, incidentes peligrosos y otros
--     incidentes de la R.M. 050-2013-TR (Ley 29783).
--   * POR UN OPERARIO SIN CUENTA REPORTA SU SUPERVISOR, a su nombre, eligiéndolo
--     de la lista de RR. HH. De esa lista se lee solo el nombre, el cargo y el
--     área: nunca el DNI, las cuentas ni los costos.
--   * A SSOMA le llega el aviso por la campana.
--   * QUIÉN REPORTÓ LO VEN SOLO SSOMA Y GERENCIA (y quien lo reportó, lo suyo).
--     El área donde pasó ve el hecho, sin el nombre, sin el puesto y sin las
--     fotos. Por eso la tabla se lee con el permiso de SSOMA o siendo el autor,
--     y el área lo lee por una función que no devuelve esas columnas. Y por eso
--     ninguna de las dos tablas lleva la auditoría genérica: copiaría la fila
--     entera, con el autor, a `audit_log`, que se lee con otro permiso. La
--     evidencia es la tabla misma: de un reporte solo cambia su anulación.
--   * NO SE GUARDAN DIAGNÓSTICOS MÉDICOS: de un accidente se anota solo si
--     hubo atención médica (los días perdidos los pone SSOMA al clasificar,
--     entrega 15.2).
--   * NO SE BORRA: SSOMA lo anula con su motivo y queda como evidencia.
--
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos y puesto ---------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('ssoma.gestionar', 'SSOMA',
   'Llevar los reportes de seguridad: recibir el aviso de cada uno, verlos todos con quién los reportó y anularlos con su motivo'),
  ('ssoma.ver', 'SSOMA',
   'Consultar todos los reportes de seguridad, con quién los reportó y sus fotos'),
  ('ssoma.reportar_por_otro', 'SSOMA',
   'Reportar un incidente a nombre de un trabajador sin cuenta, eligiéndolo de la lista de RR. HH. (solo nombre, cargo y área)')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('SSOMA', 'SSOMA',
   'Seguridad, salud ocupacional y medio ambiente: lleva los reportes de incidentes hasta su cierre', 45, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

-- Reportar no lleva permiso: lo hace cualquier cuenta activa. Gerencia consulta.
-- Reportan por un operario sin cuenta quienes tienen gente a cargo en la planta.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'SSOMA' and p.codigo in ('ssoma.gestionar', 'ssoma.ver', 'ssoma.reportar_por_otro'))
    or (r.codigo = 'GERENTE' and p.codigo = 'ssoma.ver')
    or (r.codigo in ('SUPERVISOR', 'JEFE_PRODUCCION', 'JEFE_TALLER') and p.codigo = 'ssoma.reportar_por_otro')
on conflict do nothing;

-- 2. La serie del reporte -------------------------------------------------------------
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'REPORTE_INCIDENTE', '001', 'RI', 0, 4, 'RI-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'REPORTE_INCIDENTE' and serie = '001');

-- 3. El reporte -----------------------------------------------------------------------
create table if not exists public.ssoma_reportes (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null,
  tipo              text not null,
  -- El área donde pasó. La lista filtra por ella para «los de tu área» (b).
  area_id           uuid not null references public.areas(id) on delete restrict,
  lugar             text not null,
  descripcion       text not null,
  ocurrido_en       timestamptz not null,
  -- Solo de un accidente, y solo si hubo o no: nunca el diagnóstico.
  hubo_atencion     boolean,
  -- A nombre de quién se reporta, cuando esa persona no tiene cuenta. Ni (a) ni
  -- (b) ni (c): la pantalla no filtra por trabajador y un trabajador no se borra.
  trabajador_id     uuid references public.trabajadores(id) on delete restrict,
  estado            text not null default 'REPORTADO',
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint uq_ssoma_reporte_numero unique (numero),
  constraint ck_ssoma_reporte_datos check (
    tipo in ('ACCIDENTE', 'INCIDENTE', 'CONDICION_INSEGURA')
    and char_length(btrim(lugar)) between 3 and 120
    and char_length(btrim(descripcion)) between 10 and 2000
    and (hubo_atencion is null or tipo = 'ACCIDENTE')),
  constraint ck_ssoma_reporte_estado check (
    (estado = 'REPORTADO' and anulado_en is null and anulado_por is null and motivo_anulacion is null)
    or (estado = 'ANULADO' and anulado_en is not null and anulado_por is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.ssoma_reportes is
  'El reporte de un accidente, un incidente o una condición insegura (RI-…), que hace cualquier cuenta. Quién lo reportó lo ven SSOMA, Gerencia y su autor; el área lo lee sin nombre por ssoma_reportes_visibles. No se borra: SSOMA lo anula con su motivo. Sin auditoría genérica a propósito (copiaría al autor a audit_log).';
comment on column public.ssoma_reportes.trabajador_id is
  'A nombre de quién se reporta cuando esa persona no tiene cuenta: la elige quien tiene ssoma.reportar_por_otro de la lista de RR. HH.';
comment on column public.ssoma_reportes.hubo_atencion is
  'De un accidente: si hubo atención médica. No se guarda el diagnóstico.';
-- La lista se lee de la más reciente a la más vieja (b).
create index if not exists ix_ssoma_reportes_creado on public.ssoma_reportes (creado_en desc);
-- «Los de tu área» y «tus reportes» (b); sirven también a sus llaves.
create index if not exists ix_ssoma_reportes_area on public.ssoma_reportes (area_id);
create index if not exists ix_ssoma_reportes_autor on public.ssoma_reportes (registrado_por);
select public.activar_timestamps('ssoma_reportes');
select public.activar_registro_de_prueba('ssoma_reportes');

-- 4. Sus fotos ------------------------------------------------------------------------
create table if not exists public.ssoma_reporte_fotos (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ssoma_reporte_fotos_reporte_id_fkey foreign key (reporte_id) references public.ssoma_reportes(id) on delete restrict,
  -- También es el índice de la llave hacia el reporte.
  constraint uq_ssoma_reporte_foto_orden unique (reporte_id, orden),
  -- Una foto, un reporte; y la política de Storage la busca por su ruta.
  constraint uq_ssoma_reporte_foto_ruta unique (ruta),
  constraint ck_ssoma_reporte_foto check (
    orden between 1 and 4
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.ssoma_reporte_fotos is
  'Hasta 4 fotos de un reporte de seguridad, en el bucket fotos-ssoma con la ruta {cuenta}/{reporte}/…. Las ve quien ve el reporte con su autor (SSOMA, Gerencia y quien reportó); el área no. No se cambian ni se borran.';
select public.activar_timestamps('ssoma_reporte_fotos');
select public.activar_registro_de_prueba('ssoma_reporte_fotos');

-- 5. Lo que no se borra ni se corrige por debajo ---------------------------------------
create or replace function public.fn_ssoma_reporte_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte de seguridad no se borra: SSOMA lo anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADO' then
    raise exception 'El reporte % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice el reporte % no se corrige: si está mal, SSOMA lo anula con su motivo y se reporta de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_reporte_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_reporte_guardia
  before update or delete on public.ssoma_reportes
  for each row execute function public.fn_ssoma_reporte_guardia();

create or replace function public.fn_ssoma_foto_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Las fotos de un reporte de seguridad no se cambian ni se borran: quedan como evidencia.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_ssoma_foto_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_foto_guardia
  before update or delete on public.ssoma_reporte_fotos
  for each row execute function public.fn_ssoma_foto_guardia();

-- 6. Quién ve qué -----------------------------------------------------------------------
-- La tabla, con el autor, la leen SSOMA y Gerencia (y el administrador del
-- sistema), y cada quien lo suyo. El área no la lee: va por la función del punto 9.
create or replace function public.puede_ver_reportes_ssoma()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('ssoma.ver') or public.tiene_permiso('ssoma.gestionar');
$$;
revoke all on function public.puede_ver_reportes_ssoma() from public, anon;
grant execute on function public.puede_ver_reportes_ssoma() to authenticated;

alter table public.ssoma_reportes enable row level security;
alter table public.ssoma_reporte_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_reportes' and policyname = 'ver_ssoma_reportes') then
    create policy ver_ssoma_reportes on public.ssoma_reportes for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()) or registrado_por = (select public.usuario_actual()));
  end if;
  -- Quien ve el reporte en la tabla ve sus fotos: la consulta pasa por la política de arriba.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_reporte_fotos' and policyname = 'ver_ssoma_reporte_fotos') then
    create policy ver_ssoma_reporte_fotos on public.ssoma_reporte_fotos for select to authenticated
      using (exists (select 1 from public.ssoma_reportes r where r.id = reporte_id));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo.
revoke all on public.ssoma_reportes from public, anon, authenticated;
revoke all on public.ssoma_reporte_fotos from public, anon, authenticated;
grant select on public.ssoma_reportes to authenticated;
grant select on public.ssoma_reporte_fotos to authenticated;

-- 7. Las fotos en Storage ------------------------------------------------------------------
-- Ya achicadas en el teléfono pesan unos cientos de KB: 5 MB es de sobra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-ssoma', 'fotos-ssoma', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- «Ningún reporte la nombra» se pregunta por encima del RLS: bajo él, una fila
-- que quien pregunta no ve contaría como inexistente.
create or replace function public.ssoma_foto_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.ssoma_foto_anotada(text) from public, anon;
grant execute on function public.ssoma_foto_anotada(text) to authenticated;

-- La ruta es {cuenta}/{reporte}/{foto}: cada cuenta sube solo a su carpeta, y
-- sube cualquier cuenta activa, porque reporta cualquiera. La foto la ve quien
-- la subió y quien ve el reporte que la nombra (SSOMA, Gerencia); una suelta
-- la retira su dueño mientras ningún reporte la nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ssoma_subir_foto') then
    create policy ssoma_subir_foto on storage.objects for insert to authenticated with check (
      bucket_id = 'fotos-ssoma' and owner_id = (select auth.uid())::text
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (select public.es_usuario_activo()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ssoma_ver_foto') then
    create policy ssoma_ver_foto on storage.objects for select to authenticated using (
      bucket_id = 'fotos-ssoma'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ssoma_quitar_foto_suelta') then
    create policy ssoma_quitar_foto_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fotos-ssoma' and owner_id = (select auth.uid())::text
      and not public.ssoma_foto_anotada(objects.name));
  end if;
end $$;

-- p_fotos: ["{cuenta}/{reporte}/{foto}.jpg", …], ya subidas a fotos-ssoma. De 0 a 4.
-- La llama solo ssoma_reportar.
create or replace function public.ssoma_anotar_fotos(p_reporte uuid, p_fotos jsonb)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 4 then
    raise exception 'Van hasta 4 fotos por reporte.' using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_reporte::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-ssoma' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.ssoma_reporte_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.ssoma_reporte_fotos (reporte_id, orden, ruta, mime_type, tamano_bytes)
    values (p_reporte, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
end;
$$;
revoke all on function public.ssoma_anotar_fotos(uuid, jsonb) from public, anon, authenticated;

-- 8. Reportar y anular -------------------------------------------------------------------
-- De RR. HH. sale solo el nombre, el cargo y el área, y solo para quien reporta
-- por otro: nunca el DNI, las cuentas ni los costos.
create or replace function public.ssoma_personal_para_elegir()
returns table (id uuid, nombre text, cargo text, area text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('ssoma.reportar_por_otro')) then
    raise exception 'No tienes permiso para reportar a nombre de otra persona.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select t.id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre
      from public.trabajadores t
      left join public.areas a on a.id = t.area_id
     where t.activo
     order by t.apellidos, t.nombres;
end;
$$;
comment on function public.ssoma_personal_para_elegir() is
  'La lista de RR. HH. para reportar a nombre de un trabajador sin cuenta: solo nombre, cargo y área. Exige ssoma.reportar_por_otro.';
revoke all on function public.ssoma_personal_para_elegir() from public, anon;
grant execute on function public.ssoma_personal_para_elegir() to authenticated;

-- Reporta cualquier cuenta activa. Un reintento con el mismo p_id y lo mismo
-- devuelve el reporte que ya entró; con otra cosa, dice que ya quedó.
create or replace function public.ssoma_reportar(
  p_id uuid, p_tipo text, p_area uuid, p_lugar text, p_descripcion text, p_ocurrido_en timestamptz,
  p_hubo_atencion boolean, p_trabajador uuid, p_fotos jsonb
) returns table (reporte uuid, numero_reporte text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_tipo, p_area, p_lugar, p_descripcion, p_ocurrido_en, p_hubo_atencion, p_trabajador, p_fotos);
  v_cuando  timestamptz := coalesce(p_ocurrido_en, now());
  v_lugar   text := regexp_replace(btrim(coalesce(p_lugar, '')), '\s+', ' ', 'g');
  v_que     text := btrim(coalesce(p_descripcion, ''));
  v_actual  public.ssoma_reportes%rowtype;
  v_area    public.areas%rowtype;
  v_numero  text;
  v_clase   text;
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para reportar.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;
  select * into v_actual from public.ssoma_reportes where id = p_id;
  if found then
    if v_actual.registrado_por = v_yo and public.mismo_envio(p_id, 'REPORTE_SSOMA', v_envio) then
      return query select v_actual.id, v_actual.numero;
      return;
    end if;
    if v_actual.registrado_por = v_yo then
      raise exception 'El reporte % ya quedó registrado la primera vez que lo enviaste: lo que cambiaste después no se guardó. Si está mal, pídele a SSOMA que lo anule y repórtalo de nuevo.', v_actual.numero
        using errcode = 'check_violation';
    end if;
    raise exception 'Ese reporte ya existe con otros datos: vuelve a abrir el formulario.' using errcode = 'unique_violation';
  end if;

  if p_tipo is null or p_tipo not in ('ACCIDENTE', 'INCIDENTE', 'CONDICION_INSEGURA') then
    raise exception 'Elige qué reportas: un accidente, un incidente o una condición insegura.' using errcode = 'check_violation';
  end if;
  select * into v_area from public.areas where id = p_area and activo;
  if not found then
    raise exception 'Elige el área donde pasó.' using errcode = 'check_violation';
  end if;
  if char_length(v_lugar) not between 3 and 120 then
    raise exception 'Escribe el lugar exacto (de 3 a 120 caracteres): la nave, la máquina o la zona.' using errcode = 'check_violation';
  end if;
  if char_length(v_que) not between 10 and 2000 then
    raise exception 'Cuenta qué pasó o qué viste, en al menos 10 caracteres.' using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '10 minutes' then
    raise exception 'La fecha y la hora del hecho no pueden ser futuras.' using errcode = 'check_violation';
  end if;
  if v_cuando < now() - interval '30 days' then
    raise exception 'El hecho se reporta dentro de los 30 días: si es más antiguo, avísale a SSOMA.' using errcode = 'check_violation';
  end if;
  if p_hubo_atencion is not null and p_tipo <> 'ACCIDENTE' then
    raise exception 'La atención médica se anota solo en un accidente.' using errcode = 'check_violation';
  end if;
  if p_trabajador is not null then
    if not (public.es_admin() or public.tiene_permiso('ssoma.reportar_por_otro')) then
      raise exception 'No tienes permiso para reportar a nombre de otra persona.' using errcode = 'insufficient_privilege';
    end if;
    if not exists (select 1 from public.trabajadores t where t.id = p_trabajador and t.activo) then
      raise exception 'Esa persona ya no figura en la lista de RR. HH.: elige otra o reporta sin nombre.' using errcode = 'check_violation';
    end if;
  end if;

  v_numero := public.siguiente_correlativo('REPORTE_INCIDENTE', '001', null);
  insert into public.ssoma_reportes (id, numero, tipo, area_id, lugar, descripcion, ocurrido_en, hubo_atencion, trabajador_id, registrado_por)
  values (p_id, v_numero, p_tipo, p_area, v_lugar, v_que, v_cuando, p_hubo_atencion, p_trabajador, v_yo);
  perform public.ssoma_anotar_fotos(p_id, p_fotos);
  perform public.anotar_envio(p_id, 'REPORTE_SSOMA', v_envio);

  v_clase := case p_tipo when 'ACCIDENTE' then 'Accidente' when 'INCIDENTE' then 'Incidente' else 'Condición insegura' end;
  perform public.avisar_a_permiso('ssoma.gestionar',
    v_clase || ' reportado en ' || v_area.nombre || ': ' || v_numero,
    v_lugar || ' · ' || left(v_que, 200),
    '/ssoma/' || p_id::text, 'ssoma_reportes', p_id);

  return query select p_id, v_numero;
end;
$$;
comment on function public.ssoma_reportar(uuid, text, uuid, text, text, timestamptz, boolean, uuid, jsonb) is
  'Cualquier cuenta activa reporta un accidente, un incidente o una condición insegura, con sus fotos ya en Storage; da el número RI-… y avisa a SSOMA. A nombre de un trabajador sin cuenta exige ssoma.reportar_por_otro.';
revoke all on function public.ssoma_reportar(uuid, text, uuid, text, text, timestamptz, boolean, uuid, jsonb) from public, anon;
grant execute on function public.ssoma_reportar(uuid, text, uuid, text, text, timestamptz, boolean, uuid, jsonb) to authenticated;

-- Un reporte mal hecho no se borra: SSOMA lo anula, y a quien lo reportó le llega el aviso.
create or replace function public.ssoma_anular_reporte(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_rep  public.ssoma_reportes%rowtype;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'No tienes permiso para anular un reporte de seguridad.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rep from public.ssoma_reportes where id = p_id for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_rep.estado = 'ANULADO' then return p_id; end if;
  update public.ssoma_reportes
     set estado = 'ANULADO', anulado_por = v_yo, anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  if v_rep.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_rep.registrado_por, 'SSOMA anuló tu reporte ' || v_rep.numero, left(btrim(p_motivo), 500),
            '/ssoma/' || p_id::text, 'ssoma_reportes', p_id);
  end if;
  return p_id;
end;
$$;
comment on function public.ssoma_anular_reporte(uuid, text) is
  'SSOMA anula un reporte de seguridad con su motivo; avisa a quien lo reportó. Exige ssoma.gestionar.';
revoke all on function public.ssoma_anular_reporte(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_reporte(uuid, text) to authenticated;

-- 9. Lo que cada quien lee ------------------------------------------------------------------
-- Una sola lectura para la lista (p_id vacío) y el detalle. `alcance` dice por qué lo ve:
--   TODOS  · SSOMA, Gerencia y el administrador: todo, con quién reportó.
--   PROPIO · quien lo reportó: lo suyo, completo.
--   AREA   · quien trabaja en el área donde pasó: el hecho, sin quién lo
--            reportó, sin a nombre de quién, sin fotos y sin los anulados.
create or replace function public.ssoma_reportes_visibles(p_id uuid)
returns table (
  id uuid, numero text, tipo text, area_id uuid, area_codigo text, area text, lugar text, descripcion text,
  ocurrido_en timestamptz, hubo_atencion boolean, estado text, creado_en timestamptz, dias_en_espera integer,
  alcance text, reporto text, reporto_puesto text, a_nombre_de text, a_nombre_de_cargo text, fotos integer,
  anulado_en timestamptz, anulo text, motivo_anulacion text)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, u.area_id, public.puede_ver_reportes_ssoma() as todo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select r.*, case when yo.todo then 'TODOS' when r.registrado_por = yo.id then 'PROPIO' else 'AREA' end as alcance
      from public.ssoma_reportes r
      cross join yo
     where (p_id is null or r.id = p_id)
       and (yo.todo
            or r.registrado_por = yo.id
            or (r.area_id = yo.area_id and r.estado <> 'ANULADO'))
  )
  select v.id, v.numero, v.tipo, v.area_id, a.codigo, a.nombre, v.lugar, v.descripcion,
         v.ocurrido_en, v.hubo_atencion, v.estado, v.creado_en,
         case when v.estado = 'REPORTADO'
              then (now() at time zone 'America/Lima')::date - (v.creado_en at time zone 'America/Lima')::date end,
         v.alcance,
         case when v.alcance <> 'AREA' then btrim(u.nombres || ' ' || u.apellidos) end,
         case when v.alcance <> 'AREA' then ro.nombre end,
         case when v.alcance <> 'AREA' then btrim(t.nombres || ' ' || t.apellidos) end,
         case when v.alcance <> 'AREA' then t.cargo end,
         case when v.alcance <> 'AREA'
              then (select count(*)::integer from public.ssoma_reporte_fotos f where f.reporte_id = v.id) else 0 end,
         v.anulado_en,
         case when v.alcance <> 'AREA' then btrim(an.nombres || ' ' || an.apellidos) end,
         case when v.alcance <> 'AREA' then v.motivo_anulacion end
    from visibles v
    join public.areas a on a.id = v.area_id
    join public.usuarios u on u.id = v.registrado_por
    left join public.roles ro on ro.id = u.rol_id
    left join public.trabajadores t on t.id = v.trabajador_id
    left join public.usuarios an on an.id = v.anulado_por;
$$;
comment on function public.ssoma_reportes_visibles(uuid) is
  'Los reportes de seguridad que ve quien pregunta (uno, o todos con p_id vacío): todos (SSOMA, Gerencia), los suyos, y los del área donde trabaja sin quién los reportó, sin fotos y sin los anulados. dias_en_espera se cuenta con la fecha de Lima.';
revoke all on function public.ssoma_reportes_visibles(uuid) from public, anon;
grant execute on function public.ssoma_reportes_visibles(uuid) to authenticated;
