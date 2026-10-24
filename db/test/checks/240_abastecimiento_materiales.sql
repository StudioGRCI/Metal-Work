-- El material de Diseño debe recorrer el circuito completo sin perder área,
-- cantidad ni responsable: solicitud, compra, recepción y despacho parcial.
-- Se prueba cada RPC con el rol real y se revierte toda la fixture.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
values ('20100000019', 'PRUEBAS ABASTECIMIENTO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana', 'Prueba', 'admin-abasto@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Dina', 'Rojas', 'dina@demo.pe', 'DISENO', (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Ciro', 'Luna', 'ciro@demo.pe', 'COMPRADOR', (select id from public.sedes limit 1)) as comprador_id \gset
select test.crear_usuario('Alma', 'Vera', 'alma@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen_id \gset
select test.crear_usuario('Aldo', 'Vera', 'aldo@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen2_id \gset
select test.crear_usuario('Mario', 'Paz', 'mario@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as mtz_id \gset
select test.crear_usuario('Sonia', 'Rey', 'sonia@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as acb_id \gset

select test.como_usuario(:'admin_id');
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

-- Desde la migración 20261001100000 el despacho sale a nombre de la unidad: la
-- OT lleva su vehículo.
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'F2K-240', 'VOLQUETE', 'VOLVO', 'FMX' from public.clientes where numero_documento = '20607761907';
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion)
select (select id from public.clientes where numero_documento = '20607761907'),
       (select id from public.unidades where placa = 'F2K-240'),
       (select id from public.sedes where codigo = 'T1'),
       'Tolva de prueba del circuito de abastecimiento';
select set_config('prueba.orden', (select id::text from public.ordenes_trabajo
  where descripcion = 'Tolva de prueba del circuito de abastecimiento' limit 1), true);
select set_config('prueba.material', (select id::text from public.materiales where codigo = 'PL-6'), true);
update public.ordenes_trabajo set estado = 'APROBADA'
 where id = current_setting('prueba.orden')::uuid;
-- Desde las migraciones 20260929100003 y 20260928141000 un plano nuevo dice
-- quién de Diseño lo elaboró y de qué etapa de la OT cuelga: el armazón los
-- pone con ADMIN.
insert into public.ot_equipo_diseno (orden_id, nombre, funcion)
values (current_setting('prueba.orden')::uuid, 'Dina Rojas', 'RESPONSABLE');
insert into public.ot_etapas (orden_id, nombre, orden_secuencia, area_id, peso_pct)
values (current_setting('prueba.orden')::uuid, 'Planos de la unidad', 1,
        (select id from public.areas where codigo = 'DIS'), 100);
insert into public.ot_planos (orden_id, numero_plano, nombre, peso_pct, integrante_diseno_id, etapa_id)
select current_setting('prueba.orden')::uuid, '1', 'ESTRUCTURA', 100,
       (select id from public.ot_equipo_diseno where orden_id = current_setting('prueba.orden')::uuid),
       (select id from public.ot_etapas where orden_id = current_setting('prueba.orden')::uuid);
select set_config('prueba.plano', (select id::text from public.ot_planos
 where orden_id = current_setting('prueba.orden')::uuid limit 1), true);

-- Desde la migración 20261001221000 el plano del material es opcional: el jefe
-- de Diseño carga la lista apenas recibe la OT y vincula el plano después. La
-- línea de prueba se retira para que el circuito siga con la del plano.
do $$ declare v_linea uuid;
begin
  insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
  values (current_setting('prueba.orden')::uuid, current_setting('prueba.material')::uuid, 1, 'MTZ')
  returning id into v_linea;
  perform test.afirmar(v_linea is not null, 'Una línea nueva entra sin plano y el plano se vincula después');
  delete from public.ot_materiales where id = v_linea;
end $$;

-- Diseño registra la línea para Maestranza.
select test.como_usuario(:'diseno_id');
set local role authenticated;
insert into public.ot_materiales (orden_id, plano_id, material_id, cantidad, area_destino)
values (current_setting('prueba.orden')::uuid, current_setting('prueba.plano')::uuid,
 current_setting('prueba.material')::uuid, 10, 'MTZ');
select set_config('prueba.ot_material', (select id::text from public.ot_materiales
  where orden_id = current_setting('prueba.orden')::uuid), true);
-- Desde la migración 20260928000200 Diseño define el material pero no lo pide
-- (deja `requerimientos.crear`): lo solicita el área que lo usará.
select test.debe_fallar(format('select public.crear_requerimiento_material(%L, %L, array[%L]::uuid[])',
  current_setting('prueba.orden'), 'MTZ', current_setting('prueba.ot_material')),
  'Diseño ya no pide el material: lo pide el área', 'requerimientos.crear');
reset role;

-- Maestranza lo solicita. Desde la migración 20261016120000 el supervisor ya
-- no lee la OT y el pedido de material por OT es el circuito anterior al
-- requerimiento por insumo; como el check 317, la prueba le devuelve
-- `ordenes.ver` solo mientras dure, para seguir cuidándolo.
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'ordenes.ver' from public.roles where codigo = 'SUPERVISOR'
on conflict do nothing;
select test.como_usuario(:'mtz_id');
set local role authenticated;
select set_config('prueba.requerimiento', public.crear_requerimiento_material(
  current_setting('prueba.orden')::uuid, 'MTZ', array[current_setting('prueba.ot_material')::uuid])::text, true);
reset role;
select set_config('prueba.req_linea', (select id::text from public.requerimiento_material_detalles
  where requerimiento_id = current_setting('prueba.requerimiento')::uuid), true);
-- Como ya no la pide Diseño, la línea que pide el área entra como propuesta
-- (migración 20260928132000, `fn_material_propuesta_inicial`) y Diseño la
-- aprueba con su rol antes de que Almacén la revise.
select test.afirmar((select aprobacion_diseno = 'PROPUESTO' and decision_almacen = 'PENDIENTE'
 from public.requerimiento_material_detalles where id = current_setting('prueba.req_linea')::uuid),
 'lo que pide el área espera el visto de Diseño; Almacén todavía no decide');
select test.como_usuario(:'diseno_id');
set local role authenticated;
select public.resolver_propuesta_material(current_setting('prueba.req_linea')::uuid, true);
reset role;
select test.afirmar((select aprobacion_diseno = 'APROBADO' and decision_almacen = 'PENDIENTE'
 from public.requerimiento_material_detalles where id = current_setting('prueba.req_linea')::uuid),
 'Diseño aprueba lo solicitado; Almacén todavía debe revisar');
select test.como_usuario(:'almacen_id');
set local role authenticated;
select public.revisar_stock_requerimiento(current_setting('prueba.req_linea')::uuid, 'COMPRA');
reset role;
select set_config('prueba.receptor', :'mtz_id', true);
select set_config('prueba.receptor_otro_area', :'acb_id', true);

-- Compras solo registra hasta la cantidad solicitada.
select test.como_usuario(:'comprador_id');
set local role authenticated;
select test.debe_fallar(
  'insert into public.ordenes_compra_materiales default values',
  'Compras registra mediante el RPC validado, no con DML directo',
  'permission denied');
-- Desde la migración 20261012100000 la compra elige al proveedor del padrón
-- (`emitir_compra_agrupada`): la versión con el proveedor escrito a mano
-- (`crear_orden_compra_material`) quedó cerrada a la aplicación.
insert into public.proveedores (numero_documento, razon_social)
values ('20100047218', 'Proveedor de prueba');
select set_config('prueba.proveedor', (select id::text from public.proveedores
  where numero_documento = '20100047218'), true);
select set_config('prueba.compra', public.emitir_compra_agrupada(
  gen_random_uuid(), current_setting('prueba.proveedor')::uuid, 'OC-PRUEBA-001',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.req_linea')::uuid, 'cantidad', 10, 'precio', 12.50)),
  current_date + 7, 'CONTADO', 0, 'PEN', true, 'PLANTA')::text, true);
-- El precio viaja ya con la compra agrupada; después no se reescribe.
select test.debe_fallar(format('select public.fijar_precio_compra_material(%L, 99)',
  (select id from public.orden_compra_material_detalles
    where orden_compra_id = current_setting('prueba.compra')::uuid)),
  'el precio de la compra no se reescribe una vez registrado', 'El precio ya está registrado');
select test.afirmar((select precio_unitario from public.orden_compra_material_detalles
  where orden_compra_id = current_setting('prueba.compra')::uuid) = 12.50,
  'la compra guarda el precio con que se emitió');
-- Desde la migración 20260930090000 el PDF va en `compra/{compra}/{id}.pdf` y
-- tiene que estar ya en Storage, subido por quien lo adjunta: se siembra como
-- dueño de las tablas, como lo dejaría la subida desde la pantalla.
reset role;
select set_config('prueba.documento', gen_random_uuid()::text, true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('documentos-compras',
  'compra/' || current_setting('prueba.compra') || '/' || current_setting('prueba.documento') || '.pdf',
  :'comprador_id', '{"mimetype":"application/pdf","size":5}');
set local role authenticated;
-- Y la factura lleva su número y su fecha de emisión (`ck_documento_compra_factura_con_numero`).
insert into public.documentos_compra_material
  (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por,
   numero_documento, fecha_emision)
values (current_setting('prueba.documento')::uuid, current_setting('prueba.compra')::uuid, 'FACTURA', 'factura-prueba.pdf',
  'compra/' || current_setting('prueba.compra') || '/' || current_setting('prueba.documento') || '.pdf',
  'application/pdf', 5, :'comprador_id', 'F001-123', current_date);
select public.marcar_compra_entregada_almacen(current_setting('prueba.compra')::uuid);

select test.debe_fallar(format($q$select public.emitir_compra_agrupada(
      gen_random_uuid(), %L, 'OC-PRUEBA-EXCESO',
      jsonb_build_array(jsonb_build_object('id', %L, 'cantidad', 1, 'precio', 12.50)),
      current_date + 7, 'CONTADO', 0, 'PEN', true, 'PLANTA')$q$,
    current_setting('prueba.proveedor'), current_setting('prueba.req_linea')),
  'Compras no puede pedir más de lo requerido', 'excede lo que falta comprar');
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
-- La respuesta se perdió y se vuelve a enviar con el mismo id (20261023200000):
-- lo mismo devuelve la misma recepción; otra cantidad u otra guía ya no es el
-- mismo envío, y el primero quedó.
select test.afirmar(public.registrar_recepcion_material(current_setting('prueba.ingreso')::uuid,
  current_setting('prueba.compra_linea')::uuid, 6, ' GUIA-PRUEBA-001 ') = current_setting('prueba.ingreso')::uuid,
  'la misma recepción repetida devuelve la misma');
select test.debe_fallar(format('select public.registrar_recepcion_material(%L, %L, 5, ''GUIA-PRUEBA-001'')',
  current_setting('prueba.ingreso'), current_setting('prueba.compra_linea')),
  'otra cantidad con el mismo id dice que la primera ya quedó', 'Esta recepción ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(format('select public.registrar_recepcion_material(%L, %L, 6, ''GUIA-PRUEBA-002'')',
  current_setting('prueba.ingreso'), current_setting('prueba.compra_linea')),
  'otra guía con el mismo id tampoco', 'ya quedó registrada la primera vez');
select test.afirmar((select count(*) = 1 and min(cantidad) = 6 from public.movimientos_materiales
                      where orden_compra_detalle_id = current_setting('prueba.compra_linea')::uuid and tipo = 'INGRESO'),
  'queda una sola recepción, con la cantidad de la primera vez');
do $$
declare v_rechazado boolean := false;
begin
  begin
    perform public.registrar_recepcion_material(gen_random_uuid(),
      current_setting('prueba.compra_linea')::uuid, 5, 'GUIA-PRUEBA-EXCESO');
  exception when check_violation then v_rechazado := true; end;
  perform test.afirmar(v_rechazado, 'Almacén no puede recibir más de lo pendiente de compra');
end $$;

-- El despacho exige a una persona activa del área y descuenta stock. Desde la
-- migración 20260930103000 la entrega sin foto está cerrada: se despacha con
-- `despachar_material_con_foto`, con la foto ya subida por quien entrega (se
-- siembra en Storage como dueño de las tablas).
select set_config('prueba.despacho', gen_random_uuid()::text, true);
select set_config('prueba.despacho_exceso', gen_random_uuid()::text, true);
select set_config('prueba.despacho_otra_area', gen_random_uuid()::text, true);
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'evidencias-almacen', :'almacen_id' || '/' || current_setting(x) || '.jpg', :'almacen_id',
       '{"mimetype":"image/jpeg","size":100}'::jsonb
  from unnest(array['prueba.despacho', 'prueba.despacho_exceso', 'prueba.despacho_otra_area']) x;
set local role authenticated;
create or replace function pg_temp.foto_despacho(p_clave text) returns text language sql as $$
  select current_setting('request.jwt.claim.sub') || '/' || current_setting(p_clave) || '.jpg';
$$;
select public.despachar_material_con_foto(current_setting('prueba.despacho')::uuid,
  current_setting('prueba.req_linea')::uuid, 4, :'mtz_id', 'Mario Paz', pg_temp.foto_despacho('prueba.despacho'));
select public.despachar_material_con_foto(current_setting('prueba.despacho')::uuid,
  current_setting('prueba.req_linea')::uuid, 4, :'mtz_id', 'Mario Paz', pg_temp.foto_despacho('prueba.despacho'));
select test.debe_fallar(format('select public.despachar_material_con_foto(%L, %L, 3, %L, ''Mario Paz'', %L)',
  current_setting('prueba.despacho'), current_setting('prueba.req_linea'), :'mtz_id', pg_temp.foto_despacho('prueba.despacho')),
  'otra cantidad en el despacho con el mismo id dice que el primero ya quedó', 'Este despacho ya quedó registrado la primera vez que lo enviaste');
reset role;
select test.como_usuario(:'almacen2_id');
set local role authenticated;
select test.debe_fallar(format('select public.registrar_recepcion_material(%L, %L, 6, ''GUIA-PRUEBA-001'')',
  current_setting('prueba.ingreso'), current_setting('prueba.compra_linea')),
  'la recepción de otra persona de Almacén no se da por suya', 'Esta recepción ya existe con otros datos');
reset role;
select test.como_usuario(:'almacen_id');
set local role authenticated;

do $$
declare v_rechazado boolean := false;
begin
  begin
    perform public.despachar_material_con_foto(current_setting('prueba.despacho_exceso')::uuid,
      current_setting('prueba.req_linea')::uuid, 3, current_setting('prueba.receptor')::uuid,
      'Mario Paz', pg_temp.foto_despacho('prueba.despacho_exceso'));
  exception when others then
    if sqlerrm like '%recepción de la compra%' then v_rechazado := true; else raise; end if;
  end;
  perform test.afirmar(v_rechazado, 'No se puede despachar más de lo recibido');
  v_rechazado := false;
  begin
    perform public.despachar_material_con_foto(current_setting('prueba.despacho_otra_area')::uuid,
      current_setting('prueba.req_linea')::uuid, 1,
      current_setting('prueba.receptor_otro_area')::uuid,
      'Sonia Rey', pg_temp.foto_despacho('prueba.despacho_otra_area'));
  exception when others then
    if sqlerrm like '%debe pertenecer al área%' then v_rechazado := true; else raise; end if;
  end;
  perform test.afirmar(v_rechazado, 'El receptor debe pertenecer al área destino');
  perform test.afirmar(
    (select count(*) = 1 from public.movimientos_materiales
      where tipo = 'DESPACHO' and requerimiento_detalle_id = current_setting('prueba.req_linea')::uuid),
    'Reintentar con el mismo identificador no duplica el despacho');
  -- Desde la migración 20261016120000 Almacén ya no ve en «Atención» los
  -- pedidos de material de una OT (circuito anterior al requerimiento por
  -- insumo): la atención se lee con los ojos de Diseño, más abajo.
  perform test.afirmar(
    not exists (select 1 from public.v_atencion_materiales where detalle_id = current_setting('prueba.req_linea')::uuid),
    'Almacén ya no ve en Atención el pedido de material por OT');
  perform test.afirmar(
    (select existencia = 2 from public.v_existencias_materiales
      where material_id = current_setting('prueba.material')::uuid),
    'El saldo refleja seis recibidos menos cuatro entregados');
end $$;
reset role;

select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.afirmar(
  (select cantidad_despachada = 4 and estado = 'EN_ALMACEN'
     from public.v_atencion_materiales where detalle_id = current_setting('prueba.req_linea')::uuid),
  'El reporte muestra despacho parcial y material todavía disponible');
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
