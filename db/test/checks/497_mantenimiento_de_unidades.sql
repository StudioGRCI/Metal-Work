-- Mantenimiento de unidades (plan «Las demás áreas», entrega A.3, migración
-- 20261126996000 y 20261126996500): el puesto de Mantenimiento ve sus OT, pide
-- su RQ por el N.º de su OT y sube su reporte diario.
--
--   1. El puesto tiene los tres permisos y su área pide por el RQ de operación.
--   2. Ve las OT de mantenimiento aprobadas: no la borrador, la anulada, la de
--      garantía ni la de fabricación. No lee la tabla de órdenes.
--   3. Registra el RQ de operación de su área con el N.º de la OT; no para
--      otra área ni un RQ de Administración; anula el suyo y no el ajeno.
--   4. Sube su reporte diario por el N.º de la OT, con su propia gente (la de
--      planilla de taller de su área; la de oficina no), y la lista lo dice.
--   5. Requerimientos registra el ingreso del vehículo: la lista dice que está
--      en la planta.
--   6. Mantenimiento no da la OT por terminada; Administración sí, y pasa a
--      las terminadas.
--   7. Quien no tiene el permiso (Tesorería, la supervisión de Producción) no
--      ve la lista.
--   8. Lee los RQ de su área y ninguno de otra (el RQ, sus insumos, su
--      sustento, sus correcciones y las notas de sus salidas); el supervisor,
--      Requerimientos, Almacén y Tesorería siguen leyendo todos; sin área en
--      la cuenta, ninguno, y aun así no quita un justificante ya anotado.
--
-- Cada paso con el puesto que lo hace —nunca ADMIN— y `set local role
-- authenticated`. El armazón lo pone el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000497', 'PRUEBAS 497 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA497', 'Taller prueba 497') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA497' \gset
select test.crear_usuario('Ada', 'Admin', 'admin497@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Manu', 'Mantenimiento', 'mnt497@demo.pe', 'MANTENIMIENTO', :'sede_id') as mnt_id \gset
select test.crear_usuario('Reni', 'Requerimientos', 'req497@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm497@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Teo', 'Tesorería', 'tes497@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset
select test.crear_usuario('Sam', 'Supervisión', 'sup497@demo.pe', 'SUPERVISOR', :'sede_id') as sup_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh497@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('Aldo', 'Almacén', 'alm497@demo.pe', 'ALMACENERO', :'sede_id') as alm_id \gset

-- Armazón: las áreas de las cuentas, un cliente, una unidad con placa y sus OT.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MNT') where id = :'mnt_id';
do $$
begin
  -- Una sola supervisión activa por área: la que ya hubiera se aparta mientras dura la prueba.
  set local session_replication_role = replica;
  update public.usuarios u set activo = false
   where u.activo and u.rol_id = (select id from public.roles where codigo = 'SUPERVISOR')
     and u.area_id = (select id from public.areas where codigo = 'PRD');
  set local session_replication_role = origin;
end $$;
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'sup_id';
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000497', 'QA CLIENTE 497') returning id as cliente_id \gset
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.sede', :'sede_id', true);
create or replace function pg_temp.orden(p_numero text, p_unidad uuid, p_tipo text, p_estado text) returns uuid language sql as $$
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, fecha_entrega_comprometida)
  values (p_numero, current_setting('prueba.cliente')::uuid, p_unidad, current_setting('prueba.sede')::uuid,
          p_tipo::public.tipo_trabajo_ot, 'NORMAL', 'Prueba 497: cambio de bocinas y engrase', p_estado::public.estado_ot,
          ((now() at time zone 'America/Lima')::date + 10)) returning id;
$$;
insert into public.unidades (cliente_id, tipo_vehiculo, placa, marca, modelo, numero_chasis)
values (:'cliente_id', 'CAMION', 'QAA-497', 'Volvo', 'FH 497', '9BM497000AA000001') returning id as unidad_u \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK497_F_26/97', 'CAMION') returning id as unidad_f \gset
select pg_temp.orden('9497-2026', :'unidad_u', 'MANTENIMIENTO', 'APROBADA') as mant \gset
select pg_temp.orden('9498-2026', null, 'MANTENIMIENTO', 'APROBADA') as mant_sin \gset
select pg_temp.orden('9499-2026', null, 'MANTENIMIENTO', 'BORRADOR') as mant_borrador \gset
select pg_temp.orden('9500-2026', null, 'MANTENIMIENTO', 'APROBADA') as mant_anulada \gset
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se registró dos veces (prueba 497)' where id = :'mant_anulada';
select pg_temp.orden('9501-2026', :'unidad_f', 'GARANTIA', 'APROBADA') as garantia \gset
select pg_temp.orden('8497-2026', :'unidad_f', 'FABRICACION', 'APROBADA') as fabricacion \gset
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
  ('CHK497-GRA', 'Grasa de prueba 497',
   (select id from public.categorias_material where activo order by codigo limit 1),
   (select id from public.unidades_medida where codigo = 'UND')) returning id as material \gset

select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.mnt', :'mnt_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.adm', :'adm_id', true);
select set_config('prueba.tes', :'tes_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.alm', :'alm_id', true);
select set_config('prueba.mant', :'mant', true);
select set_config('prueba.mant_sin', :'mant_sin', true);
select set_config('prueba.material', :'material', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
do $$
declare v text;
begin
  foreach v in array array['rq1', 'rq2', 'rq3', 'rq4', 'rq5', 'rep', 'rep2', 'veh', 'veh2', 'juan', 'lucia'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
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
create or replace function pg_temp.lineas(p_cantidad numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.material'), 'cantidad', p_cantidad));
$$;
create or replace function pg_temp.area(p_codigo text) returns uuid language sql as $$
  select id from public.areas where codigo = p_codigo;
$$;
-- La foto ya subida a Storage por Requerimientos, en la carpeta del ingreso.
create or replace function pg_temp.foto(p_registro text, p_momento text) returns jsonb language plpgsql as $$
declare v_ruta text := current_setting('prueba.req') || '/' || current_setting('prueba.' || p_registro) || '/' || p_momento
                       || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-vehiculos', v_ruta, current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 150000}');
  return jsonb_build_array(v_ruta);
end $$;
grant execute on function pg_temp.como(text), pg_temp.id(text), pg_temp.txt(text), pg_temp.lineas(numeric), pg_temp.area(text),
  pg_temp.foto(text, text) to authenticated;

-- Producción ya reportó ayer un apoyo en la misma OT: ese reporte no es de
-- Mantenimiento, y su lista no lo cuenta. Por debajo: aquí no se prueba el
-- reporte de la supervisión.
do $$
begin
  set local session_replication_role = replica;
  insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
  values (pg_temp.txt('hoy')::date - 1, 'OT 9497-2026', 'Apoyo de soldadura',
          'Producción apoyó con una soldadura en el chasis.', pg_temp.area('PRD'), pg_temp.id('sup'));
  set local session_replication_role = origin;
end $$;

-- RR. HH. da de alta a la persona que va en el reporte.
do $$
declare v uuid;
begin
  perform pg_temp.como('rrhh');
  set local role authenticated;
  v := public.rrhh_guardar_trabajador(pg_temp.id('juan'), 'Juan', 'Mecánico', '70000497', 'Mecánico',
         pg_temp.area('MNT'), '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-97', null);
  v := public.rrhh_guardar_remuneracion_trabajador(pg_temp.id('juan'), 2400);
  perform public.rrhh_guardar_costo_trabajador(pg_temp.id('juan'), 2400);
  -- Y a una persona de oficina, que no va en ningún reporte.
  v := public.rrhh_guardar_trabajador(pg_temp.id('lucia'), 'Lucía', 'Contable', '70000498', 'Asistente contable',
         pg_temp.area('CON'), '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-98', null);
  reset role;
end $$;

-- ===================================================== 1. Los permisos del puesto
select test.afirmar(
  (select count(*) = 3 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where r.codigo = 'MANTENIMIENTO' and rp.permiso_codigo in ('mantenimiento.ots', 'requerimientos.area', 'reporte_diario.registrar')),
  '1. Mantenimiento tiene mantenimiento.ots, requerimientos.area y reporte_diario.registrar');
select test.afirmar(
  not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
               where r.codigo = 'MANTENIMIENTO' and rp.permiso_codigo in ('ordenes.ver', 'ordenes.listar', 'ordenes.editar', 'costos.ver')),
  '1. y sigue sin abrir la OT ni ver costos');
select test.afirmar((select requerimiento = 'OPERACION' from public.areas where codigo = 'MNT'),
  '1. el área de Mantenimiento pide por el requerimiento de operación');
select test.afirmar(
  (select array_agg(r.codigo order by r.codigo) = array['MANTENIMIENTO']
     from public.roles_permisos rp join public.roles r on r.id = rp.rol_id where rp.permiso_codigo = 'mantenimiento.ots'),
  '1. el permiso nuevo lo tiene solo Mantenimiento');

-- ===================================================== 2. Sus OT
select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar(
  (select array_agg(numero order by numero) = array['9497-2026', '9498-2026'] from public.mantenimiento_ots()),
  '2. Mantenimiento ve las dos OT de mantenimiento aprobadas, y no la borrador, la anulada, la de garantía ni la de fabricación');
select test.afirmar(
  (select codigo = 'OT 9497-2026' and cliente = 'QA CLIENTE 497' and placa = 'QAA-497' and vehiculo like '%Volvo FH 497%'
          and descripcion like 'Prueba 497%' and entrega = pg_temp.txt('hoy')::date + 10 and abierta and not en_planta
          and ingreso_en is null and terminada_en is null and ultimo_reporte is null and reportes = 0 and motivo_pausa is null
     from public.mantenimiento_ots() where numero = '9497-2026'),
  '2. con su código, su cliente, su placa, su vehículo, lo que hay que hacer y la fecha comprometida; abierta, sin vehículo todavía y sin contar el reporte que subió Producción');
select test.afirmar(
  (select cliente = 'QA CLIENTE 497' and placa is null and vehiculo is null from public.mantenimiento_ots() where numero = '9498-2026'),
  '2. la que no tiene unidad, con su cliente');
select test.afirmar((select count(*) = 0 from public.ordenes_trabajo),
  '2. la tabla de órdenes sigue cerrada para el puesto: no lee ninguna');
select test.afirmar(
  (select unidad = 'Mantenimiento · QAA-497 · Volvo FH 497' from public.codigos_internos_para_elegir() where codigo = 'OT 9497-2026'),
  '2. y el buscador de código le ofrece la OT por su número');

-- ===================================================== 3. Su RQ por el N.º de la OT
select public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.area('MNT'), 'OT 9497-2026',
  'Grasa para el engrase de la unidad', null, pg_temp.lineas(2));
-- El mismo envío repetido (la respuesta se perdió) no da otro RQ.
select public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.area('MNT'), 'OT 9497-2026',
  'Grasa para el engrase de la unidad', null, pg_temp.lineas(2));
select test.afirmar(
  (select count(*) = 1 and bool_and(estado = 'POR_ATENDER' and tipo = 'OPERACION' and creado_por = pg_temp.id('mnt')
                                    and area_id = pg_temp.area('MNT') and public.normalizar_codigo_interno(codigo_interno) = 'OT 9497-2026')
     from public.requerimientos where id = pg_temp.id('rq1')),
  '3. Mantenimiento registró el RQ de operación de su área con el N.º de la OT, y quedó por atender en Almacén');
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'OPERACION', %L, 'OT 9497-2026', 'Grasa pedida para Producción', null, %L)$q$,
                               pg_temp.id('rq2'), pg_temp.area('PRD'), pg_temp.lineas(1)),
                        '3. no registra un RQ para otra área', 'de otra área');
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'ADMINISTRACION', %L, 'OFICINA', 'Útiles para la oficina', null, %L)$q$,
                               pg_temp.id('rq2'), pg_temp.area('ADM'), pg_temp.lineas(1)),
                        '3. ni un RQ de Administración');
select test.debe_fallar(format($q$select public.emitir_requerimiento(%L, 'OPERACION', %L, 'OT 7777-2026', 'Grasa para una OT que no existe', null, %L)$q$,
                               pg_temp.id('rq2'), pg_temp.area('MNT'), pg_temp.lineas(1)),
                        '3. ni con el número de una OT que no existe');
reset role;
select test.afirmar(not exists (select 1 from public.requerimientos where id = pg_temp.id('rq2')), '3. los rechazados no dejaron RQ');

-- Requerimientos registra otro para el área de Mantenimiento: ese no es suyo.
select pg_temp.como('req');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq3'), 'OPERACION', pg_temp.area('MNT'), 'OT 9498-2026',
  'Grasa que Mantenimiento pidió por teléfono', null, pg_temp.lineas(1));
reset role;
select pg_temp.como('mnt');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento(%L, 'No era mío')$q$, pg_temp.id('rq3')),
                        '3. no anula el RQ que registró Requerimientos para su área', 'otra persona');
select public.emitir_requerimiento(pg_temp.id('rq4'), 'OPERACION', pg_temp.area('MNT'), 'PLANTA',
  'Grasa para el taller de mantenimiento', null, pg_temp.lineas(1));
select public.anular_requerimiento(pg_temp.id('rq4'), 'Prueba 497: se pidió dos veces');
select test.afirmar((select estado = 'ANULADO' from public.requerimientos where id = pg_temp.id('rq4')),
  '3. anula el suyo, con su motivo (también pide para PLANTA, que es de donde salen los repuestos de un equipo)');

-- ===================================================== 4. Su reporte diario
select test.afirmar((select count(*) = 0 from public.reporte_diario_opciones('OT 9497-2026', null, null)),
  '4. la OT de mantenimiento no tiene etapas ni planos: el reporte lleva los trabajos que se escriben');
select test.afirmar(
  (select count(*) = 1 and bool_and(area = 'Mantenimiento') from public.reporte_diario_personal_disponible() where id = pg_temp.id('juan')),
  '4. la lista de personal del reporte le ofrece a la gente de planilla de taller de Mantenimiento');
select test.afirmar(not exists (select 1 from public.reporte_diario_personal_disponible() where id = pg_temp.id('lucia')),
  '4. y no a la de oficina');
select test.debe_fallar(format($q$select public.registrar_reporte_diario(%L, %L, 'OT 9497-2026', 'Engrase', 'Engrase general.',
    '[{"descripcion": "Engrase general", "avance": 10, "personal": [{"trabajador_id": "%s", "horas": 2}]}]'::jsonb, null, null)$q$,
    pg_temp.id('rep2'), pg_temp.txt('hoy'), pg_temp.txt('lucia')),
  '4. la persona de oficina no va en el reporte', 'no va en el reporte diario');
select public.registrar_reporte_diario(pg_temp.id('rep'), pg_temp.txt('hoy')::date, 'OT 9497-2026', 'Engrase y bocinas',
  'Engrase general y cambio de bocinas del eje posterior.',
  format('[{"descripcion": "Engrase general", "avance": 50, "personal": [{"trabajador_id": "%s", "horas": 4}]}]', pg_temp.txt('juan'))::jsonb,
  null, null);
select test.afirmar(
  (select count(*) = 1 and bool_and(registrado_por = pg_temp.id('mnt') and area_id = pg_temp.area('MNT')
                                    and public.normalizar_codigo_interno(codigo_interno) = 'OT 9497-2026')
     from public.reportes_diarios where id = pg_temp.id('rep')),
  '4. Mantenimiento subió su reporte diario por el N.º de la OT, a nombre de su área');
select test.afirmar(
  (select ultimo_reporte = pg_temp.txt('hoy')::date and reportes = 1 from public.mantenimiento_ots() where numero = '9497-2026'),
  '4. y la lista de sus OT dice cuándo fue el último reporte de su área: uno, sin el de Producción');
select test.afirmar(
  (select ultimo_reporte is null and reportes = 0 from public.mantenimiento_ots() where numero = '9498-2026'),
  '4. la otra OT sigue sin reporte');
reset role;

-- ===================================================== 5. El vehículo entra
select pg_temp.como('req');
set local role authenticated;
select public.registrar_ingreso_vehiculo(pg_temp.id('veh'), 'QAA-497', null, null, 'Camión Volvo', '', 'MANTENIMIENTO', null, null,
  pg_temp.foto('veh', 'ingreso'), pg_temp.id('mant'));
reset role;
select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar(
  (select en_planta and ingreso_en is not null and salida_en is null and abierta from public.mantenimiento_ots() where numero = '9497-2026'),
  '5. cuando Requerimientos registra el ingreso, la lista dice que el vehículo está en la planta');
select test.afirmar(
  (select placa = 'QAA-497' and vehiculo like '%Volvo%FH 497%' from public.mantenimiento_ots() where numero = '9497-2026'),
  '5. la OT con unidad sigue con la placa y el vehículo de su unidad');
-- La OT sin unidad: la placa y el vehículo son los que se anotaron en su ingreso.
reset role;
select pg_temp.como('req');
set local role authenticated;
select public.registrar_ingreso_vehiculo(pg_temp.id('veh2'), 'QAB-498', null, null, 'Camioneta Toyota Hilux', '', 'MANTENIMIENTO', null, null,
  pg_temp.foto('veh2', 'ingreso'), pg_temp.id('mant_sin'));
reset role;
select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar(
  (select replace(placa, '-', '') = 'QAB498' and vehiculo = 'Camioneta Toyota Hilux' and en_planta from public.mantenimiento_ots() where numero = '9498-2026'),
  '5. la OT sin unidad toma la placa y el vehículo de su ingreso');

-- ===================================================== 6. Quién la da por terminada
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, 'Terminé')$q$, pg_temp.id('mant')),
  '6. Mantenimiento no da la OT por terminada', 'ordenes.editar');
reset role;
select pg_temp.como('adm');
set local role authenticated;
select public.dar_por_terminada_la_garantia(pg_temp.id('mant'), 'Engrase y bocinas hechos');
reset role;
select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar(
  (select not abierta and terminada_en is not null and en_planta from public.mantenimiento_ots() where numero = '9497-2026'),
  '6. Administración la da por terminada y pasa a las terminadas, con su fecha; el vehículo sigue en la planta hasta que sale');
select test.afirmar(
  (select array_agg(numero order by numero) = array['9498-2026'] from public.mantenimiento_ots() where abierta),
  '6. abierta queda solo la otra');
reset role;
-- La otra se termina dos días después: las terminadas van de la última a la más antigua.
do $$
begin
  set local session_replication_role = replica;
  update public.ot_garantia_terminada set terminada_en = terminada_en - interval '2 days' where orden_id = pg_temp.id('mant');
  set local session_replication_role = origin;
end $$;
select pg_temp.como('adm');
set local role authenticated;
select public.dar_por_terminada_la_garantia(pg_temp.id('mant_sin'), 'Cambio de aceite hecho');
reset role;
select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar(
  (select array_agg(t.numero order by t.orden) = array['9498-2026', '9497-2026']
     from public.mantenimiento_ots() with ordinality as t(a, numero, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, orden)),
  '6. las terminadas salen de la última a la más antigua');
reset role;
-- El administrador ve los reportes de todas las áreas en el mismo código.
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar((select reportes = 2 from public.mantenimiento_ots() where numero = '9497-2026'),
  '6. al administrador la lista le cuenta los reportes de todas las áreas');
reset role;

-- ===================================================== 7. Quien no tiene el permiso
select pg_temp.como('tes');
set local role authenticated;
select test.debe_fallar('select * from public.mantenimiento_ots()', '7. Tesorería no ve las OT de mantenimiento', 'No tienes permiso');
reset role;
select pg_temp.como('sup');
set local role authenticated;
select test.debe_fallar('select * from public.mantenimiento_ots()', '7. la supervisión de Producción tampoco', 'No tienes permiso');
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.mantenimiento_ots()', 'execute'),
  '7. y quien no entró no puede ni llamarla');

-- ===================================================== 8. Cada área lee sus RQ
-- La supervisión de Producción pide para su área con el mismo N.º de OT.
select pg_temp.como('sup');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq5'), 'OPERACION', pg_temp.area('PRD'), 'OT 9497-2026',
  'Soldadura para el apoyo en el chasis', null, pg_temp.lineas(3));
reset role;
-- Un sustento y una corrección en cada RQ, por debajo: aquí se prueba quién los lee.
do $$
begin
  set local session_replication_role = replica;
  insert into public.requerimiento_sustentos (requerimiento_linea_id, cantidad, exceso, sustento, sustentado_por)
  select l.id, 1, 1, 'Sustento de prueba 497 del exceso', pg_temp.id('req')
    from public.requerimiento_lineas l where l.requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5'));
  insert into public.correcciones (documento, documento_id, numero, motivo, antes, despues,
                                   justificante_ruta, justificante_nombre, justificante_mime, justificante_tamano, corregido_por)
  select 'REQUERIMIENTO', r.id, r.numero, 'Corrección de prueba 497', '{}', '{}',
         'prueba/497/' || r.id || '.pdf', 'sustento.pdf', 'application/pdf', 1000, pg_temp.id('req')
    from public.requerimientos r where r.id in (pg_temp.id('rq1'), pg_temp.id('rq5'));
  -- Y una salida de cada uno que «no llegó», con su nota.
  insert into public.movimientos_materiales (id, tipo, origen, cantidad, material_id, registrado_por,
                                             documento_referencia, recibido_por_nombre, codigo_unidad,
                                             requerimiento_linea_id, foto_ruta)
  select md5('mov497' || l.requerimiento_id::text)::uuid, 'SALIDA', 'SALIDA_GENERAL', 1, l.material_id, pg_temp.id('req'),
         'PRUEBA-497', 'Juan Mecánico', 'OT 9497-2026', l.id, 'prueba/497/salida-' || l.requerimiento_id || '.jpg'
    from public.requerimiento_lineas l where l.requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5'));
  insert into public.conformidad_salidas (movimiento_id, requerimiento_id, requerimiento_linea_id, tipo, nota, registrado_por)
  select md5('mov497' || l.requerimiento_id::text)::uuid, l.requerimiento_id, l.id, 'NO_LLEGO', 'Prueba 497: la salida no llegó', pg_temp.id('req')
    from public.requerimiento_lineas l where l.requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5'));
  set local session_replication_role = origin;
end $$;

select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar(
  (select count(*) = 3 and bool_and(area_id = pg_temp.area('MNT')) from public.requerimientos)
  and (select count(*) = 0 from public.requerimientos where id = pg_temp.id('rq5')),
  '8. Mantenimiento lee los tres RQ de su área (los dos suyos y el que le registró Requerimientos) y no el de Producción');
select test.afirmar(
  (select count(*) = 1 from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq1'))
  and (select count(*) = 0 from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq5'))
  and not exists (select 1 from public.requerimiento_lineas l
                   where l.requerimiento_id not in (pg_temp.id('rq1'), pg_temp.id('rq3'), pg_temp.id('rq4'))),
  '8. ni sus insumos: lee los de sus RQ');
select test.afirmar(
  (select count(*) = 1 from public.requerimiento_sustentos)
  and (select count(*) = 1 and bool_and(documento_id = pg_temp.id('rq1')) from public.correcciones),
  '8. ni su sustento ni sus correcciones: lee los de su RQ');
select test.afirmar(
  (select count(*) = 1 and bool_and(requerimiento_id = pg_temp.id('rq1')) from public.conformidad_salidas)
  and (select count(*) = 1 and bool_and(requerimiento_id = pg_temp.id('rq1')) from public.notas_de_conformidad())
  and (select count(*) = 0 from public.notas_de_conformidad(array[pg_temp.id('rq5')]))
  and (select count(*) = 1 from public.notas_de_conformidad(null, true)),
  '8. ni las notas de sus salidas: la tabla y la lista de notas le dan la de su RQ, también pidiendo las abiertas o la del RQ ajeno por su id');
-- Las funciones que reciben ids (20261126996500): con el id del RQ de Producción
-- no contestan nada; con el suyo, sí. Y juntos, solo el suyo.
select test.afirmar(
  (select count(*) = 0 from public.avance_de_requerimientos(array[pg_temp.id('rq5')]))
  and (select count(*) = 0 from public.entregado_de_requerimientos(array[pg_temp.id('rq5')]))
  and (select count(*) = 0 from public.metrado_de_requerimientos(array[pg_temp.id('rq5')]))
  and (select count(*) = 0 from public.recorrido_de_requerimientos(array[pg_temp.id('rq5')]))
  and (select count(*) = 0 from public.salidas_de_requerimientos(array[pg_temp.id('rq5')])),
  '8. con el id del RQ de Producción, el avance, lo entregado, el metrado, el recorrido y las salidas no le contestan nada');
select test.afirmar(
  (select count(*) = 1 and bool_and(requerimiento_id = pg_temp.id('rq1')) from public.avance_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(*) >= 1 and bool_and(requerimiento_id = pg_temp.id('rq1')) from public.entregado_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(*) >= 1 and bool_and(documento = pg_temp.id('rq1')) from public.recorrido_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(*) = 1 and bool_and(requerimiento_id = pg_temp.id('rq1')) from public.salidas_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(*) = 1 and bool_and(requerimiento_id = pg_temp.id('rq1')) from public.metrado_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')])),
  '8. y con los dos ids, solo lo del suyo (también el metrado)');
select test.afirmar(
  public.foto_de_salida_de_requerimiento(md5('mov497' || pg_temp.txt('rq5'))::uuid) is null
  and not public.es_foto_de_salida_de_requerimiento('prueba/497/salida-' || pg_temp.txt('rq5') || '.jpg')
  and public.foto_de_salida_de_requerimiento(md5('mov497' || pg_temp.txt('rq1'))::uuid) = 'prueba/497/salida-' || pg_temp.txt('rq1') || '.jpg'
  and public.es_foto_de_salida_de_requerimiento('prueba/497/salida-' || pg_temp.txt('rq1') || '.jpg'),
  '8. ni la foto de la salida del RQ de Producción; la de la suya, sí');
reset role;

select pg_temp.como('sup');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 from public.requerimientos where id in (pg_temp.id('rq1'), pg_temp.id('rq5')))
  and (select count(*) = 2 from public.requerimiento_lineas where requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5')))
  and (select count(*) = 2 from public.correcciones where documento_id in (pg_temp.id('rq1'), pg_temp.id('rq5'))),
  '8. el supervisor de Producción sigue leyendo los RQ de todas las áreas (requerimientos.ver), como antes');
select test.afirmar((select count(*) = 2 from public.notas_de_conformidad(array[pg_temp.id('rq1'), pg_temp.id('rq5')])),
  '8. y las notas de sus salidas');
select test.afirmar(
  (select count(*) = 2 from public.avance_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(distinct documento) = 2 from public.recorrido_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(*) = 2 from public.salidas_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(distinct requerimiento_id) = 2 from public.entregado_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(distinct requerimiento_id) = 2 from public.metrado_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and public.foto_de_salida_de_requerimiento(md5('mov497' || pg_temp.txt('rq1'))::uuid) is not null
  and public.es_foto_de_salida_de_requerimiento('prueba/497/salida-' || pg_temp.txt('rq5') || '.jpg'),
  '8. y el avance, lo entregado, el metrado, el recorrido, las salidas y la foto de los dos, por su id');
reset role;
select pg_temp.como('req');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 from public.requerimientos where id in (pg_temp.id('rq1'), pg_temp.id('rq5')))
  and (select count(*) = 2 from public.requerimiento_sustentos s join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
        where l.requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5'))),
  '8. y Requerimientos también');
reset role;
select pg_temp.como('tes');
set local role authenticated;
select test.afirmar((select count(*) = 2 from public.requerimientos where id in (pg_temp.id('rq1'), pg_temp.id('rq5'))),
  '8. y quien los consulta (requerimientos.ver)');
reset role;
select pg_temp.como('alm');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 from public.requerimientos where id in (pg_temp.id('rq1'), pg_temp.id('rq5')))
  and (select count(*) = 2 from public.requerimiento_lineas where requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5')))
  and (select count(*) = 2 from public.conformidad_salidas where requerimiento_id in (pg_temp.id('rq1'), pg_temp.id('rq5')))
  and (select count(*) = 2 from public.notas_de_conformidad(array[pg_temp.id('rq1'), pg_temp.id('rq5')])),
  '8. y Almacén, que los atiende: los RQ, sus insumos y las notas de sus salidas');
reset role;

-- Sin área en la cuenta no hay «los de su área»: no lee ninguno.
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = null where id = :'mnt_id';
-- El justificante de la corrección de su RQ, que subió su cuenta: ya está anotado.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('justificantes-correccion', 'prueba/497/' || pg_temp.txt('rq1') || '.pdf', :'mnt_id', '{"mimetype": "application/pdf", "size": 1000}');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('justificantes-correccion', 'prueba/497/suelto.pdf', :'mnt_id', '{"mimetype": "application/pdf", "size": 1000}');
select pg_temp.como('mnt');
set local role authenticated;
select test.afirmar((select count(*) = 0 from public.requerimientos) and (select count(*) = 0 from public.requerimiento_lineas)
                    and (select count(*) = 0 from public.correcciones),
  '8. una cuenta sin área, con requerimientos.area, no lee ningún RQ');
select test.afirmar(
  (select count(*) = 0 from public.avance_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and (select count(*) = 0 from public.salidas_de_requerimientos(array[pg_temp.id('rq1'), pg_temp.id('rq5')]))
  and public.foto_de_salida_de_requerimiento(md5('mov497' || pg_temp.txt('rq1'))::uuid) is null,
  '8. ni por las funciones que reciben ids');
-- Ya no ve la corrección, y aun así no puede quitar su justificante: «ninguna
-- fila lo nombra» se pregunta por encima del RLS. El suelto sí lo quita.
delete from storage.objects where bucket_id = 'justificantes-correccion' and name like 'prueba/497/%';
reset role;
select test.afirmar(
  exists (select 1 from storage.objects where bucket_id = 'justificantes-correccion' and name = 'prueba/497/' || pg_temp.txt('rq1') || '.pdf')
  and not exists (select 1 from storage.objects where bucket_id = 'justificantes-correccion' and name = 'prueba/497/suelto.pdf'),
  '8. y no quita de Storage el justificante de una corrección que ya no ve; el que ninguna corrección nombra, sí');

-- Las dos listas dicen lo mismo salvo requerimientos.area: si una cambia, cambia la otra.
select test.afirmar(
  (select regexp_replace(replace(a.prosrc, $q$ or public.tiene_permiso('requerimientos.area')$q$, ''), '\s+', ' ', 'g')
        = regexp_replace(b.prosrc, '\s+', ' ', 'g')
     from pg_proc a, pg_proc b
    where a.oid = 'public.puede_ver_requerimientos()'::regprocedure
      and b.oid = 'public.puede_ver_todos_los_requerimientos()'::regprocedure),
  '8. puede_ver_todos_los_requerimientos() es puede_ver_requerimientos() sin requerimientos.area');
-- Y solo Mantenimiento tiene requerimientos.area sin requerimientos.ver: es a quien acota.
select test.afirmar(
  (select array_agg(r.codigo order by r.codigo) = array['MANTENIMIENTO']
     from public.roles r
    where exists (select 1 from public.roles_permisos x where x.rol_id = r.id and x.permiso_codigo = 'requerimientos.area')
      and not exists (select 1 from public.roles_permisos x where x.rol_id = r.id
                       and x.permiso_codigo in ('requerimientos.ver', 'requerimientos.emitir', 'requerimientos.administracion',
                                                'compras.crear', 'almacen.recibir', 'almacen.despachar'))),
  '8. el único puesto que lee solo los RQ de su área es Mantenimiento');

rollback;
