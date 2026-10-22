-- El stock libre y lo separado para cada código interno (migración
-- 20261020195000). Lo que Almacén ya le dio a un RQ abierto y no entregó —lo
-- separado al revisar y lo comprado que ya entró— es de ese código y no está
-- libre; tampoco el accesorio que entró para una unidad. Lo ven Supervisión,
-- Almacén, y desde hoy Requerimientos y Administración, sin precios ni el
-- kardex; Ventas y el conductor no. Lo entregado con otro material también
-- entrega la línea. De paso, la lista con la que Almacén entrega por RQ ya no
-- cuenta cada salida una vez por cada devolución. Cada paso con el rol que lo hace —nunca
-- ADMIN— y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS RQ S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'COMPRADOR:LOG',
                           'SUPERVISOR:MTZ', 'VENDEDOR:GCO', 'CONDUCTOR:LOG'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.414@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 414', lower(replace(v, ':', '.')) || '.414@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;

  -- Un puesto que solo ve el stock y no los requerimientos: no le salen los números de RQ.
  insert into public.roles (codigo, nombre, nivel) values ('CHK414_SOLO_STOCK', 'Solo stock (check 414)', 1);
  insert into public.roles_permisos (rol_id, permiso_codigo)
  select id, 'almacen.stock' from public.roles where codigo = 'CHK414_SOLO_STOCK';
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'solo.stock.414@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
  select v_id, 'Solo stock', 'Check 414', 'solo.stock.414@prueba.local', id from public.roles where codigo = 'CHK414_SOLO_STOCK';
  perform set_config('prueba.solo_stock', v_id::text, true);

  foreach v in array array['MTZ', 'PRD', 'RRH'] loop
    perform set_config('prueba.area_' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  foreach v in array array['rq1', 'rq2', 'rq3', 'rq4', 'rq5', 'rq6', 'rq7', 'rq8', 'rqa', 'oc', 'oc2', 'rq9', 'rq10', 'oc3', 'oc4', 'salida', 'salida2', 'salida3', 'salida4', 'salida5', 'salida6', 'salida7', 'salida8',
                           'dev1', 'dev2', 'dev3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  -- La foto de cada entrega, que la salida exige.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.' || s) || '.jpg',
         current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb
    from unnest(array['salida', 'salida2', 'salida3', 'salida4', 'salida5', 'salida6', 'salida7', 'salida8']) s;

  -- El catálogo y el kardex, como dueño de las tablas.
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK414-DIS', 'Disco de corte (prueba 414)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK414-FAR', 'Faro LED (prueba 414)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK414-PLA', 'Plancha LAF 3 mm (prueba 414)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK414-LIJ', 'Lija al agua 120 (prueba 414)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK414-DS2', 'Disco de corte de otra marca (prueba 414)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK414-GUA', 'Guantes de cuero (prueba 414)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  foreach v in array array['DIS', 'FAR', 'PLA', 'LIJ', 'DS2', 'GUA'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.materiales where codigo = 'CHK414-' || v), true);
  end loop;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20999410007', 'Proveedor de prueba 414', 'Av. Argentina 457, Lima', '999 414 414');
  perform set_config('prueba.prov', (select id::text from public.proveedores where numero_documento = '20999410007'), true);

  -- 20 discos; 6 faros libres y 3 que entraron para CHK414-C; 5 planchas; 2 lijas; 10 guantes.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  values
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.dis')::uuid, 20, 'INGRESO_GENERAL', 'GR 414-1', current_setting('prueba.almacenero')::uuid, null),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.far')::uuid, 6, 'INGRESO_GENERAL', 'GR 414-2', current_setting('prueba.almacenero')::uuid, null),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.far')::uuid, 3, 'INGRESO_GENERAL', 'GR 414-3', current_setting('prueba.almacenero')::uuid, 'chk414-c'),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.pla')::uuid, 5, 'INGRESO_GENERAL', 'GR 414-4', current_setting('prueba.almacenero')::uuid, null),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.lij')::uuid, 2, 'INGRESO_GENERAL', 'GR 414-5', current_setting('prueba.almacenero')::uuid, null),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.gua')::uuid, 10, 'INGRESO_GENERAL', 'GR 414-8', current_setting('prueba.almacenero')::uuid, null);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.emitir(p_rq text, p_area text, p_codigo text, p_lineas jsonb) returns uuid language sql as $$
  select public.emitir_requerimiento(current_setting('prueba.' || p_rq)::uuid, 'OPERACION', current_setting('prueba.area_' || p_area)::uuid,
    p_codigo, 'Material de la prueba 414', null, p_lineas);
$$;

create or replace function pg_temp.insumo(p_rq text, p_item int) returns uuid language sql as $$
  select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p_rq)::uuid and item = p_item;
$$;

create or replace function pg_temp.numero(p_rq text) returns text language sql as $$
  select numero from public.requerimientos where id = current_setting('prueba.' || p_rq)::uuid;
$$;

-- Lo que dice la función de un material, con la sesión que esté puesta.
create or replace function pg_temp.stock(p_material text) returns table (existencia numeric, separado numeric, libre numeric, por_codigo jsonb)
language sql as $$
  select s.existencia, s.separado, s.libre, s.por_codigo
    from public.stock_libre_en_almacen(array[current_setting('prueba.' || p_material)::uuid]) s;
$$;

-- ============================================ 1. Los requerimientos de operación
select pg_temp.como('requerimientos');
set local role authenticated;
-- RQ1: 8 discos y 5 lijas para CHK414-A. RQ2: 10 discos para CHK414-B.
select pg_temp.emitir('rq1', 'mtz', 'chk414-a', format('[{"material_id": "%s", "cantidad": 8}, {"material_id": "%s", "cantidad": 5}]',
  current_setting('prueba.dis'), current_setting('prueba.lij'))::jsonb);
select pg_temp.emitir('rq2', 'prd', 'CHK414-B', format('[{"material_id": "%s", "cantidad": 10}]', current_setting('prueba.dis'))::jsonb);
-- RQ3 y RQ4: planchas para A y para B, que se compran juntas en una sola línea de OC.
select pg_temp.emitir('rq3', 'mtz', 'CHK414-A', format('[{"material_id": "%s", "cantidad": 4}]', current_setting('prueba.pla'))::jsonb);
select pg_temp.emitir('rq4', 'prd', 'CHK414-B', format('[{"material_id": "%s", "cantidad": 6}]', current_setting('prueba.pla'))::jsonb);
-- RQ5: 2 faros para CHK414-C, que ya tiene 3 suyos. RQ6: 2 discos, que nadie revisó todavía.
-- RQ7: 2 discos para CHK414-D, que se compran de otra marca.
select pg_temp.emitir('rq5', 'prd', 'CHK414-C', format('[{"material_id": "%s", "cantidad": 2}]', current_setting('prueba.far'))::jsonb);
select pg_temp.emitir('rq6', 'mtz', 'CHK414-A', format('[{"material_id": "%s", "cantidad": 2}]', current_setting('prueba.dis'))::jsonb);
select pg_temp.emitir('rq7', 'prd', 'CHK414-D', format('[{"material_id": "%s", "cantidad": 2}]', current_setting('prueba.dis'))::jsonb);
reset role;
-- Administración pide 2 discos para la planta.
select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqa')::uuid, 'ADMINISTRACION', current_setting('prueba.area_rrh')::uuid,
  'PLANTA', 'Discos para la oficina de prueba 414', null, format('[{"material_id": "%s", "cantidad": 2}]', current_setting('prueba.dis'))::jsonb);
reset role;

-- ============================================ 2. Antes de revisar nada, todo está libre
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 20 and separado = 0 and libre = 20 and por_codigo = '[]'::jsonb from pg_temp.stock('dis')),
  'Sin RQ revisados, los 20 discos están libres');
select test.afirmar((select existencia = 9 and separado = 3 and libre = 6
                            and por_codigo = '[{"codigo": "CHK414-C", "cantidad": 3, "de_requerimientos": 0, "requerimientos": []}]'::jsonb from pg_temp.stock('far')),
  'Los 3 faros que entraron para CHK414-C son suyos; 6 libres');

-- ============================================ 3. Almacén revisa y separa
-- RQ1: tiene los 8 discos y las 5 lijas (aunque solo hay 2: lo anota Almacén).
select public.rq_revisar_stock(current_setting('prueba.rq1')::uuid, '[{"item": 1, "en_stock": 8}, {"item": 2, "en_stock": 5}]', null);
-- RQ2: de los 10 discos tiene 4.
select public.rq_revisar_stock(current_setting('prueba.rq2')::uuid, '[{"item": 1, "en_stock": 4}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq3')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq4')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq5')::uuid, '[{"item": 1, "en_stock": 2}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq7')::uuid, '[{"item": 1, "en_stock": 0}]', null);
-- El de Administración: de los 2 discos para la planta tiene 1 (después se anula).
select public.rq_revisar_stock(current_setting('prueba.rqa')::uuid, '[{"item": 1, "en_stock": 1}]', null);
reset role;
select test.afirmar((select estado from public.requerimientos where id = current_setting('prueba.rq1')::uuid) = 'LISTO_EN_ALMACEN'
                    and (select estado from public.requerimientos where id = current_setting('prueba.rq2')::uuid) = 'SIN_STOCK',
  'RQ1 queda listo en almacén y RQ2 por comprar');

select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 20 and separado = 13 and libre = 7 from pg_temp.stock('dis')),
  'De 20 discos: 8 de CHK414-A, 4 de CHK414-B, 1 de PLANTA; quedan 7 libres');
select test.afirmar((select por_codigo from pg_temp.stock('dis')) = jsonb_build_array(
    jsonb_build_object('codigo', 'CHK414-A', 'cantidad', 8, 'de_requerimientos', 8, 'requerimientos', jsonb_build_array(pg_temp.numero('rq1'))),
    jsonb_build_object('codigo', 'CHK414-B', 'cantidad', 4, 'de_requerimientos', 4, 'requerimientos', jsonb_build_array(pg_temp.numero('rq2'))),
    jsonb_build_object('codigo', 'PLANTA', 'cantidad', 1, 'de_requerimientos', 1, 'requerimientos', jsonb_build_array(pg_temp.numero('rqa')))),
  'Cada código con lo suyo y el RQ que lo separó; el código del RQ va en mayúsculas');
select test.afirmar((select existencia = 2 and separado = 5 and libre = 0 from pg_temp.stock('lij')),
  'Si lo separado pasa lo que hay en el kardex, no queda nada libre');
select test.afirmar((select existencia = 9 and separado = 3 and libre = 6 from pg_temp.stock('far')),
  'Los 2 faros separados para CHK414-C son de los 3 que entraron para ella: no se cuentan dos veces');
-- Al revisar otro RQ de CHK414-C, de sus 3 faros solo le sirve 1: los otros 2 ya son de RQ5.
select test.afirmar((select por_codigo = jsonb_build_array(jsonb_build_object('codigo', 'CHK414-C', 'cantidad', 3, 'de_requerimientos', 2,
                              'requerimientos', jsonb_build_array(pg_temp.numero('rq5')))) from pg_temp.stock('far')),
  'De lo de CHK414-C se dice aparte cuánto ya separaron sus RQ: 2 de los 3');
reset role;

-- ============================================ 4. Lo entregado deja de estar separado; lo anulado, también
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_salida_material(current_setting('prueba.salida')::uuid, current_setting('prueba.dis')::uuid, 3,
  null, null, 'Entrega parcial del RQ1', 'Soldador MTZ',
  auth.uid()::text || '/' || current_setting('prueba.salida') || '.jpg', pg_temp.insumo('rq1', 1));
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select public.anular_requerimiento(current_setting('prueba.rqa')::uuid, 'La oficina ya no lo necesita (prueba 414)');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 17 and separado = 9 and libre = 8 from pg_temp.stock('dis')),
  'Salieron 3 de los 8 de CHK414-A y se anuló el de PLANTA: 5 + 4 separados, 8 libres de 17');
reset role;

-- ============================================ 5. Lo comprado para un RQ que ya entró es de su código
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc')::uuid,
  format('[{"material_id": "%s", "cantidad": 10, "precio": 80, "insumos": ["%s", "%s"]}]',
         current_setting('prueba.pla'), pg_temp.insumo('rq3', 1), pg_temp.insumo('rq4', 1))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 414', null, 'CONTADO', 0, 'PEN', true);
reset role;
select test.afirmar((select orden_compra_detalle_id from public.requerimiento_lineas where id = pg_temp.insumo('rq3', 1))
                    = (select orden_compra_detalle_id from public.requerimiento_lineas where id = pg_temp.insumo('rq4', 1)),
  'Las planchas de los dos RQ van en una sola línea de OC');
-- Llegan 7 de las 10. El armazón, como dueño: la entrega y la recepción tienen sus propios checks.
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc')::uuid;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
select gen_random_uuid(), 'INGRESO', current_setting('prueba.pla')::uuid, 7, 'COMPRA', 'GR 414-6', current_setting('prueba.almacenero')::uuid,
       orden_compra_detalle_id
  from public.requerimiento_lineas where id = pg_temp.insumo('rq3', 1);
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 12 and separado = 7 and libre = 5 from pg_temp.stock('pla')),
  'De las 7 planchas que llegaron, 4 son del RQ3 (el primero) y 3 del RQ4; las 5 de antes siguen libres');
select test.afirmar((select por_codigo from pg_temp.stock('pla')) = jsonb_build_array(
    jsonb_build_object('codigo', 'CHK414-A', 'cantidad', 4, 'de_requerimientos', 4, 'requerimientos', jsonb_build_array(pg_temp.numero('rq3'))),
    jsonb_build_object('codigo', 'CHK414-B', 'cantidad', 3, 'de_requerimientos', 3, 'requerimientos', jsonb_build_array(pg_temp.numero('rq4')))),
  'Lo que llega se reparte en el orden en que se pidió, y a la misma hora por número de RQ');
reset role;

-- Lo comprado de otro material: RQ7 pidió el disco y Logística compra el de otra marca.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc2')::uuid,
  format('[{"material_id": "%s", "cantidad": 2, "precio": 9, "insumos": ["%s"]}]',
         current_setting('prueba.ds2'), pg_temp.insumo('rq7', 1))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 414-2', null, 'CONTADO', 0, 'PEN', true);
reset role;
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc2')::uuid;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
select gen_random_uuid(), 'INGRESO', current_setting('prueba.ds2')::uuid, 2, 'COMPRA', 'GR 414-7', current_setting('prueba.almacenero')::uuid,
       orden_compra_detalle_id
  from public.requerimiento_lineas where id = pg_temp.insumo('rq7', 1);
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 2 and separado = 2 and libre = 0
                            and por_codigo = jsonb_build_array(jsonb_build_object('codigo', 'CHK414-D', 'cantidad', 2, 'de_requerimientos', 2,
                                  'requerimientos', jsonb_build_array(pg_temp.numero('rq7')))) from pg_temp.stock('ds2')),
  'Lo que llegó de otra marca es de CHK414-D en el material comprado');
select test.afirmar((select existencia = 17 and separado = 9 and libre = 8 from pg_temp.stock('dis')),
  'El disco pedido no queda separado por lo que se compró de otra marca');
select test.afirmar((select count(*) from public.stock_libre_en_almacen(array[current_setting('prueba.dis')::uuid, current_setting('prueba.pla')::uuid])) = 2,
  'Pedido por material, trae solo esos');
select test.afirmar((select count(*) from public.stock_libre_en_almacen()) = (select count(*) from public.v_existencias_materiales),
  'Sin filtro, trae todo material con kardex, igual que el kardex');
select test.afirmar((select count(*) from public.movimientos_materiales where material_id = current_setting('prueba.dis')::uuid) = 2,
  'Almacén sí lee el kardex del disco: el ingreso y la salida');
reset role;

-- ============================================ 6. Quién lo ve
-- Requerimientos y Administración, desde hoy, igual que Supervisión; sin abrir el kardex.
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select existencia = 17 and separado = 9 and libre = 8 from pg_temp.stock('dis')),
  'Requerimientos ve el stock libre y lo separado');
select test.afirmar((select (por_codigo -> 0 -> 'requerimientos') = jsonb_build_array(pg_temp.numero('rq1')) from pg_temp.stock('dis')),
  'Requerimientos ve qué RQ lo separó');
select test.afirmar((select count(*) from public.movimientos_materiales where material_id = current_setting('prueba.dis')::uuid) = 0,
  'Requerimientos no lee los movimientos del kardex');
select test.afirmar((select count(*) from public.v_kardex_almacen where material_id = current_setting('prueba.dis')::uuid) = 0,
  'Requerimientos no lee el kardex');
select test.afirmar((select count(*) from public.stock_en_almacen() where material_id = current_setting('prueba.dis')::uuid) = 1,
  'Requerimientos también abre la versión anterior del stock');
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar((select libre = 8 from pg_temp.stock('dis')), 'Administración ve el stock libre');
select test.afirmar((select count(*) from public.movimientos_materiales where material_id = current_setting('prueba.dis')::uuid) = 0,
  'Administración no lee los movimientos del kardex');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select libre = 8 and separado = 9 from pg_temp.stock('dis')), 'Supervisión sigue viendo el stock');
reset role;

select pg_temp.como('solo_stock');
set local role authenticated;
select test.afirmar((select libre = 8 and (por_codigo -> 0 -> 'requerimientos') = '[]'::jsonb from pg_temp.stock('dis')),
  'Quien no ve los requerimientos ve lo separado por código, sin los números de RQ');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar('select * from public.stock_libre_en_almacen()', 'Ventas no ve el stock de Almacén', 'No tienes permiso');
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select test.debe_fallar('select * from public.stock_libre_en_almacen()', 'El conductor no ve el stock de Almacén', 'No tienes permiso');
reset role;

-- ============================================ 7. Lo entregado con devoluciones, en la salida de Almacén
-- RQ8: 6 guantes para CHK414-E, que Almacén tiene. Entrega 4 y le devuelven 1 y otra vez 1.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq8', 'mtz', 'CHK414-E', format('[{"material_id": "%s", "cantidad": 6}]', current_setting('prueba.gua'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq8')::uuid, '[{"item": 1, "en_stock": 6}]', null);
select public.registrar_salida_material(current_setting('prueba.salida2')::uuid, current_setting('prueba.gua')::uuid, 4,
  null, null, 'Entrega parcial del RQ8', 'Soldador MTZ',
  auth.uid()::text || '/' || current_setting('prueba.salida2') || '.jpg', pg_temp.insumo('rq8', 1));
select public.registrar_ingreso_almacen(current_setting('prueba.dev1')::uuid, current_setting('prueba.gua')::uuid, 1,
  'DEVOLUCION', 'Devolución 1 de la prueba 414', null, 'PEN', current_setting('prueba.salida2')::uuid);
select public.registrar_ingreso_almacen(current_setting('prueba.dev2')::uuid, current_setting('prueba.gua')::uuid, 1,
  'DEVOLUCION', 'Devolución 2 de la prueba 414', null, 'PEN', current_setting('prueba.salida2')::uuid);
do $$
declare v_entregado numeric; v_pendiente numeric;
begin
  select entregado, pendiente into v_entregado, v_pendiente
    from public.v_rq_lineas_para_salida where linea_id = pg_temp.insumo('rq8', 1);
  -- Antes decía 6 entregados (4 + 4 − 2) y nada pendiente.
  perform test.afirmar(v_entregado = 2 and v_pendiente = 4,
    format('Almacén ve 2 entregados (4 que salieron menos 1 y 1 devueltos) y 4 por entregar: dice %s y %s', v_entregado, v_pendiente));
end $$;
select test.afirmar((select existencia = 8 and separado = 4 and libre = 4 from pg_temp.stock('gua')),
  'De 8 guantes en almacén, los 4 que faltan entregar son de CHK414-E; 4 libres');
-- Y puede entregar los 4 que de verdad faltan: con la cuenta de antes la salida se rechazaba.
select public.registrar_salida_material(current_setting('prueba.salida3')::uuid, current_setting('prueba.gua')::uuid, 4,
  null, null, 'Entrega final del RQ8', 'Soldador MTZ',
  auth.uid()::text || '/' || current_setting('prueba.salida3') || '.jpg', pg_temp.insumo('rq8', 1));
select test.afirmar((select existencia = 4 and separado = 0 and libre = 4 from pg_temp.stock('gua')),
  'Entregado todo, ningún guante queda separado');
select test.afirmar(coalesce((select pendiente from public.v_rq_lineas_para_salida where linea_id = pg_temp.insumo('rq8', 1)), 0) = 0,
  'Y no queda nada por entregar');
reset role;

-- ============================================ 8. Lo entregado con otro material también entrega la línea
-- RQ7 pidió el disco y llegaron 2 de otra marca; Almacén le entrega 2 del disco pedido.
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_salida_material(current_setting('prueba.salida4')::uuid, current_setting('prueba.dis')::uuid, 2,
  null, null, 'Entrega del RQ7 con el disco pedido', 'Soldador PRD',
  auth.uid()::text || '/' || current_setting('prueba.salida4') || '.jpg', pg_temp.insumo('rq7', 1));
select test.afirmar((select existencia = 2 and separado = 0 and libre = 2 from pg_temp.stock('ds2')),
  'Entregado el RQ7 con el disco pedido, los 2 de otra marca que llegaron para él quedan libres');
select test.afirmar((select existencia = 15 and separado = 9 and libre = 6 from pg_temp.stock('dis')),
  'Los 2 discos pedidos salieron de lo libre: lo separado para los demás no cambia');
-- RQ1 tenía 8 discos listos y ya se le entregaron 3; ahora recibe 2 de otra marca en su lugar.
select public.registrar_salida_material(current_setting('prueba.salida5')::uuid, current_setting('prueba.ds2')::uuid, 2,
  null, null, 'Entrega del RQ1 con otra marca', 'Soldador MTZ',
  auth.uid()::text || '/' || current_setting('prueba.salida5') || '.jpg', pg_temp.insumo('rq1', 1));
select test.afirmar((select existencia = 15 and separado = 7 and libre = 8 from pg_temp.stock('dis')),
  'Lo que salió de otra marca también entrega el RQ1: de sus 5 discos por entregar quedan 3 separados');
select test.afirmar((select (por_codigo -> 0 ->> 'cantidad')::numeric = 3 from pg_temp.stock('dis')),
  'CHK414-A tiene 3 discos, igual que lo que le falta entregar al RQ1');
select test.afirmar((select pendiente from public.v_rq_lineas_para_salida where linea_id = pg_temp.insumo('rq1', 1)) = 3,
  'y la salida del kardex dice lo mismo: faltan 3');
reset role;

-- ============================================ 9. Un RQ ya entregado sigue contando en el reparto de su OC
-- RQ3 recibe sus 4 planchas y se entrega; RQ4, en la misma línea de OC, sigue
-- abierto: de las 7 que llegaron, 4 fueron de RQ3 y le quedan 3, no 6.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq3')::uuid, null);
select public.registrar_salida_material(current_setting('prueba.salida6')::uuid, current_setting('prueba.pla')::uuid, 4,
  null, null, 'Entrega del RQ3', 'Soldador MTZ',
  auth.uid()::text || '/' || current_setting('prueba.salida6') || '.jpg', pg_temp.insumo('rq3', 1));
select public.rq_marcar_entregado(current_setting('prueba.rq3')::uuid, 'Lo recogió el soldador de MTZ (prueba 414)');
select test.afirmar((select existencia = 8 and separado = 3 and libre = 5
                            and por_codigo = jsonb_build_array(jsonb_build_object('codigo', 'CHK414-B', 'cantidad', 3, 'de_requerimientos', 3,
                                  'requerimientos', jsonb_build_array(pg_temp.numero('rq4')))) from pg_temp.stock('pla')),
  'Entregado el RQ3, el RQ4 conserva solo lo suyo de lo que llegó: 3 de 8, 5 libres');
reset role;

-- ============================================ 10. Lo entregado de otro material antes de que llegue la compra
-- RQ9: 4 guantes; Almacén separa 2, Logística compra 2 discos de otra marca y,
-- antes de que lleguen, Almacén le entrega 2 discos pedidos del stock general.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq9', 'prd', 'CHK414-F', format('[{"material_id": "%s", "cantidad": 4}]', current_setting('prueba.gua'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq9')::uuid, '[{"item": 1, "en_stock": 2}]', null);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc3')::uuid,
  format('[{"material_id": "%s", "cantidad": 2, "precio": 9, "insumos": ["%s"]}]',
         current_setting('prueba.ds2'), pg_temp.insumo('rq9', 1))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 414-3', null, 'CONTADO', 0, 'PEN', true);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_salida_material(current_setting('prueba.salida7')::uuid, current_setting('prueba.dis')::uuid, 2,
  null, null, 'Entrega adelantada del RQ9', 'Soldador PRD',
  auth.uid()::text || '/' || current_setting('prueba.salida7') || '.jpg', pg_temp.insumo('rq9', 1));
select test.afirmar((select existencia = 4 and separado = 2 and libre = 2 from pg_temp.stock('gua')),
  'Al RQ9 le faltan 2: los 2 guantes que Almacén le separó siguen siendo suyos');
select test.afirmar((select existencia = 13 and separado = 7 and libre = 6 from pg_temp.stock('dis')),
  'Los 2 discos salieron de lo libre');
reset role;
-- Llega la compra: la línea sigue necesitando 2, y se queda con lo comprado para ella.
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc3')::uuid;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
select gen_random_uuid(), 'INGRESO', current_setting('prueba.ds2')::uuid, 2, 'COMPRA', 'GR 414-9', current_setting('prueba.almacenero')::uuid,
       orden_compra_detalle_id
  from public.requerimiento_lineas where id = pg_temp.insumo('rq9', 1);
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 2 and separado = 2 and libre = 0 from pg_temp.stock('ds2'))
                    and (select existencia = 4 and separado = 0 and libre = 4 from pg_temp.stock('gua')),
  'Llegados los 2 de otra marca, son del RQ9 y los guantes vuelven a estar libres: nunca más de lo que le falta');
reset role;

-- ============================================ 11. Un insumo sin material del catálogo también es dueño de su compra
-- RQ10: un insumo escrito a mano antes del catálogo (sin material) se compra en
-- discos de otra marca. El armazón, como dueño: hoy el RQ ya nace con material.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq10', 'mtz', 'CHK414-G', format('[{"material_id": "%s", "cantidad": 3}]', current_setting('prueba.lij'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq10')::uuid, '[{"item": 1, "en_stock": 0}]', null);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc4')::uuid,
  format('[{"material_id": "%s", "cantidad": 3, "precio": 9, "insumos": ["%s"]}]',
         current_setting('prueba.ds2'), pg_temp.insumo('rq10', 1))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 414-4', null, 'CONTADO', 0, 'PEN', true);
reset role;
-- Sin disparadores: el de la línea ya no deja quitarle el material.
set local session_replication_role = replica;
update public.requerimiento_lineas set material_id = null where id = pg_temp.insumo('rq10', 1);
set local session_replication_role = origin;
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc4')::uuid;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
select gen_random_uuid(), 'INGRESO', current_setting('prueba.ds2')::uuid, 3, 'COMPRA', 'GR 414-10', current_setting('prueba.almacenero')::uuid,
       orden_compra_detalle_id
  from public.requerimiento_lineas where id = pg_temp.insumo('rq10', 1);
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select existencia = 5 and separado = 5 and libre = 0 from pg_temp.stock('ds2')),
  'Lo que llegó para el insumo sin material es de CHK414-G: 2 del RQ9 y 3 del RQ10, nada libre');
reset role;

-- ============================================ 12. El accesorio de una unidad que sale y vuelve sigue siendo suyo
-- RQ5 recibe 2 de los 3 faros de CHK414-C y los devuelve.
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_salida_material(current_setting('prueba.salida8')::uuid, current_setting('prueba.far')::uuid, 2,
  null, null, 'Entrega del RQ5', 'Electricista PRD',
  auth.uid()::text || '/' || current_setting('prueba.salida8') || '.jpg', pg_temp.insumo('rq5', 1));
select public.registrar_ingreso_almacen(current_setting('prueba.dev3')::uuid, current_setting('prueba.far')::uuid, 2,
  'DEVOLUCION', 'Devolución de los faros de la prueba 414', null, 'PEN', current_setting('prueba.salida8')::uuid);
select test.afirmar((select existencia = 9 and separado = 3 and libre = 6
                            and (por_codigo -> 0 ->> 'cantidad')::numeric = 3 from pg_temp.stock('far')),
  'Devueltos, los 3 faros vuelven a ser de CHK414-C y siguen 6 libres');
reset role;

select test.afirmar(not has_function_privilege('anon', 'public.stock_libre_en_almacen(uuid[])', 'execute'),
  'Sin sesión no se lee el stock');
select test.afirmar(pg_get_function_result('public.stock_libre_en_almacen(uuid[])'::regprocedure) !~* '(precio|valor|costo|monto)',
  'El stock no lleva precios');
select test.afirmar(
  (select count(distinct r.codigo) from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
    where rp.permiso_codigo = 'almacen.stock' and r.codigo in ('REQUERIMIENTOS', 'ADMINISTRACION', 'SUPERVISOR', 'JEFE_PRODUCCION')) = 4,
  'Requerimientos, Administración, los supervisores de área y el jefe de producción tienen el permiso');
select test.afirmar(
  not exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id
               where rp.permiso_codigo = 'almacen.ver' and r.codigo in ('REQUERIMIENTOS', 'ADMINISTRACION')),
  'Requerimientos y Administración no reciben el kardex');

rollback;
