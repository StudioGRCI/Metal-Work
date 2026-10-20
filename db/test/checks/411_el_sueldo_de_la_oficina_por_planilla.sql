-- El sueldo de la oficina va por la planilla, no por el área (migración
-- 20261020200000). DKS, 2026-10-20: «si alguien de Maestranza queda en planilla
-- administrativa, su sueldo no cuenta en ningún lado, tiene que ser por la
-- planilla».
--
--   1. Max es de Maestranza: mientras va en la planilla de taller no se le
--      registra un pago de la oficina; RR. HH. lo pasa a la administrativa y ya
--      se le registra, y entra en el sueldo de la oficina del mes.
--   2. Tita es de Administración pero va en la planilla de taller: no se le
--      registra un pago y no cuenta como persona sin pago.
--   3. Si RR. HH. lo devuelve a la planilla de taller, lo ya pagado sigue en el
--      costeo de ese mes.
--
-- Cada paso con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA01', 'Taller prueba de la planilla de la oficina') on conflict (codigo) do nothing;
select test.crear_usuario('Rosa', 'Humanos', 'rrhh411@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA01')) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia411@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA01')) as gerente_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin411@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA01')) as admin_id \gset

-- ----------------------------------------- Armazón (ADMIN): la gente y las horas de abril
-- Max (Maestranza), Tita (Administración) y Beto (Maestranza), que trabaja 10 h en
-- la unidad A en abril para que abril reparta. Los tres entran en la planilla de taller,
-- la que se pone sola.
select test.como_usuario(:'admin_id');
do $$
declare v_nombre text; v_area text; v_id uuid;
begin
  perform test.afirmar(not exists (select 1 from public.horas_por_codigo_del_mes(null) h where h.periodo < date '2021-08-01'),
    'la base no tiene horas antes de agosto de 2021: abril es solo de esta prueba');
  -- La oficina que ya está en la base sale antes de 2021 dentro de esta prueba (se deshace al final).
  update public.trabajadores w set activo = false, fecha_ingreso = date '2020-12-01', fecha_baja = date '2020-12-31'
   where w.planilla = 'ADMINISTRATIVA';
  for v_nombre, v_area in select * from (values ('Max', 'MTZ'), ('Tita', 'ADM'), ('Beto', 'MTZ')) x
  loop
    insert into public.trabajadores (nombres, apellidos, dni, area_id, fecha_ingreso)
    values (v_nombre, 'Check 411', '4110' || lpad((length(v_nombre) * 7 + ascii(v_nombre))::text, 4, '0'),
            (select id from public.areas where codigo = v_area), date '2021-01-04')
    returning id into v_id;
    perform set_config('prueba.' || lower(v_nombre), v_id::text, true);
  end loop;
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo) values
    (current_setting('prueba.beto')::uuid, date '2021-04-08', 'CHK411_A_21/04', 10, 'Soldadura', 10, 100);
end $$;
select test.afirmar((select bool_and(planilla = 'TALLER') from public.trabajadores where apellidos = 'Check 411'),
  'quien se registra sin elegir queda en la planilla de taller');

-- ------------------------------------------------ 1. Max, de Maestranza, a la oficina
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-04-01'', date ''2021-04-30'', 2500, 0, null)', current_setting('prueba.max')),
  'en la planilla de taller, a Max no se le registra un pago de la oficina', 'es de planilla de taller');
select public.rrhh_guardar_planilla_trabajador(current_setting('prueba.max')::uuid, 'ADMINISTRATIVA');
select public.rrhh_registrar_pago_oficina(gen_random_uuid(), current_setting('prueba.max')::uuid, date '2021-04-01', date '2021-04-30', 2500, 200, null);
select test.afirmar((select count(*) from public.oficina_pagos where trabajador_id = current_setting('prueba.max')::uuid) = 1,
  'en la planilla administrativa, RR. HH. le registra el pago a Max aunque sea de Maestranza');

-- -------------------------------- 2. Tita, de Administración, en la planilla de taller
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-04-01'', date ''2021-04-30'', 1800, 0, null)', current_setting('prueba.tita')),
  'Tita es de un área de oficina pero va en la planilla de taller: su costo va por las horas', 'es de planilla de taller');
reset role;

-- El sueldo de la oficina de abril es el de Max, con sus aportes, y nadie falta;
-- en el mes en curso falta Max (sin pago) y no Tita.
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select o.monto = 2700 and o.sin_pago = 0 from public.gastos_del_mes_oficina(date '2021-04-01') o),
  format('abril: el pago de Max, 2,500 + 200 de aportes = 2,700, sin días por pagar; da %s',
         (select row(o.monto, o.sin_pago)::text from public.gastos_del_mes_oficina(date '2021-04-01') o)));
select test.afirmar(exists (select 1 from public.codigo_interno_costeo('CHK411_A_21/04') l
                             where l.concepto = 'Sueldos de la oficina 04/2021' and l.monto = 2700),
  'la unidad A, la única con horas en abril, carga el sueldo de Max');
reset role;
select test.afirmar((select o.sin_pago = 1 from public.sueldos_oficina_del_mes(date_trunc('month', now() at time zone 'America/Lima')::date) o),
  format('en el mes en curso falta solo Max, de planilla administrativa; Tita no cuenta; da %s',
         (select o.sin_pago from public.sueldos_oficina_del_mes(date_trunc('month', now() at time zone 'America/Lima')::date) o)));

-- ------------------------------------ 3. De vuelta al taller, lo pagado sigue contando
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_planilla_trabajador(current_setting('prueba.max')::uuid, 'TALLER');
reset role;
select test.afirmar((select o.monto = 2700 and o.sin_pago = 0 from public.sueldos_oficina_del_mes(date '2021-04-01') o)
                    and (select o.sin_pago = 0 from public.sueldos_oficina_del_mes(date_trunc('month', now() at time zone 'America/Lima')::date) o),
  'lo pagado en abril sigue en el costeo; desde que vuelve al taller, ya no le faltan pagos');

select 'CHECK 411 OK' as resultado;
rollback;
