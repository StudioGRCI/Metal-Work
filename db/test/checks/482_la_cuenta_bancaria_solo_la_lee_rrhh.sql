-- La cuenta bancaria del personal la lee solo RR. HH. (migración 20261126620000).
-- Con el rol real y `set local role authenticated`: RR. HH. la lee en la tabla
-- (y en `audit_log`, si tuviera `auditoria.ver`: hoy no lo tiene, así que la
-- historia de las cuentas no la ve nadie en la aplicación); el administrador no la
-- lee en ninguna de las dos, ni por `planilla_diaria_cuentas`, ni por «Sin cuenta
-- bancaria» en lo que le falta a la planilla; Tesorería sigue entrando a
-- `planilla_diaria_cuentas` para pagar. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['RECURSOS_HUMANOS:RRH', 'ADMIN:GGE', 'TESORERIA:TES', 'GERENTE:GGE'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.482@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 482', lower(split_part(v, ':', 1)) || '.482@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
end $$;

create function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid)
$$;

-- RR. HH. pone la ficha y la cuenta: la cuenta deja su rastro en audit_log.
select pg_temp.como('recursos_humanos');
insert into public.trabajadores (id, nombres, apellidos, dni, area_id, creado_por)
values ('48200000-0000-4000-8000-000000000001', 'Cata', 'Prueba Cuenta', '48200001', (select id from public.areas where codigo = 'PRD'),
        current_setting('prueba.recursos_humanos')::uuid);
insert into public.trabajador_cuentas (trabajador_id, banco, tipo_cuenta, numero_cuenta)
values ('48200000-0000-4000-8000-000000000001', 'Banco de Pruebas', 'AHORROS', '000-482-000001');
-- Dino tiene ficha y no cuenta; Zoe no tiene ficha. Los tres en la planilla de taller.
insert into public.trabajadores (id, nombres, apellidos, dni, area_id, creado_por)
values ('48200000-0000-4000-8000-000000000002', 'Dino', 'Prueba Cuenta', '48200002', (select id from public.areas where codigo = 'PRD'),
        current_setting('prueba.recursos_humanos')::uuid);
insert into public.planillas (id, tipo, periodo, registrado_por)
values ('48200000-0000-4000-8000-0000000000b1', 'TALLER', date '2031-04-01', public.usuario_actual());
insert into public.planilla_personas (planilla_id, nombre, documento, monto, registrado_por)
values ('48200000-0000-4000-8000-0000000000b1', 'Cata Prueba Cuenta', '48200001', 1500, public.usuario_actual()),
       ('48200000-0000-4000-8000-0000000000b1', 'Dino Prueba Cuenta', '48200002', 1400, public.usuario_actual()),
       ('48200000-0000-4000-8000-0000000000b1', 'Zoe Sin Ficha', null, 900, public.usuario_actual());

-- Una planilla diaria con Cata y Dino, sembrada sin sus disparadores (enviarla de
-- verdad pide horas validadas que este check no arma): lo que se prueba es quién
-- lee sus cuentas, no cómo se envía. Número inventado; todo termina en rollback.
reset role;
set local session_replication_role = replica;
insert into public.planillas_diarias (id, numero, fecha, personas, total, enviada_por)
values ('48200000-0000-4000-8000-0000000000e1', 'PD-9482-2031', date '2031-04-15', 2, 200,
        current_setting('prueba.recursos_humanos')::uuid);
insert into public.planilla_diaria_personas (planilla_id, trabajador_id, nombre, horas_ordinarias, horas_extras, monto_ordinarias, monto_extras, total)
values ('48200000-0000-4000-8000-0000000000e1', '48200000-0000-4000-8000-000000000001', 'Cata Prueba Cuenta', 8, 0, 100, 0, 100),
       ('48200000-0000-4000-8000-0000000000e1', '48200000-0000-4000-8000-000000000002', 'Dino Prueba Cuenta', 8, 0, 100, 0, 100);
set local session_replication_role = origin;

-- La auditoría sí anotó la cuenta: los ceros de abajo son la política, no un vacío.
select test.afirmar(
  (select count(*) > 0 from public.audit_log where tabla = 'trabajador_cuentas'
     and datos_despues ->> 'numero_cuenta' = '000-482-000001'),
  'la cuenta de Cata quedó en audit_log');

-- ============================================ 1. RR. HH. la lee
set local role authenticated;
select test.afirmar(
  (select count(*) = 1 from public.trabajador_cuentas where trabajador_id = '48200000-0000-4000-8000-000000000001'),
  'RR. HH. lee la cuenta bancaria');
select test.afirmar(
  (select array_agg(clase || ':' || nombre order by clase, nombre)
     from public.planilla_lo_que_falta('48200000-0000-4000-8000-0000000000b1') where clase like 'SIN_%')
  = array['SIN_CUENTA:Dino Prueba Cuenta', 'SIN_FICHA:Zoe Sin Ficha'],
  'a RR. HH. lo que falta de la planilla le dice quién no tiene cuenta y quién no tiene ficha');
reset role;

-- ============================================ 2. El administrador, no
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(
  (select count(*) = 0 from public.trabajador_cuentas where trabajador_id = '48200000-0000-4000-8000-000000000001'),
  'el administrador no lee la cuenta bancaria');
select test.afirmar(
  (select count(*) = 0 from public.audit_log where tabla = 'trabajador_cuentas'),
  'el administrador no lee la historia de las cuentas en audit_log');
select test.afirmar(
  (select count(*) > 0 from public.audit_log where tabla = 'trabajadores' and registro_id = '48200000-0000-4000-8000-000000000001'),
  'el administrador sigue leyendo la historia de la ficha, que no lleva la cuenta');
select test.debe_fallar($$select * from public.planilla_diaria_cuentas(gen_random_uuid())$$,
  'el administrador no lee las cuentas de la planilla diaria', 'permiso');
select test.afirmar(
  (select array_agg(clase || ':' || nombre order by clase, nombre)
     from public.planilla_lo_que_falta('48200000-0000-4000-8000-0000000000b1') where clase like 'SIN_%')
  = array['SIN_FICHA:Zoe Sin Ficha'],
  'al administrador lo que falta de la planilla le dice quién no tiene ficha, pero no quién no tiene cuenta');
reset role;

-- ============================================ 3. Gerencia, tampoco
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) = 0 from public.trabajador_cuentas where trabajador_id = '48200000-0000-4000-8000-000000000001'),
  'Gerencia no lee la cuenta bancaria');
select test.afirmar(
  (select count(*) = 0 from public.audit_log where tabla = 'trabajador_cuentas'),
  'Gerencia, con auditoria.ver y sin rrhh.personal, no lee la historia de las cuentas');
reset role;

-- ============================================ 4. Tesorería sigue pagando la planilla diaria
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(
  (select array_agg(coalesce(numero_cuenta, 'sin cuenta') order by numero_cuenta nulls last)
     from public.planilla_diaria_cuentas('48200000-0000-4000-8000-0000000000e1'))
  = array['000-482-000001', 'sin cuenta'],
  'Tesorería lee la cuenta de cada persona de la planilla diaria para pagarle: la de Cata, y que Dino no tiene');
select test.afirmar(
  (select count(*) = 0 from public.trabajador_cuentas),
  'Tesorería no lee la tabla de cuentas: solo las de la planilla que paga');
reset role;

-- ============================================ 5. La política de audit_log es restrictiva
select test.afirmar(
  (select permissive = 'RESTRICTIVE' from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and policyname = 'cuentas_solo_rrhh'),
  'audit_log lleva la política restrictiva de las cuentas');

rollback;
