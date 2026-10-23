-- Los documentos numerados y la caja reconocen su mismo envío por todo lo que
-- se escribió (migración 20261023100000). La pantalla conserva el id al cerrar
-- y volver a abrir la ventana tras «No llegó la respuesta»: el mismo envío
-- devuelve el mismo documento, y otro envío de la misma persona con ese id dice
-- que el primero ya quedó, en vez de darse por registrado sin guardar lo
-- cambiado. El de otra persona con el mismo id sigue diciendo que ya existe.
--
-- Con las cuentas reales y `set local role authenticated`: Tesorería registra
-- en la caja, Logística emite la OC y la OS, Requerimientos el RQ, Almacén lo
-- revisa y Administración el subcontrato. El armazón (la OT de la OC agrupada)
-- lo pone el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000433', 'PRUEBAS MISMO ENVIO S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA433', 'Taller prueba 433') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['tesoreria:TESORERIA:TES', 'tesoreria2:TESORERIA:TES', 'comprador:COMPRADOR:LOG',
                           'comprador2:COMPRADOR:LOG', 'requerimientos:REQUERIMIENTOS:REQ', 'requerimientos2:REQUERIMIENTOS:REQ',
                           'almacenero:ALMACENERO:ALM', 'oficina:ADMINISTRACION:ADM', 'oficina2:ADMINISTRACION:ADM',
                           'admin:ADMIN:ADM'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 1) || '.433@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id, sede_id)
    select v_id, initcap(split_part(v, ':', 1)), 'Check 433', split_part(v, ':', 1) || '.433@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3)),
           (select id from public.sedes where codigo = 'QA433')
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || split_part(v, ':', 1), v_id::text, true);
  end loop;
  foreach v in array array['m1', 'm2', 't1', 't2', 'oc1', 'os1', 'rq1', 'rq2', 'rq3', 'rq4', 'oci', 'sc1', 'sub', 'ag1',
                           'ot', 'cot'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.ruc', (select '1071234433' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234433' || d) limit 1), true);

  -- El catálogo, los proveedores y las cuentas, como dueño de las tablas.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK433-DIS', 'Disco de corte (prueba 433)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK433-PER', 'Perno hexagonal (prueba 433)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.dis', (select id::text from public.materiales where codigo = 'CHK433-DIS'), true);
  perform set_config('prueba.per', (select id::text from public.materiales where codigo = 'CHK433-PER'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR'
                                     order by codigo limit 1), true);
  -- Dos RUC 20 con su dígito de control bien puesto, sacados del validador.
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select (select '2099943300' || d from generate_series(0, 9) d where public.ruc_es_valido('2099943300' || d) limit 1),
         'Proveedor uno 433', 'Av. Argentina 433, Lima', '999 433 001'
  union all
  select (select '2099943301' || d from generate_series(0, 9) d where public.ruc_es_valido('2099943301' || d) limit 1),
         'Proveedor dos 433', 'Av. Argentina 434, Lima', '999 433 002';
  perform set_config('prueba.prov', (select id::text from public.proveedores where razon_social = 'PROVEEDOR UNO 433'), true);
  perform set_config('prueba.prov2', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DOS 433'), true);
  perform set_config('prueba.pen', test.crear_caja('PEN')::text, true);
  perform set_config('prueba.pen2', test.crear_caja('PEN')::text, true);
  perform set_config('prueba.usd', test.crear_caja('USD')::text, true);
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

-- ============================================ 1. La caja diaria
create or replace function pg_temp.movimiento(p_monto numeric, p_desc text, p_codigo text, p_op text) returns text language sql as $$
  select format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', %s, %L, %L, %L, null)',
                current_setting('prueba.m1'), current_setting('prueba.pen'), current_setting('prueba.hoy'), p_monto, p_desc, p_codigo, p_op);
$$;
create or replace function pg_temp.transferencia(p_id text, p_destino text, p_monto numeric, p_monto_destino numeric, p_desc text)
returns text language sql as $$
  select format('select public.registrar_transferencia_caja(%L, %L, %L, %L, %s, %s, %L, null)',
                current_setting('prueba.' || p_id), current_setting('prueba.pen'), current_setting('prueba.' || p_destino),
                current_setting('prueba.hoy'), p_monto, coalesce(p_monto_destino::text, 'null'), p_desc);
$$;
create or replace function pg_temp.correr(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return v;
end $$;

select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.correr(pg_temp.movimiento(250, 'Flete de prueba 433', ' pla_sr_04 ', ' 0099 '));
select test.afirmar(pg_temp.correr(pg_temp.movimiento(250, 'Flete   de prueba 433', 'PLA_SR_04', '0099')) = pg_temp.txt('m1'),
  'el mismo movimiento repetido (espacios y mayúsculas aparte) devuelve el mismo');
select test.debe_fallar(pg_temp.movimiento(260, 'Flete de prueba 433', 'PLA_SR_04', '0099'),
  'otro monto con el mismo id dice que el primero ya quedó', 'Este movimiento ya quedó registrado la primera vez que lo enviaste');
select test.debe_fallar(pg_temp.movimiento(250, 'Flete de otra cosa 433', 'PLA_SR_04', '0099'),
  'otra descripción con el mismo id tampoco se da por registrada', 'ya quedó registrado la primera vez');
select test.debe_fallar(pg_temp.movimiento(250, 'Flete de prueba 433', 'PLA_SR_05', '0099'),
  'otro código con el mismo id tampoco', 'ya quedó registrado la primera vez');
select test.afirmar((select count(*) = 1 and min(monto) = 250 and min(codigo_interno) = 'PLA_SR_04'
                       from public.movimientos_caja where id = pg_temp.id('m1')),
  'queda un solo movimiento, con lo de la primera vez');

select pg_temp.correr(pg_temp.transferencia('t1', 'pen2', 400, null, 'Para la caja chica 433'));
select test.afirmar(pg_temp.correr(pg_temp.transferencia('t1', 'pen2', 400, 999, 'Para la caja chica 433')) = pg_temp.txt('t1'),
  'la misma transferencia repetida devuelve la misma, aunque llegue un monto de destino que en la misma moneda no cuenta');
select test.debe_fallar(pg_temp.transferencia('t1', 'pen2', 450, null, 'Para la caja chica 433'),
  'otro monto en la transferencia con el mismo id dice que ya quedó', 'Esta transferencia ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(pg_temp.transferencia('t1', 'usd', 400, 100, 'Para la caja chica 433'),
  'otra cuenta de destino tampoco se da por registrada', 'ya quedó registrada la primera vez');
select pg_temp.correr(pg_temp.transferencia('t2', 'usd', 3750, 1000, 'Compra de dólares 433'));
select test.afirmar(pg_temp.correr(pg_temp.transferencia('t2', 'usd', 3750, 1000, 'Compra de dólares 433')) = pg_temp.txt('t2'),
  'la compra de dólares repetida devuelve la misma');
select test.debe_fallar(pg_temp.transferencia('t2', 'usd', 3750, 1010, 'Compra de dólares 433'),
  'entre monedas, otro monto de destino ya no es el mismo envío', 'ya quedó registrada la primera vez');
select test.afirmar((select count(*) from public.movimientos_caja where origen_id in (pg_temp.id('t1'), pg_temp.id('t2'))) = 4
                    and (select monto from public.movimientos_caja where origen_id = pg_temp.id('t1') and tipo = 'EGRESO') = 400,
  'cada transferencia queda con sus dos movimientos de la primera vez');
reset role;

select pg_temp.como('tesoreria2');
set local role authenticated;
select test.debe_fallar(pg_temp.movimiento(250, 'Flete de prueba 433', 'PLA_SR_04', '0099'),
  'el mismo id desde otra cuenta de Tesorería no es su envío', 'Este movimiento ya existe con otros datos');
select test.debe_fallar(pg_temp.transferencia('t1', 'pen2', 400, null, 'Para la caja chica 433'),
  'ni la transferencia', 'Esta transferencia ya existe con otros datos');
reset role;

-- ============================================ 2. La OC directa, con su comprobante
create or replace function pg_temp.directa(p_prov text, p_referencia text, p_precio numeric, p_dias integer, p_factura boolean, p_codigo text)
returns text language sql as $$
  select format('select public.emitir_compra_directa(%L, %L, %L, ''Reposición del almacén 433'', %L, %L, %L, %s, ''PEN'', %L, %L)',
    current_setting('prueba.oc1'), current_setting('prueba.' || p_prov), p_referencia,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.dis'), 'cantidad', 5, 'precio', p_precio),
                      jsonb_build_object('material_id', current_setting('prueba.per'), 'cantidad', 50, 'precio', 0.4)),
    current_setting('prueba.hoy'), case when p_dias = 0 then 'CONTADO' else 'CREDITO' end, p_dias, p_factura, p_codigo);
$$;

select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.correr(pg_temp.directa('prov', 'Cot. 433', 12, 0, true, 'PLANTA'));
select test.afirmar(pg_temp.correr(pg_temp.directa('prov', ' Cot. 433 ', 12, 0, true, ' PLANTA ')) = pg_temp.txt('oc1'),
  'la misma OC repetida devuelve la misma');
select test.debe_fallar(pg_temp.directa('prov', 'Cot. 433-B', 12, 0, true, 'PLANTA'),
  'otra referencia con el mismo id dice que la primera ya quedó', 'Esta orden de compra ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(pg_temp.directa('prov', 'Cot. 433', 12, 30, true, 'PLANTA'),
  'otro plazo de pago tampoco se da por registrado', 'ya quedó registrada la primera vez');
select test.debe_fallar(pg_temp.directa('prov', 'Cot. 433', 13, 0, true, 'PLANTA'),
  'otro precio tampoco', 'ya quedó registrada la primera vez');
select test.debe_fallar(pg_temp.directa('prov', 'Cot. 433', 12, 0, false, 'PLANTA'),
  'sin factura en el reintento ya no es el mismo envío', 'ya quedó registrada la primera vez');
select test.debe_fallar(pg_temp.directa('prov', 'Cot. 433', 12, 0, true, 'OFICINA'),
  'otro código interno tampoco', 'ya quedó registrada la primera vez');
select test.afirmar((select count(*) = 1 and bool_and(con_factura) and min(codigo_interno) = 'PLANTA' and min(referencia) = 'Cot. 433'
                            and min(dias_credito) = 0
                       from public.ordenes_compra_materiales where id = pg_temp.id('oc1')),
  'queda una sola OC, con su comprobante, su código y su referencia de la primera vez');
reset role;

select pg_temp.como('comprador2');
set local role authenticated;
select test.debe_fallar(pg_temp.directa('prov', 'Cot. 433', 12, 0, true, 'PLANTA'),
  'el mismo id desde otra cuenta de Logística no es su envío', 'Esta compra ya existe con otros datos');
reset role;

-- ============================================ 3. La OS
create or replace function pg_temp.os(p_fin text, p_detraccion text, p_referencia text) returns text language sql as $$
  select format('select public.emitir_orden_servicio(%L, %L, null, %L, ''PLANTA'', ''Arenado y fondo del chasis completo'', %L, %L, %L, ''PEN'', 1200, ''CONTADO'', 0, %L, %L)',
    current_setting('prueba.os1'), current_setting('prueba.prov'), (select id from public.areas where codigo = 'ACB'),
    p_referencia, current_setting('prueba.hoy'), p_fin, p_detraccion,
    case when p_detraccion = 'NO_SUJETA' then 'El proveedor no cobra IGV' end);
$$;

select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.correr(pg_temp.os(current_setting('prueba.hoy'), '025', 'Cot. OS 433'));
select test.afirmar(pg_temp.correr(pg_temp.os(current_setting('prueba.hoy'), '025', ' Cot. OS 433 ')) = pg_temp.txt('os1'),
  'la misma OS repetida devuelve la misma');
select test.debe_fallar(pg_temp.os(((now() at time zone 'America/Lima')::date + 5)::text, '025', 'Cot. OS 433'),
  'otra fecha de término con el mismo id dice que la primera ya quedó', 'Esta orden de servicio ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(pg_temp.os(current_setting('prueba.hoy'), 'NO_SUJETA', 'Cot. OS 433'),
  'otra detracción tampoco se da por registrada', 'ya quedó registrada la primera vez');
select test.debe_fallar(pg_temp.os(current_setting('prueba.hoy'), '025', 'Otra cotización'),
  'otra referencia tampoco', 'ya quedó registrada la primera vez');
select test.afirmar((select count(*) = 1 and min(detraccion_codigo) = '025' and min(referencia) = 'Cot. OS 433'
                       from public.ordenes_servicio where id = pg_temp.id('os1')),
  'queda una sola OS, con lo de la primera vez');
reset role;

select pg_temp.como('comprador2');
set local role authenticated;
select test.debe_fallar(pg_temp.os(current_setting('prueba.hoy'), '025', 'Cot. OS 433'),
  'la misma OS desde otra cuenta de Logística no es su envío', 'Esta orden de servicio ya existe con otros datos');
reset role;

-- ============================================ 4. El RQ, con un insumo del catálogo y uno nuevo
create or replace function pg_temp.rq(p_rq text, p_fecha text, p_lineas jsonb) returns text language sql as $$
  select format('select public.emitir_requerimiento(%L, ''OPERACION'', %L, ''PLANTA'', ''Insumos para la prueba 433 del mismo envío'', %L, %L)',
    current_setting('prueba.' || p_rq), (select id from public.areas where codigo = 'MTZ'), p_fecha, p_lineas);
$$;
create or replace function pg_temp.lineas(p_cantidad numeric, p_nuevo text) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('material_id', current_setting('prueba.dis'), 'cantidad', p_cantidad),
    jsonb_build_object('nuevo', true, 'descripcion', p_nuevo, 'cantidad', '2.5',
                       'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')));
$$;

select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.correr(pg_temp.rq('rq1', null, pg_temp.lineas(3, 'Lija al agua grano 400 (prueba 433)')));
select test.afirmar(pg_temp.correr(pg_temp.rq('rq1', null, pg_temp.lineas(3, '  Lija al agua grano 400 (prueba 433) '))) = pg_temp.txt('rq1'),
  'el mismo RQ repetido devuelve el mismo');
select test.debe_fallar(pg_temp.rq('rq1', null, pg_temp.lineas(4, 'Lija al agua grano 400 (prueba 433)')),
  'otra cantidad con el mismo id dice que el primero ya quedó', 'Este requerimiento ya quedó registrado la primera vez que lo enviaste');
select test.debe_fallar(pg_temp.rq('rq1', null, pg_temp.lineas(3, 'Lija al agua grano 600 (prueba 433)')),
  'otro material nuevo tampoco se da por registrado', 'ya quedó registrado la primera vez');
select test.debe_fallar(pg_temp.rq('rq1', current_setting('prueba.hoy'), pg_temp.lineas(3, 'Lija al agua grano 400 (prueba 433)')),
  'otra fecha en que se necesita tampoco', 'ya quedó registrado la primera vez');
select test.debe_fallar(pg_temp.rq('rq1', null, pg_temp.lineas(3, 'Lija al agua grano 400 (prueba 433)')
                                                  || jsonb_build_array(jsonb_build_object('material_id', pg_temp.txt('per'), 'cantidad', 1))),
  'un insumo más tampoco', 'ya quedó registrado la primera vez');
select test.afirmar((select count(*) = 2 and min(cantidad) = 2.5 and max(cantidad) = 3
                       from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq1')),
  'queda un solo RQ, con sus dos insumos de la primera vez');
-- El material nuevo escrito como uno del catálogo es ese material: el reintento igual se reconoce.
select pg_temp.correr(pg_temp.rq('rq2', null, jsonb_build_array(jsonb_build_object('nuevo', true, 'descripcion', 'Perno hexagonal (prueba 433)',
  'cantidad', 6, 'unidad_medida_id', pg_temp.txt('und'), 'categoria_id', pg_temp.txt('cat')))));
select test.afirmar((select material_id = pg_temp.id('per') and not material_nuevo
                       from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq2')),
  'el perno escrito a mano queda como el del catálogo');
select test.afirmar(pg_temp.correr(pg_temp.rq('rq2', null, jsonb_build_array(jsonb_build_object('nuevo', true,
  'descripcion', 'perno  hexagonal (prueba 433)', 'cantidad', 6, 'unidad_medida_id', pg_temp.txt('und'),
  'categoria_id', pg_temp.txt('cat'))))) = pg_temp.txt('rq2'),
  'y su reintento, escrito igual, devuelve el mismo RQ');
reset role;

select pg_temp.como('requerimientos2');
set local role authenticated;
select test.debe_fallar(pg_temp.rq('rq1', null, pg_temp.lineas(3, 'Lija al agua grano 400 (prueba 433)')),
  'el mismo RQ desde otra cuenta de Requerimientos no es su envío', 'Este requerimiento ya existe con otros datos');
reset role;

-- ============================================ 5. La OC de insumos de dos RQ de códigos distintos
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq3'), 'OPERACION', (select id from public.areas where codigo = 'MTZ'), 'CHK433-A',
  'Discos para la unidad A de la prueba 433', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.txt('dis'), 'cantidad', 2)));
select public.emitir_requerimiento(pg_temp.id('rq4'), 'OPERACION', (select id from public.areas where codigo = 'MTZ'), 'CHK433-B',
  'Discos para la unidad B de la prueba 433', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.txt('dis'), 'cantidad', 3)));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(pg_temp.id('rq3'), '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(pg_temp.id('rq4'), '[{"item": 1, "en_stock": 0}]', null);
reset role;
create or replace function pg_temp.de_insumos(p_precio numeric, p_factura boolean) returns text language sql as $$
  select format('select public.emitir_compra_de_requerimientos(%L, %L, %L, ''Cot. insumos 433'', null, ''CONTADO'', 0, ''PEN'', %L)',
    current_setting('prueba.oci'),
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.dis'), 'cantidad', 5, 'precio', p_precio,
      'insumos', jsonb_build_array(
        (select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq3')::uuid),
        (select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq4')::uuid)))),
    current_setting('prueba.prov'), p_factura);
$$;
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.correr(pg_temp.de_insumos(11, true));
select test.afirmar((select codigo_interno is null from public.ordenes_compra_materiales where id = pg_temp.id('oci')),
  'la OC de insumos de dos códigos no lleva código propio');
select test.afirmar(pg_temp.correr(pg_temp.de_insumos(11, true)) = pg_temp.txt('oci'),
  'su reintento igual devuelve la misma, aunque la orden no tenga código propio');
select test.debe_fallar(pg_temp.de_insumos(12, true),
  'otro precio con el mismo id dice que ya quedó', 'Esta orden de compra ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(pg_temp.de_insumos(11, false),
  'sin factura en el reintento tampoco', 'ya quedó registrada la primera vez');
select test.afirmar((select count(*) = 1 and bool_and(con_factura) from public.ordenes_compra_materiales where id = pg_temp.id('oci'))
                    and (select precio_unitario = 11 from public.orden_compra_material_detalles where orden_compra_id = pg_temp.id('oci')),
  'queda una sola OC de insumos, con lo de la primera vez');
reset role;

-- ============================================ 6. El subcontrato
create or replace function pg_temp.sc(p_desc text, p_fin text) returns text language sql as $$
  select format('select public.registrar_subcontrato(%L, %L, ''PLANTA'', %L, ''PEN'', 3000, %L, %L, ''PRD'')',
    current_setting('prueba.sc1'), current_setting('prueba.sub'), p_desc, current_setting('prueba.hoy'), p_fin);
$$;

select pg_temp.como('oficina');
set local role authenticated;
select public.guardar_subcontratista(pg_temp.id('sub'), pg_temp.txt('ruc'), 'Juan Pérez de la prueba 433', null, null, null, null, true);
select pg_temp.correr(pg_temp.sc('Soldadura de la tolva de la prueba 433', null));
select test.afirmar(pg_temp.correr(pg_temp.sc('  Soldadura de la tolva de la prueba 433 ', null)) = pg_temp.txt('sc1'),
  'el mismo subcontrato repetido devuelve el mismo');
select test.debe_fallar(pg_temp.sc('Soldadura y pintura de la tolva de la prueba 433', null),
  'otro trabajo con el mismo id dice que el primero ya quedó', 'Este subcontrato ya quedó registrado la primera vez que lo enviaste');
select test.debe_fallar(pg_temp.sc('Soldadura de la tolva de la prueba 433', current_setting('prueba.hoy')),
  'otra fecha de término tampoco se da por registrada', 'ya quedó registrado la primera vez');
select test.afirmar((select count(*) = 1 and min(descripcion) = 'Soldadura de la tolva de la prueba 433' and bool_and(fecha_fin is null)
                       from public.subcontratos where id = pg_temp.id('sc1')),
  'queda un solo subcontrato, con lo de la primera vez');
reset role;

select pg_temp.como('oficina2');
set local role authenticated;
select test.debe_fallar(pg_temp.sc('Soldadura de la tolva de la prueba 433', null),
  'el mismo subcontrato desde otra cuenta de Administración no es su envío', 'Este subcontrato ya existe con otros datos');
reset role;

-- ============================================ 7. La OC de atención de materiales (agrupada)
-- El armazón: una OT aprobada con un material que Diseño aprobó y Almacén derivó a compra.
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000433', 'Cliente prueba 433');
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
select pg_temp.id('cot'), 'QA-PDF-433', c.id, (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1),
       'POR_REVISAR', 'qa-433.pdf', 'cot/' || pg_temp.txt('cot') || '/qa-433.pdf', 'application/pdf', 120, pg_temp.id('comprador')
  from public.clientes c where c.numero_documento = '20990000433';
select pg_temp.como('admin');
set local role authenticated;
insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, cotizacion_pdf_id)
select pg_temp.id('ot'), 'QA-OT-433', c.id, (select id from public.sedes where codigo = 'QA433'), 'FABRICACION', 'NORMAL',
       'Prueba del mismo envío de la OC agrupada', 'APROBADA', pg_temp.id('cot')
  from public.clientes c where c.numero_documento = '20990000433';
reset role;
insert into public.ot_materiales (orden_id, material_id, cantidad, observacion, creado_por)
values (pg_temp.id('ot'), pg_temp.id('dis'), 4, 'Prueba 433', pg_temp.id('admin'));
insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por) values (pg_temp.id('ot'), 'MTZ', pg_temp.id('admin'));
insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
select r.id, m.id, 4 from public.requerimientos_materiales r, public.ot_materiales m
 where r.orden_id = pg_temp.id('ot') and m.orden_id = pg_temp.id('ot');
update public.requerimiento_material_detalles d
   set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0
  from public.requerimientos_materiales r
 where r.id = d.requerimiento_id and r.orden_id = pg_temp.id('ot');
select set_config('prueba.detalle', (select d.id::text from public.requerimiento_material_detalles d
  join public.requerimientos_materiales r on r.id = d.requerimiento_id where r.orden_id = pg_temp.id('ot')), true);

create or replace function pg_temp.agrupada(p_prov text, p_precio numeric, p_factura boolean) returns text language sql as $$
  select format('select public.emitir_compra_agrupada(%L, %L, ''Cot. agrupada 433'', %L, %L, ''CONTADO'', 0, ''PEN'', %L, ''PLANTA'')',
    current_setting('prueba.ag1'), current_setting('prueba.' || p_prov),
    jsonb_build_array(jsonb_build_object('id', current_setting('prueba.detalle'), 'cantidad', 4, 'precio', p_precio)),
    current_setting('prueba.hoy'), p_factura);
$$;

select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.correr(pg_temp.agrupada('prov', 20, true));
select test.afirmar(pg_temp.correr(pg_temp.agrupada('prov', 20, true)) = pg_temp.txt('ag1'),
  'la misma OC agrupada repetida devuelve la misma');
select test.debe_fallar(pg_temp.agrupada('prov2', 20, true),
  'otro proveedor con el mismo id dice que la primera ya quedó', 'Esta orden de compra ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(pg_temp.agrupada('prov', 21, true),
  'otro precio tampoco se da por registrado', 'ya quedó registrada la primera vez');
select test.debe_fallar(pg_temp.agrupada('prov', 20, false),
  'sin factura en el reintento tampoco', 'ya quedó registrada la primera vez');
select test.afirmar((select count(*) = 1 and bool_and(con_factura) and min(proveedor_id::text) = pg_temp.txt('prov')
                       from public.ordenes_compra_materiales where id = pg_temp.id('ag1')),
  'queda una sola OC agrupada, con lo de la primera vez');
reset role;

select pg_temp.como('comprador2');
set local role authenticated;
select test.debe_fallar(pg_temp.agrupada('prov2', 20, true),
  'otro proveedor desde otra cuenta de Logística dice que ya existe', 'Esta compra ya existe con otro proveedor');
select test.debe_fallar(pg_temp.agrupada('prov', 21, true),
  'otro precio desde otra cuenta de Logística dice que ya existe', 'Esta compra ya existe con otros datos');
reset role;

rollback;
