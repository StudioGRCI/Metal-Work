\set ON_ERROR_STOP on
-- El presupuesto de costo de una OT y su semáforo.
--
-- Una OT al 40 % de avance con una cotización de S/ 11,800 (IGV incluido) y
-- S/ 1,380 de costo (1,000 + US$ 100 × 3.80). Sin el IGV confirmado no hay
-- presupuesto. Confirmado, sale de la regla de la casa: 10,000 ÷ 1.15 =
-- 8,695.65, gastado el 15.9 %, EN_RANGO. Administración lo fija a mano en
-- 1,500 (92 % gastado con 40 % de avance: AJUSTADO) y luego en 1,300
-- (EXCEDIDO); Gerencia lo devuelve al de la cotización. Supervisión general lo
-- lee y no lo fija; Costos y Materiales y Ventas no lo ven. Con el costo
-- cerrado, el margen y el presupuesto usan el costo del cierre aunque después
-- llegue un gasto nuevo.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Gerencia','qa-318-gerencia@demo.pe','GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('QA','Oficina','qa-318-oficina@demo.pe','ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('QA','Costos','qa-318-costos@demo.pe','COSTOS_MATERIALES', :'sede_id') as costos_id \gset
select test.crear_usuario('QA','Ventas','qa-318-ventas@demo.pe','VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('QA','General','qa-318-general@demo.pe','SUPERVISOR_GENERAL', :'sede_id') as general_id \gset

select set_config('prueba.p.gerente', :'gerente_id', true);
select set_config('prueba.p.oficina', :'oficina_id', true);
select set_config('prueba.p.costos', :'costos_id', true);
select set_config('prueba.p.ventas', :'ventas_id', true);
select set_config('prueba.p.general', :'general_id', true);
select set_config('prueba.p.orden', gen_random_uuid()::text, true);
select set_config('prueba.p.cotizacion', gen_random_uuid()::text, true);

-- Armazón: la OT, su cotización, el cambio del día y dos gastos aprobados,
-- sin pasar por las reglas de cada tabla (tienen sus propios checks).
select test.como_usuario(:'costos_id');
set local session_replication_role = replica;

do $armazon$
declare
  v_orden uuid := current_setting('prueba.p.orden')::uuid;
  v_cot uuid := current_setting('prueba.p.cotizacion')::uuid;
  v_quien uuid := current_setting('prueba.p.costos')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_mtz uuid := (select id from public.areas where codigo = 'MTZ');
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000318', 'QA presupuesto de costo');

  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       monto_venta, moneda, estado, version, registrado_por)
  values (v_cot, 'QA-318-2099', v_cliente, (select id from public.tipos_carroceria order by nombre limit 1),
          'COT-QA-318.pdf', 'cot/' || v_cot || '/COT-QA-318.pdf', 11800, 'PEN', 'APROBADA', 1,
          current_setting('prueba.p.ventas')::uuid);

  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado,
                                      cotizacion_pdf_id, fecha_registro, avance_porcentaje)
  values (v_orden, '9318-2099', v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'Orden QA del presupuesto', 'EN_PROCESO',
          v_cot, current_date, 40);

  insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
  values (current_date, 3.75, 3.80, 'SUNAT', v_quien)
  on conflict (fecha) do update set compra = excluded.compra, venta = excluded.venta;

  insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, revisado_por, revisado_en)
  select g.id, v_orden, v_mtz, 'SERVICIO', g.descripcion, current_date, g.monto, g.moneda,
         'ot/' || v_orden || '/gastos/' || g.id || '.pdf', 'F-QA-318.pdf', 'APROBADO', v_quien, now()
    from (values
      (gen_random_uuid(), 'Servicio QA en soles del presupuesto', 1000::numeric, 'PEN'),
      (gen_random_uuid(), 'Servicio QA en dólares del presupuesto', 100::numeric, 'USD')
    ) as g(id, descripcion, monto, moneda);
end;
$armazon$;

set local session_replication_role = origin;

do $test$
declare
  v_orden uuid := current_setting('prueba.p.orden')::uuid;
  v_cot uuid := current_setting('prueba.p.cotizacion')::uuid;
  p record;
  m record;
  v_n integer;
begin
  -- Sin el IGV confirmado no se sabe la venta neta: no hay presupuesto.
  perform test.como_usuario(current_setting('prueba.p.gerente')::uuid);
  set local role authenticated;
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.presupuesto_pen is null and p.semaforo is null and p.costo_pen = 1380.00,
    format('sin IGV confirmado no hay presupuesto y el costo sí sale (dio %s, %s, %s)', p.presupuesto_pen, p.semaforo, p.costo_pen));
  reset role;

  perform test.como_usuario(current_setting('prueba.p.ventas')::uuid);
  set local role authenticated;
  perform public.confirmar_igv_cotizacion(v_cot, true);
  reset role;

  -- Con el IGV confirmado, el presupuesto sale de la cotización.
  perform test.como_usuario(current_setting('prueba.p.gerente')::uuid);
  set local role authenticated;
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.presupuesto_pen = 8695.65 and p.origen = 'COTIZACION' and p.utilidad_pct = 15,
    format('el presupuesto es 10,000 ÷ 1.15 = 8,695.65 de la cotización (dio %s, %s)', p.presupuesto_pen, p.origen));
  perform test.afirmar(p.consumido_pct = 15.9 and p.avance_pct = 40 and p.semaforo = 'EN_RANGO',
    format('1,380 es el 15.9 %% del presupuesto, en rango (dio %s %%, %s)', p.consumido_pct, p.semaforo));
  reset role;

  -- Administración lo fija a mano, con motivo.
  perform test.como_usuario(current_setting('prueba.p.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.fijar_presupuesto_ot(%L, 1500, %L)', v_orden, ''),
    'el presupuesto a mano pide motivo', 'Escribe por qué');
  perform test.debe_fallar(format('select public.fijar_presupuesto_ot(%L, 0, %L)', v_orden, 'Monto QA en cero'),
    'el presupuesto no puede ser cero', 'mayor que cero');
  perform public.fijar_presupuesto_ot(v_orden, 1500, 'Adicional QA aprobado por el cliente');
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.presupuesto_pen = 1500 and p.origen = 'MANUAL' and p.motivo = 'Adicional QA aprobado por el cliente'
                       and p.fijado_por is not null,
    format('el presupuesto a mano vale 1,500 con su motivo y quién (dio %s, %s, %s)', p.presupuesto_pen, p.origen, p.fijado_por));
  perform test.afirmar(p.consumido_pct = 92.0 and p.semaforo = 'AJUSTADO',
    format('92 %% gastado con 40 %% de avance es AJUSTADO (dio %s %%, %s)', p.consumido_pct, p.semaforo));
  perform public.fijar_presupuesto_ot(v_orden, 1300, 'Recorte QA del presupuesto');
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.semaforo = 'EXCEDIDO' and p.consumido_pct = 106.2,
    format('1,380 contra 1,300 es EXCEDIDO (dio %s %%, %s)', p.consumido_pct, p.semaforo));
  reset role;

  -- Supervisión general lo lee y no lo fija.
  perform test.como_usuario(current_setting('prueba.p.general')::uuid);
  set local role authenticated;
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.semaforo = 'EXCEDIDO', 'Supervisión general ve el semáforo');
  select count(*) into v_n from public.ot_presupuestos where orden_id = v_orden;
  perform test.afirmar(v_n = 1, 'Supervisión general lee el presupuesto fijado');
  perform test.debe_fallar(format('select public.fijar_presupuesto_ot(%L, 2000, %L)', v_orden, 'Intento QA de supervisión'),
    'Supervisión general no fija el presupuesto', 'Gerencia o Administración');
  reset role;

  -- Costos y Materiales no ve el precio: tampoco el presupuesto, que lo delata.
  perform test.como_usuario(current_setting('prueba.p.costos')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.presupuesto_ot(%L)', v_orden),
    'Costos y Materiales no ve el presupuesto', 'precio de venta');
  select count(*) into v_n from public.ot_presupuestos;
  perform test.afirmar(v_n = 0, 'Costos y Materiales no lee la tabla de presupuestos');
  perform test.debe_fallar(format('select public.fijar_presupuesto_ot(%L, 2000, %L)', v_orden, 'Intento QA de costos'),
    'Costos y Materiales no fija el presupuesto', 'Gerencia o Administración');
  reset role;

  -- Ventas tampoco: ve el precio pero no el costo.
  perform test.como_usuario(current_setting('prueba.p.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.presupuesto_ot(%L)', v_orden),
    'Ventas no ve el presupuesto', 'costos.ver');
  perform test.debe_fallar(format('select public.fijar_presupuesto_ot(%L, 2000, %L)', v_orden, 'Intento QA de ventas'),
    'Ventas no fija el presupuesto', 'Gerencia o Administración');
  reset role;

  -- Gerencia lo devuelve al de la cotización: la fila queda, sin monto.
  perform test.como_usuario(current_setting('prueba.p.gerente')::uuid);
  set local role authenticated;
  perform public.fijar_presupuesto_ot(v_orden, null, null);
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.presupuesto_pen = 8695.65 and p.origen = 'COTIZACION' and p.semaforo = 'EN_RANGO',
    format('de vuelta al de la cotización (dio %s, %s)', p.presupuesto_pen, p.origen));
  select count(*) into v_n from public.ot_presupuestos where orden_id = v_orden and monto_pen is null
     and motivo = 'Vuelve al presupuesto de la cotización';
  perform test.afirmar(v_n = 1, 'la vuelta al de la cotización queda anotada, no se borra');
  reset role;

  -- Costo cerrado: un gasto que llega después no mueve el margen.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set estado = 'TERMINADA' where id = v_orden;
  perform set_config('session_replication_role', 'origin', true);
  perform test.como_usuario(current_setting('prueba.p.costos')::uuid);
  set local role authenticated;
  perform public.cerrar_costo_ot(v_orden, 'Cierre QA del presupuesto');
  reset role;
  perform set_config('session_replication_role', 'replica', true);
  insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, revisado_por, revisado_en)
  select g, v_orden, (select id from public.areas where codigo = 'MTZ'), 'SERVICIO', 'Flete QA que llegó después del cierre',
         current_date, 500, 'PEN', 'ot/' || v_orden || '/gastos/' || g || '.pdf', 'F-QA-318-tarde.pdf', 'APROBADO',
         current_setting('prueba.p.costos')::uuid, now()
    from gen_random_uuid() g;
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.p.gerente')::uuid);
  set local role authenticated;
  select * into m from public.margen_ot(v_orden);
  perform test.afirmar(m.costo_pen = 1380.00 and m.margen_pen = 8620.00,
    format('con el costo cerrado el margen usa 1,380, no el vivo de 1,880 (dio %s y %s)', m.costo_pen, m.margen_pen));
  select * into p from public.presupuesto_ot(v_orden);
  perform test.afirmar(p.costo_pen = 1380.00, 'el presupuesto también se mide contra el costo cerrado');
  reset role;
end;
$test$;

rollback;
