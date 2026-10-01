\set ON_ERROR_STOP on
-- El detalle del costeo suma lo mismo que el resumen.
--
-- Si `detalle_costeo_ot` y `resumen_costeo_ot` valoraran distinto, el
-- expediente de la carrocería diría una cifra y la pestaña Costos otra. Se arma
-- una OT con lo que mueve el costo: un despacho con precio congelado, otro sin
-- precio (vale el de su compra), una devolución, una planilla cerrada repartida
-- y dos gastos, uno aprobado y otro pendiente. Se lee con el rol de Costos y se
-- comprueba que alguien sin `costos.ver` no lo lee.
begin;

select test.crear_usuario('QA','Costos','qa-detalle-costeo@demo.pe','COSTOS_MATERIALES',
  (select id from public.sedes order by nombre limit 1)) as costos_id \gset
select test.crear_usuario('QA','Operario','qa-detalle-operario@demo.pe','OPERARIO',
  (select id from public.sedes order by nombre limit 1), true, 10) as operario_id \gset
select gen_random_uuid() as orden_id \gset

select set_config('prueba.costeo.orden', :'orden_id', true);
select set_config('prueba.costeo.costos', :'costos_id', true);
select set_config('prueba.costeo.operario', :'operario_id', true);

-- Las columnas que se llenan con quien tiene la sesión (creado_por,
-- registrado_por) necesitan una: la de Costos.
select test.como_usuario(:'costos_id');

-- El armazón entra sin disparadores: lo que se prueba es la lectura del
-- costeo, no las reglas de almacén (despacho con foto, kardex), que tienen
-- sus propios checks.
set local session_replication_role = replica;

do $armazon$
declare
  v_orden uuid := current_setting('prueba.costeo.orden')::uuid;
  v_quien uuid := current_setting('prueba.costeo.costos')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_mat_a uuid := gen_random_uuid();
  v_mat_b uuid := gen_random_uuid();
  v_om_a uuid := gen_random_uuid();
  v_om_b uuid := gen_random_uuid();
  v_req uuid := gen_random_uuid();
  v_det_a uuid := gen_random_uuid();
  v_det_b uuid := gen_random_uuid();
  v_oc uuid := gen_random_uuid();
  v_desp_a uuid := gen_random_uuid();
  v_pla uuid := gen_random_uuid();
  v_per1 uuid := gen_random_uuid();
  v_per2 uuid := gen_random_uuid();
  v_g1 uuid := gen_random_uuid();
  v_g2 uuid := gen_random_uuid();
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000312', 'QA costeo');
  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
  select v_orden, '9312-2099', v_cliente, s.id, 'FABRICACION', 'NORMAL', 'Orden QA para el detalle del costeo', 'EN_PROCESO'
    from public.sedes s order by s.nombre limit 1;

  insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id)
  values (v_mat_a, 'QA-312-A', 'Plancha QA 6 mm', (select id from public.categorias_material order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'KG')),
         (v_mat_b, 'QA-312-B', 'Pistón QA', (select id from public.categorias_material order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  insert into public.ot_materiales (id, orden_id, material_id, cantidad, area_destino)
  values (v_om_a, v_orden, v_mat_a, 100, 'MTZ'), (v_om_b, v_orden, v_mat_b, 2, 'MTZ');
  insert into public.requerimientos_materiales (id, orden_id, area_destino, solicitado_por) values (v_req, v_orden, 'MTZ', v_quien);
  insert into public.requerimiento_material_detalles (id, requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen)
  values (v_det_a, v_req, v_om_a, 100, 'APROBADO', 'COMPRA'), (v_det_b, v_req, v_om_b, 2, 'APROBADO', 'COMPRA');

  insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, creado_en, condicion_pago, dias_credito, moneda)
  values (v_oc, v_req, 'Proveedor QA', 'OC-QA-312', now() - interval '3 days', 'CONTADO', 0, 'PEN');
  insert into public.orden_compra_material_detalles (orden_compra_id, requerimiento_id, requerimiento_detalle_id, cantidad, precio_unitario)
  values (v_oc, v_req, v_det_a, 100, 5.00), (v_oc, v_req, v_det_b, 2, 300.00);

  -- A: 100 kg a 5.10 congelado, menos 10 devueltos = 90 × 5.10 = 459.00.
  -- B: 2 und sin precio congelado: vale el de la compra, 2 × 300 = 600.00.
  insert into public.movimientos_materiales (id, tipo, requerimiento_detalle_id, cantidad, responsable_id, registrado_por, registrado_en, material_id, origen, cantidad_de_stock, precio_unitario, moneda, documento_referencia)
  values (v_desp_a, 'DESPACHO', v_det_a, 100, v_quien, v_quien, now() - interval '1 day', v_mat_a, 'COMPRA', 0, 5.10, 'PEN', 'VS-QA-1'),
         (gen_random_uuid(), 'DESPACHO', v_det_b, 2, v_quien, v_quien, now() - interval '1 day', v_mat_b, 'COMPRA', 0, null, null, 'VS-QA-2');
  insert into public.movimientos_materiales (id, tipo, cantidad, registrado_por, material_id, origen, documento_referencia, cantidad_de_stock, precio_unitario, moneda, devolucion_de)
  values (gen_random_uuid(), 'INGRESO', 10, v_quien, v_mat_a, 'DEVOLUCION', 'DEV-QA-1', 0, 5.10, 'PEN', v_desp_a);

  -- Planilla cerrada: 3000 y 2500 al 50 % en esta OT = 2750.00.
  insert into public.planillas (id, tipo, periodo, moneda, estado, cerrado_por, cerrado_en)
  values (v_pla, 'TALLER', date_trunc('month', current_date)::date, 'PEN', 'CERRADA', v_quien, now());
  insert into public.planilla_personas (id, planilla_id, nombre, monto) values (v_per1, v_pla, 'Persona QA 1', 3000), (v_per2, v_pla, 'Persona QA 2', 2500);
  insert into public.planilla_distribuciones (persona_id, orden_id, porcentaje) values (v_per1, v_orden, 50), (v_per2, v_orden, 50);

  -- Un gasto aprobado (400) y uno pendiente que no debe sumar.
  insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, revisado_por, revisado_en)
  values (v_g1, v_orden, (select id from public.areas where codigo = 'MTZ'), 'SERVICIO', 'Servicio QA de corte por plasma', current_date, 400, 'PEN',
          'ot/' || v_orden || '/gastos/' || v_g1 || '.pdf', 'F-QA-1.pdf', 'APROBADO', v_quien, now()),
         (v_g2, v_orden, (select id from public.areas where codigo = 'MTZ'), 'TRANSPORTE', 'Flete QA todavía sin revisar', current_date, 999, 'PEN',
          'ot/' || v_orden || '/gastos/' || v_g2 || '.pdf', 'F-QA-2.pdf', 'PENDIENTE', null, null);
end;
$armazon$;

set local session_replication_role = origin;

do $test$
declare
  v_orden uuid := current_setting('prueba.costeo.orden')::uuid;
  r record;
  v_suma numeric;
  v_lineas integer;
  v_fallo boolean := false;
begin
  perform test.como_usuario(current_setting('prueba.costeo.costos')::uuid);
  set local role authenticated;

  for r in select * from public.resumen_costeo_ot(v_orden) loop
    if r.fuente = 'MATERIALES_SIN_PRECIO' then
      select count(*) into v_lineas from public.detalle_costeo_ot(v_orden) d where d.fuente = r.fuente;
      if v_lineas <> r.pendientes then
        raise exception 'FALLO: % despachos sin precio en el detalle y % en el resumen', v_lineas, r.pendientes;
      end if;
    else
      select coalesce(sum(d.monto), 0) into v_suma
        from public.detalle_costeo_ot(v_orden) d
       where d.fuente = r.fuente and d.moneda is not distinct from r.moneda;
      if v_suma <> r.monto then
        raise exception 'FALLO: % en % suma % en el detalle y % en el resumen', r.fuente, r.moneda, v_suma, r.monto;
      end if;
    end if;
  end loop;

  select coalesce(sum(d.monto), 0) into v_suma from public.detalle_costeo_ot(v_orden) d where d.fuente = 'MATERIALES';
  if v_suma <> 1059.00 then raise exception 'FALLO: el material debía valer 1059.00 y vale %', v_suma; end if;
  select coalesce(sum(d.monto), 0) into v_suma from public.detalle_costeo_ot(v_orden) d where d.fuente = 'PLANILLA';
  if v_suma <> 2750.00 then raise exception 'FALLO: la planilla debía valer 2750.00 y vale %', v_suma; end if;
  select count(*) into v_lineas from public.detalle_costeo_ot(v_orden) d where d.fuente = 'PLANILLA';
  if v_lineas <> 1 then raise exception 'FALLO: la planilla debía salir en una sola línea y salió en %', v_lineas; end if;
  select coalesce(sum(d.monto), 0) into v_suma from public.detalle_costeo_ot(v_orden) d where d.fuente = 'GASTOS_AREA';
  if v_suma <> 400.00 then raise exception 'FALLO: el gasto pendiente no debía sumar; gastos = %', v_suma; end if;

  reset role;
  perform test.como_usuario(current_setting('prueba.costeo.operario')::uuid);
  set local role authenticated;
  begin
    perform * from public.detalle_costeo_ot(v_orden);
  exception when others then v_fallo := true;
  end;
  reset role;
  if not v_fallo then raise exception 'FALLO: un operario pudo leer el detalle del costeo'; end if;

  raise notice '  ok · el detalle del costeo suma lo mismo que el resumen y no lo lee quien no costea';
end;
$test$;

rollback;
