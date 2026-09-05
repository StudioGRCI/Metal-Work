-- La lista de materiales de la orden es de Diseño, y el pase al almacén es de
-- quien puede pedir. Este check aprieta las tres cosas que pueden mentir:
--
--   1. Que quien no es Diseño no pueda tocar la lista. Un UPDATE que el RLS
--      esconde afecta cero filas SIN error: por eso se cuenta con
--      `get diagnostics` y no se confía en que la sentencia «pasó».
--   2. Que el saldo salga de los requerimientos vivos: se pide el 40 % y tienen
--      que quedar exactamente los otros 300 kg.
--   3. Que la base pare un pedido de más de lo que queda. Es la única defensa
--      real: la pantalla puede tener el número mal y el almacén acabaría
--      comprando el doble.
--
-- El armazón —material, orden— se monta con ADMIN, como manda la skill: si se
-- montara con el rol examinado, la prueba se caería por el armazón.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS MATERIAL S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Aldo',  'Quiroz',  'aldo@demo.pe',  'ADMIN',       (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Dina',  'Rojas',   'dina@demo.pe',  'DISENO',      (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Rosa',  'Yupanqui','rosa@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.almacenes (codigo, nombre, sede_id)
  select 'A1', 'Almacén central', id from public.sedes limit 1;
insert into public.unidades_medida (codigo, nombre) values ('KG', 'Kilogramo') on conflict do nothing;
insert into public.categorias_material (codigo, nombre) values ('GEN', 'General') on conflict do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'PL-6', 'Plancha LAC 6 mm',
         (select id from public.categorias_material limit 1),
         (select id from public.unidades_medida where codigo = 'KG' limit 1);

insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  select (select id from public.clientes limit 1),
         (select id from public.sedes limit 1),
         'Tolva de prueba para la lista de materiales';

select set_config('prueba.orden',    (select id::text from public.ordenes_trabajo limit 1), false);
select set_config('prueba.material', (select id::text from public.materiales limit 1), false);
select set_config('prueba.almacen',  (select id::text from public.almacenes limit 1), false);

-- --------------------------------------------- Diseño escribe qué lleva la OT
select test.como_usuario(:'diseno_id');
set local role authenticated;

do $$
declare v_linea uuid;
begin
  insert into public.ot_materiales (orden_id, material_id, cantidad, observacion)
  values (current_setting('prueba.orden')::uuid,
          current_setting('prueba.material')::uuid,
          500, 'Piso del cajón')
  returning id into v_linea;

  perform set_config('prueba.linea', v_linea::text, false);

  perform test.afirmar(
    (select cantidad_pendiente from public.v_ot_materiales where id = v_linea) = 500,
    'recién escrita, la línea tiene los 500 kg pendientes');
end $$;

reset role;

-- ------------------------------- el mismo material dos veces es un error de dedo
select test.debe_fallar(
  format($sql$insert into public.ot_materiales (orden_id, material_id, cantidad)
              values (%L, %L, 20)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.material')),
  'el mismo material no entra dos veces en la misma orden',
  'uq_ot_material');

-- ------------------------------------- el taller pide, pero no toca la lista
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare
  v_filas int;
  v_req   uuid;
begin
  -- El jefe de taller no tiene `diseno.planos`. La política lo esconde, así que
  -- esto NO da error: afecta cero filas. Ese es justamente el fallo que hay que
  -- cazar acá y no en la pantalla.
  update public.ot_materiales set cantidad = 999
   where id = current_setting('prueba.linea')::uuid;
  get diagnostics v_filas = row_count;

  perform test.afirmar(v_filas = 0,
    'quien no es Diseño no cambia la lista de materiales');

  perform test.afirmar(
    (select cantidad from public.ot_materiales where id = current_setting('prueba.linea')::uuid) = 500,
    'y la cantidad quedó como la dejó Diseño');

  -- Pero sí puede pedir: el 40 % de los 500 kg.
  v_req := public.mandar_material_a_requerimiento(
    current_setting('prueba.orden')::uuid,
    jsonb_build_array(jsonb_build_object(
      'material', current_setting('prueba.linea')::uuid, 'cantidad', 200)),
    current_setting('prueba.almacen')::uuid,
    'ALTA', null, 'Primer pedido');

  perform set_config('prueba.req', v_req::text, false);

  perform test.afirmar(
    (select cantidad_pedida from public.v_ot_materiales
      where id = current_setting('prueba.linea')::uuid) = 200,
    'el pedido descuenta 200 de la lista');

  perform test.afirmar(
    (select cantidad_pendiente from public.v_ot_materiales
      where id = current_setting('prueba.linea')::uuid) = 300,
    'y quedan 300 por pedir');

  perform test.afirmar(
    (select count(*) from public.requerimiento_detalle
      where requerimiento_id = v_req
        and ot_material_id = current_setting('prueba.linea')::uuid) = 1,
    'la línea del requerimiento sabe de qué línea de la lista salió');
end $$;

reset role;

-- --------------------------------------- no se pide más de lo que la lista dice
select test.como_usuario(:'jefe_id');
set local role authenticated;

select test.debe_fallar(
  format($sql$select public.mandar_material_a_requerimiento(
                %L, jsonb_build_array(jsonb_build_object('material', %L, 'cantidad', 301)))$sql$,
         current_setting('prueba.orden'), current_setting('prueba.linea')),
  'no deja pedir más de lo que queda pendiente',
  'quedan');

reset role;

-- --------------------------- un requerimiento anulado devuelve el saldo
-- Si el saldo estuviera guardado en la fila en vez de calculado, acá se
-- quedaría en 300 para siempre y ese material no se volvería a pedir nunca.
update public.requerimientos set estado = 'ANULADO'
 where id = current_setting('prueba.req')::uuid;

do $$
begin
  perform test.afirmar(
    (select cantidad_pendiente from public.v_ot_materiales
      where id = current_setting('prueba.linea')::uuid) = 500,
    'al anular el requerimiento, los 500 kg vuelven a estar por pedir');
end $$;

-- ------------------------------------------------- quien no ve la orden no ve la lista
select test.crear_usuario('Pedro', 'Silva', 'pedro@demo.pe', 'OPERARIO',
                          (select id from public.sedes limit 1)) as operario_id \gset
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
begin
  -- Un operario solo alcanza las órdenes donde está asignado o imputó horas, y
  -- en esta no está ni una cosa ni la otra.
  perform test.afirmar(
    (select count(*) from public.ot_materiales
      where orden_id = current_setting('prueba.orden')::uuid) = 0,
    'un operario ajeno a la orden no ve su lista de materiales');
end $$;

reset role;

rollback;
