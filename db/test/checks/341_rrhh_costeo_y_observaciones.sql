-- Recursos Humanos carga las horas de cada persona a un código interno y de ahí
-- sale el costo de la mano de obra; registra observaciones y amonestaciones.
-- El costo mensual y el tareo solo los ve RR. HH.; las observaciones, también
-- Gerencia y Administración. Nada se borra: se anula con su motivo.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000041', 'PRUEBAS RRHH S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T41', 'Taller de pruebas RRHH') on conflict (codigo) do nothing;

select test.crear_usuario('Rosa', 'Humanos', 'rrhh341@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia341@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Pedro', 'Portón', 'porteria341@demo.pe', 'PORTERO', (select id from public.sedes limit 1)) as portero_id \gset
select test.crear_usuario('Olga', 'Obrera', 'operario341@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.portero', :'portero_id', true);
select set_config('prueba.operario', :'operario_id', true);
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.t2', gen_random_uuid()::text, true);
select set_config('prueba.h1', gen_random_uuid()::text, true);
select set_config('prueba.h2', gen_random_uuid()::text, true);
select set_config('prueba.o1', gen_random_uuid()::text, true);

-- ------------------------------------------------- RR. HH. registra y costea
do $$
declare
  v_id    uuid;
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_t     public.tareos%rowtype;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;

  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Juan', 'Soldador', '70000341', 'Soldador',
            null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-41', null);
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t2')::uuid, 'Ana', 'Sin Costo', '70000342', 'Pintora',
            null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-42', null);

  -- Sin costo mensual no hay tareo: no sabría cuánto vale la hora.
  perform test.debe_fallar(
    format('select public.rrhh_registrar_tareo(%L, %L, %L, ''PLANTA'', 4, null)', gen_random_uuid(), current_setting('prueba.t2'), v_hoy),
    'sin costo mensual no se carga la hora');

  -- S/ 2400 al mes son S/ 10 la hora (entre 240).
  v_id := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t1')::uuid, 2400);
  perform test.afirmar((select costo_mensual from public.trabajador_costos where trabajador_id = current_setting('prueba.t1')::uuid) = 2400,
    'el costo mensual se guarda');

  v_id := public.rrhh_registrar_tareo(current_setting('prueba.h1')::uuid, current_setting('prueba.t1')::uuid, v_hoy,
            '  pla_sr_o4_1_26/28 ', 6.5, 'Soldadura de la tolva');
  -- Un reintento con el mismo id devuelve las mismas horas.
  v_id := public.rrhh_registrar_tareo(current_setting('prueba.h1')::uuid, current_setting('prueba.t1')::uuid, v_hoy,
            'PLA_SR_O4_1_26/28', 6.5, 'Soldadura de la tolva');
  perform test.afirmar((select count(*) from public.tareos where trabajador_id = current_setting('prueba.t1')::uuid) = 1, 'el reintento no duplica');
  select * into v_t from public.tareos where id = current_setting('prueba.h1')::uuid;
  perform test.afirmar(v_t.codigo_interno = 'PLA_SR_O4_1_26/28', 'el código interno se guarda en mayúsculas y sin espacios');
  perform test.afirmar(v_t.costo_hora = 10 and v_t.costo = 65, 'la hora vale el costo mensual entre 240 y el costo son horas por hora');

  v_id := public.rrhh_registrar_tareo(current_setting('prueba.h2')::uuid, current_setting('prueba.t1')::uuid, v_hoy, 'PLANTA', 2, null);

  -- Cambiar el costo mensual no reescribe lo ya cargado.
  v_id := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t1')::uuid, 4800);
  perform test.afirmar((select costo from public.tareos where id = current_setting('prueba.h1')::uuid) = 65, 'el tareo guarda el costo de su día');

  perform test.debe_fallar(
    format('select public.rrhh_registrar_tareo(%L, %L, %L, ''PLANTA'', 8, null)', gen_random_uuid(), current_setting('prueba.t1'), v_hoy),
    'un día no pasa de 16 horas');
  perform test.debe_fallar(
    format('select public.rrhh_registrar_tareo(%L, %L, %L, ''PLANTA'', 2, null)', gen_random_uuid(), current_setting('prueba.t1'), v_hoy + 1),
    'no se cargan horas de mañana');
  perform test.debe_fallar(
    format('select public.rrhh_registrar_tareo(%L, %L, %L, ''X'', 2, null)', gen_random_uuid(), current_setting('prueba.t1'), v_hoy),
    'el código interno lleva de 2 a 60 caracteres');

  -- Nada se borra ni se corrige a mano.
  perform test.debe_fallar(format('delete from public.tareos where id = %L', current_setting('prueba.h2')), 'un tareo no se borra');
  perform test.debe_fallar(format('update public.tareos set horas = 1 where id = %L', current_setting('prueba.h2')), 'un tareo no se edita');
  perform test.debe_fallar(format('select public.rrhh_anular_tareo(%L, ''corto'')', current_setting('prueba.h2')), 'anular pide motivo');
  v_id := public.rrhh_anular_tareo(current_setting('prueba.h2')::uuid, 'Las horas eran del día anterior');
  perform test.afirmar((select anulado_en is not null from public.tareos where id = current_setting('prueba.h2')::uuid), 'el tareo queda anulado');
  -- Las horas anuladas ya no cuentan para el tope del día.
  v_id := public.rrhh_registrar_tareo(gen_random_uuid(), current_setting('prueba.t1')::uuid, v_hoy, 'PLANTA', 9.5, null);

  perform test.afirmar(exists (select 1 from public.rrhh_codigos_internos() where codigo = 'PLA_SR_O4_1_26/28'),
    'el código usado en el tareo se ofrece la próxima vez');

  -- Observaciones y amonestaciones.
  v_id := public.rrhh_registrar_observacion(current_setting('prueba.o1')::uuid, current_setting('prueba.t1')::uuid, v_hoy,
            'AMONESTACION_ESCRITA', 'EPP', 'Trabajaba en la tolva sin careta de soldar', 'pla_sr_o4_1_26/28', null);
  v_id := public.rrhh_registrar_observacion(current_setting('prueba.o1')::uuid, current_setting('prueba.t1')::uuid, v_hoy,
            'AMONESTACION_ESCRITA', 'EPP', 'Trabajaba en la tolva sin careta de soldar', 'pla_sr_o4_1_26/28', null);
  perform test.afirmar((select count(*) from public.observaciones_personal where trabajador_id = current_setting('prueba.t1')::uuid) = 1,
    'la observación no se duplica');
  perform test.afirmar((select codigo_interno from public.observaciones_personal where id = current_setting('prueba.o1')::uuid) = 'PLA_SR_O4_1_26/28',
    'el código de la observación se normaliza');
  perform test.debe_fallar(
    format('select public.rrhh_registrar_observacion(%L, %L, %L, ''SUSPENSION'', ''FALTA_INJUSTIFICADA'', ''Faltó tres días sin aviso'', null, null)',
      gen_random_uuid(), current_setting('prueba.t1'), v_hoy),
    'una suspensión lleva sus días');
  v_id := public.rrhh_registrar_observacion(gen_random_uuid(), current_setting('prueba.t1')::uuid, v_hoy,
            'SUSPENSION', 'FALTA_INJUSTIFICADA', 'Faltó tres días sin aviso', null, 2);
  v_id := public.rrhh_registrar_observacion(gen_random_uuid(), current_setting('prueba.t2')::uuid, v_hoy,
            'OBSERVACION', 'CALIDAD', 'Pintura con chorreado en la puerta trasera', null, 5);
  perform test.afirmar((select dias_suspension from public.observaciones_personal where trabajador_id = current_setting('prueba.t2')::uuid) is null,
    'solo la suspensión guarda días');
  perform test.debe_fallar(
    format('select public.rrhh_registrar_observacion(%L, %L, %L, ''OBSERVACION'', ''OTRO'', ''corto'', null, null)',
      gen_random_uuid(), current_setting('prueba.t1'), v_hoy),
    'la observación cuenta qué pasó');
  perform test.debe_fallar(format('delete from public.observaciones_personal where id = %L', current_setting('prueba.o1')), 'una observación no se borra');
  perform test.debe_fallar(format('update public.observaciones_personal set tipo = ''OBSERVACION'' where id = %L', current_setting('prueba.o1')),
    'una observación no se edita');
  reset role;
end $$;

-- ------------------------------------------------- Gerencia consulta
do $$
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.observaciones_personal) = 3, 'Gerencia ve las observaciones');
  perform test.afirmar((select count(*) from public.tareos) = 0, 'Gerencia NO ve el tareo (lleva el costo de la hora)');
  perform test.afirmar((select count(*) from public.trabajador_costos) = 0, 'Gerencia NO ve el costo mensual');
  perform test.debe_fallar(
    format('select public.rrhh_registrar_observacion(%L, %L, current_date, ''OBSERVACION'', ''OTRO'', ''Gerencia no registra esto'', null, null)',
      gen_random_uuid(), current_setting('prueba.t1')),
    'Gerencia no registra observaciones');
  perform test.debe_fallar(
    format('select public.rrhh_anular_observacion(%L, ''Gerencia no anula observaciones'')', current_setting('prueba.o1')),
    'Gerencia no anula observaciones');
  reset role;
end $$;

-- ------------------------------------------------ quien no es de esto
do $$
begin
  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.trabajador_costos) = 0, 'el portero NO ve el costo mensual');
  perform test.afirmar((select count(*) from public.tareos) = 0, 'el portero NO ve el tareo');
  perform test.afirmar((select count(*) from public.observaciones_personal) = 0, 'el portero NO ve las observaciones');
  perform test.debe_fallar(
    format('select public.rrhh_registrar_tareo(%L, %L, current_date, ''PLANTA'', 1, null)', gen_random_uuid(), current_setting('prueba.t1')),
    'el portero no carga horas');
  perform test.debe_fallar('select * from public.rrhh_codigos_internos()', 'el portero no pide los códigos');
  reset role;

  perform test.como_usuario(current_setting('prueba.operario')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.observaciones_personal) = 0, 'un operario no ve las observaciones');
  perform test.debe_fallar(
    format('select public.rrhh_guardar_costo_trabajador(%L, 9999)', current_setting('prueba.t1')),
    'un operario no cambia el costo');
  reset role;
end $$;

-- ------------------------------------------------ RR. HH. anula una observación
do $$
declare v_id uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v_id := public.rrhh_anular_observacion(current_setting('prueba.o1')::uuid, 'Se registró a la persona equivocada');
  perform test.afirmar((select motivo_anulacion from public.observaciones_personal where id = current_setting('prueba.o1')::uuid)
    = 'Se registró a la persona equivocada', 'la observación queda anulada con su motivo');
  perform test.debe_fallar(
    format('update public.observaciones_personal set detalle = ''cambiada después de anulada'' where id = %L', current_setting('prueba.o1')),
    'una observación anulada queda congelada');
  reset role;
end $$;

-- ------------------------------------------- ni siquiera el dueño de la tabla
-- Arriba la escritura directa la frena la falta de grant; aquí, sin rol, la
-- frena el disparador.
do $$
begin
  perform test.debe_fallar(format('delete from public.tareos where id = %L', current_setting('prueba.h1')), 'el disparador no deja borrar un tareo');
  perform test.debe_fallar(format('update public.tareos set horas = 1 where id = %L', current_setting('prueba.h1')), 'el disparador no deja corregir un tareo');
  perform test.debe_fallar(format('update public.tareos set codigo_interno = ''OTRO'' where id = %L', current_setting('prueba.h2')),
    'un tareo anulado queda congelado');
  perform test.debe_fallar(format('delete from public.observaciones_personal where id = %L', current_setting('prueba.o1')),
    'el disparador no deja borrar una observación');
  perform test.debe_fallar(format('delete from public.trabajador_costos where trabajador_id = %L', current_setting('prueba.t1')),
    'el costo mensual no se borra');
end $$;

rollback;
