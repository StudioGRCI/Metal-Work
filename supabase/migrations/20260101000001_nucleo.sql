-- =============================================================================
-- 0001 · NÚCLEO DEL SISTEMA
-- Metal-Work · Gestión de órdenes de trabajo para fabricación de carrocerías
-- -----------------------------------------------------------------------------
-- Contiene la base compartida por todos los módulos:
--   · extensiones y dominios de datos
--   · empresa y sedes (talleres)
--   · usuarios, roles y permisos
--   · series documentarias con correlativos
--   · auditoría genérica y timestamps automáticos
--   · helpers de autorización usados por las políticas RLS
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";
create extension if not exists "pg_trgm";

-- -----------------------------------------------------------------------------
-- Dominios de datos reutilizables
-- -----------------------------------------------------------------------------

-- Importes monetarios: 2 decimales, nunca negativos por defecto en catálogos.
create domain public.monto as numeric(14, 2);

-- Cantidades de almacén: 4 decimales (kg de plancha, metros de perfil, litros).
create domain public.cantidad as numeric(14, 4);

-- Porcentajes 0..100
create domain public.porcentaje as numeric(6, 2)
  check (value >= 0 and value <= 100);

create domain public.ruc as text
  check (value ~ '^[0-9]{11}$');

create domain public.dni as text
  check (value ~ '^[0-9]{8}$');

-- Placa peruana: 3 caracteres + guion opcional + 3 caracteres (ABC-123, A1B-234)
create domain public.placa as text
  check (value ~ '^[A-Z0-9]{3}-?[A-Z0-9]{3}$');

create domain public.email as text
  check (value ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- -----------------------------------------------------------------------------
-- Enums globales
-- -----------------------------------------------------------------------------

create type public.moneda as enum ('PEN', 'USD');

create type public.accion_auditoria as enum ('INSERT', 'UPDATE', 'DELETE');

-- Tipos de documento que llevan correlativo propio dentro del sistema.
create type public.tipo_correlativo as enum (
  'COTIZACION',
  'ORDEN_TRABAJO',
  'REQUERIMIENTO',
  'ORDEN_COMPRA',
  'INGRESO_ALMACEN',
  'SALIDA_ALMACEN',
  'DEVOLUCION_ALMACEN',
  'AJUSTE_INVENTARIO',
  'PARTE_DIARIO',
  'ACTA_CONFORMIDAD',
  'INSPECCION_CALIDAD',
  'TRANSFERENCIA_ALMACEN',
  'RECEPCION_COMPRA'
);

-- =============================================================================
-- EMPRESA Y SEDES
-- =============================================================================

create table public.empresa (
  id                uuid primary key default gen_random_uuid(),
  ruc               public.ruc not null unique,
  razon_social      text not null,
  nombre_comercial  text,
  direccion         text,
  distrito          text,
  provincia         text,
  departamento      text,
  telefono          text,
  correo            public.email,
  web               text,
  logo_url          text,
  moneda_base       public.moneda not null default 'PEN',
  igv_porcentaje    public.porcentaje not null default 18,
  -- Costo horario de planta usado para prorratear gastos indirectos a las OT.
  costo_indirecto_hora public.monto not null default 0,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

comment on table public.empresa is
  'Datos de la empresa. Tabla de una sola fila; la aplicación siempre lee el primer registro.';

create table public.sedes (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  direccion      text,
  telefono       text,
  responsable    text,
  -- Capacidad instalada de la planta, usada en planificación de carga.
  capacidad_ot_simultaneas int check (capacidad_ot_simultaneas > 0),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.sedes is 'Talleres o plantas donde se ejecutan las órdenes de trabajo.';

-- =============================================================================
-- ROLES, PERMISOS Y USUARIOS
-- =============================================================================

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique,
  nombre      text not null,
  descripcion text,
  -- Nivel jerárquico: 100 administrador, 0 solo lectura. Facilita comparaciones.
  nivel       int not null default 0 check (nivel between 0 and 100),
  -- Los roles del sistema no se pueden eliminar desde la interfaz.
  es_sistema  boolean not null default false,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.permisos (
  codigo      text primary key,
  modulo      text not null,
  descripcion text not null
);

comment on table public.permisos is
  'Catálogo de permisos con formato modulo.accion, por ejemplo ordenes.crear.';

create table public.roles_permisos (
  rol_id         uuid not null references public.roles(id) on delete cascade,
  permiso_codigo text not null references public.permisos(codigo) on delete cascade,
  primary key (rol_id, permiso_codigo)
);

create table public.usuarios (
  -- El id coincide con auth.users.id: un usuario de Supabase Auth es un usuario del sistema.
  id             uuid primary key,
  codigo         text unique,
  nombres        text not null,
  apellidos      text not null,
  documento      text,
  correo         public.email not null unique,
  telefono       text,
  cargo          text,
  rol_id         uuid not null references public.roles(id) on delete restrict,
  sede_id        uuid references public.sedes(id) on delete set null,
  -- Los operarios registran horas en los partes diarios de producción.
  es_operario    boolean not null default false,
  -- Costo por hora del operario, base del costeo de mano de obra directa.
  costo_hora     public.monto not null default 0 check (costo_hora >= 0),
  fecha_ingreso  date,
  foto_url       text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on column public.usuarios.id is
  'Igual a auth.users.id. La FK se declara en la migración de RLS para no acoplar las pruebas locales.';

create index idx_usuarios_rol on public.usuarios(rol_id);
create index idx_usuarios_sede on public.usuarios(sede_id);
create index idx_usuarios_operario on public.usuarios(es_operario) where es_operario;

create view public.usuarios_nombre_completo as
  select id, (nombres || ' ' || apellidos) as nombre_completo from public.usuarios;

-- =============================================================================
-- TIPO DE CAMBIO
-- =============================================================================

create table public.tipos_cambio (
  fecha   date primary key,
  compra  numeric(10, 4) not null check (compra > 0),
  venta   numeric(10, 4) not null check (venta > 0),
  creado_en timestamptz not null default now()
);

comment on table public.tipos_cambio is
  'Tipo de cambio USD/PEN por día. Las compras en dólares se valorizan al tipo de cambio venta del día del documento.';

-- Devuelve el tipo de cambio venta vigente para una fecha; si no hay registro
-- exacto usa el último anterior, y si no existe ninguno devuelve 1.
create or replace function public.tipo_cambio_vigente(p_fecha date default current_date)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select venta from public.tipos_cambio where fecha <= p_fecha order by fecha desc limit 1),
    1
  );
$$;

-- =============================================================================
-- SERIES DOCUMENTARIAS Y CORRELATIVOS
-- =============================================================================

create table public.series_documentarias (
  id                 uuid primary key default gen_random_uuid(),
  tipo               public.tipo_correlativo not null,
  serie              text not null default '001',
  prefijo            text not null default '',
  -- Último número entregado. siguiente_correlativo() lo incrementa de forma atómica.
  correlativo_actual bigint not null default 0 check (correlativo_actual >= 0),
  longitud           int not null default 5 check (longitud between 3 and 10),
  sede_id            uuid references public.sedes(id) on delete cascade,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  -- NULLS NOT DISTINCT es imprescindible: las series globales tienen sede_id nulo
  -- y sin esta cláusula Postgres las consideraría todas distintas entre sí,
  -- permitiendo duplicados que romperían la numeración correlativa.
  unique nulls not distinct (tipo, serie, sede_id)
);

comment on table public.series_documentarias is
  'Series y correlativos por tipo de documento. Permite numeración independiente por sede.';

-- Entrega el siguiente número formateado, por ejemplo OT-001-00042.
-- El UPDATE ... RETURNING toma un lock de fila, de modo que dos transacciones
-- concurrentes nunca reciben el mismo correlativo.
create or replace function public.siguiente_correlativo(
  p_tipo  public.tipo_correlativo,
  p_serie text default null,
  p_sede  uuid default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_serie    text;
  v_prefijo  text;
  v_longitud int;
  v_numero   bigint;
  v_serie_id uuid;
begin
  -- Se resuelve primero la serie propia de la sede y, si no existe, la serie
  -- global (sede_id nulo). Así una empresa con un solo taller no necesita
  -- configurar series por sede, y otra con varias puede numerar por separado.
  select id into v_serie_id
    from public.series_documentarias
   where tipo = p_tipo
     and (p_serie is null or serie = p_serie)
     and activo
     and sede_id is not distinct from p_sede
   order by serie
   limit 1
   for update;

  if v_serie_id is null and p_sede is not null then
    select id into v_serie_id
      from public.series_documentarias
     where tipo = p_tipo
       and (p_serie is null or serie = p_serie)
       and activo
       and sede_id is null
     order by serie
     limit 1
     for update;
  end if;

  if v_serie_id is null then
    raise exception 'No existe una serie documentaria activa para el tipo % (serie %, sede %)',
      p_tipo, coalesce(p_serie, '<cualquiera>'), coalesce(p_sede::text, '<global>')
      using errcode = 'no_data_found';
  end if;

  -- El SELECT ... FOR UPDATE de arriba ya dejó la fila bloqueada, de modo que dos
  -- transacciones simultáneas se serializan aquí y nunca reciben el mismo número.
  update public.series_documentarias
     set correlativo_actual = correlativo_actual + 1,
         actualizado_en = now()
   where id = v_serie_id
  returning serie, prefijo, longitud, correlativo_actual
    into v_serie, v_prefijo, v_longitud, v_numero;

  return concat_ws('-',
    nullif(v_prefijo, ''),
    v_serie,
    lpad(v_numero::text, v_longitud, '0')
  );
end;
$$;

comment on function public.siguiente_correlativo is
  'Devuelve el siguiente número de documento de forma atómica. Debe llamarse dentro de la transacción que inserta el documento.';

-- =============================================================================
-- TIMESTAMPS AUTOMÁTICOS
-- =============================================================================

create or replace function public.fn_set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- Instala el trigger de actualizado_en sobre una tabla.
create or replace function public.activar_timestamps(p_tabla text)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists trg_timestamps on public.%I', p_tabla);
  execute format(
    'create trigger trg_timestamps before update on public.%I
       for each row execute function public.fn_set_actualizado_en()', p_tabla);
end;
$$;

-- =============================================================================
-- AUDITORÍA GENÉRICA
-- =============================================================================

create table public.audit_log (
  id            bigserial primary key,
  tabla         text not null,
  registro_id   uuid,
  accion        public.accion_auditoria not null,
  datos_antes   jsonb,
  datos_despues jsonb,
  -- Columnas que realmente cambiaron; simplifica leer el historial en pantalla.
  campos_modificados text[],
  usuario_id    uuid,
  creado_en     timestamptz not null default now()
);

create index idx_audit_registro on public.audit_log(tabla, registro_id, creado_en desc);
create index idx_audit_usuario on public.audit_log(usuario_id, creado_en desc);
create index idx_audit_fecha on public.audit_log(creado_en desc);

comment on table public.audit_log is
  'Historial inmutable de cambios. Es la base de la trazabilidad exigida por el negocio: quién cambió qué y cuándo.';

-- Devuelve el usuario autenticado, o null fuera de una sesión de Supabase
-- (por ejemplo durante las migraciones o en las pruebas locales).
create or replace function public.usuario_actual()
returns uuid
language plpgsql
stable
as $$
declare v_id uuid;
begin
  begin
    v_id := nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  exception when others then
    v_id := null;
  end;

  if v_id is null then
    begin
      v_id := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
    exception when others then
      v_id := null;
    end;
  end if;

  return v_id;
end;
$$;

create or replace function public.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario  uuid := public.usuario_actual();
  v_antes    jsonb;
  v_despues  jsonb;
  v_campos   text[];
begin
  if tg_op = 'DELETE' then
    insert into public.audit_log(tabla, registro_id, accion, datos_antes, usuario_id)
    values (tg_table_name, old.id, 'DELETE', to_jsonb(old), v_usuario);
    return old;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log(tabla, registro_id, accion, datos_despues, usuario_id)
    values (tg_table_name, new.id, 'INSERT', to_jsonb(new), v_usuario);
    return new;
  end if;

  v_antes   := to_jsonb(old);
  v_despues := to_jsonb(new);

  select coalesce(array_agg(clave order by clave), '{}')
    into v_campos
    from jsonb_object_keys(v_despues) as clave
   where v_antes -> clave is distinct from v_despues -> clave
     and clave <> 'actualizado_en';

  -- Un UPDATE que solo tocó actualizado_en no aporta nada al historial.
  if array_length(v_campos, 1) is null then
    return new;
  end if;

  insert into public.audit_log(tabla, registro_id, accion, datos_antes, datos_despues, campos_modificados, usuario_id)
  values (tg_table_name, new.id, 'UPDATE', v_antes, v_despues, v_campos, v_usuario);

  return new;
end;
$$;

-- Instala el trigger de auditoría sobre una tabla que tenga columna id uuid.
create or replace function public.activar_auditoria(p_tabla text)
returns void
language plpgsql
as $$
begin
  execute format('drop trigger if exists trg_auditoria on public.%I', p_tabla);
  execute format(
    'create trigger trg_auditoria after insert or update or delete on public.%I
       for each row execute function public.fn_auditoria()', p_tabla);
end;
$$;

-- =============================================================================
-- HELPERS DE AUTORIZACIÓN
-- Se declaran SECURITY DEFINER para poder consultar usuarios y roles sin que
-- las políticas RLS de esas mismas tablas provoquen recursión infinita.
-- =============================================================================

create or replace function public.mi_usuario()
returns public.usuarios
language sql
stable
security definer
set search_path = public
as $$
  select * from public.usuarios where id = public.usuario_actual();
$$;

create or replace function public.mi_rol()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.codigo
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.id = public.usuario_actual()
     and u.activo;
$$;

create or replace function public.mi_sede()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sede_id from public.usuarios where id = public.usuario_actual();
$$;

create or replace function public.tiene_permiso(p_codigo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.usuarios u
      join public.roles_permisos rp on rp.rol_id = u.rol_id
     where u.id = public.usuario_actual()
       and u.activo
       and rp.permiso_codigo = p_codigo
  );
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.usuarios u
      join public.roles r on r.id = u.rol_id
     where u.id = public.usuario_actual()
       and u.activo
       and r.codigo = 'ADMIN'
  );
$$;

-- Verdadero si hay un usuario activo detrás de la petición.
create or replace function public.es_usuario_activo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios where id = public.usuario_actual() and activo
  );
$$;

-- =============================================================================
-- TRIGGERS SOBRE LAS TABLAS DE ESTE MÓDULO
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'empresa', 'sedes', 'roles', 'usuarios', 'series_documentarias'
  ] loop
    perform public.activar_timestamps(t);
  end loop;

  foreach t in array array['empresa', 'sedes', 'roles', 'usuarios'] loop
    perform public.activar_auditoria(t);
  end loop;
end;
$$;
