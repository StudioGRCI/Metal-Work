-- =============================================================================
-- EL PADRÓN DE EQUIPOS DE LA PLANTA Y EL PUESTO DE MANTENIMIENTO
-- -----------------------------------------------------------------------------
-- Las máquinas y herramientas de la planta viven hoy en una hoja de Almacén,
-- «INVENTARIO DE MÁQUINAS Y HERRAMIENTAS - PLANTA» (hoja MAQUINAS del Excel
-- INVENTARIO 2026): 60 equipos con su grupo, su código, su serie, su marca y
-- quién lo tiene. El estado se escribe pegado al nombre de la persona («PÉREZ-
-- MALOGRADA», «PLANTA (NO SIRVE)») y nadie sabe cuánto lleva así ni quién
-- lo está viendo. El sistema no tenía dónde anotarlo: Mantenimiento existía
-- solo como tipo de OT para las unidades de los clientes.
--
-- Desde aquí hay un padrón de equipos, que lleva el puesto nuevo de
-- Mantenimiento. Es la base de lo que sigue (Plan 16): reportar la avería desde
-- el teléfono, atenderla y guardar la historia de cada equipo. Esto reemplaza
-- al área de TI y Soporte de la propuesta: los equipos de cómputo son una
-- categoría más.
--
-- Lo que se respeta de la hoja:
--   · El código es el de la hoja, grupo más correlativo: AM-04-06, AM-07-02,
--     TRO-14-03, REC-02, TA-07. Cada categoría guarda su prefijo y la base
--     propone el número que sigue; Mantenimiento puede escribir el que el
--     equipo ya lleva grabado. Las máquinas de soldar, que en la hoja solo
--     tienen serie, toman MS-01 en adelante.
--   · Serie de máquina y serie de cabezal, descripción, marca y «a cargo de»
--     (operario, contratista o área, escrito como en la hoja).
--   · El costo, el proveedor y la factura NO entran: el padrón lo va a leer
--     todo el que reporta una avería.
--
-- Lo que se suma: área, ubicación y un estado de tres valores (operativo, con
-- observación, parado), con su motivo y desde cuándo.
--
-- Un equipo no se borra: se da de baja con motivo, quién y cuándo, y deja de
-- ofrecerse. Dado de baja queda congelado; si fue un error, se reactiva.
--
-- Quién hace qué:
--   equipos.ver        Mantenimiento, Almacén y Gerencia (consulta).
--   equipos.gestionar  Mantenimiento: alta, corrección, estado, baja y
--                      categorías.
--   equipos.asignar    Mantenimiento y Almacén: cambiar quién lo tiene a cargo.
--                      Almacén es quien entrega la herramienta, y es lo único
--                      que controla del padrón.
--
-- No se crea ninguna cuenta ni se carga ningún equipo: la lista de la hoja la
-- revisa la empresa en la plantilla y se carga con su visto bueno.
-- =============================================================================

-- 1. Los permisos y el puesto --------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('equipos.ver', 'Mantenimiento', 'Consultar el padrón de equipos de la planta'),
  ('equipos.gestionar', 'Mantenimiento', 'Dar de alta, corregir, cambiar el estado y dar de baja equipos del padrón'),
  ('equipos.asignar', 'Mantenimiento', 'Cambiar quién tiene a cargo un equipo')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

-- Un solo puesto de Mantenimiento: lleva los equipos de la planta y, en su
-- entrega, el mantenimiento de las unidades de los clientes (área MNT).
insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('MANTENIMIENTO', 'Mantenimiento',
   'Lleva el padrón de equipos de la planta y atiende sus averías.', 45, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, a.permiso
  from (values
    ('MANTENIMIENTO', 'equipos.ver'), ('MANTENIMIENTO', 'equipos.gestionar'), ('MANTENIMIENTO', 'equipos.asignar'),
    ('ALMACENERO', 'equipos.ver'), ('ALMACENERO', 'equipos.asignar'),
    ('GERENTE', 'equipos.ver')
  ) as a(rol, permiso)
  join public.roles r on r.codigo = a.rol
on conflict do nothing;

-- 2. Las categorías -------------------------------------------------------------
create table if not exists public.equipo_categorias (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  prefijo        text,
  orden          integer not null default 500,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint uq_equipo_categorias_nombre unique (nombre),
  constraint ck_equipo_categorias_nombre check (char_length(btrim(nombre)) between 2 and 60),
  constraint ck_equipo_categorias_prefijo check (prefijo is null or prefijo ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and char_length(prefijo) <= 12)
);
comment on table public.equipo_categorias is
  'Los grupos del inventario de máquinas y herramientas de la planta. El prefijo es el del código que la empresa ya usa (AM-04, TRO-14, REC); sin prefijo, el código se escribe a mano.';

create unique index if not exists uq_equipo_categorias_prefijo
  on public.equipo_categorias (prefijo) where prefijo is not null;

create or replace function public.fn_equipo_categoria_normalizar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.nombre  := regexp_replace(btrim(coalesce(new.nombre, '')), '\s+', ' ', 'g');
  new.prefijo := nullif(upper(regexp_replace(coalesce(new.prefijo, ''), '\s', '', 'g')), '');
  if tg_op = 'UPDATE' then
    new.creado_en := old.creado_en;
    if new.prefijo is distinct from old.prefijo
       and exists (select 1 from public.equipos e where e.categoria_id = old.id) then
      raise exception 'La categoría % ya tiene equipos con su código: su prefijo no se cambia.', old.nombre
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_equipo_categoria_normalizar() from public, anon, authenticated;

-- 3. El padrón ------------------------------------------------------------------
create table if not exists public.equipos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null,
  descripcion     text not null,
  categoria_id    uuid not null references public.equipo_categorias(id) on delete restrict,
  marca           text,
  serie_maquina   text,
  serie_cabezal   text,
  area_id         uuid references public.areas(id) on delete restrict,
  ubicacion       text,
  a_cargo_de      text,
  estado          text not null default 'OPERATIVO',
  estado_nota     text,
  estado_desde    timestamptz not null default now(),
  observaciones   text,
  activo          boolean not null default true,
  baja_motivo     text,
  dado_de_baja_en timestamptz,
  baja_por        uuid references public.usuarios(id) on delete restrict,
  creado_por      uuid default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint uq_equipos_codigo unique (codigo),
  constraint ck_equipos_codigo check (codigo ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' and char_length(codigo) between 2 and 20),
  constraint ck_equipos_descripcion check (char_length(btrim(descripcion)) between 2 and 200),
  constraint ck_equipos_estado check (estado in ('OPERATIVO', 'CON_OBSERVACION', 'PARADO')),
  constraint ck_equipos_estado_nota check (estado = 'OPERATIVO' or char_length(btrim(coalesce(estado_nota, ''))) >= 3),
  constraint ck_equipos_baja check (
    (activo and baja_motivo is null and dado_de_baja_en is null and baja_por is null)
    or (not activo and char_length(btrim(coalesce(baja_motivo, ''))) >= 5 and dado_de_baja_en is not null)),
  constraint ck_equipos_textos check (
    char_length(coalesce(marca, '')) <= 80
    and char_length(coalesce(serie_maquina, '')) <= 60
    and char_length(coalesce(serie_cabezal, '')) <= 60
    and char_length(coalesce(ubicacion, '')) <= 120
    and char_length(coalesce(a_cargo_de, '')) <= 120
    and char_length(coalesce(estado_nota, '')) <= 300
    and char_length(coalesce(baja_motivo, '')) <= 300
    and char_length(coalesce(observaciones, '')) <= 1000)
);

comment on table public.equipos is
  'Padrón de máquinas, herramientas y equipos de cómputo de la planta. Lo lleva Mantenimiento. No se borra: se da de baja con motivo. No guarda costo, proveedor ni factura.';
comment on column public.equipos.codigo is
  'El código de la empresa: prefijo de su categoría más correlativo (AM-04-06, TRO-14-03, MS-01).';
comment on column public.equipos.a_cargo_de is
  'Quién lo tiene, como en la hoja de Almacén: operario, contratista o área. Lo cambian Mantenimiento y Almacén.';
comment on column public.equipos.estado is
  'OPERATIVO, CON_OBSERVACION (trabaja, pero hay que verlo) o PARADO (no se puede usar).';
comment on column public.equipos.estado_desde is
  'Desde cuándo está en ese estado. Lo pone la base cada vez que el estado cambia.';

-- Sin índices de llave foránea: (a) ninguna pantalla filtra por `baja_por` ni
-- `creado_por`; (b) el padrón tiene decenas de filas y la lista filtra por
-- estado y categoría en memoria de Postgres sin costo; (c) ni las categorías ni
-- las áreas ni las cuentas se borran. Skill `datos`, «Lo que ya se midió».

-- El número que sigue en el código de una categoría: el mayor que ya existe,
-- contando los equipos dados de baja, más uno. Dos cifras como en la hoja; de
-- cien en adelante, las que hagan falta. El cálculo va aparte y cerrado: lo
-- llama el disparador del alta, también en una carga sin sesión; la gente lo
-- pide por `equipos_codigos_que_siguen`, que exige el permiso.
create or replace function public.equipo_codigo_que_sigue(p_categoria uuid)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_prefijo text;
  v_numero  integer;
begin
  select prefijo into v_prefijo from public.equipo_categorias where id = p_categoria;
  if v_prefijo is null then
    return null;
  end if;
  select coalesce(max(substring(e.codigo from char_length(v_prefijo) + 2)::integer), 0) + 1
    into v_numero
    from public.equipos e
   where e.codigo ~ ('^' || v_prefijo || '-[0-9]{1,6}$');
  return v_prefijo || '-' || case when v_numero < 100 then lpad(v_numero::text, 2, '0') else v_numero::text end;
end;
$$;
revoke all on function public.equipo_codigo_que_sigue(uuid) from public, anon, authenticated;

-- Lo que el formulario del alta muestra antes de guardar: el código que le
-- toca al próximo equipo de cada categoría. Una sola llamada para todas.
create or replace function public.equipos_codigos_que_siguen()
returns table (categoria_id uuid, codigo text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('equipos.gestionar');
  return query
    select c.id, public.equipo_codigo_que_sigue(c.id)
      from public.equipo_categorias c
     where c.activo and c.prefijo is not null;
end;
$$;
comment on function public.equipos_codigos_que_siguen() is
  'El código que le toca al próximo equipo de cada categoría con prefijo. Exige equipos.gestionar.';
revoke all on function public.equipos_codigos_que_siguen() from public, anon;
grant execute on function public.equipos_codigos_que_siguen() to authenticated;

-- `security definer` para poder llamar al cálculo cerrado de arriba. No da nada
-- de más: quién puede insertar o corregir lo decide la política de la tabla,
-- que se evalúa antes y aparte.
create or replace function public.fn_equipo_normalizar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_categoria public.equipo_categorias%rowtype;
begin
  new.codigo        := upper(regexp_replace(coalesce(new.codigo, ''), '\s', '', 'g'));
  new.descripcion   := regexp_replace(btrim(coalesce(new.descripcion, '')), '\s+', ' ', 'g');
  new.marca         := nullif(upper(regexp_replace(btrim(coalesce(new.marca, '')), '\s+', ' ', 'g')), '');
  new.serie_maquina := nullif(upper(btrim(coalesce(new.serie_maquina, ''))), '');
  new.serie_cabezal := nullif(upper(btrim(coalesce(new.serie_cabezal, ''))), '');
  new.ubicacion     := nullif(regexp_replace(btrim(coalesce(new.ubicacion, '')), '\s+', ' ', 'g'), '');
  new.a_cargo_de    := nullif(upper(regexp_replace(btrim(coalesce(new.a_cargo_de, '')), '\s+', ' ', 'g')), '');
  new.estado_nota   := nullif(btrim(coalesce(new.estado_nota, '')), '');
  new.baja_motivo   := nullif(btrim(coalesce(new.baja_motivo, '')), '');
  new.observaciones := nullif(btrim(coalesce(new.observaciones, '')), '');

  if tg_op = 'INSERT' then
    select * into v_categoria from public.equipo_categorias where id = new.categoria_id;
    if not found then
      raise exception 'Elige la categoría del equipo.' using errcode = 'check_violation';
    end if;
    if not v_categoria.activo then
      raise exception 'La categoría % ya no se usa: elige otra.', v_categoria.nombre using errcode = 'check_violation';
    end if;
    if new.codigo = '' then
      if v_categoria.prefijo is null then
        raise exception 'Escribe el código del equipo: la categoría % no tiene uno propio.', v_categoria.nombre
          using errcode = 'check_violation';
      end if;
      -- Dos altas a la vez de la misma categoría no toman el mismo número.
      perform pg_advisory_xact_lock(hashtext('equipos:' || v_categoria.id::text));
      new.codigo := public.equipo_codigo_que_sigue(v_categoria.id);
    end if;
    if not new.activo then
      raise exception 'Un equipo se da de alta en uso; la baja se registra después, con su motivo.'
        using errcode = 'check_violation';
    end if;
    new.creado_por      := coalesce(public.usuario_actual(), new.creado_por);
    new.estado_desde    := now();
    new.baja_motivo     := null;
    new.dado_de_baja_en := null;
    new.baja_por        := null;
  else
    new.creado_por := old.creado_por;
    new.creado_en  := old.creado_en;
    if new.codigo = '' then
      raise exception 'El código del equipo no puede quedar vacío.' using errcode = 'check_violation';
    end if;

    if not old.activo and not new.activo then
      -- Dado de baja queda como evidencia: solo se puede reactivar.
      if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
        raise exception 'El equipo % está dado de baja: reactívalo antes de corregirlo.', old.codigo
          using errcode = 'check_violation';
      end if;
      return new;
    end if;

    if old.activo and not new.activo then
      if new.baja_motivo is null or char_length(new.baja_motivo) < 5 then
        raise exception 'Para dar de baja el equipo % hay que decir el motivo.', old.codigo
          using errcode = 'check_violation';
      end if;
      new.dado_de_baja_en := now();
      new.baja_por        := public.usuario_actual();
    elsif new.activo then
      -- Reactivar dice por qué, y solo por `equipo_reactivar`: la baja y su
      -- reactivación quedan en `equipo_bajas`.
      if not old.activo and char_length(btrim(coalesce(current_setting('equipos.motivo_reactivacion', true), ''))) < 5 then
        raise exception 'Para reactivar el equipo % hay que decir por qué.', old.codigo
          using errcode = 'check_violation';
      end if;
      -- En uso, o recién reactivado: la fila sin rastro de baja; la historia, aparte.
      new.baja_motivo     := null;
      new.dado_de_baja_en := null;
      new.baja_por        := null;
    end if;

    if new.estado is distinct from old.estado then
      new.estado_desde := now();
    else
      new.estado_desde := old.estado_desde;
    end if;
  end if;

  if new.estado = 'OPERATIVO' then
    new.estado_nota := null;
  elsif new.estado in ('CON_OBSERVACION', 'PARADO') and new.estado_nota is null then
    raise exception 'Di qué tiene el equipo para dejarlo %.',
      case new.estado when 'PARADO' then 'parado' else 'con observación' end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_equipo_normalizar() from public, anon, authenticated;

create or replace trigger trg_equipo_categoria_normalizar
  before insert or update on public.equipo_categorias
  for each row execute function public.fn_equipo_categoria_normalizar();

create or replace trigger trg_equipo_normalizar
  before insert or update on public.equipos
  for each row execute function public.fn_equipo_normalizar();

-- Ni el administrador borra un equipo o una categoría: la avería de mañana lo
-- va a nombrar. Se da de baja.
create or replace function public.fn_equipo_bloquear_borrado()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_table_name = 'equipos' then
    raise exception 'El equipo % no se borra: se da de baja con su motivo.', old.codigo
      using errcode = 'check_violation';
  end if;
  if tg_table_name = 'equipo_bajas' then
    raise exception 'La historia de bajas de un equipo no se borra: es la evidencia.'
      using errcode = 'check_violation';
  end if;
  raise exception 'La categoría % no se borra: se deja de usar.', old.nombre
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_equipo_bloquear_borrado() from public, anon, authenticated;

create or replace trigger trg_equipo_bloquear_borrado
  before delete on public.equipos
  for each row execute function public.fn_equipo_bloquear_borrado();
create or replace trigger trg_equipo_categoria_bloquear_borrado
  before delete on public.equipo_categorias
  for each row execute function public.fn_equipo_bloquear_borrado();

select public.activar_timestamps('equipo_categorias');
select public.activar_auditoria('equipo_categorias');
select public.activar_registro_de_prueba('equipo_categorias');
select public.activar_timestamps('equipos');
select public.activar_auditoria('equipos');
select public.activar_registro_de_prueba('equipos');

-- 4. Quién ve y quién escribe ---------------------------------------------------
alter table public.equipo_categorias enable row level security;
alter table public.equipos enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipo_categorias' and policyname = 'ver_equipo_categorias') then
    create policy ver_equipo_categorias on public.equipo_categorias for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('equipos.ver'))
      or (select public.tiene_permiso('equipos.gestionar'))
      or (select public.tiene_permiso('equipos.asignar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipo_categorias' and policyname = 'crear_equipo_categorias') then
    create policy crear_equipo_categorias on public.equipo_categorias for insert to authenticated with check (
      (select public.es_admin()) or (select public.tiene_permiso('equipos.gestionar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipo_categorias' and policyname = 'editar_equipo_categorias') then
    create policy editar_equipo_categorias on public.equipo_categorias for update to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('equipos.gestionar')))
      with check ((select public.es_admin()) or (select public.tiene_permiso('equipos.gestionar')));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipos' and policyname = 'ver_equipos') then
    create policy ver_equipos on public.equipos for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('equipos.ver'))
      or (select public.tiene_permiso('equipos.gestionar'))
      or (select public.tiene_permiso('equipos.asignar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipos' and policyname = 'crear_equipos') then
    create policy crear_equipos on public.equipos for insert to authenticated with check (
      (select public.es_admin()) or (select public.tiene_permiso('equipos.gestionar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipos' and policyname = 'editar_equipos') then
    create policy editar_equipos on public.equipos for update to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('equipos.gestionar')))
      with check ((select public.es_admin()) or (select public.tiene_permiso('equipos.gestionar')));
  end if;
end $$;

-- Sin política de borrado y sin el privilegio.
revoke all on public.equipo_categorias from public, anon, authenticated;
grant select, insert, update on public.equipo_categorias to authenticated;
revoke all on public.equipos from public, anon, authenticated;
grant select, insert, update on public.equipos to authenticated;

-- 5. «A cargo de», lo único que Almacén cambia ------------------------------------
-- Almacén entrega la herramienta y anota quién se la lleva. No corrige el
-- padrón: por eso no tiene la política de escritura y entra por esta función,
-- que toca una sola columna.
create or replace function public.equipo_cambiar_a_cargo(p_equipo uuid, p_a_cargo text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_equipo public.equipos%rowtype;
begin
  perform public.exigir_permiso('equipos.asignar');
  if char_length(btrim(coalesce(p_a_cargo, ''))) > 120 then
    raise exception 'El nombre de quien lo tiene a cargo pasa de 120 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_equipo from public.equipos where id = p_equipo for update;
  if not found then
    raise exception 'Ese equipo no está en el padrón.' using errcode = 'no_data_found';
  end if;
  if not v_equipo.activo then
    raise exception 'El equipo % está dado de baja: no se le asigna a nadie.', v_equipo.codigo
      using errcode = 'check_violation';
  end if;
  update public.equipos set a_cargo_de = p_a_cargo where id = p_equipo;
end;
$$;
comment on function public.equipo_cambiar_a_cargo(uuid, text) is
  'Cambia quién tiene a cargo un equipo en uso. Vacío lo deja sin nadie a cargo. Exige equipos.asignar.';
revoke all on function public.equipo_cambiar_a_cargo(uuid, text) from public, anon;
grant execute on function public.equipo_cambiar_a_cargo(uuid, text) to authenticated;

-- 6. La historia de las bajas ---------------------------------------------------
-- Una baja es evidencia: si el equipo se reactiva, la fila vuelve a estar en
-- uso y sin baja, pero la baja (motivo, quién, cuándo) y la reactivación (por
-- qué, quién, cuándo) quedan aquí. Solo la escribe el disparador; la leen los
-- mismos que leen el padrón. Es la primera parte de la historia de cada equipo
-- (entrega 16.4).
create table if not exists public.equipo_bajas (
  id                   uuid primary key default gen_random_uuid(),
  equipo_id            uuid not null references public.equipos(id) on delete restrict,
  motivo               text not null,
  dado_de_baja_en      timestamptz not null,
  baja_por             uuid references public.usuarios(id) on delete restrict,
  reactivado_en        timestamptz,
  reactivado_por       uuid references public.usuarios(id) on delete restrict,
  reactivacion_motivo  text,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  constraint ck_equipo_bajas_reactivacion check (
    (reactivado_en is null and reactivacion_motivo is null and reactivado_por is null)
    or (reactivado_en is not null and char_length(btrim(coalesce(reactivacion_motivo, ''))) >= 5)
  )
);
comment on table public.equipo_bajas is
  'Cada baja de un equipo y, si volvió a usarse, su reactivación. La escribe el disparador de equipos; nadie la escribe a mano.';
-- Índice por equipo: (b) la historia de cada equipo se lee por él y el
-- disparador busca la baja abierta del equipo al reactivarlo.
create index if not exists ix_equipo_bajas_equipo on public.equipo_bajas (equipo_id, dado_de_baja_en desc);

create or replace function public.fn_equipo_historia_de_bajas()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.activo and not new.activo then
    insert into public.equipo_bajas (equipo_id, motivo, dado_de_baja_en, baja_por)
    values (new.id, new.baja_motivo, new.dado_de_baja_en, new.baja_por);
  elsif not old.activo and new.activo then
    update public.equipo_bajas
       set reactivado_en       = now(),
           reactivado_por      = public.usuario_actual(),
           reactivacion_motivo = btrim(current_setting('equipos.motivo_reactivacion', true))
     where equipo_id = new.id and reactivado_en is null;
  end if;
  return null;
end;
$$;
revoke all on function public.fn_equipo_historia_de_bajas() from public, anon, authenticated;

create or replace trigger trg_equipo_historia_de_bajas
  after update of activo on public.equipos
  for each row when (old.activo is distinct from new.activo)
  execute function public.fn_equipo_historia_de_bajas();

create or replace trigger trg_equipo_bajas_bloquear_borrado
  before delete on public.equipo_bajas
  for each row execute function public.fn_equipo_bloquear_borrado();

select public.activar_timestamps('equipo_bajas');
select public.activar_auditoria('equipo_bajas');
select public.activar_registro_de_prueba('equipo_bajas');

alter table public.equipo_bajas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipo_bajas' and policyname = 'ver_equipo_bajas') then
    create policy ver_equipo_bajas on public.equipo_bajas for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('equipos.ver'))
      or (select public.tiene_permiso('equipos.gestionar'))
      or (select public.tiene_permiso('equipos.asignar'))
    );
  end if;
end $$;
revoke all on public.equipo_bajas from public, anon, authenticated;
grant select on public.equipo_bajas to authenticated;

-- Reactivar un equipo dado de baja, diciendo por qué. Corre con los permisos de
-- quien llama: la política `editar_equipos` decide, como en la baja. Si ya está
-- en uso (el mismo envío otra vez), no hace nada y lo dice.
create or replace function public.equipo_reactivar(p_equipo uuid, p_motivo text)
returns table (codigo text, ya_estaba boolean)
language plpgsql security invoker set search_path to 'public' as $$
declare
  v_codigo text;
  v_por    uuid;
  v_motivo text;
  v_quien  text;
begin
  perform public.exigir_permiso('equipos.gestionar');
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Di por qué vuelve a usarse el equipo (5 letras o más).' using errcode = 'check_violation';
  end if;
  if char_length(btrim(p_motivo)) > 300 then
    raise exception 'El motivo pasa de 300 caracteres.' using errcode = 'check_violation';
  end if;
  perform set_config('equipos.motivo_reactivacion', btrim(p_motivo), true);
  update public.equipos e set activo = true where e.id = p_equipo and not e.activo returning e.codigo into v_codigo;
  perform set_config('equipos.motivo_reactivacion', '', true);
  if v_codigo is not null then
    return query select v_codigo, false;
    return;
  end if;
  select e.codigo into v_codigo from public.equipos e where e.id = p_equipo and e.activo;
  if v_codigo is null then
    raise exception 'Ese equipo no está en el padrón o no puedes reactivarlo.' using errcode = 'no_data_found';
  end if;
  -- Ya está en uso. Es el mismo envío otra vez solo si la última reactivación
  -- la hizo esta cuenta con este mismo motivo; si no, se dice quién y por qué.
  select b.reactivado_por, b.reactivacion_motivo, coalesce(btrim(concat_ws(' ', u.nombres, u.apellidos)), 'otra cuenta')
    into v_por, v_motivo, v_quien
    from public.equipo_bajas b
    left join public.usuarios u on u.id = b.reactivado_por
   where b.equipo_id = p_equipo and b.reactivado_en is not null
   order by b.reactivado_en desc
   limit 1;
  if v_por is distinct from public.usuario_actual() or v_motivo is distinct from btrim(p_motivo) then
    raise exception 'El equipo % ya volvió al padrón: lo reactivó % por «%».', v_codigo, coalesce(v_quien, 'otra cuenta'), coalesce(v_motivo, 'sin motivo anotado')
      using errcode = 'check_violation';
  end if;
  return query select v_codigo, true;
end;
$$;
comment on function public.equipo_reactivar(uuid, text) is
  'Devuelve al padrón un equipo dado de baja, con el motivo. Exige equipos.gestionar; la baja queda en equipo_bajas.';
revoke all on function public.equipo_reactivar(uuid, text) from public, anon;
grant execute on function public.equipo_reactivar(uuid, text) to authenticated;

-- 7. Las categorías de la hoja ---------------------------------------------------
-- Los grupos de la hoja MAQUINAS con el prefijo que sus códigos ya llevan, más
-- la máquina de soldar (MS, que la hoja no codifica) y los equipos de cómputo.
-- «Otros» no tiene prefijo: su código se escribe (MC-01, PS-01).
insert into public.equipo_categorias (nombre, prefijo, orden) values
  ('Máquina de soldar', 'MS', 10),
  ('Tronzadora de 14"', 'TRO-14', 20),
  ('Rectificadora', 'REC', 30),
  ('Amoladora de 4 1/2"', 'AM-04', 40),
  ('Amoladora de 7"', 'AM-07', 50),
  ('Taladro', 'TA', 60),
  ('Equipo de cómputo', 'PC', 70),
  ('Otros', null, 990)
on conflict (nombre) do nothing;
