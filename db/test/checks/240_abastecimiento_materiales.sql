-- El material de Diseño debe recorrer el circuito completo sin perder área,
-- cantidad ni responsable: solicitud, compra, recepción y despacho parcial.
-- Se prueba cada RPC con el rol real y se revierte toda la fixture.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
values ('20100000019', 'PRUEBAS ABASTECIMIENTO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Dina', 'Rojas', 'dina@demo.pe', 'DISENO', (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Ciro', 'Luna', 'ciro@demo.pe', 'COMPRADOR', (select id from public.sedes limit 1)) as comprador_id \gset
select test.crear_usuario('Alma', 'Vera', 'alma@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen_id \gset
select test.crear_usuario('Mario', 'Paz', 'mario@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as mtz_id \gset
select test.crear_usuario('Sonia', 'Rey', 'sonia@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as acb_id \gset

update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'mtz_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'ACB') where id = :'acb_id';

insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C.');
insert into public.unidades_medida (codigo, nombre) values ('KG', 'Kilogramo') on conflict do nothing;
insert into public.categorias_material (codigo, nombre) values ('GEN', 'General') on conflict do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select 'PL-6', 'Plancha LAC 6 mm',
       (select id from public.categorias_material where codigo = 'GEN'),
       (select id from public.unidades_medida where codigo = 'KG')
on conflict (codigo) do nothing;

insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
select (select id from public.clientes where numero_documento = '20607761907'),
       (select id from public.sedes where codigo = 'T1'),
       'Tolva de prueba del circuito de abastecimiento';
select set_config('prueba.orden', (select id::text from public.ordenes_trabajo
  where descripcion = 'Tolva de prueba del circuito de abastecimiento' limit 1), true);
select set_config('prueba.material', (select id::text from public.materiales where codigo = 'PL-6'), true);

-- Diseño registra la línea y la envía a Maestranza.
select test.como_usuario(:'diseno_id');
set local role authenticated;
insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
values (current_setting('prueba.orden')::uuid, current_setting('prueba.material')::uuid, 10, 'MTZ');
select set_config('prueba.ot_material', (select id::text from public.ot_materiales
  where orden_id = current_setting('prueba.orden')::uuid), true);
select set_config('prueba.requerimiento', public.crear_requerimiento_material(
  current_setting('prueba.orden')::uuid, 'MTZ', array[current_setting('prueba.ot_material')::uuid])::text, true);
reset role;
select set_config('prueba.req_linea', (select id::text from public.requerimiento_material_detalles
  where requerimiento_id = current_setting('prueba.requerimiento')::uuid), true);
select set_config('prueba.receptor', :'mtz_id', true);
select set_config('prueba.receptor_otro_area', :'acb_id', true);

-- Compras solo registra hasta la cantidad solicitada.
select test.como_usuario(:'comprador_id');
set local role authenticated;
select test.debe_fallar(
  'insert into public.ordenes_compra_materiales default values',
  'Compras registra mediante el RPC validado, no con DML directo',
  'permission denied');
select set_config('prueba.compra', public.crear_orden_compra_material(
  gen_random_uuid(), current_setting('prueba.requerimiento')::uuid,
  'Proveedor de prueba', 'OC-PRUEBA-001',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.req_linea')::uuid, 'cantidad', 10)),
  current_date + 7)::text, true);

do $$
declare v_rechazado boolean := false;
begin
  begin
    perform public.crear_orden_compra_material(
      gen_random_uuid(), current_setting('prueba.requerimiento')::uuid,
      'Proveedor de prueba', 'OC-PRUEBA-EXCESO',
      jsonb_build_array(jsonb_build_object('id', current_setting('prueba.req_linea')::uuid, 'cantidad', 1)),
      current_date + 7);
  exception when check_violation then v_rechazado := true; end;
  perform test.afirmar(v_rechazado, 'Compras no puede pedir más de lo requerido');
end $$;
reset role;
select set_config('prueba.compra_linea', (select id::text from public.orden_compra_material_detalles
  where orden_compra_id = current_setting('prueba.compra')::uuid), true);

-- Almacén puede recibir parcialmente, pero nunca superar el saldo de compra.
select test.como_usuario(:'almacen_id');
set local role authenticated;
select test.debe_fallar(
  'update public.movimientos_materiales set cantidad = 1',
  'El kardex no se puede editar directamente',
  'permission denied');
select set_config('prueba.ingreso', gen_random_uuid()::text, true);
select public.registrar_recepcion_material(current_setting('prueba.ingreso')::uuid,
  current_setting('prueba.compra_linea')::uuid, 6, 'GUIA-PRUEBA-001');
do $$
declare v_rechazado boolean := false;
begin
  begin
    perform public.registrar_recepcion_material(gen_random_uuid(),
      current_setting('prueba.compra_linea')::uuid, 5, 'GUIA-PRUEBA-EXCESO');
  exception when check_violation then v_rechazado := true; end;
  perform test.afirmar(v_rechazado, 'Almacén no puede recibir más de lo pendiente de compra');
end $$;

-- El despacho exige a una persona activa del área y descuenta stock.
select set_config('prueba.despacho', gen_random_uuid()::text, true);
select public.despachar_material(current_setting('prueba.despacho')::uuid,
  current_setting('prueba.req_linea')::uuid, 4, :'mtz_id');
select public.despachar_material(current_setting('prueba.despacho')::uuid,
  current_setting('prueba.req_linea')::uuid, 4, :'mtz_id');

do $$
declare v_rechazado boolean := false;
begin
  begin
    perform public.despachar_material(gen_random_uuid(),
      current_setting('prueba.req_linea')::uuid, 3, current_setting('prueba.receptor')::uuid);
  exception when check_violation then v_rechazado := true; end;
  perform test.afirmar(v_rechazado, 'No se puede despachar más de lo recibido');
  v_rechazado := false;
  begin
    perform public.despachar_material(gen_random_uuid(),
      current_setting('prueba.req_linea')::uuid, 1,
      current_setting('prueba.receptor_otro_area')::uuid);
  exception when check_violation then v_rechazado := true; end;
  perform test.afirmar(v_rechazado, 'El receptor debe pertenecer al área destino');
  perform test.afirmar(
    (select count(*) = 1 from public.movimientos_materiales
      where tipo = 'DESPACHO' and requerimiento_detalle_id = current_setting('prueba.req_linea')::uuid),
    'Reintentar con el mismo identificador no duplica el despacho');
  perform test.afirmar(
    (select cantidad_despachada = 4 and estado = 'EN_ALMACEN'
       from public.v_atencion_materiales where detalle_id = current_setting('prueba.req_linea')::uuid),
    'El reporte muestra despacho parcial y material todavía disponible');
  perform test.afirmar(
    (select existencia = 2 from public.v_existencias_materiales
      where material_id = current_setting('prueba.material')::uuid),
    'El saldo refleja seis recibidos menos cuatro entregados');
end $$;
reset role;

-- Supervisor de Acabados no puede leer ni solicitar material de Maestranza.
select test.como_usuario(:'acb_id');
set local role authenticated;
do $$
declare v_rechazado boolean := false;
begin
  perform test.afirmar(not exists (
    select 1 from public.requerimiento_material_detalles
     where id = current_setting('prueba.req_linea')::uuid),
    'Supervisor de Acabados no ve el detalle de Maestranza');
  perform test.afirmar(not exists (
    select 1 from public.v_ot_materiales
     where id = current_setting('prueba.ot_material')::uuid),
    'Supervisor de Acabados no ve la línea técnica de Maestranza');
  begin
    perform public.crear_requerimiento_material(current_setting('prueba.orden')::uuid,
      'MTZ', array[current_setting('prueba.ot_material')::uuid]);
  exception when insufficient_privilege then v_rechazado := true; end;
  perform test.afirmar(v_rechazado, 'Supervisor de Acabados no puede solicitar para Maestranza');
end $$;

rollback;
