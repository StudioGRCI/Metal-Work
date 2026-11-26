-- =============================================================================
-- SSOMA: CLASIFICAR EL REPORTE Y LAS ACCIONES CORRECTIVAS
-- -----------------------------------------------------------------------------
-- Plan 15, entrega 15.2 (DKS, 2026-11-25): «SSOMA clasifica, anota la causa y
-- crea acciones correctivas con responsable (una cuenta) y fecha límite; el
-- responsable las ve y las cierra con evidencia; las vencidas, arriba.»
--
--   * CLASIFICAR. SSOMA dice qué fue de verdad, con las clases del registro de
--     la R.M. 050-2013-TR (accidente leve, incapacitante o mortal; incidente
--     peligroso; incidente; condición insegura), si hubo atención médica y, del
--     incapacitante, los días perdidos. Nunca el diagnóstico. Y anota la causa.
--     Se puede corregir mientras el reporte siga vigente: cada clasificación
--     queda guardada, la última es la que vale. La clasificación y la causa las
--     ven solo SSOMA y Gerencia: la causa puede nombrar a alguien.
--   * LA ACCIÓN CORRECTIVA. Qué se corrige, quién (una cuenta activa) y hasta
--     cuándo. Se crea sobre un reporte ya clasificado: primero la causa, después
--     qué se hace. Le llega el aviso al responsable.
--   * EL RESPONSABLE LA VE Y LA CIERRA CON EVIDENCIA: qué se hizo y de una a
--     cuatro fotos. SSOMA recibe el aviso. Si la evidencia no basta, SSOMA la
--     reabre con su motivo y una fecha nueva.
--   * SSOMA REASIGNA (otra persona u otra fecha) y ANULA con motivo. Una acción
--     no se borra: su historia queda en `ssoma_accion_eventos`.
--   * EL REPORTE SE CIERRA SOLO cuando tiene acciones y todas están cerradas, y
--     a quien lo reportó le llega el aviso. Una acción nueva o reabierta lo
--     vuelve a abrir. Un reporte con acciones vigentes no se anula.
--   * VENCIDA es una acción abierta cuya fecha límite ya pasó en Lima. La
--     pantalla las pone arriba.
--   * QUIÉN VE QUÉ: SSOMA y Gerencia, todo. El responsable, sus acciones con su
--     historia y su evidencia, y el hecho del reporte sin quién lo reportó ni
--     las fotos (como el área). Quien reportó y el área ven qué se está
--     corrigiendo y cómo va, sin la clasificación ni la causa.
--
-- Sin DROP: el conector de producción no deja pasar ninguno. El check del
-- estado del reporte se cambia con ALTER TABLE … DROP CONSTRAINT, que sí pasa.
-- =============================================================================

-- 0. Las funciones de la 15.1 que esta reescribe son las que el repositorio conoce --------
-- Si alguien pegó un arreglo a mano en producción, se detiene en vez de pisarlo.
-- Valen la huella de la 15.1 y la de esta migración (volver a correrla).
do $$
declare
  v record;
begin
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.fn_ssoma_reporte_guardia()', array['a83e6ece7d87042dbbf21094f980e221', 'a2ac81a0b5df725bd271184f3d61b1bb']),
        ('public.ssoma_anular_reporte(uuid,text)', array['28ec3de74b6301866cdee96acc2bfcb2', '062aaf5c10673636a4938dae44b57b93']),
        ('public.ssoma_foto_anotada(text)', array['9e6f0b19f14da8cc6a4e8142270ebb5e', '2e0b6ef025271d045e3bb6907f35fc1d']),
        ('public.ssoma_reportes_visibles(uuid)', array['7122f214f3957cacc985a632bd31f837', 'd9426adeef75bad24c8d7a5e7faefa45'])
      ) as f(firma, huellas)
      left join pg_proc p on p.oid = to_regprocedure(f.firma)
  loop
    if v.huella is null then
      raise exception 'Falta %: esta base no tiene la entrega 15.1 de SSOMA.', v.firma;
    end if;
    if not (v.huella = any (v.huellas)) then
      raise exception '% no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v.firma, v.huella;
    end if;
  end loop;
end $$;

-- 1. El reporte sabe en qué va ---------------------------------------------------------
--   REPORTADO   · lo tiene SSOMA, por clasificar.
--   CLASIFICADO · clasificado; sus acciones, si tiene, siguen abiertas.
--   CERRADO     · todas sus acciones se cerraron con evidencia.
--   ANULADO     · como en la 15.1.
alter table public.ssoma_reportes add column if not exists cerrado_en timestamptz;
comment on column public.ssoma_reportes.cerrado_en is
  'Cuándo se cerró la última de sus acciones correctivas. Vacío mientras quede alguna abierta.';

alter table public.ssoma_reportes drop constraint if exists ck_ssoma_reporte_estado;
alter table public.ssoma_reportes add constraint ck_ssoma_reporte_estado check (
  (estado in ('REPORTADO', 'CLASIFICADO', 'CERRADO')
   and anulado_en is null and anulado_por is null and motivo_anulacion is null
   and (estado = 'CERRADO') = (cerrado_en is not null))
  or (estado = 'ANULADO' and anulado_en is not null and anulado_por is not null and cerrado_en is null
      and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500));

-- La guardia de la 15.1, con el cierre: lo que dice el reporte sigue sin corregirse.
create or replace function public.fn_ssoma_reporte_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion', 'cerrado_en', 'actualizado_en'];
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
  -- La anulación se sella aquí y no solo en la función que anula: quién y cuándo
  -- los pone la base, y sin motivo no entra, venga de donde venga el UPDATE.
  if new.estado = 'ANULADO' then
    if length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para anular el reporte % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en, new.motivo_anulacion) is distinct from (old.anulado_por, old.anulado_en, old.motivo_anulacion) then
    raise exception 'El reporte % no está anulado: quién, cuándo y el motivo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_reporte_guardia() from public, anon, authenticated;

-- 2. La clasificación ------------------------------------------------------------------------
-- Una fila por cada vez que SSOMA clasifica: la última es la que vale. No se
-- corrige ni se borra. Sin auditoría genérica: la tabla misma es la historia, y
-- la causa (que puede nombrar a alguien) no debe salir por `audit_log`.
create table if not exists public.ssoma_clasificaciones (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null references public.ssoma_reportes(id) on delete restrict,
  clasificacion   text not null,
  -- Del accidente: si hubo atención médica. Nunca el diagnóstico.
  hubo_atencion   boolean,
  -- Del accidente incapacitante: los días de descanso médico.
  dias_perdidos   integer,
  causa           text not null,
  clasificado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  -- La hora del reloj y no la de la transacción: la última es la que vale.
  creado_en       timestamptz not null default clock_timestamp(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_ssoma_clasificacion check (
    clasificacion in ('ACCIDENTE_LEVE', 'ACCIDENTE_INCAPACITANTE', 'ACCIDENTE_MORTAL', 'INCIDENTE_PELIGROSO', 'INCIDENTE', 'CONDICION_INSEGURA')
    and (clasificacion like 'ACCIDENTE\_%') = (hubo_atencion is not null)
    and (clasificacion = 'ACCIDENTE_INCAPACITANTE') = (dias_perdidos is not null)
    and (dias_perdidos is null or dias_perdidos between 1 and 3650)
    and char_length(btrim(causa)) between 10 and 2000)
);
comment on table public.ssoma_clasificaciones is
  'Cada clasificación que SSOMA le da a un reporte de seguridad (R.M. 050-2013-TR) con su causa; la última vale. Solo la leen SSOMA y Gerencia. No se corrige ni se borra.';
-- La última de un reporte, y la llave hacia él (b).
create index if not exists ix_ssoma_clasificaciones_reporte on public.ssoma_clasificaciones (reporte_id, creado_en desc);
select public.activar_timestamps('ssoma_clasificaciones');
select public.activar_registro_de_prueba('ssoma_clasificaciones');

-- 3. La acción correctiva ----------------------------------------------------------------------
create table if not exists public.ssoma_acciones (
  id                uuid primary key default gen_random_uuid(),
  reporte_id        uuid not null references public.ssoma_reportes(id) on delete restrict,
  -- El área del reporte, copiada al crearla: Gerencia lee las vencidas por área
  -- (15.6) y las inspecciones (15.4) traerán acciones sin reporte. Ni (a) ni (b)
  -- ni (c): nada filtra por ella y un área no se borra.
  area_id           uuid not null references public.areas(id) on delete restrict,
  descripcion       text not null,
  responsable_id    uuid not null references public.usuarios(id) on delete restrict,
  fecha_limite      date not null,
  estado            text not null default 'ABIERTA',
  creado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  cerrado_por       uuid references public.usuarios(id) on delete restrict,
  cerrado_en        timestamptz,
  nota_cierre       text,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_ssoma_accion_datos check (char_length(btrim(descripcion)) between 10 and 500),
  constraint ck_ssoma_accion_estado check (
    (estado = 'ABIERTA' and cerrado_por is null and cerrado_en is null and nota_cierre is null
     and anulado_por is null and anulado_en is null and motivo_anulacion is null)
    or (estado = 'CERRADA' and cerrado_por is not null and cerrado_en is not null
        and char_length(btrim(coalesce(nota_cierre, ''))) between 10 and 1000
        and anulado_por is null and anulado_en is null and motivo_anulacion is null)
    or (estado = 'ANULADA' and anulado_por is not null and anulado_en is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500
        and cerrado_por is null and cerrado_en is null and nota_cierre is null))
);
comment on table public.ssoma_acciones is
  'La acción correctiva de un reporte de seguridad: qué se corrige, quién (una cuenta) y hasta cuándo. La cierra su responsable con evidencia; SSOMA la reasigna, la reabre o la anula con motivo. No se borra: su historia está en ssoma_accion_eventos.';
-- «Tus acciones» (b), que también sirve a su llave.
create index if not exists ix_ssoma_acciones_responsable on public.ssoma_acciones (responsable_id);
-- Las acciones de un reporte (b).
create index if not exists ix_ssoma_acciones_reporte on public.ssoma_acciones (reporte_id);
select public.activar_timestamps('ssoma_acciones');
-- Sin `activar_auditoria`: la copia en `audit_log` la lee quien tiene
-- `auditoria.ver`, y la acción dice qué se corrige de un reporte que ese puesto
-- no ve. Su historia, con quién y cuándo, ya está en `ssoma_accion_eventos`.
select public.activar_registro_de_prueba('ssoma_acciones');

-- Su historia: cada asignación, cierre, reapertura y anulación, con quién y cuándo.
create table if not exists public.ssoma_accion_eventos (
  id              uuid primary key default gen_random_uuid(),
  accion_id       uuid not null references public.ssoma_acciones(id) on delete restrict,
  tipo            text not null,
  -- A cargo de quién y hasta cuándo quedó después de este paso.
  responsable_id  uuid references public.usuarios(id) on delete restrict,
  fecha_limite    date,
  -- Qué se hizo (cierre) o por qué (reapertura, anulación).
  nota            text,
  hecho_por       uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  -- La hora del reloj: la historia se lee en el orden en que pasó.
  creado_en       timestamptz not null default clock_timestamp(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_ssoma_accion_evento check (tipo in ('ASIGNADA', 'REASIGNADA', 'CERRADA', 'REABIERTA', 'ANULADA'))
);
comment on table public.ssoma_accion_eventos is
  'La historia de cada acción correctiva de SSOMA: asignada, reasignada, cerrada con evidencia, reabierta o anulada, con quién, cuándo y su nota. No se corrige ni se borra.';
-- La historia de una acción, en orden (b), y su llave.
create index if not exists ix_ssoma_accion_eventos_accion on public.ssoma_accion_eventos (accion_id, creado_en);
select public.activar_timestamps('ssoma_accion_eventos');
select public.activar_registro_de_prueba('ssoma_accion_eventos');

-- La evidencia del cierre: de una a cuatro fotos, en fotos-ssoma con la ruta
-- {cuenta}/{cierre}/{foto}. Las de un cierre que SSOMA reabrió quedan con él.
create table if not exists public.ssoma_accion_fotos (
  id              uuid primary key default gen_random_uuid(),
  -- Ni (a) ni (b) ni (c): la política la usa por la fila, y se lee por el cierre.
  accion_id       uuid not null references public.ssoma_acciones(id) on delete restrict,
  evento_id       uuid not null references public.ssoma_accion_eventos(id) on delete restrict,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  -- También es el índice de la llave hacia el cierre.
  constraint uq_ssoma_accion_foto_orden unique (evento_id, orden),
  -- La política de Storage la busca por su ruta.
  constraint uq_ssoma_accion_foto_ruta unique (ruta),
  constraint ck_ssoma_accion_foto check (
    orden between 1 and 4
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.ssoma_accion_fotos is
  'La evidencia con que se cerró una acción correctiva: hasta 4 fotos por cierre, en el bucket fotos-ssoma. Las ven SSOMA, Gerencia y el responsable. No se cambian ni se borran.';
select public.activar_timestamps('ssoma_accion_fotos');
select public.activar_registro_de_prueba('ssoma_accion_fotos');

-- 4. Lo que no se borra ni se corrige por debajo ---------------------------------------------
create or replace function public.fn_ssoma_solo_se_agrega()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'La historia de SSOMA no se cambia ni se borra: queda como evidencia.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_ssoma_solo_se_agrega() from public, anon, authenticated;
create or replace trigger trg_ssoma_clasificacion_guardia
  before update or delete on public.ssoma_clasificaciones
  for each row execute function public.fn_ssoma_solo_se_agrega();
create or replace trigger trg_ssoma_accion_evento_guardia
  before update or delete on public.ssoma_accion_eventos
  for each row execute function public.fn_ssoma_solo_se_agrega();
create or replace trigger trg_ssoma_accion_foto_guardia
  before update or delete on public.ssoma_accion_fotos
  for each row execute function public.fn_ssoma_solo_se_agrega();

-- La acción cambia de responsable, de fecha y de estado; lo demás queda como nació.
-- Cerrar y anular se sellan aquí: quién y cuándo los pone la base.
create or replace function public.fn_ssoma_accion_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['responsable_id', 'fecha_limite', 'estado', 'cerrado_por', 'cerrado_en', 'nota_cierre',
                                     'anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una acción correctiva no se borra: SSOMA la anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'La acción está anulada: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que pide una acción correctiva no se corrige: SSOMA la anula y crea otra.' using errcode = 'check_violation';
  end if;
  if new.estado = 'CERRADA' and old.estado <> 'CERRADA' then
    new.cerrado_por := coalesce(public.usuario_actual(), new.cerrado_por);
    new.cerrado_en := now();
  elsif new.estado = 'ANULADA' then
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_accion_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_accion_guardia
  before update or delete on public.ssoma_acciones
  for each row execute function public.fn_ssoma_accion_guardia();

-- 5. Quién lee las tablas ----------------------------------------------------------------------
-- La clasificación, solo SSOMA y Gerencia. La acción, ellos y su responsable;
-- la historia y la evidencia, quien ve la acción. Quien reportó y el área ven
-- las acciones por `ssoma_acciones_visibles`, sin la tabla.
alter table public.ssoma_clasificaciones enable row level security;
alter table public.ssoma_acciones enable row level security;
alter table public.ssoma_accion_eventos enable row level security;
alter table public.ssoma_accion_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_clasificaciones' and policyname = 'ver_ssoma_clasificaciones') then
    create policy ver_ssoma_clasificaciones on public.ssoma_clasificaciones for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_acciones' and policyname = 'ver_ssoma_acciones') then
    create policy ver_ssoma_acciones on public.ssoma_acciones for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()) or responsable_id = (select public.usuario_actual()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_accion_eventos' and policyname = 'ver_ssoma_accion_eventos') then
    create policy ver_ssoma_accion_eventos on public.ssoma_accion_eventos for select to authenticated
      using (exists (select 1 from public.ssoma_acciones a where a.id = accion_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_accion_fotos' and policyname = 'ver_ssoma_accion_fotos') then
    create policy ver_ssoma_accion_fotos on public.ssoma_accion_fotos for select to authenticated
      using (exists (select 1 from public.ssoma_acciones a where a.id = accion_id));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo: sin políticas ni grants de escritura.
revoke all on public.ssoma_clasificaciones from public, anon, authenticated;
revoke all on public.ssoma_acciones from public, anon, authenticated;
revoke all on public.ssoma_accion_eventos from public, anon, authenticated;
revoke all on public.ssoma_accion_fotos from public, anon, authenticated;
grant select on public.ssoma_clasificaciones to authenticated;
grant select on public.ssoma_acciones to authenticated;
grant select on public.ssoma_accion_eventos to authenticated;
grant select on public.ssoma_accion_fotos to authenticated;

-- 6. La evidencia en Storage ---------------------------------------------------------------------
-- El mismo bucket de la 15.1. «Ninguna fila la nombra» mira también la evidencia,
-- y la foto la ve quien ve la acción que la nombra.
create or replace function public.ssoma_foto_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = p_ruta)
      or exists (select 1 from public.ssoma_accion_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.ssoma_foto_anotada(text) from public, anon;
grant execute on function public.ssoma_foto_anotada(text) to authenticated;

alter policy ssoma_ver_foto on storage.objects using (
  bucket_id = 'fotos-ssoma'
  and (owner_id = (select auth.uid())::text
       or exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = objects.name)
       or exists (select 1 from public.ssoma_accion_fotos f where f.ruta = objects.name)));

-- p_fotos: ["{cuenta}/{cierre}/{foto}.jpg", …], ya subidas. De 1 a 4. La llama
-- solo ssoma_cerrar_accion.
create or replace function public.ssoma_anotar_evidencia(p_accion uuid, p_evento uuid, p_fotos jsonb)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos de la evidencia.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) = 0 then
    raise exception 'Pon al menos una foto de lo que se hizo: es la evidencia del cierre.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 4 then
    raise exception 'Van hasta 4 fotos por cierre.' using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_evento::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos de la evidencia.' using errcode = 'check_violation';
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
    insert into public.ssoma_accion_fotos (accion_id, evento_id, orden, ruta, mime_type, tamano_bytes)
    values (p_accion, p_evento, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
end;
$$;
revoke all on function public.ssoma_anotar_evidencia(uuid, uuid, jsonb) from public, anon, authenticated;

-- 7. Ayudantes internos ---------------------------------------------------------------------------
-- El nombre con que se nombra una cuenta en los avisos y las listas.
create or replace function public.ssoma_nombre_de(p_usuario uuid)
returns text language sql stable set search_path to 'public' as $$
  select btrim(u.nombres || ' ' || u.apellidos) from public.usuarios u where u.id = p_usuario;
$$;
revoke all on function public.ssoma_nombre_de(uuid) from public, anon, authenticated;

-- «05/12/2026», para el cuerpo de los avisos.
create or replace function public.ssoma_dia(p_dia date)
returns text language sql immutable set search_path to 'public' as $$
  select to_char(p_dia, 'DD/MM/YYYY');
$$;
revoke all on function public.ssoma_dia(date) from public, anon, authenticated;

create or replace function public.ssoma_hoy()
returns date language sql stable set search_path to 'public' as $$
  select (now() at time zone 'America/Lima')::date;
$$;
revoke all on function public.ssoma_hoy() from public, anon, authenticated;

create or replace function public.ssoma_avisar_a(p_usuario uuid, p_titulo text, p_cuerpo text, p_ruta text, p_tabla text, p_id uuid)
returns void language sql set search_path to 'public' as $$
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, left(p_titulo, 200), left(p_cuerpo, 500), p_ruta, p_tabla, p_id
    from public.usuarios u
   where u.id = p_usuario and u.activo and u.id is distinct from public.usuario_actual();
$$;
revoke all on function public.ssoma_avisar_a(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Pone el estado del reporte según sus acciones. Devuelve true si se acaba de cerrar.
create or replace function public.ssoma_recalcular_reporte(p_reporte uuid)
returns boolean language plpgsql set search_path to 'public' as $$
declare
  v_rep      public.ssoma_reportes%rowtype;
  v_abiertas int;
  v_cerradas int;
begin
  select * into v_rep from public.ssoma_reportes where id = p_reporte for update;
  if not found or v_rep.estado not in ('CLASIFICADO', 'CERRADO') then return false; end if;
  select count(*) filter (where estado = 'ABIERTA'), count(*) filter (where estado = 'CERRADA')
    into v_abiertas, v_cerradas
    from public.ssoma_acciones where reporte_id = p_reporte;
  if v_abiertas = 0 and v_cerradas > 0 then
    if v_rep.estado = 'CERRADO' then return false; end if;
    update public.ssoma_reportes set estado = 'CERRADO', cerrado_en = now() where id = p_reporte;
    return true;
  end if;
  if v_rep.estado = 'CERRADO' then
    update public.ssoma_reportes set estado = 'CLASIFICADO', cerrado_en = null where id = p_reporte;
  end if;
  return false;
end;
$$;
revoke all on function public.ssoma_recalcular_reporte(uuid) from public, anon, authenticated;

-- 8. A quién se le puede encargar una acción -----------------------------------------------------
-- Toda cuenta activa, con su puesto y su área. Solo para SSOMA.
create or replace function public.ssoma_cuentas_para_asignar()
returns table (id uuid, nombre text, puesto text, area text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una acción correctiva la encarga SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, btrim(u.nombres || ' ' || u.apellidos), coalesce(nullif(btrim(u.cargo), ''), r.nombre), a.nombre
      from public.usuarios u
      join public.roles r on r.id = u.rol_id
      left join public.areas a on a.id = u.area_id
     where u.activo
     order by u.nombres, u.apellidos;
end;
$$;
comment on function public.ssoma_cuentas_para_asignar() is
  'Las cuentas activas a las que SSOMA puede encargar una acción correctiva: nombre, puesto y área. Exige ssoma.gestionar.';
revoke all on function public.ssoma_cuentas_para_asignar() from public, anon;
grant execute on function public.ssoma_cuentas_para_asignar() to authenticated;

-- 9. Clasificar -------------------------------------------------------------------------------------
create or replace function public.ssoma_clasificar(
  p_reporte uuid, p_clasificacion text, p_hubo_atencion boolean, p_dias_perdidos integer, p_causa text
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_rep    public.ssoma_reportes%rowtype;
  v_ultima public.ssoma_clasificaciones%rowtype;
  v_causa  text := btrim(coalesce(p_causa, ''));
  v_es_accidente boolean := coalesce(p_clasificacion like 'ACCIDENTE\_%', false);
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Un reporte de seguridad lo clasifica SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rep from public.ssoma_reportes where id = p_reporte for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_rep.estado = 'ANULADO' then
    raise exception 'El reporte % está anulado: no se clasifica.', v_rep.numero using errcode = 'check_violation';
  end if;
  if p_clasificacion is null or p_clasificacion not in ('ACCIDENTE_LEVE', 'ACCIDENTE_INCAPACITANTE', 'ACCIDENTE_MORTAL', 'INCIDENTE_PELIGROSO', 'INCIDENTE', 'CONDICION_INSEGURA') then
    raise exception 'Elige la clasificación.' using errcode = 'check_violation';
  end if;
  if v_es_accidente and p_hubo_atencion is null then
    raise exception 'De un accidente marca si hubo atención médica.' using errcode = 'check_violation';
  end if;
  if not v_es_accidente and p_hubo_atencion is not null then
    raise exception 'La atención médica se anota solo en un accidente.' using errcode = 'check_violation';
  end if;
  if p_clasificacion = 'ACCIDENTE_INCAPACITANTE' and (p_dias_perdidos is null or p_dias_perdidos not between 1 and 3650) then
    raise exception 'Del accidente incapacitante escribe los días de descanso médico (de 1 a 3650).' using errcode = 'check_violation';
  end if;
  if p_clasificacion <> 'ACCIDENTE_INCAPACITANTE' and p_dias_perdidos is not null then
    raise exception 'Los días perdidos se anotan solo en un accidente incapacitante.' using errcode = 'check_violation';
  end if;
  if char_length(v_causa) not between 10 and 2000 then
    raise exception 'Anota la causa, en 10 a 2000 caracteres.' using errcode = 'check_violation';
  end if;

  -- La misma clasificación otra vez (se perdió la respuesta) no suma otra fila.
  select * into v_ultima from public.ssoma_clasificaciones where reporte_id = p_reporte order by creado_en desc, id desc limit 1;
  if not found or (v_ultima.clasificacion, v_ultima.hubo_atencion, v_ultima.dias_perdidos, v_ultima.causa)
                  is distinct from (p_clasificacion, p_hubo_atencion, p_dias_perdidos, v_causa) then
    insert into public.ssoma_clasificaciones (reporte_id, clasificacion, hubo_atencion, dias_perdidos, causa, clasificado_por)
    values (p_reporte, p_clasificacion, p_hubo_atencion, p_dias_perdidos, v_causa, v_yo);
  end if;
  if v_rep.estado = 'REPORTADO' then
    update public.ssoma_reportes set estado = 'CLASIFICADO' where id = p_reporte;
  end if;
  return p_reporte;
end;
$$;
comment on function public.ssoma_clasificar(uuid, text, boolean, integer, text) is
  'SSOMA clasifica un reporte (R.M. 050-2013-TR), con la atención médica y los días perdidos sin diagnóstico, y anota la causa. Se puede corregir mientras no esté anulado; cada clasificación queda guardada. Exige ssoma.gestionar.';
revoke all on function public.ssoma_clasificar(uuid, text, boolean, integer, text) from public, anon;
grant execute on function public.ssoma_clasificar(uuid, text, boolean, integer, text) to authenticated;

-- 10. Crear la acción ----------------------------------------------------------------------------------
-- El id lo pone la ventana: un reintento con lo mismo devuelve la que ya entró.
create or replace function public.ssoma_crear_accion(
  p_id uuid, p_reporte uuid, p_descripcion text, p_responsable uuid, p_fecha_limite date
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_envio  constant jsonb := jsonb_build_array(p_reporte, p_descripcion, p_responsable, p_fecha_limite);
  v_que    text := regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g');
  v_rep    public.ssoma_reportes%rowtype;
  v_hoy    date := public.ssoma_hoy();
  v_actual public.ssoma_acciones%rowtype;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una acción correctiva la encarga SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la acción.' using errcode = 'check_violation'; end if;
  select * into v_actual from public.ssoma_acciones where id = p_id;
  if found then
    -- El mismo pedido, de la misma persona: se perdió la respuesta.
    if v_actual.creado_por is distinct from v_yo then
      raise exception 'Vuelve a abrir el formulario de la acción.' using errcode = 'check_violation';
    end if;
    if public.mismo_envio(p_id, 'ACCION_SSOMA', v_envio) then return p_id; end if;
    raise exception 'Esa acción ya quedó registrada la primera vez que la enviaste: lo que cambiaste después no se guardó.'
      using errcode = 'check_violation';
  end if;

  select * into v_rep from public.ssoma_reportes where id = p_reporte for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_rep.estado = 'ANULADO' then
    raise exception 'El reporte % está anulado: no lleva acciones.', v_rep.numero using errcode = 'check_violation';
  end if;
  if v_rep.estado = 'REPORTADO' then
    raise exception 'Primero clasifica el reporte % y anota la causa: la acción corrige esa causa.', v_rep.numero using errcode = 'check_violation';
  end if;
  if char_length(v_que) not between 10 and 500 then
    raise exception 'Escribe qué se tiene que hacer, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  if p_responsable is null or not exists (select 1 from public.usuarios u where u.id = p_responsable and u.activo) then
    raise exception 'Elige al responsable entre las cuentas activas.' using errcode = 'check_violation';
  end if;
  if p_fecha_limite is null or p_fecha_limite < v_hoy then
    raise exception 'La fecha límite no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;
  if p_fecha_limite > v_hoy + 365 then
    raise exception 'La fecha límite va hasta dentro de un año.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_acciones (id, reporte_id, area_id, descripcion, responsable_id, fecha_limite, creado_por)
  values (p_id, p_reporte, v_rep.area_id, v_que, p_responsable, p_fecha_limite, v_yo);
  insert into public.ssoma_accion_eventos (accion_id, tipo, responsable_id, fecha_limite, hecho_por)
  values (p_id, 'ASIGNADA', p_responsable, p_fecha_limite, v_yo);
  perform public.anotar_envio(p_id, 'ACCION_SSOMA', v_envio);
  perform public.ssoma_recalcular_reporte(p_reporte);
  -- Quien reportó ya había recibido «quedó corregido»: se entera de que volvió.
  if v_rep.estado = 'CERRADO' then
    perform public.ssoma_avisar_a(v_rep.registrado_por,
      'Tu reporte ' || v_rep.numero || ' volvió a corrección',
      'SSOMA encargó una acción más: falta corregir algo.',
      '/ssoma/' || p_reporte::text, 'ssoma_reportes', p_reporte);
  end if;

  perform public.ssoma_avisar_a(p_responsable,
    'Acción correctiva a tu cargo (' || v_rep.numero || '): vence el ' || public.ssoma_dia(p_fecha_limite),
    v_que, '/ssoma/' || p_reporte::text || '#accion-' || p_id::text, 'ssoma_acciones', p_id);
  return p_id;
end;
$$;
comment on function public.ssoma_crear_accion(uuid, uuid, text, uuid, date) is
  'SSOMA encarga una acción correctiva de un reporte ya clasificado a una cuenta activa, con fecha límite desde hoy; le avisa. Exige ssoma.gestionar.';
revoke all on function public.ssoma_crear_accion(uuid, uuid, text, uuid, date) from public, anon;
grant execute on function public.ssoma_crear_accion(uuid, uuid, text, uuid, date) to authenticated;

-- 11. Cerrar con evidencia --------------------------------------------------------------------------------
-- La cierra su responsable, o SSOMA. El id del cierre lo pone la ventana: es la
-- carpeta de sus fotos, y un reintento con el mismo vuelve a dar el mismo cierre.
create or replace function public.ssoma_cerrar_accion(p_accion uuid, p_evento uuid, p_nota text, p_fotos jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_envio  constant jsonb := jsonb_build_array(p_accion, p_nota, p_fotos);
  v_acc    public.ssoma_acciones%rowtype;
  v_rep    public.ssoma_reportes%rowtype;
  v_ultimo public.ssoma_accion_eventos%rowtype;
  v_nota   text := btrim(coalesce(p_nota, ''));
  v_quien  text;
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para cerrar la acción.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_acc from public.ssoma_acciones where id = p_accion for update;
  if not found then raise exception 'Esa acción no existe.' using errcode = 'check_violation'; end if;
  if v_acc.responsable_id is distinct from v_yo and not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Esta acción la cierra su responsable o SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_evento is null then raise exception 'Vuelve a abrir la ventana del cierre.' using errcode = 'check_violation'; end if;
  if v_acc.estado = 'CERRADA' then
    select * into v_ultimo from public.ssoma_accion_eventos
     where accion_id = p_accion and tipo = 'CERRADA' order by creado_en desc, id desc limit 1;
    -- El mismo cierre repetido (se perdió la respuesta), con la misma nota y las
    -- mismas fotos, entra; con otras, dice que quedó el primero: darlo por bueno
    -- dejaría sueltas las fotos nuevas.
    if v_ultimo.id = p_evento and v_ultimo.hecho_por = v_yo then
      if public.mismo_envio(p_evento, 'CIERRE_ACCION_SSOMA', v_envio) then return p_accion; end if;
      raise exception 'El cierre ya quedó la primera vez que lo enviaste: lo que cambiaste después no se guardó.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Esta acción ya la cerró % el %.', coalesce(public.ssoma_nombre_de(v_acc.cerrado_por), 'otra persona'),
      to_char(v_acc.cerrado_en at time zone 'America/Lima', 'DD/MM/YYYY "a las" HH24:MI') using errcode = 'check_violation';
  end if;
  if v_acc.estado = 'ANULADA' then
    raise exception 'Esta acción está anulada: ya no se cierra.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ssoma_accion_eventos where id = p_evento) then
    raise exception 'Vuelve a abrir la ventana del cierre.' using errcode = 'check_violation';
  end if;
  if char_length(v_nota) not between 10 and 1000 then
    raise exception 'Cuenta qué se hizo, en 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_accion_eventos (id, accion_id, tipo, responsable_id, fecha_limite, nota, hecho_por)
  values (p_evento, p_accion, 'CERRADA', v_acc.responsable_id, v_acc.fecha_limite, v_nota, v_yo);
  perform public.ssoma_anotar_evidencia(p_accion, p_evento, p_fotos);
  perform public.anotar_envio(p_evento, 'CIERRE_ACCION_SSOMA', v_envio);
  update public.ssoma_acciones set estado = 'CERRADA', cerrado_por = v_yo, cerrado_en = now(), nota_cierre = v_nota
   where id = p_accion;

  select * into v_rep from public.ssoma_reportes where id = v_acc.reporte_id;
  v_quien := coalesce(public.ssoma_nombre_de(v_yo), 'El responsable');
  perform public.avisar_a_permiso('ssoma.gestionar',
    'Acción cerrada con evidencia (' || v_rep.numero || ')',
    v_quien || ': ' || v_nota,
    '/ssoma/' || v_rep.id::text || '#accion-' || p_accion::text, 'ssoma_acciones', p_accion);
  if public.ssoma_recalcular_reporte(v_rep.id) then
    perform public.ssoma_avisar_a(v_rep.registrado_por,
      'Tu reporte ' || v_rep.numero || ' quedó corregido',
      'Se cerraron con evidencia todas las acciones que SSOMA pidió.',
      '/ssoma/' || v_rep.id::text, 'ssoma_reportes', v_rep.id);
  end if;
  return p_accion;
end;
$$;
comment on function public.ssoma_cerrar_accion(uuid, uuid, text, jsonb) is
  'El responsable (o SSOMA) cierra una acción correctiva con qué se hizo y de 1 a 4 fotos ya subidas; avisa a SSOMA y, si era la última, cierra el reporte y avisa a quien lo reportó.';
revoke all on function public.ssoma_cerrar_accion(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.ssoma_cerrar_accion(uuid, uuid, text, jsonb) to authenticated;

-- Si el cierre le llega a alguien de SSOMA: `avisar_a_permiso` no le avisa a
-- quien cierra ni a una cuenta dada de baja. La pantalla no dice «ya le avisamos
-- a SSOMA» si nadie lo recibe.
create or replace function public.ssoma_hay_quien_reciba_el_cierre()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.usuarios u
     where u.activo and u.id is distinct from public.usuario_actual()
       and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'ssoma.gestionar'));
$$;
comment on function public.ssoma_hay_quien_reciba_el_cierre() is
  'Si hay una cuenta activa de SSOMA, distinta de quien pregunta, que recibe el aviso del cierre de una acción.';
revoke all on function public.ssoma_hay_quien_reciba_el_cierre() from public, anon;
grant execute on function public.ssoma_hay_quien_reciba_el_cierre() to authenticated;

-- Lo que espera por SSOMA: los reportes por clasificar y los clasificados que no
-- tienen ninguna acción viva (se quedarían quietos sin que nadie se entere).
create or replace function public.ssoma_por_atender()
returns table (por_clasificar integer, sin_accion integer)
language sql stable security definer set search_path to 'public' rows 1 as $$
  select count(*) filter (where r.estado = 'REPORTADO')::integer,
         count(*) filter (where r.estado = 'CLASIFICADO'
                            and not exists (select 1 from public.ssoma_acciones a
                                             where a.reporte_id = r.id and a.estado <> 'ANULADA'))::integer
    from public.ssoma_reportes r
   where public.puede_ver_reportes_ssoma() and r.estado in ('REPORTADO', 'CLASIFICADO');
$$;
comment on function public.ssoma_por_atender() is
  'Cuántos reportes esperan su clasificación y cuántos clasificados no tienen ninguna acción viva. Solo para SSOMA y Gerencia; a los demás, ceros.';
revoke all on function public.ssoma_por_atender() from public, anon;
grant execute on function public.ssoma_por_atender() to authenticated;

-- 12. Reabrir, reasignar y anular: SSOMA -----------------------------------------------------------------
-- La evidencia no basta: vuelve a su responsable con el motivo y una fecha nueva.
create or replace function public.ssoma_reabrir_accion(p_accion uuid, p_motivo text, p_fecha_limite date)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_acc    public.ssoma_acciones%rowtype;
  v_ultimo public.ssoma_accion_eventos%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoy    date := public.ssoma_hoy();
  v_numero text;
  v_rep    public.ssoma_reportes%rowtype;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una acción correctiva la reabre SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se reabre, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_acc from public.ssoma_acciones where id = p_accion for update;
  if not found then raise exception 'Esa acción no existe.' using errcode = 'check_violation'; end if;
  if v_acc.estado = 'ABIERTA' then
    select * into v_ultimo from public.ssoma_accion_eventos where accion_id = p_accion order by creado_en desc, id desc limit 1;
    if v_ultimo.tipo = 'REABIERTA' and v_ultimo.nota = v_motivo and v_ultimo.fecha_limite is not distinct from p_fecha_limite then
      return p_accion;
    end if;
    raise exception 'Esta acción está abierta: no hay cierre que reabrir.' using errcode = 'check_violation';
  end if;
  if v_acc.estado = 'ANULADA' then
    raise exception 'Esta acción está anulada: ya no se reabre.' using errcode = 'check_violation';
  end if;
  if p_fecha_limite is null or p_fecha_limite < v_hoy or p_fecha_limite > v_hoy + 365 then
    raise exception 'Pon la nueva fecha límite: desde hoy y hasta dentro de un año.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_accion_eventos (accion_id, tipo, responsable_id, fecha_limite, nota, hecho_por)
  values (p_accion, 'REABIERTA', v_acc.responsable_id, p_fecha_limite, v_motivo, v_yo);
  update public.ssoma_acciones
     set estado = 'ABIERTA', fecha_limite = p_fecha_limite, cerrado_por = null, cerrado_en = null, nota_cierre = null
   where id = p_accion;
  select * into v_rep from public.ssoma_reportes where id = v_acc.reporte_id;
  perform public.ssoma_recalcular_reporte(v_acc.reporte_id);
  v_numero := v_rep.numero;
  perform public.ssoma_avisar_a(v_acc.responsable_id,
    'SSOMA reabrió tu acción correctiva (' || v_numero || '): vence el ' || public.ssoma_dia(p_fecha_limite),
    v_motivo, '/ssoma/' || v_acc.reporte_id::text || '#accion-' || p_accion::text, 'ssoma_acciones', p_accion);
  -- Quien reportó ya había recibido «quedó corregido»: se entera de que volvió.
  if v_rep.estado = 'CERRADO' then
    perform public.ssoma_avisar_a(v_rep.registrado_por,
      'Tu reporte ' || v_numero || ' volvió a corrección',
      'SSOMA reabrió una de sus acciones: falta corregir algo más.',
      '/ssoma/' || v_rep.id::text, 'ssoma_reportes', v_rep.id);
  end if;
  return p_accion;
end;
$$;
comment on function public.ssoma_reabrir_accion(uuid, text, date) is
  'SSOMA reabre una acción cerrada cuya evidencia no basta, con su motivo y una fecha límite nueva; avisa al responsable. Exige ssoma.gestionar.';
revoke all on function public.ssoma_reabrir_accion(uuid, text, date) from public, anon;
grant execute on function public.ssoma_reabrir_accion(uuid, text, date) to authenticated;

-- Otra persona u otra fecha, mientras siga abierta.
create or replace function public.ssoma_reasignar_accion(p_accion uuid, p_responsable uuid, p_fecha_limite date)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_acc    public.ssoma_acciones%rowtype;
  v_hoy    date := public.ssoma_hoy();
  v_numero text;
  v_ruta   text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una acción correctiva la reasigna SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_acc from public.ssoma_acciones where id = p_accion for update;
  if not found then raise exception 'Esa acción no existe.' using errcode = 'check_violation'; end if;
  if v_acc.estado <> 'ABIERTA' then
    raise exception 'Solo se reasigna una acción abierta.' using errcode = 'check_violation';
  end if;
  -- Lo mismo que ya tiene (se perdió la respuesta): nada que cambiar.
  if p_responsable = v_acc.responsable_id and p_fecha_limite = v_acc.fecha_limite then return p_accion; end if;
  if p_responsable is null or not exists (select 1 from public.usuarios u where u.id = p_responsable and u.activo) then
    raise exception 'Elige al responsable entre las cuentas activas.' using errcode = 'check_violation';
  end if;
  if p_fecha_limite is null then
    raise exception 'Pon la fecha límite.' using errcode = 'check_violation';
  end if;
  if p_fecha_limite <> v_acc.fecha_limite and (p_fecha_limite < v_hoy or p_fecha_limite > v_hoy + 365) then
    raise exception 'La fecha límite nueva va desde hoy y hasta dentro de un año.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_accion_eventos (accion_id, tipo, responsable_id, fecha_limite, hecho_por)
  values (p_accion, 'REASIGNADA', p_responsable, p_fecha_limite, v_yo);
  update public.ssoma_acciones set responsable_id = p_responsable, fecha_limite = p_fecha_limite where id = p_accion;

  select numero into v_numero from public.ssoma_reportes where id = v_acc.reporte_id;
  v_ruta := '/ssoma/' || v_acc.reporte_id::text || '#accion-' || p_accion::text;
  if p_responsable <> v_acc.responsable_id then
    perform public.ssoma_avisar_a(p_responsable,
      'Acción correctiva a tu cargo (' || v_numero || '): vence el ' || public.ssoma_dia(p_fecha_limite),
      v_acc.descripcion, v_ruta, 'ssoma_acciones', p_accion);
    perform public.ssoma_avisar_a(v_acc.responsable_id,
      'SSOMA le pasó a otra persona tu acción correctiva (' || v_numero || ')',
      -- A «/ssoma»: el reporte ya no es suyo y su ficha no se le abre.
      v_acc.descripcion, '/ssoma', 'ssoma_acciones', p_accion);
  else
    perform public.ssoma_avisar_a(p_responsable,
      'Tu acción correctiva (' || v_numero || ') ahora vence el ' || public.ssoma_dia(p_fecha_limite),
      v_acc.descripcion, v_ruta, 'ssoma_acciones', p_accion);
  end if;
  return p_accion;
end;
$$;
comment on function public.ssoma_reasignar_accion(uuid, uuid, date) is
  'SSOMA le pasa una acción abierta a otra cuenta activa o le cambia la fecha límite; avisa a quien corresponde. Exige ssoma.gestionar.';
revoke all on function public.ssoma_reasignar_accion(uuid, uuid, date) from public, anon;
grant execute on function public.ssoma_reasignar_accion(uuid, uuid, date) to authenticated;

create or replace function public.ssoma_anular_accion(p_accion uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_acc    public.ssoma_acciones%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_rep    public.ssoma_reportes%rowtype;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una acción correctiva la anula SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_acc from public.ssoma_acciones where id = p_accion for update;
  if not found then raise exception 'Esa acción no existe.' using errcode = 'check_violation'; end if;
  if v_acc.estado = 'ANULADA' then
    if v_acc.motivo_anulacion = v_motivo then return p_accion; end if;
    raise exception 'Esta acción ya estaba anulada, con este motivo: «%». No se cambia.', v_acc.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  if v_acc.estado = 'CERRADA' then
    raise exception 'Esta acción ya se cerró con evidencia: si no basta, reábrela.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_accion_eventos (accion_id, tipo, responsable_id, fecha_limite, nota, hecho_por)
  values (p_accion, 'ANULADA', v_acc.responsable_id, v_acc.fecha_limite, v_motivo, v_yo);
  update public.ssoma_acciones set estado = 'ANULADA', anulado_por = v_yo, anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_accion;

  select * into v_rep from public.ssoma_reportes where id = v_acc.reporte_id;
  perform public.ssoma_avisar_a(v_acc.responsable_id,
    'SSOMA anuló tu acción correctiva (' || v_rep.numero || ')', v_motivo || ' · ' || v_acc.descripcion,
    -- A «/ssoma»: sin una acción viva, la ficha del reporte ya no se le abre. El motivo va en el aviso.
    '/ssoma', 'ssoma_acciones', p_accion);
  if public.ssoma_recalcular_reporte(v_rep.id) then
    perform public.ssoma_avisar_a(v_rep.registrado_por,
      'Tu reporte ' || v_rep.numero || ' quedó corregido',
      'Se cerraron con evidencia las acciones que siguen vigentes.',
      '/ssoma/' || v_rep.id::text, 'ssoma_reportes', v_rep.id);
  end if;
  return p_accion;
end;
$$;
comment on function public.ssoma_anular_accion(uuid, text) is
  'SSOMA anula una acción abierta con su motivo (no se borra) y avisa al responsable. Exige ssoma.gestionar.';
revoke all on function public.ssoma_anular_accion(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_accion(uuid, text) to authenticated;

-- 13. Un reporte con acciones vigentes no se anula ---------------------------------------------------
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
  if v_rep.estado = 'ANULADO' then
    -- El mismo pedido repetido (se perdió la respuesta) entra; con otro motivo se dice, no se finge.
    if v_rep.motivo_anulacion = btrim(p_motivo) then return p_id; end if;
    raise exception 'El reporte % ya estaba anulado, con este motivo: «%». No se cambia.', v_rep.numero, v_rep.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ssoma_acciones a where a.reporte_id = p_id and a.estado <> 'ANULADA') then
    raise exception 'El reporte % tiene acciones correctivas: anula primero las abiertas. Uno con acciones cerradas queda como evidencia.', v_rep.numero
      using errcode = 'check_violation';
  end if;
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
revoke all on function public.ssoma_anular_reporte(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_reporte(uuid, text) to authenticated;

-- 14. Lo que cada quien lee ----------------------------------------------------------------------------
-- El reporte, con un alcance más: ACCION · quien tiene una acción vigente del
-- reporte lo ve como el área, sin quién lo reportó ni las fotos.
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
    select r.*,
           case when yo.todo then 'TODOS'
                when r.registrado_por = yo.id then 'PROPIO'
                when r.area_id = yo.area_id and r.estado <> 'ANULADO' then 'AREA'
                else 'ACCION' end as alcance
      from public.ssoma_reportes r
      cross join yo
     where (p_id is null or r.id = p_id)
       and (yo.todo
            or r.registrado_por = yo.id
            or (r.area_id = yo.area_id and r.estado <> 'ANULADO')
            or exists (select 1 from public.ssoma_acciones a
                        where a.reporte_id = r.id and a.responsable_id = yo.id and a.estado <> 'ANULADA'))
  )
  select v.id, v.numero, v.tipo, v.area_id, a.codigo, a.nombre, v.lugar, v.descripcion,
         v.ocurrido_en, v.hubo_atencion, v.estado, v.creado_en,
         case when v.estado = 'REPORTADO'
              then (now() at time zone 'America/Lima')::date - (v.creado_en at time zone 'America/Lima')::date end,
         v.alcance,
         case when v.alcance in ('TODOS', 'PROPIO') then btrim(u.nombres || ' ' || u.apellidos) end,
         case when v.alcance in ('TODOS', 'PROPIO') then ro.nombre end,
         case when v.alcance in ('TODOS', 'PROPIO') then btrim(t.nombres || ' ' || t.apellidos) end,
         case when v.alcance in ('TODOS', 'PROPIO') then t.cargo end,
         case when v.alcance in ('TODOS', 'PROPIO')
              then (select count(*)::integer from public.ssoma_reporte_fotos f where f.reporte_id = v.id) else 0 end,
         v.anulado_en,
         case when v.alcance in ('TODOS', 'PROPIO') then btrim(an.nombres || ' ' || an.apellidos) end,
         case when v.alcance in ('TODOS', 'PROPIO') then v.motivo_anulacion end
    from visibles v
    join public.areas a on a.id = v.area_id
    join public.usuarios u on u.id = v.registrado_por
    left join public.roles ro on ro.id = u.rol_id
    left join public.trabajadores t on t.id = v.trabajador_id
    left join public.usuarios an on an.id = v.anulado_por;
$$;
comment on function public.ssoma_reportes_visibles(uuid) is
  'Los reportes de seguridad que ve quien pregunta (uno, o todos con p_id vacío): todos (SSOMA, Gerencia), los suyos, los del área donde trabaja y los de las acciones que tiene a cargo, estos dos sin quién los reportó, sin fotos y sin los anulados. dias_en_espera se cuenta con la fecha de Lima.';
revoke all on function public.ssoma_reportes_visibles(uuid) from public, anon;
grant execute on function public.ssoma_reportes_visibles(uuid) to authenticated;

-- Cómo va cada reporte visible: la clasificación (solo SSOMA y Gerencia) y sus acciones.
-- Recibe los reportes que la pantalla muestra, no «todos»: con «todos», el tope de
-- filas de la API cortaba la respuesta y un reporte decía «sin acciones aún» sin serlo.
create or replace function public.ssoma_seguimiento_de_reportes(p_ids uuid[])
returns table (
  reporte uuid, clasificacion text, hubo_atencion boolean, dias_perdidos integer, causa text,
  clasifico text, clasificado_en timestamptz, cerrado_en timestamptz,
  acciones integer, abiertas integer, vencidas integer, cerradas integer)
language sql stable security definer set search_path to 'public' rows 200 as $$
  select v.id,
         case when v.alcance = 'TODOS' then c.clasificacion end,
         case when v.alcance = 'TODOS' then c.hubo_atencion end,
         case when v.alcance = 'TODOS' then c.dias_perdidos end,
         case when v.alcance = 'TODOS' then c.causa end,
         case when v.alcance = 'TODOS' then public.ssoma_nombre_de(c.clasificado_por) end,
         case when v.alcance = 'TODOS' then c.creado_en end,
         r.cerrado_en,
         coalesce(n.acciones, 0), coalesce(n.abiertas, 0), coalesce(n.vencidas, 0), coalesce(n.cerradas, 0)
    from (select distinct x.id from unnest(p_ids) as x(id) where x.id is not null) i
    cross join lateral public.ssoma_reportes_visibles(i.id) v
    join public.ssoma_reportes r on r.id = v.id
    left join lateral (
      select x.* from public.ssoma_clasificaciones x where x.reporte_id = v.id order by x.creado_en desc, x.id desc limit 1
    ) c on true
    left join lateral (
      select count(*) filter (where a.estado <> 'ANULADA')::integer as acciones,
             count(*) filter (where a.estado = 'ABIERTA')::integer as abiertas,
             count(*) filter (where a.estado = 'ABIERTA' and a.fecha_limite < public.ssoma_hoy())::integer as vencidas,
             count(*) filter (where a.estado = 'CERRADA')::integer as cerradas
        from public.ssoma_acciones a where a.reporte_id = v.id
    ) n on true;
$$;
comment on function public.ssoma_seguimiento_de_reportes(uuid[]) is
  'Cómo va cada uno de esos reportes, si quien pregunta lo ve: la última clasificación con su causa (solo SSOMA y Gerencia) y cuántas acciones tiene abiertas, vencidas y cerradas.';
revoke all on function public.ssoma_seguimiento_de_reportes(uuid[]) from public, anon;
grant execute on function public.ssoma_seguimiento_de_reportes(uuid[]) to authenticated;

-- Las acciones que ve quien pregunta (de un reporte, una sola, o todas). `alcance`:
--   TODOS       · SSOMA, Gerencia y el administrador: todas, con su historia.
--   RESPONSABLE · las que tiene a su cargo, con su evidencia.
--   REPORTE     · las de un reporte que reportó o de su área: qué se corrige, a
--                 cargo de quién, hasta cuándo y cómo va; sin las anuladas.
create or replace function public.ssoma_acciones_visibles(p_reporte uuid, p_id uuid)
returns table (
  id uuid, reporte_id uuid, reporte_numero text, reporte_tipo text, area text, descripcion text,
  responsable_id uuid, responsable text, responsable_puesto text, fecha_limite date, estado text,
  dias_para_vencer integer, creado_en timestamptz, asigno text, cerrado_en timestamptz, cerro text, nota_cierre text,
  fotos integer, anulado_en timestamptz, motivo_anulacion text, alcance text, orden integer)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, u.area_id, public.puede_ver_reportes_ssoma() as todo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select x.*, r.numero as rep_numero, r.tipo as rep_tipo,
           case when yo.todo then 'TODOS' when x.responsable_id = yo.id then 'RESPONSABLE' else 'REPORTE' end as alcance
      from public.ssoma_acciones x
      join public.ssoma_reportes r on r.id = x.reporte_id
      cross join yo
     where (p_reporte is null or x.reporte_id = p_reporte)
       and (p_id is null or x.id = p_id)
       and (yo.todo
            or x.responsable_id = yo.id
            or (x.estado <> 'ANULADA'
                and (r.registrado_por = yo.id or (r.area_id = yo.area_id and r.estado <> 'ANULADO'))))
  )
  select v.id, v.reporte_id, v.rep_numero, v.rep_tipo, ar.nombre, v.descripcion,
         v.responsable_id, btrim(u.nombres || ' ' || u.apellidos), coalesce(nullif(btrim(u.cargo), ''), ro.nombre),
         v.fecha_limite, v.estado,
         case when v.estado = 'ABIERTA' then v.fecha_limite - public.ssoma_hoy() end,
         v.creado_en, public.ssoma_nombre_de(v.creado_por), v.cerrado_en, public.ssoma_nombre_de(v.cerrado_por), v.nota_cierre,
         case when v.alcance <> 'REPORTE'
              then (select count(*)::integer from public.ssoma_accion_fotos f
                     where f.evento_id = (select e.id from public.ssoma_accion_eventos e
                                           where e.accion_id = v.id and e.tipo = 'CERRADA'
                                           order by e.creado_en desc, e.id desc limit 1)
                       and v.estado = 'CERRADA')
              else 0 end,
         v.anulado_en,
         case when v.alcance <> 'REPORTE' then v.motivo_anulacion end,
         v.alcance,
         -- Para ordenar en la base, antes del tope: vencidas, abiertas, cerradas, anuladas.
         case when v.estado = 'ABIERTA' and v.fecha_limite < public.ssoma_hoy() then 0
              when v.estado = 'ABIERTA' then 1
              when v.estado = 'CERRADA' then 2
              else 3 end
    from visibles v
    join public.areas ar on ar.id = v.area_id
    join public.usuarios u on u.id = v.responsable_id
    left join public.roles ro on ro.id = u.rol_id;
$$;
comment on function public.ssoma_acciones_visibles(uuid, uuid) is
  'Las acciones correctivas que ve quien pregunta: todas (SSOMA, Gerencia), las que tiene a cargo, y las vigentes de los reportes que hizo o de su área, sin la evidencia. dias_para_vencer es negativo si ya venció (fecha de Lima); orden pone primero las vencidas, después las abiertas, las cerradas y las anuladas.';
revoke all on function public.ssoma_acciones_visibles(uuid, uuid) from public, anon;
grant execute on function public.ssoma_acciones_visibles(uuid, uuid) to authenticated;

-- La historia de una acción: para SSOMA, Gerencia y su responsable.
create or replace function public.ssoma_historia_de_accion(p_accion uuid)
returns table (id uuid, tipo text, responsable text, fecha_limite date, nota text, hizo text, hizo_puesto text, creado_en timestamptz, fotos integer)
language sql stable security definer set search_path to 'public' rows 10 as $$
  select e.id, e.tipo, public.ssoma_nombre_de(e.responsable_id), e.fecha_limite, e.nota,
         btrim(u.nombres || ' ' || u.apellidos), coalesce(nullif(btrim(u.cargo), ''), ro.nombre), e.creado_en,
         (select count(*)::integer from public.ssoma_accion_fotos f where f.evento_id = e.id)
    from public.ssoma_accion_eventos e
    join public.ssoma_acciones a on a.id = e.accion_id
    join public.usuarios u on u.id = e.hecho_por
    left join public.roles ro on ro.id = u.rol_id
   where e.accion_id = p_accion
     and (public.puede_ver_reportes_ssoma() or a.responsable_id = public.usuario_actual())
   order by e.creado_en, e.id;
$$;
comment on function public.ssoma_historia_de_accion(uuid) is
  'Cada paso de una acción correctiva (asignada, reasignada, cerrada, reabierta, anulada) con quién, cuándo y su nota. La ven SSOMA, Gerencia y su responsable.';
revoke all on function public.ssoma_historia_de_accion(uuid) from public, anon;
grant execute on function public.ssoma_historia_de_accion(uuid) to authenticated;
