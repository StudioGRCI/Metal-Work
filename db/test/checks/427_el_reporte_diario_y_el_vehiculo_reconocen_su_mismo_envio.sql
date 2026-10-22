-- El reporte diario y el ingreso y la salida del vehículo reconocen el mismo
-- envío por todo lo que lleva, fotos incluidas (migración 20261022194000).
-- Antes, el reintento con el mismo id y otro asunto, otras horas u otra foto
-- volvía «subido»: quedaba lo de la primera vez y la foto nueva, suelta. Ahora
-- el mismo envío devuelve su id; otro se rechaza con «… ya quedó registrado la
-- primera vez que lo enviaste…», y su foto nueva la puede quitar su dueño
-- porque ninguna fila la nombra.
--
-- Con las cuentas reales y `set local role authenticated`: el supervisor de
-- Maestranza sube y corrige su reporte, RR. HH. lo observa, Requerimientos
-- registra el vehículo. El armazón lo pone el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA427', 'Taller prueba 427') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA427' \gset
select test.crear_usuario('Ada', 'Admin', 'admin427@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh427@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('Reni', 'Requerimientos', 'req427@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req_id \gset
select test.crear_usuario('Raúl', 'Requerimientos', 'req427b@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req2_id \gset
-- Una sola Supervisión activa por área: si la base ya tiene la de Maestranza o la de Producción, se usa esa.
select coalesce(
  (select u.id from public.usuarios u join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
     join public.areas a on a.id = u.area_id and a.codigo = 'MTZ' where u.activo limit 1),
  test.crear_usuario('Mario', 'Maestranza', 'sup.mtz427@demo.pe', 'SUPERVISOR', :'sede_id')) as sup_id \gset
select coalesce(
  (select u.id from public.usuarios u join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
     join public.areas a on a.id = u.area_id and a.codigo = 'PRD' where u.activo limit 1),
  test.crear_usuario('Pía', 'Producción', 'sup.prd427@demo.pe', 'SUPERVISOR', :'sede_id')) as sup2_id \gset

select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'sup2_id';

select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
do $$
declare v text;
begin
  foreach v in array array['juan', 'ra', 'rb', 'rc', 'rd', 'v1'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- Una foto ya subida a Storage por su dueño, en la carpeta del reporte o del vehículo.
create or replace function pg_temp.foto(p_cubeta text, p_carpeta text, p_dueno text) returns text language plpgsql as $$
declare v_ruta text := current_setting('prueba.' || p_dueno) || '/' || p_carpeta || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_cubeta, v_ruta, current_setting('prueba.' || p_dueno), '{"mimetype": "image/jpeg", "size": 150000}');
  return v_ruta;
end $$;
-- Un código del reporte con un trabajo y Juan con sus horas.
create or replace function pg_temp.codigo(p_id text, p_codigo text, p_horas numeric, p_fotos jsonb, p_trabajo text default 'Armado del cajón')
returns jsonb language sql as $$
  select jsonb_build_object('id', current_setting('prueba.' || p_id), 'codigo_interno', p_codigo,
    'trabajos', jsonb_build_array(jsonb_build_object('descripcion', p_trabajo, 'avance', 30, 'personal',
      jsonb_build_array(jsonb_build_object('trabajador_id', current_setting('prueba.juan'), 'horas', p_horas)))),
    'personal_general', '[]'::jsonb, 'fotos', p_fotos);
$$;
create or replace function pg_temp.reporte_sql(p_asunto text, p_codigos jsonb) returns text language sql as $$
  select format('select public.registrar_reportes_diarios(%L, %L, ''Lo que se avanzó en el código'', %L)',
                current_setting('prueba.hoy'), p_asunto, p_codigos);
$$;
-- Quitar como lo hace Storage (DELETE … RETURNING): cuántos archivos se fueron.
create or replace function pg_temp.quitar(p_cubeta text, p_ruta text) returns integer language plpgsql as $$
declare v integer;
begin
  with quitado as (delete from storage.objects where bucket_id = p_cubeta and name = p_ruta returning 1)
  select count(*) into v from quitado;
  return v;
end $$;

-- RR. HH. registra a Juan, de Maestranza.
select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.rrhh_guardar_trabajador(pg_temp.id('juan'), 'Juan', 'Habilitador', '70000427', 'Habilitador',
  (select id from public.areas where codigo = 'MTZ'), '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-27', null);
select public.rrhh_guardar_costo_trabajador(pg_temp.id('juan'), 2400);
reset role;

-- ============================================ 1. El reporte de varios códigos
select test.como_usuario(:'sup_id');
set local role authenticated;
select set_config('prueba.f1', pg_temp.foto('fotos-reporte-diario', pg_temp.txt('ra'), 'sup'), true);
select set_config('prueba.f2', pg_temp.foto('fotos-reporte-diario', pg_temp.txt('ra'), 'sup'), true);
select set_config('prueba.primero', pg_temp.codigo('ra', 'CHK427_SR_A_1_26/40', 4, jsonb_build_array(pg_temp.txt('f1')))::text, true);
select test.afirmar(public.registrar_reportes_diarios(pg_temp.txt('hoy')::date, 'Avance del día', 'Lo que se avanzó en el código',
                      jsonb_build_array(pg_temp.txt('primero')::jsonb)) = array[pg_temp.id('ra')],
  'el supervisor sube su reporte con una foto');
select test.afirmar(public.registrar_reportes_diarios(pg_temp.txt('hoy')::date, 'Avance del día', 'Lo que se avanzó en el código',
                      jsonb_build_array(pg_temp.txt('primero')::jsonb)) = array[pg_temp.id('ra')],
  'el mismo envío repetido devuelve el mismo reporte');
select test.debe_fallar(pg_temp.reporte_sql('Otro asunto', jsonb_build_array(pg_temp.txt('primero')::jsonb)),
  'con otro asunto ya no es el mismo envío', 'Este reporte ya quedó registrado la primera vez que lo enviaste');
select test.debe_fallar(pg_temp.reporte_sql('Avance del día', jsonb_build_array(pg_temp.codigo('ra', 'CHK427_SR_A_1_26/40', 8, jsonb_build_array(pg_temp.txt('f1'))))),
  'ni con otras horas', 'la primera vez que lo enviaste');
select test.debe_fallar(pg_temp.reporte_sql('Avance del día',
    jsonb_build_array(pg_temp.codigo('ra', 'CHK427_SR_A_1_26/40', 4, jsonb_build_array(pg_temp.txt('f1'), pg_temp.txt('f2'))))),
  'ni con otra foto', 'la primera vez que lo enviaste');
select test.debe_fallar(pg_temp.reporte_sql('Avance del día', jsonb_build_array(pg_temp.txt('primero')::jsonb,
    pg_temp.codigo('rb', 'CHK427_SR_B_1_26/41', 2, '[]'::jsonb))),
  'ni con un código que se agregó después', 'la primera vez que lo enviaste');
select test.afirmar(pg_temp.quitar('fotos-reporte-diario', pg_temp.txt('f2')) = 1,
  'la foto nueva no la nombra nadie: el supervisor la quita');
select test.afirmar(pg_temp.quitar('fotos-reporte-diario', pg_temp.txt('f1')) = 0,
  'la de la primera vez no se quita');
reset role;
select test.afirmar(
  (select asunto from public.reportes_diarios where id = pg_temp.id('ra')) = 'Avance del día'
  and (select count(*) from public.reportes_diarios where id in (pg_temp.id('ra'), pg_temp.id('rb'))) = 1
  and (select count(*) from public.reporte_diario_fotos where reporte_id = pg_temp.id('ra')) = 1
  and (select sum(horas) from public.tareos where trabajador_id = pg_temp.id('juan') and anulado_en is null) = 4,
  'queda el reporte de la primera vez, con su foto y sus 4 horas, una vez');

select test.como_usuario(:'sup2_id');
set local role authenticated;
select test.debe_fallar(pg_temp.reporte_sql('Avance del día', jsonb_build_array(pg_temp.txt('primero')::jsonb)),
  'el id de otro supervisor no se da por suyo', 'Ese reporte ya existe');
reset role;

-- ============================================ 2. El reporte de un código y el corregido
select test.como_usuario(:'sup_id');
set local role authenticated;
select test.afirmar(public.registrar_reporte_diario(pg_temp.id('rc'), pg_temp.txt('hoy')::date - 1, 'CHK427_SR_A_1_26/40',
    'Ayer', 'El armado de ayer', (pg_temp.codigo('rc', '', 2, '[]', 'Pulido del cajón') -> 'trabajos'), null, null) = pg_temp.id('rc'),
  'el reporte de un código entra');
select test.afirmar(public.registrar_reporte_diario(pg_temp.id('rc'), pg_temp.txt('hoy')::date - 1, 'CHK427_SR_A_1_26/40',
    'Ayer', 'El armado de ayer', (pg_temp.codigo('rc', '', 2, '[]', 'Pulido del cajón') -> 'trabajos'), null, null) = pg_temp.id('rc'),
  'y su mismo envío devuelve su id');
select test.debe_fallar(format('select public.registrar_reporte_diario(%L, %L, ''CHK427_SR_A_1_26/40'', ''Ayer'', ''Otra descripción del armado'', %L, null, null)',
    pg_temp.txt('rc'), pg_temp.txt('hoy')::date - 1, pg_temp.codigo('rc', '', 2, '[]', 'Pulido del cajón') -> 'trabajos'),
  'con otra descripción ya no', 'la primera vez que lo enviaste');
reset role;

select test.como_usuario(:'rrhh_id');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('rc'), 'RRHH', 'Juan hizo 1 hora, no 2.');
reset role;

select test.como_usuario(:'sup_id');
set local role authenticated;
select test.afirmar(public.registrar_reporte_corregido(pg_temp.id('rc'), pg_temp.id('rd'), pg_temp.txt('hoy')::date - 1,
    'CHK427_SR_A_1_26/40', 'Ayer', 'El armado de ayer', (pg_temp.codigo('rd', '', 1, '[]', 'Pulido del cajón') -> 'trabajos'), null, null) = pg_temp.id('rd'),
  'el supervisor corrige lo observado');
select test.afirmar(public.registrar_reporte_corregido(pg_temp.id('rc'), pg_temp.id('rd'), pg_temp.txt('hoy')::date - 1,
    'CHK427_SR_A_1_26/40', 'Ayer', 'El armado de ayer', (pg_temp.codigo('rd', '', 1, '[]', 'Pulido del cajón') -> 'trabajos'), null, null) = pg_temp.id('rd'),
  'y el mismo envío de la corrección devuelve su id');
select test.debe_fallar(format('select public.registrar_reporte_corregido(%L, %L, %L, ''CHK427_SR_A_1_26/40'', ''Ayer'', ''El armado de ayer'', %L, null, null)',
    pg_temp.txt('rc'), pg_temp.txt('rd'), pg_temp.txt('hoy')::date - 1, pg_temp.codigo('rd', '', 3, '[]', 'Pulido del cajón') -> 'trabajos'),
  'con otras horas, la corrección ya no es la misma', 'la primera vez que lo enviaste');
reset role;
select test.afirmar((select sum(t.horas) from public.tareos t join public.reporte_diario_personal l on l.id = t.reporte_linea_id
                      where l.reporte_id = pg_temp.id('rd') and t.anulado_en is null) = 1,
  'la corrección queda con la hora de la primera vez');

-- ============================================ 3. El ingreso y la salida del vehículo
select test.como_usuario(:'req_id');
set local role authenticated;
select set_config('prueba.i1', pg_temp.foto('fotos-vehiculos', pg_temp.txt('v1') || '/ingreso', 'req'), true);
select set_config('prueba.i2', pg_temp.foto('fotos-vehiculos', pg_temp.txt('v1') || '/ingreso', 'req'), true);
select test.afirmar(public.registrar_ingreso_vehiculo(pg_temp.id('v1'), 'QAA427', null, null, 'Camioneta del cliente', 'QA CLIENTE 427',
    'COCHERA', null, 'Llega con la llanta baja', jsonb_build_array(pg_temp.txt('i1'))) = pg_temp.id('v1'),
  'Requerimientos registra el ingreso con su foto');
select test.afirmar(public.registrar_ingreso_vehiculo(pg_temp.id('v1'), 'QAA427', null, null, 'Camioneta del cliente', 'QA CLIENTE 427',
    'COCHERA', null, 'Llega con la llanta baja', jsonb_build_array(pg_temp.txt('i1'))) = pg_temp.id('v1'),
  'el mismo envío repetido devuelve el mismo ingreso');
select test.debe_fallar(format($q$select public.registrar_ingreso_vehiculo(%L, 'QAA427', null, null, 'Camioneta del cliente', 'QA CLIENTE 427', 'COCHERA', null, 'Llega sin espejo', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_array(pg_temp.txt('i1'))),
  'con otra observación ya no es el mismo envío (antes bastaba el motivo)', 'Este ingreso ya quedó registrado la primera vez que lo enviaste');
select test.debe_fallar(format($q$select public.registrar_ingreso_vehiculo(%L, 'QAA427', null, null, 'Camioneta del cliente', 'QA CLIENTE 427', 'COCHERA', null, 'Llega con la llanta baja', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_array(pg_temp.txt('i1'), pg_temp.txt('i2'))),
  'ni con otra foto', 'la primera vez que lo enviaste');
select test.afirmar(pg_temp.quitar('fotos-vehiculos', pg_temp.txt('i2')) = 1 and pg_temp.quitar('fotos-vehiculos', pg_temp.txt('i1')) = 0,
  'la foto nueva la quita su dueño; la de la primera vez se queda');
reset role;

select test.como_usuario(:'req2_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_ingreso_vehiculo(%L, 'QAA427', null, null, 'Camioneta del cliente', 'QA CLIENTE 427', 'COCHERA', null, 'Llega con la llanta baja', '[]')$q$,
    pg_temp.txt('v1')),
  'el ingreso de otra persona no se da por suyo', 'Este ingreso ya existe con otros datos');
reset role;

select test.como_usuario(:'req_id');
set local role authenticated;
select set_config('prueba.s1', pg_temp.foto('fotos-vehiculos', pg_temp.txt('v1') || '/salida', 'req'), true);
select set_config('prueba.s2', pg_temp.foto('fotos-vehiculos', pg_temp.txt('v1') || '/salida', 'req'), true);
select test.afirmar(public.registrar_salida_vehiculo(pg_temp.id('v1'), null, 'Lo recoge el conductor', jsonb_build_array(pg_temp.txt('s1'))) = pg_temp.id('v1'),
  'la salida entra con su foto');
select test.afirmar(public.registrar_salida_vehiculo(pg_temp.id('v1'), null, 'Lo recoge el conductor', jsonb_build_array(pg_temp.txt('s1'))) = pg_temp.id('v1'),
  'la misma salida repetida devuelve el registro');
select test.debe_fallar(format($q$select public.registrar_salida_vehiculo(%L, null, 'Lo recoge el conductor', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_array(pg_temp.txt('s2'))),
  'con otra foto ya no es la misma salida (antes bastaba que hubiera salido)', 'la salida quedó registrada la primera vez que la enviaste');
select test.debe_fallar(format($q$select public.registrar_salida_al_arenado(%L, null, 'Lo recoge el conductor', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_array(pg_temp.txt('s1'))),
  'ni la misma como salida al arenado', 'la primera vez que la enviaste');
select test.afirmar(pg_temp.quitar('fotos-vehiculos', pg_temp.txt('s2')) = 1 and pg_temp.quitar('fotos-vehiculos', pg_temp.txt('s1')) = 0,
  'la foto nueva de la salida la quita su dueño; la de la primera vez se queda');
reset role;
select test.afirmar(
  (select observacion_ingreso = 'Llega con la llanta baja' and observacion_salida = 'Lo recoge el conductor' and not sale_al_arenado
     from public.registro_vehiculos where id = pg_temp.id('v1'))
  and (select count(*) from public.registro_vehiculo_fotos where registro_id = pg_temp.id('v1')) = 2,
  'el vehículo queda con lo de la primera vez: una foto al entrar y una al salir');

select test.como_usuario(:'req2_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_salida_vehiculo(%L, null, 'Lo recoge el conductor', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_array(pg_temp.txt('s1'))),
  'la salida que marcó otra persona ya no se da por buena', 'Ese vehículo ya salió.');
-- Nadie lee ni escribe las huellas por su cuenta.
select test.debe_fallar('select count(*) from public.huellas_de_envio', 'la tabla de las huellas no se lee por la API', 'permission denied');
reset role;
select test.afirmar(
  not has_function_privilege('authenticated', 'public.anotar_envio(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.mismo_envio(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.anotar_envio(uuid, text, jsonb)', 'execute'),
  'ni se anotan ni se consultan con una llamada');

select 'CHECK 427 OK' as resultado;
rollback;
