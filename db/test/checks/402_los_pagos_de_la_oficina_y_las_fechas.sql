-- Lo que se le paga de verdad a la oficina, y la fecha de ingreso y de baja
-- (migración 20261020120000). StudioGRCI eligió «Cada pago» el 2026-10-20:
-- unos cobran por semana, otros por quincena, y la paga no es fija.
--
--   1. RR. HH. pone la fecha de ingreso y da de baja con el último día que
--      trabajó; las fechas imposibles no entran, y quien no es de RR. HH. no
--      las pone.
--   2. RR. HH. registra cada pago con el tramo que paga; un pago no cruza otro,
--      no cae fuera del ingreso y la baja, y no se registra a quien no es de la
--      oficina.
--   3. Junio de 2021: cada pago entra por los días que caen en el mes (la
--      semana que empieza en mayo deja 6 de 7 partes en junio), con sus
--      aportes; Gerencia ve el total y no cada pago.
--   4. Anular un pago lo saca del costeo y avisa que faltan días pagados; un
--      pago no se borra.
--   5. Lo que cargó en horas a una unidad se descuenta de su pago.
--   6. Dar de baja por el camino de antes deja la fecha de hoy, y volver a dar
--      de alta la borra.
--
-- Cada paso con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA01', 'Taller prueba de los pagos de la oficina') on conflict (codigo) do nothing;
select test.crear_usuario('Rosa', 'Humanos', 'rrhh402@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA01')) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia402@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA01')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas402@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA01')) as vendedor_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin402@demo.pe', 'ADMIN', (select id from public.sedes where codigo = 'QA01')) as admin_id \gset
select set_config('prueba.p_bea', gen_random_uuid()::text, true);

-- ----------------------------------------- Armazón (ADMIN): la gente y las horas de junio
-- Ana, Bea y Ciro son de Administración; Beto (Maestranza) trabaja 10 h en la
-- unidad A en junio, para que junio reparta, y Gil es de Almacén.
select test.como_usuario(:'admin_id');
do $$
declare v_nombre text; v_area text; v_id uuid;
begin
  perform test.afirmar(not exists (select 1 from public.horas_por_codigo_del_mes(null) h where h.periodo < date '2021-08-01'),
    'la base no tiene horas antes de agosto de 2021: junio es solo de esta prueba');
  perform test.afirmar(not exists (select 1 from public.oficina_pagos p where p.desde < date '2021-08-01'),
    'la base no tiene pagos de la oficina antes de agosto de 2021');
  -- La oficina que ya está en la base sale antes de 2021 dentro de esta prueba (se deshace al final).
  update public.trabajadores w set activo = false, fecha_ingreso = date '2020-12-01', fecha_baja = date '2020-12-31'
   where w.area_id in (select a.id from public.areas a where a.es_oficina);
  for v_nombre, v_area in select * from (values ('Ana', 'ADM'), ('Bea', 'ADM'), ('Ciro', 'ADM'), ('Beto', 'MTZ'), ('Gil', 'ALM')) x
  loop
    insert into public.trabajadores (nombres, apellidos, dni, area_id)
    values (v_nombre, 'Check 402', '4020' || lpad((length(v_nombre) * 7 + ascii(v_nombre))::text, 4, '0'),
            (select id from public.areas where codigo = v_area))
    returning id into v_id;
    perform set_config('prueba.' || lower(v_nombre), v_id::text, true);
  end loop;
  insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo) values
    (current_setting('prueba.beto')::uuid, date '2021-06-08', 'CHK402_A_21/06', 10, 'Soldadura', 10, 100);
end $$;

-- ------------------------------------------------------- 1. RR. HH. pone las fechas
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_ingreso_trabajador(current_setting('prueba.ana')::uuid, date '2021-01-04');
select public.rrhh_guardar_ingreso_trabajador(current_setting('prueba.bea')::uuid, date '2021-06-16');
select public.rrhh_guardar_ingreso_trabajador(current_setting('prueba.ciro')::uuid, date '2021-01-04');
select public.rrhh_dar_de_baja_trabajador(current_setting('prueba.ciro')::uuid, date '2021-06-10');
select test.afirmar((select not activo and fecha_baja = date '2021-06-10' from public.trabajadores
                      where id = current_setting('prueba.ciro')::uuid),
  'Ciro queda de baja con el último día que trabajó, y RR. HH. lo lee');
select test.debe_fallar(format('select public.rrhh_dar_de_baja_trabajador(%L, date ''2021-06-11'')', current_setting('prueba.ciro')),
  'no se da de baja dos veces', 'Ya está de baja');
select test.debe_fallar(format('select public.rrhh_dar_de_baja_trabajador(%L, date ''2021-06-01'')', current_setting('prueba.bea')),
  'la baja no va antes del ingreso', 'antes del ingreso');
select test.debe_fallar(format('select public.rrhh_dar_de_baja_trabajador(%L, (now() at time zone ''America/Lima'')::date + 1)', current_setting('prueba.bea')),
  'la baja no va después de hoy', 'después de hoy');
select test.debe_fallar(format('select public.rrhh_dar_de_baja_trabajador(%L, null)', current_setting('prueba.bea')),
  'la baja lleva fecha', 'Pon la fecha de baja');
select test.debe_fallar(format('select public.rrhh_guardar_ingreso_trabajador(%L, date ''2021-06-20'')', current_setting('prueba.ciro')),
  'el ingreso no va después de la baja', 'después de la baja');
select test.debe_fallar(format('select public.rrhh_guardar_ingreso_trabajador(%L, null)', current_setting('prueba.ana')),
  'el ingreso lleva fecha', 'Pon la fecha de ingreso');
select test.debe_fallar(format('select public.rrhh_guardar_ingreso_trabajador(%L, (now() at time zone ''America/Lima'')::date + 40)', current_setting('prueba.ana')),
  'el ingreso no va más de un mes adelante', 'un mes adelante');
reset role;

select test.como_usuario(:'vendedor_id');
set local role authenticated;
select test.debe_fallar(format('select public.rrhh_guardar_ingreso_trabajador(%L, date ''2021-01-04'')', current_setting('prueba.ana')),
  'Ventas no pone fechas de ingreso', 'rrhh.personal');
select test.debe_fallar(format('select public.rrhh_dar_de_baja_trabajador(%L, date ''2021-06-30'')', current_setting('prueba.ana')),
  'Ventas no da de baja', 'rrhh.personal');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-06-01'', date ''2021-06-30'', 100, 0, null)', current_setting('prueba.ana')),
  'Ventas no registra pagos de la oficina', 'rrhh.personal');
reset role;

-- --------------------------------------------------- 2. RR. HH. registra cada pago
-- Ana cobra por semana (de lunes a domingo, S/ 700); Bea, la quincena del 16 al 30
-- (S/ 1,400 más S/ 100 de aportes); Ciro, del 1 al 10 (S/ 1,000).
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_registrar_pago_oficina(gen_random_uuid(), current_setting('prueba.ana')::uuid, d, d + 6, 700, 0, null)
  from (values (date '2021-05-31'), (date '2021-06-07'), (date '2021-06-14'), (date '2021-06-21'), (date '2021-06-28')) s(d);
select public.rrhh_registrar_pago_oficina(current_setting('prueba.p_bea')::uuid, current_setting('prueba.bea')::uuid,
  date '2021-06-16', date '2021-06-30', 1400, 100, 'Quincena con aportes');
select public.rrhh_registrar_pago_oficina(gen_random_uuid(), current_setting('prueba.ciro')::uuid, date '2021-06-01', date '2021-06-10', 1000, 0, null);
select test.afirmar(public.rrhh_registrar_pago_oficina(current_setting('prueba.p_bea')::uuid, current_setting('prueba.bea')::uuid,
  date '2021-06-16', date '2021-06-30', 1400, 100, 'Quincena con aportes') = current_setting('prueba.p_bea')::uuid
  and (select count(*) from public.oficina_pagos where trabajador_id = current_setting('prueba.bea')::uuid) = 1,
  'el reintento del mismo pago devuelve el mismo, sin duplicarlo');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-06-10'', date ''2021-06-16'', 700, 0, null)', current_setting('prueba.ana')),
  'un pago no cruza otro de la misma persona', 'cruza esas fechas');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-06-01'', date ''2021-06-15'', 1400, 0, null)', current_setting('prueba.bea')),
  'un pago no empieza antes del ingreso', 'entró el 16/06/2021');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-06-11'', date ''2021-06-30'', 1000, 0, null)', current_setting('prueba.ciro')),
  'un pago no pasa de la baja', 'dejó de trabajar el 10/06/2021');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-06-01'', date ''2021-06-30'', 1000, 0, null)', current_setting('prueba.gil')),
  'Almacén no es oficina: su costo va por las horas', 'no es de un área de oficina');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-07-05'', date ''2021-07-11'', 0, 0, null)', current_setting('prueba.ana')),
  'un pago lleva monto', 'mayor que cero');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-07-11'', date ''2021-07-05'', 700, 0, null)', current_setting('prueba.ana')),
  'el tramo no va al revés', 'no puede ir antes del primero');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(gen_random_uuid(), %L, date ''2021-07-05'', date ''2021-09-30'', 700, 0, null)', current_setting('prueba.ana')),
  'un pago cubre como mucho dos meses', 'como mucho dos meses');
-- Con pagos registrados, las fechas no pueden dejarlos fuera.
select test.debe_fallar(format('select public.rrhh_guardar_ingreso_trabajador(%L, date ''2021-06-01'')', current_setting('prueba.ana')),
  'el ingreso no deja fuera un pago ya registrado', 'Tiene pagos de la oficina antes');
select test.debe_fallar(format('select public.rrhh_dar_de_baja_trabajador(%L, date ''2021-06-25'')', current_setting('prueba.ana')),
  'la baja no deja fuera un pago ya registrado', 'Tiene pagos de la oficina después');
select test.afirmar((select count(*) from public.oficina_pagos where trabajador_id in
                      (current_setting('prueba.ana')::uuid, current_setting('prueba.bea')::uuid, current_setting('prueba.ciro')::uuid)) = 7,
  'RR. HH. lee los siete pagos');
select test.debe_fallar($q$select public.dias_del_mes_entre(date '2021-06-01', null, null)$q$,
  'la cuenta de los días es solo de la base', 'permission denied');
reset role;

-- ------------------------------------------- 3. Junio: la parte de cada pago que cae en él
-- Ana: 600 (6 de 7 días de la semana del 31 de mayo) + 700 × 3 + 300 (3 de 7 de la del
-- 28 de junio) = 3,000. Bea: 1,400 + 100 de aportes = 1,500. Ciro: 1,000. Total 5,500.
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select o.monto = 5500 and o.sin_pago = 0 from public.gastos_del_mes_oficina(date '2021-06-01') o),
  format('junio: Ana 3,000 + Bea 1,500 + Ciro 1,000 = 5,500, sin días por pagar; da %s',
         (select row(o.monto, o.sin_pago)::text from public.gastos_del_mes_oficina(date '2021-06-01') o)));
select test.afirmar((select count(*) from public.oficina_pagos) = 0, 'Gerencia ve el total, no el pago de cada persona');
select test.afirmar(exists (select 1 from public.codigo_interno_costeo('CHK402_A_21/06') l
                             where l.concepto = 'Sueldos de la oficina 06/2021' and l.monto = 5500
                               and l.detalle like '% · pagos de la oficina registrados por RR. HH.'),
  'la unidad A, la única con horas en junio, carga la oficina entera y dice de dónde sale');
reset role;
select test.afirmar((select o.monto from public.sueldos_oficina_del_mes(date '2021-05-01') o) = 100,
  format('mayo se queda con 1 de 7 días de la primera semana de Ana: %s', (select o.monto from public.sueldos_oficina_del_mes(date '2021-05-01') o)));
select test.afirmar((select o.monto = 400 and o.sin_pago = 2 from public.sueldos_oficina_del_mes(date '2021-07-01') o),
  format('julio: 4 de 7 días de la última semana de Ana, y a Ana y a Bea les faltan días pagados; da %s',
         (select row(o.monto, o.sin_pago)::text from public.sueldos_oficina_del_mes(date '2021-07-01') o)));
select test.como_usuario(:'vendedor_id');
set local role authenticated;
select test.debe_fallar($q$select * from public.gastos_del_mes_oficina(date '2021-06-01')$q$,
  'Ventas no ve lo que cuesta la oficina', 'codigos_internos.ver');
select test.afirmar((select count(*) from public.oficina_pagos) = 0, 'Ventas no lee los pagos');
reset role;

-- --------------------------------------------------------- 4. Un pago mal registrado se anula
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select test.debe_fallar(format('select public.rrhh_anular_pago_oficina(%L, ''corto'')', current_setting('prueba.p_bea')),
  'anular pide el motivo', 'por qué se anula');
select public.rrhh_anular_pago_oficina(current_setting('prueba.p_bea')::uuid, 'Se registró con el monto de otra persona');
select test.debe_fallar(format('select public.rrhh_anular_pago_oficina(%L, ''Otra vez lo mismo'')', current_setting('prueba.p_bea')),
  'no se anula dos veces', 'ya está anulado');
select test.debe_fallar(format('select public.rrhh_registrar_pago_oficina(%L, %L, date ''2021-06-16'', date ''2021-06-30'', 1400, 100, null)',
                               current_setting('prueba.p_bea'), current_setting('prueba.bea')),
  'un pago anulado no vuelve con su mismo número', 'ya se anuló');
select test.debe_fallar($q$delete from public.oficina_pagos$q$, 'RR. HH. no borra pagos', 'permission denied');
reset role;
select test.debe_fallar($q$delete from public.oficina_pagos where desde < date '2021-08-01'$q$, 'nadie borra un pago, ni por encima de los permisos', 'no se borra');
select test.afirmar((select o.monto = 4000 and o.sin_pago = 1 from public.sueldos_oficina_del_mes(date '2021-06-01') o),
  format('sin el pago de Bea, junio baja a 4,000 y avisa que a una persona le faltan días; da %s',
         (select row(o.monto, o.sin_pago)::text from public.sueldos_oficina_del_mes(date '2021-06-01') o)));

-- ------------------------------------------- 5. Lo que cargó en horas a una unidad se descuenta
select test.como_usuario(:'admin_id');
insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo)
values (current_setting('prueba.ana')::uuid, date '2021-06-22', 'CHK402_A_21/06', 10, 'Compras en obra', 20, 200);
select test.afirmar((select o.monto from public.sueldos_oficina_del_mes(date '2021-06-01') o) = 3800,
  format('los 200 de Ana en la unidad A ya van en su mano de obra: junio queda en 3,800; da %s',
         (select o.monto from public.sueldos_oficina_del_mes(date '2021-06-01') o)));

-- ----------------------------------- 6. El camino de antes: hoy, y volver la borra
-- Bea se queda sin pagos (el suyo está anulado): la baja de hoy no deja ninguno fuera.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_cambiar_estado_trabajador(current_setting('prueba.bea')::uuid, false);
select test.afirmar((select fecha_baja = (now() at time zone 'America/Lima')::date from public.trabajadores
                      where id = current_setting('prueba.bea')::uuid),
  'dar de baja sin decir el día deja la fecha de hoy');
select public.rrhh_cambiar_estado_trabajador(current_setting('prueba.bea')::uuid, true);
select test.afirmar((select activo and fecha_baja is null and fecha_ingreso = date '2021-06-16' from public.trabajadores
                      where id = current_setting('prueba.bea')::uuid),
  'volver a dar de alta borra la baja y deja el ingreso');
reset role;

select 'CHECK 402 OK' as resultado;
rollback;
