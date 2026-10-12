-- Padrón de proveedores, aprobación de compras y stock mínimo, probados con el
-- rol que hace cada trabajo (nunca como ADMIN) y `set local role authenticated`.
-- Todo dentro de una transacción que termina en rollback: corre igual en el
-- banco local que contra la base viva sin dejar nada.
--
-- Las personas se toman de la base por su rol: Logística (COMPRADOR), Almacén
-- (ALMACENERO del área ALM), Gerencia (GERENTE), Contabilidad (CONTABILIDAD) y un
-- supervisor de taller como quien no tiene nada que ver con compras.
begin;

do $$
declare
  v text;
begin
  foreach v in array array['COMPRADOR', 'GERENTE', 'CONTABILIDAD', 'SUPERVISOR'] loop
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
-- Una OT con cuatro líneas aprobadas por Diseño y derivadas a compra por
-- Almacén, y un material de almacén para el stock mínimo. Se arma como dueño
-- de las tablas: lo que se prueba viene después, con cada rol.
do $$
declare
  v_ot uuid; v_req uuid; v_mat uuid; v_om uuid; v_det uuid; i int;
begin
  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Prueba de compras · check 324')
  returning id into v_ot;
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (v_ot, 'PRD', current_setting('prueba.supervisor')::uuid) returning id into v_req;
  for i in 1..4 loop
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ('CHK324-' || i, 'Material de prueba ' || i,
            (select id from public.categorias_material order by 1 limit 1),
            (select id from public.unidades_medida order by 1 limit 1))
    returning id into v_mat;
    insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
    values (v_ot, v_mat, 10, 'PRD') returning id into v_om;
    insert into public.requerimiento_material_detalles
      (requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen, cantidad_stock)
    values (v_req, v_om, 10, 'APROBADO', 'COMPRA', 0) returning id into v_det;
    -- La línea nace como propuesta (fn_material_propuesta_inicial): se deja
    -- como la dejarían Diseño al aprobarla y Almacén al derivarla a compra.
    update public.requerimiento_material_detalles
       set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0
     where id = v_det;
    perform set_config('prueba.det' || i, v_det::text, true);
  end loop;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK324-MIN', 'Material con mínimo',
          (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;
  perform set_config('prueba.material_min', v_mat::text, true);
  -- La regla empieza como nace en la migración: apagada.
  update public.regla_aprobacion_compras set activa = false where unica;
end $$;

-- ======================================================== 1. PADRÓN
select test.afirmar(public.ruc_es_valido('20601538840'), 'el RUC de Metal Work pasa el dígito verificador');
select test.afirmar(not public.ruc_es_valido('20601538841'), 'un RUC con el último dígito mal copiado no pasa');
select test.afirmar(not public.ruc_es_valido('30601538840'), 'un RUC sin prefijo de contribuyente no pasa');

select pg_temp.como('comprador');
set local role authenticated;

insert into public.proveedores (numero_documento, razon_social, rubro, condicion_pago, dias_credito)
values ('20100047218', '  banco de   prueba s.a.a. ', 'Servicios financieros', 'CREDITO', 30);
select test.afirmar(
  (select razon_social from public.proveedores where numero_documento = '20100047218') = 'BANCO DE PRUEBA S.A.A.',
  'Logística da de alta un proveedor y la razón social queda en mayúsculas, sin espacios de más');
select set_config('prueba.proveedor', (select id::text from public.proveedores where numero_documento = '20100047218'), true);

select test.debe_fallar(
  $q$insert into public.proveedores (numero_documento, razon_social) values ('20100047219', 'RUC MAL COPIADO')$q$,
  'un RUC con el dígito verificador mal no entra al padrón', 'ck_proveedores_documento');
select test.debe_fallar(
  $q$insert into public.proveedores (numero_documento, razon_social) values ('20100047218', 'OTRO NOMBRE')$q$,
  'el mismo RUC no entra dos veces', 'uq_proveedores_documento');
select test.debe_fallar(
  $q$delete from public.proveedores where numero_documento = '20100047218'$q$,
  'un proveedor no se borra, se da de baja', 'permission denied');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
do $$ declare v int; begin
  update public.proveedores set telefono = '044 123456' where id = current_setting('prueba.proveedor')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Contabilidad corrige un proveedor (afecta una fila, no cero)');
end $$;
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from public.proveedores where id = current_setting('prueba.proveedor')::uuid) = 1,
  'Almacén ve el padrón');
select test.debe_fallar(
  $q$insert into public.proveedores (numero_documento, razon_social) values ('20601538840', 'ALMACEN NO DA DE ALTA')$q$,
  'Almacén no da de alta proveedores', 'row-level security');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select count(*) from public.proveedores) = 0, 'el taller no ve el padrón de proveedores');
reset role;

-- ======================================================== 2. COMPRA DEL PADRÓN
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.crear_compra_agrupada(gen_random_uuid(), 'ESCRITO A MANO', 'OC-X', '[{"id":"%s","cantidad":1,"precio":1}]'::jsonb, null, 'CONTADO', 0, 'PEN')$q$,
         current_setting('prueba.det1')),
  'la aplicación ya no puede emitir una compra con el proveedor escrito a mano', 'permission denied');

select set_config('prueba.oc1', gen_random_uuid()::text, true);
select public.emitir_compra_agrupada(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK-1', jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det1'), 'cantidad', 10, 'precio', 50)),
  null, 'CONTADO', 0, 'PEN');
select test.afirmar(
  (select proveedor_id = current_setting('prueba.proveedor')::uuid and proveedor = 'BANCO DE PRUEBA S.A.A.'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'la compra guarda el proveedor del padrón y su razón social');
select test.afirmar(
  public.emitir_compra_agrupada(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid,
    'OC-CHK-1', jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det1'), 'cantidad', 10, 'precio', 50)),
    null, 'CONTADO', 0, 'PEN') = current_setting('prueba.oc1')::uuid,
  'reintentar la misma compra no la duplica');
reset role;
set constraints all immediate;
set constraints all deferred;
select test.afirmar(
  (select aprobacion = 'NO_REQUERIDA' and monto_pen = 500 from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'con la regla apagada la compra no pide aprobación y guarda su monto en soles');

-- ======================================================== 3. LA REGLA
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(
  $q$select public.fijar_regla_aprobacion_compras(true, 100, (select rol_aprobador_id from public.regla_aprobacion_compras))$q$,
  'Logística no fija quién le aprueba', 'permiso');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select public.fijar_regla_aprobacion_compras(true, 100, (select id from public.roles where codigo = 'GERENTE'));
select test.afirmar((select activa and monto_desde = 100 from public.regla_aprobacion_compras where unica),
  'Gerencia enciende la regla desde S/ 100');
reset role;

-- Una compra de S/ 300 pide aprobación; una de S/ 40 no.
select pg_temp.como('comprador');
set local role authenticated;
select set_config('prueba.oc2', gen_random_uuid()::text, true);
select public.emitir_compra_agrupada(current_setting('prueba.oc2')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK-2', jsonb_build_array(
    jsonb_build_object('id', current_setting('prueba.det2'), 'cantidad', 10, 'precio', 20),
    jsonb_build_object('id', current_setting('prueba.det3'), 'cantidad', 5, 'precio', 20)),
  null, 'CREDITO', 30, 'PEN');
select set_config('prueba.oc3', gen_random_uuid()::text, true);
select public.emitir_compra_agrupada(current_setting('prueba.oc3')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK-3', jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det4'), 'cantidad', 2, 'precio', 20)),
  null, 'CONTADO', 0, 'PEN');
reset role;
set constraints all immediate;
set constraints all deferred;
select test.afirmar((select aprobacion from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid) = 'POR_APROBAR',
  'la compra de S/ 300 queda por aprobar');
select test.afirmar((select aprobacion from public.ordenes_compra_materiales where id = current_setting('prueba.oc3')::uuid) = 'NO_REQUERIDA',
  'la compra de S/ 40 no pide aprobación');
select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.oc2')::uuid
      and usuario_id = current_setting('prueba.gerente')::uuid) = 1,
  'Gerencia recibe un aviso de la compra por aprobar');

select test.debe_fallar(
  format($q$update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = '%s'$q$, current_setting('prueba.oc2')),
  'una compra por aprobar no se entrega a Almacén', 'espera la aprobación');

select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.aprobar_compra('%s')$q$, current_setting('prueba.oc2')),
  'Logística no se aprueba sus propias compras', 'Solo el puesto');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar($q$select * from public.compras_para_aprobar()$q$,
  'el taller no ve la bandeja de aprobación', 'permiso');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select monto = 300 and array_length(ordenes, 1) = 1 and jsonb_array_length(lineas) = 2
     from public.compras_para_aprobar() where id = current_setting('prueba.oc2')::uuid),
  'Gerencia ve la compra con su monto, su OT y sus dos líneas');
select public.aprobar_compra(current_setting('prueba.oc2')::uuid);
select test.afirmar(public.aprobar_compra(current_setting('prueba.oc2')::uuid) = current_setting('prueba.oc2')::uuid,
  'aprobar dos veces no falla');
reset role;
select test.afirmar(
  (select aprobacion = 'APROBADA' and aprobado_por = current_setting('prueba.gerente')::uuid and monto_aprobado_pen = 300
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid),
  'la compra queda aprobada con quién y cuánto');
select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.oc2')::uuid
      and usuario_id = current_setting('prueba.comprador')::uuid) = 1,
  'Logística recibe el aviso de su compra aprobada');

-- Rechazo: se emite otra compra por S/ 200 con lo que quedaba de det2.
select pg_temp.como('comprador');
set local role authenticated;
select set_config('prueba.oc4', gen_random_uuid()::text, true);
select public.emitir_compra_agrupada(current_setting('prueba.oc4')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK-4', jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det3'), 'cantidad', 5, 'precio', 40)),
  null, 'CONTADO', 0, 'PEN');
reset role;
set constraints all immediate;
set constraints all deferred;

select pg_temp.como('gerente');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.rechazar_compra('%s', 'caro')$q$, current_setting('prueba.oc4')),
  'un rechazo sin motivo no entra', 'motivo');
select public.rechazar_compra(current_setting('prueba.oc4')::uuid, 'Precio por encima de la última compra; cotizar otra vez.');
reset role;
select test.afirmar(
  (select aprobacion = 'RECHAZADA' and jsonb_array_length(lineas_rechazadas) = 1
     and not exists (select 1 from public.orden_compra_material_detalles d where d.orden_compra_id = c.id)
     from public.ordenes_compra_materiales c where c.id = current_setting('prueba.oc4')::uuid),
  'la compra rechazada se queda con su copia de líneas y las libera');

select pg_temp.como('comprador');
set local role authenticated;
select set_config('prueba.oc5', gen_random_uuid()::text, true);
select public.emitir_compra_agrupada(current_setting('prueba.oc5')::uuid, current_setting('prueba.proveedor')::uuid,
  'OC-CHK-5', jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det3'), 'cantidad', 5, 'precio', 18)),
  null, 'CONTADO', 0, 'PEN');
select test.afirmar(true, 'lo rechazado se vuelve a comprar con otra orden');
reset role;

-- ======================================================== 4. STOCK MÍNIMO
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.fijar_stock_minimo('%s', 8)$q$, current_setting('prueba.material_min')),
  'Logística no fija el stock mínimo', 'permiso');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select public.fijar_stock_minimo(current_setting('prueba.material_min')::uuid, 8);
select public.registrar_ingreso_almacen(gen_random_uuid(), current_setting('prueba.material_min')::uuid, 10,
  'SALDO_INICIAL', 'Conteo de prueba', 2.5, 'PEN');
select public.registrar_conteo_almacen(gen_random_uuid(), current_setting('prueba.material_min')::uuid, 7,
  'Conteo de prueba: faltan tres unidades');
reset role;
select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.material_min')::uuid
      and usuario_id = current_setting('prueba.almacenero')::uuid) = 1
  and (select count(*) from public.notificaciones where origen_id = current_setting('prueba.material_min')::uuid
      and usuario_id = current_setting('prueba.comprador')::uuid and ruta = '/compras') = 1
  and (select ruta from public.notificaciones where origen_id = current_setting('prueba.material_min')::uuid
      and usuario_id = current_setting('prueba.almacenero')::uuid) like '/almacen/kardex?material=%',
  'al bajar de 10 a 7 con mínimo 8 avisa a Almacén (al kardex) y a Logística (a Compras), una vez a cada uno');

select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_conteo_almacen(gen_random_uuid(), current_setting('prueba.material_min')::uuid, 6,
  'Conteo de prueba: falta una unidad más');
reset role;
select test.afirmar(
  (select count(*) from public.notificaciones where origen_id = current_setting('prueba.material_min')::uuid
      and usuario_id = current_setting('prueba.almacenero')::uuid) = 1,
  'seguir bajando ya por debajo del mínimo no repite el aviso');

select 'OK: padrón, aprobación de compras y stock mínimo con los roles reales' as comprobacion;
rollback;
