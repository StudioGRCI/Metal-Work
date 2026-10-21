-- La tardanza se descuenta por veces: cada tres tardanzas del mes, el 5 % de la
-- remuneración mensual. Y los permisos que pide el personal se registran en RR.
-- HH. y se justifican con las horas extras reservadas de la persona: ese es el
-- canje, de una vez o por partes. Gerencia y Administración consultan sin ver
-- el sueldo ni escribir; un operario no ve nada.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000045', 'PRUEBAS PERMISOS S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T45', 'Taller de pruebas de permisos') on conflict (codigo) do nothing;

select test.crear_usuario('Rita', 'Humanos', 'rrhh345@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Gerardo', 'Gerente', 'gerencia345@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Ada', 'Oficina', 'administracion345@demo.pe', 'ADMINISTRACION', (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Paco', 'Portón', 'porteria345@demo.pe', 'PORTERO', (select id from public.sedes limit 1)) as portero_id \gset
select test.crear_usuario('Omar', 'Obrero', 'operario345@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.portero', :'portero_id', true);
select set_config('prueba.operario', :'operario_id', true);
select set_config('prueba.a', gen_random_uuid()::text, true);
select set_config('prueba.b', gen_random_uuid()::text, true);
select set_config('prueba.c', gen_random_uuid()::text, true);
select set_config('prueba.p1', gen_random_uuid()::text, true);
select set_config('prueba.j1', gen_random_uuid()::text, true);
select set_config('prueba.j2', gen_random_uuid()::text, true);

-- ------------------------------------------------------ RR. HH. registra
do $$
declare v_id uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.a')::uuid, 'Ana', 'Tardía', '70000345', 'Soldadora',
            null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-45', null);
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.b')::uuid, 'Beto', 'Casi', '70000346', 'Pintor',
            null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-46', null);
  -- Entra dos minutos antes de ahora: llega dentro de la tolerancia (o antes, si
  -- es medianoche). Sin tope: con la entrada topada a las 23:00, de 23:05 a 23:59
  -- la marca caía fuera de la tolerancia y el check fallaba todas las noches. La
  -- salida, 23:59:59, siempre queda después.
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.c')::uuid, 'Celia', 'Justo', '70000347', 'Armadora',
            null, (now() at time zone 'America/Lima')::time - interval '2 minutes', '23:59:59',
            'Banco de Pruebas', 'AHORROS', '191-0000000-0-47', null);
  v_id := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.a')::uuid, 3000);
  v_id := public.rrhh_guardar_remuneracion_trabajador(current_setting('prueba.b')::uuid, 2000);
  perform public.rrhh_guardar_regla_tardanza(5, 3, 5);
  reset role;
end $$;

-- Septiembre: Ana llega tarde 7 veces y una de ellas se anuló; Beto, 2. Un
-- ingreso a tiempo no cuenta. Una tardanza de octubre no entra en septiembre.
-- Se cargan a mano (marcar_asistencia pone la fecha de hoy).
do $$
declare
  a uuid := current_setting('prueba.a')::uuid;
  b uuid := current_setting('prueba.b')::uuid;
  d int;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  for d in 1..7 loop
    insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza)
    values (a, make_date(2026, 9, d), 'INGRESO', '08:20', 20, true);
  end loop;
  insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza)
  values (a, date '2026-09-08', 'INGRESO', '07:55', 0, false);
  insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, anulado_por, anulado_en, motivo_anulacion)
  values (a, date '2026-09-09', 'INGRESO', '08:30', 30, true, current_setting('prueba.rrhh')::uuid, now(), 'se marcó a otra persona');
  insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza)
  values (a, date '2026-10-01', 'INGRESO', '08:30', 30, true);
  insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza)
  values (b, date '2026-09-01', 'INGRESO', '08:10', 10, true), (b, date '2026-09-02', 'INGRESO', '08:10', 10, true);
end $$;

-- ------------------------------------------------- el portero, en la tolerancia
do $$
declare
  v_id    uuid;
  v_marca public.asistencias%rowtype;
begin
  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  v_id := public.marcar_asistencia(gen_random_uuid(), current_setting('prueba.c')::uuid, 'INGRESO', null);
  select * into v_marca from public.asistencias where id = v_id;
  perform test.afirmar(v_marca.tardanza_minutos <= 2 and not v_marca.es_tardanza and v_marca.descuento = 0,
    'llegar dentro de la tolerancia no es tardanza');
  reset role;
end $$;

-- ------------------------------------------------- el descuento del mes
do $$
declare
  v_a record;
  v_b record;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  select * into v_a from public.rrhh_tardanzas_del_mes('2026-09-15') where trabajador_id = current_setting('prueba.a')::uuid;
  select * into v_b from public.rrhh_tardanzas_del_mes('2026-09-01') where trabajador_id = current_setting('prueba.b')::uuid;
  perform test.afirmar(v_a.dias_con_ingreso = 8 and v_a.tardanzas = 7 and v_a.minutos = 140,
    'cuenta los ingresos vigentes del mes: ni la anulada ni la de octubre');
  perform test.afirmar(v_a.grupos = 2 and v_a.porcentaje = 10, 'siete tardanzas son dos grupos de tres: 10 %');
  perform test.afirmar(v_a.remuneracion_mensual = 3000 and v_a.descuento = 300, 'el 10 % de S/ 3 000 son S/ 300');
  perform test.afirmar(v_b.tardanzas = 2 and v_b.grupos = 0 and v_b.porcentaje = 0 and v_b.descuento = 0, 'dos tardanzas no descuentan');
  perform test.afirmar((select tardanzas from public.rrhh_tardanzas_del_mes('2026-10-01') where trabajador_id = current_setting('prueba.a')::uuid) = 1,
    'el mes siguiente empieza de cero');

  -- La regla la ajusta RR. HH.: cada 2, el 4 %.
  perform public.rrhh_guardar_regla_tardanza(5, 2, 4);
  select * into v_a from public.rrhh_tardanzas_del_mes('2026-09-01') where trabajador_id = current_setting('prueba.a')::uuid;
  perform test.afirmar(v_a.grupos = 3 and v_a.porcentaje = 12 and v_a.descuento = 360, 'con la regla nueva: tres grupos de dos, 12 %');
  perform public.rrhh_guardar_regla_tardanza(5, 3, 5);
  perform test.debe_fallar('select public.rrhh_guardar_regla_tardanza(5, 0, 5)', 'hace falta al menos una tardanza por descuento');
  perform test.debe_fallar('select public.rrhh_guardar_regla_tardanza(5, 3, 120)', 'el porcentaje no pasa de 100');
  reset role;

  -- Gerencia y Administración ven las veces y el porcentaje, no el sueldo.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  select * into v_a from public.rrhh_tardanzas_del_mes('2026-09-01') where trabajador_id = current_setting('prueba.a')::uuid;
  perform test.afirmar(v_a.tardanzas = 7 and v_a.porcentaje = 10, 'Gerencia ve las tardanzas y el porcentaje');
  perform test.afirmar(v_a.remuneracion_mensual is null and v_a.descuento is null, 'Gerencia no ve la remuneración ni el monto');
  perform test.debe_fallar('select public.rrhh_guardar_regla_tardanza(5, 3, 5)', 'Gerencia no cambia la regla');
  reset role;
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  set local role authenticated;
  select * into v_a from public.rrhh_tardanzas_del_mes('2026-09-01') where trabajador_id = current_setting('prueba.a')::uuid;
  perform test.afirmar(v_a.porcentaje = 10 and v_a.descuento is null, 'Administración ve el porcentaje sin el monto');
  reset role;
  perform test.como_usuario(current_setting('prueba.operario')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.rrhh_tardanzas_del_mes(''2026-09-01'')', 'un operario no ve las tardanzas');
  reset role;
end $$;

-- ------------------------------------------------- el permiso y su canje
do $$
declare
  v_id   uuid;
  v_p    record;
  a      uuid := current_setting('prueba.a')::uuid;
  p1     uuid := current_setting('prueba.p1')::uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;

  v_id := public.rrhh_registrar_permiso(p1, a, date '2026-09-10', 4, 'trámite en el banco por la mañana');
  -- Un reintento con el mismo id no duplica.
  v_id := public.rrhh_registrar_permiso(p1, a, date '2026-09-10', 4, 'trámite en el banco por la mañana');
  perform test.afirmar((select count(*) from public.permisos_personal where trabajador_id = a) = 1, 'el reintento no duplica el permiso');
  perform test.debe_fallar(format('select public.rrhh_registrar_permiso(%L, %L, ''2026-09-10'', 5, ''cita médica por la tarde'')', gen_random_uuid(), a),
    'en un día no pasa de las 8 horas de la jornada', 'pasaría de las 8 horas');
  perform test.debe_fallar(format('select public.rrhh_registrar_permiso(%L, %L, ''2026-09-11'', 9, ''dos días de viaje familiar'')', gen_random_uuid(), a),
    'un permiso no pasa de 8 horas');
  perform test.debe_fallar(format('select public.rrhh_registrar_permiso(%L, %L, ''2026-09-11'', 2, ''corto'')', gen_random_uuid(), a),
    'el motivo lleva al menos 10 caracteres');

  -- Sin horas reservadas no hay con qué justificar.
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(%L, %L)', gen_random_uuid(), p1),
    'sin saldo no se justifica', 'no tiene horas extras reservadas');
  select * into v_p from public.rrhh_permisos_personal(null) where id = p1;
  perform test.afirmar(v_p.por_justificar = 4 and v_p.justificadas = 0 and v_p.saldo = 0, 'el permiso queda debiendo sus 4 horas');
  reset role;

  -- Ana hace 3 horas extras y RR. HH. las reserva (cargadas a mano: el
  -- circuito de los reportes validados lo prueba el check 343).
  insert into public.horas_extras_decisiones (trabajador_id, fecha, horas, horas_tramo1, horas_tramo2, decision, registrado_por)
  values (a, date '2026-09-12', 3, 2, 1, 'RESERVAR', current_setting('prueba.rrhh')::uuid);

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  -- Sin decir cuántas, usa lo que alcanza: 3 de las 4.
  v_id := public.rrhh_justificar_permiso(current_setting('prueba.j1')::uuid, p1);
  v_id := public.rrhh_justificar_permiso(current_setting('prueba.j1')::uuid, p1);
  select * into v_p from public.rrhh_permisos_personal(null) where id = p1;
  perform test.afirmar(v_p.justificadas = 3 and v_p.por_justificar = 1 and v_p.saldo = 0, 'justificado por partes: 3 h, falta 1 h');
  perform test.afirmar((select permiso_id from public.horas_compensadas where id = current_setting('prueba.j1')::uuid) = p1
                       and (select fecha from public.horas_compensadas where id = current_setting('prueba.j1')::uuid) = date '2026-09-10',
    'la justificación es un uso del saldo que nombra al permiso, en su día');
  perform test.afirmar((select usadas from public.saldo_horas_por_persona(a)) = 3, 'Horas extras ve las 3 horas usadas');
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(%L, %L)', gen_random_uuid(), p1),
    'sin más saldo no se justifica lo que falta');
  reset role;

  insert into public.horas_extras_decisiones (trabajador_id, fecha, horas, horas_tramo1, horas_tramo2, decision, registrado_por)
  values (a, date '2026-09-13', 2, 2, 0, 'RESERVAR', current_setting('prueba.rrhh')::uuid);

  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(%L, %L, 2)', gen_random_uuid(), p1),
    'no se justifica más de lo que falta', 'le faltan 1 h');
  v_id := public.rrhh_justificar_permiso(current_setting('prueba.j2')::uuid, p1, 1);
  select * into v_p from public.rrhh_permisos_personal('2026-09-01') where id = p1;
  perform test.afirmar(v_p.justificadas = 4 and v_p.por_justificar = 0 and v_p.saldo = 1, 'justificado entero; le queda 1 h de saldo');
  perform test.afirmar(not exists (select 1 from public.rrhh_permisos_personal(null) where id = p1), 'ya no está entre los que deben horas');
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(%L, %L)', gen_random_uuid(), p1), 'un permiso justificado no se justifica de nuevo');

  -- Nada se toca a mano.
  perform test.debe_fallar(format('update public.permisos_personal set horas = 1 where id = %L', p1), 'el permiso no se corrige a mano');
  perform test.debe_fallar(format('delete from public.permisos_personal where id = %L', p1), 'el permiso no se borra');

  -- Si el uso se anula en Horas extras, el permiso vuelve a deber esas horas.
  v_id := public.rrhh_anular_uso_saldo(current_setting('prueba.j2')::uuid, 'se cargó a la cuenta equivocada');
  select * into v_p from public.rrhh_permisos_personal(null) where id = p1;
  perform test.afirmar(v_p.por_justificar = 1 and v_p.saldo = 2, 'anulado el uso, el permiso vuelve a deber 1 h');
  reset role;
end $$;

-- ------------------------------------------------- quien consulta y quien no
do $$
declare
  v_p record;
  p1  uuid := current_setting('prueba.p1')::uuid;
begin
  -- Administración no lee el uso del saldo, pero ve lo mismo que RR. HH.
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.horas_compensadas) = 0, 'Administración no lee el uso del saldo');
  select * into v_p from public.rrhh_permisos_personal('2026-09-01') where id = p1;
  perform test.afirmar(v_p.justificadas = 3 and v_p.por_justificar = 1, 'Administración ve lo justificado igual que RR. HH.');
  perform test.debe_fallar(format('select public.rrhh_registrar_permiso(%L, %L, ''2026-09-20'', 1, ''permiso que no le toca registrar'')',
    gen_random_uuid(), current_setting('prueba.b')), 'Administración no registra permisos');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.permisos_personal where id = p1) = 1, 'Gerencia ve los permisos');
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(%L, %L)', gen_random_uuid(), p1), 'Gerencia no justifica');
  perform test.debe_fallar(format('select public.rrhh_anular_permiso(%L, ''Gerencia no anula permisos'')', p1), 'Gerencia no anula');
  reset role;

  perform test.como_usuario(current_setting('prueba.operario')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.permisos_personal) = 0, 'un operario no ve los permisos');
  perform test.debe_fallar('select * from public.rrhh_permisos_personal(null)', 'un operario no consulta los permisos');
  reset role;
end $$;

-- ------------------------------------------------- RR. HH. anula
do $$
declare
  v_id uuid;
  v_p  record;
  a    uuid := current_setting('prueba.a')::uuid;
  p1   uuid := current_setting('prueba.p1')::uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.rrhh_anular_permiso(%L, ''corto'')', p1), 'anular pide motivo');
  v_id := public.rrhh_anular_permiso(p1, 'la persona no salió: se quedó a trabajar');
  select * into v_p from public.rrhh_permisos_personal('2026-09-01') where id = p1;
  perform test.afirmar(v_p.anulado_en is not null and v_p.por_justificar = 0, 'el permiso queda anulado, sin deber nada');
  perform test.afirmar((select saldo from public.saldo_horas_por_persona(a)) = 5, 'lo justificado vuelve al saldo: 5 h');
  perform test.afirmar(not exists (select 1 from public.rrhh_permisos_personal(null) where id = p1), 'un anulado no está entre los que deben');
  perform test.debe_fallar(format('select public.rrhh_justificar_permiso(%L, %L)', gen_random_uuid(), p1), 'un anulado no se justifica');
  -- Anulado, el día queda libre para otro permiso.
  v_id := public.rrhh_registrar_permiso(gen_random_uuid(), a, date '2026-09-10', 8, 'día completo por mudanza familiar');
  reset role;
end $$;

rollback;
