-- =============================================================================
-- RECURSOS HUMANOS: EL COSTO DEL PERSONAL POR CÓDIGO INTERNO Y LAS
-- OBSERVACIONES Y AMONESTACIONES
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-14) que RR. HH. lleve en el sistema toda su parte del
-- control del personal. Ya estaban la ficha, la marca del portero y las
-- tardanzas (20261013160000). Faltaban dos cosas:
--
--   * EL COSTEO POR CÓDIGO INTERNO. Hoy las horas de cada persona se anotan en
--     HORAS HOMBRE (HH) - Supervisores - 2026.xlsx con texto libre y la unidad
--     entre paréntesis («(30-34)», «(2921)»), y nadie las convierte en soles.
--     La planilla del mes se reparte por OT, pero el código interno que usan
--     los RQ y las OC (PLA_SR_O4_1_26/28, o PLANTA para lo que no es de una
--     unidad) no tiene mano de obra. Ahora RR. HH. registra el TAREO: cuántas
--     horas trabajó cada persona en cada código interno, día por día. Cada
--     hora vale el COSTO MENSUAL de esa persona entre 240 (30 días de 8 horas,
--     la misma base del descuento por tardanza). El costo de la hora queda
--     escrito en el tareo, así cambiar el costo mensual no reescribe el pasado.
--     El costo mensual va en su propia tabla, que solo RR. HH. lee: de él sale
--     el sueldo de cada uno.
--   * LAS OBSERVACIONES Y AMONESTACIONES. El cuadro de penalidades de CONTROL
--     PERSONAL EMPRESAS -2026.xlsx castiga faltas injustificadas, tardanzas y
--     no usar el EPP, y los reclamos al personal viven en una hoja PENALIDADES
--     escrita como chat. Ahora cada observación, amonestación verbal o escrita
--     y suspensión queda registrada con su motivo, lo que pasó y, si fue en una
--     unidad, su código interno. Gerencia y Administración la consultan, igual
--     que las tardanzas.
--
-- Nada de esto se borra: un tareo o una observación equivocada se anula con su
-- motivo y queda como evidencia. Las tablas se escriben solo por las funciones
-- de abajo. Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Lo que cuesta cada persona al mes ---------------------------------------------
create table if not exists public.trabajador_costos (
  id               uuid primary key default gen_random_uuid(),
  trabajador_id    uuid not null references public.trabajadores(id) on delete restrict,
  costo_mensual    numeric(10, 2) not null,
  actualizado_por  uuid references public.usuarios(id) on delete restrict,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  -- También es el índice de la llave hacia el trabajador.
  constraint uq_trabajador_costo unique (trabajador_id),
  constraint ck_trabajador_costo check (costo_mensual > 0 and costo_mensual <= 100000)
);
comment on table public.trabajador_costos is
  'Lo que cada persona le cuesta a la empresa al mes (sueldo, asignación, bonos y aportes). Aparte, para que solo RR. HH. la lea.';

select public.activar_timestamps('trabajador_costos');
select public.activar_auditoria('trabajador_costos');
select public.activar_registro_de_prueba('trabajador_costos');

-- 2. El tareo: horas por persona, día y código interno -------------------------------
create table if not exists public.tareos (
  id                uuid primary key default gen_random_uuid(),
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  fecha             date not null,
  codigo_interno    text not null,
  horas             numeric(4, 2) not null,
  labor             text,
  costo_hora        numeric(10, 4) not null,
  costo             numeric(12, 2) not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_tareo_valores check (
    char_length(codigo_interno) between 2 and 60
    and horas > 0 and horas <= 16
    and (labor is null or char_length(labor) <= 200)
    and costo_hora >= 0 and costo >= 0),
  constraint ck_tareo_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.tareos is
  'Las horas que una persona trabajó un día en un código interno, con el costo de la hora escrito al registrarlas. No se borra: se anula.';
comment on column public.tareos.costo_hora is 'Costo mensual de la persona entre 240 horas, el día que se registró.';

-- El reporte se lee por mes; la suma de horas del día, por persona y fecha
-- (la busca rrhh_registrar_tareo en cada registro, y sirve a la llave).
create index if not exists ix_tareos_fecha on public.tareos (fecha desc);
create index if not exists ix_tareos_trabajador_fecha on public.tareos (trabajador_id, fecha) where anulado_en is null;

select public.activar_timestamps('tareos');
select public.activar_auditoria('tareos');
select public.activar_registro_de_prueba('tareos');

-- 3. Observaciones y amonestaciones --------------------------------------------------
create table if not exists public.observaciones_personal (
  id                uuid primary key default gen_random_uuid(),
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  fecha             date not null,
  tipo              text not null,
  motivo            text not null,
  detalle           text not null,
  codigo_interno    text,
  dias_suspension   smallint,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_observacion_tipo check (tipo in ('OBSERVACION', 'AMONESTACION_VERBAL', 'AMONESTACION_ESCRITA', 'SUSPENSION')),
  constraint ck_observacion_motivo check (
    motivo in ('TARDANZAS', 'FALTA_INJUSTIFICADA', 'EPP', 'SEGURIDAD', 'CALIDAD', 'CONDUCTA', 'OTRO')),
  constraint ck_observacion_textos check (
    char_length(btrim(detalle)) between 10 and 1000
    and (codigo_interno is null or char_length(codigo_interno) between 2 and 60)),
  constraint ck_observacion_suspension check (
    (tipo = 'SUSPENSION' and dias_suspension between 1 and 30)
    or (tipo <> 'SUSPENSION' and dias_suspension is null)),
  constraint ck_observacion_anulada check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.observaciones_personal is
  'Las observaciones, amonestaciones y suspensiones de cada persona, con su motivo. No se borran: se anulan.';

-- El reporte se lee por mes; el historial de una persona, por persona (y sirve a la llave).
create index if not exists ix_observaciones_fecha on public.observaciones_personal (fecha desc);
create index if not exists ix_observaciones_trabajador on public.observaciones_personal (trabajador_id, fecha desc);

select public.activar_timestamps('observaciones_personal');
select public.activar_auditoria('observaciones_personal');
select public.activar_registro_de_prueba('observaciones_personal');

-- 4. Lo que no se borra ni se corrige ------------------------------------------------
create or replace function public.fn_rrhh_registro_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un registro de Recursos Humanos no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese registro está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'])
     is distinct from (to_jsonb(old) - array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en']) then
    raise exception 'Un registro ya hecho no se corrige: anúlalo con su motivo y vuelve a registrarlo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rrhh_registro_guardia() from public, anon, authenticated;
create or replace trigger trg_tareo_guardia
  before update or delete on public.tareos
  for each row execute function public.fn_rrhh_registro_guardia();
create or replace trigger trg_observacion_guardia
  before update or delete on public.observaciones_personal
  for each row execute function public.fn_rrhh_registro_guardia();
-- El costo mensual sí se corrige (vale para los tareos de ahí en adelante), pero no se borra.
create or replace function public.fn_trabajador_costo_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'El costo mensual no se borra: se corrige en la ficha de la persona.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_trabajador_costo_guardia() from public, anon, authenticated;
create or replace trigger trg_trabajador_costo_guardia
  before delete on public.trabajador_costos
  for each row execute function public.fn_trabajador_costo_guardia();

-- 5. Quién ve qué ----------------------------------------------------------------------
alter table public.trabajador_costos enable row level security;
alter table public.tareos enable row level security;
alter table public.observaciones_personal enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trabajador_costos' and policyname = 'ver_trabajador_costos') then
    create policy ver_trabajador_costos on public.trabajador_costos for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal')));
  end if;
  -- El tareo lleva el costo de la hora: de ahí sale el sueldo. Solo RR. HH.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tareos' and policyname = 'ver_tareos') then
    create policy ver_tareos on public.tareos for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal')));
  end if;
  -- Las observaciones las consultan también Gerencia y Administración, como las tardanzas.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observaciones_personal' and policyname = 'ver_observaciones_personal') then
    create policy ver_observaciones_personal on public.observaciones_personal for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal')) or (select public.tiene_permiso('asistencia.ver')));
  end if;
end $$;
revoke all on public.trabajador_costos from public, anon, authenticated;
revoke all on public.tareos from public, anon, authenticated;
revoke all on public.observaciones_personal from public, anon, authenticated;
grant select on public.trabajador_costos to authenticated;
grant select on public.tareos to authenticated;
grant select on public.observaciones_personal to authenticated;

-- 6. El costo mensual de una persona ---------------------------------------------------
create or replace function public.rrhh_guardar_costo_trabajador(p_trabajador_id uuid, p_costo_mensual numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  if not exists (select 1 from public.trabajadores where id = p_trabajador_id) then
    raise exception 'La persona no existe: registra primero su ficha.' using errcode = 'check_violation';
  end if;
  if p_costo_mensual is null or p_costo_mensual <= 0 or p_costo_mensual > 100000 then
    raise exception 'El costo mensual va de S/ 0,01 a S/ 100 000.' using errcode = 'check_violation';
  end if;
  insert into public.trabajador_costos (trabajador_id, costo_mensual, actualizado_por)
  values (p_trabajador_id, round(p_costo_mensual, 2), public.usuario_actual())
  on conflict (trabajador_id) do update
     set costo_mensual = excluded.costo_mensual, actualizado_por = excluded.actualizado_por;
  return p_trabajador_id;
end;
$$;
revoke all on function public.rrhh_guardar_costo_trabajador(uuid, numeric) from public, anon;
grant execute on function public.rrhh_guardar_costo_trabajador(uuid, numeric) to authenticated;

-- 7. Registrar y anular horas del tareo ------------------------------------------------
-- Un reintento del mismo formulario (mismo p_id) devuelve el tareo ya hecho.
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
  select coalesce(sum(horas), 0) into v_ya from public.tareos
   where trabajador_id = p_trabajador_id and fecha = p_fecha and anulado_en is null;
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

create or replace function public.rrhh_anular_tareo(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_tareo public.tareos%rowtype;
begin
  perform public.exigir_permiso('rrhh.personal');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_tareo from public.tareos where id = p_id for update;
  if not found then raise exception 'Esas horas no existen.'; end if;
  if v_tareo.anulado_en is not null then return p_id; end if;
  update public.tareos
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.rrhh_anular_tareo(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_tareo(uuid, text) to authenticated;

-- Los códigos internos que ya usa la empresa (RQ, OC, unidades, vehículos y el
-- propio tareo), para que RR. HH. elija en vez de escribir uno de tres maneras.
-- Solo devuelve los códigos: lo demás de esas tablas sigue con su RLS.
create or replace function public.rrhh_codigos_internos()
returns table (codigo text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  return query
    select c from (
      select upper(btrim(r.codigo_interno)) as c from public.requerimientos r
      union select upper(btrim(o.codigo_interno)) from public.ordenes_compra_materiales o where o.codigo_interno is not null
      union select upper(btrim(u.codigo_interno)) from public.unidades u where u.codigo_interno is not null
      union select upper(btrim(v.codigo_interno)) from public.registro_vehiculos v where v.codigo_interno is not null
      union select t.codigo_interno from public.tareos t where t.anulado_en is null
    ) x
    where char_length(c) between 2 and 60
    order by c
    limit 500;
end;
$$;
revoke all on function public.rrhh_codigos_internos() from public, anon;
grant execute on function public.rrhh_codigos_internos() to authenticated;

-- 8. Registrar y anular observaciones ---------------------------------------------------
create or replace function public.rrhh_registrar_observacion(
  p_id uuid, p_trabajador_id uuid, p_fecha date, p_tipo text, p_motivo text, p_detalle text,
  p_codigo_interno text default null, p_dias_suspension int default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_codigo  text := nullif(upper(btrim(coalesce(p_codigo_interno, ''))), '');
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la observación.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.observaciones_personal where id = p_id) then return p_id; end if;

  if not exists (select 1 from public.trabajadores where id = p_trabajador_id) then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día en que pasó: hoy o un día anterior.' using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('OBSERVACION', 'AMONESTACION_VERBAL', 'AMONESTACION_ESCRITA', 'SUSPENSION') then
    raise exception 'Elige si es una observación, una amonestación verbal o escrita, o una suspensión.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('TARDANZAS', 'FALTA_INJUSTIFICADA', 'EPP', 'SEGURIDAD', 'CALIDAD', 'CONDUCTA', 'OTRO') then
    raise exception 'Elige el motivo.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_detalle, ''))) not between 10 and 1000 then
    raise exception 'Cuenta qué pasó, en 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if p_tipo = 'SUSPENSION' and (p_dias_suspension is null or p_dias_suspension not between 1 and 30) then
    raise exception 'Una suspensión lleva sus días: de 1 a 30.' using errcode = 'check_violation';
  end if;

  insert into public.observaciones_personal (id, trabajador_id, fecha, tipo, motivo, detalle, codigo_interno, dias_suspension)
  values (p_id, p_trabajador_id, p_fecha, p_tipo, p_motivo, btrim(p_detalle), v_codigo,
          case when p_tipo = 'SUSPENSION' then p_dias_suspension end);
  return p_id;
end;
$$;
revoke all on function public.rrhh_registrar_observacion(uuid, uuid, date, text, text, text, text, int) from public, anon;
grant execute on function public.rrhh_registrar_observacion(uuid, uuid, date, text, text, text, text, int) to authenticated;

create or replace function public.rrhh_anular_observacion(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_obs public.observaciones_personal%rowtype;
begin
  perform public.exigir_permiso('rrhh.personal');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_obs from public.observaciones_personal where id = p_id for update;
  if not found then raise exception 'Esa observación no existe.'; end if;
  if v_obs.anulado_en is not null then return p_id; end if;
  update public.observaciones_personal
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.rrhh_anular_observacion(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_observacion(uuid, text) to authenticated;
