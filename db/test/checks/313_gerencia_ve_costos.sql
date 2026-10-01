\set ON_ERROR_STOP on
-- Gerencia lee el costo de una carrocería; Ventas no.
--
-- Se arma una OT con un gasto aprobado y se lee su costeo con una cuenta de
-- Gerencia, con su rol real. Después se comprueba que una cuenta de Ventas, que
-- no tiene `costos.ver`, sigue sin poder leerlo: el permiso se abrió a un
-- puesto, no a todos.
begin;

select test.crear_usuario('QA','Gerencia','qa-gerencia-costos@demo.pe','GERENTE',
  (select id from public.sedes order by nombre limit 1)) as gerente_id \gset
select test.crear_usuario('QA','Ventas','qa-ventas-costos@demo.pe','VENDEDOR',
  (select id from public.sedes order by nombre limit 1)) as ventas_id \gset
select gen_random_uuid() as orden_id \gset

select set_config('prueba.gerencia.orden', :'orden_id', true);
select set_config('prueba.gerencia.gerente', :'gerente_id', true);
select set_config('prueba.gerencia.ventas', :'ventas_id', true);

select test.como_usuario(:'gerente_id');
-- El armazón entra sin disparadores: lo que se prueba es quién lee el costeo.
set local session_replication_role = replica;

do $armazon$
declare
  v_orden uuid := current_setting('prueba.gerencia.orden')::uuid;
  v_quien uuid := current_setting('prueba.gerencia.gerente')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_gasto uuid := gen_random_uuid();
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000313', 'QA gerencia ve costos');
  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
  select v_orden, '9313-2099', v_cliente, s.id, 'FABRICACION', 'NORMAL', 'Orden QA para el costo que ve Gerencia', 'EN_PROCESO'
    from public.sedes s order by s.nombre limit 1;
  insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, revisado_por, revisado_en)
  values (v_gasto, v_orden, (select id from public.areas where codigo = 'MTZ'), 'SERVICIO', 'Servicio QA de rolado de planchas', current_date, 250, 'PEN',
          'ot/' || v_orden || '/gastos/' || v_gasto || '.pdf', 'F-QA-313.pdf', 'APROBADO', v_quien, now());
end;
$armazon$;

set local session_replication_role = origin;

do $test$
declare
  v_orden uuid := current_setting('prueba.gerencia.orden')::uuid;
  v_monto numeric;
  v_lineas integer;
  v_fallo boolean := false;
begin
  perform test.como_usuario(current_setting('prueba.gerencia.gerente')::uuid);
  set local role authenticated;

  select coalesce(sum(monto), 0) into v_monto from public.resumen_costeo_ot(v_orden) where fuente = 'GASTOS_AREA';
  if v_monto <> 250 then
    raise exception 'FALLO: Gerencia debía leer S/ 250.00 de gastos en el resumen y leyó %', v_monto;
  end if;
  select count(*) into v_lineas from public.detalle_costeo_ot(v_orden);
  if v_lineas <> 1 then
    raise exception 'FALLO: Gerencia debía leer una línea en el detalle y leyó %', v_lineas;
  end if;
  select count(*) into v_lineas from public.ot_gastos_areas where orden_id = v_orden;
  if v_lineas <> 1 then
    raise exception 'FALLO: Gerencia debía ver el gasto de la OT y vio % filas', v_lineas;
  end if;

  reset role;
  perform test.como_usuario(current_setting('prueba.gerencia.ventas')::uuid);
  set local role authenticated;
  begin
    perform * from public.resumen_costeo_ot(v_orden);
  exception when others then v_fallo := true;
  end;
  if not v_fallo then
    raise exception 'FALLO: Ventas no debía poder leer el costeo de la OT';
  end if;
  reset role;
end;
$test$;

rollback;
