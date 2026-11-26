-- =============================================================================
-- SSOMA: INSPECCIONES CON LISTA DE VERIFICACIÓN POR ÁREA
-- -----------------------------------------------------------------------------
-- Plan 15, entrega 15.4 (DKS, 2026-11-25): «inspecciones con lista de
-- verificación por área; cada hallazgo crea una acción de la 15.2.»
--
--   * LA LISTA. Cada área se inspecciona con los puntos de todas las áreas más
--     los suyos. SSOMA agrega y retira puntos; no se corrigen ni se borran: la
--     inspección guarda el texto de cada punto como estaba ese día.
--   * LA INSPECCIÓN. SSOMA recorre el área y marca cada punto: conforme, no
--     conforme o no aplica. Planeada o no planeada, como las nombra el registro
--     de inspecciones internas de la R.M. 050-2013-TR. Sin número propio: la
--     carpeta «18) SSOMA (SST)» del SIG no trae formato ni serie de inspecciones
--     (docs/ANALISIS-ONEDRIVE.md), y no se fija una sin que la empresa la dé.
--   * EL HALLAZGO. Cada punto no conforme dice qué se encontró y nace con su
--     acción correctiva de la 15.2: qué se hace, quién (una cuenta) y hasta
--     cuándo. Es la misma acción: se cierra con evidencia, se reasigna, se
--     reabre o se anula igual, y cuenta en las mismas listas. La acción cuelga
--     del hallazgo, no de un reporte de incidente inventado para sostenerla.
--   * NO SE BORRA. Una inspección mal registrada se anula con su motivo; con
--     acciones vigentes no se anula.
--   * QUIÉN VE: SSOMA registra (`ssoma.gestionar`); SSOMA y Gerencia consultan
--     (`ssoma.ver`). El responsable de una acción ve la inspección solo con el
--     hallazgo que le toca. Nadie más.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 0. Las funciones de la 15.2 que esta reescribe son las que el repositorio conoce ---------
-- Si alguien pegó un arreglo a mano en producción, se detiene en vez de pisarlo.
-- Valen la huella de la 15.2 y la de esta migración (volver a correrla).
do $$
declare
  v record;
begin
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.ssoma_cerrar_accion(uuid,uuid,text,jsonb)', array['fe9e754f3b5e1ad8fd071b778f22eca1', 'c1ec78cf1c42c84da6e6ce1c53962f89']),
        ('public.ssoma_reabrir_accion(uuid,text,date)', array['46f9cc50ff877a73752a78cf211cd6bf', '60d3ae753237f1c98d52eb4a0e0f23db']),
        ('public.ssoma_reasignar_accion(uuid,uuid,date)', array['8b4d0e8426dea5126af5549d33030f01', 'f0674045fb93bd6eb0ddbccdffdcb657']),
        ('public.ssoma_anular_accion(uuid,text)', array['7a0ece70f73fb29fcff0217569b4c24b', '9071b8b619fb53fdfeb3e10a10c3a40f'])
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

-- 1. La lista de verificación -----------------------------------------------------------------
create table if not exists public.ssoma_lista_puntos (
  id              uuid primary key default gen_random_uuid(),
  -- Sin área, el punto se revisa en todas. Ni (a) ni (b) ni (c): la lista es
  -- corta, se lee entera y un área no se borra.
  area_id         uuid references public.areas(id) on delete restrict,
  texto           text not null,
  orden           integer not null,
  activo          boolean not null default true,
  -- Sin cuenta: los puntos con que nace la lista.
  creado_por      uuid default public.usuario_actual() references public.usuarios(id) on delete restrict,
  retirado_por    uuid references public.usuarios(id) on delete restrict,
  retirado_en     timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_ssoma_punto_texto check (char_length(btrim(texto)) between 5 and 200),
  constraint ck_ssoma_punto_retirado check (activo = (retirado_en is null) and (not activo or retirado_por is null))
);
comment on table public.ssoma_lista_puntos is
  'Los puntos de la lista de verificación con que SSOMA inspecciona: los de todas las áreas (sin área) y los propios de cada una. SSOMA los agrega y los retira; no se corrigen ni se borran.';
-- El mismo punto no va dos veces en la misma lista.
create unique index if not exists uq_ssoma_punto_vigente
  on public.ssoma_lista_puntos (coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(texto)))
  where activo;
select public.activar_timestamps('ssoma_lista_puntos');
-- Sin `activar_auditoria`, como el resto de SSOMA: quién lo agregó y quién lo retiró ya están en la fila.
select public.activar_registro_de_prueba('ssoma_lista_puntos');

-- 2. La inspección y sus respuestas -------------------------------------------------------------
create table if not exists public.ssoma_inspecciones (
  id                uuid primary key default gen_random_uuid(),
  area_id           uuid not null references public.areas(id) on delete restrict,
  -- El día del recorrido, en Lima.
  fecha             date not null,
  tipo              text not null,
  observacion       text,
  creado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_ssoma_inspeccion_datos check (
    tipo in ('PLANEADA', 'NO_PLANEADA')
    and (observacion is null or char_length(btrim(observacion)) between 1 and 1000)),
  constraint ck_ssoma_inspeccion_anulada check (
    (anulado_por is null and anulado_en is null and motivo_anulacion is null)
    or (anulado_por is not null and anulado_en is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.ssoma_inspecciones is
  'Cada inspección de seguridad que SSOMA hace en un área con su lista de verificación: fecha, si fue planeada y su observación. No se corrige ni se borra: se anula con su motivo.';
-- La última de cada área y la lista por fecha (b); también sirve a la llave del área.
create index if not exists ix_ssoma_inspecciones_area_fecha on public.ssoma_inspecciones (area_id, fecha desc);
select public.activar_timestamps('ssoma_inspecciones');
select public.activar_registro_de_prueba('ssoma_inspecciones');

create table if not exists public.ssoma_inspeccion_respuestas (
  id              uuid primary key default gen_random_uuid(),
  inspeccion_id   uuid not null references public.ssoma_inspecciones(id) on delete restrict,
  -- Ni (a) ni (b) ni (c): un punto no se borra y nada filtra por él.
  punto_id        uuid not null references public.ssoma_lista_puntos(id) on delete restrict,
  orden           smallint not null,
  -- El punto como estaba escrito ese día.
  texto           text not null,
  resultado       text not null,
  -- Qué se encontró, solo del no conforme.
  hallazgo        text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  -- También es el índice de la llave hacia la inspección.
  constraint uq_ssoma_respuesta_punto unique (inspeccion_id, punto_id),
  constraint ck_ssoma_respuesta check (
    (resultado in ('CONFORME', 'NO_APLICA') and hallazgo is null)
    or (resultado = 'NO_CONFORME' and char_length(btrim(coalesce(hallazgo, ''))) between 10 and 500))
);
comment on table public.ssoma_inspeccion_respuestas is
  'Lo que SSOMA marcó en cada punto de una inspección: conforme, no conforme (con lo que encontró) o no aplica. De cada no conforme cuelga su acción correctiva. No se cambia ni se borra.';
select public.activar_timestamps('ssoma_inspeccion_respuestas');
select public.activar_registro_de_prueba('ssoma_inspeccion_respuestas');

-- 3. La acción correctiva nace de un reporte o de un hallazgo -----------------------------------
alter table public.ssoma_acciones alter column reporte_id drop not null;
alter table public.ssoma_acciones
  add column if not exists respuesta_id uuid references public.ssoma_inspeccion_respuestas(id) on delete restrict;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ssoma_accion_origen' and conrelid = 'public.ssoma_acciones'::regclass) then
    alter table public.ssoma_acciones add constraint ck_ssoma_accion_origen check (num_nonnulls(reporte_id, respuesta_id) = 1);
  end if;
end $$;
comment on column public.ssoma_acciones.respuesta_id is
  'El hallazgo de inspección que esta acción corrige. Una acción es de un reporte o de un hallazgo, nunca de los dos (ck_ssoma_accion_origen).';
-- Las acciones de un hallazgo y de una inspección (b), y su llave.
create index if not exists ix_ssoma_acciones_respuesta on public.ssoma_acciones (respuesta_id);
comment on table public.ssoma_acciones is
  'La acción correctiva de un reporte de seguridad o del hallazgo de una inspección: qué se corrige, quién (una cuenta) y hasta cuándo. La cierra su responsable con evidencia; SSOMA la reasigna, la reabre o la anula con motivo. No se borra: su historia está en ssoma_accion_eventos.';

-- 4. Lo que no se borra ni se corrige por debajo -------------------------------------------------
create or replace trigger trg_ssoma_respuesta_guardia
  before update or delete on public.ssoma_inspeccion_respuestas
  for each row execute function public.fn_ssoma_solo_se_agrega();

-- La inspección solo cambia al anularse; quién y cuándo los pone la base. Anulada, queda congelada.
create or replace function public.fn_ssoma_inspeccion_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una inspección no se borra: SSOMA la anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'La inspección está anulada: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Una inspección registrada no se corrige: SSOMA la anula y registra otra.' using errcode = 'check_violation';
  end if;
  if new.motivo_anulacion is not null then
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_inspeccion_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_inspeccion_guardia
  before update or delete on public.ssoma_inspecciones
  for each row execute function public.fn_ssoma_inspeccion_guardia();

-- El punto solo se retira o se restituye; quién y cuándo lo retiró los pone la base.
create or replace function public.fn_ssoma_punto_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['activo', 'retirado_por', 'retirado_en', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un punto de la lista de verificación no se borra: SSOMA lo retira.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Un punto de la lista no se corrige: SSOMA lo retira y agrega otro.' using errcode = 'check_violation';
  end if;
  if new.activo then
    new.retirado_por := null;
    new.retirado_en := null;
  elsif old.activo then
    new.retirado_por := public.usuario_actual();
    new.retirado_en := now();
  else
    new.retirado_por := old.retirado_por;
    new.retirado_en := old.retirado_en;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_punto_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_punto_guardia
  before update or delete on public.ssoma_lista_puntos
  for each row execute function public.fn_ssoma_punto_guardia();

-- 5. Quién lee las tablas: SSOMA y Gerencia. Se escriben solo por las funciones -----------------
-- El responsable de una acción lee su hallazgo por las funciones de la sección 11, sin la tabla.
alter table public.ssoma_lista_puntos enable row level security;
alter table public.ssoma_inspecciones enable row level security;
alter table public.ssoma_inspeccion_respuestas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_lista_puntos' and policyname = 'ver_ssoma_lista_puntos') then
    create policy ver_ssoma_lista_puntos on public.ssoma_lista_puntos for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_inspecciones' and policyname = 'ver_ssoma_inspecciones') then
    create policy ver_ssoma_inspecciones on public.ssoma_inspecciones for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_inspeccion_respuestas' and policyname = 'ver_ssoma_inspeccion_respuestas') then
    create policy ver_ssoma_inspeccion_respuestas on public.ssoma_inspeccion_respuestas for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
end $$;
revoke all on public.ssoma_lista_puntos from public, anon, authenticated;
revoke all on public.ssoma_inspecciones from public, anon, authenticated;
revoke all on public.ssoma_inspeccion_respuestas from public, anon, authenticated;
grant select on public.ssoma_lista_puntos to authenticated;
grant select on public.ssoma_inspecciones to authenticated;
grant select on public.ssoma_inspeccion_respuestas to authenticated;

-- 6. La lista con que nace: lo que se mira en cualquier área del taller -------------------------
-- Diez puntos generales, para que la primera inspección no empiece en blanco. SSOMA
-- los retira o agrega los de cada área. Con id fijo: volver a correr no los repite
-- ni restituye el que SSOMA retiró.
insert into public.ssoma_lista_puntos (id, area_id, texto, orden, creado_por) values
  ('5a150001-0000-4000-8000-000000000001', null, 'El personal usa el equipo de protección que pide su tarea (casco, lentes, guantes, calzado)', 1, null),
  ('5a150001-0000-4000-8000-000000000002', null, 'Pasillos, salidas y zonas de paso libres de obstáculos', 2, null),
  ('5a150001-0000-4000-8000-000000000003', null, 'Puestos de trabajo ordenados y limpios, sin derrames ni retazos en el piso', 3, null),
  ('5a150001-0000-4000-8000-000000000004', null, 'Extintores en su lugar, señalizados, con acceso libre y carga vigente', 4, null),
  ('5a150001-0000-4000-8000-000000000005', null, 'Tableros, cables, enchufes y extensiones en buen estado', 5, null),
  ('5a150001-0000-4000-8000-000000000006', null, 'Máquinas y herramientas con sus guardas puestas y en buen estado', 6, null),
  ('5a150001-0000-4000-8000-000000000007', null, 'Balones de gas y productos inflamables asegurados y lejos del calor', 7, null),
  ('5a150001-0000-4000-8000-000000000008', null, 'Señales de seguridad visibles y en buen estado', 8, null),
  ('5a150001-0000-4000-8000-000000000009', null, 'Botiquín a la mano y con lo necesario', 9, null),
  ('5a150001-0000-4000-8000-000000000010', null, 'Iluminación y ventilación suficientes para el trabajo', 10, null)
on conflict do nothing;

-- 7. SSOMA lleva la lista ------------------------------------------------------------------------
-- El punto que ya está en la lista con que se inspecciona esa área (la suya o la de todas).
create or replace function public.ssoma_punto_repetido(p_area uuid, p_texto text, p_salvo uuid)
returns text language sql stable set search_path to 'public' as $$
  select coalesce(a.nombre, 'todas las áreas')
    from public.ssoma_lista_puntos p
    left join public.areas a on a.id = p.area_id
   where p.activo and p.id is distinct from p_salvo
     and lower(btrim(p.texto)) = lower(btrim(p_texto))
     and (p_area is null or p.area_id is null or p.area_id = p_area)
   order by (p.area_id is not null)
   limit 1;
$$;
revoke all on function public.ssoma_punto_repetido(uuid, text, uuid) from public, anon, authenticated;

-- El id lo pone la ventana: un reintento con lo mismo devuelve el que ya entró.
create or replace function public.ssoma_agregar_punto(p_id uuid, p_area uuid, p_texto text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_texto  text := regexp_replace(btrim(coalesce(p_texto, '')), '\s+', ' ', 'g');
  v_actual public.ssoma_lista_puntos%rowtype;
  v_donde  text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'La lista de verificación la lleva SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario del punto.' using errcode = 'check_violation'; end if;
  select * into v_actual from public.ssoma_lista_puntos where id = p_id;
  if found then
    if v_actual.creado_por = v_yo and v_actual.area_id is not distinct from p_area and v_actual.texto = v_texto then return p_id; end if;
    raise exception 'Ese punto ya quedó en la lista la primera vez que lo enviaste: lo que cambiaste después no se guardó.'
      using errcode = 'check_violation';
  end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
    raise exception 'Elige un área de la lista, o «Todas las áreas».' using errcode = 'check_violation';
  end if;
  if char_length(v_texto) not between 5 and 200 then
    raise exception 'Escribe qué se revisa, en 5 a 200 caracteres.' using errcode = 'check_violation';
  end if;
  v_donde := public.ssoma_punto_repetido(p_area, v_texto, null);
  if v_donde is not null then
    raise exception 'Ese punto ya está en la lista de %.', v_donde using errcode = 'check_violation';
  end if;

  insert into public.ssoma_lista_puntos (id, area_id, texto, orden, creado_por)
  values (p_id, p_area, v_texto,
          (select coalesce(max(p.orden), 0) + 1 from public.ssoma_lista_puntos p where p.area_id is not distinct from p_area),
          v_yo);
  return p_id;
end;
$$;
comment on function public.ssoma_agregar_punto(uuid, uuid, text) is
  'SSOMA agrega un punto a la lista de verificación de un área, o a la de todas (sin área). No acepta uno que ya esté en la lista con que se inspecciona esa área. Exige ssoma.gestionar.';
revoke all on function public.ssoma_agregar_punto(uuid, uuid, text) from public, anon;
grant execute on function public.ssoma_agregar_punto(uuid, uuid, text) to authenticated;

-- Retirar (p_activo = false) o restituir. Lo ya inspeccionado no cambia: guarda su texto.
create or replace function public.ssoma_activar_punto(p_id uuid, p_activo boolean)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo    uuid := public.usuario_actual();
  v_punto public.ssoma_lista_puntos%rowtype;
  v_donde text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'La lista de verificación la lleva SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_activo is null then raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation'; end if;
  select * into v_punto from public.ssoma_lista_puntos where id = p_id for update;
  if not found then raise exception 'Ese punto no existe.' using errcode = 'check_violation'; end if;
  -- Lo mismo que ya tiene (se perdió la respuesta): nada que cambiar.
  if v_punto.activo = p_activo then return p_id; end if;
  if p_activo then
    v_donde := public.ssoma_punto_repetido(v_punto.area_id, v_punto.texto, p_id);
    if v_donde is not null then
      raise exception 'Ese punto ya está en la lista de %: no hace falta restituirlo.', v_donde using errcode = 'check_violation';
    end if;
  end if;
  update public.ssoma_lista_puntos set activo = p_activo where id = p_id;
  return p_id;
end;
$$;
comment on function public.ssoma_activar_punto(uuid, boolean) is
  'SSOMA retira un punto de la lista de verificación (deja de pedirse en las inspecciones nuevas) o lo restituye. No se borra. Exige ssoma.gestionar.';
revoke all on function public.ssoma_activar_punto(uuid, boolean) from public, anon;
grant execute on function public.ssoma_activar_punto(uuid, boolean) to authenticated;

-- 8. Registrar la inspección -----------------------------------------------------------------------
-- Entra entera o no entra: cada punto vigente del área con su respuesta, y cada
-- no conforme con lo que se encontró y su acción. `p_respuestas` es una lista de
-- {punto, resultado, hallazgo, accion: {que, responsable, fecha_limite}}.
-- El id lo pone la ventana: un reintento con lo mismo devuelve la que ya entró.
create or replace function public.ssoma_registrar_inspeccion(
  p_id uuid, p_area uuid, p_fecha date, p_tipo text, p_observacion text, p_respuestas jsonb
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_area, p_fecha, p_tipo, p_observacion, p_respuestas);
  v_hoy     date := public.ssoma_hoy();
  v_obs     text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_area    text;
  v_actual  public.ssoma_inspecciones%rowtype;
  v_puntos  integer;
  v_r       record;
  v_punto   text;
  v_resp    uuid;
  v_accion  uuid;
  v_hall    text;
  v_que     text;
  v_quien   uuid;
  v_limite  date;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una inspección la registra SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la inspección.' using errcode = 'check_violation'; end if;
  select * into v_actual from public.ssoma_inspecciones where id = p_id;
  if found then
    -- El mismo pedido, de la misma persona: se perdió la respuesta.
    if v_actual.creado_por is distinct from v_yo then
      raise exception 'Vuelve a abrir el formulario de la inspección.' using errcode = 'check_violation';
    end if;
    if public.mismo_envio(p_id, 'INSPECCION_SSOMA', v_envio) then return p_id; end if;
    raise exception 'Esa inspección ya quedó registrada la primera vez que la enviaste: lo que cambiaste después no se guardó.'
      using errcode = 'check_violation';
  end if;

  select a.nombre into v_area from public.areas a where a.id = p_area and a.activo;
  if not found then raise exception 'Elige el área que inspeccionaste.' using errcode = 'check_violation'; end if;
  if p_tipo is null or p_tipo not in ('PLANEADA', 'NO_PLANEADA') then
    raise exception 'Marca si la inspección fue planeada o no planeada.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'La fecha de la inspección no puede ser posterior a hoy.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 60 then
    raise exception 'Se registran las inspecciones de los últimos 60 días.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 1000 then
    raise exception 'La observación pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if p_respuestas is null or jsonb_typeof(p_respuestas) <> 'array' then
    raise exception 'Vuelve a abrir el formulario de la inspección.' using errcode = 'check_violation';
  end if;

  -- La lista no cambia mientras entra esta inspección.
  perform 1 from public.ssoma_lista_puntos p where p.activo and (p.area_id is null or p.area_id = p_area) for share;
  select count(*) into v_puntos from public.ssoma_lista_puntos p where p.activo and (p.area_id is null or p.area_id = p_area);
  if v_puntos = 0 then
    raise exception '% no tiene puntos en su lista de verificación: agrégalos antes de inspeccionar.', v_area using errcode = 'check_violation';
  end if;
  -- Todos los puntos de la lista y solo ellos, una vez cada uno.
  if jsonb_array_length(p_respuestas) <> v_puntos
     or (select count(distinct x.r ->> 'punto') from jsonb_array_elements(p_respuestas) x(r)
          where exists (select 1 from public.ssoma_lista_puntos p
                         where p.id::text = lower(x.r ->> 'punto') and p.activo and (p.area_id is null or p.area_id = p_area))) <> v_puntos then
    raise exception 'La lista de verificación de % cambió mientras llenabas la inspección: vuelve a abrirla y márcala de nuevo.', v_area
      using errcode = 'check_violation';
  end if;

  insert into public.ssoma_inspecciones (id, area_id, fecha, tipo, observacion, creado_por)
  values (p_id, p_area, p_fecha, p_tipo, v_obs, v_yo);

  for v_r in
    select p.id as punto, p.texto,
           (row_number() over (order by (p.area_id is not null), p.orden, p.creado_en, p.id))::smallint as orden,
           x.r ->> 'resultado' as resultado, x.r ->> 'hallazgo' as hallazgo, x.r -> 'accion' as accion
      from public.ssoma_lista_puntos p
      cross join lateral (select r from jsonb_array_elements(p_respuestas) r where lower(r ->> 'punto') = p.id::text limit 1) x
     where p.activo and (p.area_id is null or p.area_id = p_area)
     order by 3
  loop
    v_punto := 'En el punto ' || v_r.orden || ' («' || left(v_r.texto, 80) || case when char_length(v_r.texto) > 80 then '…' else '' end || '»), ';
    if v_r.resultado is null or v_r.resultado not in ('CONFORME', 'NO_CONFORME', 'NO_APLICA') then
      raise exception '%marca si está conforme, no conforme o no aplica.', v_punto using errcode = 'check_violation';
    end if;
    v_hall := null;
    if v_r.resultado = 'NO_CONFORME' then
      v_hall := btrim(coalesce(v_r.hallazgo, ''));
      if char_length(v_hall) not between 10 and 500 then
        raise exception '%cuenta qué encontraste, en 10 a 500 caracteres.', v_punto using errcode = 'check_violation';
      end if;
      v_que := regexp_replace(btrim(coalesce(v_r.accion ->> 'que', '')), '\s+', ' ', 'g');
      if char_length(v_que) not between 10 and 500 then
        raise exception '%escribe qué se tiene que hacer, en 10 a 500 caracteres.', v_punto using errcode = 'check_violation';
      end if;
      -- Lo que no se lee como un id o como una fecha es como si no viniera.
      begin
        v_quien := (v_r.accion ->> 'responsable')::uuid;
        v_limite := (v_r.accion ->> 'fecha_limite')::date;
      exception when others then
        v_quien := null;
        v_limite := null;
      end;
      if v_quien is null or not exists (select 1 from public.usuarios u where u.id = v_quien and u.activo) then
        raise exception '%elige al responsable entre las cuentas activas.', v_punto using errcode = 'check_violation';
      end if;
      if v_limite is null or v_limite < v_hoy then
        raise exception '%la fecha límite no puede ser anterior a hoy.', v_punto using errcode = 'check_violation';
      end if;
      if v_limite > v_hoy + 365 then
        raise exception '%la fecha límite va hasta dentro de un año.', v_punto using errcode = 'check_violation';
      end if;
    end if;

    insert into public.ssoma_inspeccion_respuestas (inspeccion_id, punto_id, orden, texto, resultado, hallazgo)
    values (p_id, v_r.punto, v_r.orden, v_r.texto, v_r.resultado, v_hall)
    returning id into v_resp;

    if v_r.resultado = 'NO_CONFORME' then
      insert into public.ssoma_acciones (respuesta_id, area_id, descripcion, responsable_id, fecha_limite, creado_por)
      values (v_resp, p_area, v_que, v_quien, v_limite, v_yo)
      returning id into v_accion;
      insert into public.ssoma_accion_eventos (accion_id, tipo, responsable_id, fecha_limite, hecho_por)
      values (v_accion, 'ASIGNADA', v_quien, v_limite, v_yo);
      perform public.ssoma_avisar_a(v_quien,
        'Acción correctiva a tu cargo (inspección de ' || v_area || '): vence el ' || public.ssoma_dia(v_limite),
        v_que, '/ssoma/inspecciones/' || p_id::text || '#accion-' || v_accion::text, 'ssoma_acciones', v_accion);
    end if;
  end loop;

  perform public.anotar_envio(p_id, 'INSPECCION_SSOMA', v_envio);
  return p_id;
end;
$$;
comment on function public.ssoma_registrar_inspeccion(uuid, uuid, date, text, text, jsonb) is
  'SSOMA registra la inspección de un área: cada punto vigente de su lista con conforme, no conforme o no aplica, y de cada no conforme lo que encontró y su acción correctiva (qué, responsable y fecha límite), a quien le avisa. Entra entera o no entra. Exige ssoma.gestionar.';
revoke all on function public.ssoma_registrar_inspeccion(uuid, uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.ssoma_registrar_inspeccion(uuid, uuid, date, text, text, jsonb) to authenticated;

-- 9. Otra acción para un hallazgo, y anular la inspección ------------------------------------------
-- La primera acción nace con la inspección. Esta agrega otra: la que hacía falta
-- además, o la que reemplaza a una que SSOMA anuló.
create or replace function public.ssoma_accion_de_hallazgo(
  p_id uuid, p_respuesta uuid, p_descripcion text, p_responsable uuid, p_fecha_limite date
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_envio  constant jsonb := jsonb_build_array(p_respuesta, p_descripcion, p_responsable, p_fecha_limite);
  v_que    text := regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g');
  v_hoy    date := public.ssoma_hoy();
  v_actual public.ssoma_acciones%rowtype;
  v_resp   public.ssoma_inspeccion_respuestas%rowtype;
  v_ins    public.ssoma_inspecciones%rowtype;
  v_area   text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una acción correctiva la encarga SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la acción.' using errcode = 'check_violation'; end if;
  select * into v_actual from public.ssoma_acciones where id = p_id;
  if found then
    if v_actual.creado_por is distinct from v_yo then
      raise exception 'Vuelve a abrir el formulario de la acción.' using errcode = 'check_violation';
    end if;
    if public.mismo_envio(p_id, 'ACCION_SSOMA', v_envio) then return p_id; end if;
    raise exception 'Esa acción ya quedó registrada la primera vez que la enviaste: lo que cambiaste después no se guardó.'
      using errcode = 'check_violation';
  end if;

  select * into v_resp from public.ssoma_inspeccion_respuestas where id = p_respuesta;
  if not found or v_resp.resultado <> 'NO_CONFORME' then
    raise exception 'Ese hallazgo no existe.' using errcode = 'check_violation';
  end if;
  select * into v_ins from public.ssoma_inspecciones where id = v_resp.inspeccion_id for update;
  if v_ins.anulado_en is not null then
    raise exception 'La inspección está anulada: no lleva acciones.' using errcode = 'check_violation';
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

  insert into public.ssoma_acciones (id, respuesta_id, area_id, descripcion, responsable_id, fecha_limite, creado_por)
  values (p_id, p_respuesta, v_ins.area_id, v_que, p_responsable, p_fecha_limite, v_yo);
  insert into public.ssoma_accion_eventos (accion_id, tipo, responsable_id, fecha_limite, hecho_por)
  values (p_id, 'ASIGNADA', p_responsable, p_fecha_limite, v_yo);
  perform public.anotar_envio(p_id, 'ACCION_SSOMA', v_envio);

  select a.nombre into v_area from public.areas a where a.id = v_ins.area_id;
  perform public.ssoma_avisar_a(p_responsable,
    'Acción correctiva a tu cargo (inspección de ' || v_area || '): vence el ' || public.ssoma_dia(p_fecha_limite),
    v_que, '/ssoma/inspecciones/' || v_ins.id::text || '#accion-' || p_id::text, 'ssoma_acciones', p_id);
  return p_id;
end;
$$;
comment on function public.ssoma_accion_de_hallazgo(uuid, uuid, text, uuid, date) is
  'SSOMA encarga otra acción correctiva para el hallazgo de una inspección vigente, a una cuenta activa y con fecha límite desde hoy; le avisa. Exige ssoma.gestionar.';
revoke all on function public.ssoma_accion_de_hallazgo(uuid, uuid, text, uuid, date) from public, anon;
grant execute on function public.ssoma_accion_de_hallazgo(uuid, uuid, text, uuid, date) to authenticated;

create or replace function public.ssoma_anular_inspeccion(p_id uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_ins    public.ssoma_inspecciones%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una inspección la anula SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_ins from public.ssoma_inspecciones where id = p_id for update;
  if not found then raise exception 'Esa inspección no existe.' using errcode = 'check_violation'; end if;
  if v_ins.anulado_en is not null then
    -- El mismo pedido repetido de la misma persona (se perdió la respuesta) entra; otro no se finge.
    if v_ins.anulado_por is distinct from v_yo then
      raise exception 'Esta inspección ya estaba anulada, con este motivo: «%». No se cambia.', v_ins.motivo_anulacion
        using errcode = 'check_violation';
    end if;
    if v_ins.motivo_anulacion = v_motivo then return p_id; end if;
    raise exception 'Esta inspección ya quedó anulada la primera vez que la enviaste, con este motivo: «%». El motivo nuevo no se guardó.', v_ins.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ssoma_acciones a
               join public.ssoma_inspeccion_respuestas r on r.id = a.respuesta_id
              where r.inspeccion_id = p_id and a.estado <> 'ANULADA') then
    raise exception 'Esta inspección tiene acciones correctivas: anula primero las abiertas. Una con acciones cerradas queda como evidencia.'
      using errcode = 'check_violation';
  end if;
  update public.ssoma_inspecciones set motivo_anulacion = v_motivo, anulado_por = v_yo, anulado_en = now() where id = p_id;
  return p_id;
end;
$$;
comment on function public.ssoma_anular_inspeccion(uuid, text) is
  'SSOMA anula una inspección mal registrada con su motivo (no se borra). Con acciones correctivas vigentes no se anula. Exige ssoma.gestionar.';
revoke all on function public.ssoma_anular_inspeccion(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_inspeccion(uuid, text) to authenticated;

-- 10. Las acciones de la 15.2 saben de dónde vienen -------------------------------------------------
-- Cómo se nombra y adónde lleva una acción en los avisos: el número de su
-- reporte, o «inspección de <Área> del <día>».
create or replace function public.ssoma_origen_de_accion(p_accion uuid)
returns table (reporte uuid, inspeccion uuid, etiqueta text, ruta text)
language sql stable set search_path to 'public' rows 1 as $$
  select a.reporte_id, i.id,
         coalesce(r.numero, 'inspección de ' || ar.nombre || ' del ' || public.ssoma_dia(i.fecha)),
         case when a.reporte_id is not null then '/ssoma/' || a.reporte_id::text
              else '/ssoma/inspecciones/' || i.id::text end || '#accion-' || a.id::text
    from public.ssoma_acciones a
    left join public.ssoma_reportes r on r.id = a.reporte_id
    left join public.ssoma_inspeccion_respuestas p on p.id = a.respuesta_id
    left join public.ssoma_inspecciones i on i.id = p.inspeccion_id
    left join public.areas ar on ar.id = i.area_id
   where a.id = p_accion;
$$;
revoke all on function public.ssoma_origen_de_accion(uuid) from public, anon, authenticated;

-- Las cuatro que siguen son las de la 15.2 con dos cambios: el aviso nombra el
-- origen por `ssoma_origen_de_accion` (antes, siempre el número del reporte), y
-- lo que es del reporte (recalcular su estado, avisar a quien reportó) se hace
-- solo si la acción es de un reporte.
create or replace function public.ssoma_cerrar_accion(p_accion uuid, p_evento uuid, p_nota text, p_fotos jsonb)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_envio  constant jsonb := jsonb_build_array(p_accion, p_nota, p_fotos);
  v_acc    public.ssoma_acciones%rowtype;
  v_rep    public.ssoma_reportes%rowtype;
  v_ori    record;
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

  select * into v_ori from public.ssoma_origen_de_accion(p_accion);
  v_quien := coalesce(public.ssoma_nombre_de(v_yo), 'El responsable');
  perform public.avisar_a_permiso('ssoma.gestionar',
    'Acción cerrada con evidencia (' || v_ori.etiqueta || ')',
    v_quien || ': ' || v_nota,
    v_ori.ruta, 'ssoma_acciones', p_accion);
  if v_acc.reporte_id is not null then
    select * into v_rep from public.ssoma_reportes where id = v_acc.reporte_id;
    if public.ssoma_recalcular_reporte(v_rep.id) then
      perform public.ssoma_avisar_a(v_rep.registrado_por,
        'Tu reporte ' || v_rep.numero || ' quedó corregido',
        'Se cerraron con evidencia todas las acciones que SSOMA pidió.',
        '/ssoma/' || v_rep.id::text, 'ssoma_reportes', v_rep.id);
    end if;
  end if;
  return p_accion;
end;
$$;
comment on function public.ssoma_cerrar_accion(uuid, uuid, text, jsonb) is
  'El responsable (o SSOMA) cierra una acción correctiva con qué se hizo y de 1 a 4 fotos ya subidas; avisa a SSOMA y, si era la última de un reporte, lo cierra y avisa a quien lo reportó.';
revoke all on function public.ssoma_cerrar_accion(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.ssoma_cerrar_accion(uuid, uuid, text, jsonb) to authenticated;

create or replace function public.ssoma_reabrir_accion(p_accion uuid, p_motivo text, p_fecha_limite date)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_acc    public.ssoma_acciones%rowtype;
  v_ultimo public.ssoma_accion_eventos%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoy    date := public.ssoma_hoy();
  v_ori    record;
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
  select * into v_ori from public.ssoma_origen_de_accion(p_accion);
  if v_acc.reporte_id is not null then
    -- Cómo estaba antes de recalcularlo: si ya estaba corregido, quien reportó se entera de que volvió.
    select * into v_rep from public.ssoma_reportes where id = v_acc.reporte_id;
    perform public.ssoma_recalcular_reporte(v_acc.reporte_id);
  end if;
  perform public.ssoma_avisar_a(v_acc.responsable_id,
    'SSOMA reabrió tu acción correctiva (' || v_ori.etiqueta || '): vence el ' || public.ssoma_dia(p_fecha_limite),
    v_motivo, v_ori.ruta, 'ssoma_acciones', p_accion);
  if v_acc.reporte_id is not null and v_rep.estado = 'CERRADO' then
    perform public.ssoma_avisar_a(v_rep.registrado_por,
      'Tu reporte ' || v_rep.numero || ' volvió a corrección',
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

create or replace function public.ssoma_reasignar_accion(p_accion uuid, p_responsable uuid, p_fecha_limite date)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_acc    public.ssoma_acciones%rowtype;
  v_hoy    date := public.ssoma_hoy();
  v_ori    record;
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

  select * into v_ori from public.ssoma_origen_de_accion(p_accion);
  if p_responsable <> v_acc.responsable_id then
    perform public.ssoma_avisar_a(p_responsable,
      'Acción correctiva a tu cargo (' || v_ori.etiqueta || '): vence el ' || public.ssoma_dia(p_fecha_limite),
      v_acc.descripcion, v_ori.ruta, 'ssoma_acciones', p_accion);
    perform public.ssoma_avisar_a(v_acc.responsable_id,
      'SSOMA le pasó a otra persona tu acción correctiva (' || v_ori.etiqueta || ')',
      -- A «/ssoma»: ya no es suya, y la ficha de donde salió no se le abre.
      v_acc.descripcion, '/ssoma', 'ssoma_acciones', p_accion);
  else
    perform public.ssoma_avisar_a(p_responsable,
      'Tu acción correctiva (' || v_ori.etiqueta || ') ahora vence el ' || public.ssoma_dia(p_fecha_limite),
      v_acc.descripcion, v_ori.ruta, 'ssoma_acciones', p_accion);
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
  v_ori    record;
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

  select * into v_ori from public.ssoma_origen_de_accion(p_accion);
  perform public.ssoma_avisar_a(v_acc.responsable_id,
    'SSOMA anuló tu acción correctiva (' || v_ori.etiqueta || ')', v_motivo || ' · ' || v_acc.descripcion,
    -- A «/ssoma»: el motivo va en el aviso, y la ficha del reporte ya no se le abre sin una acción viva.
    '/ssoma', 'ssoma_acciones', p_accion);
  if v_acc.reporte_id is not null then
    select * into v_rep from public.ssoma_reportes where id = v_acc.reporte_id;
    if public.ssoma_recalcular_reporte(v_rep.id) then
      perform public.ssoma_avisar_a(v_rep.registrado_por,
        'Tu reporte ' || v_rep.numero || ' quedó corregido',
        'Se cerraron con evidencia las acciones que siguen vigentes.',
        '/ssoma/' || v_rep.id::text, 'ssoma_reportes', v_rep.id);
    end if;
  end if;
  return p_accion;
end;
$$;
comment on function public.ssoma_anular_accion(uuid, text) is
  'SSOMA anula una acción abierta con su motivo (no se borra) y avisa al responsable. Exige ssoma.gestionar.';
revoke all on function public.ssoma_anular_accion(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_accion(uuid, text) to authenticated;

-- 11. Lo que cada quien lee ------------------------------------------------------------------------
-- Las acciones que ve quien pregunta, de un reporte, de una inspección, una sola
-- o todas. Es `ssoma_acciones_visibles` de la 15.2 más las que nacen de un
-- hallazgo y de dónde viene cada una. Con otro nombre: una función no cambia de
-- columnas sin DROP, y la de la 15.2 se queda para las pestañas abiertas antes
-- del despliegue (no trae las acciones de inspección).
-- `alcance`: TODOS (SSOMA y Gerencia), RESPONSABLE (las suyas) o REPORTE (las
-- vigentes de un reporte que hizo o de su área, sin la evidencia). Las de una
-- inspección las ven solo SSOMA, Gerencia y su responsable.
create or replace function public.ssoma_acciones_a_la_vista(p_reporte uuid, p_inspeccion uuid, p_id uuid)
returns table (
  id uuid, reporte_id uuid, reporte_numero text, reporte_tipo text,
  respuesta_id uuid, inspeccion_id uuid, inspeccion_fecha date, hallazgo text,
  area text, descripcion text,
  responsable_id uuid, responsable text, responsable_puesto text, fecha_limite date, estado text,
  dias_para_vencer integer, creado_en timestamptz, asigno text, cerrado_en timestamptz, cerro text, nota_cierre text,
  fotos integer, anulado_en timestamptz, motivo_anulacion text, alcance text, orden integer)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, u.area_id, public.puede_ver_reportes_ssoma() as todo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select x.*, r.numero as rep_numero, r.tipo as rep_tipo, p.inspeccion_id as ins_id, i.fecha as ins_fecha, p.hallazgo as ins_hallazgo,
           case when yo.todo then 'TODOS' when x.responsable_id = yo.id then 'RESPONSABLE' else 'REPORTE' end as alcance
      from public.ssoma_acciones x
      left join public.ssoma_reportes r on r.id = x.reporte_id
      left join public.ssoma_inspeccion_respuestas p on p.id = x.respuesta_id
      left join public.ssoma_inspecciones i on i.id = p.inspeccion_id
      cross join yo
     where (p_reporte is null or x.reporte_id = p_reporte)
       and (p_inspeccion is null or p.inspeccion_id = p_inspeccion)
       and (p_id is null or x.id = p_id)
       and (yo.todo
            or x.responsable_id = yo.id
            or (x.estado <> 'ANULADA' and r.id is not null
                and (r.registrado_por = yo.id or (r.area_id = yo.area_id and r.estado <> 'ANULADO'))))
  )
  select v.id, v.reporte_id, v.rep_numero, v.rep_tipo,
         v.respuesta_id, v.ins_id, v.ins_fecha, v.ins_hallazgo,
         ar.nombre, v.descripcion,
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
comment on function public.ssoma_acciones_a_la_vista(uuid, uuid, uuid) is
  'Las acciones correctivas que ve quien pregunta, con su origen (un reporte o el hallazgo de una inspección): todas (SSOMA, Gerencia), las que tiene a cargo, y las vigentes de los reportes que hizo o de su área, sin la evidencia. Reemplaza a ssoma_acciones_visibles, que no trae las de inspección.';
revoke all on function public.ssoma_acciones_a_la_vista(uuid, uuid, uuid) from public, anon;
grant execute on function public.ssoma_acciones_a_la_vista(uuid, uuid, uuid) to authenticated;
comment on function public.ssoma_acciones_visibles(uuid, uuid) is
  'La de la entrega 15.2: solo las acciones de un reporte. La aplicación lee ssoma_acciones_a_la_vista (15.4), que trae también las de inspección; esta queda para las pestañas abiertas antes de ese despliegue.';

-- Las inspecciones que ve quien pregunta (una, o todas). SSOMA y Gerencia, todas
-- y enteras (alcance TODOS); quien tiene a cargo una acción de la inspección, su
-- área, su fecha y nada más (alcance RESPONSABLE): los hallazgos que le tocan
-- los da `ssoma_respuestas_de_inspeccion`.
create or replace function public.ssoma_inspecciones_a_la_vista(p_id uuid)
returns table (
  id uuid, area_id uuid, area text, fecha date, tipo text, observacion text, registro text, creado_en timestamptz,
  anulado_en timestamptz, anulo text, motivo_anulacion text,
  puntos integer, conformes integer, no_conformes integer, no_aplica integer, sin_accion integer,
  abiertas integer, vencidas integer, cerradas integer, alcance text)
language sql stable security definer set search_path to 'public' rows 100 as $$
  with yo as (
    select u.id, public.puede_ver_reportes_ssoma() as todo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  )
  select i.id, i.area_id, ar.nombre, i.fecha, i.tipo,
         case when yo.todo then i.observacion end,
         case when yo.todo then public.ssoma_nombre_de(i.creado_por) end,
         i.creado_en, i.anulado_en,
         case when yo.todo then public.ssoma_nombre_de(i.anulado_por) end,
         case when yo.todo then i.motivo_anulacion end,
         case when yo.todo then r.puntos end, case when yo.todo then r.conformes end,
         case when yo.todo then r.no_conformes end, case when yo.todo then r.no_aplica end,
         case when yo.todo then r.sin_accion end,
         case when yo.todo then c.abiertas end, case when yo.todo then c.vencidas end, case when yo.todo then c.cerradas end,
         case when yo.todo then 'TODOS' else 'RESPONSABLE' end
    from public.ssoma_inspecciones i
    join public.areas ar on ar.id = i.area_id
    cross join yo
    cross join lateral (
      select count(*)::integer as puntos,
             (count(*) filter (where p.resultado = 'CONFORME'))::integer as conformes,
             (count(*) filter (where p.resultado = 'NO_CONFORME'))::integer as no_conformes,
             (count(*) filter (where p.resultado = 'NO_APLICA'))::integer as no_aplica,
             -- El hallazgo que se quedó sin ninguna acción viva: nadie lo está corrigiendo.
             (count(*) filter (where p.resultado = 'NO_CONFORME' and not exists (
                select 1 from public.ssoma_acciones a where a.respuesta_id = p.id and a.estado <> 'ANULADA')))::integer as sin_accion
        from public.ssoma_inspeccion_respuestas p
       where p.inspeccion_id = i.id) r
    cross join lateral (
      select (count(*) filter (where a.estado = 'ABIERTA'))::integer as abiertas,
             (count(*) filter (where a.estado = 'ABIERTA' and a.fecha_limite < public.ssoma_hoy()))::integer as vencidas,
             (count(*) filter (where a.estado = 'CERRADA'))::integer as cerradas
        from public.ssoma_acciones a
        join public.ssoma_inspeccion_respuestas p on p.id = a.respuesta_id
       where p.inspeccion_id = i.id) c
   where (p_id is null or i.id = p_id)
     and (yo.todo
          or exists (select 1 from public.ssoma_acciones a
                       join public.ssoma_inspeccion_respuestas p on p.id = a.respuesta_id
                      where p.inspeccion_id = i.id and a.responsable_id = yo.id));
$$;
comment on function public.ssoma_inspecciones_a_la_vista(uuid) is
  'Las inspecciones de seguridad que ve quien pregunta: SSOMA y Gerencia, todas, con su resultado y cómo van sus acciones; quien tiene a cargo una acción de la inspección, solo el área y la fecha.';
revoke all on function public.ssoma_inspecciones_a_la_vista(uuid) from public, anon;
grant execute on function public.ssoma_inspecciones_a_la_vista(uuid) to authenticated;

-- Los puntos de una inspección con lo que se marcó. SSOMA y Gerencia, todos; el
-- responsable de una acción, solo el hallazgo que esa acción corrige.
create or replace function public.ssoma_respuestas_de_inspeccion(p_inspeccion uuid)
returns table (id uuid, orden integer, texto text, resultado text, hallazgo text)
language sql stable security definer set search_path to 'public' rows 30 as $$
  select p.id, p.orden::integer, p.texto, p.resultado, p.hallazgo
    from public.ssoma_inspeccion_respuestas p
   where p.inspeccion_id = p_inspeccion
     and (public.puede_ver_reportes_ssoma()
          or exists (select 1 from public.ssoma_acciones a
                      where a.respuesta_id = p.id and a.responsable_id = public.usuario_actual()))
   order by p.orden;
$$;
comment on function public.ssoma_respuestas_de_inspeccion(uuid) is
  'Cada punto de una inspección con su resultado y, del no conforme, lo que se encontró. SSOMA y Gerencia los ven todos; el responsable de una acción, solo su hallazgo.';
revoke all on function public.ssoma_respuestas_de_inspeccion(uuid) from public, anon;
grant execute on function public.ssoma_respuestas_de_inspeccion(uuid) to authenticated;

-- Cada área activa con cuántos puntos tiene su lista, cuándo fue su última
-- inspección vigente y cómo van las acciones que salieron de sus inspecciones.
create or replace function public.ssoma_inspecciones_por_area()
returns table (area_id uuid, area text, puntos integer, ultima_id uuid, ultima date, dias integer, abiertas integer, vencidas integer)
language sql stable security definer set search_path to 'public' rows 30 as $$
  select a.id, a.nombre,
         (select count(*)::integer from public.ssoma_lista_puntos p where p.activo and (p.area_id is null or p.area_id = a.id)),
         u.id, u.fecha, public.ssoma_hoy() - u.fecha,
         c.abiertas, c.vencidas
    from public.areas a
    left join lateral (
      select i.id, i.fecha from public.ssoma_inspecciones i
       where i.area_id = a.id and i.anulado_en is null
       order by i.fecha desc, i.creado_en desc limit 1) u on true
    cross join lateral (
      select (count(*) filter (where x.estado = 'ABIERTA'))::integer as abiertas,
             (count(*) filter (where x.estado = 'ABIERTA' and x.fecha_limite < public.ssoma_hoy()))::integer as vencidas
        from public.ssoma_acciones x
       where x.respuesta_id is not null and x.area_id = a.id) c
   where public.puede_ver_reportes_ssoma() and a.activo
   order by a.orden_secuencia, a.nombre;
$$;
comment on function public.ssoma_inspecciones_por_area() is
  'Cada área activa con los puntos de su lista de verificación, su última inspección vigente y las acciones abiertas y vencidas que salieron de sus inspecciones. Solo para SSOMA y Gerencia; a los demás, nada.';
revoke all on function public.ssoma_inspecciones_por_area() from public, anon;
grant execute on function public.ssoma_inspecciones_por_area() to authenticated;
