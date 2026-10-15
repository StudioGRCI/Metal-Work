-- El proveedor trae sus cuentas bancarias y su dirección de recojo, y la OC
-- dice si viene con factura (en los dos casos se pide un comprobante) y el
-- código interno de la unidad. Probado
-- con el rol que hace cada trabajo (nunca como ADMIN) y `set local role
-- authenticated`. Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text;
begin
  foreach v in array array['COMPRADOR', 'GERENTE', 'TESORERIA', 'ALMACENERO', 'SUPERVISOR', 'CONDUCTOR'] loop
    perform set_config('prueba.' || lower(v), (
      select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
       where r.codigo = v and u.activo order by u.creado_en limit 1), true);
    if current_setting('prueba.' || lower(v)) = '' then
      raise exception 'FALLA: no hay una cuenta activa con el rol % para probar', v;
    end if;
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Desde la 20261016603000 la OC se corrige solo con su justificante: el
-- justificante lo sube quien corrige y `corregir_orden_compra` lo exige.
create or replace function pg_temp.corregir_oc(p_oc uuid, p_factura boolean, p_codigo text) returns uuid language plpgsql as $$
declare v_c uuid := gen_random_uuid(); v_ruta text := p_oc::text || '/' || v_c::text || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('justificantes-correccion', v_ruta, public.usuario_actual()::text, '{"mimetype":"application/pdf","size":900}');
  return public.corregir_orden_compra(v_c, p_oc, 'Corrección de prueba del check 331', v_ruta, 'correo.pdf',
    jsonb_build_object('con_factura', p_factura, 'codigo_interno', p_codigo));
end $$;

-- ----------------------------------------------------------------- armazón
-- Un material de almacén y una OT con una línea derivada a compra, como dueño.
do $$
declare v_ot uuid; v_req uuid; v_mat uuid; v_om uuid; v_det uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK330-DIR', 'Material directo 330',
          (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;
  perform set_config('prueba.mat', v_mat::text, true);

  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Prueba de comprobante · check 330')
  returning id into v_ot;
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (v_ot, 'PRD', current_setting('prueba.supervisor')::uuid) returning id into v_req;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK330-REQ', 'Material de requerimiento 330',
          (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;
  insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
  values (v_ot, v_mat, 10, 'PRD') returning id into v_om;
  insert into public.requerimiento_material_detalles
    (requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen, cantidad_stock)
  values (v_req, v_om, 10, 'APROBADO', 'COMPRA', 0) returning id into v_det;
  update public.requerimiento_material_detalles
     set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0
   where id = v_det;
  perform set_config('prueba.det', v_det::text, true);

  update public.regla_aprobacion_compras set activa = false where unica;
  perform set_config('prueba.oc1', gen_random_uuid()::text, true);
  perform set_config('prueba.oc2', gen_random_uuid()::text, true);
  perform set_config('prueba.doc', gen_random_uuid()::text, true);
end $$;

-- =================================== 1. LOGÍSTICA DA DE ALTA AL PROVEEDOR CON SUS CUENTAS
select pg_temp.como('comprador');
set local role authenticated;
insert into public.proveedores (numero_documento, razon_social, direccion, direccion_recojo, telefono)
values ('20100047218', 'Proveedor de prueba 330', 'Av. Argentina 456, Lima', '  Jr. Tienda 12, Trujillo  ', '999 333 444');
select set_config('prueba.proveedor', (select id::text from public.proveedores where numero_documento = '20100047218'), true);
select test.afirmar(
  (select direccion_recojo = 'Jr. Tienda 12, Trujillo' from public.proveedores where id = current_setting('prueba.proveedor')::uuid),
  'la dirección de recojo queda guardada y sin espacios de más');

select test.afirmar(
  public.guardar_cuentas_proveedor(current_setting('prueba.proveedor')::uuid, jsonb_build_array(
    jsonb_build_object('banco', 'bcp', 'numero_cuenta', '191-2345678-0-12', 'titular', 'Comercial  Ejemplo Norte', 'moneda', 'PEN'),
    jsonb_build_object('banco', 'BBVA', 'numero_cuenta', '0011 0234 5678', 'titular', 'Comercial Ejemplo Norte', 'moneda', 'USD'))) = 2,
  'Logística registra dos cuentas, una en soles y otra en dólares');
select test.afirmar(
  (select count(*) from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid
     and activo and banco = 'BCP' and numero_cuenta = '1912345678012' and titular = 'COMERCIAL EJEMPLO NORTE') = 1,
  'la cuenta queda en dígitos, con el banco y el titular en mayúsculas');
select test.debe_fallar(
  format($q$select public.guardar_cuentas_proveedor('%s', '[{"banco":"BCP","numero_cuenta":"12-AB","titular":"X Y","moneda":"PEN"}]')$q$,
         current_setting('prueba.proveedor')),
  'un número de cuenta con letras no entra');
select test.debe_fallar(
  format($q$select public.guardar_cuentas_proveedor('%s', '[{"banco":"BCP","numero_cuenta":"123456","titular":"X Y","moneda":"PEN"},{"banco":"BCP","numero_cuenta":"123-456","titular":"X Y","moneda":"PEN"}]')$q$,
         current_setting('prueba.proveedor')),
  'la misma cuenta dos veces en la lista no entra');

-- Quitar la de dólares la da de baja; volver a escribirla la reactiva.
select public.guardar_cuentas_proveedor(current_setting('prueba.proveedor')::uuid, (
  select jsonb_agg(jsonb_build_object('id', id, 'banco', banco, 'numero_cuenta', numero_cuenta, 'titular', titular, 'moneda', moneda))
    from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid and moneda = 'PEN'));
select test.afirmar(
  (select not activo from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid and moneda = 'USD'),
  'la cuenta que se quitó del formulario queda de baja, no se borra');
select public.guardar_cuentas_proveedor(current_setting('prueba.proveedor')::uuid, jsonb_build_array(
  jsonb_build_object('banco', 'BCP', 'numero_cuenta', '191-2345678-0-12', 'titular', 'Comercial Ejemplo Norte', 'moneda', 'PEN'),
  jsonb_build_object('banco', 'BBVA', 'numero_cuenta', '001102345678', 'titular', 'Comercial Ejemplo Norte', 'moneda', 'USD')));
select test.afirmar(
  (select count(*) from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid and activo) = 2
  and (select count(*) from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid) = 2,
  'volver a escribir la cuenta de baja la reactiva, sin duplicarla');
select test.debe_fallar(
  format($q$delete from public.proveedor_cuentas where proveedor_id = '%s'$q$, current_setting('prueba.proveedor')),
  'una cuenta no se borra, ni siquiera Logística');
reset role;

-- =================================== 2. QUIÉN VE LAS CUENTAS
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid) = 2,
  'Tesorería ve las cuentas para pagar');
select test.debe_fallar(
  format($q$select public.guardar_cuentas_proveedor('%s', '[]')$q$, current_setting('prueba.proveedor')),
  'Tesorería no cambia las cuentas');
select test.debe_fallar(
  format($q$insert into public.proveedor_cuentas (proveedor_id, banco, numero_cuenta, titular) values ('%s', 'BCP', '999999', 'X Y')$q$,
         current_setting('prueba.proveedor')),
  'Tesorería no da de alta cuentas por la tabla');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.proveedores where id = current_setting('prueba.proveedor')::uuid) = 1
  and (select count(*) from public.proveedor_cuentas where proveedor_id = current_setting('prueba.proveedor')::uuid) = 0,
  'Almacén ve al proveedor pero no sus cuentas');
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.proveedor_cuentas) = 0,
  'el conductor no ve ninguna cuenta bancaria');
reset role;

-- =================================== 3. LA OC DIRECTA SIN FACTURA
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid, null,
  'Reposición de pintura para la prueba 330',
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 2, 'precio', 59.32)),
  null, 'CONTADO', 0, 'PEN', false, '  PLANTA ');
set constraints all immediate;
select test.afirmar(
  (select not con_factura and codigo_interno = 'PLANTA' and aprobacion = 'POR_APROBAR'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'la OC directa queda sin factura, para PLANTA, y espera a Gerencia');
select test.afirmar(
  (select not tiene_factura from public.ordenes_compra_listado() where id = current_setting('prueba.oc1')::uuid),
  'el listado la muestra sin comprobante todavía');
select pg_temp.corregir_oc(current_setting('prueba.oc1')::uuid, true, 'PLANTA');
select pg_temp.corregir_oc(current_setting('prueba.oc1')::uuid, false, 'PLA_SR_O4_1_26/28');
select test.afirmar(
  (select not con_factura and codigo_interno = 'PLA_SR_O4_1_26/28' from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'Logística corrige con o sin factura y el código interno mientras no haya comprobante');
select test.debe_fallar(
  format($q$select pg_temp.corregir_oc('%s', false, ' ')$q$, current_setting('prueba.oc1')),
  'el código interno no se deja en blanco');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(
  format($q$select pg_temp.corregir_oc('%s', true, 'PLANTA')$q$, current_setting('prueba.oc1')),
  'Almacén no cambia si la compra viene con factura');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc1')::uuid);
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select proveedor_direccion = 'Jr. Tienda 12, Trujillo' from public.compras_para_recojo() where id = current_setting('prueba.oc1')::uuid),
  'el conductor va a la dirección de recojo, no a la fiscal');
select test.afirmar(
  (select not con_factura and not comprobante_adjunto and codigo_interno = 'PLA_SR_O4_1_26/28'
     from public.datos_de_recojo() where id = current_setting('prueba.oc1')::uuid),
  'el conductor sabe que es sin factura, que falta el comprobante y para qué unidad es');
reset role;

-- El comprobante sin factura se adjunta con su tipo y cuenta como comprobante.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('documentos-compras', 'compra/' || current_setting('prueba.oc1') || '/' || current_setting('prueba.doc') || '.pdf',
        current_setting('prueba.comprador'), '{"mimetype":"application/pdf","size":1200}');
select pg_temp.como('comprador');
set local role authenticated;
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (current_setting('prueba.doc')::uuid, current_setting('prueba.oc1')::uuid, 'COMPROBANTE', 'nota de venta.pdf',
        'compra/' || current_setting('prueba.oc1') || '/' || current_setting('prueba.doc') || '.pdf',
        'application/pdf', 1200, current_setting('prueba.comprador')::uuid);
select test.afirmar(
  (select tiene_factura from public.ordenes_compra_listado() where id = current_setting('prueba.oc1')::uuid),
  'con la nota de venta adjunta, la OC sin factura ya tiene su comprobante');
select test.debe_fallar(
  format($q$select pg_temp.corregir_oc('%s', true, 'PLANTA')$q$, current_setting('prueba.oc1')),
  'con el comprobante adjunto ya no se cambia a «con factura»');
select pg_temp.corregir_oc(current_setting('prueba.oc1')::uuid, false, 'PLANTA');
select test.afirmar(
  (select codigo_interno = 'PLANTA' from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'el código interno se sigue corrigiendo con el comprobante adjunto');
reset role;

-- =================================== 4. LA OC DE REQUERIMIENTO, IGUAL
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_agrupada(current_setting('prueba.oc2')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-330',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det'), 'cantidad', 2, 'precio', 15)),
  null, 'CONTADO', 0, 'PEN', true, 'PLA_SR_O4_1_26/28');
set constraints all immediate;
select test.afirmar(
  (select con_factura and codigo_interno = 'PLA_SR_O4_1_26/28' and recojo = 'POR_RECOGER' from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid),
  'la OC de requerimiento con factura sale sola hacia el conductor, como antes');
select test.debe_fallar(
  format($q$select public.emitir_compra_agrupada('%s', '%s', null, '[]', null, 'CONTADO', 0, 'PEN', null, 'PLANTA')$q$,
         gen_random_uuid(), current_setting('prueba.proveedor')),
  'sin decir si viene con factura no se emite');
select test.debe_fallar(
  format($q$select public.emitir_compra_directa('%s', '%s', null, 'Reposición de prueba', '[]', null, 'CONTADO', 0, 'PEN', true, '')$q$,
         gen_random_uuid(), current_setting('prueba.proveedor')),
  'sin código interno no se emite');
reset role;

do $$ begin raise notice 'OK 331: el proveedor trae su cuenta y la OC su comprobante'; end $$;
rollback;
