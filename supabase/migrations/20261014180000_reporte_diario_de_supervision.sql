-- =============================================================================
-- SUPERVISIÓN: EL REPORTE DIARIO, Y SUS HORAS AL COSTEO DE RECURSOS HUMANOS
-- -----------------------------------------------------------------------------
-- Hoy cada supervisor escribe su día en HORAS HOMBRE (HH) -Supervisores -
-- 2026.xlsx: una columna por día con texto libre y la unidad entre paréntesis
-- («(30-34)», «(2921)»), y RR. HH. tiene que leerlo para saber quién trabajó en
-- qué. La orden de trabajo todavía no está del todo en el sistema, y Gerencia
-- pidió (2026-10-14) que mientras tanto el supervisor suba su REPORTE DIARIO:
--
--   * Un ASUNTO y una breve DESCRIPCIÓN de lo que cuenta el reporte, y el
--     CÓDIGO INTERNO de la unidad (PLA_SR_O4_1_26/28, o PLANTA): es la clave
--     del costeo. Si el supervisor trabajó en dos códigos, sube dos reportes.
--   * Los TRABAJOS REALIZADOS: qué se hizo y el porcentaje de avance de cada uno.
--   * El PERSONAL que usó, de la lista de Personal de RR. HH., con sus HORAS:
--     por trabajo, o como personal general de todo el reporte.
--   * Hasta TRES FOTOS, comprimidas en el teléfono antes de subirse.
--
-- Las horas de cada persona pasan solas al TAREO de RR. HH. (20261014160000)
-- con el código interno del reporte y la tarifa de siempre: el costo mensual
-- de la persona entre 240. Si RR. HH. todavía no le puso su costo mensual, las
-- horas esperan y entran solas cuando lo ponga. El tareo sabe de qué línea del
-- reporte vino, y RR. HH. lo ve marcado así.
--
-- El supervisor ve del personal solo el nombre y el cargo, nunca el costo. El
-- reporte y sus fotos los ven quien lo subió, RR. HH. y Gerencia. Un reporte no
-- se borra ni se corrige: se anula con su motivo y sus horas salen del costeo.
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('reporte_diario.registrar', 'Supervisión',
   'Subir el reporte diario: trabajos y su avance, el personal con sus horas y hasta tres fotos'),
  ('reporte_diario.ver', 'Supervisión',
   'Consultar los reportes diarios de todos los supervisores, con su personal y sus fotos')
on conflict (codigo) do nothing;

-- Lo suben los supervisores de área (y el jefe de producción, que también
-- reporta); lo consultan RR. HH., que costea con él, y Gerencia.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo in ('SUPERVISOR', 'JEFE_PRODUCCION') and p.codigo = 'reporte_diario.registrar')
    or (r.codigo in ('RECURSOS_HUMANOS', 'GERENTE') and p.codigo = 'reporte_diario.ver')
on conflict do nothing;

-- 2. El reporte -----------------------------------------------------------------------
create table if not exists public.reportes_diarios (
  id                uuid primary key default gen_random_uuid(),
  fecha             date not null,
  codigo_interno    text not null,
  asunto            text not null,
  descripcion       text not null,
  -- true: el personal va una vez para todo el reporte; false: cada trabajo con el suyo.
  personal_general  boolean not null default false,
  area_id           uuid references public.areas(id) on delete restrict,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_reporte_diario_textos check (
    char_length(codigo_interno) between 2 and 60
    and char_length(btrim(asunto)) between 3 and 120
    and char_length(btrim(descripcion)) between 3 and 1000),
  constraint ck_reporte_diario_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.reportes_diarios is
  'El reporte diario del supervisor: asunto, descripción y código interno; sus trabajos, el personal con sus horas y hasta tres fotos. No se borra: se anula.';
comment on column public.reportes_diarios.area_id is 'El área de la cuenta que lo subió: en pantalla se nombra el área, no la persona.';

-- La lista de RR. HH. y Gerencia se lee por mes; la del supervisor, sus propios
-- reportes (es el filtro de su política, y sirve a la llave de registrado_por).
-- area_id y anulado_por: ni (a) ni (b) ni (c); sin índice.
create index if not exists ix_reportes_diarios_fecha on public.reportes_diarios (fecha desc);
create index if not exists ix_reportes_diarios_autor on public.reportes_diarios (registrado_por, fecha desc);

select public.activar_timestamps('reportes_diarios');
select public.activar_auditoria('reportes_diarios');
select public.activar_registro_de_prueba('reportes_diarios');

-- 3. Los trabajos realizados ----------------------------------------------------------
create table if not exists public.reporte_diario_trabajos (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null,
  orden           smallint not null,
  descripcion     text not null,
  avance          smallint not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint reporte_diario_trabajos_reporte_id_fkey foreign key (reporte_id) references public.reportes_diarios(id) on delete restrict,
  -- También es el índice de la llave hacia el reporte.
  constraint uq_reporte_diario_trabajo unique (reporte_id, orden),
  constraint ck_reporte_diario_trabajo check (
    orden between 1 and 20
    and char_length(btrim(descripcion)) between 3 and 500
    and avance between 0 and 100)
);
comment on table public.reporte_diario_trabajos is 'Cada trabajo realizado del reporte diario, con su porcentaje de avance.';

select public.activar_timestamps('reporte_diario_trabajos');
select public.activar_auditoria('reporte_diario_trabajos');
select public.activar_registro_de_prueba('reporte_diario_trabajos');

-- 4. El personal con sus horas ----------------------------------------------------------
create table if not exists public.reporte_diario_personal (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null,
  -- Vacío cuando el personal es general para todo el reporte.
  trabajo_id      uuid,
  trabajador_id   uuid not null references public.trabajadores(id) on delete restrict,
  -- El nombre y el cargo como estaban ese día: el supervisor no lee la ficha de RR. HH.
  nombre          text not null,
  cargo           text,
  -- El día del reporte, repetido aquí para sumar las horas de una persona en el día.
  fecha           date not null,
  horas           numeric(4, 2) not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint reporte_diario_personal_reporte_id_fkey foreign key (reporte_id) references public.reportes_diarios(id) on delete restrict,
  constraint reporte_diario_personal_trabajo_id_fkey foreign key (trabajo_id) references public.reporte_diario_trabajos(id) on delete restrict,
  constraint ck_reporte_diario_personal check (horas >= 0.25 and horas <= 16)
);
comment on table public.reporte_diario_personal is
  'Quién trabajó y cuántas horas, por trabajo o para todo el reporte. Cada línea pasa al tareo de RR. HH. con su costo.';

-- Una persona una vez por trabajo (o una vez en el personal general). Empieza por
-- reporte_id: es también el índice de esa llave. La de trabajo_id no lleva
-- índice: ni (a) ni (b) ni (c) — la pantalla lee las líneas por reporte.
create unique index if not exists uq_reporte_diario_personal
  on public.reporte_diario_personal (reporte_id, coalesce(trabajo_id, '00000000-0000-0000-0000-000000000000'::uuid), trabajador_id);
-- Las horas de una persona en un día (el tope de 16) y sus horas que esperan
-- costo cuando RR. HH. se lo pone (b); sirve también a la llave del trabajador.
create index if not exists ix_reporte_diario_personal_trabajador on public.reporte_diario_personal (trabajador_id, fecha);

select public.activar_timestamps('reporte_diario_personal');
select public.activar_auditoria('reporte_diario_personal');
select public.activar_registro_de_prueba('reporte_diario_personal');

-- 5. Las fotos ----------------------------------------------------------------------------
create table if not exists public.reporte_diario_fotos (
  id              uuid primary key default gen_random_uuid(),
  reporte_id      uuid not null,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint reporte_diario_fotos_reporte_id_fkey foreign key (reporte_id) references public.reportes_diarios(id) on delete restrict,
  -- También es el índice de la llave hacia el reporte.
  constraint uq_reporte_diario_foto_orden unique (reporte_id, orden),
  -- Una foto, un reporte; y la política de Storage la busca por su ruta.
  constraint uq_reporte_diario_foto_ruta unique (ruta),
  constraint ck_reporte_diario_foto check (
    orden between 1 and 3
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.reporte_diario_fotos is
  'Hasta tres fotos del reporte diario, en el bucket fotos-reporte-diario con la ruta {cuenta}/{reporte}/….';

select public.activar_timestamps('reporte_diario_fotos');
select public.activar_auditoria('reporte_diario_fotos');
select public.activar_registro_de_prueba('reporte_diario_fotos');

-- 6. El tareo sabe de qué línea del reporte vino ----------------------------------------
alter table public.tareos add column if not exists reporte_linea_id uuid;
comment on column public.tareos.reporte_linea_id is
  'La línea del reporte diario de la que salieron estas horas. Vacío: las cargó RR. HH. a mano.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tareos_reporte_linea_id_fkey') then
    alter table public.tareos add constraint tareos_reporte_linea_id_fkey
      foreign key (reporte_linea_id) references public.reporte_diario_personal(id) on delete restrict;
  end if;
end $$;
-- Una línea, un tareo; y así se sabe qué líneas esperan todavía su costo (b).
create unique index if not exists uq_tareos_reporte_linea on public.tareos (reporte_linea_id) where reporte_linea_id is not null;

-- 7. Lo que no se borra ni se corrige -------------------------------------------------------
create or replace function public.fn_reporte_diario_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte diario no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese reporte está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'])
     is distinct from (to_jsonb(old) - array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en']) then
    raise exception 'Un reporte ya subido no se corrige: anúlalo con su motivo y súbelo de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_reporte_diario_guardia() from public, anon, authenticated;
create or replace trigger trg_reporte_diario_guardia
  before update or delete on public.reportes_diarios
  for each row execute function public.fn_reporte_diario_guardia();

create or replace function public.fn_reporte_diario_detalle_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Lo que dice un reporte diario no se cambia ni se borra: anula el reporte y súbelo de nuevo.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_reporte_diario_detalle_guardia() from public, anon, authenticated;
create or replace trigger trg_reporte_diario_trabajo_guardia
  before update or delete on public.reporte_diario_trabajos
  for each row execute function public.fn_reporte_diario_detalle_guardia();
create or replace trigger trg_reporte_diario_personal_guardia
  before update or delete on public.reporte_diario_personal
  for each row execute function public.fn_reporte_diario_detalle_guardia();
create or replace trigger trg_reporte_diario_foto_guardia
  before update or delete on public.reporte_diario_fotos
  for each row execute function public.fn_reporte_diario_detalle_guardia();

-- 8. Quién ve qué ----------------------------------------------------------------------------
alter table public.reportes_diarios enable row level security;
alter table public.reporte_diario_trabajos enable row level security;
alter table public.reporte_diario_personal enable row level security;
alter table public.reporte_diario_fotos enable row level security;
do $$ begin
  -- Quien lo subió, RR. HH. y Gerencia (reporte_diario.ver).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reportes_diarios' and policyname = 'ver_reportes_diarios') then
    create policy ver_reportes_diarios on public.reportes_diarios for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('reporte_diario.ver'))
             or registrado_por = (select public.usuario_actual()));
  end if;
  -- El detalle, a quien ve el reporte: la consulta al reporte pasa por su política.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reporte_diario_trabajos' and policyname = 'ver_reporte_diario_trabajos') then
    create policy ver_reporte_diario_trabajos on public.reporte_diario_trabajos for select to authenticated
      using (exists (select 1 from public.reportes_diarios r where r.id = reporte_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reporte_diario_personal' and policyname = 'ver_reporte_diario_personal') then
    create policy ver_reporte_diario_personal on public.reporte_diario_personal for select to authenticated
      using (exists (select 1 from public.reportes_diarios r where r.id = reporte_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reporte_diario_fotos' and policyname = 'ver_reporte_diario_fotos') then
    create policy ver_reporte_diario_fotos on public.reporte_diario_fotos for select to authenticated
      using (exists (select 1 from public.reportes_diarios r where r.id = reporte_id));
  end if;
end $$;
revoke all on public.reportes_diarios from public, anon, authenticated;
revoke all on public.reporte_diario_trabajos from public, anon, authenticated;
revoke all on public.reporte_diario_personal from public, anon, authenticated;
revoke all on public.reporte_diario_fotos from public, anon, authenticated;
grant select on public.reportes_diarios to authenticated;
grant select on public.reporte_diario_trabajos to authenticated;
grant select on public.reporte_diario_personal to authenticated;
grant select on public.reporte_diario_fotos to authenticated;

-- 9. Las fotos en Storage ------------------------------------------------------------------
-- Ya comprimidas en el teléfono pesan unos cientos de KB: 5 MB es de sobra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-reporte-diario', 'fotos-reporte-diario', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- La ruta es {cuenta}/{reporte}/{foto}: cada supervisor sube solo a su carpeta.
-- La foto la ve quien la subió y quien ve el reporte que la nombra; una foto
-- suelta (subida y quitada del formulario) la retira su dueño mientras ningún
-- reporte la nombre. Las políticas se crean una vez y se cambian con alter.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'reporte_diario_subir_foto') then
    create policy reporte_diario_subir_foto on storage.objects for insert to authenticated with check (
      bucket_id = 'fotos-reporte-diario' and owner_id = (select auth.uid())::text
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (select public.tiene_permiso('reporte_diario.registrar')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'reporte_diario_ver_foto') then
    create policy reporte_diario_ver_foto on storage.objects for select to authenticated using (
      bucket_id = 'fotos-reporte-diario'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.reporte_diario_fotos f where f.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'reporte_diario_quitar_foto_suelta') then
    create policy reporte_diario_quitar_foto_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fotos-reporte-diario' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.reporte_diario_fotos f where f.ruta = objects.name));
  end if;
end $$;

-- 10. Las horas de una persona en un día --------------------------------------------------------
-- Lo cargado en el tareo más lo que espera en un reporte vigente a que RR. HH.
-- le ponga el costo. El tope de 16 horas mira las dos cosas.
create or replace function public.rrhh_horas_del_dia(p_trabajador_id uuid, p_fecha date)
returns numeric language sql stable set search_path to 'public' as $$
  select coalesce((select sum(t.horas) from public.tareos t
                    where t.trabajador_id = p_trabajador_id and t.fecha = p_fecha and t.anulado_en is null), 0)
       + coalesce((select sum(l.horas) from public.reporte_diario_personal l
                     join public.reportes_diarios r on r.id = l.reporte_id
                    where l.trabajador_id = p_trabajador_id and l.fecha = p_fecha and r.anulado_en is null
                      and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)), 0);
$$;
revoke all on function public.rrhh_horas_del_dia(uuid, date) from public, anon, authenticated;

-- El tareo a mano de RR. HH. cuenta también las horas que esperan en un reporte.
-- Igual que en 20261014160000, salvo esa suma.
create or replace function public.rrhh_registrar_tareo(
  p_id uuid, p_trabajador_id uuid, p_fecha date, p_codigo_interno text, p_horas numeric, p_labor text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_trab    public.trabajadores%rowtype;
  v_costo   numeric(10, 2);
  v_codigo  text := upper(btrim(coalesce(p_codigo_interno, '')));
  v_labor   text := nullif(btrim(coalesce(p_labor, '')), '');
  v_horas   numeric(4, 2) := round(coalesce(p_horas, 0), 2);
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_ya      numeric;
  v_hora    numeric(10, 4);
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de horas.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.tareos where id = p_id) then return p_id; end if;

  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día trabajado: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 366 then
    raise exception 'Ese día tiene más de un año: revisa la fecha.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno (de 2 a 60 caracteres), por ejemplo PLA_SR_O4_1_26/28 o PLANTA.' using errcode = 'check_violation';
  end if;
  if v_horas <= 0 or v_horas > 16 then
    raise exception 'Las horas van de 0,25 a 16.' using errcode = 'check_violation';
  end if;
  if v_labor is not null and char_length(v_labor) > 200 then
    raise exception 'La labor pasa de 200 caracteres.' using errcode = 'check_violation';
  end if;

  select costo_mensual into v_costo from public.trabajador_costos where trabajador_id = p_trabajador_id;
  if v_costo is null then
    raise exception 'Primero pon el costo mensual de % en su ficha de Personal.', v_trab.nombres || ' ' || v_trab.apellidos
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tareo:' || p_trabajador_id::text, 0));
  v_ya := public.rrhh_horas_del_dia(p_trabajador_id, p_fecha);
  if v_ya + v_horas > 16 then
    raise exception '% ya tiene % h cargadas el %: con estas pasaría de 16 horas en el día.',
      v_trab.nombres || ' ' || v_trab.apellidos, rtrim(rtrim(to_char(v_ya, 'FM990.00'), '0'), '.'), to_char(p_fecha, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  v_hora := round(v_costo / 240, 4);
  insert into public.tareos (id, trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
  values (p_id, p_trabajador_id, p_fecha, v_codigo, v_horas, v_labor, v_hora, round(v_horas * v_hora, 2));
  return p_id;
end;
$$;
revoke all on function public.rrhh_registrar_tareo(uuid, uuid, date, text, numeric, text) from public, anon;
grant execute on function public.rrhh_registrar_tareo(uuid, uuid, date, text, numeric, text) to authenticated;

-- 11. El personal que el supervisor puede elegir -------------------------------------------------
-- El activo de RR. HH., con nombre, cargo y área: nada de DNI, cuenta ni costo.
create or replace function public.reporte_diario_personal_disponible()
returns table (id uuid, nombres text, apellidos text, cargo text, area_id uuid, area text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  return query
    select t.id, t.nombres, t.apellidos, t.cargo, t.area_id, a.nombre
      from public.trabajadores t
      left join public.areas a on a.id = t.area_id
     where t.activo
     order by t.apellidos, t.nombres;
end;
$$;
revoke all on function public.reporte_diario_personal_disponible() from public, anon;
grant execute on function public.reporte_diario_personal_disponible() to authenticated;

-- Los códigos internos que ya usa la empresa, ahora también para el supervisor
-- y contando los de los reportes diarios. Solo devuelve los códigos.
create or replace function public.rrhh_codigos_internos()
returns table (codigo text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('reporte_diario.registrar')) then
    raise exception 'No tiene permiso para consultar los códigos internos.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c from (
      select upper(btrim(r.codigo_interno)) as c from public.requerimientos r
      union select upper(btrim(o.codigo_interno)) from public.ordenes_compra_materiales o where o.codigo_interno is not null
      union select upper(btrim(u.codigo_interno)) from public.unidades u where u.codigo_interno is not null
      union select upper(btrim(v.codigo_interno)) from public.registro_vehiculos v where v.codigo_interno is not null
      union select t.codigo_interno from public.tareos t where t.anulado_en is null
      union select d.codigo_interno from public.reportes_diarios d where d.anulado_en is null
    ) x
    where char_length(c) between 2 and 60
    order by c
    limit 500;
end;
$$;
revoke all on function public.rrhh_codigos_internos() from public, anon;
grant execute on function public.rrhh_codigos_internos() to authenticated;

-- 12. Subir el reporte --------------------------------------------------------------------------
-- Una persona del reporte: su línea y, si ya tiene costo mensual, su tareo.
-- La llama solo registrar_reporte_diario, que ya exigió el permiso.
create or replace function public.reporte_diario_agregar_persona(
  p_reporte public.reportes_diarios, p_trabajo_id uuid, p_labor text, p_persona jsonb
) returns void language plpgsql set search_path to 'public' as $$
declare
  v_id     uuid;
  v_trab   public.trabajadores%rowtype;
  v_nombre text;
  v_horas  numeric;
  v_ya     numeric;
  v_costo  numeric(10, 2);
  v_hora   numeric(10, 4);
  v_linea  uuid;
begin
  begin
    v_id := (p_persona->>'trabajador_id')::uuid;
    v_horas := round((p_persona->>'horas')::numeric, 2);
  exception when others then
    raise exception 'Revisa el personal: cada persona va con sus horas.' using errcode = 'check_violation';
  end;
  select * into v_trab from public.trabajadores where id = v_id;
  if not found then
    raise exception 'Elige al personal de la lista de Recursos Humanos.' using errcode = 'check_violation';
  end if;
  v_nombre := v_trab.nombres || ' ' || v_trab.apellidos;
  if not v_trab.activo then
    raise exception '% ya no está en el personal activo.', v_nombre using errcode = 'check_violation';
  end if;
  if v_horas is null or v_horas < 0.25 or v_horas > 16 then
    raise exception 'Las horas de % van de 0,25 a 16.', v_nombre using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.reporte_diario_personal
              where reporte_id = p_reporte.id and trabajador_id = v_id and trabajo_id is not distinct from p_trabajo_id) then
    raise exception '% está dos veces en el mismo %.', v_nombre,
      case when p_trabajo_id is null then 'personal general' else 'trabajo' end using errcode = 'check_violation';
  end if;

  -- El mismo candado que el tareo a mano: las dos cosas suman al tope del día.
  perform pg_advisory_xact_lock(hashtextextended('tareo:' || v_id::text, 0));
  v_ya := public.rrhh_horas_del_dia(v_id, p_reporte.fecha);
  if v_ya + v_horas > 16 then
    raise exception '% ya tiene % h el %: con estas pasaría de 16 horas en el día.',
      v_nombre, rtrim(rtrim(to_char(v_ya, 'FM990.00'), '0'), '.'), to_char(p_reporte.fecha, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  insert into public.reporte_diario_personal (reporte_id, trabajo_id, trabajador_id, nombre, cargo, fecha, horas)
  values (p_reporte.id, p_trabajo_id, v_id, v_nombre, v_trab.cargo, p_reporte.fecha, v_horas)
  returning id into v_linea;

  -- Sin costo mensual la línea espera: entra al tareo cuando RR. HH. lo ponga.
  select costo_mensual into v_costo from public.trabajador_costos where trabajador_id = v_id;
  if v_costo is not null then
    v_hora := round(v_costo / 240, 4);
    insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, registrado_por, reporte_linea_id)
    values (v_id, p_reporte.fecha, p_reporte.codigo_interno, v_horas, left(p_labor, 200), v_hora, round(v_horas * v_hora, 2),
            p_reporte.registrado_por, v_linea);
  end if;
end;
$$;
revoke all on function public.reporte_diario_agregar_persona(public.reportes_diarios, uuid, text, jsonb) from public, anon, authenticated;

-- p_trabajos: [{"descripcion": "…", "avance": 40, "personal": [{"trabajador_id": "…", "horas": 4}]}]
-- p_personal_general: [{"trabajador_id": "…", "horas": 8}] — si trae gente, el
--   personal es de todo el reporte y los trabajos van sin el suyo.
-- p_fotos: ["{cuenta}/{reporte}/{foto}.jpg", …], ya subidas a fotos-reporte-diario.
-- Un reintento con el mismo p_id devuelve el reporte ya subido.
create or replace function public.registrar_reporte_diario(
  p_id uuid, p_fecha date, p_codigo_interno text, p_asunto text, p_descripcion text,
  p_trabajos jsonb, p_personal_general jsonb default null, p_fotos jsonb default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_codigo   text := upper(btrim(coalesce(p_codigo_interno, '')));
  v_asunto   text := btrim(coalesce(p_asunto, ''));
  v_desc     text := btrim(coalesce(p_descripcion, ''));
  v_general  boolean := coalesce(jsonb_typeof(p_personal_general) = 'array' and jsonb_array_length(p_personal_general) > 0, false);
  v_fotos    jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_reporte  public.reportes_diarios%rowtype;
  v_trabajo  jsonb;
  v_persona  jsonb;
  v_orden    int := 0;
  v_tid      uuid;
  v_tdesc    text;
  v_avance   numeric;
  v_ruta     text;
  v_objeto   storage.objects%rowtype;
  v_nfoto    int := 0;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  if p_id is null or v_yo is null then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;
  select * into v_reporte from public.reportes_diarios where id = p_id;
  if found then
    if v_reporte.registrado_por = v_yo then return p_id; end if;
    raise exception 'Ese reporte ya existe: vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;

  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día del reporte: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 7 then
    raise exception 'El reporte se sube hasta 7 días después; para uno más antiguo, habla con Recursos Humanos.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno (de 2 a 60 caracteres), por ejemplo PLA_SR_O4_1_26/28 o PLANTA.' using errcode = 'check_violation';
  end if;
  if char_length(v_asunto) not between 3 and 120 then
    raise exception 'Escribe el asunto del reporte (de 3 a 120 caracteres).' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 3 and 1000 then
    raise exception 'Escribe una breve descripción del reporte (de 3 a 1000 caracteres).' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_trabajos) is distinct from 'array' or jsonb_array_length(p_trabajos) = 0 then
    raise exception 'Anota al menos un trabajo realizado.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_trabajos) > 20 then
    raise exception 'Un reporte lleva hasta 20 trabajos.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_fotos) <> 'array' or jsonb_array_length(v_fotos) > 3 then
    raise exception 'Un reporte lleva hasta 3 fotos.' using errcode = 'check_violation';
  end if;

  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, personal_general, area_id, registrado_por)
  values (p_id, p_fecha, v_codigo, v_asunto, v_desc, v_general, (select u.area_id from public.usuarios u where u.id = v_yo), v_yo)
  returning * into v_reporte;

  for v_trabajo in select * from jsonb_array_elements(p_trabajos) loop
    v_orden := v_orden + 1;
    v_tdesc := btrim(coalesce(v_trabajo->>'descripcion', ''));
    if char_length(v_tdesc) not between 3 and 500 then
      raise exception 'Describe el trabajo % (de 3 a 500 caracteres).', v_orden using errcode = 'check_violation';
    end if;
    begin
      v_avance := (v_trabajo->>'avance')::numeric;
    exception when others then
      v_avance := null;
    end;
    if v_avance is null or v_avance < 0 or v_avance > 100 or v_avance <> round(v_avance) then
      raise exception 'El avance del trabajo % va de 0 a 100 %%, en números enteros.', v_orden using errcode = 'check_violation';
    end if;
    insert into public.reporte_diario_trabajos (reporte_id, orden, descripcion, avance)
    values (p_id, v_orden, v_tdesc, v_avance::smallint)
    returning id into v_tid;

    if jsonb_typeof(coalesce(v_trabajo->'personal', '[]'::jsonb)) <> 'array' then
      raise exception 'Revisa el personal del trabajo %.', v_orden using errcode = 'check_violation';
    end if;
    if v_general and jsonb_array_length(coalesce(v_trabajo->'personal', '[]'::jsonb)) > 0 then
      raise exception 'Con personal general, la gente va una sola vez para todo el reporte, no en cada trabajo.' using errcode = 'check_violation';
    end if;
    for v_persona in select * from jsonb_array_elements(coalesce(v_trabajo->'personal', '[]'::jsonb)) loop
      perform public.reporte_diario_agregar_persona(v_reporte, v_tid, v_tdesc, v_persona);
    end loop;
  end loop;

  if v_general then
    for v_persona in select * from jsonb_array_elements(p_personal_general) loop
      perform public.reporte_diario_agregar_persona(v_reporte, null, v_asunto, v_persona);
    end loop;
  end if;

  if not exists (select 1 from public.reporte_diario_personal where reporte_id = p_id) then
    raise exception 'Pon al menos a una persona con sus horas: de ahí sale el costeo.' using errcode = 'check_violation';
  end if;

  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_nfoto := v_nfoto + 1;
    if v_ruta !~ ('^' || v_yo::text || '/' || p_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-reporte-diario' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_nfoto using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.reporte_diario_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_nfoto using errcode = 'check_violation';
    end if;
    insert into public.reporte_diario_fotos (reporte_id, orden, ruta, mime_type, tamano_bytes)
    values (p_id, v_nfoto, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;

  return p_id;
end;
$$;
revoke all on function public.registrar_reporte_diario(uuid, date, text, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_reporte_diario(uuid, date, text, text, text, jsonb, jsonb, jsonb) to authenticated;

-- 13. Anular un reporte ----------------------------------------------------------------------------
-- Quien lo subió, dentro de los 7 días; RR. HH., siempre. Sus horas salen del
-- costeo con el mismo motivo.
create or replace function public.anular_reporte_diario(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_rep     public.reportes_diarios%rowtype;
begin
  if v_yo is null then
    raise exception 'Vuelve a iniciar sesión.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rep from public.reportes_diarios where id = p_id for update;
  if not found then
    raise exception 'Ese reporte no existe.' using errcode = 'check_violation';
  end if;
  if not (public.es_admin() or public.tiene_permiso('rrhh.personal')) then
    if v_rep.registrado_por is distinct from v_yo or not public.tiene_permiso('reporte_diario.registrar') then
      raise exception 'Solo quien subió el reporte o Recursos Humanos lo pueden anular.' using errcode = 'insufficient_privilege';
    end if;
    if (v_rep.creado_en at time zone 'America/Lima')::date < v_hoy - 7 then
      raise exception 'Pasaron más de 7 días desde que lo subiste: pídele a Recursos Humanos que lo anule.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if v_rep.anulado_en is not null then return p_id; end if;

  update public.reportes_diarios
     set anulado_por = v_yo, anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_id;
  update public.tareos
     set anulado_por = v_yo, anulado_en = now(), motivo_anulacion = left('Se anuló el reporte diario: ' || v_motivo, 500)
   where anulado_en is null
     and reporte_linea_id in (select l.id from public.reporte_diario_personal l where l.reporte_id = p_id);
  return p_id;
end;
$$;
revoke all on function public.anular_reporte_diario(uuid, text) from public, anon;
grant execute on function public.anular_reporte_diario(uuid, text) to authenticated;

-- 14. Las horas que esperaban costo entran solas al tareo ------------------------------------------
create or replace function public.fn_reporte_diario_horas_pendientes()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_hora numeric(10, 4) := round(new.costo_mensual / 240, 4);
begin
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, registrado_por, reporte_linea_id)
  select l.trabajador_id, l.fecha, r.codigo_interno, l.horas, left(coalesce(t.descripcion, r.asunto), 200),
         v_hora, round(l.horas * v_hora, 2), r.registrado_por, l.id
    from public.reporte_diario_personal l
    join public.reportes_diarios r on r.id = l.reporte_id
    left join public.reporte_diario_trabajos t on t.id = l.trabajo_id
   where l.trabajador_id = new.trabajador_id
     and r.anulado_en is null
     and not exists (select 1 from public.tareos x where x.reporte_linea_id = l.id);
  return null;
end;
$$;
revoke all on function public.fn_reporte_diario_horas_pendientes() from public, anon, authenticated;
create or replace trigger trg_trabajador_costo_horas_pendientes
  after insert or update on public.trabajador_costos
  for each row execute function public.fn_reporte_diario_horas_pendientes();

-- Lo que espera costo, por persona: RR. HH. lo ve arriba del costeo.
create or replace function public.rrhh_horas_esperando_costo()
returns table (trabajador_id uuid, nombre text, horas numeric, lineas bigint, desde date)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  return query
    select l.trabajador_id, min(t.nombres || ' ' || t.apellidos), sum(l.horas), count(*), min(l.fecha)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
      join public.trabajadores t on t.id = l.trabajador_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos x where x.reporte_linea_id = l.id)
     group by l.trabajador_id
     order by 2;
end;
$$;
revoke all on function public.rrhh_horas_esperando_costo() from public, anon;
grant execute on function public.rrhh_horas_esperando_costo() to authenticated;
