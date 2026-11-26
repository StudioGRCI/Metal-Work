-- =============================================================================
-- SSOMA: CHARLAS E INDUCCIONES
-- -----------------------------------------------------------------------------
-- Plan 15, entrega 15.3 (DKS, 2026-11-25): «charlas e inducciones, con tema,
-- expositor, fecha, foto y asistentes de la lista de RR. HH.; quién no asistió
-- en el mes.»
--
--   * LA CHARLA. SSOMA registra cada charla de seguridad o inducción con su
--     tema, quién la dio (texto: puede ser alguien de fuera), la fecha, de una a
--     cuatro fotos y quiénes asistieron, elegidos de la lista de personal de
--     RR. HH. De RR. HH. se lee solo nombre, cargo y área: nunca DNI, cuentas ni
--     costos.
--   * NO SE BORRA. Una charla mal registrada se anula con su motivo, quién y
--     cuándo, y se registra otra. No se corrige por debajo: lo que se registró
--     es la evidencia de quién estuvo.
--   * QUIÉN NO ASISTIÓ EN EL MES: el personal activo de RR. HH. que no figura en
--     ninguna charla ni inducción vigente de ese mes (fecha de Lima), con la
--     última vez que asistió a una.
--   * QUIÉN VE: SSOMA registra y anula (`ssoma.gestionar`); SSOMA y Gerencia
--     consultan (`ssoma.ver`). Nadie más: la lista de asistencia nombra a
--     personas.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 0. Las funciones de la 15.2 que esta reescribe son las que el repositorio conoce ---------
-- Valen la huella de la 15.2 y la de esta migración (volver a correrla).
do $$
declare
  v record;
begin
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.ssoma_foto_anotada(text)', array['2e0b6ef025271d045e3bb6907f35fc1d', '39d18343bd0de385bf4dd84689db0bc7'])
      ) as f(firma, huellas)
      left join pg_proc p on p.oid = to_regprocedure(f.firma)
  loop
    if v.huella is null then
      raise exception 'Falta %: esta base no tiene la entrega 15.2 de SSOMA.', v.firma;
    end if;
    if not (v.huella = any (v.huellas)) then
      raise exception '% no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v.firma, v.huella;
    end if;
  end loop;
end $$;

-- 1. La charla ----------------------------------------------------------------------------------
create table if not exists public.ssoma_charlas (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null,
  tema              text not null,
  expositor         text not null,
  fecha             date not null,
  creado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_ssoma_charla_datos check (
    tipo in ('CHARLA', 'INDUCCION')
    and char_length(btrim(tema)) between 5 and 200
    and char_length(btrim(expositor)) between 3 and 120),
  constraint ck_ssoma_charla_anulada check (
    (anulado_por is null and anulado_en is null and motivo_anulacion is null)
    or (anulado_por is not null and anulado_en is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.ssoma_charlas is
  'Cada charla de seguridad o inducción que registra SSOMA: tema, expositor, fecha, fotos y asistentes de la lista de RR. HH. No se corrige ni se borra: se anula con su motivo.';
-- Las del mes (b): la lista y «quién no asistió» filtran por la fecha.
create index if not exists ix_ssoma_charlas_fecha on public.ssoma_charlas (fecha);
select public.activar_timestamps('ssoma_charlas');
-- Sin `activar_auditoria`: la copia en `audit_log` la lee quien tiene
-- `auditoria.ver`, que no ve SSOMA. Quién y cuándo ya están en la fila.
select public.activar_registro_de_prueba('ssoma_charlas');

-- Quiénes asistieron: personas de la lista de RR. HH. (tengan o no cuenta).
-- Con su `id`, para que `pruebas_limpiar` reconozca la fila de un lote de prueba
-- como suya y no se niegue a limpiar la charla.
create table if not exists public.ssoma_charla_asistentes (
  id              uuid primary key default gen_random_uuid(),
  charla_id       uuid not null references public.ssoma_charlas(id) on delete restrict,
  -- «Quién no asistió» busca por persona (b).
  trabajador_id   uuid not null references public.trabajadores(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  -- También es el índice de la llave hacia la charla.
  constraint uq_ssoma_charla_asistente unique (charla_id, trabajador_id)
);
comment on table public.ssoma_charla_asistentes is
  'Quiénes asistieron a cada charla o inducción de SSOMA, de la lista de personal de RR. HH. No se cambia ni se borra.';
create index if not exists ix_ssoma_charla_asistentes_trabajador on public.ssoma_charla_asistentes (trabajador_id);
select public.activar_timestamps('ssoma_charla_asistentes');
select public.activar_registro_de_prueba('ssoma_charla_asistentes');

-- Las fotos de la charla: de una a cuatro, en fotos-ssoma con la ruta {cuenta}/{charla}/{foto}.
create table if not exists public.ssoma_charla_fotos (
  id              uuid primary key default gen_random_uuid(),
  charla_id       uuid not null references public.ssoma_charlas(id) on delete restrict,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  -- También es el índice de la llave hacia la charla.
  constraint uq_ssoma_charla_foto_orden unique (charla_id, orden),
  -- La política de Storage la busca por su ruta.
  constraint uq_ssoma_charla_foto_ruta unique (ruta),
  constraint ck_ssoma_charla_foto check (
    orden between 1 and 4
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.ssoma_charla_fotos is
  'Las fotos de cada charla o inducción de SSOMA: hasta 4, en el bucket fotos-ssoma. Las ven SSOMA y Gerencia. No se cambian ni se borran.';
select public.activar_timestamps('ssoma_charla_fotos');
select public.activar_registro_de_prueba('ssoma_charla_fotos');

-- 2. Lo que no se borra ni se corrige por debajo ----------------------------------------------
create or replace trigger trg_ssoma_charla_asistente_guardia
  before update or delete on public.ssoma_charla_asistentes
  for each row execute function public.fn_ssoma_solo_se_agrega();
create or replace trigger trg_ssoma_charla_foto_guardia
  before update or delete on public.ssoma_charla_fotos
  for each row execute function public.fn_ssoma_solo_se_agrega();

-- La charla solo cambia al anularse; quién y cuándo los pone la base. Anulada, queda congelada.
create or replace function public.fn_ssoma_charla_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una charla no se borra: SSOMA la anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'La charla está anulada: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Una charla registrada no se corrige: SSOMA la anula y registra otra.' using errcode = 'check_violation';
  end if;
  if new.motivo_anulacion is not null then
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_charla_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_charla_guardia
  before update or delete on public.ssoma_charlas
  for each row execute function public.fn_ssoma_charla_guardia();

-- 3. Quién lee las tablas: SSOMA y Gerencia. Se escriben solo por las funciones ---------------
alter table public.ssoma_charlas enable row level security;
alter table public.ssoma_charla_asistentes enable row level security;
alter table public.ssoma_charla_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_charlas' and policyname = 'ver_ssoma_charlas') then
    create policy ver_ssoma_charlas on public.ssoma_charlas for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_charla_asistentes' and policyname = 'ver_ssoma_charla_asistentes') then
    create policy ver_ssoma_charla_asistentes on public.ssoma_charla_asistentes for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_charla_fotos' and policyname = 'ver_ssoma_charla_fotos') then
    create policy ver_ssoma_charla_fotos on public.ssoma_charla_fotos for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
end $$;
revoke all on public.ssoma_charlas from public, anon, authenticated;
revoke all on public.ssoma_charla_asistentes from public, anon, authenticated;
revoke all on public.ssoma_charla_fotos from public, anon, authenticated;
grant select on public.ssoma_charlas to authenticated;
grant select on public.ssoma_charla_asistentes to authenticated;
grant select on public.ssoma_charla_fotos to authenticated;

-- 4. Las fotos en Storage: el mismo bucket. «Ninguna fila la nombra» mira también las de
-- las charlas, y la foto de una charla la ve quien ve la charla (SSOMA y Gerencia).
create or replace function public.ssoma_foto_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = p_ruta)
      or exists (select 1 from public.ssoma_accion_fotos f where f.ruta = p_ruta)
      or exists (select 1 from public.ssoma_charla_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.ssoma_foto_anotada(text) from public, anon;
grant execute on function public.ssoma_foto_anotada(text) to authenticated;

alter policy ssoma_ver_foto on storage.objects using (
  bucket_id = 'fotos-ssoma'
  and (owner_id = (select auth.uid())::text
       or exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = objects.name)
       or exists (select 1 from public.ssoma_accion_fotos f where f.ruta = objects.name)
       or exists (select 1 from public.ssoma_charla_fotos f where f.ruta = objects.name)));

-- 5. La lista de RR. HH. para marcar asistentes: solo nombre, cargo y área ----------------------
create or replace function public.ssoma_personal_para_charla()
returns table (id uuid, nombre text, cargo text, area text)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'La asistencia a una charla la registra SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select t.id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre
      from public.trabajadores t
      left join public.areas a on a.id = t.area_id
     where t.activo
     order by a.nombre nulls last, t.apellidos, t.nombres;
end;
$$;
comment on function public.ssoma_personal_para_charla() is
  'El personal activo de RR. HH. para marcar quién asistió a una charla: solo nombre, cargo y área. Exige ssoma.gestionar.';
revoke all on function public.ssoma_personal_para_charla() from public, anon;
grant execute on function public.ssoma_personal_para_charla() to authenticated;

-- 6. Registrar la charla -----------------------------------------------------------------------
-- El id lo pone la ventana: es la carpeta de sus fotos, y un reintento con lo
-- mismo devuelve la charla que ya entró.
create or replace function public.ssoma_registrar_charla(
  p_id uuid, p_tipo text, p_tema text, p_expositor text, p_fecha date, p_asistentes uuid[], p_fotos jsonb
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo        uuid := public.usuario_actual();
  v_envio     constant jsonb := jsonb_build_array(p_tipo, p_tema, p_expositor, p_fecha, p_asistentes, p_fotos);
  v_tema      text := regexp_replace(btrim(coalesce(p_tema, '')), '\s+', ' ', 'g');
  v_expositor text := regexp_replace(btrim(coalesce(p_expositor, '')), '\s+', ' ', 'g');
  v_hoy       date := public.ssoma_hoy();
  v_actual    public.ssoma_charlas%rowtype;
  v_personas  uuid[];
  v_fotos     jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_ruta      text;
  v_objeto    storage.objects%rowtype;
  v_n         int := 0;
  v_inactivo  text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una charla la registra SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la charla.' using errcode = 'check_violation'; end if;
  select * into v_actual from public.ssoma_charlas where id = p_id;
  if found then
    -- El mismo pedido, de la misma persona: se perdió la respuesta.
    if v_actual.creado_por is distinct from v_yo then
      raise exception 'Vuelve a abrir el formulario de la charla.' using errcode = 'check_violation';
    end if;
    if public.mismo_envio(p_id, 'CHARLA_SSOMA', v_envio) then return p_id; end if;
    raise exception 'Esa charla ya quedó registrada la primera vez que la enviaste: lo que cambiaste después no se guardó.'
      using errcode = 'check_violation';
  end if;

  if p_tipo is null or p_tipo not in ('CHARLA', 'INDUCCION') then
    raise exception 'Elige si fue una charla o una inducción.' using errcode = 'check_violation';
  end if;
  if char_length(v_tema) not between 5 and 200 then
    raise exception 'Escribe el tema, en 5 a 200 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_expositor) not between 3 and 120 then
    raise exception 'Escribe quién dio la charla, en 3 a 120 caracteres.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'La fecha de la charla no puede ser posterior a hoy.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 60 then
    raise exception 'Se registran las charlas de los últimos 60 días.' using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_personas from unnest(coalesce(p_asistentes, '{}')) as x where x is not null;
  if cardinality(v_personas) = 0 then
    raise exception 'Marca quiénes asistieron.' using errcode = 'check_violation';
  end if;
  if cardinality(v_personas) > 500 then
    raise exception 'Van hasta 500 asistentes por charla.' using errcode = 'check_violation';
  end if;
  -- Quien RR. HH. dio de baja mientras se llenaba la lista: se dice quién, para desmarcarlo.
  select btrim(t.apellidos || ' ' || t.nombres) into v_inactivo
    from unnest(v_personas) as x left join public.trabajadores t on t.id = x
   where t.id is null or not t.activo
   limit 1;
  if found then
    raise exception '% ya no está activo en RR. HH.: desmárcalo y vuelve a registrar.', coalesce(v_inactivo, 'Alguien de la lista')
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos de la charla.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) = 0 then
    raise exception 'Pon al menos una foto de la charla.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 4 then
    raise exception 'Van hasta 4 fotos por charla.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_charlas (id, tipo, tema, expositor, fecha, creado_por)
  values (p_id, p_tipo, v_tema, v_expositor, p_fecha, v_yo);
  insert into public.ssoma_charla_asistentes (charla_id, trabajador_id)
  select p_id, x from unnest(v_personas) as x;

  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_ruta !~ ('^' || v_yo::text || '/' || p_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos de la charla.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-ssoma' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if public.ssoma_foto_anotada(v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.ssoma_charla_fotos (charla_id, orden, ruta, mime_type, tamano_bytes)
    values (p_id, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;

  perform public.anotar_envio(p_id, 'CHARLA_SSOMA', v_envio);
  return p_id;
end;
$$;
comment on function public.ssoma_registrar_charla(uuid, text, text, text, date, uuid[], jsonb) is
  'SSOMA registra una charla o inducción de los últimos 60 días con su tema, expositor, de 1 a 4 fotos ya subidas y quiénes asistieron (personal activo de RR. HH.). Exige ssoma.gestionar.';
revoke all on function public.ssoma_registrar_charla(uuid, text, text, text, date, uuid[], jsonb) from public, anon;
grant execute on function public.ssoma_registrar_charla(uuid, text, text, text, date, uuid[], jsonb) to authenticated;

-- 7. Anular con motivo -------------------------------------------------------------------------
create or replace function public.ssoma_anular_charla(p_id uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_charla public.ssoma_charlas%rowtype;
  v_motivo text := regexp_replace(btrim(coalesce(p_motivo, '')), '\s+', ' ', 'g');
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una charla la anula SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_charla from public.ssoma_charlas where id = p_id for update;
  if not found then raise exception 'Esa charla no existe.' using errcode = 'check_violation'; end if;
  if v_charla.anulado_en is not null then
    -- El mismo pedido repetido (se perdió la respuesta) ya quedó; otro motivo no cambia el que quedó.
    if v_charla.motivo_anulacion = v_motivo then return p_id; end if;
    raise exception 'Esta charla ya estaba anulada, con este motivo: «%». No se cambia.', v_charla.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  update public.ssoma_charlas set motivo_anulacion = v_motivo where id = p_id;
  return p_id;
end;
$$;
comment on function public.ssoma_anular_charla(uuid, text) is
  'SSOMA anula una charla mal registrada, con su motivo: deja de contar como asistencia y queda como evidencia. Exige ssoma.gestionar.';
revoke all on function public.ssoma_anular_charla(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_charla(uuid, text) to authenticated;

-- 8. Lo que se consulta --------------------------------------------------------------------------
-- Las charlas de un mes (las anuladas también, con su motivo). A quien no es SSOMA
-- ni Gerencia, nada.
create or replace function public.ssoma_charlas_del_mes(p_mes date)
returns table (
  id uuid, tipo text, tema text, expositor text, fecha date, asistentes integer, fotos integer,
  registro text, anulado_en timestamptz, anulo text, motivo_anulacion text)
language sql stable security definer set search_path to 'public' rows 30 as $$
  select c.id, c.tipo, c.tema, c.expositor, c.fecha,
         (select count(*)::integer from public.ssoma_charla_asistentes s where s.charla_id = c.id),
         (select count(*)::integer from public.ssoma_charla_fotos f where f.charla_id = c.id),
         public.ssoma_nombre_de(c.creado_por), c.anulado_en, public.ssoma_nombre_de(c.anulado_por), c.motivo_anulacion
    from public.ssoma_charlas c
   where public.puede_ver_reportes_ssoma()
     and c.fecha >= date_trunc('month', p_mes)::date
     and c.fecha < (date_trunc('month', p_mes) + interval '1 month')::date
   order by c.fecha desc, c.creado_en desc;
$$;
comment on function public.ssoma_charlas_del_mes(date) is
  'Las charlas e inducciones de SSOMA del mes de p_mes, con cuántos asistieron y cuántas fotos. Solo para SSOMA y Gerencia; a los demás, nada.';
revoke all on function public.ssoma_charlas_del_mes(date) from public, anon;
grant execute on function public.ssoma_charlas_del_mes(date) to authenticated;

-- Una charla, para su ficha.
create or replace function public.ssoma_charla(p_id uuid)
returns table (
  id uuid, tipo text, tema text, expositor text, fecha date, registro text, creado_en timestamptz,
  anulado_en timestamptz, anulo text, motivo_anulacion text)
language sql stable security definer set search_path to 'public' rows 1 as $$
  select c.id, c.tipo, c.tema, c.expositor, c.fecha, public.ssoma_nombre_de(c.creado_por), c.creado_en,
         c.anulado_en, public.ssoma_nombre_de(c.anulado_por), c.motivo_anulacion
    from public.ssoma_charlas c
   where c.id = p_id and public.puede_ver_reportes_ssoma();
$$;
comment on function public.ssoma_charla(uuid) is
  'Una charla o inducción de SSOMA con quién la registró y, si se anuló, quién y por qué. Solo para SSOMA y Gerencia.';
revoke all on function public.ssoma_charla(uuid) from public, anon;
grant execute on function public.ssoma_charla(uuid) to authenticated;

-- Quiénes asistieron a una charla: solo nombre, cargo y área.
create or replace function public.ssoma_asistentes_de_charla(p_charla uuid)
returns table (id uuid, nombre text, cargo text, area text)
language sql stable security definer set search_path to 'public' rows 30 as $$
  select t.id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre
    from public.ssoma_charla_asistentes s
    join public.trabajadores t on t.id = s.trabajador_id
    left join public.areas a on a.id = t.area_id
   where s.charla_id = p_charla and public.puede_ver_reportes_ssoma()
   order by a.nombre nulls last, t.apellidos, t.nombres;
$$;
comment on function public.ssoma_asistentes_de_charla(uuid) is
  'Quiénes asistieron a una charla de SSOMA: solo nombre, cargo y área de RR. HH. Solo para SSOMA y Gerencia.';
revoke all on function public.ssoma_asistentes_de_charla(uuid) from public, anon;
grant execute on function public.ssoma_asistentes_de_charla(uuid) to authenticated;

-- Quién estaba en la planta en un mes: entró antes de que terminara y no se había
-- ido antes de que empezara. Un mes pasado no se cuenta con la lista de hoy:
-- quien entró después no «faltó», y quien se fue después sí cuenta. Quien está
-- inactivo sin fecha de baja no se sabe cuándo se fue, y no entra.
create or replace function public.ssoma_vigente_en_el_mes(p_activo boolean, p_ingreso date, p_baja date, p_desde date, p_hasta date)
returns boolean language sql immutable set search_path to 'public' as $$
  select (p_ingreso is null or p_ingreso < p_hasta)
     and (case when p_activo then p_baja is null or p_baja >= p_desde else p_baja is not null and p_baja >= p_desde end);
$$;
comment on function public.ssoma_vigente_en_el_mes(boolean, date, date, date, date) is
  'Si una persona de RR. HH. estaba en la planta entre p_desde y p_hasta (sin incluir): entró antes del fin y no se fue antes del inicio. Ayudante de las charlas de SSOMA.';
revoke all on function public.ssoma_vigente_en_el_mes(boolean, date, date, date, date) from public, anon, authenticated;

-- Quién no asistió en el mes: el personal que estaba en la planta ese mes, sin
-- ninguna charla ni inducción vigente en él, con la última vez que asistió a una
-- (vigente) hasta ese mes, si alguna vez.
create or replace function public.ssoma_no_asistieron(p_mes date)
returns table (id uuid, nombre text, cargo text, area text, ultima date)
language sql stable security definer set search_path to 'public' rows 100 as $$
  with mes as (
    select date_trunc('month', p_mes)::date as desde, (date_trunc('month', p_mes) + interval '1 month')::date as hasta
  )
  select t.id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre,
         (select max(c.fecha) from public.ssoma_charla_asistentes s
            join public.ssoma_charlas c on c.id = s.charla_id
           where s.trabajador_id = t.id and c.anulado_en is null and c.fecha < m.hasta)
    from public.trabajadores t
    cross join mes m
    left join public.areas a on a.id = t.area_id
   where public.puede_ver_reportes_ssoma()
     and public.ssoma_vigente_en_el_mes(t.activo, t.fecha_ingreso, t.fecha_baja, m.desde, m.hasta)
     and not exists (select 1 from public.ssoma_charla_asistentes s
                       join public.ssoma_charlas c on c.id = s.charla_id
                      where s.trabajador_id = t.id and c.anulado_en is null
                        and c.fecha >= m.desde and c.fecha < m.hasta)
   order by a.nombre nulls last, t.apellidos, t.nombres;
$$;
comment on function public.ssoma_no_asistieron(date) is
  'El personal de RR. HH. que estaba en la planta en el mes de p_mes y no asistió a ninguna charla ni inducción vigente en él, con la última vez que asistió a una. Solo nombre, cargo y área. Solo para SSOMA y Gerencia.';
revoke all on function public.ssoma_no_asistieron(date) from public, anon;
grant execute on function public.ssoma_no_asistieron(date) to authenticated;

-- Cuántas personas estaban en la planta en el mes, para decir «x de y».
create or replace function public.ssoma_personal_del_mes(p_mes date)
returns integer language sql stable security definer set search_path to 'public' as $$
  select case when public.puede_ver_reportes_ssoma()
              then (select count(*)::integer from public.trabajadores t
                     where public.ssoma_vigente_en_el_mes(t.activo, t.fecha_ingreso, t.fecha_baja,
                             date_trunc('month', p_mes)::date, (date_trunc('month', p_mes) + interval '1 month')::date))
              else 0 end;
$$;
comment on function public.ssoma_personal_del_mes(date) is
  'Cuántas personas de RR. HH. estaban en la planta en el mes de p_mes. Solo para SSOMA y Gerencia; a los demás, 0.';
revoke all on function public.ssoma_personal_del_mes(date) from public, anon;
grant execute on function public.ssoma_personal_del_mes(date) to authenticated;
