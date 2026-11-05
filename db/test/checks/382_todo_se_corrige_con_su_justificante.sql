-- Todo se corrige con su justificante: el RQ (Requerimientos), la OC
-- (Logística) y la factura de compra (Contabilidad). Sin el archivo no hay
-- corrección; cada una deja motivo, antes, después, quién y cuándo, y no se
-- edita ni se borra. Un reintento con el mismo id se reconoce solo si trae lo
-- mismo: el justificante, quién, el motivo y los cambios (migración
-- 20261022180000). Cada paso con el rol que lo hace —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000382', 'PRUEBAS CORRECCIONES S.A.C.' where not exists (select 1 from public.empresa);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid; v_mat uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'CONTABILIDAD:', 'TESORERIA:', 'VENDEDOR:'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.382@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 382', lower(split_part(v, ':', 1)) || '.382@prueba.local', r.id,
           (select id from public.areas where codigo = nullif(split_part(v, ':', 2), ''))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'requerimientos2.382@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
  select v_id, 'REQUERIMIENTOS 2', 'Check 382', 'requerimientos2.382@prueba.local', r.id, (select id from public.areas where codigo = 'REQ')
    from public.roles r where r.codigo = 'REQUERIMIENTOS';
  perform set_config('prueba.requerimientos2', v_id::text, true);
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  foreach v in array array['rq', 'm1', 'm2', 'oc1', 'oc2', 'oc3', 'adq', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'pdf'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  -- El catálogo, dos proveedores y tres OC directas al contado con factura, como dueño:
  --   oc1  10 × 100.00 → 1 180.00 · oc2  1 × 50.00 → 59.00 · oc3 rechazada
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente, activo) values
    (current_setting('prueba.m1')::uuid, 'CHK382-1', 'Plancha LAC 2 mm (prueba 382)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid, false, true),
    (current_setting('prueba.m2')::uuid, 'CHK382-2', 'Plancha LAC 3 mm (prueba 382)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid, false, true);
  insert into public.proveedores (numero_documento, razon_social) values ('20100038201', 'PROVEEDOR 382')
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  insert into public.ordenes_compra_materiales (id, proveedor_id, proveedor, referencia, condicion_pago, dias_credito, moneda, origen,
                                                motivo, con_factura, codigo_interno, creado_por, aprobacion, rechazado_por, rechazado_en, motivo_rechazo)
  select current_setting('prueba.' || k)::uuid, p.id, p.razon_social, 'QA382-' || k, 'CONTADO', 0, 'PEN', 'DIRECTA',
         'Reposición de prueba 382', true, 'PLANTA', current_setting('prueba.comprador')::uuid,
         case when k = 'oc3' then 'RECHAZADA' else 'NO_REQUERIDA' end,
         case when k = 'oc3' then current_setting('prueba.comprador')::uuid end, case when k = 'oc3' then now() end,
         case when k = 'oc3' then 'No se compra este mes.' end
    from public.proveedores p, unnest(array['oc1', 'oc2', 'oc3']) k where p.numero_documento = '20100038201';
  insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, material_id) values
    (current_setting('prueba.oc1')::uuid, 10, 100.00, current_setting('prueba.m1')::uuid),
    (current_setting('prueba.oc2')::uuid, 1, 50.00, current_setting('prueba.m1')::uuid),
    (current_setting('prueba.oc3')::uuid, 1, 50.00, current_setting('prueba.m1')::uuid);
end $$;
select set_config('prueba.caja', test.crear_caja()::text, true);  -- desde la 20261019100000 todo pago pide su cuenta

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- El justificante, subido por quien corrige: <documento>/<corrección>.pdf
create or replace function pg_temp.justificante(p_documento text, p_correccion text) returns text language plpgsql as $$
declare v_ruta text := current_setting('prueba.' || p_documento) || '/' || current_setting('prueba.' || p_correccion) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('justificantes-correccion', v_ruta, public.usuario_actual()::text, '{"mimetype": "application/pdf", "size": 3072}');
  return v_ruta;
end $$;

-- ============================================ 1. El requerimiento
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK382_SR_1', 'Armado de la plataforma de prueba 382', null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 4)));

select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Se pidió en 2 mm y era 3 mm', '%s/%s.pdf', 'correo.pdf',
  '{"lineas": [{"item": 1, "material_id": "%s"}]}'::jsonb)$q$, current_setting('prueba.c1'), current_setting('prueba.rq'),
  current_setting('prueba.rq'), current_setting('prueba.c1'), current_setting('prueba.m2')),
  'sin el justificante subido no hay corrección', 'vuelve a adjuntarlo');
select pg_temp.justificante('rq', 'c1');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Error', '%s/%s.pdf', 'correo.pdf',
  '{"lineas": [{"item": 1, "material_id": "%s"}]}'::jsonb)$q$, current_setting('prueba.c1'), current_setting('prueba.rq'),
  current_setting('prueba.rq'), current_setting('prueba.c1'), current_setting('prueba.m2')),
  'sin un motivo de verdad no hay corrección', 'por qué se corrige');
select public.corregir_requerimiento(current_setting('prueba.c1')::uuid, current_setting('prueba.rq')::uuid,
  'Maestranza pidió plancha de 2 mm y el plano dice 3 mm', current_setting('prueba.rq') || '/' || current_setting('prueba.c1') || '.pdf',
  'correo-maestranza.pdf',
  format('{"codigo_interno": "CHK382_SR_2", "lineas": [{"item": 1, "material_id": "%s", "cantidad": 6}]}', current_setting('prueba.m2'))::jsonb);
-- Un reintento con la misma corrección no anota otra.
select public.corregir_requerimiento(current_setting('prueba.c1')::uuid, current_setting('prueba.rq')::uuid,
  'Maestranza pidió plancha de 2 mm y el plano dice 3 mm', current_setting('prueba.rq') || '/' || current_setting('prueba.c1') || '.pdf',
  'correo-maestranza.pdf',
  format('{"codigo_interno": "CHK382_SR_2", "lineas": [{"item": 1, "material_id": "%s", "cantidad": 6}]}', current_setting('prueba.m2'))::jsonb);
select test.afirmar(
  (select l.material_id = current_setting('prueba.m2')::uuid and l.cantidad = 6 and l.descripcion = 'Plancha LAC 3 mm (prueba 382)'
          and r.codigo_interno = 'CHK382_SR_2'
     from public.requerimiento_lineas l join public.requerimientos r on r.id = l.requerimiento_id
    where r.id = current_setting('prueba.rq')::uuid and l.item = 1),
  'Requerimientos corrige el material, la cantidad y el código, con el nombre del catálogo');
select test.afirmar(
  (select count(*) = 1 and bool_and(c.corregido_por = current_setting('prueba.requerimientos')::uuid
                                    and c.antes->>'codigo_interno' = 'CHK382_SR_1' and c.despues->>'codigo_interno' = 'CHK382_SR_2'
                                    and c.justificante_mime = 'application/pdf' and c.justificante_nombre = 'correo-maestranza.pdf'
                                    and c.huella_del_envio is not null)
     from public.correcciones c where c.documento_id = current_setting('prueba.rq')::uuid),
  'la corrección queda una vez, con quién, antes, después, su justificante y la huella de su envío');
-- Otro envío con el mismo id ya no es el mismo (migración 20261022180000): las
-- dos respuestas se perdieron y en la misma ventana se eligió otro justificante,
-- se cambió el motivo o se cambió un dato antes de volver a pulsar.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('justificantes-correccion', current_setting('prueba.rq') || '/' || current_setting('prueba.c1') || '.jpg',
        public.usuario_actual()::text, '{"mimetype": "image/jpeg", "size": 2048}');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Maestranza pidió plancha de 2 mm y el plano dice 3 mm',
  '%s/%s.jpg', 'foto.jpg', '{"codigo_interno": "CHK382_SR_2", "lineas": [{"item": 1, "material_id": "%s", "cantidad": 6}]}'::jsonb)$q$,
  current_setting('prueba.c1'), current_setting('prueba.rq'), current_setting('prueba.rq'), current_setting('prueba.c1'), current_setting('prueba.m2')),
  'con otro justificante y el mismo id, la corrección no se da por registrada', 'ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'El plano final pide plancha de 3 mm, no de 2',
  '%s/%s.pdf', 'correo-maestranza.pdf', '{"codigo_interno": "CHK382_SR_2", "lineas": [{"item": 1, "material_id": "%s", "cantidad": 6}]}'::jsonb)$q$,
  current_setting('prueba.c1'), current_setting('prueba.rq'), current_setting('prueba.rq'), current_setting('prueba.c1'), current_setting('prueba.m2')),
  'ni con el mismo justificante y otro motivo', 'ya quedó registrada la primera vez que la enviaste');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Maestranza pidió plancha de 2 mm y el plano dice 3 mm',
  '%s/%s.pdf', 'correo-maestranza.pdf', '{"codigo_interno": "CHK382_SR_2", "lineas": [{"item": 1, "material_id": "%s", "cantidad": 5}]}'::jsonb)$q$,
  current_setting('prueba.c1'), current_setting('prueba.rq'), current_setting('prueba.rq'), current_setting('prueba.c1'), current_setting('prueba.m2')),
  'ni con el mismo justificante, el mismo motivo y otra cantidad', 'ya quedó registrada la primera vez que la enviaste');
reset role;
select pg_temp.como('requerimientos2');
set local role authenticated;
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Maestranza pidió plancha de 2 mm y el plano dice 3 mm',
  '%s/%s.pdf', 'correo-maestranza.pdf', '{"codigo_interno": "CHK382_SR_2", "lineas": [{"item": 1, "material_id": "%s", "cantidad": 6}]}'::jsonb)$q$,
  current_setting('prueba.c1'), current_setting('prueba.rq'), current_setting('prueba.rq'), current_setting('prueba.c1'), current_setting('prueba.m2')),
  'ni con todo igual desde otra cuenta', 'ya quedó registrada la primera vez que la enviaste');
reset role;
select test.afirmar((select count(*) = 1 and bool_and((despues->'lineas'->0->>'cantidad')::numeric = 6 and motivo like 'Maestranza pidió%')
                       from public.correcciones where documento_id = current_setting('prueba.rq')::uuid),
  'y la corrección sigue siendo una, con lo del primer envío');

select test.afirmar(exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacenero')::uuid
                                and titulo like 'Requerimiento corregido:%' and origen_id = current_setting('prueba.rq')::uuid),
  'a Almacén le llega que el requerimiento se corrigió');
select test.debe_fallar(format($q$update public.requerimientos set codigo_interno = 'OTRO' where id = '%s'$q$, current_setting('prueba.rq')),
  'por fuera de la corrección, el requerimiento no cambia', 'corrígelo con su justificante');
select test.debe_fallar(format($q$update public.requerimiento_lineas set cantidad = 9 where requerimiento_id = '%s'$q$, current_setting('prueba.rq')),
  'ni sus insumos', 'corrígelo con su justificante');
select test.debe_fallar(format($q$update public.correcciones set motivo = 'Otro motivo cualquiera' where documento_id = '%s'$q$,
  current_setting('prueba.rq')), 'la corrección no se edita', 'queda como evidencia');
select test.debe_fallar(format($q$delete from public.correcciones where documento_id = '%s'$q$, current_setting('prueba.rq')),
  'ni se borra', 'queda como evidencia');

select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from public.correcciones where documento_id = current_setting('prueba.rq')::uuid) = 1
                    and (select count(*) from storage.objects where bucket_id = 'justificantes-correccion'
                          and name like current_setting('prueba.rq') || '/%') = 1,
  'Almacén ve la corrección del RQ y su justificante');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Almacén quiere cambiar la cantidad', 'x', 'x.pdf',
  '{"lineas": [{"item": 1, "cantidad": 1}]}'::jsonb)$q$, current_setting('prueba.c2'), current_setting('prueba.rq')),
  'Almacén no corrige el requerimiento', 'permiso');
-- Revisa el stock: tiene 2 de 6.
select public.rq_revisar_stock(current_setting('prueba.rq')::uuid, '[{"item": 1, "en_stock": 2}]'::jsonb, null);
reset role;

select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.justificante('rq', 'c2');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Al final era la plancha de 2 mm', '%s/%s.pdf', 'x.pdf',
  '{"lineas": [{"item": 1, "material_id": "%s"}]}'::jsonb)$q$, current_setting('prueba.c2'), current_setting('prueba.rq'),
  current_setting('prueba.rq'), current_setting('prueba.c2'), current_setting('prueba.m1')),
  'revisado el stock, el material ya no cambia', 'ya revisó el stock');
select public.corregir_requerimiento(current_setting('prueba.c2')::uuid, current_setting('prueba.rq')::uuid,
  'El plano final pide solo una plancha', current_setting('prueba.rq') || '/' || current_setting('prueba.c2') || '.pdf', 'plano.pdf',
  '{"lineas": [{"item": 1, "cantidad": 1}]}'::jsonb);
select test.afirmar((select cantidad = 1 and cantidad_en_stock = 1 from public.requerimiento_lineas
                      where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1),
  'la cantidad sí se corrige, y lo que tenía Almacén no pasa de lo pedido');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar((select count(*) from public.correcciones) = 0, 'Ventas no ve correcciones');
reset role;

-- ============================================ 2. La orden de compra
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.justificante('oc1', 'c3');
select test.debe_fallar(format($q$select public.corregir_orden_compra('%s', '%s', 'El proveedor confirmó otro precio', '%s/%s.pdf', 'cotizacion.pdf',
  '{"lineas": [{"detalle_id": "%s", "precio_unitario": 95.5}]}'::jsonb)$q$, current_setting('prueba.c3'), current_setting('prueba.oc3'),
  current_setting('prueba.oc3'), current_setting('prueba.c3'),
  (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc3')::uuid)),
  'una OC rechazada no se corrige', 'rechazada');
select public.corregir_orden_compra(current_setting('prueba.c3')::uuid, current_setting('prueba.oc1')::uuid,
  'El proveedor confirmó 95.50 por plancha en su factura', current_setting('prueba.oc1') || '/' || current_setting('prueba.c3') || '.pdf',
  'factura-proveedor.pdf',
  format('{"codigo_interno": "CHK382_SR_2", "lineas": [{"detalle_id": "%s", "precio_unitario": 95.5}]}',
         (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid))::jsonb);
select test.afirmar((select d.precio_unitario = 95.5 and c.codigo_interno = 'CHK382_SR_2'
                       from public.orden_compra_material_detalles d join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
                      where c.id = current_setting('prueba.oc1')::uuid)
                    and (select count(*) from public.correcciones where documento_id = current_setting('prueba.oc1')::uuid
                           and documento = 'ORDEN_COMPRA') = 1,
  'Logística corrige el precio y el código de la OC, con su justificante');
-- El mismo envío otra vez se reconoce; con otro precio ya no es el mismo (migración 20261022180000).
select public.corregir_orden_compra(current_setting('prueba.c3')::uuid, current_setting('prueba.oc1')::uuid,
  'El proveedor confirmó 95.50 por plancha en su factura', current_setting('prueba.oc1') || '/' || current_setting('prueba.c3') || '.pdf',
  'factura-proveedor.pdf',
  format('{"codigo_interno": "CHK382_SR_2", "lineas": [{"detalle_id": "%s", "precio_unitario": 95.5}]}',
         (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid))::jsonb);
select test.debe_fallar(format($q$select public.corregir_orden_compra('%s', '%s', 'El proveedor confirmó 95.50 por plancha en su factura',
  '%s/%s.pdf', 'factura-proveedor.pdf', '{"codigo_interno": "CHK382_SR_2", "lineas": [{"detalle_id": "%s", "precio_unitario": 96}]}'::jsonb)$q$,
  current_setting('prueba.c3'), current_setting('prueba.oc1'), current_setting('prueba.oc1'), current_setting('prueba.c3'),
  (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid)),
  'la corrección de la OC con otro precio y el mismo id no se da por registrada', 'ya quedó registrada la primera vez que la enviaste');
select test.afirmar((select d.precio_unitario = 95.5 from public.orden_compra_material_detalles d
                      where d.orden_compra_id = current_setting('prueba.oc1')::uuid)
                    and (select count(*) from public.correcciones where documento_id = current_setting('prueba.oc1')::uuid) = 1,
  'la OC sigue con el precio del primer envío y una sola corrección');
reset role;

-- Lo que entró al almacén queda en el kardex: la línea ya no se corrige.
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc2')::uuid;
insert into public.movimientos_materiales (id, tipo, cantidad, documento_referencia, registrado_por, material_id, orden_compra_detalle_id,
                                           precio_unitario, moneda, origen, codigo_interno)
select gen_random_uuid(), 'INGRESO', 1, 'QA382', current_setting('prueba.almacenero')::uuid, current_setting('prueba.m1')::uuid, d.id, 50, 'PEN', 'COMPRA', 'PLANTA'
  from public.orden_compra_material_detalles d where d.orden_compra_id = current_setting('prueba.oc2')::uuid;
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.justificante('oc2', 'c4');
select test.debe_fallar(format($q$select public.corregir_orden_compra('%s', '%s', 'El proveedor cobró otro precio', '%s/%s.pdf', 'x.pdf',
  '{"lineas": [{"detalle_id": "%s", "precio_unitario": 40}]}'::jsonb)$q$, current_setting('prueba.c4'), current_setting('prueba.oc2'),
  current_setting('prueba.oc2'), current_setting('prueba.c4'),
  (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc2')::uuid)),
  'la línea que ya entró al almacén no se corrige', 'quedaron en el kardex');
reset role;

-- ============================================ 3. La factura de compra
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, orden_compra_id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (current_setting('prueba.adq')::uuid, current_setting('prueba.oc1')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR 382', 'F001-382',
        current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 1180, 'CONTADO');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.adq') || '/comprobante.pdf', current_setting('prueba.contabilidad'),
        '{"mimetype": "application/pdf", "size": 2048}');
update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.adq') || '/comprobante.pdf', estado = 'REGISTRADA'
 where id = current_setting('prueba.adq')::uuid;
-- Por fuera de la corrección, la factura registrada no cambia (el RLS la esconde a la edición).
update public.adquisiciones set total = 1 where id = current_setting('prueba.adq')::uuid;
reset role;
select test.afirmar((select total = 1180 from public.adquisiciones where id = current_setting('prueba.adq')::uuid),
  'la factura registrada no se edita por fuera');
select test.debe_fallar(format($q$update public.adquisiciones set total = 1 where id = '%s'$q$, current_setting('prueba.adq')),
  'ni siquiera por quien salta el RLS', 'corrígelo con su justificante');

-- Tesorería ya pagó 500.
select pg_temp.como('tesoreria');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('pagos-facturas', current_setting('prueba.adq') || '/' || current_setting('prueba.c8') || '.pdf', current_setting('prueba.tesoreria'),
        '{"mimetype": "application/pdf", "size": 1024}');
select public.registrar_pago_factura(current_setting('prueba.c8')::uuid, current_setting('prueba.adq')::uuid, current_setting('prueba.hoy')::date,
  500, 'OP-382', current_setting('prueba.adq') || '/' || current_setting('prueba.c8') || '.pdf', current_setting('prueba.caja')::uuid, null);
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.justificante('adq', 'c5');
-- La factura en realidad cubre la oc1 y la oc2 y dice 1 109.00 (10 × 95.50 + IGV y la oc2).
select public.corregir_factura_compra(current_setting('prueba.c5')::uuid, current_setting('prueba.adq')::uuid,
  'El proveedor juntó dos OC en la misma factura', current_setting('prueba.adq') || '/' || current_setting('prueba.c5') || '.pdf',
  'nota-del-proveedor.pdf',
  format('{"total": 1185.9, "ordenes": ["%s", "%s"], "lectura": {"fuente": "PDF", "total": 1185.9, "moneda": "PEN", "numero": "F001-382", "ordenes": ["1"]}}',
         current_setting('prueba.oc1'), current_setting('prueba.oc2'))::jsonb);
select test.afirmar(
  (select a.total = 1185.9 and a.lectura_total = 1185.9 and a.lectura_en is not null
     from public.adquisiciones a where a.id = current_setting('prueba.adq')::uuid)
  and (select count(*) from public.adquisiciones_ordenes_compra where adquisicion_id = current_setting('prueba.adq')::uuid and quitada_en is null) = 2,
  'Contabilidad corrige el total y suma la otra OC a la factura registrada');
select test.afirmar((select control from public.adquisiciones_control(array[current_setting('prueba.adq')::uuid])) = 'CALZA',
  'con la OC corregida, la factura calza con sus OC');

-- Se equivocó: la oc2 no era de esta factura. Sale, y queda marcada como quitada.
select pg_temp.justificante('adq', 'c6');
select public.corregir_factura_compra(current_setting('prueba.c6')::uuid, current_setting('prueba.adq')::uuid,
  'La OC de 59.00 tiene su propia factura', current_setting('prueba.adq') || '/' || current_setting('prueba.c6') || '.pdf', 'correo.pdf',
  format('{"total": 1126.9, "ordenes": ["%s"]}', current_setting('prueba.oc1'))::jsonb);
select test.afirmar(
  (select quitada_en is not null and quitada_por = current_setting('prueba.contabilidad')::uuid
     from public.adquisiciones_ordenes_compra where adquisicion_id = current_setting('prueba.adq')::uuid
      and orden_compra_id = current_setting('prueba.oc2')::uuid)
  and exists (select 1 from public.compras_sin_factura() where orden_compra_id = current_setting('prueba.oc2')::uuid),
  'la OC quitada queda como evidencia y vuelve a esperar su factura');
select test.afirmar((select jsonb_array_length(ordenes) = 1 and control = 'CALZA'
                       from public.adquisiciones_control(array[current_setting('prueba.adq')::uuid])),
  'el aviso cuenta solo las OC que quedan');
-- El mismo envío otra vez se reconoce; con otro total ya no es el mismo (migración 20261022180000).
select public.corregir_factura_compra(current_setting('prueba.c6')::uuid, current_setting('prueba.adq')::uuid,
  'La OC de 59.00 tiene su propia factura', current_setting('prueba.adq') || '/' || current_setting('prueba.c6') || '.pdf', 'correo.pdf',
  format('{"total": 1126.9, "ordenes": ["%s"]}', current_setting('prueba.oc1'))::jsonb);
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'La OC de 59.00 tiene su propia factura', '%s/%s.pdf',
  'correo.pdf', '{"total": 1127.9, "ordenes": ["%s"]}'::jsonb)$q$, current_setting('prueba.c6'), current_setting('prueba.adq'),
  current_setting('prueba.adq'), current_setting('prueba.c6'), current_setting('prueba.oc1')),
  'la corrección de la factura con otro total y el mismo id no se da por registrada', 'ya quedó registrada la primera vez que la enviaste');
select test.afirmar((select total = 1126.9 from public.adquisiciones where id = current_setting('prueba.adq')::uuid)
                    and (select count(*) from public.correcciones where id = current_setting('prueba.c6')::uuid) = 1,
  'la factura sigue con el total del primer envío');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'Corrección sin cambiar nada', '%s/%s.pdf', 'x.pdf', '{}'::jsonb)$q$,
  current_setting('prueba.c7'), current_setting('prueba.adq'), current_setting('prueba.adq'), current_setting('prueba.c7')),
  'sin el justificante de esa corrección no entra', 'vuelve a adjuntarlo');
select pg_temp.justificante('adq', 'c7');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'Corrección sin cambiar nada', '%s/%s.pdf', 'x.pdf', '{}'::jsonb)$q$,
  current_setting('prueba.c7'), current_setting('prueba.adq'), current_setting('prueba.adq'), current_setting('prueba.c7')),
  'una corrección que no cambia nada no se anota', 'nada que corregir');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'El total era mucho menor', '%s/%s.pdf', 'x.pdf', '{"total": 400}'::jsonb)$q$,
  current_setting('prueba.c7'), current_setting('prueba.adq'), current_setting('prueba.adq'), current_setting('prueba.c7')),
  'el total no queda por debajo de lo que Tesorería ya pagó', 'ya pagó');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'La factura era en dólares', '%s/%s.pdf', 'x.pdf', '{"moneda": "USD"}'::jsonb)$q$,
  current_setting('prueba.c7'), current_setting('prueba.adq'), current_setting('prueba.adq'), current_setting('prueba.c7')),
  'con pagos, la moneda no cambia', 'moneda no cambia');
-- El PDF de la factura también se reemplaza, en su propia ruta de corrección.
select pg_temp.justificante('adq', 'c9');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'El PDF era de otra factura', '%s/%s.pdf', 'x.pdf',
  '{"pdf_ruta": "adquisiciones/%s/otro.pdf"}'::jsonb)$q$,
  current_setting('prueba.c9'), current_setting('prueba.adq'), current_setting('prueba.adq'), current_setting('prueba.c9'), current_setting('prueba.adq')),
  'el PDF nuevo va en su ruta de corrección', 'PDF corregido');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.adq') || '/correccion-' || current_setting('prueba.pdf') || '.pdf',
        current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 2048}');
select public.corregir_factura_compra(current_setting('prueba.c9')::uuid, current_setting('prueba.adq')::uuid,
  'El PDF adjunto era de otra factura del mismo proveedor', current_setting('prueba.adq') || '/' || current_setting('prueba.c9') || '.pdf', 'correo.pdf',
  format('{"pdf_ruta": "adquisiciones/%s/correccion-%s.pdf"}', current_setting('prueba.adq'), current_setting('prueba.pdf'))::jsonb);
select test.afirmar((select ruta_storage = 'adquisiciones/' || current_setting('prueba.adq') || '/correccion-' || current_setting('prueba.pdf') || '.pdf'
                       from public.adquisiciones where id = current_setting('prueba.adq')::uuid),
  'Contabilidad reemplaza el PDF de la factura registrada');
-- El PDF que la factura dejó de usar queda como evidencia: nadie lo retira.
delete from storage.objects where bucket_id = 'comprobantes-financieros'
   and name = 'adquisiciones/' || current_setting('prueba.adq') || '/correccion-' || current_setting('prueba.pdf') || '.pdf';
select test.afirmar(exists (select 1 from storage.objects where bucket_id = 'comprobantes-financieros'
                              and name = 'adquisiciones/' || current_setting('prueba.adq') || '/correccion-' || current_setting('prueba.pdf') || '.pdf'),
  'el PDF que usa la factura no lo retira ni quien lo subió');
select test.afirmar((select count(*) from public.correcciones where documento_id = current_setting('prueba.adq')::uuid) = 3,
  'la factura lleva sus tres correcciones');
reset role;

select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.correcciones where documento_id = current_setting('prueba.adq')::uuid) = 3,
  'Tesorería ve las correcciones de la factura que paga');
select test.debe_fallar(format($q$select public.corregir_factura_compra('%s', '%s', 'Tesorería quiere otro total', 'x', 'x.pdf', '{"total": 1}'::jsonb)$q$,
  gen_random_uuid(), current_setting('prueba.adq')),
  'Tesorería no corrige la factura', 'permiso');
reset role;

rollback;
