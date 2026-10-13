-- =============================================================================
-- RECURSOS HUMANOS: EL PERSONAL DE PLANTA, LA ASISTENCIA DEL PORTERO Y LA TARDANZA
-- -----------------------------------------------------------------------------
-- Hoy RR. HH. lleva al personal en CONTROL PERSONAL EMPRESAS -2026.xlsx (DNI,
-- cuenta bancaria, cargo, horario…) y la asistencia en PORTERIA/ASISTENCIAS -
-- PERSONAL PLANTA 2026.xlsx: el portero anota en papel y alguien lo teclea
-- después, con horas mal escritas («6-,00», «12::30») y sin saber quién llegó
-- tarde. Gerencia pidió (2026-10-13) que eso nazca en el sistema:
--
--   * RR. HH. registra a cada TRABAJADOR: nombres, apellidos, DNI, cargo, área,
--     banco con tipo y número de cuenta, y su hora de entrada y de salida. Es
--     gente de planta y de oficina; la mayoría no tiene cuenta en el sistema,
--     así que es una ficha aparte de `usuarios` (las cuentas de acceso).
--     La cuenta bancaria va en su propia tabla, que solo RR. HH. lee: el
--     portero ve nombres y horarios, nunca cuentas.
--   * El PORTERO, con una subcuenta de RR. HH. desde su celular, marca el
--     INGRESO y la SALIDA de cada persona. La hora la pone el sistema (Lima),
--     no se teclea. Si el ingreso cae después de la hora de entrada de esa
--     persona, queda la tardanza en minutos y el DESCUENTO calculado con la
--     regla vigente.
--   * La REGLA DE TARDANZA la ajusta RR. HH.: una tolerancia en minutos (por
--     defecto 5) y un importe por minuto de tardanza (por defecto S/ 0,08:
--     la RMV de S/ 1.130 entre 30 días, 8 horas y 60 minutos). Pasada la
--     tolerancia, se descuentan TODOS los minutos de tardanza, no solo el
--     exceso. El descuento queda escrito en la marca con la regla de ese día,
--     así cambiar la regla no reescribe el pasado.
--
-- Una marca no se borra: RR. HH. la anula con motivo y queda como evidencia.
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el
-- conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos y puestos --------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('rrhh.personal', 'Recursos Humanos', 'Registrar y editar la ficha del personal: datos, cuenta bancaria y horario'),
  ('asistencia.marcar', 'Recursos Humanos', 'Marcar el ingreso y la salida del personal en la portería'),
  ('asistencia.ver', 'Recursos Humanos', 'Consultar la asistencia, las tardanzas y los descuentos del personal')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('PORTERO', 'Portería',
   'Marca la asistencia del personal desde el celular; depende de Recursos Humanos', 10, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'PORTERO' and p.codigo = 'asistencia.marcar')
    or (r.codigo = 'RECURSOS_HUMANOS' and p.codigo in ('rrhh.personal', 'asistencia.ver'))
    or (r.codigo in ('GERENTE', 'ADMINISTRACION') and p.codigo = 'asistencia.ver')
on conflict do nothing;

-- 2. La regla de tardanza --------------------------------------------------------
create table if not exists public.rrhh_regla_tardanza (
  id                    boolean primary key default true,
  tolerancia_minutos    smallint not null default 5,
  descuento_por_minuto  numeric(8, 4) not null default 0.08,
  actualizado_por       uuid references public.usuarios(id) on delete restrict,
  actualizado_en        timestamptz not null default now(),
  constraint ck_regla_tardanza_una check (id),
  constraint ck_regla_tardanza_valores check (
    tolerancia_minutos between 0 and 120 and descuento_por_minuto between 0 and 100)
);
comment on table public.rrhh_regla_tardanza is
  'Una sola fila: la tolerancia en minutos y el descuento en soles por cada minuto de tardanza.';
insert into public.rrhh_regla_tardanza (id) values (true) on conflict (id) do nothing;

-- 3. El trabajador -----------------------------------------------------------------
create table if not exists public.trabajadores (
  id              uuid primary key default gen_random_uuid(),
  nombres         text not null,
  apellidos       text not null,
  dni             text not null,
  cargo           text,
  area_id         uuid references public.areas(id) on delete restrict,
  hora_entrada    time not null default '08:00',
  hora_salida     time not null default '18:00',
  activo          boolean not null default true,
  creado_por      uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint uq_trabajador_dni unique (dni),
  constraint ck_trabajador_textos check (
    char_length(btrim(nombres)) between 2 and 80
    and char_length(btrim(apellidos)) between 2 and 80
    and dni ~ '^[0-9]{8}$'
    and (cargo is null or char_length(btrim(cargo)) between 2 and 80)),
  constraint ck_trabajador_horario check (hora_salida > hora_entrada)
);
comment on table public.trabajadores is
  'La ficha del personal que lleva RR. HH. (planta y oficina). No es la cuenta de acceso: eso es `usuarios`.';
comment on column public.trabajadores.hora_entrada is 'Hora de entrada de esa persona: una marca de ingreso posterior es tardanza.';

create table if not exists public.trabajador_cuentas (
  id              uuid primary key default gen_random_uuid(),
  trabajador_id   uuid not null references public.trabajadores(id) on delete restrict,
  banco           text not null,
  tipo_cuenta     text not null,
  numero_cuenta   text not null,
  cci             text,
  actualizado_en  timestamptz not null default now(),
  -- También es el índice de la llave hacia el trabajador.
  constraint uq_trabajador_cuenta unique (trabajador_id),
  constraint ck_trabajador_cuenta check (
    char_length(btrim(banco)) between 2 and 60
    and tipo_cuenta in ('AHORROS', 'CORRIENTE', 'SUELDO', 'CTS')
    and numero_cuenta ~ '^[0-9-]{6,30}$'
    and (cci is null or cci ~ '^[0-9]{20}$'))
);
comment on table public.trabajador_cuentas is
  'La cuenta bancaria de cada trabajador, aparte para que solo RR. HH. la lea.';

select public.activar_timestamps('trabajadores');
select public.activar_auditoria('trabajadores');
select public.activar_registro_de_prueba('trabajadores');
select public.activar_timestamps('trabajador_cuentas');
select public.activar_auditoria('trabajador_cuentas');
select public.activar_registro_de_prueba('trabajador_cuentas');

-- 4. La asistencia -------------------------------------------------------------------
create table if not exists public.asistencias (
  id                 uuid primary key default gen_random_uuid(),
  trabajador_id      uuid not null references public.trabajadores(id) on delete restrict,
  fecha              date not null,
  tipo               text not null,
  marcado_en         timestamptz not null default now(),
  hora               time not null,
  tardanza_minutos   integer not null default 0,
  descuento          numeric(10, 2) not null default 0,
  observacion        text,
  registrado_por     uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por        uuid references public.usuarios(id) on delete restrict,
  anulado_en         timestamptz,
  motivo_anulacion   text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint ck_asistencia_tipo check (tipo in ('INGRESO', 'SALIDA')),
  constraint ck_asistencia_valores check (
    tardanza_minutos >= 0 and descuento >= 0
    and (tipo = 'INGRESO' or (tardanza_minutos = 0 and descuento = 0))
    and (observacion is null or char_length(observacion) <= 300)),
  constraint ck_asistencia_anulada check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.asistencias is
  'Una marca de ingreso o de salida por persona y día, con la tardanza y el descuento calculados al marcar. No se borra: se anula.';
comment on column public.asistencias.descuento is 'En soles, con la regla de tardanza vigente al marcar.';

-- Una persona marca un ingreso y una salida por día (las anuladas no cuentan).
-- También es el índice por el que se consulta el día y el mes.
create unique index if not exists uq_asistencia_dia on public.asistencias (trabajador_id, fecha, tipo)
  where anulado_en is null;
create index if not exists ix_asistencia_fecha on public.asistencias (fecha desc);

select public.activar_timestamps('asistencias');
select public.activar_auditoria('asistencias');
select public.activar_registro_de_prueba('asistencias');

create or replace function public.fn_asistencia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una marca de asistencia no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Esa marca está anulada: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if row(new.trabajador_id, new.fecha, new.tipo, new.marcado_en, new.hora, new.tardanza_minutos, new.descuento, new.registrado_por)
     is distinct from row(old.trabajador_id, old.fecha, old.tipo, old.marcado_en, old.hora, old.tardanza_minutos, old.descuento, old.registrado_por) then
    raise exception 'Una marca ya hecha no se corrige: anúlala con su motivo y vuelve a marcar.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_asistencia_guardia() from public, anon, authenticated;
create or replace trigger trg_asistencia_guardia
  before update or delete on public.asistencias
  for each row execute function public.fn_asistencia_guardia();

create or replace function public.fn_trabajador_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un trabajador no se borra: se da de baja, para que su asistencia siga teniendo dueño.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_trabajador_guardia() from public, anon, authenticated;
create or replace trigger trg_trabajador_guardia
  before delete on public.trabajadores
  for each row execute function public.fn_trabajador_guardia();
create or replace trigger trg_trabajador_cuenta_guardia
  before delete on public.trabajador_cuentas
  for each row execute function public.fn_trabajador_guardia();

-- 5. Quién ve qué ---------------------------------------------------------------------
create or replace function public.puede_ver_trabajadores()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('rrhh.personal')
      or public.tiene_permiso('asistencia.ver') or public.tiene_permiso('asistencia.marcar');
$$;
revoke all on function public.puede_ver_trabajadores() from public, anon;
grant execute on function public.puede_ver_trabajadores() to authenticated;

alter table public.rrhh_regla_tardanza enable row level security;
alter table public.trabajadores enable row level security;
alter table public.trabajador_cuentas enable row level security;
alter table public.asistencias enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trabajadores' and policyname = 'ver_trabajadores') then
    create policy ver_trabajadores on public.trabajadores for select to authenticated
      using ((select public.puede_ver_trabajadores()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trabajador_cuentas' and policyname = 'ver_trabajador_cuentas') then
    create policy ver_trabajador_cuentas on public.trabajador_cuentas for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'asistencias' and policyname = 'ver_asistencias') then
    create policy ver_asistencias on public.asistencias for select to authenticated
      using ((select public.puede_ver_trabajadores()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rrhh_regla_tardanza' and policyname = 'ver_regla_tardanza') then
    create policy ver_regla_tardanza on public.rrhh_regla_tardanza for select to authenticated
      using ((select public.puede_ver_trabajadores()));
  end if;
end $$;
revoke all on public.rrhh_regla_tardanza from public, anon, authenticated;
revoke all on public.trabajadores from public, anon, authenticated;
revoke all on public.trabajador_cuentas from public, anon, authenticated;
revoke all on public.asistencias from public, anon, authenticated;
grant select on public.rrhh_regla_tardanza to authenticated;
grant select on public.trabajadores to authenticated;
grant select on public.trabajador_cuentas to authenticated;
grant select on public.asistencias to authenticated;

-- 6. Registrar o corregir la ficha de un trabajador ----------------------------------
create or replace function public.rrhh_guardar_trabajador(
  p_id uuid, p_nombres text, p_apellidos text, p_dni text, p_cargo text, p_area_id uuid,
  p_hora_entrada time, p_hora_salida time,
  p_banco text, p_tipo_cuenta text, p_numero_cuenta text, p_cci text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_dni   text := regexp_replace(coalesce(p_dni, ''), '\s', '', 'g');
  v_banco text := btrim(coalesce(p_banco, ''));
  v_cta   text := regexp_replace(coalesce(p_numero_cuenta, ''), '\s', '', 'g');
  v_cci   text := nullif(regexp_replace(coalesce(p_cci, ''), '\s', '', 'g'), '');
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la persona.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_nombres, ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_apellidos, ''))) not between 2 and 80 then
    raise exception 'Escribe los nombres y los apellidos (de 2 a 80 caracteres cada uno).' using errcode = 'check_violation';
  end if;
  if v_dni !~ '^[0-9]{8}$' then
    raise exception 'El DNI lleva 8 dígitos.' using errcode = 'check_violation';
  end if;
  if p_cargo is not null and char_length(btrim(p_cargo)) not between 2 and 80 then
    raise exception 'El cargo va de 2 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and activo) then
    raise exception 'Elige un área vigente.' using errcode = 'check_violation';
  end if;
  if p_hora_entrada is null or p_hora_salida is null or p_hora_salida <= p_hora_entrada then
    raise exception 'La hora de salida tiene que ser posterior a la de entrada.' using errcode = 'check_violation';
  end if;
  if char_length(v_banco) not between 2 and 60 then
    raise exception 'Escribe el banco donde se le paga.' using errcode = 'check_violation';
  end if;
  if p_tipo_cuenta not in ('AHORROS', 'CORRIENTE', 'SUELDO', 'CTS') then
    raise exception 'Elige el tipo de cuenta: ahorros, corriente, sueldo o CTS.' using errcode = 'check_violation';
  end if;
  if v_cta !~ '^[0-9-]{6,30}$' then
    raise exception 'El número de cuenta lleva solo dígitos y guiones (de 6 a 30).' using errcode = 'check_violation';
  end if;
  if v_cci is not null and v_cci !~ '^[0-9]{20}$' then
    raise exception 'El CCI lleva 20 dígitos.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.trabajadores where dni = v_dni and id <> p_id) then
    raise exception 'Ya hay una persona registrada con el DNI %.', v_dni using errcode = 'unique_violation';
  end if;

  insert into public.trabajadores (id, nombres, apellidos, dni, cargo, area_id, hora_entrada, hora_salida)
  values (p_id, btrim(p_nombres), btrim(p_apellidos), v_dni, nullif(btrim(coalesce(p_cargo, '')), ''), p_area_id,
          p_hora_entrada, p_hora_salida)
  on conflict (id) do update
     set nombres = excluded.nombres, apellidos = excluded.apellidos, dni = excluded.dni, cargo = excluded.cargo,
         area_id = excluded.area_id, hora_entrada = excluded.hora_entrada, hora_salida = excluded.hora_salida;

  insert into public.trabajador_cuentas (trabajador_id, banco, tipo_cuenta, numero_cuenta, cci)
  values (p_id, v_banco, p_tipo_cuenta, v_cta, v_cci)
  on conflict (trabajador_id) do update
     set banco = excluded.banco, tipo_cuenta = excluded.tipo_cuenta, numero_cuenta = excluded.numero_cuenta, cci = excluded.cci;
  return p_id;
end;
$$;
revoke all on function public.rrhh_guardar_trabajador(uuid, text, text, text, text, uuid, time, time, text, text, text, text) from public, anon;
grant execute on function public.rrhh_guardar_trabajador(uuid, text, text, text, text, uuid, time, time, text, text, text, text) to authenticated;

-- Dar de baja o volver a dar de alta: la ficha y su historial se quedan.
create or replace function public.rrhh_cambiar_estado_trabajador(p_id uuid, p_activo boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  perform public.exigir_permiso('rrhh.personal');
  update public.trabajadores set activo = coalesce(p_activo, false) where id = p_id;
  get diagnostics v = row_count;
  if v = 0 then raise exception 'La persona no existe.'; end if;
  return p_id;
end;
$$;
revoke all on function public.rrhh_cambiar_estado_trabajador(uuid, boolean) from public, anon;
grant execute on function public.rrhh_cambiar_estado_trabajador(uuid, boolean) to authenticated;

-- La regla de tardanza la ajusta RR. HH.
create or replace function public.rrhh_guardar_regla_tardanza(p_tolerancia_minutos int, p_descuento_por_minuto numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_tolerancia_minutos is null or p_tolerancia_minutos not between 0 and 120 then
    raise exception 'La tolerancia va de 0 a 120 minutos.' using errcode = 'check_violation';
  end if;
  if p_descuento_por_minuto is null or p_descuento_por_minuto not between 0 and 100 then
    raise exception 'El descuento por minuto va de S/ 0 a S/ 100.' using errcode = 'check_violation';
  end if;
  insert into public.rrhh_regla_tardanza (id, tolerancia_minutos, descuento_por_minuto, actualizado_por, actualizado_en)
  values (true, p_tolerancia_minutos, round(p_descuento_por_minuto, 4), public.usuario_actual(), now())
  on conflict (id) do update
     set tolerancia_minutos = excluded.tolerancia_minutos, descuento_por_minuto = excluded.descuento_por_minuto,
         actualizado_por = excluded.actualizado_por, actualizado_en = now();
end;
$$;
revoke all on function public.rrhh_guardar_regla_tardanza(int, numeric) from public, anon;
grant execute on function public.rrhh_guardar_regla_tardanza(int, numeric) to authenticated;

-- 7. Marcar la asistencia ----------------------------------------------------------------
-- La hora la pone el sistema (hora de Lima). Un reintento del mismo formulario
-- (mismo p_id) devuelve la marca ya hecha, sin duplicar.
create or replace function public.marcar_asistencia(p_id uuid, p_trabajador_id uuid, p_tipo text, p_observacion text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_trab     public.trabajadores%rowtype;
  v_regla    public.rrhh_regla_tardanza%rowtype;
  v_ahora    timestamptz := now();
  v_lima     timestamp := now() at time zone 'America/Lima';
  v_fecha    date := (now() at time zone 'America/Lima')::date;
  v_hora     time := (now() at time zone 'America/Lima')::time;
  v_minutos  int := 0;
  v_desc     numeric(10, 2) := 0;
  v_previa   public.asistencias%rowtype;
begin
  perform public.exigir_permiso('asistencia.marcar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de asistencia.' using errcode = 'check_violation';
  end if;
  if p_tipo not in ('INGRESO', 'SALIDA') then
    raise exception 'Elige si marca ingreso o salida.' using errcode = 'check_violation';
  end if;
  if p_observacion is not null and char_length(p_observacion) > 300 then
    raise exception 'La observación pasa de 300 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found or not v_trab.activo then
    raise exception 'Esa persona no está en el personal activo: pídele a Recursos Humanos que la registre.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_trabajador_id::text, 0));
  select * into v_previa from public.asistencias where id = p_id;
  if found then return p_id; end if;

  select * into v_previa from public.asistencias
   where trabajador_id = p_trabajador_id and fecha = v_fecha and tipo = p_tipo and anulado_en is null;
  if found then
    raise exception '% ya marcó % hoy a las %.', v_trab.nombres || ' ' || v_trab.apellidos,
      case p_tipo when 'INGRESO' then 'su ingreso' else 'su salida' end, to_char(v_previa.hora, 'HH24:MI')
      using errcode = 'unique_violation';
  end if;
  if p_tipo = 'SALIDA' and not exists (
      select 1 from public.asistencias
       where trabajador_id = p_trabajador_id and fecha = v_fecha and tipo = 'INGRESO' and anulado_en is null) then
    raise exception '% no tiene ingreso marcado hoy: marca primero el ingreso.', v_trab.nombres || ' ' || v_trab.apellidos
      using errcode = 'check_violation';
  end if;

  if p_tipo = 'INGRESO' and v_hora > v_trab.hora_entrada then
    select * into v_regla from public.rrhh_regla_tardanza where id;
    v_minutos := floor(extract(epoch from (v_hora - v_trab.hora_entrada)) / 60)::int;
    if v_minutos > coalesce(v_regla.tolerancia_minutos, 0) then
      v_desc := round(v_minutos * coalesce(v_regla.descuento_por_minuto, 0), 2);
    end if;
  end if;

  insert into public.asistencias (id, trabajador_id, fecha, tipo, marcado_en, hora, tardanza_minutos, descuento, observacion)
  values (p_id, p_trabajador_id, v_fecha, p_tipo, v_ahora, v_hora, v_minutos, v_desc, nullif(btrim(coalesce(p_observacion, '')), ''));
  return p_id;
end;
$$;
revoke all on function public.marcar_asistencia(uuid, uuid, text, text) from public, anon;
grant execute on function public.marcar_asistencia(uuid, uuid, text, text) to authenticated;

-- Una marca equivocada la anula RR. HH. con motivo (o el portero, el mismo día).
create or replace function public.anular_asistencia(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_marca public.asistencias%rowtype;
  v_hoy   date := (now() at time zone 'America/Lima')::date;
begin
  if not (public.es_admin() or public.tiene_permiso('asistencia.ver') or public.tiene_permiso('asistencia.marcar')) then
    raise exception 'No tiene permiso para anular marcas de asistencia.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_marca from public.asistencias where id = p_id for update;
  if not found then raise exception 'La marca no existe.'; end if;
  if v_marca.anulado_en is not null then return p_id; end if;
  if not (public.es_admin() or public.tiene_permiso('asistencia.ver')) and v_marca.fecha <> v_hoy then
    raise exception 'La portería solo anula marcas de hoy: las de otros días las anula Recursos Humanos.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marca.tipo = 'INGRESO' and exists (
      select 1 from public.asistencias
       where trabajador_id = v_marca.trabajador_id and fecha = v_marca.fecha and tipo = 'SALIDA' and anulado_en is null) then
    raise exception 'Primero anula la salida de ese día; después el ingreso.' using errcode = 'check_violation';
  end if;
  update public.asistencias
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_asistencia(uuid, text) from public, anon;
grant execute on function public.anular_asistencia(uuid, text) to authenticated;

-- 8. La cuenta de la portería y el área de la de RR. HH. ------------------------------
-- Nace sin clave usable: la clave temporal se le da por fuera del repositorio.
do $$
declare
  v_cuenta uuid := gen_random_uuid();
  v_correo text := 'porteria@metalworkperusac.com';
  v_rol    uuid;
  v_sede   uuid;
  v_area   uuid;
begin
  select id into v_rol  from public.roles where codigo = 'PORTERO';
  select id into v_sede from public.sedes order by creado_en limit 1;
  select id into v_area from public.areas where codigo = 'RRH';
  if v_sede is null then return; end if;

  -- La cuenta de RR. HH. no tenía área: es la de Recursos Humanos.
  update public.usuarios set area_id = v_area
   where lower(correo) = 'rrhh@metalworkperusac.com' and area_id is null and v_area is not null;

  if exists (select 1 from auth.users where lower(email) = v_correo) then return; end if;

  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (v_cuenta, v_correo,
          public.cifrar_clave(gen_random_uuid()::text || gen_random_uuid()::text),
          jsonb_build_object('nombres', 'Portería', 'apellidos', 'Recursos Humanos'));
  perform public.completar_cuenta_acceso(v_cuenta);

  insert into public.usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
  values (v_cuenta, 'Portería', 'Recursos Humanos', v_correo, 'Portero', v_rol, v_sede, v_area);
end;
$$;
