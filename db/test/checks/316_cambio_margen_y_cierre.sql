\set ON_ERROR_STOP on
-- El costo en soles, el margen sin IGV y el cierre que no se toca.
--
-- Una OT con una cotización de S/ 11,800 (IGV incluido) y dos gastos aprobados:
-- S/ 1,000 y US$ 100. Tesorería registra el cambio del día (venta 3.80) y Ventas
-- no puede. Gerencia lee el costo en soles (1,000 + 380 = 1,380), no ve margen
-- hasta que alguien confirma el IGV, y luego lo ve: 11,800 / 1.18 = 10,000 de
-- venta neta, 8,620 de margen, 86.2 %. Costos y Materiales no ve el margen,
-- pero cierra el costo cuando la OT terminó; el cierre no se edita ni se borra,
-- y no se puede cerrar con un despacho sin precio ni con dólares sin cambio.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Gerencia','qa-314-gerencia@demo.pe','GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('QA','Ventas','qa-314-ventas@demo.pe','VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('QA','Costos','qa-314-costos@demo.pe','COSTOS_MATERIALES', :'sede_id') as costos_id \gset
select test.crear_usuario('QA','Tesoreria','qa-314-tesoreria@demo.pe','TESORERIA', :'sede_id') as tesoreria_id \gset

select set_config('prueba.m.gerente', :'gerente_id', true);
select set_config('prueba.m.ventas', :'ventas_id', true);
select set_config('prueba.m.costos', :'costos_id', true);
select set_config('prueba.m.tesoreria', :'tesoreria_id', true);
select set_config('prueba.m.orden', gen_random_uuid()::text, true);
select set_config('prueba.m.cotizacion', gen_random_uuid()::text, true);
select set_config('prueba.m.sin_precio', gen_random_uuid()::text, true);
select set_config('prueba.m.sin_cambio', gen_random_uuid()::text, true);

select test.como_usuario(:'costos_id');
set local session_replication_role = replica;

do $armazon$
declare
  v_orden uuid := current_setting('prueba.m.orden')::uuid;
  v_cot uuid := current_setting('prueba.m.cotizacion')::uuid;
  v_sin_precio uuid := current_setting('prueba.m.sin_precio')::uuid;
  v_sin_cambio uuid := current_setting('prueba.m.sin_cambio')::uuid;
  v_quien uuid := current_setting('prueba.m.costos')::uuid;
  v_ventas uuid := current_setting('prueba.m.ventas')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_mat uuid := gen_random_uuid();
  v_om uuid := gen_random_uuid();
  v_req uuid := gen_random_uuid();
  v_det uuid := gen_random_uuid();
  v_mtz uuid := (select id from public.areas where codigo = 'MTZ');
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000314', 'QA margen y cierre');

  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       monto_venta, moneda, estado, version, registrado_por)
  values (v_cot, 'QA-314-2099', v_cliente, (select id from public.tipos_carroceria order by nombre limit 1),
          'COT-QA-314.pdf', 'cot/' || v_cot || '/COT-QA-314.pdf', 11800, 'PEN', 'APROBADA', 1, v_ventas);

  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, cotizacion_pdf_id, fecha_registro)
  values (v_orden, '9314-2099', v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'Orden QA del margen', 'EN_PROCESO', v_cot, current_date),
         (v_sin_precio, '9315-2099', v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'Orden QA con despacho sin precio', 'TERMINADA', null, current_date),
         (v_sin_cambio, '9316-2099', v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'Orden QA con dólares sin cambio', 'TERMINADA', null, current_date);

  insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, revisado_por, revisado_en)
  select g.id, g.orden, v_mtz, 'SERVICIO', g.descripcion, g.fecha, g.monto, g.moneda,
         'ot/' || g.orden || '/gastos/' || g.id || '.pdf', 'F-QA-314.pdf', 'APROBADO', v_quien, now()
    from (values
      (gen_random_uuid(), v_orden, 'Servicio QA en soles del margen', current_date, 1000::numeric, 'PEN'),
      (gen_random_uuid(), v_orden, 'Servicio QA en dólares del margen', current_date, 100::numeric, 'USD'),
      (gen_random_uuid(), v_sin_cambio, 'Servicio QA en dólares de hace cuarenta días', current_date - 40, 50::numeric, 'USD')
    ) as g(id, orden, descripcion, fecha, monto, moneda);

  -- Un despacho sin precio congelado y sin compra del material: no hay de dónde valorizarlo.
  insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id)
  values (v_mat, 'QA-314-A', 'Perfil QA sin compra', (select id from public.categorias_material order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  insert into public.ot_materiales (id, orden_id, material_id, cantidad, area_destino) values (v_om, v_sin_precio, v_mat, 4, 'MTZ');
  insert into public.requerimientos_materiales (id, orden_id, area_destino, solicitado_por) values (v_req, v_sin_precio, 'MTZ', v_quien);
  insert into public.requerimiento_material_detalles (id, requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen)
  values (v_det, v_req, v_om, 4, 'APROBADO', 'STOCK');
  -- Toda salida dice a qué unidad fue (20261001100000_kardex_y_salidas_por_unidad).
  insert into public.movimientos_materiales (id, tipo, requerimiento_detalle_id, cantidad, responsable_id, registrado_por, registrado_en, material_id, origen, cantidad_de_stock, precio_unitario, moneda, documento_referencia, codigo_unidad)
  values (gen_random_uuid(), 'DESPACHO', v_det, 4, v_quien, v_quien, now() - interval '1 day', v_mat, 'STOCK', 0, null, null, 'VS-QA-314', 'QA-314');
end;
$armazon$;

set local session_replication_role = origin;

do $test$
declare
  v_orden uuid := current_setting('prueba.m.orden')::uuid;
  v_cot uuid := current_setting('prueba.m.cotizacion')::uuid;
  v_total numeric;
  v_cambio numeric;
  m record;
  v_fallo boolean;
  v_cierre uuid;
  v_n integer;
begin
  -- Tesorería registra el cambio del día; Ventas no puede.
  perform test.como_usuario(current_setting('prueba.m.tesoreria')::uuid);
  set local role authenticated;
  insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
  values (current_date, 3.75, 3.80, 'SUNAT', current_setting('prueba.m.tesoreria')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.m.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into public.tipos_de_cambio (fecha, compra, venta, registrado_por) values (current_date - 1, 3.70, 3.72, %L)',
           current_setting('prueba.m.ventas')),
    'Ventas no registra el tipo de cambio', 'row-level security');
  reset role;

  -- Gerencia: costo en soles con el cambio de la fecha de cada línea.
  perform test.como_usuario(current_setting('prueba.m.gerente')::uuid);
  set local role authenticated;
  select sum(monto_pen) into v_total from public.costeo_ot_en_soles(v_orden);
  perform test.afirmar(v_total = 1380.00, format('el costo en soles es 1,000 + 100 × 3.80 = 1,380.00 (dio %s)', v_total));
  select tipo_cambio into v_cambio from public.costeo_ot_en_soles(v_orden) where moneda = 'USD';
  perform test.afirmar(v_cambio = 3.80, 'la línea en dólares usa el cambio de venta de su fecha');

  -- Sin confirmar el IGV no hay margen: la pantalla debe decir qué falta.
  select * into m from public.margen_ot(v_orden);
  perform test.afirmar(m.incluye_igv is null and m.margen_pen is null and m.costo_pen = 1380.00,
                       'sin confirmar el IGV el margen queda en blanco y el costo sí sale');
  reset role;

  perform test.como_usuario(current_setting('prueba.m.ventas')::uuid);
  set local role authenticated;
  perform public.confirmar_igv_cotizacion(v_cot, true);
  reset role;

  perform test.como_usuario(current_setting('prueba.m.gerente')::uuid);
  set local role authenticated;
  select * into m from public.margen_ot(v_orden);
  perform test.afirmar(m.precio_neto = 10000.00 and m.precio_neto_pen = 10000.00,
                       format('la venta neta es 11,800 / 1.18 = 10,000.00 (dio %s)', m.precio_neto));
  perform test.afirmar(m.margen_pen = 8620.00 and m.margen_pct = 86.2,
                       format('el margen es 8,620.00 y 86.2 %% (dio %s y %s)', m.margen_pen, m.margen_pct));
  reset role;

  -- Costos y Materiales ve el costo pero no el precio: tampoco el margen.
  perform test.como_usuario(current_setting('prueba.m.costos')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.margen_ot(%L)', v_orden),
    'Costos y Materiales no ve el margen', 'precio de venta');

  -- El costo no se cierra mientras la OT sigue en producción.
  perform test.debe_fallar(format('select public.cerrar_costo_ot(%L)', v_orden),
    'no se cierra el costo de una OT en producción', 'sigue en producción');
  reset role;

  -- Armazón: la OT termina sin pasar por sus reglas (etapas, permisos), que
  -- tienen sus propios checks.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set estado = 'TERMINADA' where id = v_orden;
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.m.costos')::uuid);
  set local role authenticated;
  v_cierre := public.cerrar_costo_ot(v_orden, 'Cierre QA');
  select count(*) into v_n from public.ot_cierres_costo where id = v_cierre and costo_pen = 1380.00
     and jsonb_array_length(lineas) = 2;
  perform test.afirmar(v_n = 1, 'el cierre congela S/ 1,380.00 con sus dos líneas');
  perform test.debe_fallar(format('select public.cerrar_costo_ot(%L)', v_orden),
    'un costo cerrado no se vuelve a cerrar', 'ya está cerrado');
  perform test.debe_fallar(format('select public.cerrar_costo_ot(%L)', current_setting('prueba.m.sin_precio')),
    'no se cierra con un despacho sin precio', 'sin precio');
  perform test.debe_fallar(format('select public.cerrar_costo_ot(%L)', current_setting('prueba.m.sin_cambio')),
    'no se cierra con dólares sin tipo de cambio', 'sin tipo de cambio');
  reset role;

  perform test.como_usuario(current_setting('prueba.m.ventas')::uuid);
  set local role authenticated;
  select count(*) into v_n from public.ot_cierres_costo where orden_id = v_orden;
  perform test.afirmar(v_n = 0, 'Ventas no lee el cierre de costo');
  perform test.debe_fallar(format('select public.cerrar_costo_ot(%L)', current_setting('prueba.m.sin_cambio')),
    'Ventas no cierra costos', 'Costos y Materiales o Administración');
  reset role;

  -- Ni el dueño de las tablas lo cambia: el disparador lo impide.
  perform test.debe_fallar(format('update public.ot_cierres_costo set nota = %L where id = %L', 'cambio', v_cierre),
    'el cierre no se edita', 'no se modifica');
  perform test.debe_fallar(format('delete from public.ot_cierres_costo where id = %L', v_cierre),
    'el cierre no se borra', 'no se modifica');
end;
$test$;

rollback;
