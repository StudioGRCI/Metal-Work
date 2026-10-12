-- Orden de compra directa, recojo por el conductor, ingreso pendiente para
-- Almacén y orden de servicio, probados con el rol que hace cada trabajo (nunca
-- como ADMIN) y `set local role authenticated`. Termina en rollback: corre igual
-- en el banco local que contra la base viva sin dejar nada.
begin;

do $$
declare v text;
begin
  foreach v in array array['COMPRADOR', 'GERENTE', 'SUPERVISOR', 'CONDUCTOR'] loop
    perform set_config('prueba.' || lower(v), (
      select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
       where r.codigo = v and u.activo order by u.creado_en limit 1), true);
    if current_setting('prueba.' || lower(v)) = '' then
      raise exception 'FALLA: no hay una cuenta activa con el rol % para probar', v;
    end if;
  end loop;
  perform set_config('prueba.almacenero', (
    select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
      join public.areas a on a.id = u.area_id
     where r.codigo = 'ALMACENERO' and a.codigo = 'ALM' and u.activo order by u.creado_en limit 1), true);
  if current_setting('prueba.almacenero') = '' then
    raise exception 'FALLA: no hay un almacenero activo del área ALM para probar';
  end if;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- ----------------------------------------------------------------- armazón
-- Un proveedor del padrón, dos materiales de almacén y una OT con una línea
-- derivada a compra. Se arma como dueño de las tablas.
do $$
declare v_ot uuid; v_req uuid; v_mat uuid; v_om uuid; v_det uuid; i int;
begin
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono, contacto)
  values ('20100047218', 'PROVEEDOR DE PRUEBA 325', 'Av. Argentina 123, Lima', '999 111 222', 'Rosa')
  on conflict (tipo_documento, numero_documento) do update set activo = true
  returning id into v_mat;
  perform set_config('prueba.proveedor', v_mat::text, true);
  for i in 1..2 loop
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ('CHK325-' || i, 'Material directo ' || i,
            (select id from public.categorias_material order by 1 limit 1),
            (select id from public.unidades_medida order by 1 limit 1))
    returning id into v_mat;
    perform set_config('prueba.mat' || i, v_mat::text, true);
  end loop;

  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Prueba de recojo · check 325')
  returning id into v_ot;
  perform set_config('prueba.ot', v_ot::text, true);
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (v_ot, 'PRD', current_setting('prueba.supervisor')::uuid) returning id into v_req;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK325-REQ', 'Material de requerimiento',
          (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;
  perform set_config('prueba.mat_req', v_mat::text, true);
  insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
  values (v_ot, v_mat, 10, 'PRD') returning id into v_om;
  insert into public.requerimiento_material_detalles
    (requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen, cantidad_stock)
  values (v_req, v_om, 10, 'APROBADO', 'COMPRA', 0) returning id into v_det;
  update public.requerimiento_material_detalles
     set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0
   where id = v_det;
  perform set_config('prueba.det', v_det::text, true);
  -- La regla de monto, apagada: la directa igual pasa por Gerencia.
  update public.regla_aprobacion_compras set activa = false where unica;
  select set_config('prueba.oc1', gen_random_uuid()::text, true) into v_mat;
  select set_config('prueba.oc2', gen_random_uuid()::text, true) into v_mat;
  select set_config('prueba.oc3', gen_random_uuid()::text, true) into v_mat;
  select set_config('prueba.os1', gen_random_uuid()::text, true) into v_mat;
end $$;

-- ======================================================== 1. LA DIRECTA
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar(
  $q$select public.emitir_compra_directa(gen_random_uuid(), current_setting('prueba.proveedor')::uuid, null,
     'Reposición de consumibles', jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 5, 'precio', 10)),
     null, 'CONTADO', 0, 'PEN')$q$,
  'un supervisor no emite órdenes de compra');
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(
  $q$select public.emitir_compra_directa(gen_random_uuid(), current_setting('prueba.proveedor')::uuid, null,
     'no', jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 5, 'precio', 10)),
     null, 'CONTADO', 0, 'PEN')$q$,
  'la directa sin motivo no entra', 'sin requerimiento');
select test.debe_fallar(
  $q$select public.emitir_compra_directa(gen_random_uuid(), current_setting('prueba.proveedor')::uuid, null,
     'Reposición de consumibles', jsonb_build_array(
       jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 5, 'precio', 10),
       jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 2, 'precio', 10)),
     null, 'CONTADO', 0, 'PEN')$q$,
  'la directa no repite material', 'No repitas');
select public.emitir_compra_directa(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-77',
  'Reposición de consumibles del almacén', jsonb_build_array(
    jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 5, 'precio', 10),
    jsonb_build_object('material_id', current_setting('prueba.mat2'), 'cantidad', 2.5, 'precio', 40)),
  current_date + 3, 'CREDITO', 30, 'PEN');
-- El reintento del mismo envío devuelve la misma compra.
select test.afirmar(public.emitir_compra_directa(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-77',
  'Reposición de consumibles del almacén', jsonb_build_array(
    jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 5, 'precio', 10),
    jsonb_build_object('material_id', current_setting('prueba.mat2'), 'cantidad', 2.5, 'precio', 40)),
  current_date + 3, 'CREDITO', 30, 'PEN') = current_setting('prueba.oc1')::uuid, 'el doble toque no crea otra compra');
set constraints all immediate;
select test.afirmar(
  (select count(*) from public.ordenes_compra_listado() l where l.id = current_setting('prueba.oc1')::uuid
      and l.origen = 'DIRECTA' and l.numero ~ '^(OC-[0-9]{4,}-MW|PRUEBA-[0-9]+)$' and l.referencia = 'COT-77'
      and l.monto = 150 and l.lineas = 2 and l.aprobacion = 'POR_APROBAR') = 1,
  'Logística ve su directa en el listado con número de la casa, monto 150 y esperando a Gerencia aunque la regla esté apagada');
select test.afirmar(
  (select count(*) from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid) = 2,
  'Logística lee las líneas de la directa (la política ya no exige requerimiento)');
reset role;

-- Tesorería ve la directa a crédito entre las compras sin comprobante, sin OT y
-- con su número (migración 113000). Solo si hay una cuenta de Tesorería.
select set_config('prueba.tesoreria', coalesce((
  select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
   where r.codigo = 'TESORERIA' and u.activo order by u.creado_en limit 1), ''), true);
do $$
declare v integer;
begin
  if current_setting('prueba.tesoreria') = '' then
    raise notice 'Sin cuenta de Tesorería: no se prueba su lista de compras a crédito.';
    return;
  end if;
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  select count(*) into v from public.v_compras_credito_sin_comprobante c
   where c.orden_compra_id = current_setting('prueba.oc1')::uuid
     and c.numero_ot is null and c.numero is not null and c.total_estimado = 150;
  reset role;
  if v <> 1 then
    raise exception 'FALLA: Tesorería no ve la compra directa a crédito sin comprobante (vio %)', v;
  end if;
end $$;

select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.oc1')::uuid
      and usuario_id = current_setting('prueba.gerente')::uuid and ruta = '/compras/aprobacion') = 1,
  'a Gerencia le llega el aviso de la directa por aprobar');
select test.debe_fallar(
  $q$insert into public.orden_compra_material_detalles (orden_compra_id, requerimiento_id, requerimiento_detalle_id, cantidad, precio_unitario)
     select current_setting('prueba.oc1')::uuid, d.requerimiento_id, d.id, 1, 1
       from public.requerimiento_material_detalles d where d.id = current_setting('prueba.det')::uuid$q$,
  'una directa no admite líneas de requerimiento', 'directa no lleva');

-- Mientras espera, ni el conductor ni Logística la pueden mover.
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(not exists (select 1 from public.compras_para_recojo() r where r.id = current_setting('prueba.oc1')::uuid),
  'la directa por aprobar no le aparece al conductor');
select test.debe_fallar($q$select public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid)$q$,
  'el conductor no recoge lo que no se mandó a recojo', 'no está mandada');
select test.afirmar((select count(*) from public.ordenes_compra_materiales) = 0,
  'el conductor no lee la tabla de compras: todo le llega por su bandeja');
select test.debe_fallar($q$select public.ordenes_compra_listado()$q$, 'el conductor no ve el listado de compras');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid) = 0,
  'un supervisor no ve la directa');
select test.debe_fallar($q$select public.compras_para_recojo()$q$, 'un supervisor no ve los recojos');
reset role;

-- ======================================================== 2. GERENCIA APRUEBA
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.documentos_por_aprobar() d where d.id = current_setting('prueba.oc1')::uuid
      and d.tipo = 'OC' and d.origen = 'DIRECTA' and d.motivo = 'Reposición de consumibles del almacén'
      and jsonb_array_length(d.lineas) = 2 and d.lineas->0->>'material' like 'Material directo%') = 1,
  'Gerencia ve la directa con su motivo y sus dos materiales');
select public.aprobar_compra(current_setting('prueba.oc1')::uuid);
reset role;
select test.afirmar(
  (select recojo from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid) = 'POR_RECOGER',
  'al aprobarla, la directa sale sola hacia el conductor');
select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.oc1')::uuid
      and usuario_id = current_setting('prueba.conductor')::uuid and ruta = '/recojos') = 1,
  'al conductor le llega el aviso del recojo');

-- ======================================================== 3. EL CONDUCTOR
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.compras_para_recojo() r where r.id = current_setting('prueba.oc1')::uuid
      and r.recojo = 'POR_RECOGER' and r.proveedor_direccion = 'Av. Argentina 123, Lima'
      and jsonb_array_length(r.lineas) = 2 and not (r.lineas->0 ? 'precio_unitario')) = 1,
  'el conductor ve a dónde ir y qué recoger, sin precios');
select test.debe_fallar($q$select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid)$q$,
  'no se deja en almacén lo que no se marcó recogido', 'Marca primero');
select public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid);
select public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid);
select test.afirmar((select count(*) from public.ingresos_pendientes_almacen) = 0,
  'el conductor no lee los ingresos pendientes');
reset role;

select test.afirmar(
  (select recojo = 'DEJADO' and recogido_por = current_setting('prueba.conductor')::uuid
          and dejado_por = current_setting('prueba.conductor')::uuid and entregado_almacen_en is not null
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'recogido y dejado quedan con el conductor y la compra queda entregada a Almacén');
select test.afirmar(
  (select count(*) from public.ingresos_pendientes_almacen
    where orden_compra_id = current_setting('prueba.oc1')::uuid and estado = 'PENDIENTE'
      and requerimiento_detalle_id is null and orden_id is null and moneda = 'PEN') = 2
  and (select cantidad from public.ingresos_pendientes_almacen
        where orden_compra_id = current_setting('prueba.oc1')::uuid and material_id = current_setting('prueba.mat2')::uuid) = 2.5,
  'al dejarla nacen dos ingresos pendientes, uno por línea, con su cantidad (marcar dos veces no duplica)');
select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.oc1')::uuid
      and usuario_id = current_setting('prueba.almacenero')::uuid and ruta = '/almacen/kardex') = 1,
  'a Almacén le llega el aviso del ingreso por validar');
select test.debe_fallar(
  $q$update public.ordenes_compra_materiales set recojo = 'RECOGIDO' where id = current_setting('prueba.oc1')::uuid$q$,
  'el recojo no retrocede', 'no puede pasar');
select test.debe_fallar(
  $q$update public.ordenes_compra_materiales set dejado_en = now() - interval '1 day' where id = current_setting('prueba.oc1')::uuid$q$,
  'lo que marcó el conductor no se corrige', 'no se corrige');

-- ======================================================== 4. ALMACÉN LO VE
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.ingresos_pendientes_almacen where orden_compra_id = current_setting('prueba.oc1')::uuid) = 2,
  'Almacén ve los dos ingresos pendientes con su rol');
select test.debe_fallar(
  $q$update public.ingresos_pendientes_almacen set estado = 'VALIDADO' where orden_compra_id = current_setting('prueba.oc1')::uuid$q$,
  'Almacén no escribe la tabla a mano: valida por su función', 'permission denied');
select test.debe_fallar(
  $q$delete from public.ingresos_pendientes_almacen where orden_compra_id = current_setting('prueba.oc1')::uuid$q$,
  'nadie borra un ingreso pendiente', 'permission denied');
reset role;
select test.debe_fallar(
  $q$delete from public.ingresos_pendientes_almacen where orden_compra_id = current_setting('prueba.oc1')::uuid$q$,
  'ni el dueño de la tabla borra un ingreso pendiente', 'no se borra');
select test.debe_fallar(
  $q$update public.ingresos_pendientes_almacen set cantidad = 1 where orden_compra_id = current_setting('prueba.oc1')::uuid$q$,
  'lo que dejó el conductor no se corrige', 'no se corrige');
select test.debe_fallar(
  $q$update public.ingresos_pendientes_almacen set estado = 'VALIDADO' where orden_compra_id = current_setting('prueba.oc1')::uuid$q$,
  'VALIDADO exige quién, cuándo, cantidad y movimiento', 'ck_ingreso_pendiente_estado');

-- ======================================================== 5. LA DE REQUERIMIENTO
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_agrupada(current_setting('prueba.oc2')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-88',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det'), 'cantidad', 4, 'precio', 12)),
  null, 'CONTADO', 0, 'PEN');
set constraints all immediate;
select test.afirmar(
  (select origen = 'REQUERIMIENTO' and numero ~ '^(OC-[0-9]{4,}-MW|PRUEBA-[0-9]+)$' and aprobacion = 'NO_REQUERIDA' and recojo = 'POR_RECOGER'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid),
  'la compra de requerimiento también recibe número de la casa y, con la regla apagada, sale sola hacia el conductor');
select test.afirmar(
  (select material_id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc2')::uuid)
    = current_setting('prueba.mat_req')::uuid,
  'la línea de requerimiento se queda con su material');
-- Ya está con el conductor: volver a mandarla no hace nada.
select public.mandar_compra_a_recojo(current_setting('prueba.oc2')::uuid);
reset role;

select test.debe_fallar(
  $q$update public.ordenes_compra_materiales set entregado_almacen_en = now(), entregado_almacen_por = current_setting('prueba.comprador')::uuid
      where id = current_setting('prueba.oc2')::uuid$q$,
  'mientras está con el conductor, Logística no marca la entrega a Almacén', 'está con el conductor');

select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(current_setting('prueba.oc2')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc2')::uuid);
reset role;
select test.afirmar(
  (select count(*) from public.ingresos_pendientes_almacen
    where orden_compra_id = current_setting('prueba.oc2')::uuid and cantidad = 4 and precio_unitario = 12
      and requerimiento_detalle_id = current_setting('prueba.det')::uuid and orden_id = current_setting('prueba.ot')::uuid
      and material_id = current_setting('prueba.mat_req')::uuid) = 1,
  'el pendiente de una compra de requerimiento lleva su solicitud, su OT y su material');

-- ======================================================== 6. RECHAZO DE UNA DIRECTA
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(current_setting('prueba.oc3')::uuid, current_setting('prueba.proveedor')::uuid, null,
  'Compra para rechazar en la prueba', jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 1, 'precio', 99)),
  null, 'CONTADO', 0, 'USD');
set constraints all immediate;
reset role;
select test.afirmar((select referencia = numero from public.ordenes_compra_materiales where id = current_setting('prueba.oc3')::uuid),
  'sin referencia del proveedor, la directa repite su número de la casa');
select pg_temp.como('gerente');
set local role authenticated;
select public.rechazar_compra(current_setting('prueba.oc3')::uuid, 'El precio está muy alto para este material');
reset role;
select test.afirmar(
  (select aprobacion = 'RECHAZADA' and recojo is null and jsonb_array_length(lineas_rechazadas) = 1
          and lineas_rechazadas->0->>'material_id' = current_setting('prueba.mat1')
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc3')::uuid),
  'la directa rechazada guarda la copia de su línea y no va al conductor');

-- ======================================================== 7. ORDEN DE SERVICIO
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar(
  $q$select public.emitir_orden_servicio(gen_random_uuid(), current_setting('prueba.proveedor')::uuid, null, null,
     'Arenado del chasis completo', null, null, null, 'PEN', 800, 'CONTADO', 0)$q$,
  'un supervisor no emite órdenes de servicio');
select test.afirmar((select count(*) from public.ordenes_servicio) = 0, 'un supervisor no ve las órdenes de servicio');
reset role;

select pg_temp.como('comprador');
set local role authenticated;
-- Una OT vigente si la base tiene alguna (la del armazón nace en borrador, y a
-- una OT en borrador no se le piden servicios).
select set_config('prueba.ot_vigente', coalesce((select o.id::text from public.ots_para_logistica() o limit 1), ''), true);
select test.debe_fallar(
  $q$select public.emitir_orden_servicio(gen_random_uuid(), current_setting('prueba.proveedor')::uuid,
     current_setting('prueba.ot')::uuid, null, 'Arenado del chasis completo', null, null, null, 'PEN', 800, 'CONTADO', 0)$q$,
  'a una OT en borrador no se le piden servicios', 'no está vigente');
select public.emitir_orden_servicio(current_setting('prueba.os1')::uuid, current_setting('prueba.proveedor')::uuid,
  nullif(current_setting('prueba.ot_vigente'), '')::uuid, (select id from public.areas where codigo = 'ACB'),
  'Arenado y fondo del chasis completo', 'PROF-12', current_date, current_date + 5, 'PEN', 800, 'CREDITO', 15);
select test.afirmar(
  (select count(*) from public.ordenes_servicio_listado() s where s.id = current_setting('prueba.os1')::uuid
      and s.numero ~ '^(OS-[0-9]{3,}-MW|PRUEBA-[0-9]+)$' and s.estado = 'EMITIDA' and s.aprobacion = 'POR_APROBAR'
      and (s.orden is not null) = (current_setting('prueba.ot_vigente') <> '') and s.area = 'Acabados') = 1,
  'Logística emite la OS con número de la casa, su OT y el área que la pide');
select test.debe_fallar(
  $q$select public.avanzar_orden_servicio(current_setting('prueba.os1')::uuid, 'EN_EJECUCION', null)$q$,
  'la OS no se inicia sin la aprobación de Gerencia', 'cuando Gerencia la aprueba');
select test.debe_fallar(
  $q$update public.ordenes_servicio set monto = 1 where id = current_setting('prueba.os1')::uuid$q$,
  'nadie corrige la OS a mano', 'permission denied');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.documentos_por_aprobar() d where d.id = current_setting('prueba.os1')::uuid
      and d.tipo = 'OS' and d.monto = 800 and d.motivo = 'Arenado y fondo del chasis completo') = 1,
  'Gerencia ve la OS por aprobar con su monto y su descripción');
select public.aprobar_orden_servicio(current_setting('prueba.os1')::uuid);
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select public.avanzar_orden_servicio(current_setting('prueba.os1')::uuid, 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(current_setting('prueba.os1')::uuid, 'CONFORME', 'Volvió bien arenado');
select test.debe_fallar(
  $q$select public.avanzar_orden_servicio(current_setting('prueba.os1')::uuid, 'ANULADA', 'Intento de anular lo conforme')$q$,
  'una OS conforme no se anula', 'no se anula');
reset role;
select test.afirmar(
  (select estado = 'CONFORME' and conformidad_por = current_setting('prueba.comprador')::uuid
     from public.ordenes_servicio where id = current_setting('prueba.os1')::uuid),
  'la conformidad queda con quién y cuándo');
select test.debe_fallar(
  $q$delete from public.ordenes_servicio where id = current_setting('prueba.os1')::uuid$q$,
  'una OS no se borra', 'no se borra');

select 'OK: orden de compra directa, conductor, ingreso pendiente y orden de servicio con los roles reales' as comprobacion;
rollback;
