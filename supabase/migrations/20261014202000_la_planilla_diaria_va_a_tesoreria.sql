-- =============================================================================
-- RECURSOS HUMANOS: LA PLANILLA DIARIA VA A TESORERÍA, Y LAS HORAS EXTRAS
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-14) que de los reportes diarios de los supervisores,
-- ya validados por Gerencia y por RR. HH. (20261014201000), salga lo que se le
-- paga a la gente:
--
--   * LA JORNADA ES DE 8 HORAS por persona y por día, sumando todos sus
--     reportes validados de ese día (la jornada ordinaria de la ley). Esas
--     horas ORDINARIAS van a la PLANILLA DIARIA.
--   * LO QUE PASA DE 8 HORAS son HORAS EXTRAS y quedan en el reporte de horas
--     extras, donde RR. HH. decide si las RESERVA (pasan al saldo de horas de
--     la persona, para usarlas en otra ocasión: un permiso o un descanso) o las
--     PAGA. Las que paga entran a la siguiente planilla diaria con su recargo:
--     las 2 primeras de cada día con 25 % y las siguientes con 35 %, lo mínimo
--     que manda la ley (D. S. 007-2002-TR, art. 10). RR. HH. puede subirlo,
--     igual que la regla de tardanza. El tope de 16 horas por día se mantiene.
--   * RR. HH. ARMA LA PLANILLA DIARIA con todo lo validado que falta pagar y
--     la MANDA A TESORERÍA. Lleva número de la casa (PD-0001-2026) y no se borra:
--     se anula con motivo, mientras Tesorería no haya pagado nada de ella.
--   * TESORERÍA PAGA: ve la cuenta de cada persona de esa planilla (solo de
--     ellas), registra el pago con su COMPROBANTE (uno por persona o uno para
--     varias, si paga en lote) y adjunta la BOLETA DE PAGO de cada persona.
--   * RR. HH. ENTREGA LAS BOLETAS y marca cada una como entregada.
--
-- Lo que se paga sale de la REMUNERACIÓN MENSUAL de la persona (sueldo,
-- asignación y bonos, sin los aportes de la empresa), que RR. HH. pone en su
-- ficha: la hora vale la remuneración entre 240, la misma base del descuento
-- por tardanza y del costeo. Es otra cosa que el COSTO MENSUAL del costeo, que
-- sí lleva los aportes. Las tablas se escriben solo por las funciones de abajo.
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos ------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('planilla_diaria.preparar', 'Recursos Humanos',
   'Armar la planilla diaria con los reportes validados y mandarla a Tesorería; decidir las horas extras y entregar las boletas'),
  ('planilla_diaria.pagar', 'Tesorería',
   'Pagar la planilla diaria: ver la cuenta de cada persona de la planilla, adjuntar el comprobante de pago y la boleta'),
  ('planilla_diaria.ver', 'Recursos Humanos',
   'Consultar las planillas diarias y las horas extras, sin las cuentas bancarias')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'RECURSOS_HUMANOS' and p.codigo = 'planilla_diaria.preparar')
    or (r.codigo = 'TESORERIA' and p.codigo = 'planilla_diaria.pagar')
    or (r.codigo = 'GERENTE' and p.codigo = 'planilla_diaria.ver')
on conflict do nothing;

-- 2. La serie de la planilla diaria ------------------------------------------------------
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'PLANILLA_DIARIA', '001', 'PD', 0, 4, 'PD-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'PLANILLA_DIARIA' and serie = '001');

-- 3. La regla de las horas extras (una fila) ------------------------------------------------
create table if not exists public.rrhh_regla_horas_extras (
  id               boolean primary key default true,
  horas_tramo1     numeric(4, 2) not null default 2,
  recargo_tramo1   numeric(5, 2) not null default 25,
  recargo_tramo2   numeric(5, 2) not null default 35,
  actualizado_por  uuid references public.usuarios(id) on delete restrict,
  actualizado_en   timestamptz not null default now(),
  constraint ck_regla_horas_extras_una check (id),
  -- Lo que la ley pone de piso: no más de 2 horas con el primer recargo, y
  -- recargos de al menos 25 % y 35 %. RR. HH. puede pagar más, no menos.
  constraint ck_regla_horas_extras_valores check (
    horas_tramo1 between 0 and 2 and recargo_tramo1 between 25 and 200 and recargo_tramo2 between 35 and 200
    and recargo_tramo2 >= recargo_tramo1)
);
comment on table public.rrhh_regla_horas_extras is
  'Una sola fila: cuántas horas extras de cada día van con el primer recargo (2) y los dos recargos en porcentaje (25 y 35, lo mínimo de ley).';
insert into public.rrhh_regla_horas_extras (id) values (true) on conflict (id) do nothing;
select public.activar_auditoria('rrhh_regla_horas_extras');

-- 4. Lo que se le paga a cada persona al mes -------------------------------------------------
create table if not exists public.trabajador_remuneraciones (
  id                    uuid primary key default gen_random_uuid(),
  trabajador_id         uuid not null references public.trabajadores(id) on delete restrict,
  remuneracion_mensual  numeric(10, 2) not null,
  actualizado_por       uuid references public.usuarios(id) on delete restrict,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  -- También es el índice de la llave hacia el trabajador.
  constraint uq_trabajador_remuneracion unique (trabajador_id),
  constraint ck_trabajador_remuneracion check (remuneracion_mensual > 0 and remuneracion_mensual <= 100000)
);
comment on table public.trabajador_remuneraciones is
  'Lo que se le paga a cada persona al mes (sueldo, asignación y bonos, sin aportes de la empresa). De aquí sale su hora en la planilla diaria.';
select public.activar_timestamps('trabajador_remuneraciones');
select public.activar_auditoria('trabajador_remuneraciones');
select public.activar_registro_de_prueba('trabajador_remuneraciones');

-- 5. Las horas extras: lo que RR. HH. decide ----------------------------------------------------
create table if not exists public.horas_extras_decisiones (
  id                uuid primary key default gen_random_uuid(),
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  fecha             date not null,
  horas             numeric(4, 2) not null,
  -- Las horas con el primer recargo y con el segundo, contadas en el día.
  horas_tramo1      numeric(4, 2) not null,
  horas_tramo2      numeric(4, 2) not null,
  decision          text not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_horas_extras_decision check (decision in ('RESERVAR', 'PAGAR')),
  constraint ck_horas_extras_horas check (
    horas > 0 and horas <= 8 and horas_tramo1 >= 0 and horas_tramo2 >= 0 and horas_tramo1 + horas_tramo2 = horas),
  constraint ck_horas_extras_anulada check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.horas_extras_decisiones is
  'Las horas extras de una persona en un día que RR. HH. decidió reservar (al saldo de horas) o pagar (a la planilla diaria). No se borra: se anula.';
-- Lo decidido de una persona en un día (b); sirve también a la llave.
create index if not exists ix_horas_extras_trabajador_fecha on public.horas_extras_decisiones (trabajador_id, fecha);
select public.activar_timestamps('horas_extras_decisiones');
select public.activar_auditoria('horas_extras_decisiones');
select public.activar_registro_de_prueba('horas_extras_decisiones');

-- 6. El saldo de horas que se usa en otra ocasión ------------------------------------------------
create table if not exists public.horas_compensadas (
  id                uuid primary key default gen_random_uuid(),
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  fecha             date not null,
  horas             numeric(4, 2) not null,
  motivo            text not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_horas_compensadas check (horas > 0 and horas <= 8 and char_length(btrim(motivo)) between 10 and 300),
  constraint ck_horas_compensadas_anulada check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.horas_compensadas is
  'Las horas reservadas que una persona usó en otra ocasión (un permiso, un descanso). Restan de su saldo. No se borra: se anula.';
-- El saldo se suma por persona (b); sirve también a la llave.
create index if not exists ix_horas_compensadas_trabajador on public.horas_compensadas (trabajador_id, fecha desc);
select public.activar_timestamps('horas_compensadas');
select public.activar_auditoria('horas_compensadas');
select public.activar_registro_de_prueba('horas_compensadas');

-- 7. La planilla diaria ---------------------------------------------------------------------------
create table if not exists public.planillas_diarias (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null,
  -- El día en que RR. HH. la mandó a Tesorería (hora de Lima).
  fecha             date not null,
  personas          smallint not null,
  total             numeric(12, 2) not null,
  enviada_por       uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint uq_planilla_diaria_numero unique (numero),
  constraint ck_planilla_diaria_valores check (personas > 0 and total >= 0),
  constraint ck_planilla_diaria_anulada check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.planillas_diarias is
  'La planilla diaria que RR. HH. manda a Tesorería: las horas validadas que faltaba pagar, por persona. No se borra: se anula.';
-- La lista se lee de la más reciente a la más vieja.
create index if not exists ix_planillas_diarias_fecha on public.planillas_diarias (fecha desc, creado_en desc);
select public.activar_timestamps('planillas_diarias');
select public.activar_auditoria('planillas_diarias');
select public.activar_registro_de_prueba('planillas_diarias');

create table if not exists public.planilla_diaria_pagos (
  id                  uuid primary key default gen_random_uuid(),
  planilla_id         uuid not null references public.planillas_diarias(id) on delete restrict,
  fecha_pago          date not null,
  operacion           text,
  comprobante_ruta    text not null,
  comprobante_mime    text not null,
  comprobante_tamano  integer not null,
  registrado_por      uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por         uuid references public.usuarios(id) on delete restrict,
  anulado_en          timestamptz,
  motivo_anulacion    text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  -- Un comprobante, un pago; y la política de Storage lo busca por su ruta.
  constraint uq_planilla_diaria_pago_ruta unique (comprobante_ruta),
  constraint ck_planilla_diaria_pago check (
    (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and comprobante_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and comprobante_tamano between 1 and 10485760),
  constraint ck_planilla_diaria_pago_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.planilla_diaria_pagos is
  'Un pago de Tesorería contra la planilla diaria, con su comprobante: de una persona o de varias en lote. No se borra: se anula.';
-- La pantalla de la planilla lee sus pagos (b); sirve también a la llave.
create index if not exists ix_planilla_diaria_pagos_planilla on public.planilla_diaria_pagos (planilla_id);
select public.activar_timestamps('planilla_diaria_pagos');
select public.activar_auditoria('planilla_diaria_pagos');
select public.activar_registro_de_prueba('planilla_diaria_pagos');

create table if not exists public.planilla_diaria_personas (
  id                    uuid primary key default gen_random_uuid(),
  planilla_id           uuid not null references public.planillas_diarias(id) on delete restrict,
  trabajador_id         uuid not null references public.trabajadores(id) on delete restrict,
  -- El nombre y el cargo como estaban al armar la planilla.
  nombre                text not null,
  cargo                 text,
  horas_ordinarias      numeric(6, 2) not null,
  horas_extras          numeric(6, 2) not null,
  monto_ordinarias      numeric(12, 2) not null,
  monto_extras          numeric(12, 2) not null,
  total                 numeric(12, 2) not null,
  pago_id               uuid references public.planilla_diaria_pagos(id) on delete restrict,
  boleta_ruta           text,
  boleta_mime           text,
  boleta_tamano         integer,
  boleta_subida_por     uuid references public.usuarios(id) on delete restrict,
  boleta_subida_en      timestamptz,
  boleta_entregada_por  uuid references public.usuarios(id) on delete restrict,
  boleta_entregada_en   timestamptz,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  -- Una persona una vez por planilla; es también el índice de la llave hacia la planilla.
  constraint uq_planilla_diaria_persona unique (planilla_id, trabajador_id),
  constraint ck_planilla_diaria_persona check (
    horas_ordinarias >= 0 and horas_extras >= 0 and horas_ordinarias + horas_extras > 0
    and monto_ordinarias >= 0 and monto_extras >= 0 and total = monto_ordinarias + monto_extras),
  constraint ck_planilla_diaria_boleta check (
    (boleta_ruta is null) = (boleta_subida_en is null)
    and (boleta_ruta is null or (boleta_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
                                 and boleta_tamano between 1 and 10485760 and boleta_subida_por is not null))
    and (boleta_entregada_en is null or (boleta_ruta is not null and boleta_entregada_por is not null)))
);
comment on table public.planilla_diaria_personas is
  'Lo que se le paga a cada persona en la planilla diaria, con su pago, su boleta y si RR. HH. ya se la entregó.';
-- Al anular un pago se buscan sus personas (b); la política de Storage busca la
-- boleta por su ruta (b). La llave del trabajador: ni (a) ni (b) ni (c).
create index if not exists ix_planilla_diaria_personas_pago on public.planilla_diaria_personas (pago_id) where pago_id is not null;
create index if not exists ix_planilla_diaria_personas_boleta on public.planilla_diaria_personas (boleta_ruta) where boleta_ruta is not null;
select public.activar_timestamps('planilla_diaria_personas');
select public.activar_auditoria('planilla_diaria_personas');
select public.activar_registro_de_prueba('planilla_diaria_personas');

create table if not exists public.planilla_diaria_detalle (
  id               uuid primary key default gen_random_uuid(),
  persona_id       uuid not null references public.planilla_diaria_personas(id) on delete restrict,
  trabajador_id    uuid not null references public.trabajadores(id) on delete restrict,
  -- El día trabajado.
  fecha            date not null,
  concepto         text not null,
  horas            numeric(4, 2) not null,
  horas_tramo1     numeric(4, 2) not null default 0,
  horas_tramo2     numeric(4, 2) not null default 0,
  valor_hora       numeric(10, 4) not null,
  recargo_tramo1   numeric(5, 2) not null default 0,
  recargo_tramo2   numeric(5, 2) not null default 0,
  monto            numeric(12, 2) not null,
  decision_id      uuid references public.horas_extras_decisiones(id) on delete restrict,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint ck_planilla_diaria_detalle check (
    concepto in ('ORDINARIAS', 'EXTRAS') and horas > 0 and horas <= 16 and valor_hora >= 0 and monto >= 0
    and ((concepto = 'ORDINARIAS' and decision_id is null and horas_tramo1 = 0 and horas_tramo2 = 0)
         or (concepto = 'EXTRAS' and decision_id is not null and horas_tramo1 + horas_tramo2 = horas)))
);
comment on table public.planilla_diaria_detalle is
  'Cada día de cada persona en la planilla diaria: sus horas ordinarias o sus horas extras pagadas, con la hora y el recargo de ese momento.';
-- El detalle de una persona (b, y es su llave); lo pagado de una persona en un
-- día (b, la cuenta de lo que falta pagar; sirve a la llave del trabajador); y
-- si una decisión de pagar ya entró a una planilla (b).
create index if not exists ix_planilla_diaria_detalle_persona on public.planilla_diaria_detalle (persona_id);
create index if not exists ix_planilla_diaria_detalle_trabajador on public.planilla_diaria_detalle (trabajador_id, fecha);
create index if not exists ix_planilla_diaria_detalle_decision on public.planilla_diaria_detalle (decision_id) where decision_id is not null;
select public.activar_timestamps('planilla_diaria_detalle');
select public.activar_auditoria('planilla_diaria_detalle');
select public.activar_registro_de_prueba('planilla_diaria_detalle');

-- 8. Lo que no se borra ni se corrige -----------------------------------------------------------------
-- Las decisiones y los usos del saldo, como el tareo: solo se anulan.
create or replace trigger trg_horas_extras_decision_guardia
  before update or delete on public.horas_extras_decisiones
  for each row execute function public.fn_rrhh_registro_guardia();
create or replace trigger trg_horas_compensadas_guardia
  before update or delete on public.horas_compensadas
  for each row execute function public.fn_rrhh_registro_guardia();

create or replace function public.fn_planilla_diaria_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'La planilla diaria y sus pagos no se borran: se anulan con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Eso está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice la planilla diaria no se corrige: anúlala con su motivo y arma otra.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_planilla_diaria_guardia() from public, anon, authenticated;
create or replace trigger trg_planilla_diaria_guardia
  before update or delete on public.planillas_diarias
  for each row execute function public.fn_planilla_diaria_guardia();
create or replace trigger trg_planilla_diaria_pago_guardia
  before update or delete on public.planilla_diaria_pagos
  for each row execute function public.fn_planilla_diaria_guardia();

-- De cada persona cambian solo su pago, su boleta y la entrega.
create or replace function public.fn_planilla_diaria_persona_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['pago_id', 'boleta_ruta', 'boleta_mime', 'boleta_tamano', 'boleta_subida_por',
    'boleta_subida_en', 'boleta_entregada_por', 'boleta_entregada_en', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una persona de la planilla diaria no se borra: se anula la planilla.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que se le paga a una persona en la planilla no se corrige: anula la planilla y arma otra.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_planilla_diaria_persona_guardia() from public, anon, authenticated;
create or replace trigger trg_planilla_diaria_persona_guardia
  before update or delete on public.planilla_diaria_personas
  for each row execute function public.fn_planilla_diaria_persona_guardia();

create or replace function public.fn_planilla_diaria_detalle_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'El detalle de la planilla diaria no se cambia ni se borra: anula la planilla y arma otra.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_planilla_diaria_detalle_guardia() from public, anon, authenticated;
create or replace trigger trg_planilla_diaria_detalle_guardia
  before update or delete on public.planilla_diaria_detalle
  for each row execute function public.fn_planilla_diaria_detalle_guardia();

create or replace function public.fn_trabajador_remuneracion_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'La remuneración no se borra: se corrige en la ficha de la persona.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_trabajador_remuneracion_guardia() from public, anon, authenticated;
create or replace trigger trg_trabajador_remuneracion_guardia
  before delete on public.trabajador_remuneraciones
  for each row execute function public.fn_trabajador_remuneracion_guardia();

-- 9. Quién ve qué ---------------------------------------------------------------------------------------
-- La planilla la ven RR. HH. (la arma), Tesorería (la paga) y Gerencia (la
-- consulta). Las cuentas bancarias no están aquí: Tesorería las lee con
-- planilla_diaria_cuentas, solo las de la gente de cada planilla.
create or replace function public.puede_ver_planilla_diaria()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('planilla_diaria.preparar')
      or public.tiene_permiso('planilla_diaria.pagar') or public.tiene_permiso('planilla_diaria.ver');
$$;
revoke all on function public.puede_ver_planilla_diaria() from public, anon;
grant execute on function public.puede_ver_planilla_diaria() to authenticated;

alter table public.rrhh_regla_horas_extras enable row level security;
alter table public.trabajador_remuneraciones enable row level security;
alter table public.horas_extras_decisiones enable row level security;
alter table public.horas_compensadas enable row level security;
alter table public.planillas_diarias enable row level security;
alter table public.planilla_diaria_pagos enable row level security;
alter table public.planilla_diaria_personas enable row level security;
alter table public.planilla_diaria_detalle enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rrhh_regla_horas_extras' and policyname = 'ver_regla_horas_extras') then
    create policy ver_regla_horas_extras on public.rrhh_regla_horas_extras for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('planilla_diaria.preparar'))
             or (select public.tiene_permiso('planilla_diaria.ver')));
  end if;
  -- La remuneración es el sueldo: solo RR. HH.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trabajador_remuneraciones' and policyname = 'ver_trabajador_remuneraciones') then
    create policy ver_trabajador_remuneraciones on public.trabajador_remuneraciones for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal'))
             or (select public.tiene_permiso('planilla_diaria.preparar')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'horas_extras_decisiones' and policyname = 'ver_horas_extras_decisiones') then
    create policy ver_horas_extras_decisiones on public.horas_extras_decisiones for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('planilla_diaria.preparar'))
             or (select public.tiene_permiso('planilla_diaria.ver')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'horas_compensadas' and policyname = 'ver_horas_compensadas') then
    create policy ver_horas_compensadas on public.horas_compensadas for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('planilla_diaria.preparar'))
             or (select public.tiene_permiso('planilla_diaria.ver')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planillas_diarias' and policyname = 'ver_planillas_diarias') then
    create policy ver_planillas_diarias on public.planillas_diarias for select to authenticated
      using ((select public.puede_ver_planilla_diaria()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planilla_diaria_pagos' and policyname = 'ver_planilla_diaria_pagos') then
    create policy ver_planilla_diaria_pagos on public.planilla_diaria_pagos for select to authenticated
      using ((select public.puede_ver_planilla_diaria()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planilla_diaria_personas' and policyname = 'ver_planilla_diaria_personas') then
    create policy ver_planilla_diaria_personas on public.planilla_diaria_personas for select to authenticated
      using ((select public.puede_ver_planilla_diaria()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planilla_diaria_detalle' and policyname = 'ver_planilla_diaria_detalle') then
    create policy ver_planilla_diaria_detalle on public.planilla_diaria_detalle for select to authenticated
      using ((select public.puede_ver_planilla_diaria()));
  end if;
end $$;
revoke all on public.rrhh_regla_horas_extras from public, anon, authenticated;
revoke all on public.trabajador_remuneraciones from public, anon, authenticated;
revoke all on public.horas_extras_decisiones from public, anon, authenticated;
revoke all on public.horas_compensadas from public, anon, authenticated;
revoke all on public.planillas_diarias from public, anon, authenticated;
revoke all on public.planilla_diaria_pagos from public, anon, authenticated;
revoke all on public.planilla_diaria_personas from public, anon, authenticated;
revoke all on public.planilla_diaria_detalle from public, anon, authenticated;
grant select on public.rrhh_regla_horas_extras to authenticated;
grant select on public.trabajador_remuneraciones to authenticated;
grant select on public.horas_extras_decisiones to authenticated;
grant select on public.horas_compensadas to authenticated;
grant select on public.planillas_diarias to authenticated;
grant select on public.planilla_diaria_pagos to authenticated;
grant select on public.planilla_diaria_personas to authenticated;
grant select on public.planilla_diaria_detalle to authenticated;

-- 10. Los comprobantes y las boletas en Storage ------------------------------------------------------------
-- Privado, hasta 10 MB, PDF o foto. La ruta es {planilla}/{archivo}: solo
-- Tesorería sube, y solo a una planilla vigente. Los ven quien lo subió y quien
-- ve la planilla que los nombra; uno suelto (subido y no registrado) lo retira
-- su dueño. Las políticas se crean una vez y se cambian con alter.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planilla-diaria', 'planilla-diaria', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'planilla_diaria_subir') then
    create policy planilla_diaria_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'planilla-diaria' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('planilla_diaria.pagar') or public.es_admin())
      and exists (select 1 from public.planillas_diarias p
                   where p.id::text = split_part(objects.name, '/', 1) and p.anulado_en is null));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'planilla_diaria_ver') then
    create policy planilla_diaria_ver on storage.objects for select to authenticated using (
      bucket_id = 'planilla-diaria'
      and (owner_id = (select auth.uid())::text
           or ((select public.puede_ver_planilla_diaria())
               and (exists (select 1 from public.planilla_diaria_pagos g where g.comprobante_ruta = objects.name)
                    or exists (select 1 from public.planilla_diaria_personas x where x.boleta_ruta = objects.name)))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'planilla_diaria_quitar_suelto') then
    create policy planilla_diaria_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'planilla-diaria' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.planilla_diaria_pagos g where g.comprobante_ruta = objects.name)
      and not exists (select 1 from public.planilla_diaria_personas x where x.boleta_ruta = objects.name));
  end if;
end $$;

-- 11. Las horas de cada persona en cada día ------------------------------------------------------------------
-- De los reportes validados por las dos áreas (y no anulados): las primeras 8
-- son ordinarias y el resto extras. Al lado, cuánto de lo ordinario ya está en
-- una planilla vigente y cuántas extras ya decidió RR. HH. La llaman solo las
-- funciones de abajo, que exigen el permiso.
create or replace function public.jornadas_validadas()
returns table (trabajador_id uuid, fecha date, horas numeric, ordinarias numeric, extras numeric,
               ordinarias_en_planilla numeric, extras_decididas numeric)
language sql stable set search_path to 'public' as $$
  with h as (
    select l.trabajador_id, l.fecha, sum(l.horas) as horas
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and r.observado_en is null
       and r.visto_gerencia_en is not null and r.visto_rrhh_en is not null
     group by l.trabajador_id, l.fecha
  )
  select h.trabajador_id, h.fecha, h.horas, least(h.horas, 8), greatest(h.horas - 8, 0),
         coalesce((select sum(d.horas)
                     from public.planilla_diaria_detalle d
                     join public.planilla_diaria_personas pp on pp.id = d.persona_id
                     join public.planillas_diarias p on p.id = pp.planilla_id
                    where d.trabajador_id = h.trabajador_id and d.fecha = h.fecha
                      and d.concepto = 'ORDINARIAS' and p.anulado_en is null), 0),
         coalesce((select sum(x.horas) from public.horas_extras_decisiones x
                    where x.trabajador_id = h.trabajador_id and x.fecha = h.fecha and x.anulado_en is null), 0)
    from h;
$$;
revoke all on function public.jornadas_validadas() from public, anon, authenticated;

-- Lo que falta pagar: las horas ordinarias validadas que no están en una
-- planilla vigente y las extras que RR. HH. decidió pagar y todavía no entraron.
create or replace function public.planilla_diaria_pendiente()
returns table (trabajador_id uuid, fecha date, concepto text, horas numeric, horas_tramo1 numeric, horas_tramo2 numeric, decision_id uuid)
language sql stable set search_path to 'public' as $$
  select j.trabajador_id, j.fecha, 'ORDINARIAS', j.ordinarias - j.ordinarias_en_planilla, 0::numeric, 0::numeric, null::uuid
    from public.jornadas_validadas() j
   where j.ordinarias - j.ordinarias_en_planilla > 0
  union all
  select x.trabajador_id, x.fecha, 'EXTRAS', x.horas, x.horas_tramo1, x.horas_tramo2, x.id
    from public.horas_extras_decisiones x
   where x.decision = 'PAGAR' and x.anulado_en is null
     and not exists (select 1 from public.planilla_diaria_detalle d
                       join public.planilla_diaria_personas pp on pp.id = d.persona_id
                       join public.planillas_diarias p on p.id = pp.planilla_id
                      where d.decision_id = x.id and p.anulado_en is null);
$$;
revoke all on function public.planilla_diaria_pendiente() from public, anon, authenticated;

-- Para la pantalla de RR. HH.: lo que va a entrar en la próxima planilla, con
-- el nombre, el cargo y la remuneración (sin ella, esa persona espera).
create or replace function public.planilla_diaria_por_enviar()
returns table (trabajador_id uuid, nombre text, cargo text, fecha date, concepto text, horas numeric,
               horas_tramo1 numeric, horas_tramo2 numeric, remuneracion_mensual numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  return query
    select p.trabajador_id, t.nombres || ' ' || t.apellidos, t.cargo, p.fecha, p.concepto, p.horas,
           p.horas_tramo1, p.horas_tramo2, r.remuneracion_mensual
      from public.planilla_diaria_pendiente() p
      join public.trabajadores t on t.id = p.trabajador_id
      left join public.trabajador_remuneraciones r on r.trabajador_id = p.trabajador_id
     order by t.apellidos, t.nombres, p.fecha, p.concepto desc;
end;
$$;
revoke all on function public.planilla_diaria_por_enviar() from public, anon;
grant execute on function public.planilla_diaria_por_enviar() to authenticated;

-- 12. Las horas extras por decidir y el saldo --------------------------------------------------------------
-- Lo que pasó de 8 horas en un día y RR. HH. todavía no decidió, con cuántas
-- irían con cada recargo. La remuneración solo para RR. HH.
create or replace function public.horas_extras_por_decidir()
returns table (trabajador_id uuid, nombre text, cargo text, fecha date, horas_del_dia numeric, extras numeric,
               por_decidir numeric, horas_tramo1 numeric, horas_tramo2 numeric, remuneracion_mensual numeric)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_ve_sueldo boolean := public.es_admin() or public.tiene_permiso('planilla_diaria.preparar');
  v_tramo     numeric := coalesce((select g.horas_tramo1 from public.rrhh_regla_horas_extras g where g.id), 2);
begin
  if not (v_ve_sueldo or public.tiene_permiso('planilla_diaria.ver')) then
    raise exception 'No tiene permiso para consultar las horas extras.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select j.trabajador_id, t.nombres || ' ' || t.apellidos, t.cargo, j.fecha, j.horas, j.extras,
           j.extras - j.extras_decididas,
           least(j.extras - j.extras_decididas, greatest(v_tramo - j.extras_decididas, 0)),
           (j.extras - j.extras_decididas) - least(j.extras - j.extras_decididas, greatest(v_tramo - j.extras_decididas, 0)),
           case when v_ve_sueldo then r.remuneracion_mensual end
      from public.jornadas_validadas() j
      join public.trabajadores t on t.id = j.trabajador_id
      left join public.trabajador_remuneraciones r on r.trabajador_id = j.trabajador_id
     where j.extras - j.extras_decididas > 0
     order by j.fecha, t.apellidos, t.nombres;
end;
$$;
revoke all on function public.horas_extras_por_decidir() from public, anon;
grant execute on function public.horas_extras_por_decidir() to authenticated;

-- El saldo de horas reservadas de cada persona, menos las que ya usó.
create or replace function public.saldo_horas_por_persona(p_trabajador_id uuid default null)
returns table (trabajador_id uuid, nombre text, cargo text, reservadas numeric, usadas numeric, saldo numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('planilla_diaria.preparar') or public.tiene_permiso('planilla_diaria.ver')) then
    raise exception 'No tiene permiso para consultar el saldo de horas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with res as (
      select x.trabajador_id, sum(x.horas) as h from public.horas_extras_decisiones x
       where x.decision = 'RESERVAR' and x.anulado_en is null group by x.trabajador_id),
    uso as (
      select c.trabajador_id, sum(c.horas) as h from public.horas_compensadas c
       where c.anulado_en is null group by c.trabajador_id)
    select t.id, t.nombres || ' ' || t.apellidos, t.cargo, coalesce(res.h, 0), coalesce(uso.h, 0),
           coalesce(res.h, 0) - coalesce(uso.h, 0)
      from public.trabajadores t
      left join res on res.trabajador_id = t.id
      left join uso on uso.trabajador_id = t.id
     where (res.h is not null or uso.h is not null)
       and (p_trabajador_id is null or t.id = p_trabajador_id)
     order by t.apellidos, t.nombres;
end;
$$;
revoke all on function public.saldo_horas_por_persona(uuid) from public, anon;
grant execute on function public.saldo_horas_por_persona(uuid) to authenticated;

-- RR. HH. decide todas las extras pendientes de una persona en un día. Un
-- reintento con el mismo p_id devuelve la decisión ya tomada.
create or replace function public.rrhh_decidir_horas_extras(p_id uuid, p_trabajador_id uuid, p_fecha date, p_decision text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_j      record;
  v_tramo  numeric := coalesce((select g.horas_tramo1 from public.rrhh_regla_horas_extras g where g.id), 2);
  v_pend   numeric;
  v_t1     numeric;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de horas extras.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.horas_extras_decisiones where id = p_id) then return p_id; end if;
  if p_decision not in ('RESERVAR', 'PAGAR') then
    raise exception 'Elige si las horas extras se reservan o se pagan.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('extras:' || p_trabajador_id::text, 0));
  select * into v_j from public.jornadas_validadas() j where j.trabajador_id = p_trabajador_id and j.fecha = p_fecha;
  v_pend := coalesce(v_j.extras - v_j.extras_decididas, 0);
  if v_pend <= 0 then
    raise exception 'Esa persona no tiene horas extras por decidir ese día: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  v_t1 := least(v_pend, greatest(v_tramo - v_j.extras_decididas, 0));
  insert into public.horas_extras_decisiones (id, trabajador_id, fecha, horas, horas_tramo1, horas_tramo2, decision)
  values (p_id, p_trabajador_id, p_fecha, v_pend, v_t1, v_pend - v_t1, p_decision);
  return p_id;
end;
$$;
revoke all on function public.rrhh_decidir_horas_extras(uuid, uuid, date, text) from public, anon;
grant execute on function public.rrhh_decidir_horas_extras(uuid, uuid, date, text) to authenticated;

-- Una decisión equivocada se anula y las horas vuelven a esperar: la de pagar,
-- si no entró a una planilla vigente; la de reservar, si el saldo no queda en
-- negativo.
create or replace function public.rrhh_anular_decision_horas_extras(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_dec    public.horas_extras_decisiones%rowtype;
  v_numero text;
  v_saldo  numeric;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_dec from public.horas_extras_decisiones where id = p_id for update;
  if not found then raise exception 'Esa decisión no existe.' using errcode = 'check_violation'; end if;
  if v_dec.anulado_en is not null then return p_id; end if;
  perform pg_advisory_xact_lock(hashtextextended('extras:' || v_dec.trabajador_id::text, 0));

  select p.numero into v_numero
    from public.planilla_diaria_detalle d
    join public.planilla_diaria_personas pp on pp.id = d.persona_id
    join public.planillas_diarias p on p.id = pp.planilla_id
   where d.decision_id = p_id and p.anulado_en is null
   limit 1;
  if v_numero is not null then
    raise exception 'Esas horas extras ya están en la planilla %: anula primero esa planilla.', v_numero using errcode = 'check_violation';
  end if;
  if v_dec.decision = 'RESERVAR' then
    select coalesce(sum(x.horas), 0) into v_saldo from public.horas_extras_decisiones x
     where x.trabajador_id = v_dec.trabajador_id and x.decision = 'RESERVAR' and x.anulado_en is null and x.id <> p_id;
    v_saldo := v_saldo - coalesce((select sum(c.horas) from public.horas_compensadas c
                                    where c.trabajador_id = v_dec.trabajador_id and c.anulado_en is null), 0);
    if v_saldo < 0 then
      raise exception 'Esas horas ya se usaron del saldo: anula primero el uso.' using errcode = 'check_violation';
    end if;
  end if;
  update public.horas_extras_decisiones
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.rrhh_anular_decision_horas_extras(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_decision_horas_extras(uuid, text) to authenticated;

-- Usar horas del saldo en otra ocasión: un permiso, un descanso.
create or replace function public.rrhh_usar_saldo_horas(p_id uuid, p_trabajador_id uuid, p_fecha date, p_horas numeric, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_horas  numeric(4, 2) := round(coalesce(p_horas, 0), 2);
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_saldo  numeric;
  v_nombre text;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.horas_compensadas where id = p_id) then return p_id; end if;
  select nombres || ' ' || apellidos into v_nombre from public.trabajadores where id = p_trabajador_id;
  if v_nombre is null then
    raise exception 'Elige a una persona del personal.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha < v_hoy - 366 or p_fecha > v_hoy + 366 then
    raise exception 'Elige el día en que usa las horas.' using errcode = 'check_violation';
  end if;
  if v_horas <= 0 or v_horas > 8 then
    raise exception 'Las horas que usa van de 0,25 a 8 por día.' using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) not between 10 and 300 then
    raise exception 'Cuenta para qué usa las horas (un permiso, un descanso), en 10 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('extras:' || p_trabajador_id::text, 0));
  select coalesce(sum(x.horas), 0) into v_saldo from public.horas_extras_decisiones x
   where x.trabajador_id = p_trabajador_id and x.decision = 'RESERVAR' and x.anulado_en is null;
  v_saldo := v_saldo - coalesce((select sum(c.horas) from public.horas_compensadas c
                                  where c.trabajador_id = p_trabajador_id and c.anulado_en is null), 0);
  if v_horas > v_saldo then
    raise exception '% tiene % h reservadas: no le alcanzan para %.', v_nombre,
      rtrim(rtrim(to_char(v_saldo, 'FM990.00'), '0'), '.'), rtrim(rtrim(to_char(v_horas, 'FM990.00'), '0'), '.') || ' h'
      using errcode = 'check_violation';
  end if;
  insert into public.horas_compensadas (id, trabajador_id, fecha, horas, motivo)
  values (p_id, p_trabajador_id, p_fecha, v_horas, v_motivo);
  return p_id;
end;
$$;
revoke all on function public.rrhh_usar_saldo_horas(uuid, uuid, date, numeric, text) from public, anon;
grant execute on function public.rrhh_usar_saldo_horas(uuid, uuid, date, numeric, text) to authenticated;

create or replace function public.rrhh_anular_uso_saldo(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_uso public.horas_compensadas%rowtype;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_uso from public.horas_compensadas where id = p_id for update;
  if not found then raise exception 'Ese uso del saldo no existe.' using errcode = 'check_violation'; end if;
  if v_uso.anulado_en is not null then return p_id; end if;
  update public.horas_compensadas
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.rrhh_anular_uso_saldo(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_uso_saldo(uuid, text) to authenticated;

-- La regla de las horas extras la ajusta RR. HH.; la ley pone el piso.
create or replace function public.rrhh_guardar_regla_horas_extras(p_horas_tramo1 numeric, p_recargo_tramo1 numeric, p_recargo_tramo2 numeric)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if p_horas_tramo1 is null or p_horas_tramo1 not between 0 and 2 then
    raise exception 'Las horas con el primer recargo van de 0 a 2: la ley paga las siguientes con el segundo.' using errcode = 'check_violation';
  end if;
  if p_recargo_tramo1 is null or p_recargo_tramo1 not between 25 and 200 then
    raise exception 'El primer recargo va de 25 %% a 200 %%: la ley no deja pagar menos de 25 %%.' using errcode = 'check_violation';
  end if;
  if p_recargo_tramo2 is null or p_recargo_tramo2 not between 35 and 200 then
    raise exception 'El segundo recargo va de 35 %% a 200 %%: la ley no deja pagar menos de 35 %%.' using errcode = 'check_violation';
  end if;
  if p_recargo_tramo2 < p_recargo_tramo1 then
    raise exception 'El segundo recargo no puede ser menor que el primero.' using errcode = 'check_violation';
  end if;
  insert into public.rrhh_regla_horas_extras (id, horas_tramo1, recargo_tramo1, recargo_tramo2, actualizado_por, actualizado_en)
  values (true, round(p_horas_tramo1, 2), round(p_recargo_tramo1, 2), round(p_recargo_tramo2, 2), public.usuario_actual(), now())
  on conflict (id) do update
     set horas_tramo1 = excluded.horas_tramo1, recargo_tramo1 = excluded.recargo_tramo1, recargo_tramo2 = excluded.recargo_tramo2,
         actualizado_por = excluded.actualizado_por, actualizado_en = now();
end;
$$;
revoke all on function public.rrhh_guardar_regla_horas_extras(numeric, numeric, numeric) from public, anon;
grant execute on function public.rrhh_guardar_regla_horas_extras(numeric, numeric, numeric) to authenticated;

-- 13. La remuneración de una persona --------------------------------------------------------------------------
create or replace function public.rrhh_guardar_remuneracion_trabajador(p_trabajador_id uuid, p_remuneracion_mensual numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  if not exists (select 1 from public.trabajadores where id = p_trabajador_id) then
    raise exception 'La persona no existe: registra primero su ficha.' using errcode = 'check_violation';
  end if;
  if p_remuneracion_mensual is null or p_remuneracion_mensual <= 0 or p_remuneracion_mensual > 100000 then
    raise exception 'La remuneración mensual va de S/ 0,01 a S/ 100 000.' using errcode = 'check_violation';
  end if;
  insert into public.trabajador_remuneraciones (trabajador_id, remuneracion_mensual, actualizado_por)
  values (p_trabajador_id, round(p_remuneracion_mensual, 2), public.usuario_actual())
  on conflict (trabajador_id) do update
     set remuneracion_mensual = excluded.remuneracion_mensual, actualizado_por = excluded.actualizado_por;
  return p_trabajador_id;
end;
$$;
revoke all on function public.rrhh_guardar_remuneracion_trabajador(uuid, numeric) from public, anon;
grant execute on function public.rrhh_guardar_remuneracion_trabajador(uuid, numeric) to authenticated;

-- 14. Armar la planilla y mandarla a Tesorería ------------------------------------------------------------------
-- Entra todo lo que falta pagar de las personas con remuneración; la de quien no
-- la tiene espera a la siguiente. Un reintento con el mismo p_id devuelve la
-- planilla ya mandada.
create or replace function public.enviar_planilla_diaria(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_regla    public.rrhh_regla_horas_extras%rowtype;
  v_pend     jsonb;
  v_persona  record;
  v_linea    jsonb;
  v_pid      uuid;
  v_hora     numeric(10, 4);
  v_monto    numeric(12, 2);
  v_ord_h    numeric := 0;
  v_ext_h    numeric := 0;
  v_ord_m    numeric := 0;
  v_ext_m    numeric := 0;
  v_total    numeric := 0;
  v_n        int := 0;
  v_numero   text;
  v_faltan   text;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de la planilla diaria.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.planillas_diarias where id = p_id) then return p_id; end if;

  -- Dos envíos a la vez no se llevan las mismas horas.
  perform pg_advisory_xact_lock(hashtextextended('planilla_diaria', 0));
  select * into v_regla from public.rrhh_regla_horas_extras where id;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into v_pend
    from public.planilla_diaria_pendiente() p
   where exists (select 1 from public.trabajador_remuneraciones r where r.trabajador_id = p.trabajador_id);

  if jsonb_array_length(v_pend) = 0 then
    select string_agg(distinct t.nombres || ' ' || t.apellidos, ', ') into v_faltan
      from public.planilla_diaria_pendiente() p join public.trabajadores t on t.id = p.trabajador_id;
    if v_faltan is not null then
      raise exception 'Falta la remuneración mensual de %: pónsela en Personal y vuelve a armar la planilla.', v_faltan
        using errcode = 'check_violation';
    end if;
    raise exception 'No hay horas validadas por pagar: la planilla sale de los reportes con el visto de Gerencia y de Recursos Humanos.'
      using errcode = 'check_violation';
  end if;

  v_numero := public.siguiente_correlativo('PLANILLA_DIARIA', '001', null);
  -- Primero se cuentan las personas y el total: la guardia deja cambiar solo la
  -- anulación, así que van en el mismo insert de la planilla.
  for v_persona in
    select distinct (e->>'trabajador_id')::uuid as trabajador_id, t.nombres || ' ' || t.apellidos as nombre, t.cargo, t.apellidos, t.nombres,
           r.remuneracion_mensual
      from jsonb_array_elements(v_pend) e
      join public.trabajadores t on t.id = (e->>'trabajador_id')::uuid
      join public.trabajador_remuneraciones r on r.trabajador_id = t.id
     order by t.apellidos, t.nombres
  loop
    v_n := v_n + 1;
    v_hora := round(v_persona.remuneracion_mensual / 240, 4);
    v_ord_h := 0; v_ext_h := 0; v_ord_m := 0; v_ext_m := 0;
    for v_linea in select e from jsonb_array_elements(v_pend) e where (e->>'trabajador_id')::uuid = v_persona.trabajador_id loop
      if v_linea->>'concepto' = 'ORDINARIAS' then
        v_monto := round((v_linea->>'horas')::numeric * v_hora, 2);
        v_ord_h := v_ord_h + (v_linea->>'horas')::numeric;
        v_ord_m := v_ord_m + v_monto;
      else
        v_monto := round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                   + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2);
        v_ext_h := v_ext_h + (v_linea->>'horas')::numeric;
        v_ext_m := v_ext_m + v_monto;
      end if;
    end loop;
    v_total := v_total + v_ord_m + v_ext_m;
  end loop;

  insert into public.planillas_diarias (id, numero, fecha, personas, total, enviada_por)
  values (p_id, v_numero, (now() at time zone 'America/Lima')::date, v_n, v_total, v_yo);

  for v_persona in
    select distinct (e->>'trabajador_id')::uuid as trabajador_id, t.nombres || ' ' || t.apellidos as nombre, t.cargo, t.apellidos, t.nombres,
           r.remuneracion_mensual
      from jsonb_array_elements(v_pend) e
      join public.trabajadores t on t.id = (e->>'trabajador_id')::uuid
      join public.trabajador_remuneraciones r on r.trabajador_id = t.id
     order by t.apellidos, t.nombres
  loop
    v_hora := round(v_persona.remuneracion_mensual / 240, 4);
    v_ord_h := 0; v_ext_h := 0; v_ord_m := 0; v_ext_m := 0;
    -- Primero los totales de la persona (la guardia no deja cambiarlos después).
    for v_linea in select e from jsonb_array_elements(v_pend) e where (e->>'trabajador_id')::uuid = v_persona.trabajador_id loop
      if v_linea->>'concepto' = 'ORDINARIAS' then
        v_ord_h := v_ord_h + (v_linea->>'horas')::numeric;
        v_ord_m := v_ord_m + round((v_linea->>'horas')::numeric * v_hora, 2);
      else
        v_ext_h := v_ext_h + (v_linea->>'horas')::numeric;
        v_ext_m := v_ext_m + round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                             + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2);
      end if;
    end loop;
    insert into public.planilla_diaria_personas (planilla_id, trabajador_id, nombre, cargo, horas_ordinarias, horas_extras,
                                                 monto_ordinarias, monto_extras, total)
    values (p_id, v_persona.trabajador_id, v_persona.nombre, v_persona.cargo, v_ord_h, v_ext_h, v_ord_m, v_ext_m, v_ord_m + v_ext_m)
    returning id into v_pid;

    for v_linea in
      select e from jsonb_array_elements(v_pend) e
       where (e->>'trabajador_id')::uuid = v_persona.trabajador_id
       order by e->>'fecha', e->>'concepto' desc
    loop
      if v_linea->>'concepto' = 'ORDINARIAS' then
        insert into public.planilla_diaria_detalle (persona_id, trabajador_id, fecha, concepto, horas, valor_hora, monto)
        values (v_pid, v_persona.trabajador_id, (v_linea->>'fecha')::date, 'ORDINARIAS', (v_linea->>'horas')::numeric, v_hora,
                round((v_linea->>'horas')::numeric * v_hora, 2));
      else
        insert into public.planilla_diaria_detalle (persona_id, trabajador_id, fecha, concepto, horas, horas_tramo1, horas_tramo2,
                                                    valor_hora, recargo_tramo1, recargo_tramo2, monto, decision_id)
        values (v_pid, v_persona.trabajador_id, (v_linea->>'fecha')::date, 'EXTRAS', (v_linea->>'horas')::numeric,
                (v_linea->>'horas_tramo1')::numeric, (v_linea->>'horas_tramo2')::numeric, v_hora,
                v_regla.recargo_tramo1, v_regla.recargo_tramo2,
                round(v_hora * ((v_linea->>'horas_tramo1')::numeric * (1 + v_regla.recargo_tramo1 / 100)
                                + (v_linea->>'horas_tramo2')::numeric * (1 + v_regla.recargo_tramo2 / 100)), 2),
                (v_linea->>'decision_id')::uuid);
      end if;
    end loop;
  end loop;

  perform public.notificar_a_permiso('planilla_diaria.pagar', 'Planilla diaria por pagar: ' || v_numero,
    v_n || case when v_n = 1 then ' persona · S/ ' else ' personas · S/ ' end || to_char(v_total, 'FM999G999G990D00'),
    '/planilla-diaria/' || p_id, 'planillas_diarias', p_id, v_yo);
  return p_id;
end;
$$;
revoke all on function public.enviar_planilla_diaria(uuid) from public, anon;
grant execute on function public.enviar_planilla_diaria(uuid) to authenticated;

-- Una planilla equivocada se anula mientras Tesorería no haya pagado nada de
-- ella: sus horas vuelven a esperar la siguiente.
create or replace function public.anular_planilla_diaria(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pla public.planillas_diarias%rowtype;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('planilla_diaria', 0));
  select * into v_pla from public.planillas_diarias where id = p_id for update;
  if not found then raise exception 'Esa planilla no existe.' using errcode = 'check_violation'; end if;
  if v_pla.anulado_en is not null then return p_id; end if;
  if exists (select 1 from public.planilla_diaria_pagos where planilla_id = p_id and anulado_en is null) then
    raise exception 'Tesorería ya registró un pago de la planilla %: pídele que lo anule primero.', v_pla.numero using errcode = 'check_violation';
  end if;
  update public.planillas_diarias
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  perform public.notificar_a_permiso('planilla_diaria.pagar', 'Planilla diaria anulada: ' || v_pla.numero,
    'Recursos Humanos la anuló: ' || left(btrim(p_motivo), 200), '/planilla-diaria/' || p_id, 'planillas_diarias', p_id,
    public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.anular_planilla_diaria(uuid, text) from public, anon;
grant execute on function public.anular_planilla_diaria(uuid, text) to authenticated;

-- 15. Tesorería: la cuenta de cada persona de la planilla --------------------------------------------------------
-- Solo de la gente de esa planilla, y solo mientras está vigente.
create or replace function public.planilla_diaria_cuentas(p_planilla_id uuid)
returns table (persona_id uuid, banco text, tipo_cuenta text, numero_cuenta text, cci text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('planilla_diaria.pagar') or public.tiene_permiso('planilla_diaria.preparar')) then
    raise exception 'Las cuentas de la planilla las ve Tesorería, que paga.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select pp.id, c.banco, c.tipo_cuenta, c.numero_cuenta, c.cci
      from public.planilla_diaria_personas pp
      join public.planillas_diarias p on p.id = pp.planilla_id and p.anulado_en is null
      left join public.trabajador_cuentas c on c.trabajador_id = pp.trabajador_id
     where pp.planilla_id = p_planilla_id;
end;
$$;
revoke all on function public.planilla_diaria_cuentas(uuid) from public, anon;
grant execute on function public.planilla_diaria_cuentas(uuid) to authenticated;

-- El archivo que Tesorería subió para esta planilla: comprobante o boleta.
create or replace function public.planilla_diaria_archivo(p_planilla_id uuid, p_ruta text)
returns storage.objects language plpgsql stable set search_path to 'public' as $$
declare v_obj storage.objects%rowtype;
begin
  if p_ruta is null or p_ruta !~ ('^' || p_planilla_id::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then
    raise exception 'Vuelve a adjuntar el archivo.' using errcode = 'check_violation';
  end if;
  select * into v_obj from storage.objects where bucket_id = 'planilla-diaria' and name = p_ruta;
  if not found or v_obj.owner_id is distinct from public.usuario_actual()::text
     or v_obj.metadata->>'mimetype' not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_obj.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'El archivo no terminó de subir: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  return v_obj;
end;
$$;
revoke all on function public.planilla_diaria_archivo(uuid, text) from public, anon, authenticated;

-- 16. Tesorería registra el pago con su comprobante ---------------------------------------------------------------
-- De una persona o de varias a la vez (un pago en lote, un solo comprobante).
create or replace function public.registrar_pago_planilla_diaria(
  p_id uuid, p_planilla_id uuid, p_personas uuid[], p_fecha_pago date, p_operacion text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_pla  public.planillas_diarias%rowtype;
  v_obj  storage.objects%rowtype;
  v_n    int;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
begin
  perform public.exigir_permiso('planilla_diaria.pagar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.planilla_diaria_pagos where id = p_id) then return p_id; end if;
  select * into v_pla from public.planillas_diarias where id = p_planilla_id for update;
  if not found then raise exception 'Esa planilla no existe.' using errcode = 'check_violation'; end if;
  if v_pla.anulado_en is not null then
    raise exception 'La planilla % está anulada: no se paga.', v_pla.numero using errcode = 'check_violation';
  end if;
  if p_personas is null or cardinality(p_personas) = 0 then
    raise exception 'Marca a quién le pagaste.' using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_pla.fecha - 7 then
    raise exception 'Elige el día del pago: desde que llegó la planilla hasta hoy.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  select count(*) into v_n from public.planilla_diaria_personas
   where planilla_id = p_planilla_id and id = any(p_personas) and pago_id is null;
  if v_n <> cardinality(array(select distinct unnest(p_personas))) then
    raise exception 'Alguna de las personas marcadas ya está pagada o no es de esta planilla: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  v_obj := public.planilla_diaria_archivo(p_planilla_id, p_ruta);
  if exists (select 1 from public.planilla_diaria_pagos where comprobante_ruta = p_ruta)
     or exists (select 1 from public.planilla_diaria_personas where boleta_ruta = p_ruta) then
    raise exception 'Ese archivo ya está adjunto: sube el comprobante de este pago.' using errcode = 'check_violation';
  end if;

  insert into public.planilla_diaria_pagos (id, planilla_id, fecha_pago, operacion, comprobante_ruta, comprobante_mime, comprobante_tamano, registrado_por)
  values (p_id, p_planilla_id, p_fecha_pago, v_op, p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);
  update public.planilla_diaria_personas set pago_id = p_id
   where planilla_id = p_planilla_id and id = any(p_personas) and pago_id is null;

  if not exists (select 1 from public.planilla_diaria_personas where planilla_id = p_planilla_id and pago_id is null) then
    perform public.notificar_a_permiso('planilla_diaria.preparar', 'Planilla diaria pagada: ' || v_pla.numero,
      'Tesorería pagó a todos y adjuntó los comprobantes.', '/planilla-diaria/' || p_planilla_id, 'planillas_diarias', p_planilla_id, v_yo);
  end if;
  return p_id;
end;
$$;
revoke all on function public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text) from public, anon;
grant execute on function public.registrar_pago_planilla_diaria(uuid, uuid, uuid[], date, text, text) to authenticated;

-- Un pago mal registrado se anula: sus personas vuelven a quedar por pagar.
create or replace function public.anular_pago_planilla_diaria(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.planilla_diaria_pagos%rowtype;
begin
  perform public.exigir_permiso('planilla_diaria.pagar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.planilla_diaria_pagos where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  update public.planilla_diaria_personas set pago_id = null where pago_id = p_id;
  update public.planilla_diaria_pagos
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_pago_planilla_diaria(uuid, text) from public, anon;
grant execute on function public.anular_pago_planilla_diaria(uuid, text) to authenticated;

-- 17. Las boletas: Tesorería las adjunta y RR. HH. las entrega ---------------------------------------------------
-- Mientras RR. HH. no la entregue, una boleta equivocada se reemplaza.
create or replace function public.subir_boleta_planilla_diaria(p_persona_id uuid, p_ruta text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_per  public.planilla_diaria_personas%rowtype;
  v_pla  public.planillas_diarias%rowtype;
  v_obj  storage.objects%rowtype;
begin
  perform public.exigir_permiso('planilla_diaria.pagar');
  select * into v_per from public.planilla_diaria_personas where id = p_persona_id for update;
  if not found then raise exception 'Esa persona no está en la planilla.' using errcode = 'check_violation'; end if;
  select * into v_pla from public.planillas_diarias where id = v_per.planilla_id;
  if v_pla.anulado_en is not null then
    raise exception 'La planilla % está anulada.', v_pla.numero using errcode = 'check_violation';
  end if;
  if v_per.boleta_ruta = p_ruta then return p_persona_id; end if;
  if v_per.boleta_entregada_en is not null then
    raise exception 'Recursos Humanos ya entregó la boleta de %: ya no se cambia.', v_per.nombre using errcode = 'check_violation';
  end if;
  v_obj := public.planilla_diaria_archivo(v_per.planilla_id, p_ruta);
  if exists (select 1 from public.planilla_diaria_pagos where comprobante_ruta = p_ruta)
     or exists (select 1 from public.planilla_diaria_personas where boleta_ruta = p_ruta) then
    raise exception 'Ese archivo ya está adjunto: sube la boleta de %.', v_per.nombre using errcode = 'check_violation';
  end if;
  update public.planilla_diaria_personas
     set boleta_ruta = p_ruta, boleta_mime = v_obj.metadata->>'mimetype', boleta_tamano = (v_obj.metadata->>'size')::integer,
         boleta_subida_por = v_yo, boleta_subida_en = now()
   where id = p_persona_id;

  if not exists (select 1 from public.planilla_diaria_personas where planilla_id = v_per.planilla_id and boleta_ruta is null) then
    perform public.notificar_a_permiso('planilla_diaria.preparar', 'Boletas por entregar: ' || v_pla.numero,
      'Tesorería adjuntó las boletas de todos. Entrégalas y márcalas.', '/planilla-diaria/' || v_pla.id, 'planillas_diarias', v_pla.id, v_yo);
  end if;
  return p_persona_id;
end;
$$;
revoke all on function public.subir_boleta_planilla_diaria(uuid, text) from public, anon;
grant execute on function public.subir_boleta_planilla_diaria(uuid, text) to authenticated;

create or replace function public.entregar_boleta_planilla_diaria(p_persona_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_per public.planilla_diaria_personas%rowtype;
begin
  perform public.exigir_permiso('planilla_diaria.preparar');
  select * into v_per from public.planilla_diaria_personas where id = p_persona_id for update;
  if not found then raise exception 'Esa persona no está en la planilla.' using errcode = 'check_violation'; end if;
  if v_per.boleta_entregada_en is not null then return p_persona_id; end if;
  if v_per.boleta_ruta is null then
    raise exception 'Tesorería todavía no adjunta la boleta de %.', v_per.nombre using errcode = 'check_violation';
  end if;
  update public.planilla_diaria_personas
     set boleta_entregada_por = public.usuario_actual(), boleta_entregada_en = now()
   where id = p_persona_id;
  return p_persona_id;
end;
$$;
revoke all on function public.entregar_boleta_planilla_diaria(uuid) from public, anon;
grant execute on function public.entregar_boleta_planilla_diaria(uuid) to authenticated;

-- 18. Anular un reporte, ahora que se valida y se paga -------------------------------------------------------------
-- Quien lo subió, dentro de los 7 días y mientras no lo hayan validado las dos
-- áreas; RR. HH., siempre, salvo que sus horas ya estén en una planilla vigente
-- o que RR. HH. ya haya decidido sus horas extras (primero se anula eso).
create or replace function public.anular_reporte_diario(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_rep     public.reportes_diarios%rowtype;
  v_choque  record;
  v_numero  text;
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
    if v_rep.visto_gerencia_en is not null and v_rep.visto_rrhh_en is not null and v_rep.anulado_en is null then
      raise exception 'Ese reporte ya lo validaron Gerencia y Recursos Humanos: pídele a Recursos Humanos que lo anule.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if v_rep.anulado_en is not null then return p_id; end if;

  -- Validado, sus horas pueden estar ya pagadas o decididas: sin este reporte,
  -- a nadie le puede quedar menos de lo que ya se pagó o se decidió ese día.
  if v_rep.visto_gerencia_en is not null and v_rep.visto_rrhh_en is not null and v_rep.observado_en is null then
    for v_choque in
      select j.trabajador_id, j.fecha, j.horas - s.horas as quedan, j.ordinarias_en_planilla, j.extras_decididas, s.nombre
        from (select l.trabajador_id, l.fecha, sum(l.horas) as horas, min(l.nombre) as nombre
                from public.reporte_diario_personal l where l.reporte_id = p_id group by l.trabajador_id, l.fecha) s
        join public.jornadas_validadas() j on j.trabajador_id = s.trabajador_id and j.fecha = s.fecha
       where least(j.horas - s.horas, 8) < j.ordinarias_en_planilla
          or greatest(j.horas - s.horas - 8, 0) < j.extras_decididas
    loop
      if least(v_choque.quedan, 8) < v_choque.ordinarias_en_planilla then
        select p.numero into v_numero
          from public.planilla_diaria_detalle d
          join public.planilla_diaria_personas pp on pp.id = d.persona_id
          join public.planillas_diarias p on p.id = pp.planilla_id
         where d.trabajador_id = v_choque.trabajador_id and d.fecha = v_choque.fecha
           and d.concepto = 'ORDINARIAS' and p.anulado_en is null
         order by p.creado_en desc limit 1;
        raise exception 'Las horas de % del % ya están en la planilla %: anula primero esa planilla.',
          v_choque.nombre, to_char(v_choque.fecha, 'DD/MM/YYYY'), v_numero using errcode = 'check_violation';
      end if;
      raise exception 'Recursos Humanos ya decidió las horas extras de % del %: anula primero esa decisión.',
        v_choque.nombre, to_char(v_choque.fecha, 'DD/MM/YYYY') using errcode = 'check_violation';
    end loop;
  end if;

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
