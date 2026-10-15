-- =============================================================================
-- DISEÑO TRABAJA POR CÓDIGO INTERNO: PLANOS, MATERIALES Y ETAPAS
-- -----------------------------------------------------------------------------
-- Gerencia decidió (2026-10-15) quitar el módulo de la orden de trabajo y llevar
-- todo por el código interno de la unidad (PLA_SR_O4_1_26/28): es lo que ya
-- viaja por el requerimiento, la orden de compra, la de servicio, la salida del
-- almacén y el reporte diario del supervisor. Lo que Diseño e Ingeniería
-- cargaba en la OT ahora se carga en el código:
--
--   * PLANOS. Cada plano lleva su número (001, 2A, ENS), su nombre y el área de
--     producción a la que va: Maestranza, Producción o Acabados. El PDF se sube
--     y queda; si Diseño lo corrige, sube una revisión nueva (R2, R3…) diciendo
--     qué cambió, y la anterior queda como historia. El supervisor del área ve
--     los planos de su área, los abre y marca que recibió cada revisión: es el
--     traspaso diseño → maestranza → producción de la hoja «Cumplimiento de
--     tiempos – Áreas» (MW-FOR-ING-8). Un plano no se borra: se anula con su
--     motivo.
--   * GESTIÓN DE MATERIALES. La lista de lo que lleva la unidad según Diseño:
--     material del catálogo, cantidad y, si sale de uno, el plano. Es la
--     referencia contra la que se mira lo comprado y lo que salió del almacén
--     para el código. No genera requerimientos: los sigue pidiendo cada área.
--   * CONTROL DE ETAPAS. Las etapas de la unidad, como en la hoja «Control de
--     plazos»: diseño → habilitado (Maestranza) → armado (Producción) → arenado
--     y pintura (Acabados) → trámites → entrega, cada una con su fecha de inicio
--     y su fecha comprometida. Diseño las arma; Diseño o el supervisor del área
--     marca cuándo empezó y cuándo terminó; si termina después de lo
--     comprometido, se escribe por qué. El avance de cada etapa sale solo del
--     reporte diario que esa área sube para el código.
--
-- Gerencia ve todo por código en «Códigos internos». Diseño escribe; el
-- supervisor ve sus planos y sus etapas. Todo se escribe por funciones que
-- exigen el mismo permiso que la pantalla; las tablas solo se leen.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Los permisos ------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('diseno.codigos', 'Diseño',
   'Cargar por código interno los planos de cada área, la lista de materiales y las etapas de la unidad'),
  ('codigos_internos.area', 'Producción',
   'Ver los planos y las etapas que Diseño puso a su área en cada código interno, marcar el plano recibido y la etapa empezada o terminada')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, x.permiso
  from public.roles r
  join (values ('DISENO', 'diseno.codigos'), ('DISENO_LIDER', 'diseno.codigos'),
               ('SUPERVISOR', 'codigos_internos.area'), ('JEFE_PRODUCCION', 'codigos_internos.area')) as x(rol, permiso)
    on x.rol = r.codigo
on conflict do nothing;

-- 2. El código de una unidad, escrito siempre igual ---------------------------------
-- PLANTA vale para un requerimiento o una compra de la planta, no para planos.
create or replace function public.exigir_codigo_de_unidad(p_codigo text)
returns text language plpgsql stable set search_path to 'public' as $$
declare
  v text := public.normalizar_codigo_interno(p_codigo);
begin
  if v is null then
    raise exception 'Escribe el código interno de la unidad, por ejemplo PLA_SR_O4_1_26/28.' using errcode = 'check_violation';
  end if;
  if char_length(v) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: los planos, los materiales y las etapas van con el código interno de la unidad.'
      using errcode = 'check_violation';
  end if;
  return v;
end;
$$;
revoke all on function public.exigir_codigo_de_unidad(text) from public, anon, authenticated;

-- Quién lee lo que Diseño carga por código: Diseño, Gerencia y los supervisores.
create or replace function public.puede_ver_codigos_de_diseno()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('diseno.codigos') or public.tiene_permiso('codigos_internos.ver')
      or public.tiene_permiso('codigos_internos.area');
$$;
revoke all on function public.puede_ver_codigos_de_diseno() from public, anon;
grant execute on function public.puede_ver_codigos_de_diseno() to authenticated;

create or replace function public.exigir_ver_codigos_de_diseno()
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.usuario_actual() is not null and not public.puede_ver_codigos_de_diseno() then
    raise exception 'No tienes permiso para ver los planos, los materiales ni las etapas de los códigos internos.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.exigir_ver_codigos_de_diseno() from public, anon, authenticated;

-- 3. Los planos y sus revisiones -------------------------------------------------------
create table if not exists public.codigo_planos (
  id                uuid primary key default gen_random_uuid(),
  codigo_interno    text not null,
  -- «# PLANO» de la hoja: texto, porque escriben 001, 2A o ENS.
  numero            text not null,
  nombre            text not null,
  area_id           uuid not null,
  observacion       text,
  creado_por        uuid not null default public.usuario_actual(),
  creado_en         timestamptz not null default now(),
  anulado_en        timestamptz,
  anulado_por       uuid,
  motivo_anulacion  text,
  actualizado_en    timestamptz not null default now(),
  constraint codigo_planos_area_id_fkey foreign key (area_id) references public.areas(id) on delete restrict,
  -- Sin índice: nadie filtra por quién lo cargó o lo anuló, y el usuario no se borra.
  constraint codigo_planos_creado_por_fkey foreign key (creado_por) references public.usuarios(id) on delete restrict,
  constraint codigo_planos_anulado_por_fkey foreign key (anulado_por) references public.usuarios(id) on delete restrict,
  -- Para que un material no cuelgue de un plano de otro código.
  constraint uq_codigo_plano_id_codigo unique (id, codigo_interno),
  constraint ck_codigo_plano check (
    codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
    and char_length(btrim(numero)) between 1 and 20
    and char_length(btrim(nombre)) between 2 and 200
    and (observacion is null or char_length(observacion) <= 1000)
    and (anulado_en is null) = (anulado_por is null)
    and (anulado_en is null) = (motivo_anulacion is null)
    and (motivo_anulacion is null or char_length(btrim(motivo_anulacion)) >= 5))
);
comment on table public.codigo_planos is
  'Cada plano que Diseño carga para un código interno, con el área de producción a la que va. Sus PDF están en codigo_plano_revisiones. No se borra: se anula.';

-- Un mismo plano para la misma área va una vez por código: lo corregido entra
-- como revisión. Es también el índice de la lista por código (b).
create unique index if not exists uq_codigo_plano_vigente
  on public.codigo_planos (codigo_interno, upper(numero), area_id) where anulado_en is null;
-- (b) Diseño y Gerencia abren los planos de un código, anulados incluidos.
create index if not exists idx_codigo_planos_codigo on public.codigo_planos (codigo_interno, creado_en);
-- (b) El supervisor abre los planos de su área.
create index if not exists idx_codigo_planos_area on public.codigo_planos (area_id);

create table if not exists public.codigo_plano_revisiones (
  -- Lo pone el navegador: el PDF sube a {plano}/{revisión}.pdf antes de registrarlo.
  id              uuid primary key,
  plano_id        uuid not null,
  revision        smallint not null,
  nombre_archivo  text not null,
  ruta            text not null,
  tamano_bytes    integer not null,
  -- Qué cambió respecto de la anterior; la primera no lo lleva.
  cambios         text,
  subido_por      uuid not null default public.usuario_actual(),
  subido_en       timestamptz not null default now(),
  recibido_por    uuid,
  recibido_en     timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint codigo_plano_revisiones_plano_id_fkey foreign key (plano_id) references public.codigo_planos(id) on delete restrict,
  constraint codigo_plano_revisiones_subido_por_fkey foreign key (subido_por) references public.usuarios(id) on delete restrict,
  constraint codigo_plano_revisiones_recibido_por_fkey foreign key (recibido_por) references public.usuarios(id) on delete restrict,
  -- También es el índice de la llave hacia el plano.
  constraint uq_codigo_plano_revision unique (plano_id, revision),
  -- La política de Storage la busca por su ruta.
  constraint uq_codigo_plano_revision_ruta unique (ruta),
  constraint ck_codigo_plano_revision check (
    revision between 1 and 999
    and char_length(btrim(nombre_archivo)) between 1 and 200
    and tamano_bytes between 1 and 20971520
    and (revision = 1 or char_length(btrim(coalesce(cambios, ''))) >= 5)
    and (cambios is null or char_length(cambios) <= 1000)
    and (recibido_en is null) = (recibido_por is null))
);
comment on table public.codigo_plano_revisiones is
  'Cada PDF de un plano de código interno: R1, R2… La vigente es la de número mayor. El supervisor del área marca que la recibió. El PDF va en el bucket planos-codigo con la ruta {plano}/{revisión}.pdf. No se cambia ni se borra.';

select public.activar_timestamps('codigo_planos');
select public.activar_auditoria('codigo_planos');
select public.activar_registro_de_prueba('codigo_planos');
select public.activar_timestamps('codigo_plano_revisiones');
select public.activar_auditoria('codigo_plano_revisiones');
select public.activar_registro_de_prueba('codigo_plano_revisiones');

-- Lo cargado no se corrige ni se borra: el plano se anula una vez; la revisión
-- solo gana su «recibido», una vez.
create or replace function public.fn_codigo_plano_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un plano cargado no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'El plano % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['anulado_en', 'anulado_por', 'motivo_anulacion', 'actualizado_en'])
     is distinct from (to_jsonb(old) - array['anulado_en', 'anulado_por', 'motivo_anulacion', 'actualizado_en']) then
    raise exception 'Un plano cargado no se corrige: súbele una revisión, o anúlalo con su motivo y cárgalo bien.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_codigo_plano_guardia() from public, anon, authenticated;
create or replace trigger trg_codigo_plano_guardia
  before update or delete on public.codigo_planos
  for each row execute function public.fn_codigo_plano_guardia();

create or replace function public.fn_codigo_plano_revision_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una revisión de plano no se borra: queda como historia del plano.' using errcode = 'check_violation';
  end if;
  if old.recibido_en is not null then
    raise exception 'La revisión R% ya se recibió: no se cambia.', old.revision using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['recibido_por', 'recibido_en', 'actualizado_en'])
     is distinct from (to_jsonb(old) - array['recibido_por', 'recibido_en', 'actualizado_en']) then
    raise exception 'Una revisión subida no se cambia: sube otra.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_codigo_plano_revision_guardia() from public, anon, authenticated;
create or replace trigger trg_codigo_plano_revision_guardia
  before update or delete on public.codigo_plano_revisiones
  for each row execute function public.fn_codigo_plano_revision_guardia();

-- 4. La lista de materiales de Diseño ----------------------------------------------------
create table if not exists public.codigo_materiales (
  id               uuid primary key default gen_random_uuid(),
  codigo_interno   text not null,
  -- Sin índice: la lista se lee por código (índice de abajo) y el material no se borra.
  material_id      uuid not null,
  -- Tres decimales: el taller pide en kilos y en metros.
  cantidad         numeric(12,3) not null,
  -- El plano del que sale. Vacío para lo de la unidad entera: pintura, pernería.
  plano_id         uuid,
  observacion      text,
  creado_por       uuid not null default public.usuario_actual(),
  creado_en        timestamptz not null default now(),
  actualizado_por  uuid,
  quitado_en       timestamptz,
  quitado_por      uuid,
  actualizado_en   timestamptz not null default now(),
  constraint codigo_materiales_material_id_fkey foreign key (material_id) references public.materiales(id) on delete restrict,
  -- La pareja: el plano tiene que ser del mismo código.
  constraint codigo_materiales_plano_fkey foreign key (plano_id, codigo_interno)
    references public.codigo_planos(id, codigo_interno) on delete restrict,
  constraint codigo_materiales_creado_por_fkey foreign key (creado_por) references public.usuarios(id) on delete restrict,
  constraint codigo_materiales_actualizado_por_fkey foreign key (actualizado_por) references public.usuarios(id) on delete restrict,
  constraint codigo_materiales_quitado_por_fkey foreign key (quitado_por) references public.usuarios(id) on delete restrict,
  constraint ck_codigo_material check (
    codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
    and cantidad > 0 and cantidad <= 999999
    and (observacion is null or char_length(observacion) <= 500)
    and (quitado_en is null) = (quitado_por is null))
);
comment on table public.codigo_materiales is
  'Lo que Diseño dice que lleva la unidad de un código interno: material, cantidad y de qué plano sale. Es la referencia contra lo comprado y lo salido del almacén; no lleva precios. Se quita, no se borra.';

-- El mismo material del mismo plano dos veces es un error de tecleo: se corrige
-- la cantidad. También es el índice de la lista por código (b).
create unique index if not exists uq_codigo_material_vigente
  on public.codigo_materiales (codigo_interno, plano_id, material_id) nulls not distinct where quitado_en is null;

select public.activar_timestamps('codigo_materiales');
select public.activar_auditoria('codigo_materiales');
select public.activar_registro_de_prueba('codigo_materiales');

-- 5. Las etapas de la unidad --------------------------------------------------------------
create table if not exists public.codigo_etapas (
  id               uuid primary key default gen_random_uuid(),
  codigo_interno   text not null,
  orden            smallint not null,
  nombre           text not null,
  -- El área que la hace. Vacía para trámites o entrega, que no son de un área del taller.
  area_id          uuid,
  inicio_plan      date,
  -- La fecha comprometida: con ella se sabe si va a tiempo.
  fin_plan         date,
  inicio_real      date,
  fin_real         date,
  -- La última nota: por qué se atrasó, por qué se reabrió.
  nota             text,
  creado_por       uuid not null default public.usuario_actual(),
  creado_en        timestamptz not null default now(),
  actualizado_por  uuid,
  quitada_en       timestamptz,
  quitada_por      uuid,
  actualizado_en   timestamptz not null default now(),
  constraint codigo_etapas_area_id_fkey foreign key (area_id) references public.areas(id) on delete restrict,
  constraint codigo_etapas_creado_por_fkey foreign key (creado_por) references public.usuarios(id) on delete restrict,
  constraint codigo_etapas_actualizado_por_fkey foreign key (actualizado_por) references public.usuarios(id) on delete restrict,
  constraint codigo_etapas_quitada_por_fkey foreign key (quitada_por) references public.usuarios(id) on delete restrict,
  constraint ck_codigo_etapa check (
    codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
    and orden between 1 and 999
    and char_length(btrim(nombre)) between 2 and 120
    and (inicio_plan is null or fin_plan is null or fin_plan >= inicio_plan)
    and (fin_real is null or inicio_real is not null)
    and (inicio_real is null or fin_real is null or fin_real >= inicio_real)
    and (nota is null or char_length(nota) <= 1000)
    and (quitada_en is null) = (quitada_por is null))
);
comment on table public.codigo_etapas is
  'Las etapas de la unidad de un código interno (diseño, habilitado, armado, arenado y pintura, trámites, entrega) con su fecha de inicio, la comprometida y las reales. Las arma Diseño; las marca Diseño o el supervisor del área. Se quitan, no se borran.';

-- (b) Diseño, Gerencia y el supervisor abren las etapas de un código en su orden.
create index if not exists idx_codigo_etapas_codigo on public.codigo_etapas (codigo_interno, orden) where quitada_en is null;
-- area_id sin índice: las etapas se leen por código, y las áreas no se borran.

select public.activar_timestamps('codigo_etapas');
select public.activar_auditoria('codigo_etapas');
select public.activar_registro_de_prueba('codigo_etapas');

-- La lista de materiales y las etapas se quitan, no se borran: queda la historia.
create or replace function public.fn_codigo_no_se_borra()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Lo que Diseño registra por código no se borra: se quita y queda en el historial.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_codigo_no_se_borra() from public, anon, authenticated;
create or replace trigger trg_codigo_material_no_se_borra
  before delete on public.codigo_materiales
  for each row execute function public.fn_codigo_no_se_borra();
create or replace trigger trg_codigo_etapa_no_se_borra
  before delete on public.codigo_etapas
  for each row execute function public.fn_codigo_no_se_borra();

-- 6. Quién ve qué ---------------------------------------------------------------------------
-- Diseño y Gerencia todo; el supervisor, los planos de su área (con
-- produccion.cualquier_area, los de todas), la lista de materiales y las
-- etapas. Escribir, solo por las funciones de abajo.
alter table public.codigo_planos enable row level security;
alter table public.codigo_plano_revisiones enable row level security;
alter table public.codigo_materiales enable row level security;
alter table public.codigo_etapas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_planos' and policyname = 'ver_codigo_planos') then
    create policy ver_codigo_planos on public.codigo_planos for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('diseno.codigos'))
             or (select public.tiene_permiso('codigos_internos.ver'))
             or ((select public.tiene_permiso('codigos_internos.area')) and public.puede_hoja_de_area(area_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_plano_revisiones' and policyname = 'ver_codigo_plano_revisiones') then
    create policy ver_codigo_plano_revisiones on public.codigo_plano_revisiones for select to authenticated
      using (exists (select 1 from public.codigo_planos p where p.id = plano_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_materiales' and policyname = 'ver_codigo_materiales') then
    create policy ver_codigo_materiales on public.codigo_materiales for select to authenticated
      using ((select public.puede_ver_codigos_de_diseno()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_etapas' and policyname = 'ver_codigo_etapas') then
    create policy ver_codigo_etapas on public.codigo_etapas for select to authenticated
      using ((select public.puede_ver_codigos_de_diseno()));
  end if;
end $$;
revoke all on public.codigo_planos, public.codigo_plano_revisiones, public.codigo_materiales, public.codigo_etapas
  from public, anon, authenticated;
grant select on public.codigo_planos, public.codigo_plano_revisiones, public.codigo_materiales, public.codigo_etapas
  to authenticated;

-- 7. El PDF de cada plano en Storage ----------------------------------------------------------
-- Un juego de planos en PDF pesa poco; 20 MB es lo mismo que aceptaba la OT.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planos-codigo', 'planos-codigo', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- La ruta es {plano}/{revisión}.pdf. Lo sube Diseño; lo ve quien lo subió (para
-- comprobarlo antes de registrarlo) y quien ve la revisión que lo nombra. Uno
-- suelto lo retira su dueño mientras ninguna revisión lo nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'plano_codigo_subir') then
    create policy plano_codigo_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'planos-codigo' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('diseno.codigos'))
      and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'plano_codigo_ver') then
    create policy plano_codigo_ver on storage.objects for select to authenticated using (
      bucket_id = 'planos-codigo'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.codigo_plano_revisiones r where r.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'plano_codigo_quitar_suelto') then
    create policy plano_codigo_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'planos-codigo' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.codigo_plano_revisiones r where r.ruta = objects.name));
  end if;
end $$;

-- El PDF que el navegador ya subió: suyo, PDF y de hasta 20 MB. Devuelve el tamaño.
create or replace function public.plano_pdf_subido(p_ruta text, p_nombre_archivo text)
returns integer language plpgsql stable set search_path to 'public' as $$
declare
  v_objeto storage.objects%rowtype;
begin
  if char_length(btrim(coalesce(p_nombre_archivo, ''))) not between 1 and 200 then
    raise exception 'Vuelve a elegir el PDF del plano.' using errcode = 'check_violation';
  end if;
  select * into v_objeto from storage.objects where bucket_id = 'planos-codigo' and name = p_ruta;
  if not found or v_objeto.owner_id is distinct from public.usuario_actual()::text
     or v_objeto.metadata->>'mimetype' is distinct from 'application/pdf'
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 20971520 then
    raise exception 'El PDF del plano no terminó de subir: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;
  return (v_objeto.metadata->>'size')::integer;
end;
$$;
revoke all on function public.plano_pdf_subido(text, text) from public, anon, authenticated;

-- 8. Los avisos -----------------------------------------------------------------------------------
-- Al supervisor del área del plano (y a quien ve todas las áreas), menos a quien lo hizo.
create or replace function public.avisar_area_del_plano(p_area uuid, p_titulo text, p_cuerpo text, p_plano uuid)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo, '/planos', 'codigo_planos', p_plano
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'codigos_internos.area'
   where u.activo and u.id is distinct from public.usuario_actual()
     and (u.area_id = p_area
          or exists (select 1 from public.roles_permisos x where x.rol_id = u.rol_id and x.permiso_codigo = 'produccion.cualquier_area'));
$$;
revoke all on function public.avisar_area_del_plano(uuid, text, text, uuid) from public, anon, authenticated;

-- A Diseño, menos a quien lo hizo.
create or replace function public.avisar_a_diseno(p_titulo text, p_cuerpo text, p_ruta text, p_tabla text, p_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo, p_ruta, p_tabla, p_id
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'diseno.codigos'
   where u.activo and u.id is distinct from public.usuario_actual();
$$;
revoke all on function public.avisar_a_diseno(text, text, text, text, uuid) from public, anon, authenticated;

-- 9. Cargar un plano, subirle una revisión, anularlo y recibirlo ------------------------------------
-- El PDF ya subió a {plano}/{revisión}.pdf; aquí se comprueba y se registra el
-- plano con su R1, en la misma transacción. Con los mismos ids, un reintento
-- no duplica nada.
create or replace function public.registrar_plano_codigo(
  p_plano uuid, p_revision uuid, p_codigo text, p_numero text, p_nombre text, p_area uuid,
  p_observacion text, p_nombre_archivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_codigo  text;
  v_numero  text := upper(regexp_replace(btrim(coalesce(p_numero, '')), '\s+', ' ', 'g'));
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_obs     text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_ruta    text := p_plano::text || '/' || p_revision::text || '.pdf';
  v_area    public.areas%rowtype;
  v_existe  public.codigo_planos%rowtype;
  v_tamano  integer;
begin
  perform public.exigir_permiso('diseno.codigos');
  v_codigo := public.exigir_codigo_de_unidad(p_codigo);

  select * into v_existe from public.codigo_planos where id = p_plano;
  if found then
    if v_existe.codigo_interno = v_codigo and upper(v_existe.numero) = v_numero and v_existe.area_id = p_area
       and v_existe.creado_por = v_yo
       and exists (select 1 from public.codigo_plano_revisiones r where r.id = p_revision and r.plano_id = p_plano) then
      return p_plano;
    end if;
    raise exception 'Ese plano ya se cargó con otros datos. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_plano_revisiones where id = p_revision) then
    raise exception 'Ese PDF ya se registró en otro plano. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  if char_length(v_numero) not between 1 and 20 then
    raise exception 'Escribe el número del plano como figura en él: 001, 2A, ENS.' using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 2 and 200 then
    raise exception 'Escribe el nombre del plano, por ejemplo ESTRUCTURA CAJÓN o COMPUERTA.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 1000 then
    raise exception 'La observación del plano pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_area from public.areas where id = p_area;
  if not found or v_area.codigo not in ('MTZ', 'PRD', 'ACB') then
    raise exception 'Elige a qué área de producción va el plano: Maestranza, Producción o Acabados.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_planos p
              where p.codigo_interno = v_codigo and upper(p.numero) = v_numero and p.area_id = p_area and p.anulado_en is null) then
    raise exception 'El plano % para % ya está en el código %: súbele una revisión en lugar de cargarlo otra vez.',
      v_numero, v_area.nombre, v_codigo using errcode = 'check_violation';
  end if;

  v_tamano := public.plano_pdf_subido(v_ruta, p_nombre_archivo);

  insert into public.codigo_planos (id, codigo_interno, numero, nombre, area_id, observacion, creado_por)
  values (p_plano, v_codigo, v_numero, v_nombre, p_area, v_obs, v_yo);
  insert into public.codigo_plano_revisiones (id, plano_id, revision, nombre_archivo, ruta, tamano_bytes, subido_por)
  values (p_revision, p_plano, 1, btrim(p_nombre_archivo), v_ruta, v_tamano, v_yo);

  perform public.avisar_area_del_plano(p_area,
    'Plano nuevo para ' || v_area.nombre || ': ' || v_codigo,
    'Diseño cargó el plano ' || v_numero || ' «' || v_nombre || '». Ábrelo y marca que lo recibiste.', p_plano);
  return p_plano;
end;
$$;
comment on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text) is
  'Diseño carga un plano para un código interno con su área de producción y su primer PDF (R1), ya subido a planos-codigo. Avisa al supervisor del área. Exige diseno.codigos.';
revoke all on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text) from public, anon;
grant execute on function public.registrar_plano_codigo(uuid, uuid, text, text, text, uuid, text, text) to authenticated;

create or replace function public.subir_revision_plano(p_plano uuid, p_revision uuid, p_cambios text, p_nombre_archivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_plano   public.codigo_planos%rowtype;
  v_existe  public.codigo_plano_revisiones%rowtype;
  v_ruta    text := p_plano::text || '/' || p_revision::text || '.pdf';
  v_cambios text := regexp_replace(btrim(coalesce(p_cambios, '')), '\s+', ' ', 'g');
  v_numero  smallint;
  v_tamano  integer;
begin
  perform public.exigir_permiso('diseno.codigos');
  select * into v_plano from public.codigo_planos where id = p_plano for update;
  if not found then
    raise exception 'El plano no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  select * into v_existe from public.codigo_plano_revisiones where id = p_revision;
  if found then
    if v_existe.plano_id = p_plano and v_existe.subido_por = v_yo then
      return p_revision;
    end if;
    raise exception 'Ese PDF ya se registró en otro plano. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_plano.anulado_en is not null then
    raise exception 'El plano % está anulado: no lleva revisiones.', v_plano.numero using errcode = 'check_violation';
  end if;
  if char_length(v_cambios) < 5 then
    raise exception 'Escribe qué cambió en esta revisión del plano %.', v_plano.numero using errcode = 'check_violation';
  end if;
  if char_length(v_cambios) > 1000 then
    raise exception 'Lo que cambió pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;

  v_tamano := public.plano_pdf_subido(v_ruta, p_nombre_archivo);
  select coalesce(max(revision), 0) + 1 into v_numero from public.codigo_plano_revisiones where plano_id = p_plano;

  insert into public.codigo_plano_revisiones (id, plano_id, revision, nombre_archivo, ruta, tamano_bytes, cambios, subido_por)
  values (p_revision, p_plano, v_numero, btrim(p_nombre_archivo), v_ruta, v_tamano, v_cambios, v_yo);

  perform public.avisar_area_del_plano(v_plano.area_id,
    'Revisión R' || v_numero || ' del plano ' || v_plano.numero || ': ' || v_plano.codigo_interno,
    'Diseño corrigió el plano «' || v_plano.nombre || '»: ' || v_cambios || '. Trabaja con la nueva y marca que la recibiste.',
    p_plano);
  return p_revision;
end;
$$;
comment on function public.subir_revision_plano(uuid, uuid, text, text) is
  'Diseño sube una revisión nueva (R2, R3…) de un plano vigente, diciendo qué cambió. La anterior queda como historia. Exige diseno.codigos.';
revoke all on function public.subir_revision_plano(uuid, uuid, text, text) from public, anon;
grant execute on function public.subir_revision_plano(uuid, uuid, text, text) to authenticated;

create or replace function public.anular_plano_codigo(p_plano uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_plano public.codigo_planos%rowtype;
begin
  perform public.exigir_permiso('diseno.codigos');
  select * into v_plano from public.codigo_planos where id = p_plano for update;
  if not found then
    raise exception 'El plano no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_plano.anulado_en is not null then
    return p_plano;
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe por qué se anula el plano %.', v_plano.numero using errcode = 'check_violation';
  end if;
  update public.codigo_planos
     set anulado_en = now(), anulado_por = public.usuario_actual(), motivo_anulacion = btrim(p_motivo)
   where id = p_plano;
  perform public.avisar_area_del_plano(v_plano.area_id,
    'Plano anulado: ' || v_plano.numero || ' de ' || v_plano.codigo_interno,
    'Diseño anuló el plano «' || v_plano.nombre || '»: ' || btrim(p_motivo) || '. Ya no trabajes con él.', p_plano);
  return p_plano;
end;
$$;
revoke all on function public.anular_plano_codigo(uuid, text) from public, anon;
grant execute on function public.anular_plano_codigo(uuid, text) to authenticated;

-- El supervisor marca que recibió la revisión vigente de un plano de su área.
create or replace function public.recibir_plano_codigo(p_revision uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rev   public.codigo_plano_revisiones%rowtype;
  v_plano public.codigo_planos%rowtype;
  v_area  text;
begin
  perform public.exigir_permiso('codigos_internos.area');
  select * into v_rev from public.codigo_plano_revisiones where id = p_revision for update;
  if not found then
    raise exception 'El plano no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  select * into v_plano from public.codigo_planos where id = v_rev.plano_id;
  select nombre into v_area from public.areas where id = v_plano.area_id;
  if not public.puede_hoja_de_area(v_plano.area_id) then
    raise exception 'El plano % va a %: lo recibe su supervisor.', v_plano.numero, v_area using errcode = 'check_violation';
  end if;
  if v_rev.recibido_en is not null then
    return p_revision;
  end if;
  if v_plano.anulado_en is not null then
    raise exception 'El plano % está anulado: no se recibe.', v_plano.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_plano_revisiones r where r.plano_id = v_rev.plano_id and r.revision > v_rev.revision) then
    raise exception 'Hay una revisión más nueva del plano %: recibe esa.', v_plano.numero using errcode = 'check_violation';
  end if;
  update public.codigo_plano_revisiones set recibido_por = public.usuario_actual(), recibido_en = now() where id = p_revision;
  perform public.avisar_a_diseno(
    'Plano recibido por ' || v_area || ': ' || v_plano.numero,
    v_plano.codigo_interno || ' · «' || v_plano.nombre || '» R' || v_rev.revision || '.',
    '/diseno/codigo?' || 'codigo=' || replace(replace(v_plano.codigo_interno, '/', '%2F'), ' ', '+'),
    'codigo_planos', v_plano.id);
  return p_revision;
end;
$$;
revoke all on function public.recibir_plano_codigo(uuid) from public, anon;
grant execute on function public.recibir_plano_codigo(uuid) to authenticated;

-- 10. La lista de materiales: agregar o corregir una línea, y quitarla --------------------------------
create or replace function public.guardar_material_codigo(
  p_id uuid, p_codigo text, p_material uuid, p_cantidad numeric, p_plano uuid, p_observacion text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_codigo text;
  v_linea  public.codigo_materiales%rowtype;
  v_obs    text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_id     uuid;
begin
  perform public.exigir_permiso('diseno.codigos');
  if p_id is not null then
    select * into v_linea from public.codigo_materiales where id = p_id for update;
    if not found or v_linea.quitado_en is not null then
      raise exception 'Esa línea ya no está en la lista. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
    end if;
    v_codigo := v_linea.codigo_interno;
  else
    v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  end if;

  if not exists (select 1 from public.materiales m where m.id = p_material and m.activo) then
    raise exception 'Elige el material del catálogo.' using errcode = 'check_violation';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 999999 then
    raise exception 'Escribe la cantidad, más de cero.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  if p_plano is not null and not exists (select 1 from public.codigo_planos p
                                           where p.id = p_plano and p.codigo_interno = v_codigo and p.anulado_en is null) then
    raise exception 'Ese plano no está vigente en el código %: elige otro o déjalo sin plano.', v_codigo using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_materiales m
              where m.codigo_interno = v_codigo and m.material_id = p_material and m.plano_id is not distinct from p_plano
                and m.quitado_en is null and m.id is distinct from p_id) then
    raise exception 'Ese material ya está en la lista %: corrige su cantidad.',
      case when p_plano is null then 'sin plano' else 'del mismo plano' end using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.codigo_materiales (codigo_interno, material_id, cantidad, plano_id, observacion, creado_por)
    values (v_codigo, p_material, round(p_cantidad, 3), p_plano, v_obs, v_yo)
    returning id into v_id;
  else
    update public.codigo_materiales
       set material_id = p_material, cantidad = round(p_cantidad, 3), plano_id = p_plano, observacion = v_obs, actualizado_por = v_yo
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
comment on function public.guardar_material_codigo(uuid, text, uuid, numeric, uuid, text) is
  'Diseño agrega (p_id vacío) o corrige una línea de la lista de materiales de un código interno. Exige diseno.codigos.';
revoke all on function public.guardar_material_codigo(uuid, text, uuid, numeric, uuid, text) from public, anon;
grant execute on function public.guardar_material_codigo(uuid, text, uuid, numeric, uuid, text) to authenticated;

create or replace function public.quitar_material_codigo(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('diseno.codigos');
  update public.codigo_materiales set quitado_en = now(), quitado_por = public.usuario_actual()
   where id = p_id and quitado_en is null;
  if not exists (select 1 from public.codigo_materiales where id = p_id) then
    raise exception 'Esa línea no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  return p_id;
end;
$$;
revoke all on function public.quitar_material_codigo(uuid) from public, anon;
grant execute on function public.quitar_material_codigo(uuid) to authenticated;

-- 11. Las etapas: armarlas, marcarlas y quitarlas --------------------------------------------------
-- Las de siempre, como en la hoja «Control de plazos» y el orden del taller.
create or replace function public.etapas_de_siempre_codigo(p_codigo text)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text;
  v_n      integer;
begin
  perform public.exigir_permiso('diseno.codigos');
  v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  perform pg_advisory_xact_lock(hashtext('codigo_etapas:' || v_codigo));
  if exists (select 1 from public.codigo_etapas where codigo_interno = v_codigo and quitada_en is null) then
    raise exception 'El código % ya tiene etapas: agrega las que falten una por una.', v_codigo using errcode = 'check_violation';
  end if;
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, creado_por)
  select v_codigo, (coalesce((select max(e.orden) from public.codigo_etapas e where e.codigo_interno = v_codigo), 0) + x.n)::smallint,
         x.nombre, (select a.id from public.areas a where a.codigo = x.area), public.usuario_actual()
    from (values (1, 'Diseño y planos', 'DIS'), (2, 'Habilitado', 'MTZ'), (3, 'Armado', 'PRD'),
                 (4, 'Arenado y pintura', 'ACB'), (5, 'Trámites: homologación y tarjeta', null), (6, 'Entrega', null)) as x(n, nombre, area);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.etapas_de_siempre_codigo(text) from public, anon;
grant execute on function public.etapas_de_siempre_codigo(text) to authenticated;

create or replace function public.guardar_etapa_codigo(
  p_id uuid, p_codigo text, p_nombre text, p_area uuid, p_inicio_plan date, p_fin_plan date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_codigo text;
  v_etapa  public.codigo_etapas%rowtype;
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
begin
  perform public.exigir_permiso('diseno.codigos');
  if p_id is not null then
    select * into v_etapa from public.codigo_etapas where id = p_id for update;
    if not found or v_etapa.quitada_en is not null then
      raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
    end if;
    v_codigo := v_etapa.codigo_interno;
  else
    v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  end if;
  if char_length(v_nombre) not between 2 and 120 then
    raise exception 'Escribe el nombre de la etapa, por ejemplo Habilitado o Arenado y pintura.' using errcode = 'check_violation';
  end if;
  if p_area is not null and not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
    raise exception 'Elige el área que hace la etapa, o déjala sin área.' using errcode = 'check_violation';
  end if;
  if p_inicio_plan is not null and p_fin_plan is not null and p_fin_plan < p_inicio_plan then
    raise exception 'La fecha comprometida no puede ser anterior al inicio de la etapa.' using errcode = 'check_violation';
  end if;

  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('codigo_etapas:' || v_codigo));
    insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, creado_por)
    values (v_codigo, coalesce((select max(e.orden) from public.codigo_etapas e where e.codigo_interno = v_codigo), 0) + 1,
            v_nombre, p_area, p_inicio_plan, p_fin_plan, v_yo)
    returning id into v_id;
  else
    update public.codigo_etapas
       set nombre = v_nombre, area_id = p_area, inicio_plan = p_inicio_plan, fin_plan = p_fin_plan, actualizado_por = v_yo
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
comment on function public.guardar_etapa_codigo(uuid, text, text, uuid, date, date) is
  'Diseño agrega (p_id vacío) o corrige una etapa de un código interno: nombre, área, inicio y fecha comprometida. Exige diseno.codigos.';
revoke all on function public.guardar_etapa_codigo(uuid, text, text, uuid, date, date) from public, anon;
grant execute on function public.guardar_etapa_codigo(uuid, text, text, uuid, date, date) to authenticated;

-- Subir o bajar una etapa un lugar.
create or replace function public.mover_etapa_codigo(p_id uuid, p_arriba boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_etapa public.codigo_etapas%rowtype;
  v_otra  public.codigo_etapas%rowtype;
begin
  perform public.exigir_permiso('diseno.codigos');
  select * into v_etapa from public.codigo_etapas where id = p_id and quitada_en is null for update;
  if not found then
    raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  select * into v_otra from public.codigo_etapas e
   where e.codigo_interno = v_etapa.codigo_interno and e.quitada_en is null
     and case when p_arriba then e.orden < v_etapa.orden else e.orden > v_etapa.orden end
   order by case when p_arriba then -e.orden else e.orden end
   limit 1
   for update;
  if not found then
    return p_id;
  end if;
  update public.codigo_etapas set orden = v_otra.orden, actualizado_por = public.usuario_actual() where id = v_etapa.id;
  update public.codigo_etapas set orden = v_etapa.orden, actualizado_por = public.usuario_actual() where id = v_otra.id;
  return p_id;
end;
$$;
revoke all on function public.mover_etapa_codigo(uuid, boolean) from public, anon;
grant execute on function public.mover_etapa_codigo(uuid, boolean) to authenticated;

-- Empezó, terminó o se reabre. La marca Diseño, o el supervisor del área de la etapa.
-- Terminar después de la fecha comprometida pide escribir por qué.
create or replace function public.marcar_etapa_codigo(p_id uuid, p_paso text, p_fecha date, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_etapa public.codigo_etapas%rowtype;
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_nota  text := nullif(regexp_replace(btrim(coalesce(p_nota, '')), '\s+', ' ', 'g'), '');
  v_area  text;
  v_disena boolean := public.usuario_actual() is null or public.es_admin() or public.tiene_permiso('diseno.codigos');
begin
  perform public.exigir_ver_codigos_de_diseno();
  select * into v_etapa from public.codigo_etapas where id = p_id and quitada_en is null for update;
  if not found then
    raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  select nombre into v_area from public.areas where id = v_etapa.area_id;
  if not v_disena
     and not (public.tiene_permiso('codigos_internos.area') and v_etapa.area_id is not null and public.puede_hoja_de_area(v_etapa.area_id)) then
    raise exception 'La etapa «%» la marca Diseño%.', v_etapa.nombre,
      case when v_area is null then '' else ' o el supervisor de ' || v_area end using errcode = 'check_violation';
  end if;
  if p_paso not in ('INICIO', 'FIN', 'REABRIR') then
    raise exception 'No se reconoce lo que se quiere marcar en la etapa.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;

  if p_paso = 'REABRIR' then
    if v_etapa.fin_real is null then
      return p_id;
    end if;
    if char_length(coalesce(v_nota, '')) < 5 then
      raise exception 'Escribe por qué se reabre la etapa «%».', v_etapa.nombre using errcode = 'check_violation';
    end if;
    update public.codigo_etapas set fin_real = null, nota = v_nota, actualizado_por = public.usuario_actual() where id = p_id;
    return p_id;
  end if;

  if p_fecha is null then
    raise exception 'Escribe la fecha.' using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy then
    raise exception 'La fecha no puede ser posterior a hoy.' using errcode = 'check_violation';
  end if;
  if v_etapa.fin_real is not null then
    raise exception 'La etapa «%» ya terminó el %: reábrela si hay que corregirla.', v_etapa.nombre,
      to_char(v_etapa.fin_real, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;

  if p_paso = 'INICIO' then
    update public.codigo_etapas set inicio_real = p_fecha, nota = coalesce(v_nota, nota), actualizado_por = public.usuario_actual()
     where id = p_id;
  else
    if v_etapa.inicio_real is not null and p_fecha < v_etapa.inicio_real then
      raise exception 'La etapa «%» empezó el %: no puede terminar antes.', v_etapa.nombre,
        to_char(v_etapa.inicio_real, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
    if v_etapa.fin_plan is not null and p_fecha > v_etapa.fin_plan and char_length(coalesce(v_nota, '')) < 5 then
      raise exception 'La etapa «%» termina después de lo comprometido (%): escribe por qué se atrasó.', v_etapa.nombre,
        to_char(v_etapa.fin_plan, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
    update public.codigo_etapas
       set inicio_real = coalesce(inicio_real, p_fecha), fin_real = p_fecha, nota = coalesce(v_nota, nota),
           actualizado_por = public.usuario_actual()
     where id = p_id;
    if not v_disena then
      perform public.avisar_a_diseno(
        'Etapa terminada: ' || v_etapa.nombre || ' de ' || v_etapa.codigo_interno,
        coalesce(v_area, 'El área') || ' la marcó terminada el ' || to_char(p_fecha, 'DD/MM/YYYY') || '.',
        '/diseno/codigo?codigo=' || replace(replace(v_etapa.codigo_interno, '/', '%2F'), ' ', '+') || '&vista=etapas',
        'codigo_etapas', p_id);
    end if;
  end if;
  return p_id;
end;
$$;
comment on function public.marcar_etapa_codigo(uuid, text, date, text) is
  'Marca que una etapa de un código interno empezó (INICIO), terminó (FIN, con nota si va tarde) o se reabre (REABRIR, con nota). Diseño (diseno.codigos) o el supervisor del área de la etapa (codigos_internos.area).';
revoke all on function public.marcar_etapa_codigo(uuid, text, date, text) from public, anon;
grant execute on function public.marcar_etapa_codigo(uuid, text, date, text) to authenticated;

create or replace function public.quitar_etapa_codigo(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('diseno.codigos');
  update public.codigo_etapas set quitada_en = now(), quitada_por = public.usuario_actual()
   where id = p_id and quitada_en is null;
  if not exists (select 1 from public.codigo_etapas where id = p_id) then
    raise exception 'Esa etapa no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  return p_id;
end;
$$;
revoke all on function public.quitar_etapa_codigo(uuid) from public, anon;
grant execute on function public.quitar_etapa_codigo(uuid) to authenticated;

-- 12. Lo que se lee ----------------------------------------------------------------------------------
-- Los planos con su revisión vigente. Sin código, todos. El supervisor solo
-- recibe los de su área (la política de la tabla, repetida aquí porque la
-- función corre como dueña). En pantalla se nombra el área, no la persona.
create or replace function public.codigo_interno_planos(p_codigo text default null)
returns table (id uuid, codigo text, numero text, nombre text, area_id uuid, area text, area_codigo text,
               observacion text, creado_en timestamptz, anulado_en timestamptz, motivo_anulacion text,
               revisiones integer, revision_id uuid, revision smallint, nombre_archivo text, tamano_bytes integer,
               cambios text, subido_en timestamptz, recibido_en timestamptz, recibido_por_area text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_todo   boolean := public.usuario_actual() is null or public.es_admin() or public.tiene_permiso('diseno.codigos')
                      or public.tiene_permiso('codigos_internos.ver');
begin
  perform public.exigir_ver_codigos_de_diseno();
  return query
  select p.id, p.codigo_interno, p.numero, p.nombre, p.area_id, a.nombre::text, a.codigo::text, p.observacion, p.creado_en,
         p.anulado_en, p.motivo_anulacion,
         (select count(*)::integer from public.codigo_plano_revisiones x where x.plano_id = p.id),
         r.id, r.revision, r.nombre_archivo, r.tamano_bytes, r.cambios, r.subido_en, r.recibido_en,
         (select ar.nombre::text from public.usuarios u join public.areas ar on ar.id = u.area_id where u.id = r.recibido_por)
    from public.codigo_planos p
    join public.areas a on a.id = p.area_id
    left join lateral (
      select x.* from public.codigo_plano_revisiones x where x.plano_id = p.id order by x.revision desc limit 1) r on true
   where (v_codigo is null or p.codigo_interno = v_codigo)
     and (v_todo or public.puede_hoja_de_area(p.area_id))
   order by p.codigo_interno, p.anulado_en nulls first, a.nombre, p.numero;
end;
$$;
revoke all on function public.codigo_interno_planos(text) from public, anon;
grant execute on function public.codigo_interno_planos(text) to authenticated;

-- Todas las revisiones de un plano, de la más nueva a la primera.
create or replace function public.codigo_plano_historial(p_plano uuid)
returns table (id uuid, revision smallint, nombre_archivo text, tamano_bytes integer, cambios text, subido_en timestamptz,
               recibido_en timestamptz, recibido_por_area text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_ver_codigos_de_diseno();
  if not exists (select 1 from public.codigo_interno_planos(null) p where p.id = p_plano) then
    return;
  end if;
  return query
  select r.id, r.revision, r.nombre_archivo, r.tamano_bytes, r.cambios, r.subido_en, r.recibido_en,
         (select ar.nombre::text from public.usuarios u join public.areas ar on ar.id = u.area_id where u.id = r.recibido_por)
    from public.codigo_plano_revisiones r
   where r.plano_id = p_plano
   order by r.revision desc;
end;
$$;
revoke all on function public.codigo_plano_historial(uuid) from public, anon;
grant execute on function public.codigo_plano_historial(uuid) to authenticated;

-- La lista de materiales de un código, con lo comprado y lo salido del almacén
-- de cada material para el código (la misma cuenta del costeo: salidas menos
-- devoluciones, y OC no rechazadas).
create or replace function public.codigo_interno_materiales(p_codigo text)
returns table (id uuid, material_id uuid, material_codigo text, material text, unidad text, cantidad numeric,
               plano_id uuid, plano text, plano_anulado boolean, observacion text, creado_en timestamptz,
               actualizado_en timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  if v_codigo is null then
    return;
  end if;
  return query
  select m.id, m.material_id, mat.codigo::text, mat.descripcion::text, um.codigo::text, m.cantidad, m.plano_id,
         case when p.id is null then null else p.numero || ' · ' || p.nombre || ' (' || a.nombre || ')' end::text,
         p.anulado_en is not null, m.observacion, m.creado_en, m.actualizado_en
    from public.codigo_materiales m
    join public.materiales mat on mat.id = m.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
    left join public.codigo_planos p on p.id = m.plano_id
    left join public.areas a on a.id = p.area_id
   where m.codigo_interno = v_codigo and m.quitado_en is null
   order by p.numero nulls last, mat.descripcion;
end;
$$;
revoke all on function public.codigo_interno_materiales(text) from public, anon;
grant execute on function public.codigo_interno_materiales(text) to authenticated;

-- Material por material: lo que dice Diseño, lo comprado y lo salido del almacén
-- para el código. También lo comprado o salido que Diseño no puso en la lista.
create or replace function public.codigo_interno_materiales_comparados(p_codigo text)
returns table (material_id uuid, material_codigo text, material text, unidad text,
               disenado numeric, comprado numeric, salido numeric, en_la_lista boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  if v_codigo is null then
    return;
  end if;
  return query
  with lista as (
    select m.material_id, sum(m.cantidad) as cantidad
      from public.codigo_materiales m
     where m.codigo_interno = v_codigo and m.quitado_en is null
     group by m.material_id
  ), compra as (
    select d.material_id, sum(d.cantidad) as cantidad
      from public.ordenes_compra_materiales c
      join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
     where public.normalizar_codigo_interno(c.codigo_interno) = v_codigo and c.aprobacion <> 'RECHAZADA'
       and d.material_id is not null
     group by d.material_id
  ), salida as (
    select mv.material_id, sum(l.cantidad) as cantidad
      from public.codigo_interno_lineas(v_codigo, false) l
      join public.movimientos_materiales mv on mv.id = l.referencia_id
     where l.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO')
     group by mv.material_id
  ), todos as (
    select x.material_id from lista x union select c.material_id from compra c union select s.material_id from salida s
  )
  select t.material_id, mat.codigo::text, mat.descripcion::text, um.codigo::text,
         l.cantidad, coalesce(c.cantidad, 0), coalesce(s.cantidad, 0), l.material_id is not null
    from todos t
    join public.materiales mat on mat.id = t.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
    left join lista l on l.material_id = t.material_id
    left join compra c on c.material_id = t.material_id
    left join salida s on s.material_id = t.material_id
   order by (l.material_id is null), mat.descripcion;
end;
$$;
revoke all on function public.codigo_interno_materiales_comparados(text) from public, anon;
grant execute on function public.codigo_interno_materiales_comparados(text) to authenticated;

-- Lo que se pidió por requerimiento para el código: los RQ escriben el insumo
-- con sus palabras, así que van aparte y no se cruzan con el catálogo.
create or replace function public.codigo_interno_lo_pedido(p_codigo text)
returns table (requerimiento_id uuid, numero text, estado text, area text, fecha date, item smallint,
               descripcion text, cantidad numeric, unidad text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  if v_codigo is null then
    return;
  end if;
  return query
  select r.id, r.numero::text, r.estado::text, a.nombre::text, (r.creado_en at time zone 'America/Lima')::date,
         l.item::smallint, l.descripcion::text, l.cantidad, um.codigo::text
    from public.requerimientos r
    join public.requerimiento_lineas l on l.requerimiento_id = r.id
    left join public.areas a on a.id = r.area_id
    left join public.unidades_medida um on um.id = l.unidad_medida_id
   where public.normalizar_codigo_interno(r.codigo_interno) = v_codigo and r.estado <> 'ANULADO'
   order by r.creado_en desc, l.item;
end;
$$;
revoke all on function public.codigo_interno_lo_pedido(text) from public, anon;
grant execute on function public.codigo_interno_lo_pedido(text) to authenticated;

-- Las etapas con lo que dice el reporte diario de su área para el código: el
-- primer y el último reporte, cuántos, y el promedio del último avance de cada
-- trabajo (la misma regla del avance de Gerencia). Sin código, todas.
create or replace function public.codigo_interno_etapas(p_codigo text default null)
returns table (id uuid, codigo text, orden smallint, nombre text, area_id uuid, area text, area_codigo text,
               inicio_plan date, fin_plan date, inicio_real date, fin_real date, nota text, actualizado_en timestamptz,
               reportes integer, primer_reporte date, ultimo_reporte date, avance_reportado numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  return query
  with etapa as (
    select e.* from public.codigo_etapas e
     where e.quitada_en is null and (v_codigo is null or e.codigo_interno = v_codigo)
  ), reporte as (
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, r.area_id, r.id, r.fecha, r.creado_en
      from public.reportes_diarios r
     where r.anulado_en is null and r.area_id is not null
       and (v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo)
  ), por_area as (
    select r.codigo, r.area_id, count(*)::integer as reportes, min(r.fecha) as primero, max(r.fecha) as ultimo
      from reporte r group by r.codigo, r.area_id
  ), ultimo as (
    select distinct on (r.codigo, r.area_id, lower(regexp_replace(btrim(t.descripcion), '\s+', ' ', 'g')))
           r.codigo, r.area_id, t.avance
      from reporte r
      join public.reporte_diario_trabajos t on t.reporte_id = r.id
     order by r.codigo, r.area_id, lower(regexp_replace(btrim(t.descripcion), '\s+', ' ', 'g')), r.fecha desc, r.creado_en desc, t.orden
  ), avance as (
    select u.codigo, u.area_id, round(avg(u.avance))::numeric as avance from ultimo u group by u.codigo, u.area_id
  )
  select e.id, e.codigo_interno, e.orden, e.nombre, e.area_id, a.nombre::text, a.codigo::text,
         e.inicio_plan, e.fin_plan, e.inicio_real, e.fin_real, e.nota, e.actualizado_en,
         coalesce(pa.reportes, 0), pa.primero, pa.ultimo, av.avance
    from etapa e
    left join public.areas a on a.id = e.area_id
    left join por_area pa on pa.codigo = e.codigo_interno and pa.area_id = e.area_id
    left join avance av on av.codigo = e.codigo_interno and av.area_id = e.area_id
   order by e.codigo_interno, e.orden;
end;
$$;
revoke all on function public.codigo_interno_etapas(text) from public, anon;
grant execute on function public.codigo_interno_etapas(text) to authenticated;

-- Todos los códigos de unidad que conoce el sistema, con lo que Diseño lleva
-- en cada uno: para que Diseño elija el código y Gerencia lo sume a su lista.
-- La etapa en curso es la primera, en su orden, que no terminó.
create or replace function public.codigos_internos_de_diseno()
returns table (codigo text, unidad text, planos integer, planos_por_recibir integer, materiales integer,
               etapas integer, etapas_terminadas integer, etapas_vencidas integer, etapa_actual text,
               etapa_actual_area text, etapa_actual_fin date, ultimo_cambio timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('diseno.codigos') or public.tiene_permiso('codigos_internos.ver')) then
    raise exception 'No tienes permiso para ver los códigos internos de Diseño.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with conocido as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo from public.unidades u where u.activo and u.codigo_interno is not null
    union select public.normalizar_codigo_interno(r.codigo_interno) from public.requerimientos r where r.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(c.codigo_interno) from public.ordenes_compra_materiales c
           where c.codigo_interno is not null and c.aprobacion <> 'RECHAZADA'
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select p.codigo_interno from public.codigo_planos p
    union select m.codigo_interno from public.codigo_materiales m where m.quitado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
  ), unidad as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto
      from public.unidades u where u.codigo_interno is not null group by 1
  ), plano as (
    select p.codigo_interno as codigo, count(*)::integer as planos,
           count(*) filter (where r.recibido_en is null)::integer as por_recibir,
           max(greatest(p.actualizado_en, r.subido_en, r.recibido_en)) as cambio
      from public.codigo_planos p
      left join lateral (select x.* from public.codigo_plano_revisiones x where x.plano_id = p.id order by x.revision desc limit 1) r on true
     where p.anulado_en is null
     group by p.codigo_interno
  ), material as (
    select m.codigo_interno as codigo, count(*)::integer as materiales, max(m.actualizado_en) as cambio
      from public.codigo_materiales m where m.quitado_en is null group by m.codigo_interno
  ), etapa as (
    select e.codigo_interno as codigo, count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           count(*) filter (where e.fin_real is null and e.fin_plan < v_hoy)::integer as vencidas,
           max(e.actualizado_en) as cambio
      from public.codigo_etapas e where e.quitada_en is null group by e.codigo_interno
  ), actual as (
    select distinct on (e.codigo_interno) e.codigo_interno as codigo, e.nombre, a.nombre as area, e.fin_plan
      from public.codigo_etapas e
      left join public.areas a on a.id = e.area_id
     where e.quitada_en is null and e.fin_real is null
     order by e.codigo_interno, e.orden
  )
  select c.codigo, u.texto, coalesce(p.planos, 0), coalesce(p.por_recibir, 0), coalesce(m.materiales, 0),
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0), coalesce(e.vencidas, 0), ac.nombre::text, ac.area::text, ac.fin_plan,
         nullif(greatest(coalesce(p.cambio, '-infinity'), coalesce(m.cambio, '-infinity'), coalesce(e.cambio, '-infinity')), '-infinity')
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
    left join material m on m.codigo = c.codigo
    left join etapa e on e.codigo = c.codigo
    left join actual ac on ac.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
   order by 12 desc nulls last, 1;
end;
$$;
comment on function public.codigos_internos_de_diseno() is
  'Los códigos de unidad que conoce el sistema con los planos, materiales y etapas que Diseño lleva en cada uno. Para Diseño (diseno.codigos) y Gerencia (codigos_internos.ver).';
revoke all on function public.codigos_internos_de_diseno() from public, anon;
grant execute on function public.codigos_internos_de_diseno() to authenticated;
