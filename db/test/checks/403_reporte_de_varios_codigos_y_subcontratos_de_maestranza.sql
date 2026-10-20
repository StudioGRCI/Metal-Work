-- El reporte diario con varios códigos y los subcontratos de Maestranza
-- (migración 20261020180000). El supervisor sube un solo reporte del día con
-- todos los códigos en que trabajó su gente: entra un reporte por código, todos
-- o ninguno, y las horas de cada código van a su costeo. Administración ya
-- registra subcontratos para Maestranza, y el supervisor los ve sin montos, con
-- el avance que su área reportó. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_clave text; v_id uuid;
begin
  -- Una sola Supervisión activa por área (20260929110100): si la base ya tiene la del área, se usa esa.
  foreach v in array array['sup_mtz:SUPERVISOR:MTZ', 'sup_prd:SUPERVISOR:PRD',
                           'administracion:ADMINISTRACION:ADM', 'rrhh:RECURSOS_HUMANOS:RRH',
                           'logistica:COMPRADOR:LOG'] loop
    v_clave := split_part(v, ':', 1);
    if split_part(v, ':', 2) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 3)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || v_clave, v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, v_clave || '.403@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 2), 'Check 403', v_clave || '.403@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3))
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || v_clave, v_id::text, true);
  end loop;
  foreach v in array array['sub', 'sc_mtz', 'sc_prd', 'sc_cal', 't1', 'ra', 'rb', 'rc', 'rd', 're', 'rf'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.ruc', (select '1071234030' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234030' || d) limit 1), true);
  perform set_config('prueba.a', 'CHK403_SR_A_1_26/40', true);
  perform set_config('prueba.b', 'CHK403_SR_B_1_26/41', true);
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
create or replace function pg_temp.dia(n integer) returns date language sql as $$
  select current_setting('prueba.hoy')::date - n;
$$;
-- Un trabajo: sobre qué, su avance y Juan con sus horas (sin gente si horas es null).
create or replace function pg_temp.trabajo(p_sobre text, p_valor text, p_avance integer, p_horas numeric default 1)
returns jsonb language sql as $$
  select jsonb_build_object(p_sobre, p_valor, 'avance', p_avance, 'personal',
           case when p_horas is null then '[]'::jsonb
                else jsonb_build_array(jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', p_horas)) end);
$$;
-- Un código del reporte: su id, el código y sus trabajos.
create or replace function pg_temp.codigo(p_id text, p_codigo text, p_trabajos jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'codigo_interno', p_codigo, 'trabajos', p_trabajos, 'personal_general', '[]'::jsonb, 'fotos', '[]'::jsonb);
$$;
-- La sentencia que sube el reporte del día, para usarla igual en lo que pasa y en lo que debe fallar.
create or replace function pg_temp.reporte_sql(p_dias integer, p_codigos jsonb) returns text language sql as $$
  select format('select public.registrar_reportes_diarios(%L, ''Avance del día'', ''Lo que se avanzó en los dos códigos'', %L)',
                pg_temp.dia(p_dias), p_codigos);
$$;
-- La tarea propia de un código, por su nombre.
create or replace function pg_temp.actividad(p_codigo text, p_nombre text) returns text language sql as $$
  select id::text from public.codigo_actividades
   where codigo_interno = current_setting('prueba.' || p_codigo) and descripcion = p_nombre;
$$;
-- Lo que el supervisor ve de un subcontrato, como lo ve él.
create or replace function pg_temp.del_area(p_sub text) returns jsonb language sql as $$
  select to_jsonb(s) from public.subcontratos_del_area() s where s.id = current_setting('prueba.' || p_sub)::uuid;
$$;

-- ======================================================= 0. El armazón
-- RR. HH. registra a Juan, a S/ 2400 al mes (S/ 10 la hora).
select pg_temp.como('rrhh');
set local role authenticated;
select public.rrhh_guardar_trabajador(pg_temp.id('t1'), 'Juan', 'Habilitador', '70000403', 'Habilitador',
  null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-03', null);
select public.rrhh_guardar_costo_trabajador(pg_temp.id('t1'), 2400);
reset role;

-- ======================================================= 1. Administración registra subcontratos para Maestranza
select pg_temp.como('administracion');
set local role authenticated;
select public.guardar_subcontratista(pg_temp.id('sub'), pg_temp.txt('ruc'), 'Soldador de prueba 403', null, null, null, null, true);
select public.registrar_subcontrato(pg_temp.id('sc_mtz'), pg_temp.id('sub'), pg_temp.txt('b'),
  'Soldadura del piso del cajón', 'PEN', 2000, pg_temp.dia(5), pg_temp.dia(-10), 'mtz');
select public.registrar_subcontrato(pg_temp.id('sc_prd'), pg_temp.id('sub'), pg_temp.txt('b'),
  'Montaje del bastidor', 'PEN', 3000, pg_temp.dia(5), pg_temp.dia(-20), 'PRD');
select test.debe_fallar(format('select public.registrar_subcontrato(%L, %L, %L, ''Control de calidad del piso'', ''PEN'', 100, null, null, ''CAL'')',
    pg_temp.txt('sc_cal'), pg_temp.txt('sub'), pg_temp.txt('b')),
  'Calidad no recibe subcontratos', 'Producción, Maestranza o Acabados');
select test.afirmar((select a.codigo from public.subcontratos s join public.areas a on a.id = s.area_id where s.id = pg_temp.id('sc_mtz')) = 'MTZ',
  'el subcontrato de Maestranza queda con su área');
reset role;
select test.afirmar(exists (select 1 from public.notificaciones where usuario_id = pg_temp.id('sup_mtz')
                             and origen_id = pg_temp.id('sc_mtz') and ruta = '/subcontratos/area'),
  'al supervisor de Maestranza le llega el aviso del subcontrato');

-- ======================================================= 2. Maestranza ve sus subcontratos, sin un sol
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  pg_temp.del_area('sc_mtz') ->> 'area_codigo' = 'MTZ'
  and pg_temp.del_area('sc_mtz') ->> 'subcontratista' = 'Soldador de prueba 403'
  and (pg_temp.del_area('sc_mtz') ->> 'fecha_inicio')::date = pg_temp.dia(5)
  and (pg_temp.del_area('sc_mtz') ->> 'fecha_fin')::date = pg_temp.dia(-10)
  and pg_temp.del_area('sc_mtz') -> 'avance' = 'null'::jsonb
  and (pg_temp.del_area('sc_mtz') ->> 'reportes')::int = 0,
  'Maestranza ve su subcontrato con su inicio y su fin, sin avance todavía');
select test.afirmar(pg_temp.del_area('sc_prd') is null, 'y no ve el de Producción');
select test.afirmar(
  not exists (select 1 from jsonb_object_keys(pg_temp.del_area('sc_mtz')) k
               where k ~ 'monto|moneda|bruto|retencion|pagado|recibo'),
  'en lo que ve no hay montos ni recibos');
select test.afirmar((select count(*) from public.subcontratos where id = pg_temp.id('sc_mtz')) = 0,
  'ni puede leer la tabla de subcontratos por la API, donde está el monto');
reset role;

select pg_temp.como('sup_prd');
set local role authenticated;
select test.afirmar(pg_temp.del_area('sc_prd') is not null and pg_temp.del_area('sc_mtz') is null,
  'Producción ve el suyo y no el de Maestranza');
reset role;

select pg_temp.como('logistica');
set local role authenticated;
select test.debe_fallar('select * from public.subcontratos_del_area()',
  'Logística no ve los subcontratos de las áreas', 'subcontratos.area');
select test.debe_fallar(pg_temp.reporte_sql(1, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('ra'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('descripcion', 'Armado del cajón', 30))))),
  'ni sube reportes diarios', 'reporte_diario.registrar');
reset role;

-- ======================================================= 3. Un reporte con dos códigos
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  public.registrar_reportes_diarios(pg_temp.dia(1), 'Avance del día', 'Lo que se avanzó en los dos códigos', jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('ra'), lower(pg_temp.txt('a')), jsonb_build_array(
      pg_temp.trabajo('descripcion', 'Armado del cajón', 30, 4))),
    pg_temp.codigo(pg_temp.txt('rb'), pg_temp.txt('b'), jsonb_build_array(
      pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc_mtz'), 25, null),
      pg_temp.trabajo('descripcion', 'Corte de planchas', 10, 3)))))
  = array[pg_temp.id('ra'), pg_temp.id('rb')],
  'el reporte con dos códigos entra y devuelve sus dos reportes, en orden');
reset role;

select test.afirmar(
  (select count(*) from public.reportes_diarios where id in (pg_temp.id('ra'), pg_temp.id('rb'))) = 2
  and (select codigo_interno from public.reportes_diarios where id = pg_temp.id('ra')) = pg_temp.txt('a')
  and (select codigo_interno from public.reportes_diarios where id = pg_temp.id('rb')) = pg_temp.txt('b')
  and (select count(distinct (registrado_por, creado_en, fecha, asunto, descripcion)) from public.reportes_diarios
        where id in (pg_temp.id('ra'), pg_temp.id('rb'))) = 1
  and (select registrado_por from public.reportes_diarios where id = pg_temp.id('ra')) = pg_temp.id('sup_mtz'),
  'un reporte por código, con el mismo autor, día, asunto e instante: así se muestran juntos');
select test.afirmar(
  (select sum(horas) from public.tareos where trabajador_id = pg_temp.id('t1') and codigo_interno = pg_temp.txt('a')) = 4
  and (select sum(horas) from public.tareos where trabajador_id = pg_temp.id('t1') and codigo_interno = pg_temp.txt('b')) = 3,
  'las 4 horas de Juan en el cajón van al código A y las 3 del corte al B');
select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar(
  (select sum(monto) from public.codigo_interno_costeo(pg_temp.txt('a')) where fuente = 'MANO_OBRA') = 40
  and (select sum(monto) from public.codigo_interno_costeo(pg_temp.txt('b')) where fuente = 'MANO_OBRA') = 30,
  'y el costeo de cada código suma solo lo suyo: S/ 40 y S/ 30');
reset role;
select test.afirmar(
  (select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('a') and descripcion = 'Armado del cajón') = 1
  and (select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('b') and descripcion = 'Corte de planchas') = 1,
  'cada tarea propia queda en su código, para los reportes siguientes');

-- El reintento del mismo envío (la señal se cortó) no sube otro.
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  public.registrar_reportes_diarios(pg_temp.dia(1), 'Avance del día', 'Lo que se avanzó en los dos códigos', jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('ra'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('descripcion', 'Armado del cajón', 30, 4))),
    pg_temp.codigo(pg_temp.txt('rb'), pg_temp.txt('b'), jsonb_build_array(pg_temp.trabajo('descripcion', 'Corte de planchas', 10, 3)))))
  = array[pg_temp.id('ra'), pg_temp.id('rb')],
  'el reintento devuelve los mismos dos reportes');
reset role;
select test.afirmar(
  (select sum(horas) from public.tareos where trabajador_id = pg_temp.id('t1') and codigo_interno in (pg_temp.txt('a'), pg_temp.txt('b'))) = 7,
  'y no duplica las horas');
set local role authenticated;
select test.debe_fallar(pg_temp.reporte_sql(1, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('ra'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('descripcion', 'Armado del cajón', 40))),
    pg_temp.codigo(pg_temp.txt('rc'), pg_temp.txt('b'), jsonb_build_array(pg_temp.trabajo('descripcion', 'Corte de planchas', 20))))),
  'medio envío repetido no entra', 'Ese reporte ya existe');

-- ======================================================= 4. Lo que no entra, y no entra nada
select test.debe_fallar(pg_temp.reporte_sql(0, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('rc'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('a', 'Armado del cajón'), 40))),
    pg_temp.codigo(pg_temp.txt('rd'), lower(pg_temp.txt('a')), jsonb_build_array(pg_temp.trabajo('descripcion', 'Pulido', 10))))),
  'el mismo código no va dos veces', 'El código CHK403_SR_A_1_26/40 va dos veces');
select test.debe_fallar(pg_temp.reporte_sql(0, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('rc'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('a', 'Armado del cajón'), 40))),
    pg_temp.codigo(pg_temp.txt('rd'), pg_temp.txt('b'), jsonb_build_array(pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc_mtz'), 20, null))))),
  'el subcontrato no baja del 25 % de ayer, y el aviso dice en qué código', 'En CHK403_SR_B_1_26/41: «Subcontrato');
select test.debe_fallar(pg_temp.reporte_sql(0, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('rc'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('a', 'Armado del cajón'), 40, 10))),
    pg_temp.codigo(pg_temp.txt('rd'), pg_temp.txt('b'), jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('b', 'Corte de planchas'), 20, 8))))),
  'Juan no pasa de 16 horas en el día sumando los dos códigos', 'pasaría de 16 horas');
select test.debe_fallar(pg_temp.reporte_sql(0, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('rc'), pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('a', 'Armado del cajón'), 40))),
    pg_temp.codigo(pg_temp.txt('rd'), '', jsonb_build_array(pg_temp.trabajo('descripcion', 'Pulido', 10))))),
  'un código sin escribir dice cuál es', 'En el código 2 del reporte: Escribe el código interno');
select test.debe_fallar(pg_temp.reporte_sql(0, (select jsonb_agg(pg_temp.codigo(gen_random_uuid()::text, 'CHK403_' || n,
    jsonb_build_array(pg_temp.trabajo('descripcion', 'Pulido', 10)))) from generate_series(1, 11) n)),
  'hasta 10 códigos por reporte', 'hasta 10 códigos');
select test.debe_fallar(pg_temp.reporte_sql(0, '[]'::jsonb), 'sin códigos no hay reporte', 'al menos un código');
select test.debe_fallar(pg_temp.reporte_sql(0, jsonb_build_array(
    pg_temp.codigo('no-es-un-id', pg_temp.txt('a'), jsonb_build_array(pg_temp.trabajo('descripcion', 'Pulido', 10))))),
  'un id roto pide volver a abrir el formulario', 'Vuelve a abrir el formulario');
-- Lo que falló en el segundo código no dejó el primero adentro (mirado sin RLS).
reset role;
select test.afirmar((select count(*) from public.reportes_diarios where id in (pg_temp.id('rc'), pg_temp.id('rd'))) = 0
  and (select sum(horas) from public.tareos where trabajador_id = pg_temp.id('t1') and fecha = pg_temp.dia(0)) is null,
  'de los envíos rechazados no quedó ningún reporte ni ninguna hora');

-- Producción no reporta el subcontrato de Maestranza.
select pg_temp.como('sup_prd');
set local role authenticated;
select test.debe_fallar(pg_temp.reporte_sql(0, jsonb_build_array(
    pg_temp.codigo(pg_temp.txt('re'), pg_temp.txt('b'), jsonb_build_array(pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc_mtz'), 40, null))))),
  'Producción no reporta el subcontrato de Maestranza', 'no es de tu área');
reset role;

-- ======================================================= 5. El avance del subcontrato, como lo ve Maestranza
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (pg_temp.del_area('sc_mtz') ->> 'avance')::numeric = 25
  and (pg_temp.del_area('sc_mtz') ->> 'ultimo_reporte')::date = pg_temp.dia(1)
  and (pg_temp.del_area('sc_mtz') ->> 'reportes')::int = 1,
  'Maestranza ve su subcontrato en 25 %, con el reporte de ayer');
-- Hoy, con el código B solo, sube a 60 %.
select public.registrar_reportes_diarios(pg_temp.dia(0), 'Avance de hoy', 'La soldadura del piso', jsonb_build_array(
  pg_temp.codigo(pg_temp.txt('rf'), pg_temp.txt('b'), jsonb_build_array(pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc_mtz'), 60, null)))));
select test.afirmar(
  (pg_temp.del_area('sc_mtz') ->> 'avance')::numeric = 60
  and (pg_temp.del_area('sc_mtz') ->> 'ultimo_reporte')::date = pg_temp.dia(0)
  and (pg_temp.del_area('sc_mtz') ->> 'reportes')::int = 2,
  'y con el reporte de hoy pasa a 60 %');
reset role;

-- Administración lo da por terminado: el supervisor lo ve completo.
select pg_temp.como('administracion');
set local role authenticated;
select public.cambiar_estado_subcontrato(pg_temp.id('sc_mtz'), 'TERMINADO');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (pg_temp.del_area('sc_mtz') ->> 'avance')::numeric = 100 and pg_temp.del_area('sc_mtz') ->> 'estado' = 'TERMINADO',
  'el subcontrato terminado sale al 100 %');
reset role;

-- La función no la llama quien no inició sesión.
select test.afirmar(not has_function_privilege('anon', 'public.registrar_reportes_diarios(date, text, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.subcontratos_del_area()', 'execute'),
  'anon no ejecuta ninguna de las dos');

select 'CHECK 403 OK' as resultado;
rollback;
