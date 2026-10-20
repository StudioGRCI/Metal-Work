-- Tesorería paga la OC con boleta y la OS guarda su factura (migración
-- 20261020210000, pedido de DKS del 2026-10-20): la OC que va con boleta la
-- paga Tesorería directo, con su voucher y la caja, como una OS; la de antes
-- quedó pagada fuera del sistema; la OS guarda su factura, boleta, recibo o
-- contrato, que adjuntan Logística o Tesorería. Cada paso con el rol que lo da
-- —Tesorería, Logística, Contabilidad, Gerencia, Almacén y Ventas; nunca ADMIN—
-- y `set local role authenticated`, con las políticas de Storage encendidas.
-- Termina en rollback.
begin;

-- En Supabase el bucket ya trae RLS y el permiso; el shim no.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'CONTABILIDAD:CON',
                           'TESORERIA:TES', 'VENDEDOR:GCO', 'SUPERVISOR_GENERAL:PRD'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.421@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 421', lower(replace(v, ':', '.')) || '.421@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK421-PLA', 'Plancha LAF 2 mm 4x8 (421)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000421' || d, 'Proveedor de prueba 421', 'Av. Argentina 421, Lima', '999 421 421' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000421' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['rq', 'oc1', 'oc2', 'oc3', 'oc4', 'oc5', 'os1', 'os2', 'os3', 'f1', 'f3', 'f4',
                           'p1', 'p2', 'p3', 'p4', 'pv', 'd1', 'd2', 'd3', 'd4'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- Una OC por cada insumo del RQ, de tres planchas a S/ 120.50.
create or replace function pg_temp.generar(p_oc text, p_item smallint, p_con_factura boolean) returns uuid language sql as $$
  select public.emitir_compra_del_requerimiento(pg_temp.id(p_oc), pg_temp.id('rq'),
    array[p_item], pg_temp.id('proveedor'), null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
    null, 'CONTADO', 0, 'PEN', p_con_factura);
$$;
-- Si ya se pagó esa orden, según Adquisiciones, leído con la sesión puesta.
create or replace function pg_temp.pago(p_clave text) returns text language sql as $$
  select t.pago from public.trazabilidad_de_compras() t where t.id = pg_temp.id(p_clave);
$$;
-- Lo que hace el navegador con la sesión de quien sube: `{carpeta}/{archivo}.pdf`.
-- Corre con el rol de la sesión, así que pasa por la política de subida del bucket.
create or replace function pg_temp.subir(p_bucket text, p_carpeta text, p_tamano integer default 2048)
returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_carpeta) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, v_ruta, auth.uid()::text, jsonb_build_object('mimetype', 'application/pdf', 'size', p_tamano));
  return v_ruta;
end $$;
create or replace function pg_temp.pagar(p_pago text, p_oc text, p_monto numeric, p_cancela boolean, p_ruta text,
                                         p_dia date default null)
returns uuid language sql as $$
  select public.registrar_pago_compra(pg_temp.id(p_pago), pg_temp.id(p_oc), coalesce(p_dia, current_setting('prueba.hoy')::date),
    p_monto, p_cancela, 'OP-421', 'b001-421', p_ruta, current_setting('prueba.caja')::uuid, null);
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_clave) and titulo like p_titulo || '%';
$$;

-- ============================================ 0. Puertas
do $$
declare f text;
begin
  perform test.afirmar((select count(*) from storage.buckets
                         where id in ('pagos-compras', 'documentos-servicio') and not public and file_size_limit = 10485760) = 2,
                       'los dos buckets nuevos son privados y de hasta 10 MB');
  foreach f in array array['public.registrar_pago_compra(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric)',
                           'public.anular_pago_compra(uuid, text)', 'public.compras_con_boleta_por_pagar()',
                           'public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text)',
                           'public.anular_documento_servicio(uuid, text)', 'public.pasar_compra_a_tesoreria(uuid)',
                           'public.puede_adjuntar_documento_servicio()'] loop
    perform test.afirmar(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
                         'anon no llama ' || f || '; una sesión sí');
  end loop;
  perform test.afirmar(not has_function_privilege('authenticated', 'public.fn_compra_pagada_no_cambia()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_pago_compra_guardia()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_documento_servicio_guardia()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_factura_sin_pago_directo()', 'execute')
                       and not has_function_privilege('authenticated', 'public.compra_pagada_directo(uuid[])', 'execute'),
                       'los disparadores los llama el sistema, no la gente');
  perform test.afirmar((select bool_and(c.relrowsecurity) from pg_class c
                         where c.oid in ('public.pagos_orden_compra'::regclass, 'public.documentos_orden_servicio'::regclass)),
                       'las dos tablas nuevas tienen RLS');
  perform test.afirmar(not has_table_privilege('authenticated', 'public.pagos_orden_compra', 'insert')
                       and not has_table_privilege('authenticated', 'public.pagos_orden_compra', 'update')
                       and not has_table_privilege('authenticated', 'public.pagos_orden_compra', 'delete')
                       and not has_table_privilege('authenticated', 'public.documentos_orden_servicio', 'insert')
                       and not has_table_privilege('authenticated', 'public.documentos_orden_servicio', 'delete')
                       and not has_table_privilege('anon', 'public.pagos_orden_compra', 'select'),
                       'el pago y el documento solo entran por sus funciones, y no se borran');
  perform test.afirmar((select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                         where r.codigo = 'TESORERIA' and rp.permiso_codigo in ('tesoreria.registrar_pagos', 'tesoreria.caja',
                                                                               'tesoreria.pagar_servicios', 'compras.ver')) = 4,
                       'Tesorería tiene los permisos que piden pagar, adjuntar y abrir la OC en papel');
end $$;

-- ============================================ 1. Un RQ con cinco OC
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/21', 'Armado del chasis de la plataforma 21', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 5) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay nada de esto');
reset role;
-- La 2 va con factura; las demás, con boleta.
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.generar('oc' || n, n::smallint, n = 2) from generate_series(1, 5) n;
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc' || n)) from generate_series(1, 4) n;
reset role;
-- La 3 es de antes: su pago no lo registraba Tesorería. El disparador no deja
-- cambiarlo, así que se marca con los disparadores apagados, como la migración
-- marcó las de antes al crear la columna.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set pago_en_tesoreria = false where id = pg_temp.id('oc3');
set local session_replication_role = origin;

select set_config('prueba.total1', public.total_orden_compra(pg_temp.id('oc1'))::text, true);
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);
select test.afirmar(current_setting('prueba.total1')::numeric = 361.50,
  'la OC con boleta suma sin IGV: tres planchas a S/ 120.50');
select test.afirmar((select pago_en_tesoreria from public.ordenes_compra_materiales where id = pg_temp.id('oc1')),
  'la OC nueva ya nace pagándose en Tesorería');

-- ============================================ 2. Quién ve las OC con boleta por pagar
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select array_agg(id order by id) from public.compras_con_boleta_por_pagar()
                      where id in (select pg_temp.id('oc' || n) from generate_series(1, 5) n))
                    = (select array_agg(x order by x) from unnest(array[pg_temp.id('oc1'), pg_temp.id('oc4')]) x),
  'Tesorería ve las aprobadas con boleta: no la de factura, ni la de antes, ni la que espera a Gerencia');
select test.afirmar((select total = 361.50 and pagado = 0 and not cancelada and not sin_precio and proveedor_id = pg_temp.id('proveedor')
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'con su total, lo pagado y el proveedor para buscar su cuenta');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')) = 1,
  'Gerencia la consulta (tesoreria.ver_documentos)');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ select * from public.compras_con_boleta_por_pagar() $$,
  'Contabilidad no la pide: no paga', 'Tesorería');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select * from public.compras_con_boleta_por_pagar() $$,
  'Logística tampoco', 'Tesorería');
-- Logística no sube vouchers al bucket de los pagos.
select test.debe_fallar($$ select pg_temp.subir('pagos-compras', 'oc1') $$,
  'Logística no sube al bucket de los vouchers', 'row-level security');
select test.debe_fallar($$ select public.registrar_pago_compra(gen_random_uuid(), pg_temp.id('oc1'), current_setting('prueba.hoy')::date,
                                 10, false, null, null, 'x', current_setting('prueba.caja')::uuid, null) $$,
  'ni registra el pago', 'permiso');
reset role;

-- ============================================ 3. Tesorería paga a cuenta y después el resto
select pg_temp.como('tesoreria');
set local role authenticated;
select set_config('prueba.v1', pg_temp.subir('pagos-compras', 'oc1'), true);
select set_config('prueba.v2', pg_temp.subir('pagos-compras', 'oc1'), true);
select set_config('prueba.vs', pg_temp.subir('pagos-compras', 'oc1'), true);
select test.afirmar(pg_temp.pagar('p1', 'oc1', 100, false, current_setting('prueba.v1')) = pg_temp.id('p1'),
  'Tesorería registra un pago a cuenta con su voucher');
select test.afirmar(pg_temp.pagar('p1', 'oc1', 100, false, current_setting('prueba.v1')) = pg_temp.id('p1'),
  'el reintento con el mismo id devuelve el mismo pago');
select test.afirmar((select count(*) from public.pagos_orden_compra where orden_compra_id = pg_temp.id('oc1')) = 1,
  'y no registra otro');
select test.afirmar((select monto = 100 and not cancela and comprobante_proveedor = 'B001-421' and moneda = 'PEN'
                            and registrado_por = pg_temp.id('tesoreria') and archivo_mime = 'application/pdf'
                       from public.pagos_orden_compra where id = pg_temp.id('p1')),
  'queda con su monto, su boleta en mayúsculas, quién lo registró y el tipo del voucher');
select test.afirmar((select tipo = 'EGRESO' and monto = 100 and caja_id = current_setting('prueba.caja')::uuid and anulado_en is null
                            and descripcion ilike 'Pago de la %Proveedor de prueba 421'
                       from public.movimientos_caja where origen = 'PAGO_ORDEN_COMPRA' and origen_id = pg_temp.id('p1')),
  'y su egreso sale de la cuenta de la caja');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc1', current_setting('prueba.total1')::numeric - 99, false, current_setting('prueba.v2')) $$,
  'no se paga más que el total', 'pasaría de su total');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc1', 10, false, current_setting('prueba.v2'), current_setting('prueba.hoy')::date + 1) $$,
  'ni con fecha de mañana', 'de hoy hacia atrás');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc1', 10.005, false, current_setting('prueba.v2')) $$,
  'ni con tres decimales', 'dos decimales');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc1', 10, false, pg_temp.id('oc1') || '/' || gen_random_uuid() || '.pdf') $$,
  'ni con un voucher que no subió', 'no terminó de subir');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc2', 10, false, current_setting('prueba.v2')) $$,
  'la OC con factura se paga en Cuentas por pagar', 'va con factura');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc3', 10, false, current_setting('prueba.v2')) $$,
  'la de antes se pagó fuera del sistema', 'fuera del sistema');
select test.debe_fallar($$ select pg_temp.pagar('p2', 'oc5', 10, false, current_setting('prueba.v2')) $$,
  'la que Gerencia no aprobó no se paga', 'no está aprobada');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(pg_temp.pago('oc1') = 'PAGO_PARCIAL'
    and (select pagos->0->>'bucket' = 'pagos-compras' and (pagos->0->>'monto')::numeric = 100 and jsonb_array_length(pagos) = 1
           from public.trazabilidad_de_compras() where id = pg_temp.id('oc1')),
  'Adquisiciones la ve pagada en parte, con su voucher en el bucket de los pagos de OC');
select test.afirmar(pg_temp.pago('oc3') = 'SIN_FACTURA', 'la de antes sigue «pago fuera del sistema»');
select test.afirmar(pg_temp.pago('oc4') = 'POR_PAGAR', 'la otra con boleta, por pagar');
reset role;

select pg_temp.como('tesoreria');
set local role authenticated;
-- En dos sentencias: la que llama a la función no ve la fila que la función inserta.
select test.afirmar(pg_temp.pagar('p2', 'oc1', current_setting('prueba.total1')::numeric - 100, false, current_setting('prueba.v2'))
                    = pg_temp.id('p2'), 'Tesorería paga el saldo');
select test.afirmar((select cancela from public.pagos_orden_compra where id = pg_temp.id('p2')),
  'el pago que llega al total la cancela solo, aunque se marcara «a cuenta»');
select test.afirmar((select cancelada and pagado = 361.50 from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'y pasa a las pagadas');
select test.debe_fallar($$ select pg_temp.pagar('p3', 'oc1', 1, false, current_setting('prueba.vs')) $$,
  'una pagada no se vuelve a pagar', 'ya está pagada');
reset role;
select test.afirmar(pg_temp.avisos('comprador', 'Pago a cuenta de una OC: ') = 1 and pg_temp.avisos('comprador', 'OC pagada: ') = 1
    and pg_temp.avisos('tesoreria', 'OC pagada: ') = 0,
  'a Logística le llega cada pago; a quien pagó, no');

-- ============================================ 4. Quién ve el pago y su voucher
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select count(*) from public.pagos_orden_compra where orden_compra_id = pg_temp.id('oc1')) = 2
    and (select count(*) from storage.objects where bucket_id = 'pagos-compras'
          and name in (current_setting('prueba.v1'), current_setting('prueba.v2'))) = 2,
  'Logística, que emitió la OC, ve los dos pagos con su voucher');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select count(*) from public.pagos_orden_compra where orden_compra_id = pg_temp.id('oc1')) = 2
    and (select count(*) from storage.objects where bucket_id = 'pagos-compras' and name = current_setting('prueba.v1')) = 1,
  'Contabilidad también, desde Adquisiciones');
reset role;
do $$
declare v text;
begin
  foreach v in array array['almacenero', 'vendedor', 'supervisor_general'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.pagos_orden_compra) = 0
        and (select count(*) from storage.objects where bucket_id = 'pagos-compras') = 0
        and (select count(*) from public.audit_log where tabla = 'pagos_orden_compra') = 0,
      v || ' no ve los pagos, ni sus vouchers, ni su copia en la auditoría');
    reset role;
  end loop;
end $$;
select test.afirmar((select count(*) from public.audit_log where tabla = 'pagos_orden_compra' and registro_id = pg_temp.id('p1')) > 0,
  'los pagos sí quedan en la auditoría');

-- El voucher que un pago nombra no lo quita nadie; el suelto, su dueño.
select pg_temp.como('tesoreria');
set local role authenticated;
delete from storage.objects where bucket_id = 'pagos-compras' and name in (current_setting('prueba.v1'), current_setting('prueba.vs'));
reset role;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'pagos-compras' and name = current_setting('prueba.v1')) = 1
    and (select count(*) from storage.objects where bucket_id = 'pagos-compras' and name = current_setting('prueba.vs')) = 0,
  'Tesorería quita el voucher suelto, no el del pago');

-- ============================================ 5. La OC pagada no cambia de camino
select test.debe_fallar($$ update public.ordenes_compra_materiales set con_factura = true where id = pg_temp.id('oc1') $$,
  'con un pago vigente la OC no pasa a factura', 'pago');
select test.debe_fallar($$ update public.ordenes_compra_materiales set moneda = 'USD' where id = pg_temp.id('oc1') $$,
  'ni cambia de moneda', 'pago');
select test.debe_fallar($$ update public.ordenes_compra_materiales set pago_en_tesoreria = false where id = pg_temp.id('oc4') $$,
  'y quién registra su pago no se cambia', 'Tesorería');
select test.debe_fallar($$ update public.pagos_orden_compra set monto = 1 where id = pg_temp.id('p1') $$,
  'el pago no se corrige: se anula', 'no se corrige');
select test.debe_fallar($$ delete from public.pagos_orden_compra where id = pg_temp.id('p1') $$,
  'ni se borra', 'no se borra');

-- ============================================ 6. Anular el pago
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select public.anular_pago_compra(pg_temp.id('p2'), 'No lo anula Logística, lo anula Tesorería') $$,
  'Logística no anula pagos', 'permiso');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.anular_pago_compra(pg_temp.id('p2'), 'corto') $$,
  'sin motivo no se anula', '10 a 500');
select test.afirmar(public.anular_pago_compra(pg_temp.id('p2'), 'El banco devolvió la transferencia del saldo') = pg_temp.id('p2'),
  'Tesorería anula el segundo pago con su motivo');
select test.afirmar((select anulado_en is not null and anulado_por = pg_temp.id('tesoreria') and motivo_anulacion like 'El banco%'
                       from public.pagos_orden_compra where id = pg_temp.id('p2')),
  'queda como evidencia: quién, cuándo y por qué');
select test.afirmar((select count(*) from public.movimientos_caja where origen = 'PAGO_ORDEN_COMPRA' and origen_id = pg_temp.id('p2')
                       and anulado_en is null and tipo = 'EGRESO') = 0,
  'y su egreso deja de contar en la caja');
select test.afirmar((select not cancelada and pagado = 100 from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la OC vuelve a quedar por pagar el saldo');
reset role;

-- ============================================ 7. Dos caminos son dos pagos
-- Contabilidad registró la boleta de la OC 4 como comprobante: se paga por ahí.
select pg_temp.como('contabilidad');
do $$
declare v_hoy date := current_setting('prueba.hoy')::date;
begin
  insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (pg_temp.id('f4'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F001-421', v_hoy - 1, v_hoy - 1, 'PEN',
          public.total_orden_compra(pg_temp.id('oc4')), 'CONTADO');
  insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (pg_temp.id('f4'), pg_temp.id('oc4'));
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f4') || '/comprobante.pdf', pg_temp.id('contabilidad'),
          pg_temp.id('contabilidad')::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf'
   where id = pg_temp.id('f4');
end $$;
select pg_temp.como('tesoreria');
set local role authenticated;
select set_config('prueba.v4', pg_temp.subir('pagos-compras', 'oc4'), true);
select test.debe_fallar($$ select pg_temp.pagar('p3', 'oc4', 10, false, current_setting('prueba.v4')) $$,
  'la OC con su comprobante registrado no se paga también directo', 'ya registró el comprobante');
select test.afirmar((select count(*) from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc4')) = 0,
  'y sale de las OC con boleta por pagar');
select test.afirmar((select pago = 'POR_PAGAR' and jsonb_array_length(facturas) = 1 and facturas->0->>'estado' = 'REGISTRADA'
                            and jsonb_array_length(pagos) = 0
                       from public.trazabilidad_de_compras() where id = pg_temp.id('oc4')),
  'Adquisiciones la sigue por su comprobante registrado, sin pagos directos');
reset role;

-- ============================================ 7b. Y la OC pagada directo no recibe factura
-- La OC 1 tiene un pago a cuenta vigente (p1): Contabilidad no le liga una factura.
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (pg_temp.id('f1'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F001-4211', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 100, 'CONTADO');
select test.debe_fallar($$ insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (pg_temp.id('f1'), pg_temp.id('oc1')) $$,
  'a la OC que Tesorería pagó directo no se le liga una factura', 'Tesorería ya le pagó');
select test.debe_fallar($$ update public.adquisiciones set orden_compra_id = pg_temp.id('oc1') where id = pg_temp.id('f1') $$,
  'tampoco por la OC de la cabecera de la factura', 'Tesorería ya le pagó');

-- ============================================ 8. La OC con boleta de antes que no se pagó
-- La 3 se marcó como de antes: Tesorería la pasa a su lista; nadie más, y una
-- marca puesta a mano no vale.
select test.debe_fallar($$ update public.ordenes_compra_materiales set pago_en_tesoreria = true where id = pg_temp.id('oc3') $$,
  'la marca no se cambia a mano', 'Adquisiciones');
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select public.pasar_compra_a_tesoreria(pg_temp.id('oc3')) $$,
  'Logística no la pasa a Tesorería', 'permiso');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ select public.pasar_compra_a_tesoreria(pg_temp.id('oc3')) $$,
  'ni Contabilidad', 'permiso');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.pasar_compra_a_tesoreria(pg_temp.id('oc2')) $$,
  'la que va con factura no se pasa: se paga por su factura', 'va con factura');
select test.afirmar(public.pasar_compra_a_tesoreria(pg_temp.id('oc3')) = pg_temp.id('oc3'),
  'Tesorería pasa a su lista la OC con boleta de antes que no se pagó');
reset role;
select test.afirmar((select pago_en_tesoreria from public.ordenes_compra_materiales where id = pg_temp.id('oc3')),
  'queda marcada');
select test.afirmar(current_setting('metalwork.compra_a_tesoreria', true) = '',
  'y la llave de la marca no queda puesta en la sesión');
select test.afirmar((select count(*) from public.audit_log where tabla = 'ordenes_compra_materiales' and registro_id = pg_temp.id('oc3')
                       and accion = 'UPDATE' and usuario_id = pg_temp.id('tesoreria')) = 1,
  'quién la pasó queda en la auditoría');
select test.debe_fallar($$ update public.ordenes_compra_materiales set pago_en_tesoreria = false where id = pg_temp.id('oc3') $$,
  'y no vuelve atrás', 'Adquisiciones');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select total = 361.50 and pagado = 0 and not cancelada from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc3')),
  'ya sale en las OC con boleta por pagar');
select test.afirmar(pg_temp.pago('oc3') = 'POR_PAGAR', 'y Adquisiciones la da por pagar');
reset role;
-- La de antes con su comprobante registrado se paga por ahí: no se pasa.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set pago_en_tesoreria = false where id = pg_temp.id('oc4');
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.pasar_compra_a_tesoreria(pg_temp.id('oc4')) $$,
  'la de antes con su comprobante registrado no se pasa', 'ya registró el comprobante');
select test.afirmar(pg_temp.pago('oc4') = 'POR_PAGAR',
  'y Adquisiciones no la da por pagada fuera: se paga por su comprobante');
reset role;

-- ============================================ 8b. El pago directo y la factura en borrador
-- Contabilidad liga la OC 3 a una factura en borrador; mientras no la registra,
-- Tesorería la paga directo. Al registrarla, la base la para; anulado el pago, entra.
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (pg_temp.id('f3'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F001-4213', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', current_setting('prueba.total1')::numeric, 'CONTADO');
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (pg_temp.id('f3'), pg_temp.id('oc3'));
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f3') || '/comprobante.pdf', pg_temp.id('contabilidad'),
        pg_temp.id('contabilidad')::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
select pg_temp.como('tesoreria');
set local role authenticated;
select set_config('prueba.v5', pg_temp.subir('pagos-compras', 'oc3'), true);
select test.afirmar(pg_temp.pagar('p4', 'oc3', 50, false, current_setting('prueba.v5')) = pg_temp.id('p4'),
  'con la factura en borrador, Tesorería todavía la paga directo');
reset role;
select pg_temp.como('contabilidad');
select test.debe_fallar($$ update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf'
                           where id = pg_temp.id('f3') $$,
  'y Contabilidad ya no registra esa factura', 'Tesorería ya le pagó');
select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_pago_compra(pg_temp.id('p4'), 'El proveedor entregó factura: se paga por ahí');
reset role;
select pg_temp.como('contabilidad');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f3');
select test.afirmar((select estado = 'REGISTRADA' from public.adquisiciones where id = pg_temp.id('f3')),
  'anulado el pago directo, la factura se registra');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc3') and not cancelada) = 0,
  'y la OC deja la lista de boletas: ahora se paga por su factura');
reset role;
-- Ya registrada, una corrección (la llave que pone `corregir_factura_compra`)
-- no la cambia a la OC 1, que tiene su pago directo vigente.
select pg_temp.como('contabilidad');
select test.debe_fallar($$ do $x$ begin
                             perform set_config('metalwork.corrigiendo', 'factura', true);
                             update public.adquisiciones set orden_compra_id = pg_temp.id('oc1') where id = pg_temp.id('f3');
                           end $x$ $$,
  'la factura registrada no pasa a la OC que Tesorería pagó directo', 'Tesorería ya le pagó');
-- Un pago directo que hubiera quedado vigente con la factura registrada (de
-- antes de la guarda, puesto con los disparadores apagados): la factura no se
-- paga encima.
set local session_replication_role = replica;
insert into public.pagos_orden_compra (orden_compra_id, fecha_pago, moneda, monto, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('oc3'), current_setting('prueba.hoy')::date, 'PEN', 50, 'oc3/421-suelto.pdf', 'application/pdf', 2048, pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select test.debe_fallar($$ insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
                           values (pg_temp.id('f3'), current_setting('prueba.hoy')::date, 50, 'OP-4213', pg_temp.id('tesoreria')) $$,
  'la factura de una OC pagada directo no se paga encima', 'no se paga encima');

-- ============================================ 8c. La OC de un RQ de OT, en papel, para Tesorería
-- Su PDF lee las líneas de la solicitud por `v_atencion_materiales`, que desde la
-- 20261020174600 abre a `adquisiciones.ver`: Tesorería la paga y la tiene que leer.
set local session_replication_role = replica;
do $$
begin
  perform set_config('prueba.ot_papel', gen_random_uuid()::text, true);
  perform set_config('prueba.otm_papel', gen_random_uuid()::text, true);
  perform set_config('prueba.sol_papel', gen_random_uuid()::text, true);
  perform set_config('prueba.sold_papel', gen_random_uuid()::text, true);
  perform set_config('prueba.oc_papel', gen_random_uuid()::text, true);
  insert into public.ordenes_trabajo (id, sede_id, descripcion, abierta_en_taller)
  values (pg_temp.id('ot_papel'), (select id from public.sedes limit 1), 'OT 421 en papel', true);
  insert into public.ot_materiales (id, orden_id, material_id, cantidad, area_destino)
  values (pg_temp.id('otm_papel'), pg_temp.id('ot_papel'), current_setting('prueba.mat')::uuid, 3, 'MTZ');
  insert into public.requerimientos_materiales (id, orden_id, area_destino, solicitado_por)
  values (pg_temp.id('sol_papel'), pg_temp.id('ot_papel'), 'MTZ', pg_temp.id('comprador'));
  insert into public.requerimiento_material_detalles (id, requerimiento_id, ot_material_id, cantidad_solicitada)
  values (pg_temp.id('sold_papel'), pg_temp.id('sol_papel'), pg_temp.id('otm_papel'), 3);
  insert into public.ordenes_compra_materiales (id, proveedor, referencia, creado_por, requerimiento_id, condicion_pago, dias_credito, con_factura)
  values (pg_temp.id('oc_papel'), 'Proveedor de prueba 421', 'OC 421 en papel', pg_temp.id('comprador'), pg_temp.id('sol_papel'), 'CONTADO', 0, false);
  insert into public.orden_compra_material_detalles (orden_compra_id, cantidad, precio_unitario, requerimiento_id, requerimiento_detalle_id)
  values (pg_temp.id('oc_papel'), 3, 120.50, pg_temp.id('sol_papel'), pg_temp.id('sold_papel'));
end $$;
set local session_replication_role = origin;
do $$
declare v text;
begin
  foreach v in array array['tesoreria', 'contabilidad'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.orden_compra_material_detalles where orden_compra_id = pg_temp.id('oc_papel')) = 1
                         and (select count(*) from public.v_atencion_materiales where detalle_id = pg_temp.id('sold_papel')) = 1,
                         v || ' lee la línea de la OC y lo que su PDF lee de la solicitud de la OT');
    reset role;
  end loop;
  perform pg_temp.como('vendedor');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.v_atencion_materiales where detalle_id = pg_temp.id('sold_papel')) = 0,
                       'Ventas no');
  reset role;
end $$;

-- ============================================ 9. La OS guarda su factura y su contrato
-- Tres OS del mismo proveedor, como dueño de las tablas: dos aprobadas y una anulada.
insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno,
                                     aprobacion, aprobado_por, aprobado_en, estado, anulado_por, anulado_en, motivo_anulacion,
                                     creado_por)
select pg_temp.id('os' || n), 'QA-OS-421-' || n, pg_temp.id('proveedor'), 'Proveedor de prueba 421',
       'Servicio de prueba ' || n || ' del check 421', 500, 'PEN', 'QA421-OS',
       'APROBADA', pg_temp.id('gerente'), now(),
       case when n = 3 then 'ANULADA' else 'EMITIDA' end,
       case when n = 3 then pg_temp.id('comprador') end, case when n = 3 then now() end,
       case when n = 3 then 'Se contrató a otro proveedor' end,
       pg_temp.id('comprador')
  from generate_series(1, 3) n;

select pg_temp.como('comprador');
set local role authenticated;
select set_config('prueba.r1', pg_temp.subir('documentos-servicio', 'os1', 4096), true);
select test.afirmar(public.adjuntar_documento_servicio(pg_temp.id('d1'), pg_temp.id('os1'), 'FACTURA', 'e001-421',
                                                       'factura-421.pdf', current_setting('prueba.r1')) = pg_temp.id('d1'),
  'Logística adjunta la factura de la OS');
select test.afirmar((select numero = 'E001-421' and tipo = 'FACTURA' and subido_por = pg_temp.id('comprador') and tamano_bytes = 4096
                       from public.documentos_orden_servicio where id = pg_temp.id('d1')),
  'con su número normalizado, quién la subió y su tamaño');
select set_config('prueba.r2', pg_temp.subir('documentos-servicio', 'os2'), true);
select test.debe_fallar($$ select public.adjuntar_documento_servicio(pg_temp.id('d2'), pg_temp.id('os2'), 'FACTURA', 'E001-421',
                                 'otra.pdf', current_setting('prueba.r2')) $$,
  'la misma factura del mismo proveedor no va en dos OS', 'ya está adjunta');
select test.debe_fallar($$ select public.adjuntar_documento_servicio(pg_temp.id('d2'), pg_temp.id('os2'), 'RECIBO', null,
                                 'recibo.pdf', current_setting('prueba.r2')) $$,
  'el recibo lleva su número', 'serie');
select set_config('prueba.r1b', pg_temp.subir('documentos-servicio', 'os1', 4096), true);
select test.debe_fallar($$ select public.adjuntar_documento_servicio(pg_temp.id('d2'), pg_temp.id('os1'), 'FACTURA', 'E001-422',
                                 'factura-421.pdf', current_setting('prueba.r1b')) $$,
  'el mismo archivo dos veces en la misma OS, no', 'ya está adjunto');
select set_config('prueba.r3', pg_temp.subir('documentos-servicio', 'os3'), true);
select test.debe_fallar($$ select public.adjuntar_documento_servicio(pg_temp.id('d2'), pg_temp.id('os3'), 'CONTRATO', null,
                                 'contrato.pdf', current_setting('prueba.r3')) $$,
  'a la OS anulada no se le adjunta nada', 'anulada');
reset role;
select test.afirmar(pg_temp.avisos('tesoreria', 'Comprobante de servicio por pagar: QA-OS-421-1') = 1
    and pg_temp.avisos('comprador', 'Comprobante de servicio por pagar') = 0,
  'a Tesorería le avisa que la OS aprobada ya tiene su comprobante');

select pg_temp.como('tesoreria');
set local role authenticated;
select set_config('prueba.r4', pg_temp.subir('documentos-servicio', 'os1'), true);
select test.afirmar(public.adjuntar_documento_servicio(pg_temp.id('d3'), pg_temp.id('os1'), 'CONTRATO', 'no-va',
                                                       'contrato-421.pdf', current_setting('prueba.r4')) = pg_temp.id('d3'),
  'Tesorería adjunta el contrato');
select test.afirmar((select numero is null from public.documentos_orden_servicio where id = pg_temp.id('d3')),
  'que no lleva número');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.subir('documentos-servicio', 'os1') $$,
  'Almacén no sube documentos de la OS', 'row-level security');
select test.debe_fallar($$ select public.adjuntar_documento_servicio(gen_random_uuid(), pg_temp.id('os1'), 'OTRO', null, 'x.pdf', 'x') $$,
  'ni los anota', 'Logística y Tesorería');
select test.afirmar((select count(*) from public.documentos_orden_servicio) = 0
    and (select count(*) from storage.objects where bucket_id = 'documentos-servicio') = 0,
  'ni los ve');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar((select count(*) from public.documentos_orden_servicio) = 0
    and (select count(*) from public.audit_log where tabla = 'documentos_orden_servicio') = 0,
  'Ventas no ve los documentos ni su auditoría');
reset role;
select pg_temp.como('supervisor_general');
set local role authenticated;
select test.afirmar((select count(*) from public.audit_log where tabla = 'documentos_orden_servicio') = 0,
  'Supervisión general, con auditoria.ver, tampoco ve su copia en la auditoría');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select count(*) from public.documentos_orden_servicio where orden_servicio_id = pg_temp.id('os1')) = 2
    and (select count(*) from storage.objects where bucket_id = 'documentos-servicio'
          and name in (current_setting('prueba.r1'), current_setting('prueba.r4'))) = 2,
  'Contabilidad ve la factura y el contrato y abre sus archivos');
select test.afirmar((select jsonb_array_length(documentos) = 2 and documentos->0->>'bucket' = 'documentos-servicio'
                            and documentos->0->>'numero' = 'E001-421'
                       from public.trazabilidad_de_compras() where id = pg_temp.id('os1')),
  'y Adquisiciones los muestra en la fila de la OS, con su bucket');
reset role;

-- Anular: queda como evidencia y deja de contar.
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_servicio(pg_temp.id('d3'), 'Era el contrato de otro trabajo del proveedor') = pg_temp.id('d3'),
  'Logística anula el contrato adjunto por error');
select test.afirmar((select jsonb_array_length(documentos) = 1 from public.trazabilidad_de_compras() where id = pg_temp.id('os1')),
  'Adquisiciones ya no lo cuenta');
-- Su archivo lo nombra una fila: no se quita. El suelto, sí.
delete from storage.objects where bucket_id = 'documentos-servicio' and name in (current_setting('prueba.r1'), current_setting('prueba.r2'));
reset role;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'documentos-servicio' and name = current_setting('prueba.r1')) = 1
    and (select count(*) from storage.objects where bucket_id = 'documentos-servicio' and name = current_setting('prueba.r2')) = 0,
  'el archivo de la factura se queda; el suelto lo quita su dueño');
select test.afirmar((select anulado_en is not null from public.documentos_orden_servicio where id = pg_temp.id('d3')),
  'el contrato anulado sigue en la tabla');
select test.debe_fallar($$ delete from public.documentos_orden_servicio where id = pg_temp.id('d1') $$,
  'un documento no se borra', 'no se borra');
select test.debe_fallar($$ update public.documentos_orden_servicio set numero = 'E001-1' where id = pg_temp.id('d1') $$,
  'ni se corrige', 'no se corrige');

rollback;
