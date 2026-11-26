-- La cuenta bancaria del personal la lee solo RR. HH. (migración 20261126620000).
-- Con el rol real y `set local role authenticated`: RR. HH. la lee, en la tabla y
-- en su historia de `audit_log`; el administrador no la lee en ninguna de las dos,
-- ni por `planilla_diaria_cuentas`; Tesorería sigue entrando a esa función para
-- pagar. Termina en rollback.
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

-- ============================================ 1. RR. HH. la lee
set local role authenticated;
select test.afirmar(
  (select count(*) = 1 from public.trabajador_cuentas where trabajador_id = '48200000-0000-4000-8000-000000000001'),
  'RR. HH. lee la cuenta bancaria');
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
reset role;

-- ============================================ 3. Gerencia, tampoco
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) = 0 from public.trabajador_cuentas where trabajador_id = '48200000-0000-4000-8000-000000000001'),
  'Gerencia no lee la cuenta bancaria');
reset role;

-- ============================================ 4. Tesorería sigue pagando la planilla diaria
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(
  (select count(*) = 0 from public.planilla_diaria_cuentas(gen_random_uuid())),
  'Tesorería sigue entrando a las cuentas de la planilla diaria');
reset role;

-- ============================================ 5. La política de audit_log es restrictiva
select test.afirmar(
  (select permissive = 'RESTRICTIVE' from pg_policies
    where schemaname = 'public' and tablename = 'audit_log' and policyname = 'cuentas_solo_rrhh'),
  'audit_log lleva la política restrictiva de las cuentas');

rollback;
