-- =============================================================================
-- EL TRAMITADOR Y SUS TRÁMITES
-- -----------------------------------------------------------------------------
-- StudioGRCI, 2026-11-26, plan «El puesto de Tramitador», entrega 1 de 4: «un
-- usuario para subir trámites y tener la gestión de trámites, que pueda guardar
-- todos los trámites». Hasta hoy el sistema solo sabía de un trámite su fecha
-- límite en la OT («Tarjeta de propiedad y placas», 15 días hábiles desde el
-- término) y el gasto que Administración le carga: nadie lo llevaba ni quedaba
-- guardado. Lo que StudioGRCI decidió el 2026-11-26, y nace aquí:
--
--   * EL PUESTO DE TRAMITADOR, dentro del área de Administración. Registra y
--     lleva los trámites (`tramites.gestionar`). Ve y registra solo lo suyo.
--   * QUÉ TRÁMITES: los de cada unidad (tarjeta de propiedad, placas,
--     certificados) y los de la empresa (licencias, SOAT, permisos), con un
--     CATÁLOGO DE TIPOS que el Tramitador amplía. Cada tipo dice su entidad,
--     si es de una unidad o de la empresa, si se renueva y con cuántos días de
--     anticipación se avisa su vencimiento (los avisos son la entrega 3).
--   * EL TRÁMITE (TR-0001-2026): su tipo, su entidad, qué se tramita, la unidad
--     y la OT si es de una unidad (el cliente sale de la unidad y queda
--     congelado), el número de expediente en la entidad, cuándo se presentó,
--     su fecha límite y en qué va. Está «Por iniciar», «En trámite» u
--     «Observado» por la entidad. Se concluye con su documento final, que es
--     la entrega 2 (el expediente).
--   * QUIÉN CONSULTA: Gerencia General y Administración, todos
--     (`tramites.ver`); Ventas —el Agente de Ventas y Gerencia Comercial—, solo
--     los de las unidades de los clientes (`tramites.ver_de_unidades`), para
--     decirle al cliente cómo va su tarjeta y sus placas. Los demás, ninguno.
--   * NO SE BORRA: el Tramitador pide anularlo con su motivo y GERENCIA LO
--     APRUEBA O NO (`tramites.aprobar_anulacion`). Mientras espera ese visto
--     no se toca; anulado, queda congelado como evidencia.
--
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El puesto y sus permisos ---------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('tramites.gestionar', 'Trámites',
   'Registrar los trámites de las unidades y de la empresa, llevar su estado y sus fechas, mantener el catálogo de tipos y pedir la anulación de uno'),
  ('tramites.ver', 'Trámites',
   'Consultar todos los trámites, de las unidades y de la empresa, sin registrar'),
  ('tramites.ver_de_unidades', 'Trámites',
   'Consultar los trámites de las unidades de los clientes (tarjeta de propiedad, placas, certificados), sin los de la empresa y sin registrar'),
  ('tramites.aprobar_anulacion', 'Trámites',
   'Aprobar o no la anulación de un trámite que pide quien lo lleva')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('TRAMITADOR', 'Tramitador',
   'Registra y lleva los trámites de las unidades (tarjeta de propiedad, placas, certificados) y de la empresa (licencias, SOAT, permisos)', 40, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'TRAMITADOR' and p.codigo = 'tramites.gestionar')
    or (r.codigo in ('GERENTE', 'ADMINISTRACION') and p.codigo = 'tramites.ver')
    or (r.codigo = 'GERENTE' and p.codigo = 'tramites.aprobar_anulacion')
    or (r.codigo in ('VENDEDOR', 'GERENTE_COMERCIAL') and p.codigo = 'tramites.ver_de_unidades')
on conflict do nothing;

-- 2. La serie del trámite ---------------------------------------------------------------
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'TRAMITE', '001', 'TR', 0, 4, 'TR-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'TRAMITE' and serie = '001');

-- 3. El catálogo de tipos ---------------------------------------------------------------
create table if not exists public.tramite_tipos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  -- Ante quién se hace: SUNARP, la municipalidad, la aseguradora. Es lo que se
  -- propone al registrar; cada trámite guarda la suya.
  entidad         text not null,
  ambito          text not null,
  se_renueva      boolean not null default false,
  -- Con cuántos días de anticipación se avisa el vencimiento, de más a menos
  -- (entrega 3). Cada tipo los suyos: una licencia anual pide un mes, y la
  -- tarjeta de una unidad tiene 15 días hábiles en total.
  dias_aviso      integer[] not null default '{7}',
  activo          boolean not null default true,
  creado_por      uuid default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_tramite_tipo_datos check (
    char_length(btrim(nombre)) between 3 and 80 and nombre = btrim(nombre)
    and char_length(btrim(entidad)) between 2 and 80 and entidad = btrim(entidad)
    and ambito in ('UNIDAD', 'EMPRESA')
    and cardinality(dias_aviso) between 1 and 5
    and 0 <= all (dias_aviso) and 120 >= all (dias_aviso))
);
comment on table public.tramite_tipos is
  'El catálogo de tipos de trámite: su entidad, si es de una unidad o de la empresa, si se renueva y con cuántos días se avisa su vencimiento. Lo mantiene quien lleva los trámites (tramites.gestionar) con tramites_guardar_tipo. Un tipo no se borra: se desactiva.';
-- Un nombre, un tipo, sin distinguir mayúsculas.
create unique index if not exists uq_tramite_tipos_nombre on public.tramite_tipos (lower(nombre));
select public.activar_timestamps('tramite_tipos');
select public.activar_auditoria('tramite_tipos');
select public.activar_registro_de_prueba('tramite_tipos');

-- Los tipos de partida. Los de la unidad salen de la OT («Certificados» y
-- «Tarjeta de propiedad y placas», docs/ANALISIS-ONEDRIVE.md §5) y del formato
-- MW-FOR-ADM-7, área F. Los de la empresa son los que StudioGRCI nombró. El
-- Tramitador corrige la entidad y los días de aviso, y agrega los que falten.
insert into public.tramite_tipos (nombre, entidad, ambito, se_renueva, dias_aviso, creado_por)
select t.nombre, t.entidad, t.ambito, t.se_renueva, t.dias_aviso, null
  from (values
    ('Tarjeta de propiedad',             'SUNARP',                           'UNIDAD',  false, '{5}'::integer[]),
    ('Placas',                           'Asociación Automotriz del Perú',   'UNIDAD',  false, '{5}'::integer[]),
    ('Certificados de la unidad',        'Entidad certificadora',            'UNIDAD',  false, '{5}'::integer[]),
    ('Otro trámite de una unidad',       'Por definir',                      'UNIDAD',  false, '{5}'::integer[]),
    ('Licencia de funcionamiento',       'Municipalidad',                    'EMPRESA', false, '{30,15,7}'::integer[]),
    ('Certificado de Defensa Civil (ITSE)', 'Municipalidad',                 'EMPRESA', true,  '{30,15,7}'::integer[]),
    ('SOAT',                             'Aseguradora',                      'EMPRESA', true,  '{30,15,7}'::integer[]),
    ('Revisión técnica vehicular',       'Centro de inspección técnica',     'EMPRESA', true,  '{30,15,7}'::integer[]),
    ('Permiso del MTC',                  'MTC',                              'EMPRESA', true,  '{30,15,7}'::integer[]),
    ('Otro trámite de la empresa',       'Por definir',                      'EMPRESA', false, '{30,15,7}'::integer[])
  ) as t(nombre, entidad, ambito, se_renueva, dias_aviso)
 where not exists (select 1 from public.tramite_tipos x where lower(x.nombre) = lower(t.nombre));

-- 4. El trámite ---------------------------------------------------------------------------
create table if not exists public.tramites (
  id                        uuid primary key default gen_random_uuid(),
  numero                    text not null,
  tipo_id                   uuid not null references public.tramite_tipos(id) on delete restrict,
  -- De una unidad o de la empresa: sale del tipo al registrar y queda
  -- congelado. Ventas ve solo los de una unidad, y filtra por aquí (b).
  ambito                    text not null,
  entidad                   text not null,
  asunto                    text not null,
  -- La unidad, su cliente (congelado: si la unidad cambia de dueño, el trámite
  -- sigue siendo de quien era) y su OT, si el trámite es de una unidad.
  unidad_id                 uuid references public.unidades(id) on delete restrict,
  cliente_id                uuid references public.clientes(id) on delete restrict,
  orden_id                  uuid references public.ordenes_trabajo(id) on delete restrict,
  -- El número de expediente, de título o de solicitud que le dio la entidad.
  expediente                text,
  fecha_inicio              date,
  fecha_limite              date,
  nota                      text,
  estado                    text not null default 'POR_INICIAR',
  -- La anulación la pide quien lo lleva y la aprueba Gerencia. Mientras
  -- `anulacion_pedida_en` tiene fecha y no hay rechazo, espera ese visto.
  anulacion_pedida_por      uuid references public.usuarios(id) on delete restrict,
  anulacion_pedida_en       timestamptz,
  motivo_anulacion          text,
  anulacion_rechazada_por   uuid references public.usuarios(id) on delete restrict,
  anulacion_rechazada_en    timestamptz,
  anulacion_rechazo_motivo  text,
  anulado_por               uuid references public.usuarios(id) on delete restrict,
  anulado_en                timestamptz,
  registrado_por            uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  constraint uq_tramites_numero unique (numero),
  constraint ck_tramite_datos check (
    ambito in ('UNIDAD', 'EMPRESA')
    and char_length(btrim(entidad)) between 2 and 80
    and char_length(btrim(asunto)) between 5 and 300
    and (expediente is null or char_length(expediente) between 1 and 60)
    and (nota is null or char_length(nota) between 1 and 1000)
    and (fecha_inicio is null or fecha_limite is null or fecha_limite >= fecha_inicio)),
  -- El de una unidad nombra su unidad; el de la empresa, ni unidad ni OT.
  constraint ck_tramite_ambito check (
    (ambito = 'UNIDAD' and unidad_id is not null)
    or (ambito = 'EMPRESA' and unidad_id is null and cliente_id is null and orden_id is null)),
  constraint ck_tramite_estado check (
    (estado = 'POR_INICIAR' and fecha_inicio is null)
    or (estado = 'EN_TRAMITE' and fecha_inicio is not null)
    -- Observado por la entidad: la nota dice qué observó.
    or (estado = 'OBSERVADO' and fecha_inicio is not null and char_length(btrim(coalesce(nota, ''))) >= 5)
    or estado = 'ANULADO'),
  constraint ck_tramite_anulacion check (
    (anulacion_pedida_en is null) = (anulacion_pedida_por is null)
    and (anulacion_pedida_en is null) = (motivo_anulacion is null)
    and (motivo_anulacion is null or char_length(btrim(motivo_anulacion)) between 10 and 500)
    and ((anulacion_rechazada_en is null and anulacion_rechazada_por is null and anulacion_rechazo_motivo is null)
         or (anulacion_rechazada_en is not null and anulacion_rechazada_por is not null and anulacion_pedida_en is not null
             and char_length(btrim(coalesce(anulacion_rechazo_motivo, ''))) between 10 and 500))
    and ((estado = 'ANULADO' and anulado_en is not null and anulado_por is not null
          and anulacion_pedida_en is not null and anulacion_rechazada_en is null)
         or (estado <> 'ANULADO' and anulado_en is null and anulado_por is null)))
);
comment on table public.tramites is
  'El trámite de una unidad o de la empresa (TR-…): su tipo, su entidad, qué se tramita, su expediente, cuándo se presentó, su fecha límite y en qué va. Lo registra y lo lleva el Tramitador (tramites.gestionar); lo consultan Gerencia y Administración (tramites.ver) y, los de una unidad, Ventas (tramites.ver_de_unidades). No se borra: quien lo lleva pide anularlo con su motivo y Gerencia lo aprueba (tramites.aprobar_anulacion).';
comment on column public.tramites.cliente_id is
  'El cliente de la unidad cuando se registró el trámite, congelado.';
comment on column public.tramites.fecha_limite is
  'Hasta cuándo debe quedar el trámite. Pasada esa fecha y sin anular, está vencido.';
-- La lista se lee de la más reciente a la más vieja (b).
create index if not exists ix_tramites_creado on public.tramites (creado_en desc);
-- Los trámites de una unidad y los de una OT (b); sirven también a sus llaves.
create index if not exists ix_tramites_unidad on public.tramites (unidad_id) where unidad_id is not null;
create index if not exists ix_tramites_orden on public.tramites (orden_id) where orden_id is not null;
-- Lo que vence: los vivos por su fecha límite (b), para la lista y los avisos de la entrega 3.
create index if not exists ix_tramites_limite on public.tramites (fecha_limite) where fecha_limite is not null and estado <> 'ANULADO';
select public.activar_timestamps('tramites');
select public.activar_auditoria('tramites');
select public.activar_registro_de_prueba('tramites');

-- 5. Lo que no se borra ni se corrige por debajo ----------------------------------------
create or replace function public.fn_tramite_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Lo que fija quien registra: no cambia nunca.
  v_fijo     constant text[] := array['id', 'numero', 'tipo_id', 'ambito', 'unidad_id', 'cliente_id', 'orden_id', 'registrado_por', 'creado_en'];
  -- Lo único que cambia mientras espera el visto de Gerencia: su respuesta.
  v_respuesta constant text[] := array['estado', 'anulado_por', 'anulado_en', 'anulacion_rechazada_por', 'anulacion_rechazada_en',
                                       'anulacion_rechazo_motivo', 'actualizado_en'];
  v_esperaba boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Un trámite no se borra: se pide su anulación con el motivo y Gerencia la aprueba.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_fijo) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_fijo) k) then
    raise exception 'El número, el tipo, la unidad y la OT del trámite % no se corrigen: si están mal, se pide su anulación y se registra de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  v_esperaba := old.anulacion_pedida_en is not null and old.anulacion_rechazada_en is null;
  if v_esperaba and (to_jsonb(new) - v_respuesta) is distinct from (to_jsonb(old) - v_respuesta) then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', old.numero
      using errcode = 'check_violation';
  end if;
  -- Quién y cuándo los pone la base, venga de donde venga el UPDATE.
  if (new.anulacion_pedida_por, new.anulacion_pedida_en, new.motivo_anulacion)
     is distinct from (old.anulacion_pedida_por, old.anulacion_pedida_en, old.motivo_anulacion) then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para pedir la anulación del trámite % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulacion_pedida_por := coalesce(public.usuario_actual(), new.anulacion_pedida_por);
    new.anulacion_pedida_en := now();
    -- Un pedido nuevo deja atrás la respuesta del anterior.
    new.anulacion_rechazada_por := null;
    new.anulacion_rechazada_en := null;
    new.anulacion_rechazo_motivo := null;
  elsif new.anulacion_rechazada_en is distinct from old.anulacion_rechazada_en
        or new.anulacion_rechazada_por is distinct from old.anulacion_rechazada_por
        or new.anulacion_rechazo_motivo is distinct from old.anulacion_rechazo_motivo then
    if not v_esperaba or new.estado = 'ANULADO' then
      raise exception 'El trámite % no espera el visto de Gerencia: no hay anulación que rechazar.', old.numero using errcode = 'check_violation';
    end if;
    if char_length(btrim(coalesce(new.anulacion_rechazo_motivo, ''))) < 10 then
      raise exception 'Para no aprobar la anulación del trámite % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.anulacion_rechazo_motivo := btrim(new.anulacion_rechazo_motivo);
    new.anulacion_rechazada_por := coalesce(public.usuario_actual(), new.anulacion_rechazada_por);
    new.anulacion_rechazada_en := now();
  end if;
  if new.estado = 'ANULADO' then
    if not v_esperaba then
      raise exception 'El trámite % se anula solo con el motivo de quien lo lleva y el visto de Gerencia.', old.numero using errcode = 'check_violation';
    end if;
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en) is distinct from (old.anulado_por, old.anulado_en) then
    raise exception 'El trámite % no está anulado: quién y cuándo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_tramite_guardia() from public, anon, authenticated;
create or replace trigger trg_tramite_guardia
  before update or delete on public.tramites
  for each row execute function public.fn_tramite_guardia();

-- Un tipo no se borra: hay trámites que lo nombran. Se desactiva.
create or replace function public.fn_tramite_tipo_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Un tipo de trámite no se borra: se desactiva, y deja de ofrecerse al registrar.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_tramite_tipo_guardia() from public, anon, authenticated;
create or replace trigger trg_tramite_tipo_guardia
  before delete on public.tramite_tipos
  for each row execute function public.fn_tramite_tipo_guardia();

-- 6. Quién ve qué -----------------------------------------------------------------------
-- Nunca devuelven null: `tramites_visibles` corta con `if not …`, y un null ahí
-- no corta (le pasó a Garantías con un área sin responsable).
create or replace function public.tramites_ve_todos()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    public.usuario_actual() is not null and public.es_usuario_activo()
     and (public.es_admin() or public.tiene_permiso('tramites.gestionar') or public.tiene_permiso('tramites.ver')),
    false);
$$;
revoke all on function public.tramites_ve_todos() from public, anon;
grant execute on function public.tramites_ve_todos() to authenticated;

-- Ventas: solo los de una unidad.
create or replace function public.tramites_ve_los_de_unidades()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    public.usuario_actual() is not null and public.es_usuario_activo() and public.tiene_permiso('tramites.ver_de_unidades'),
    false);
$$;
revoke all on function public.tramites_ve_los_de_unidades() from public, anon;
grant execute on function public.tramites_ve_los_de_unidades() to authenticated;

alter table public.tramites enable row level security;
alter table public.tramite_tipos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tramites' and policyname = 'ver_tramites') then
    create policy ver_tramites on public.tramites for select to authenticated
      using ((select public.tramites_ve_todos())
             or (ambito = 'UNIDAD' and (select public.tramites_ve_los_de_unidades())));
  end if;
  -- El catálogo lo lee quien ve algún trámite: Ventas, solo los tipos de una unidad.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tramite_tipos' and policyname = 'ver_tramite_tipos') then
    create policy ver_tramite_tipos on public.tramite_tipos for select to authenticated
      using ((select public.tramites_ve_todos())
             or (ambito = 'UNIDAD' and (select public.tramites_ve_los_de_unidades())));
  end if;
end $$;
-- La auditoría copia la fila entera: se lee con lo mismo que el trámite, no
-- solo con `auditoria.ver`. Restrictiva, como la de los reclamos de garantía.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'tramites_con_su_permiso') then
    create policy tramites_con_su_permiso on public.audit_log as restrictive for select to authenticated
      using (tabla <> 'tramites' or (select public.tramites_ve_todos()));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo: sin políticas de escritura ni grant.
revoke all on public.tramites from public, anon, authenticated;
revoke all on public.tramite_tipos from public, anon, authenticated;
grant select on public.tramites to authenticated;
grant select on public.tramite_tipos to authenticated;

-- 7. El catálogo: dar de alta un tipo o corregirlo ----------------------------------------
-- p_dias_aviso: [30, 15, 7]. Con un id que ya existe corrige ese tipo; con uno
-- nuevo, lo da de alta. Si el tipo ya tiene trámites, no cambia de «unidad» a
-- «empresa»: sus trámites quedarían con una unidad que el tipo ya no admite.
create or replace function public.tramites_guardar_tipo(
  p_id uuid, p_nombre text, p_entidad text, p_ambito text, p_se_renueva boolean, p_dias_aviso jsonb, p_activo boolean
) returns table (tipo uuid, creado boolean)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_nombre  text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_entidad text := btrim(regexp_replace(coalesce(p_entidad, ''), '\s+', ' ', 'g'));
  v_dias    integer[];
  v_actual  public.tramite_tipos%rowtype;
  v_otro    text;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para cambiar los tipos de trámite.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del tipo.' using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 3 and 80 then
    raise exception 'Escribe el nombre del tipo de trámite, en 3 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_entidad) not between 2 and 80 then
    raise exception 'Escribe ante qué entidad se hace, en 2 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if p_ambito is null or p_ambito not in ('UNIDAD', 'EMPRESA') then
    raise exception 'Elige si el trámite es de una unidad o de la empresa.' using errcode = 'check_violation';
  end if;
  if p_dias_aviso is null or jsonb_typeof(p_dias_aviso) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_dias_aviso) d
                 where jsonb_typeof(d) <> 'number' or (d #>> '{}') !~ '^[0-9]{1,3}$' or (d #>> '{}')::integer > 120) then
    raise exception 'Los días de aviso van en números enteros de 0 a 120.' using errcode = 'check_violation';
  end if;
  -- De más a menos y sin repetir: así se leen y así se avisan.
  select coalesce(array_agg(x.d order by x.d desc), '{}') into v_dias
    from (select distinct (d #>> '{}')::integer as d from jsonb_array_elements(p_dias_aviso) d) x;
  if cardinality(v_dias) not between 1 and 5 then
    raise exception 'Pon de 1 a 5 avisos antes del vencimiento.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tramites_guardar_tipo:' || lower(v_nombre), 0));
  select t.nombre into v_otro from public.tramite_tipos t where lower(t.nombre) = lower(v_nombre) and t.id <> p_id;
  if v_otro is not null then
    raise exception 'Ya hay un tipo de trámite «%»: corrige ese en vez de crear otro.', v_otro using errcode = 'unique_violation';
  end if;

  select * into v_actual from public.tramite_tipos where id = p_id for update;
  if not found then
    insert into public.tramite_tipos (id, nombre, entidad, ambito, se_renueva, dias_aviso, activo, creado_por)
    values (p_id, v_nombre, v_entidad, p_ambito, coalesce(p_se_renueva, false), v_dias, coalesce(p_activo, true), v_yo);
    return query select p_id, true;
    return;
  end if;
  if v_actual.ambito <> p_ambito and exists (select 1 from public.tramites x where x.tipo_id = p_id) then
    raise exception 'El tipo «%» ya tiene trámites registrados: no cambia de % a %. Crea otro tipo.', v_actual.nombre,
      case v_actual.ambito when 'UNIDAD' then 'unidad' else 'empresa' end,
      case p_ambito when 'UNIDAD' then 'unidad' else 'empresa' end
      using errcode = 'check_violation';
  end if;
  update public.tramite_tipos
     set nombre = v_nombre, entidad = v_entidad, ambito = p_ambito, se_renueva = coalesce(p_se_renueva, false),
         dias_aviso = v_dias, activo = coalesce(p_activo, true)
   where id = p_id
     and (nombre, entidad, ambito, se_renueva, dias_aviso, activo)
         is distinct from (v_nombre, v_entidad, p_ambito, coalesce(p_se_renueva, false), v_dias, coalesce(p_activo, true));
  return query select p_id, false;
end;
$$;
comment on function public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean) is
  'Quien lleva los trámites (tramites.gestionar) da de alta un tipo de trámite o lo corrige: nombre, entidad, si es de una unidad o de la empresa, si se renueva, los días de aviso y si sigue en uso.';
revoke all on function public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean) from public, anon;
grant execute on function public.tramites_guardar_tipo(uuid, text, text, text, boolean, jsonb, boolean) to authenticated;

-- 8. Las unidades para elegir -------------------------------------------------------------
-- Quien lleva los trámites no lee clientes, unidades ni órdenes con su permiso:
-- de aquí sale solo lo que hace falta para reconocer la unidad, con su cliente
-- y sus OT sin anular, la más reciente primero.
create or replace function public.tramites_unidades_para_elegir()
returns table (id uuid, placa text, codigo_interno text, carroceria text, marca text, cliente text, ordenes jsonb)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para registrar trámites.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.placa::text, u.codigo_interno::text, tc.nombre::text, u.marca::text, c.razon_social::text,
           coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero::text, 'estado', o.estado::text)
                                      order by o.creado_en desc)
                       from public.ordenes_trabajo o
                      where o.unidad_id = u.id and o.estado <> 'ANULADA'), '[]'::jsonb)
      from public.unidades u
      left join public.clientes c on c.id = u.cliente_id
      left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
     where u.activo
     order by c.razon_social nulls last, u.placa nulls last, u.codigo_interno nulls last;
end;
$$;
comment on function public.tramites_unidades_para_elegir() is
  'Las unidades activas con su cliente y sus OT sin anular, para elegir de cuál es el trámite. Exige tramites.gestionar.';
revoke all on function public.tramites_unidades_para_elegir() from public, anon;
grant execute on function public.tramites_unidades_para_elegir() to authenticated;

-- 9. Registrar ----------------------------------------------------------------------------
-- Un reintento con el mismo p_id y lo mismo devuelve el trámite que ya entró;
-- con otra cosa, dice que ya quedó. Sin fecha de inicio nace «Por iniciar»;
-- con ella, «En trámite».
create or replace function public.tramites_registrar(
  p_id uuid, p_tipo uuid, p_unidad uuid, p_orden uuid, p_asunto text, p_entidad text, p_expediente text,
  p_fecha_inicio date, p_fecha_limite date, p_nota text
) returns table (tramite uuid, numero_tramite text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_tipo, p_unidad, p_orden, p_asunto, p_entidad, p_expediente, p_fecha_inicio, p_fecha_limite, p_nota);
  v_hoy     constant date := (now() at time zone 'America/Lima')::date;
  v_asunto  text := btrim(regexp_replace(coalesce(p_asunto, ''), '\s+', ' ', 'g'));
  v_entidad text := nullif(btrim(regexp_replace(coalesce(p_entidad, ''), '\s+', ' ', 'g')), '');
  v_exp     text := nullif(btrim(coalesce(p_expediente, '')), '');
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_actual  public.tramites%rowtype;
  v_tipo    public.tramite_tipos%rowtype;
  v_unidad  public.unidades%rowtype;
  v_orden   public.ordenes_trabajo%rowtype;
  v_numero  text;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para registrar trámites.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del trámite.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tramites_registrar:' || p_id::text, 0));
  select * into v_actual from public.tramites where id = p_id;
  if found then
    if v_actual.registrado_por = v_yo and public.mismo_envio(p_id, 'TRAMITE', v_envio) then
      return query select v_actual.id, v_actual.numero;
      return;
    end if;
    if v_actual.registrado_por = v_yo then
      raise exception 'El trámite % ya quedó registrado la primera vez que lo enviaste: lo que cambiaste después no se guardó. Corrígelo desde su ficha.', v_actual.numero
        using errcode = 'check_violation';
    end if;
    raise exception 'Ese trámite ya existe con otros datos: vuelve a abrir el formulario.' using errcode = 'unique_violation';
  end if;

  select * into v_tipo from public.tramite_tipos where id = p_tipo;
  if not found or not v_tipo.activo then
    raise exception 'Elige el tipo de trámite de la lista: si no está, agrégalo en «Tipos de trámite».' using errcode = 'check_violation';
  end if;
  if v_tipo.ambito = 'UNIDAD' then
    select * into v_unidad from public.unidades where id = p_unidad;
    if not found or not v_unidad.activo then
      raise exception '«%» es el trámite de una unidad: elige la unidad de la lista.', v_tipo.nombre using errcode = 'check_violation';
    end if;
    if p_orden is not null then
      select * into v_orden from public.ordenes_trabajo where id = p_orden;
      if not found or v_orden.estado = 'ANULADA' or v_orden.unidad_id is distinct from p_unidad then
        raise exception 'Elige una OT de esa unidad que no esté anulada, o deja el trámite sin OT.' using errcode = 'check_violation';
      end if;
    end if;
  elsif p_unidad is not null or p_orden is not null then
    raise exception '«%» es un trámite de la empresa: no lleva unidad ni OT.', v_tipo.nombre using errcode = 'check_violation';
  end if;
  if char_length(v_asunto) not between 5 and 300 then
    raise exception 'Escribe qué se tramita, en 5 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  v_entidad := coalesce(v_entidad, v_tipo.entidad);
  if char_length(v_entidad) not between 2 and 80 then
    raise exception 'Escribe ante qué entidad se hace, en 2 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_exp, '')) > 60 then
    raise exception 'El número de expediente pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_inicio > v_hoy then
    raise exception 'La fecha en que se presentó no puede ser futura: si todavía no se presenta, déjala vacía y queda «Por iniciar».' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_limite is not null and p_fecha_limite < p_fecha_inicio then
    raise exception 'La fecha límite no puede ser anterior a la fecha en que se presentó.' using errcode = 'check_violation';
  end if;

  v_numero := public.siguiente_correlativo('TRAMITE', '001', null);
  insert into public.tramites (id, numero, tipo_id, ambito, entidad, asunto, unidad_id, cliente_id, orden_id, expediente,
                               fecha_inicio, fecha_limite, nota, estado, registrado_por)
  values (p_id, v_numero, p_tipo, v_tipo.ambito, v_entidad, v_asunto,
          case when v_tipo.ambito = 'UNIDAD' then p_unidad end,
          case when v_tipo.ambito = 'UNIDAD' then v_unidad.cliente_id end,
          case when v_tipo.ambito = 'UNIDAD' then p_orden end,
          v_exp, p_fecha_inicio, p_fecha_limite, v_nota,
          case when p_fecha_inicio is null then 'POR_INICIAR' else 'EN_TRAMITE' end, v_yo);
  perform public.anotar_envio(p_id, 'TRAMITE', v_envio);
  return query select p_id, v_numero;
end;
$$;
comment on function public.tramites_registrar(uuid, uuid, uuid, uuid, text, text, text, date, date, text) is
  'Quien lleva los trámites (tramites.gestionar) registra uno, de una unidad (con su OT, si la tiene) o de la empresa; da el número TR-…. Sin fecha de inicio nace «Por iniciar»; con ella, «En trámite».';
revoke all on function public.tramites_registrar(uuid, uuid, uuid, uuid, text, text, text, date, date, text) from public, anon;
grant execute on function public.tramites_registrar(uuid, uuid, uuid, uuid, text, text, text, date, date, text) to authenticated;

-- 10. Llevarlo: en qué va, sus fechas, su expediente ------------------------------------------
-- Lo mismo otra vez no cambia nada. No toca el tipo, la unidad ni la OT.
create or replace function public.tramites_actualizar(
  p_id uuid, p_estado text, p_asunto text, p_entidad text, p_expediente text, p_fecha_inicio date, p_fecha_limite date, p_nota text
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     constant date := (now() at time zone 'America/Lima')::date;
  v_asunto  text := btrim(regexp_replace(coalesce(p_asunto, ''), '\s+', ' ', 'g'));
  v_entidad text := btrim(regexp_replace(coalesce(p_entidad, ''), '\s+', ' ', 'g'));
  v_exp     text := nullif(btrim(coalesce(p_expediente, '')), '');
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_t       public.tramites%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_t from public.tramites where id = p_id for update;
  if not found then raise exception 'Ese trámite no existe.' using errcode = 'check_violation'; end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  if p_estado is null or p_estado not in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') then
    raise exception 'Elige en qué va el trámite: por iniciar, en trámite u observado.' using errcode = 'check_violation';
  end if;
  if char_length(v_asunto) not between 5 and 300 then
    raise exception 'Escribe qué se tramita, en 5 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_entidad) not between 2 and 80 then
    raise exception 'Escribe ante qué entidad se hace, en 2 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_exp, '')) > 60 then
    raise exception 'El número de expediente pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if p_estado = 'POR_INICIAR' and p_fecha_inicio is not null then
    raise exception 'Un trámite por iniciar no lleva la fecha en que se presentó: quítala, o ponlo «En trámite».' using errcode = 'check_violation';
  end if;
  if p_estado <> 'POR_INICIAR' and p_fecha_inicio is null then
    raise exception 'Pon la fecha en que se presentó el trámite.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_inicio > v_hoy then
    raise exception 'La fecha en que se presentó no puede ser futura.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_limite is not null and p_fecha_limite < p_fecha_inicio then
    raise exception 'La fecha límite no puede ser anterior a la fecha en que se presentó.' using errcode = 'check_violation';
  end if;
  if p_estado = 'OBSERVADO' and char_length(coalesce(v_nota, '')) < 5 then
    raise exception 'Cuenta en la nota qué observó la entidad.' using errcode = 'check_violation';
  end if;

  update public.tramites
     set estado = p_estado, asunto = v_asunto, entidad = v_entidad, expediente = v_exp,
         fecha_inicio = p_fecha_inicio, fecha_limite = p_fecha_limite, nota = v_nota
   where id = p_id
     and (estado, asunto, entidad, expediente, fecha_inicio, fecha_limite, nota)
         is distinct from (p_estado, v_asunto, v_entidad, v_exp, p_fecha_inicio, p_fecha_limite, v_nota);
  return p_id;
end;
$$;
comment on function public.tramites_actualizar(uuid, text, text, text, text, date, date, text) is
  'Quien lleva los trámites (tramites.gestionar) anota en qué va uno: por iniciar, en trámite u observado, con su asunto, su entidad, su expediente, sus fechas y su nota. No toca el tipo, la unidad ni la OT. No vale sobre uno anulado ni sobre uno que espera el visto de Gerencia.';
revoke all on function public.tramites_actualizar(uuid, text, text, text, text, date, date, text) from public, anon;
grant execute on function public.tramites_actualizar(uuid, text, text, text, text, date, date, text) to authenticated;

-- 11. Pedir la anulación ----------------------------------------------------------------------
-- La pide quien lo lleva, con su motivo; la aprueba Gerencia. Le llega a quien
-- aprueba; si ninguna cuenta activa puede aprobar, la función lo dice en vez de
-- dejar el pedido esperando a nadie.
create or replace function public.tramites_pedir_anulacion(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_t      public.tramites%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para pedir la anulación de un trámite.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = p_id for update;
  if not found then raise exception 'Ese trámite no existe.' using errcode = 'check_violation'; end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % ya está anulado.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    -- El mismo pedido repetido (se perdió la respuesta) entra.
    if v_t.motivo_anulacion = v_motivo and v_t.anulacion_pedida_por = v_yo then
      return p_id;
    end if;
    raise exception 'El trámite % ya espera el visto de Gerencia para anularse, con este motivo: «%».', v_t.numero, v_t.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  -- Las mismas cuentas a las que `avisar_a_permiso` les escribe.
  if not exists (select 1 from public.usuarios u
                  where u.activo and u.id <> v_yo
                    and exists (select 1 from public.roles_permisos rp
                                 where rp.rol_id = u.rol_id and rp.permiso_codigo = 'tramites.aprobar_anulacion')) then
    raise exception 'No hay una cuenta activa que apruebe la anulación del trámite %: avisa al administrador del sistema.', v_t.numero
      using errcode = 'check_violation';
  end if;

  update public.tramites
     set anulacion_pedida_por = v_yo, anulacion_pedida_en = now(), motivo_anulacion = v_motivo
   where id = p_id;
  perform public.avisar_a_permiso('tramites.aprobar_anulacion',
    'Anulación por aprobar: trámite ' || v_t.numero || ' · ' || v_t.asunto, v_motivo,
    '/tramites/' || p_id::text, 'tramites', p_id);
  return p_id;
end;
$$;
comment on function public.tramites_pedir_anulacion(uuid, text) is
  'Quien lleva los trámites (tramites.gestionar) pide anular uno, con su motivo. Queda esperando el visto de quien aprueba (tramites.aprobar_anulacion), a quien le llega el aviso.';
revoke all on function public.tramites_pedir_anulacion(uuid, text) from public, anon;
grant execute on function public.tramites_pedir_anulacion(uuid, text) to authenticated;

-- 12. Gerencia responde ---------------------------------------------------------------------------
-- p_aprobar: lo anula. Si no, dice por qué y el trámite sigue como estaba.
create or replace function public.tramites_resolver_anulacion(p_id uuid, p_aprobar boolean, p_motivo text)
returns table (tramite uuid, anulado boolean)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_t      public.tramites%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.aprobar_anulacion')) then
    raise exception 'No tienes permiso para aprobar la anulación de un trámite.' using errcode = 'insufficient_privilege';
  end if;
  if p_aprobar is null then
    raise exception 'Elige si apruebas la anulación o no.' using errcode = 'check_violation';
  end if;
  if not p_aprobar and char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué no se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = p_id for update;
  if not found then raise exception 'Ese trámite no existe.' using errcode = 'check_violation'; end if;
  -- La misma respuesta repetida (se perdió la primera) entra.
  if p_aprobar and v_t.estado = 'ANULADO' and v_t.anulado_por = v_yo then
    return query select p_id, true;
    return;
  end if;
  if not p_aprobar and v_t.estado <> 'ANULADO' and v_t.anulacion_rechazada_en is not null
     and v_t.anulacion_rechazada_por = v_yo and v_t.anulacion_rechazo_motivo = v_motivo then
    return query select p_id, false;
    return;
  end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % ya está anulado.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is null or v_t.anulacion_rechazada_en is not null then
    raise exception 'El trámite % no espera tu visto: nadie pidió anularlo, o ya se respondió.', v_t.numero using errcode = 'check_violation';
  end if;

  if p_aprobar then
    update public.tramites set estado = 'ANULADO', anulado_por = v_yo, anulado_en = now() where id = p_id;
  else
    update public.tramites
       set anulacion_rechazada_por = v_yo, anulacion_rechazada_en = now(), anulacion_rechazo_motivo = v_motivo
     where id = p_id;
  end if;
  if v_t.anulacion_pedida_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_t.anulacion_pedida_por,
            left(case when p_aprobar then 'Se anuló el trámite ' else 'No se aprobó anular el trámite ' end || v_t.numero || ' · ' || v_t.asunto, 200),
            left(case when p_aprobar then v_t.motivo_anulacion else v_motivo end, 500),
            '/tramites/' || p_id::text, 'tramites', p_id);
  end if;
  return query select p_id, p_aprobar;
end;
$$;
comment on function public.tramites_resolver_anulacion(uuid, boolean, text) is
  'Quien aprueba (tramites.aprobar_anulacion) responde al pedido de anular un trámite: lo anula, o dice por qué no y el trámite sigue como estaba. Avisa a quien lo pidió.';
revoke all on function public.tramites_resolver_anulacion(uuid, boolean, text) from public, anon;
grant execute on function public.tramites_resolver_anulacion(uuid, boolean, text) to authenticated;

-- 13. Lo que cada quien lee ---------------------------------------------------------------------
-- Una sola lectura para la lista (p_id vacío) y la ficha, con el tipo, la
-- unidad, el cliente y la OT: quien ve los trámites no siempre lee esas tablas.
-- `situacion` es el estado, o POR_ANULAR mientras espera el visto de Gerencia.
-- Los días se cuentan con la fecha de Lima. Los `puede_*` repiten la regla de
-- cada función que escribe, para que la pantalla no ofrezca lo que la base va a
-- rechazar.
create or replace function public.tramites_visibles(p_id uuid)
returns table (
  id uuid, numero text, estado text, situacion text, creado_en timestamptz, actualizado_en timestamptz,
  tipo_id uuid, tipo text, se_renueva boolean, ambito text, entidad text, asunto text, expediente text,
  fecha_inicio date, fecha_limite date, dias_para_limite integer, vencido boolean, nota text,
  unidad_id uuid, placa text, codigo_interno text, carroceria text, cliente text,
  orden_id uuid, orden_numero text,
  registro text, registro_puesto text,
  anulacion_pedida_en timestamptz, anulacion_pidio text, motivo_anulacion text,
  anulacion_rechazada_en timestamptz, anulacion_rechazo text, anulacion_rechazo_motivo text,
  anulado_en timestamptz, anulo text,
  puede_actualizar boolean, puede_pedir_anulacion boolean, puede_resolver_anulacion boolean)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
#variable_conflict use_column
declare
  v_todos    boolean := public.tramites_ve_todos();
  v_unidades boolean := public.tramites_ve_los_de_unidades();
  v_gestiona boolean;
  v_aprueba  boolean;
  v_hoy      constant date := (now() at time zone 'America/Lima')::date;
begin
  if not (v_todos or v_unidades) then
    return;
  end if;
  v_gestiona := public.es_admin() or public.tiene_permiso('tramites.gestionar');
  v_aprueba  := public.es_admin() or public.tiene_permiso('tramites.aprobar_anulacion');
  return query
  with base as (
    select t.*,
           (t.estado <> 'ANULADO' and t.anulacion_pedida_en is not null and t.anulacion_rechazada_en is null) as espera_visto
      from public.tramites t
     where (p_id is null or t.id = p_id)
       and (v_todos or t.ambito = 'UNIDAD')
  )
  select b.id, b.numero, b.estado, case when b.espera_visto then 'POR_ANULAR' else b.estado end,
         b.creado_en, b.actualizado_en,
         b.tipo_id, tt.nombre, tt.se_renueva, b.ambito, b.entidad, b.asunto, b.expediente,
         b.fecha_inicio, b.fecha_limite,
         case when b.estado <> 'ANULADO' and b.fecha_limite is not null then b.fecha_limite - v_hoy end,
         b.estado <> 'ANULADO' and b.fecha_limite is not null and b.fecha_limite < v_hoy,
         b.nota,
         b.unidad_id, u.placa::text, u.codigo_interno::text, tc.nombre::text, c.razon_social::text,
         b.orden_id, o.numero::text,
         btrim(re.nombres || ' ' || re.apellidos), rre.nombre::text,
         b.anulacion_pedida_en, btrim(pi.nombres || ' ' || pi.apellidos), b.motivo_anulacion,
         b.anulacion_rechazada_en, btrim(rz.nombres || ' ' || rz.apellidos), b.anulacion_rechazo_motivo,
         b.anulado_en, btrim(an.nombres || ' ' || an.apellidos),
         v_gestiona and b.estado <> 'ANULADO' and not b.espera_visto,
         v_gestiona and b.estado <> 'ANULADO' and not b.espera_visto,
         v_aprueba and b.espera_visto
    from base b
    join public.tramite_tipos tt on tt.id = b.tipo_id
    left join public.unidades u on u.id = b.unidad_id
    left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
    left join public.clientes c on c.id = b.cliente_id
    left join public.ordenes_trabajo o on o.id = b.orden_id
    join public.usuarios re on re.id = b.registrado_por
    left join public.roles rre on rre.id = re.rol_id
    left join public.usuarios pi on pi.id = b.anulacion_pedida_por
    left join public.usuarios rz on rz.id = b.anulacion_rechazada_por
    left join public.usuarios an on an.id = b.anulado_por
   order by b.creado_en desc, b.numero desc;
end;
$$;
comment on function public.tramites_visibles(uuid) is
  'Los trámites (uno, o todos con p_id vacío) para quien puede verlos —todos, o solo los de una unidad para Ventas—, con su tipo, su unidad, su cliente, su OT, los días que faltan para su fecha límite (con la fecha de Lima) y lo que quien pregunta puede hacer en cada uno.';
revoke all on function public.tramites_visibles(uuid) from public, anon;
grant execute on function public.tramites_visibles(uuid) to authenticated;
