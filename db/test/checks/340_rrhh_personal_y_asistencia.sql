-- Recursos Humanos registra al personal con su cuenta y su horario; la
-- portería marca ingreso y salida desde el celular y la tardanza sale sola con
-- la regla vigente. El portero ve nombres y horarios, nunca cuentas bancarias.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000031', 'PRUEBAS RRHH S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T31', 'Taller de pruebas RRHH') on conflict (codigo) do nothing;

select test.crear_usuario('Rosa', 'Humanos', 'rrhh331@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Pedro', 'Portón', 'porteria331@demo.pe', 'PORTERO', (select id from public.sedes limit 1)) as portero_id \gset
select test.crear_usuario('Olga', 'Obrera', 'operario331@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.portero', :'portero_id', true);
select set_config('prueba.operario', :'operario_id', true);
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.t2', gen_random_uuid()::text, true);
select set_config('prueba.m1', gen_random_uuid()::text, true);
select set_config('prueba.m2', gen_random_uuid()::text, true);
select set_config('prueba.m3', gen_random_uuid()::text, true);

-- ------------------------------------------------------ RR. HH. registra
do $$
declare v_id uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;

  -- Entra a las 00:00: cualquier marca de hoy es tardanza (sirve para medirla).
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Juan', 'Tardón', '70000331', 'Soldador',
            (select id from public.areas where codigo = 'PRD'), '00:00', '18:00',
            'Banco de Pruebas', 'AHORROS', '191-0000000-0-31', null);
  -- Entra a las 23:59: nunca llega tarde.
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t2')::uuid, 'María', 'Puntual', '70000332', 'Pintora',
            null, '23:59', '23:59:30', 'Banco de Pruebas', 'SUELDO', '0011-0000-00000000', '00200000000000000000');

  -- El mismo id corrige la ficha, no la duplica.
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Juan Carlos', 'Tardón', '70000331', 'Soldador',
            (select id from public.areas where codigo = 'PRD'), '00:00', '18:00',
            'Banco de Pruebas', 'CORRIENTE', '191-0000000-0-31', null);
  perform test.afirmar((select count(*) from public.trabajadores where dni in ('70000331', '70000332')) = 2, 'dos trabajadores registrados');
  perform test.afirmar((select nombres from public.trabajadores where dni = '70000331') = 'Juan Carlos', 'la ficha se corrige con el mismo id');
  perform test.afirmar((select tipo_cuenta from public.trabajador_cuentas where trabajador_id = current_setting('prueba.t1')::uuid) = 'CORRIENTE',
    'la cuenta se corrige con la ficha');
  perform test.afirmar((select count(*) from public.trabajador_cuentas where trabajador_id = current_setting('prueba.t1')::uuid) = 1,
    'RR. HH. ve la cuenta bancaria');

  perform test.debe_fallar(
    format('select public.rrhh_guardar_trabajador(%L, ''Otro'', ''Con el mismo DNI'', ''70000331'', null, null, ''08:00'', ''18:00'', ''Banco'', ''AHORROS'', ''123456'', null)', gen_random_uuid()),
    'el DNI no se repite');
  perform test.debe_fallar(
    format('select public.rrhh_guardar_trabajador(%L, ''Mal'', ''Horario'', ''70000333'', null, null, ''18:00'', ''08:00'', ''Banco'', ''AHORROS'', ''123456'', null)', gen_random_uuid()),
    'la salida va después de la entrada');

  -- Tolerancia cero y S/ 0,50 por minuto, para que la cuenta sea exacta.
  perform public.rrhh_guardar_regla_tardanza(0, 0.5);
  perform test.afirmar((select descuento_por_minuto from public.rrhh_regla_tardanza) = 0.5, 'la regla se guarda');
  reset role;
end $$;

-- ------------------------------------------------- el portero marca
do $$
declare
  v_id      uuid;
  v_marca   public.asistencias%rowtype;
  v_minutos int;
begin
  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;

  perform test.afirmar((select count(*) from public.trabajadores where dni in ('70000331', '70000332')) = 2, 'el portero ve al personal');
  perform test.afirmar((select count(*) from public.trabajador_cuentas) = 0, 'el portero NO ve ninguna cuenta bancaria');
  perform test.debe_fallar(
    format('select public.rrhh_guardar_trabajador(%L, ''Intruso'', ''Portero'', ''70000339'', null, null, ''08:00'', ''18:00'', ''Banco'', ''AHORROS'', ''123456'', null)', gen_random_uuid()),
    'el portero no registra personal');

  perform test.debe_fallar(
    format('select public.marcar_asistencia(%L, %L, ''SALIDA'', null)', current_setting('prueba.m3'), current_setting('prueba.t1')),
    'no hay salida sin ingreso');

  v_id := public.marcar_asistencia(current_setting('prueba.m1')::uuid, current_setting('prueba.t1')::uuid, 'INGRESO', null);
  -- Un reintento con el mismo id devuelve la misma marca.
  v_id := public.marcar_asistencia(current_setting('prueba.m1')::uuid, current_setting('prueba.t1')::uuid, 'INGRESO', null);
  perform test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.t1')::uuid) = 1, 'el reintento no duplica');
  select * into v_marca from public.asistencias where id = current_setting('prueba.m1')::uuid;
  v_minutos := floor(extract(epoch from ((now() at time zone 'America/Lima')::time - time '00:00')) / 60)::int;
  perform test.afirmar(v_marca.tardanza_minutos between v_minutos - 1 and v_minutos, 'la tardanza son los minutos después de su hora de entrada');
  perform test.afirmar(v_marca.descuento = round(v_marca.tardanza_minutos * 0.5, 2), 'el descuento es minutos por la tarifa');
  perform test.afirmar(v_marca.fecha = (now() at time zone 'America/Lima')::date, 'la fecha es la de Lima');

  perform test.debe_fallar(
    format('select public.marcar_asistencia(%L, %L, ''INGRESO'', null)', gen_random_uuid(), current_setting('prueba.t1')),
    'un segundo ingreso el mismo día no entra');

  v_id := public.marcar_asistencia(current_setting('prueba.m2')::uuid, current_setting('prueba.t2')::uuid, 'INGRESO', 'llegó caminando');
  select * into v_marca from public.asistencias where id = current_setting('prueba.m2')::uuid;
  perform test.afirmar(v_marca.tardanza_minutos = 0 and v_marca.descuento = 0, 'quien entra antes de su hora no tiene tardanza');

  v_id := public.marcar_asistencia(current_setting('prueba.m3')::uuid, current_setting('prueba.t1')::uuid, 'SALIDA', null);
  perform test.afirmar((select tardanza_minutos from public.asistencias where id = current_setting('prueba.m3')::uuid) = 0, 'la salida no lleva tardanza');

  -- Nada se borra ni se corrige a mano.
  perform test.debe_fallar(format('delete from public.asistencias where id = %L', current_setting('prueba.m1')), 'una marca no se borra');
  perform test.debe_fallar(format('update public.asistencias set hora = ''07:00'' where id = %L', current_setting('prueba.m1')), 'una marca no se edita');

  -- El portero anula lo de hoy, pero primero la salida.
  perform test.debe_fallar(format('select public.anular_asistencia(%L, ''se marcó a la persona equivocada'')', current_setting('prueba.m1')),
    'el ingreso no se anula mientras tenga salida');
  v_id := public.anular_asistencia(current_setting('prueba.m3')::uuid, 'se marcó la salida por error del portero');
  v_id := public.anular_asistencia(current_setting('prueba.m1')::uuid, 'se marcó a la persona equivocada');
  perform test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.t1')::uuid and anulado_en is null) = 0,
    'las dos marcas quedaron anuladas');
  -- Y después de anular, puede volver a marcar.
  v_id := public.marcar_asistencia(gen_random_uuid(), current_setting('prueba.t1')::uuid, 'INGRESO', null);
  reset role;
end $$;

-- ------------------------------------------------ quien no es de esto
do $$
begin
  perform test.como_usuario(current_setting('prueba.operario')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.trabajadores) = 0, 'un operario no ve al personal');
  perform test.afirmar((select count(*) from public.asistencias) = 0, 'un operario no ve la asistencia');
  perform test.afirmar((select count(*) from public.rrhh_regla_tardanza) = 0, 'un operario no ve la regla');
  perform test.debe_fallar(
    format('select public.marcar_asistencia(%L, %L, ''INGRESO'', null)', gen_random_uuid(), current_setting('prueba.t2')),
    'un operario no marca asistencia');
  perform test.debe_fallar('select public.rrhh_guardar_regla_tardanza(10, 1)', 'un operario no cambia la regla');
  reset role;
end $$;

-- ------------------------------------------------ RR. HH. da de baja
do $$
declare v_id uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v_id := public.rrhh_cambiar_estado_trabajador(current_setting('prueba.t2')::uuid, false);
  perform test.afirmar(not (select activo from public.trabajadores where id = current_setting('prueba.t2')::uuid), 'queda de baja');
  perform test.debe_fallar(format('delete from public.trabajadores where id = %L', current_setting('prueba.t2')), 'un trabajador no se borra');
  perform test.afirmar((select count(*) from public.asistencias where trabajador_id = current_setting('prueba.t2')::uuid) = 1,
    'RR. HH. ve la asistencia del personal');
  reset role;
  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select public.marcar_asistencia(%L, %L, ''SALIDA'', null)', gen_random_uuid(), current_setting('prueba.t2')),
    'a quien está de baja no se le marca');
  reset role;
end $$;

rollback;
