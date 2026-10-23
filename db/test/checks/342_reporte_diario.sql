-- El supervisor sube su reporte diario: asunto, descripción, código interno,
-- trabajos con su avance, el personal de RR. HH. con sus horas (por trabajo o
-- general) y hasta tres fotos. Las horas pasan solas al tareo con la tarifa del
-- costeo; sin costo mensual esperan y entran cuando RR. HH. lo pone. El reporte
-- lo ven quien lo subió, RR. HH. y Gerencia; nadie más. No se borra: se anula,
-- y sus horas salen del costeo.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000042', 'PRUEBAS REPORTE S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T42', 'Taller de pruebas del reporte') on conflict (codigo) do nothing;

select test.crear_usuario('Rosa', 'Humanos', 'rrhh342@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia342@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Mario', 'Maestranza', 'sup.mtz342@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup1_id \gset
select test.crear_usuario('Alba', 'Acabados', 'sup.acb342@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup2_id \gset
select test.crear_usuario('Pedro', 'Portón', 'porteria342@demo.pe', 'PORTERO', (select id from public.sedes limit 1)) as portero_id \gset
select test.crear_usuario('Sara', 'General', 'sup.general342@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes limit 1)) as supgen_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin342@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

-- El área de cada supervisor la pone Administración, como en producción.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup1_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'ACB') where id = :'sup2_id';

select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.sup1', :'sup1_id', true);
select set_config('prueba.sup2', :'sup2_id', true);
select set_config('prueba.portero', :'portero_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.t2', gen_random_uuid()::text, true);
select set_config('prueba.t3', gen_random_uuid()::text, true);
select set_config('prueba.t4', gen_random_uuid()::text, true);
select set_config('prueba.r1', gen_random_uuid()::text, true);
select set_config('prueba.r2', gen_random_uuid()::text, true);
select set_config('prueba.r3', gen_random_uuid()::text, true);
select set_config('prueba.f1', :'sup1_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.f2', :'sup1_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.suelta', :'sup1_id' || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg', true);

-- Storage local no trae RLS: aquí se prende, como en Supabase, para probar las
-- políticas del bucket con el rol real. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ------------------------------------------------------ RR. HH. registra al personal
-- De Maestranza: el reporte diario ofrece solo a la gente de taller de
-- Maestranza, Producción o Acabados (migración 20261020181000).
do $$
declare v_id uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Juan', 'Soldador', '70000351', 'Soldador',
            (select id from public.areas where codigo = 'MTZ'), '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-51', null);
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t2')::uuid, 'Ana', 'Sin Costo', '70000352', 'Pintora',
            (select id from public.areas where codigo = 'MTZ'), '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-52', null);
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t3')::uuid, 'Luis', 'Esperando', '70000353', 'Armador',
            (select id from public.areas where codigo = 'MTZ'), '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-53', null);
  v_id := public.rrhh_guardar_trabajador(current_setting('prueba.t4')::uuid, 'Eva', 'De Baja', '70000354', 'Ayudante',
            (select id from public.areas where codigo = 'MTZ'), '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-54', null);
  v_id := public.rrhh_cambiar_estado_trabajador(current_setting('prueba.t4')::uuid, false);
  -- S/ 2400 al mes: S/ 10 la hora.
  v_id := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t1')::uuid, 2400);
  reset role;
end $$;

-- -------------------------------------------------------- el supervisor sube fotos
do $$
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-reporte-diario', current_setting('prueba.f1'), current_setting('prueba.sup1'), '{"mimetype": "image/jpeg", "size": 240000}'),
    ('fotos-reporte-diario', current_setting('prueba.f2'), current_setting('prueba.sup1'), '{"mimetype": "image/jpeg", "size": 310000}'),
    ('fotos-reporte-diario', current_setting('prueba.suelta'), current_setting('prueba.sup1'), '{"mimetype": "image/jpeg", "size": 1000}');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-reporte-diario') = 3,
    'el supervisor ve las fotos que acaba de subir');
  reset role;

  -- Otro supervisor no sube a la carpeta ajena; el portero no sube.
  perform test.como_usuario(current_setting('prueba.sup2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-reporte-diario'', %L, %L, ''{}'')',
      current_setting('prueba.sup1') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.sup2')),
    'un supervisor no sube a la carpeta de otro', 'row-level security');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-reporte-diario') = 0,
    'otro supervisor no ve fotos sueltas ajenas');
  reset role;
  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-reporte-diario'', %L, %L, ''{}'')',
      current_setting('prueba.portero') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.portero')),
    'el portero no sube fotos de reporte', 'row-level security');
  reset role;
end $$;

-- ------------------------------------------------- el supervisor ve solo lo que debe
do $$
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.reporte_diario_personal_disponible()) = 3,
    'el supervisor elige entre el personal activo de RR. HH. (la de baja no sale)');
  perform test.afirmar((select count(*) from public.trabajadores) = 0, 'el supervisor NO lee la ficha de RR. HH. (DNI, horario)');
  perform test.afirmar((select count(*) from public.trabajador_costos) = 0, 'el supervisor NO ve el costo mensual');
  perform test.afirmar((select count(*) from public.tareos) = 0, 'el supervisor NO ve el tareo');
  perform test.afirmar((select count(*) from public.rrhh_codigos_internos()) >= 0, 'el supervisor pide los códigos internos');
  reset role;
end $$;

-- ------------------------------------------------------ reporte con personal por trabajo
do $$
declare
  v_id   uuid;
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_trab jsonb := jsonb_build_array(
    jsonb_build_object('descripcion', 'Soldadura de la tolva', 'avance', 40, 'personal', jsonb_build_array(
      jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 6),
      jsonb_build_object('trabajador_id', current_setting('prueba.t2'), 'horas', 4))),
    jsonb_build_object('descripcion', 'Armado del bastidor', 'avance', 20, 'personal', jsonb_build_array(
      jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 2))));
  v_t    public.tareos%rowtype;
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;

  -- Lo que no entra, primero.
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance del día'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy + 1, v_trab), 'no se reporta mañana', 'hoy o un día anterior');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance del día'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy - 8, v_trab), 'un reporte de hace 8 días ya no lo sube el supervisor', '7 días');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''X'', ''Avance del día'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy, v_trab), 'el código interno lleva de 2 a 60 caracteres', 'código interno');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', ''[]'', null, null)',
      gen_random_uuid(), v_hoy), 'sin trabajos no hay reporte', 'al menos un trabajo');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy, '[{"descripcion": "Pintura", "avance": 10, "personal": []}]'),
    'sin personal no hay reporte: de ahí sale el costeo', 'al menos a una persona');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy, format('[{"descripcion": "Pintura", "avance": 140, "personal": [{"trabajador_id": "%s", "horas": 2}]}]', current_setting('prueba.t1'))),
    'el avance va de 0 a 100', 'de 0 a 100');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy, format('[{"descripcion": "Pintura", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 2}]}]', current_setting('prueba.t4'))),
    'a quien está de baja no se le cargan horas', 'personal activo');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy, format('[{"descripcion": "Pintura", "avance": 10, "personal": [{"trabajador_id": "%1$s", "horas": 2}, {"trabajador_id": "%1$s", "horas": 3}]}]', current_setting('prueba.t1'))),
    'una persona va una vez por trabajo', 'dos veces');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, null)',
      gen_random_uuid(), v_hoy, format('[{"descripcion": "Pintura", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 17}]}]', current_setting('prueba.t1'))),
    'las horas van de 0,25 a 16', '0,25 a 16');
  -- Una foto que es de otro reporte (otra carpeta) no se cuelga de este.
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, %L)',
      gen_random_uuid(), v_hoy, v_trab, jsonb_build_array(current_setting('prueba.f1'))),
    'la foto tiene que ser de la carpeta de este reporte', 'fotos');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, %L)',
      current_setting('prueba.r1'), v_hoy, v_trab,
      jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2'), current_setting('prueba.suelta'), current_setting('prueba.f1'))),
    'hasta 3 fotos', 'hasta 3 fotos');
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Avance'', ''Se soldó'', %L, null, %L)',
      current_setting('prueba.r1'), v_hoy, v_trab,
      jsonb_build_array(current_setting('prueba.sup1') || '/' || current_setting('prueba.r1') || '/' || gen_random_uuid() || '.jpg')),
    'una foto que no llegó a Storage no entra', 'no terminó de subir');

  -- Ahora sí.
  v_id := public.registrar_reporte_diario(current_setting('prueba.r1')::uuid, v_hoy, '  pla_sr_o4_1_26/28 ',
            'Tolva de la unidad 28', 'Se avanzó la soldadura y el armado.', v_trab, null,
            jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2')));
  perform test.afirmar(v_id = current_setting('prueba.r1')::uuid, 'el reporte entra');
  -- Un reintento (la señal se cortó) devuelve el mismo reporte sin duplicar.
  v_id := public.registrar_reporte_diario(current_setting('prueba.r1')::uuid, v_hoy, 'PLA_SR_O4_1_26/28',
            'Tolva de la unidad 28', 'Se avanzó la soldadura y el armado.', v_trab, null,
            jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2')));
  perform test.afirmar((select count(*) from public.reportes_diarios) = 1, 'el reintento no duplica el reporte');
  perform test.afirmar((select codigo_interno from public.reportes_diarios where id = current_setting('prueba.r1')::uuid) = 'PLA_SR_O4_1_26/28',
    'el código interno se guarda en mayúsculas y sin espacios');
  perform test.afirmar((select area_id from public.reportes_diarios where id = current_setting('prueba.r1')::uuid)
    = (select id from public.areas where codigo = 'MTZ'), 'el reporte lleva el área de quien lo subió');
  perform test.afirmar((select count(*) from public.reporte_diario_trabajos) = 2, 'el supervisor ve sus dos trabajos');
  perform test.afirmar((select count(*) from public.reporte_diario_personal) = 3, 'el supervisor ve su personal con sus horas');
  perform test.afirmar((select sum(horas) from public.reporte_diario_personal) = 12, 'las horas del reporte suman 12');
  perform test.afirmar((select count(*) from public.reporte_diario_fotos) = 2, 'el supervisor ve las fotos del reporte');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-reporte-diario') = 3, 'y sus archivos');
  perform test.afirmar((select count(*) from public.tareos) = 0, 'el supervisor sigue sin ver el tareo ni su costo');

  -- La foto suelta (subida y quitada del formulario) se puede retirar; la del reporte, no.
  delete from storage.objects where bucket_id = 'fotos-reporte-diario' and name = current_setting('prueba.suelta');
  delete from storage.objects where bucket_id = 'fotos-reporte-diario' and name = current_setting('prueba.f1');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-reporte-diario') = 2,
    'se retira la foto suelta y la del reporte se queda');

  -- El tope del día cuenta todo lo de la persona: 6 + 2 ya cargadas, más 9 pasa de 16.
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Otro'', ''Otro código'', %L, null, null)',
      gen_random_uuid(), v_hoy, format('[{"descripcion": "Limpieza", "avance": 100, "personal": [{"trabajador_id": "%s", "horas": 9}]}]', current_setting('prueba.t1'))),
    'una persona no pasa de 16 horas en el día entre todos los reportes', 'pasaría de 16 horas');
  reset role;

  -- Las horas de quien tiene costo entraron al tareo, con la tarifa del costeo.
  perform test.afirmar((select count(*) from public.tareos where trabajador_id = current_setting('prueba.t1')::uuid and reporte_linea_id is not null) = 2,
    'las horas de Juan pasaron solas al tareo, una por trabajo');
  select * into v_t from public.tareos where trabajador_id = current_setting('prueba.t1')::uuid and horas = 6;
  perform test.afirmar(v_t.codigo_interno = 'PLA_SR_O4_1_26/28' and v_t.costo_hora = 10 and v_t.costo = 60
    and v_t.labor = 'Soldadura de la tolva' and v_t.registrado_por = current_setting('prueba.sup1')::uuid,
    'el tareo lleva el código del reporte, la hora a costo mensual ÷ 240, el trabajo como labor y al supervisor');
  perform test.afirmar((select count(*) from public.tareos where trabajador_id = current_setting('prueba.t2')::uuid) = 0,
    'las horas de Ana esperan: todavía no tiene costo mensual');
  perform test.afirmar(public.rrhh_horas_del_dia(current_setting('prueba.t2')::uuid, v_hoy) = 4,
    'pero ya cuentan para su tope del día');
end $$;

-- ------------------------------------------------ reporte con personal general
do $$
declare
  v_id  uuid;
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Orden'', ''Orden del taller'', %L, %L, null)',
      gen_random_uuid(), v_hoy,
      format('[{"descripcion": "Orden", "avance": 100, "personal": [{"trabajador_id": "%s", "horas": 1}]}]', current_setting('prueba.t3')),
      format('[{"trabajador_id": "%s", "horas": 2}]', current_setting('prueba.t3'))),
    'con personal general los trabajos no llevan el suyo', 'personal general');
  v_id := public.registrar_reporte_diario(current_setting('prueba.r2')::uuid, v_hoy, 'PLANTA', 'Orden y limpieza',
            'Orden general del taller.', '[{"descripcion": "Orden de la zona de corte", "avance": 100}, {"descripcion": "Limpieza", "avance": 50, "personal": []}]',
            format('[{"trabajador_id": "%s", "horas": 3}, {"trabajador_id": "%s", "horas": 10}]', current_setting('prueba.t2'), current_setting('prueba.t3'))::jsonb,
            null);
  perform test.afirmar((select personal_general from public.reportes_diarios where id = current_setting('prueba.r2')::uuid),
    'el reporte queda con personal general');
  perform test.afirmar((select count(*) from public.reporte_diario_personal where reporte_id = current_setting('prueba.r2')::uuid and trabajo_id is null) = 2,
    'el personal general va sin trabajo');
  -- Ana ya tiene 4 + 3 = 7 h esperando: 10 más pasan de 16.
  perform test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''PLANTA'', ''Otro'', ''Otro'', %L, null, null)',
      gen_random_uuid(), v_hoy, format('[{"descripcion": "Pintura", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 10}]}]', current_setting('prueba.t2'))),
    'el tope del día cuenta también las horas que esperan costo', 'pasaría de 16 horas');
  reset role;
end $$;

-- --------------------------------------------- un tercer reporte, que se anulará antes del costo
do $$
declare v_id uuid; v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  perform test.como_usuario(current_setting('prueba.sup1')::uuid);
  set local role authenticated;
  v_id := public.registrar_reporte_diario(current_setting('prueba.r3')::uuid, v_hoy - 1, 'PLANTA', 'Equivocado',
            'Se subió con la persona equivocada.',
            format('[{"descripcion": "Pintura", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 5}]}]', current_setting('prueba.t3'))::jsonb, null, null);
  perform test.debe_fallar(format('select public.anular_reporte_diario(%L, ''corto'')', current_setting('prueba.r3')),
    'anular pide su motivo', '10 a 500');
  v_id := public.anular_reporte_diario(current_setting('prueba.r3')::uuid, 'Se puso a Luis y era otra persona');
  perform test.afirmar((select anulado_en is not null from public.reportes_diarios where id = current_setting('prueba.r3')::uuid),
    'el supervisor anula su reporte con motivo');
  reset role;
end $$;

-- ------------------------------------------------------- quién más lo ve, y quién no
do $$
begin
  perform test.como_usuario(current_setting('prueba.sup2')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.reportes_diarios) = 0, 'otro supervisor NO ve reportes ajenos');
  perform test.afirmar((select count(*) from public.reporte_diario_personal) = 0, 'ni su personal');
  perform test.afirmar((select count(*) from public.reporte_diario_fotos) = 0, 'ni sus fotos');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-reporte-diario') = 0, 'ni los archivos de sus fotos');
  perform test.debe_fallar(format('select public.anular_reporte_diario(%L, ''No es mío pero lo anulo'')', current_setting('prueba.r1')),
    'otro supervisor no anula un reporte ajeno', 'No tienes permiso para anular este reporte');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.reportes_diarios) = 3, 'Gerencia ve todos los reportes');
  perform test.afirmar((select count(*) from public.reporte_diario_personal) = 6, 'con su personal y sus horas');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-reporte-diario') = 2, 'y sus fotos');
  perform test.afirmar((select count(*) from public.tareos) = 0, 'Gerencia NO ve el tareo ni el costo de cada persona');
  perform test.debe_fallar('select * from public.reporte_diario_personal_disponible()', 'Gerencia no sube reportes', 'reporte_diario.registrar');
  perform test.debe_fallar(format('select public.anular_reporte_diario(%L, ''Gerencia quiere anularlo'')', current_setting('prueba.r1')),
    'Gerencia no anula reportes', 'No tienes permiso para anular este reporte');
  reset role;

  perform test.como_usuario(current_setting('prueba.portero')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.reportes_diarios) = 0, 'el portero NO ve los reportes');
  perform test.debe_fallar('select * from public.reporte_diario_personal_disponible()', 'el portero no pide el personal', 'reporte_diario.registrar');
  reset role;

  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.reportes_diarios) = 0, 'Supervisión general NO ve los reportes (quedó fuera a propósito)');
  reset role;
end $$;

-- ------------------------------------------- RR. HH.: lo que espera costo entra solo
do $$
declare v_id uuid; v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.reportes_diarios) = 3, 'RR. HH. ve todos los reportes');
  perform test.afirmar((select horas from public.rrhh_horas_esperando_costo() where trabajador_id = current_setting('prueba.t2')::uuid) = 7,
    'RR. HH. ve las 7 h de Ana que esperan su costo');
  perform test.afirmar((select horas from public.rrhh_horas_esperando_costo() where trabajador_id = current_setting('prueba.t3')::uuid) = 10,
    'y las 10 h de Luis (las del reporte anulado no cuentan)');

  v_id := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t2')::uuid, 1200);
  perform test.afirmar((select count(*) from public.tareos where trabajador_id = current_setting('prueba.t2')::uuid and reporte_linea_id is not null) = 2,
    'al ponerle el costo, las dos cargas de Ana entran solas al tareo');
  perform test.afirmar((select sum(costo) from public.tareos where trabajador_id = current_setting('prueba.t2')::uuid) = 35,
    'a S/ 5 la hora (1200 ÷ 240): 7 h son S/ 35');
  perform test.afirmar((select labor from public.tareos where trabajador_id = current_setting('prueba.t2')::uuid and horas = 3) = 'Orden y limpieza',
    'con personal general, la labor es el asunto del reporte');
  -- Volver a guardar el costo no duplica.
  v_id := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t2')::uuid, 1300);
  perform test.afirmar((select count(*) from public.tareos where trabajador_id = current_setting('prueba.t2')::uuid) = 2,
    'cambiar el costo después no duplica las horas');

  v_id := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t3')::uuid, 2400);
  perform test.afirmar((select count(*) from public.tareos where trabajador_id = current_setting('prueba.t3')::uuid) = 1,
    'de Luis entra solo el reporte vigente; el anulado no');
  perform test.afirmar((select count(*) from public.rrhh_horas_esperando_costo()) = 0, 'ya no queda nada esperando');

  -- El tareo a mano cuenta lo que vino de los reportes: Luis tiene 10, 7 más pasan de 16.
  perform test.debe_fallar(
    format('select public.rrhh_registrar_tareo(%L, %L, %L, ''PLANTA'', 7, null)', gen_random_uuid(), current_setting('prueba.t3'), v_hoy),
    'el tareo a mano respeta el tope con las horas del reporte', 'pasaría de 16 horas');

  -- RR. HH. anula el reporte 1: sus horas salen del costeo.
  v_id := public.anular_reporte_diario(current_setting('prueba.r1')::uuid, 'El supervisor lo subió dos veces');
  perform test.afirmar((select count(*) from public.tareos t join public.reporte_diario_personal l on l.id = t.reporte_linea_id
                         where l.reporte_id = current_setting('prueba.r1')::uuid and t.anulado_en is null) = 0,
    'al anular el reporte, sus horas quedan anuladas en el tareo');
  perform test.afirmar((select motivo_anulacion from public.tareos where trabajador_id = current_setting('prueba.t1')::uuid and horas = 6)
    = 'Se anuló el reporte diario: El supervisor lo subió dos veces', 'con el motivo del reporte');
  v_id := public.anular_reporte_diario(current_setting('prueba.r1')::uuid, 'El supervisor lo subió dos veces');
  perform test.afirmar(v_id = current_setting('prueba.r1')::uuid, 'anular dos veces no hace nada más');
  perform test.debe_fallar(format('delete from public.reportes_diarios where id = %L', current_setting('prueba.r2')), 'RR. HH. no borra un reporte');
  reset role;
end $$;

-- ------------------------------------------------ ni siquiera el dueño de la tabla
do $$
begin
  perform test.debe_fallar(format('delete from public.reportes_diarios where id = %L', current_setting('prueba.r2')),
    'el disparador no deja borrar un reporte', 'no se borra');
  perform test.debe_fallar(format('update public.reportes_diarios set asunto = ''Otro asunto'' where id = %L', current_setting('prueba.r2')),
    'el disparador no deja corregir un reporte', 'no se corrige');
  perform test.debe_fallar(format('update public.reportes_diarios set asunto = ''Otro asunto'' where id = %L', current_setting('prueba.r1')),
    'un reporte anulado queda congelado', 'anulado');
  perform test.debe_fallar(format('update public.reporte_diario_personal set horas = 1 where reporte_id = %L', current_setting('prueba.r2')),
    'las horas de un reporte no se cambian', 'no se cambia');
  perform test.debe_fallar(format('delete from public.reporte_diario_fotos where reporte_id = %L', current_setting('prueba.r1')),
    'una foto del reporte no se borra', 'no se cambia');
end $$;

rollback;
