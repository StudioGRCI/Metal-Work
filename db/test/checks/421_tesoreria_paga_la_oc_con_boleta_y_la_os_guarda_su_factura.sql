-- Tesorería paga la OC con boleta y la OS guarda su factura (migración
-- 20261020210000, pedido de DKS del 2026-10-20): la OC que va con boleta la
-- paga Tesorería directo, con su voucher y la caja, como una OS; la de antes
-- quedó pagada fuera del sistema; la OS guarda su factura, boleta, recibo o
-- contrato, que adjuntan Logística o Tesorería. Cada paso con el rol que lo da
-- —Tesorería, Logística, Contabilidad, Gerencia, Almacén y Ventas; ADMIN solo
-- para lo que es suyo por diseño: anular el anexo que la base le niega a
-- Logística— y `set local role authenticated`, con las políticas de Storage
-- encendidas.
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
                           'p1', 'p2', 'p3', 'p4', 'p4a', 'p4b', 'p4c', 'pv', 'd1', 'd2', 'd3', 'd4'] loop
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
                           'public.puede_adjuntar_documento_servicio()', 'public.situacion_de_pago_de_compra(uuid)',
                           'public.situacion_de_facturas_anexadas(uuid[])', 'public.anular_documento_compra(uuid, text)',
                           'public.clave_proveedor(text)', 'public.clave_numero_comprobante(text)',
                           'public.sufijo_societario(text)', 'public.mismo_proveedor(text, text)'] loop
    perform test.afirmar(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
                         'anon no llama ' || f || '; una sesión sí');
  end loop;
  perform test.afirmar(not has_function_privilege('authenticated', 'public.fn_compra_pagada_no_cambia()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_pago_compra_guardia()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_documento_servicio_guardia()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_factura_sin_pago_directo()', 'execute')
                       and not has_function_privilege('authenticated', 'public.compra_pagada_directo(uuid[])', 'execute')
                       and not has_function_privilege('authenticated', 'public.comprobante_en_camino(uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_aviso_factura_de_compra_pagada()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_compra_pagada_total_fijo()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_adquisicion_factura_unica()', 'execute')
                       and not has_function_privilege('authenticated', 'public.factura_del_anexo(uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'public.anexos_de_la_factura(public.adquisiciones)', 'execute')
                       and not has_function_privilege('authenticated', 'public.factura_alcanza_para(public.adquisiciones, uuid)', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_vinculo_con_anexo()', 'execute')
                       and not has_function_privilege('authenticated', 'public.fn_documento_compra_nace_vigente()', 'execute')
                       and not has_function_privilege('authenticated', 'public.avisar_pago_por_anular(uuid[])', 'execute'),
                       'los disparadores y sus ayudantes los llama el sistema, no la gente');
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

-- ============================================ 6b. Lo pagado se vuelve a contar al anular
-- La OC 4: 100 a cuenta y el resto, que la cancela solo. Si se anula el primero,
-- la OC vuelve a deberlo (la cuarta auditoría la vio «Pagada» debiendo S/ 100).
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('p4a', 'oc4', 100, false, pg_temp.subir('pagos-compras', 'oc4'));
select pg_temp.pagar('p4b', 'oc4', current_setting('prueba.total1')::numeric - 100, false, pg_temp.subir('pagos-compras', 'oc4'));
select test.afirmar((select cancelada from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc4')),
  'con los dos pagos, la OC 4 queda pagada');
select public.anular_pago_compra(pg_temp.id('p4a'), 'Se pagó a otra cuenta del proveedor');
select test.afirmar((select not cancelada and pagado = current_setting('prueba.total1')::numeric - 100
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc4')),
  'anulado el primero, vuelve a deber lo que falta, aunque el que queda la había cancelado');
select test.afirmar((select en_camino is null and pagos_vigentes = 1 and not cancelada and saldo = 100 and moneda = 'PEN'
                       from public.situacion_de_pago_de_compra(pg_temp.id('oc4'))),
  'y su situación lo dice: un pago vigente y S/ 100 por pagar');
select test.afirmar(pg_temp.pago('oc4') = 'PAGO_PARCIAL', 'Adquisiciones la da pagada en parte');
-- «Sí, queda pagada» con menos del total: la decisión de Tesorería vale mientras ese pago siga vigente.
select pg_temp.pagar('p4c', 'oc4', 50, true, pg_temp.subir('pagos-compras', 'oc4'));
select test.afirmar((select cancela and cancela_sin_completar from public.pagos_orden_compra where id = pg_temp.id('p4c')),
  'el pago que la da por cancelada sin completar el total lo guarda aparte');
select test.afirmar((select cancelada from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc4'))
                    and pg_temp.pago('oc4') = 'PAGADA',
  'y la OC queda pagada con S/ 50 por debajo de su total');
select test.debe_fallar($$ select pg_temp.pagar('p3', 'oc4', 1, false, pg_temp.subir('pagos-compras', 'oc4')) $$,
  'ya no se le paga más', 'ya está pagada');
select public.anular_pago_compra(pg_temp.id('p4b'), 'El banco devolvió la transferencia del saldo');
select test.afirmar((select cancelada from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc4')),
  'anulado otro pago, sigue pagada: la dio por cancelada un pago vigente');
select public.anular_pago_compra(pg_temp.id('p4c'), 'Se registró en la OC que no era');
select test.afirmar((select pagos_vigentes = 0 and not cancelada and saldo = current_setting('prueba.total1')::numeric
                       from public.situacion_de_pago_de_compra(pg_temp.id('oc4'))),
  'anulado ese también, vuelve a deberse entera');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select pagos_vigentes = 0 from public.situacion_de_pago_de_compra(pg_temp.id('oc4'))),
  'Logística, que emitió la OC, también lee su situación');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ select * from public.situacion_de_pago_de_compra(pg_temp.id('oc4')) $$,
  'Contabilidad no: no paga ni emitió la OC', 'Tesorería y Logística');
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
select set_config('prueba.f9', gen_random_uuid()::text, true);
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f9') || '/comprobante.pdf', pg_temp.id('contabilidad'),
        pg_temp.id('contabilidad')::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
select test.debe_fallar($$ insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                                         condicion_pago, estado, ruta_storage, orden_compra_id)
                           values (pg_temp.id('f9'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F001-4219', current_setting('prueba.hoy')::date,
                                   current_setting('prueba.hoy')::date, 'PEN', 100, 'CONTADO', 'REGISTRADA',
                                   'adquisiciones/' || pg_temp.id('f9') || '/comprobante.pdf', pg_temp.id('oc1')) $$,
  'ni dándola de alta ya registrada', 'Tesorería ya le pagó');
-- Un vínculo quitado en una corrección no se devuelve (la llave que pone `corregir_factura_compra`).
set local session_replication_role = replica;
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id, quitada_en, quitada_por)
values (pg_temp.id('f1'), pg_temp.id('oc1'), now(), pg_temp.id('contabilidad'));
set local session_replication_role = origin;
select test.debe_fallar($$ do $x$ begin
                             perform set_config('metalwork.corrigiendo', 'factura', true);
                             update public.adquisiciones_ordenes_compra set quitada_en = null, quitada_por = null
                              where adquisicion_id = pg_temp.id('f1') and orden_compra_id = pg_temp.id('oc1');
                           end $x$ $$,
  'ni se le devuelve la OC que una corrección había quitado', 'Tesorería ya le pagó');
-- Con su pago vigente, la OC no cambia su total; lo que no lo toca, sí.
select test.debe_fallar($$ update public.orden_compra_material_detalles set precio_unitario = 100 where orden_compra_id = pg_temp.id('oc1') $$,
  'la OC con un pago directo vigente no cambia su precio', 'su total no cambia');
select test.debe_fallar($$ update public.orden_compra_material_detalles set cantidad = 1 where orden_compra_id = pg_temp.id('oc1') $$,
  'ni su cantidad', 'su total no cambia');
select test.debe_fallar($$ delete from public.orden_compra_material_detalles where orden_compra_id = pg_temp.id('oc1') $$,
  'ni pierde líneas', 'su total no cambia');
select test.debe_fallar($$ insert into public.orden_compra_material_detalles (orden_compra_id, material_id, cantidad, precio_unitario)
                           values (pg_temp.id('oc1'), current_setting('prueba.mat')::uuid, 1, 10) $$,
  'ni gana líneas', 'su total no cambia');
select test.debe_fallar($$ update public.orden_compra_material_detalles set orden_compra_id = pg_temp.id('oc1') where orden_compra_id = pg_temp.id('oc4') $$,
  'ni recibe una línea que viene de otra OC', 'su total no cambia');
select test.debe_fallar($$ update public.orden_compra_material_detalles set orden_compra_id = pg_temp.id('oc4') where orden_compra_id = pg_temp.id('oc1') $$,
  'ni se la pasa a otra', 'su total no cambia');
update public.orden_compra_material_detalles set precio_unitario = precio_unitario where orden_compra_id = pg_temp.id('oc1');
select test.afirmar(public.total_orden_compra(pg_temp.id('oc1')) = 361.50, 'y lo que no cambia el total pasa');
-- El proveedor entregó factura y Logística la anexó a la OC: ya no se paga directo.
select pg_temp.como('comprador');
select set_config('prueba.dfac', gen_random_uuid()::text, true);
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('documentos-compras', 'compra/' || pg_temp.id('oc1') || '/' || pg_temp.id('dfac') || '.pdf', pg_temp.id('comprador'),
        pg_temp.id('comprador')::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por, numero_documento, fecha_emision)
values (pg_temp.id('dfac'), pg_temp.id('oc1'), 'FACTURA', 'factura.pdf', 'compra/' || pg_temp.id('oc1') || '/' || pg_temp.id('dfac') || '.pdf',
        'application/pdf', 2048, pg_temp.id('comprador'), 'F009-421', current_setting('prueba.hoy')::date);
select pg_temp.como('tesoreria');
set local role authenticated;
select set_config('prueba.v6', pg_temp.subir('pagos-compras', 'oc1'), true);
select test.debe_fallar($$ select pg_temp.pagar('pv', 'oc1', 10, false, current_setting('prueba.v6')) $$,
  'con la factura que anexó Logística, Tesorería no la paga directo', 'Logística anexó');
select test.afirmar((select comprobante_en_camino = 'F009-421' and comprobante_en_camino_origen = 'LOGISTICA'
                       and comprobante_en_camino_bucket = 'documentos-compras' and not cancelada
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'y su lista dice qué factura entregó el proveedor y quién la trajo');
select test.afirmar(pg_temp.pago('oc1') = 'PAGO_POR_ANULAR',
  'Adquisiciones dice que hay un pago directo que anular, no «pagada en parte»');
reset role;
select test.afirmar(pg_temp.avisos('tesoreria', 'Llegó factura de una OC pagada: ') = 1
    and pg_temp.avisos('comprador', 'Llegó factura de una OC pagada: ') = 0,
  'a Tesorería le llega el aviso de anular su pago; a quien la anexó, no');
-- ============================================ 7c. La factura que anexó Logística es la de la OC
-- Sexta vuelta (migración 20261020210000): la factura que Logística anexó a una
-- OC con boleta le cierra el pago directo la registre Contabilidad ligada a
-- ella, a otra OC o a ninguna; la misma factura se reconoce escrita de otra
-- forma y no entra dos veces; registrada sin OC se liga sola a la OC que la
-- puede llevar; y el anexo equivocado lo anula Logística.
-- El PDF se sube como superusuario (Storage tiene su política aparte, probada
-- arriba); el anexo entra con el rol real de Logística, como lo deja «Adjuntar»:
-- como superusuario, los checks pasaban mientras Logística no podía anexar.
create or replace function pg_temp.anexar(p_doc text, p_oc text, p_numero text) returns uuid language plpgsql as $$
declare
  v_doc uuid := pg_temp.id(p_doc);
  v_oc uuid := pg_temp.id(p_oc);
  v_comprador uuid := pg_temp.id('comprador');
  v_hoy date := current_setting('prueba.hoy')::date;
  v_ruta text := 'compra/' || pg_temp.id(p_oc) || '/' || pg_temp.id(p_doc) || '.pdf';
  -- Quien estaba en la sesión vuelve al terminar: el anexo no cambia el usuario de lo que sigue.
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_rol text := current_setting('request.jwt.claim.role', true);
  v_claims text := current_setting('request.jwt.claims', true);
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-compras', v_ruta, v_comprador, v_comprador::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  perform pg_temp.como('comprador');
  set local role authenticated;
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por,
                                                 numero_documento, fecha_emision)
  values (v_doc, v_oc, 'FACTURA', 'factura-' || p_numero || '.pdf', v_ruta, 'application/pdf', 2048, v_comprador, p_numero, v_hoy);
  reset role;
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true),
          set_config('request.jwt.claim.role', coalesce(v_rol, ''), true),
          set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  return v_doc;
end $$;
create or replace function pg_temp.alta(p_clave text, p_proveedor text, p_numero text, p_condicion text default 'CONTADO')
returns uuid language sql as $$
  insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
  values (pg_temp.id(p_clave), 'FACTURA_COMPRA', p_proveedor, p_numero, current_setting('prueba.hoy')::date,
          case when p_condicion = 'CREDITO' then current_setting('prueba.hoy')::date + 30 else current_setting('prueba.hoy')::date end,
          'PEN', 361.50, p_condicion)
  returning id;
$$;
create or replace function pg_temp.con_pdf(p_clave text) returns text language plpgsql as $$
declare v_ruta text := 'adquisiciones/' || pg_temp.id(p_clave) || '/comprobante.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('comprobantes-financieros', v_ruta, pg_temp.id('contabilidad'), pg_temp.id('contabilidad')::text,
          jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  return v_ruta;
end $$;
do $$
declare v text;
begin
  foreach v in array array['fx', 'fy', 'fa1', 'f12', 'd12', 'd5', 'f5', 'd15a', 'd15b', 'f15', 'd3x', 'f3x',
                           'fe1', 'fe2', 'fe3', 'fe4', 'fe5', 'fy5', 'fz', 'dz'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

-- Las dos claves: la misma factura escrita de dos formas da lo mismo; «LA CASA»
-- no pierde su «SA», y la eñe no depende de la intercalación de la base.
select test.afirmar(public.clave_proveedor('Ferretería El Perno S.A.C.') = public.clave_proveedor(' FERRETERIA EL PERNO SAC')
                    and public.clave_proveedor('LA CASA') = 'LACASA' and public.clave_proveedor('La Casa S. A. C.') = 'LACASA'
                    and public.clave_proveedor('Peña E.I.R.L.') = 'PENA' and public.clave_proveedor('PEÑA') = 'PENA'
                    and public.clave_proveedor('ARTESA') = 'ARTESA' and public.clave_proveedor('Arte S.A.') = 'ARTE'
                    and public.clave_proveedor('Comercial Sociedad Anónima Cerrada') = 'COMERCIAL'
                    and public.clave_proveedor(' . ') is null,
  'la clave del proveedor quita tildes, signos y el tipo de sociedad solo al final');
select test.afirmar(public.clave_numero_comprobante('F001-000123') = 'F001-123' and public.clave_numero_comprobante('f001 123') = 'F001-123'
                    and public.clave_numero_comprobante('F001123') = 'F001-123' and public.clave_numero_comprobante('F001--0123') = 'F001-123'
                    and public.clave_numero_comprobante('001-0045') = '1-45' and public.clave_numero_comprobante('E001-12') = 'E001-12'
                    and public.clave_numero_comprobante('F001-0') = 'F001-0' and public.clave_numero_comprobante(' - ') = '-'
                    and public.clave_numero_comprobante('') is null,
  'la clave del número junta serie y correlativo sin ceros, con o sin guion');
select test.afirmar(public.mismo_proveedor('Ferretería El Perno S.A.C.', ' FERRETERIA EL PERNO SAC')
                    and not public.mismo_proveedor('Ferretería El Perno S.A.C.', 'Ferreteria El Perno E.I.R.L.')
                    and public.mismo_proveedor('Ferretería El Perno S.A.C.', 'Ferreteria el perno')
                    and public.sufijo_societario('Comercial Sociedad Anónima Cerrada') = 'SAC'
                    and public.sufijo_societario('La Casa S. A. C.') = 'SAC' and public.sufijo_societario('LA CASA') is null
                    and public.clave_proveedor('深圳市 五金') = '深圳市五金',
  'S.A.C. y E.I.R.L. son dos empresas; el que no dice su tipo de sociedad se toma por la misma; un nombre sin letras latinas tiene clave');

-- Contabilidad pone la factura que Logística anexó a la OC 1 en otra OC, y le
-- alcanza para las dos (426.57 de la OC 2 y 361.50 de la 1): le sigue cerrando
-- el pago directo, porque es la misma factura. Antes se lo abría, y la factura
-- que cubría las dos se pagaba entera encima.
select pg_temp.como('contabilidad');
-- Con la OC en la cabecera, como la da de alta la aplicación (la base la enlaza sola).
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('fx'), 'FACTURA_COMPRA', 'proveedor de prueba 421 ', 'F009-0421', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 790, 'CONTADO', pg_temp.id('oc2'));
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino = 'F009-421' and comprobante_en_camino_origen = 'LOGISTICA'
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la factura que Logística anexó le sigue cerrando el pago directo a la OC 1 aunque Contabilidad la ponga en otra OC');
select test.afirmar(pg_temp.pago('oc1') = 'PAGO_POR_ANULAR', 'y Adquisiciones sigue pidiendo anular su pago directo');
reset role;
select pg_temp.como('contabilidad');
select pg_temp.con_pdf('fx');
select test.debe_fallar($$ update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf'
                           where id = pg_temp.id('fx') $$,
  'y no se registra mientras la OC 1 tenga su pago directo: dos caminos son dos pagos', 'Tesorería ya le pagó la');

-- La misma factura no entra dos veces, aunque se escriba de otra forma. El
-- mensaje dice de quién es el borrador o desde cuándo está registrada.
set local role authenticated;
select test.debe_fallar($$ select pg_temp.alta('fy', 'PROVEEDOR DE PRUEBA 421 S.A.C.', 'F009 421') $$,
  'la factura en borrador no se da de alta otra vez escrita de otra forma', 'Ya tienes en borrador el comprobante F009-0421');
select test.debe_fallar($$ select pg_temp.alta('fy', 'Proveedor de Prueba 421 SAC', 'F001-0421') $$,
  'ni la registrada', 'ya está registrado en Adquisiciones desde el');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.alta('fy', 'Proveedor de prueba 421', 'F009-421') $$,
  'Logística no da de alta comprobantes: la rechaza la seguridad de la tabla, no la guarda de duplicados', 'row-level security');
reset role;
-- Otra empresa con el mismo número no es la misma factura.
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.alta('fy', 'Proveedor de prueba 4210', 'F009-421');
reset role;
select test.afirmar((select orden_compra_id is null from public.adquisiciones where id = pg_temp.id('fy')),
  'la factura de otra empresa con el mismo número entra, y no se liga a la OC del anexo');
-- La factura de otra OC sale de la prueba: su número cambia mientras es borrador.
update public.adquisiciones set numero_documento = 'F009-42199' where id = pg_temp.id('fx');
-- La misma razón social con otro tipo de sociedad es otra empresa; el «S/N» no
-- es un número y no choca con otro «S/N».
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.alta('fe1', 'Empresa 421 S.A.C.', 'F777-1');
select pg_temp.alta('fe2', 'Empresa 421 E.I.R.L.', 'F777-1');
select test.debe_fallar($$ select pg_temp.alta('fe3', 'EMPRESA 421 SAC', 'F777-0001') $$,
  'pero la misma con su S.A.C. escrito de otra forma sí es la misma factura', 'Ya tienes en borrador el comprobante F777-1');
select pg_temp.alta('fe4', 'Empresa 421 S.A.C.', 'S/N');
select pg_temp.alta('fe5', 'EMPRESA 421 SAC', 'S/N');
reset role;
select test.afirmar((select count(*) from public.adquisiciones where id in (pg_temp.id('fe1'), pg_temp.id('fe2'), pg_temp.id('fe4'), pg_temp.id('fe5'))) = 4,
  'entran la de la E.I.R.L. y los dos «S/N»');

-- Registrada a mano, sin OC, la factura que Logística anexó a una OC pagada
-- directo no se liga a ella (no la puede llevar) y no se registra hasta que
-- Tesorería anule su pago.
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.alta('fa1', ' PROVEEDOR DE PRUEBA 421', 'f009-00421');
reset role;
select test.afirmar((select orden_compra_id is null and documento_compra_id is null from public.adquisiciones where id = pg_temp.id('fa1')),
  'a mano y sin OC, no se liga a la OC 1, que tiene un pago directo vigente');
select pg_temp.con_pdf('fa1');
select test.debe_fallar($$ update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf'
                           where id = pg_temp.id('fa1') $$,
  'y no se registra mientras la OC del anexo tenga su pago directo', 'Tesorería ya le pagó la');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select registrada and mismo_numero = 'Proveedor de prueba 4210'
                       from public.situacion_de_facturas_anexadas(array[pg_temp.id('dfac')])),
  'el desplegable ya no la ofrece (tiene su borrador) y avisa de otra factura con su número de otro proveedor');
select test.afirmar((select count(*) = 1 and bool_and(not registrada and mismo_numero is null)
                       from public.situacion_de_facturas_anexadas(array[gen_random_uuid()])),
  'un documento que no existe no sale como registrado');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($$ select * from public.situacion_de_facturas_anexadas(array[pg_temp.id('dfac')]) $$,
  'el desplegable es de quien ve Adquisiciones', 'Adquisiciones la ven');
reset role;

-- Pagada dos veces: la factura se registró y se pagó sin anexo, Tesorería pagó
-- la OC por su boleta, y después Logística anexa esa factura a la OC. La lista
-- y el aviso lo dicen: se pide la devolución de lo que se pagó de más (lo
-- directo por encima del saldo de la factura), no se paga otra vez.
select pg_temp.como('contabilidad');
select pg_temp.alta('f12', 'Proveedor de prueba 421', 'F012-88');
select pg_temp.con_pdf('f12');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f12');
set local session_replication_role = replica;
insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
values (pg_temp.id('f12'), current_setting('prueba.hoy')::date, 300, 'OP-4212', pg_temp.id('tesoreria'));
set local session_replication_role = origin;
update public.notificaciones set leida_en = now() where usuario_id = pg_temp.id('tesoreria');
select pg_temp.como('comprador');
select pg_temp.anexar('d12', 'oc1', 'F012-88');
select pg_temp.como('tesoreria');
set local role authenticated;
-- La OC 1 tiene 100 pagados directo; a la F012-88 (361.50) le quedan 61.50: se pagaron 38.50 de más.
select test.afirmar((select comprobante_en_camino = 'F012-88' and comprobante_en_camino_origen = 'REGISTRADA'
                            and comprobante_en_camino_alcanza and pagada_dos_veces = 38.50
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la OC pagada directo cuya factura ya estaba pagada dice cuánto se pagó de más');
select test.afirmar((select en_camino_origen = 'REGISTRADA' and en_camino_alcanza and pagada_dos_veces = 38.50 and pagos_vigentes = 1
                            and en_camino_saldo = 61.50
                       from public.situacion_de_pago_de_compra(pg_temp.id('oc1'))),
  'y su situación de pago también, con lo que le falta a la factura');
select test.afirmar((select pago = 'PAGADA_DOS_VECES'
                            and exists (select 1 from jsonb_array_elements(facturas) x where x->>'numero' = 'F012-88' and (x->>'anexada')::boolean)
                            and exists (select 1 from jsonb_array_elements(documentos) x
                                         where x->>'id' = pg_temp.id('d12')::text and x->'factura'->>'numero' = 'F012-88'
                                           and (x->'factura'->>'alcanza')::boolean and (x->'factura'->>'pagado')::numeric = 300)
                       from public.trazabilidad_de_compras() where id = pg_temp.id('oc1')),
  'Adquisiciones la muestra entre sus facturas, por el anexo de Logística, y dice «pagada dos veces», no «pago por anular»: el anexo trae su factura con lo pagado');
reset role;
select test.afirmar(pg_temp.avisos('tesoreria', 'Compra pagada dos veces: ') = 1
    and (select cuerpo like '%se pagaron S/ 38.50 de más. Pide al proveedor la devolución%' from public.notificaciones
          where usuario_id = pg_temp.id('tesoreria') and titulo like 'Compra pagada dos veces: %'),
  'a Tesorería le llega el aviso de que la compra se pagó dos veces, con lo que se pagó de más y la devolución');
select test.debe_fallar($$ insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
                           values (pg_temp.id('f12'), current_setting('prueba.hoy')::date, 1, 'OP-4213', pg_temp.id('tesoreria')) $$,
  'la factura de la OC pagada dos veces no se paga otra vez, aunque esté registrada sin ligarla, y el rechazo pide primero la devolución (no anular el pago)',
  'Tesorería pide al proveedor la devolución de lo pagado de más; cuando el proveedor la devuelva, anula el pago de la boleta');
-- Si el saldo de la factura cubre lo pagado directo, no hubo doble pago: lo
-- pagado de la factura pudo ser la parte de otra OC. Se mueve el voucher.
set local session_replication_role = replica;
update public.pagos_adquisicion set monto = 200 where adquisicion_id = pg_temp.id('f12');
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino_origen = 'REGISTRADA' and pagada_dos_veces = 0
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'con 161.50 de saldo para 100 pagados directo, no se pagó dos veces: no se pide devolución');
reset role;
set local session_replication_role = replica;
update public.pagos_adquisicion set monto = 300 where adquisicion_id = pg_temp.id('f12');
set local session_replication_role = origin;

-- Logística no anula el anexo de una factura ya pagada que alcanza para la OC:
-- anulado, la OC se pagaba otra vez por su boleta. Tampoco el de la factura en
-- borrador de la OC que Tesorería ya pagó directo: se pagaba también la factura.
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.anular_documento_compra(pg_temp.id('d12'), 'No era de esta OC, era de otra') $$,
  'Tesorería no anula lo que anexa Logística', 'corresponde a Logística');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select public.anular_documento_compra(pg_temp.id('d12'), 'corto') $$,
  'sin motivo no se anula', 'Cuenta por qué se anula');
select test.debe_fallar($$ select public.anular_documento_compra(pg_temp.id('d12'), 'Era la factura de otra compra del mismo proveedor') $$,
  'Logística no anula el anexo de la factura que ya se pagó', 'No se anula: la factura F012-88 de este anexo ya está registrada y Tesorería le pagó S/ 300.00');
select test.debe_fallar($$ select public.anular_documento_compra(pg_temp.id('dfac'), 'Era la factura de otra compra del mismo proveedor') $$,
  'ni el de la factura en borrador de la OC que Tesorería pagó directo', 'No se anula: Tesorería ya pagó la');
reset role;
select test.afirmar((select anulado_en is null from public.documentos_compra_material where id = pg_temp.id('d12')),
  'el anexo sigue vigente');
-- Si de verdad no es de esa OC, lo anula el administrador del sistema.
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'admin.421@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
  select v_id, 'ADMIN', 'Check 421', 'admin.421@prueba.local', r.id from public.roles r where r.codigo = 'ADMIN';
  perform set_config('prueba.admin', v_id::text, true);
end $$;
select pg_temp.como('admin');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('d12'), 'Era la factura de otra compra del mismo proveedor') = pg_temp.id('d12'),
  'el administrador anula la factura que Logística anexó por error');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('d12'), 'Otra vez, por si no llegó') = pg_temp.id('d12'),
  'un segundo toque no cambia nada');
select test.debe_fallar($$ update public.documentos_compra_material set anulado_en = null where id = pg_temp.id('d12') $$,
  'y nadie la desanula por la API', 'permission denied');
reset role;
select test.afirmar((select anulado_en is not null and anulado_por = pg_temp.id('admin') and motivo_anulacion = 'Era la factura de otra compra del mismo proveedor'
                       from public.documentos_compra_material where id = pg_temp.id('d12')),
  'queda con quién, cuándo y el primer motivo');
select test.afirmar(pg_temp.avisos('contabilidad', 'Logística anuló una factura que anexó: ') = 1,
  'a Contabilidad, que la tenía registrada, le llega el aviso');
select test.afirmar(pg_temp.avisos('tesoreria', 'La OC vuelve a pagarse por su boleta: ') = 0,
  'a Tesorería no: la OC 1 sigue esperando la otra factura que le anexó Logística');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino = 'F009-421' and comprobante_en_camino_origen = 'LOGISTICA'
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'anulado ese anexo, la OC 1 vuelve a esperar la factura que sí es suya');
select test.afirmar((select d->>'anulado_en' is not null and d->>'motivo_anulacion' like 'Era la factura%'
                       from public.trazabilidad_de_compras() t, jsonb_array_elements(t.documentos) d
                      where t.id = pg_temp.id('oc1') and d->>'id' = pg_temp.id('d12')::text),
  'y Adquisiciones lo sigue mostrando, anulado y con su motivo');
reset role;

-- La factura de otra OC que Logística anexa por error: Contabilidad la registró
-- con la OC 2 por su total exacto, así que no alcanza para la OC 1. No la da
-- por pagada ni manda a anular el pago directo: el anexo queda por revisar, y
-- ese sí lo anula Logística.
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('fz'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F020-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', current_setting('prueba.total1')::numeric, 'CONTADO', pg_temp.id('oc2'));
select pg_temp.con_pdf('fz');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('fz');
update public.notificaciones set leida_en = now() where usuario_id = pg_temp.id('tesoreria');
select pg_temp.como('comprador');
select pg_temp.anexar('dz', 'oc1', 'F020-1');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino = 'F020-1' and comprobante_en_camino_origen = 'REGISTRADA'
                            and not comprobante_en_camino_alcanza and pagada_dos_veces = 0
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la factura de la OC 2 que Logística anexó a la OC 1 no alcanza para ella');
select test.afirmar(pg_temp.pago('oc1') = 'ANEXO_POR_REVISAR'
                    and not exists (select 1 from public.trazabilidad_de_compras() t, jsonb_array_elements(t.facturas) x
                                     where t.id = pg_temp.id('oc1') and x->>'numero' = 'F020-1'),
  'Adquisiciones no la da por pagada con esa factura: el anexo está por revisar');
select set_config('prueba.vz', pg_temp.subir('pagos-compras', 'oc1'), true);
select test.debe_fallar($$ select pg_temp.pagar('pv', 'oc1', 10, false, current_setting('prueba.vz')) $$,
  'y Tesorería no la paga directo hasta que se revise', 'no alcanza para esta');
reset role;
select test.afirmar(pg_temp.avisos('tesoreria', 'Factura anexada por revisar: ') = 1
    and (select count(*) from public.notificaciones where usuario_id = pg_temp.id('tesoreria')
          and titulo like 'Llegó factura de una OC pagada: %' and leida_en is null) = 0
    and (select cuerpo like '%No anules ese pago de la boleta%' from public.notificaciones
          where usuario_id = pg_temp.id('tesoreria') and titulo like 'Factura anexada por revisar: %'),
  'a Tesorería le llega que el anexo está por revisar, no que anule su pago');
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('dz'), 'Era la factura de la OC 2, no de esta') = pg_temp.id('dz'),
  'Logística anula el anexo de la factura que no alcanza para la OC');
reset role;
select test.afirmar(pg_temp.avisos('contabilidad', 'Logística anuló una factura que anexó: ') = 2,
  'y a Contabilidad, que tiene registrada esa factura, le llega el aviso');
select test.afirmar((select bool_and(leida_en is not null) from public.notificaciones
                      where usuario_id = pg_temp.id('tesoreria') and titulo like 'Factura anexada por revisar: %'),
  'y el aviso del anexo por revisar se da por leído');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino = 'F009-421' and comprobante_en_camino_origen = 'LOGISTICA'
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la OC 1 vuelve a esperar la F009-421');
reset role;

-- La OC 5, con boleta y sin pagos: Contabilidad registra a mano la factura que
-- Logística le anexó, con el proveedor y el número escritos de otra forma. Se
-- liga sola a la OC y Tesorería ya no la paga directo: se paga por la factura.
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc5'));
reset role;
select pg_temp.como('comprador');
select pg_temp.anexar('d5', 'oc5', 'F010-55');
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.alta('f5', 'PROVEEDOR DE PRUEBA 421 SAC', 'F010-0055');
reset role;
select test.afirmar((select orden_compra_id = pg_temp.id('oc5') and documento_compra_id = pg_temp.id('d5') and proveedor = 'PROVEEDOR DE PRUEBA 421 SAC'
                       from public.adquisiciones where id = pg_temp.id('f5'))
                    and exists (select 1 from public.adquisiciones_ordenes_compra
                                 where adquisicion_id = pg_temp.id('f5') and orden_compra_id = pg_temp.id('oc5') and quitada_en is null),
  'registrada a mano sin OC, la factura anexada se liga sola a su OC con boleta, con su vínculo');
select pg_temp.como('contabilidad');
set local role authenticated;
update public.adquisiciones set estado = 'REGISTRADA' where id = pg_temp.id('f5');
reset role;
select test.afirmar((select estado = 'REGISTRADA' from public.adquisiciones where id = pg_temp.id('f5')),
  'y se registra con el PDF que anexó Logística');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc5')) = 0,
  'la OC 5 deja la lista de boletas: se paga por su factura');
select set_config('prueba.v7', pg_temp.subir('pagos-compras', 'oc5'), true);
select test.debe_fallar($$ select pg_temp.pagar('pv', 'oc5', 10, false, current_setting('prueba.v7')) $$,
  'y Tesorería no la paga directo', 'ya registró el comprobante');
select test.afirmar(pg_temp.pago('oc5') = 'POR_PAGAR', 'Adquisiciones la da por pagar, por su factura');
reset role;
-- La corrección no rompe el lazo con el anexo. La que eligió el anexo se corrige
-- de número (el PDF es ese) y el número que deja libre no entra otra vez; a
-- ninguna se le quita la OC que tiene anexada esa factura.
select pg_temp.como('contabilidad');
do $$ begin
  perform set_config('metalwork.corrigiendo', 'factura', true);
  update public.adquisiciones set numero_documento = 'F010-56' where id = pg_temp.id('f5');
  perform set_config('metalwork.corrigiendo', '', true);
end $$;
select test.afirmar((select numero_documento = 'F010-56' and documento_compra_id = pg_temp.id('d5') from public.adquisiciones where id = pg_temp.id('f5')),
  'la factura que eligió el anexo se corrige de número: sigue siendo la de ese PDF');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.alta('fy5', 'Proveedor de prueba 421', 'F010-55') $$,
  'y el número que deja libre no se da de alta otra vez: la OC ya tiene su factura', 'que ya tiene su factura F010-56');
reset role;
do $$ begin
  perform set_config('metalwork.corrigiendo', 'factura', true);
  update public.adquisiciones set proveedor = 'Proveedor de prueba 421 S.A.C.' where id = pg_temp.id('f5');
  perform set_config('metalwork.corrigiendo', '', true);
end $$;
select test.afirmar((select proveedor = 'Proveedor de prueba 421 S.A.C.' from public.adquisiciones where id = pg_temp.id('f5')),
  'escribir el mismo proveedor de otra forma sí se corrige');
select test.debe_fallar($$ do $x$ begin
                             perform set_config('metalwork.corrigiendo', 'factura', true);
                             update public.adquisiciones set orden_compra_id = null where id = pg_temp.id('f5');
                           end $x$ $$,
  'una corrección no le quita la OC 5, que tiene anexada esa factura', 'tiene anexada esta factura');
select test.debe_fallar($$ do $x$ begin
                             perform set_config('metalwork.corrigiendo', 'factura', true);
                             update public.adquisiciones_ordenes_compra set quitada_en = now(), quitada_por = pg_temp.id('contabilidad')
                              where adquisicion_id = pg_temp.id('f5') and orden_compra_id = pg_temp.id('oc5');
                           end $x$ $$,
  'ni su vínculo', 'tiene anexada esta factura');
-- Logística anula ese anexo (la factura cubre la OC 5 por su vínculo: la OC no
-- vuelve al pago directo) y a Tesorería no le llega nada.
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_compra(pg_temp.id('d5'), 'El número de la factura estaba mal escrito');
reset role;
select test.afirmar(pg_temp.avisos('contabilidad', 'Logística anuló una factura que anexó: ') = 3
    and pg_temp.avisos('tesoreria', 'La OC vuelve a pagarse por su boleta: ') = 0,
  'a Contabilidad le llega el aviso; a Tesorería no, la OC sigue con su factura');
select pg_temp.como('contabilidad');
select test.debe_fallar($$ insert into public.adquisiciones (tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                                         condicion_pago, orden_compra_id, documento_compra_id)
                           values ('FACTURA_COMPRA', 'Proveedor de prueba 421', 'F010-57', current_setting('prueba.hoy')::date,
                                   current_setting('prueba.hoy')::date, 'PEN', 100, 'CONTADO', pg_temp.id('oc5'), pg_temp.id('d5')) $$,
  'la factura que Logística anuló no se elige en el desplegable', 'Logística anuló la factura');

-- Una factura anexada a la OC 5, que ya tiene su factura completa: no entra
-- (es la misma con otro número, o el anexo está mal) y el desplegable lo dice.
-- Anulado ese anexo, la que queda es de la OC 1, que tiene pago directo: no se
-- liga y no se registra.
select pg_temp.como('comprador');
select pg_temp.anexar('d15a', 'oc1', 'F015-3');
select pg_temp.anexar('d15b', 'oc5', 'F015-3');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select factura_de_la_oc = 'F010-56' from public.situacion_de_facturas_anexadas(array[pg_temp.id('d15b')])),
  'el desplegable dice que la OC 5 ya tiene su factura');
select test.debe_fallar($$ select pg_temp.alta('f15', 'Proveedor de prueba 421', 'F015-3') $$,
  'y no entra otra para ella', 'que ya tiene su factura F010-56');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_compra(pg_temp.id('d15b'), 'La OC 5 ya tiene su factura, esta no es suya');
reset role;
select pg_temp.como('contabilidad');
select pg_temp.alta('f15', 'Proveedor de prueba 421', 'F015-3');
select test.afirmar((select orden_compra_id is null from public.adquisiciones where id = pg_temp.id('f15')),
  'la factura no se liga sola a la OC 1, que tiene pago directo');
select pg_temp.con_pdf('f15');
select test.debe_fallar($$ update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f15') $$,
  'y no se registra mientras la OC 1 tenga pago directo', 'Tesorería ya le pagó la');

-- Al elegir en el desplegable la factura que anexó Logística, el proveedor es el
-- de su OC: así la clave reconoce la misma factura. Se prueba y se deshace.
do $$
declare v_proveedor text;
begin
  begin
    perform pg_temp.como('comprador');
    perform pg_temp.anexar('d3x', 'oc3', 'F016-1');
    perform pg_temp.como('contabilidad');
    insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                      orden_compra_id, documento_compra_id)
    values (pg_temp.id('f3x'), 'FACTURA_COMPRA', 'Nombre comercial cualquiera', 'F016-1', current_setting('prueba.hoy')::date,
            current_setting('prueba.hoy')::date, 'PEN', 100, 'CONTADO', pg_temp.id('oc3'), pg_temp.id('d3x'))
    returning proveedor into v_proveedor;
    raise exception using errcode = 'Q4210', message = 'deshacer';
  exception when sqlstate 'Q4210' then null;
  end;
  perform test.afirmar(v_proveedor = (select proveedor from public.ordenes_compra_materiales where id = pg_temp.id('oc3')),
                       'la factura elegida del desplegable lleva el proveedor de su OC');
end $$;

-- La que ya estaba registrada sin OC antes de esta guarda, con el número de la
-- factura anexada: la OC 1 se paga por ella, no directo. Solo el número la liga
-- al anexo: cambiarlo soltaría la OC 1, y no se corrige.
select set_config('prueba.fsin', gen_random_uuid()::text, true);
set local session_replication_role = replica;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado,
                                  ruta_storage)
values (pg_temp.id('fsin'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F009-421', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 361.50, 'CONTADO', 'REGISTRADA', 'adquisiciones/' || pg_temp.id('fsin') || '/comprobante.pdf');
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino = 'F009-421' and comprobante_en_camino_origen = 'REGISTRADA' and pagada_dos_veces = 0
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'registrada sin OC, la factura anexada es la de la OC 1: sigue sin pagarse directo');
reset role;
select pg_temp.como('contabilidad');
select test.debe_fallar($$ do $x$ begin
                             perform set_config('metalwork.corrigiendo', 'factura', true);
                             update public.adquisiciones set numero_documento = 'F009-422' where id = pg_temp.id('fsin');
                           end $x$ $$,
  'la factura que solo su número liga al anexo no se corrige de número', 'que Logística anexe primero');
set local session_replication_role = replica;
update public.adquisiciones set numero_documento = 'F009-42198' where id = pg_temp.id('fsin');
set local session_replication_role = origin;

-- La factura que Logística anexó antes de que se pidiera su número y su fecha
-- (la regla de 20261016702000 es NOT VALID) se anula igual: antes chocaba con
-- esa regla al anularla, y la OC esperaba para siempre. Se crea como entonces,
-- sin la regla, y la regla vuelve tal cual.
do $$
declare v_regla text;
begin
  select pg_get_constraintdef(oid) into v_regla from pg_constraint
   where conname = 'ck_documento_compra_factura_con_numero' and conrelid = 'public.documentos_compra_material'::regclass;
  alter table public.documentos_compra_material drop constraint ck_documento_compra_factura_con_numero;
  perform set_config('prueba.dvieja', gen_random_uuid()::text, true);
  set local session_replication_role = replica;
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (pg_temp.id('dvieja'), pg_temp.id('oc3'), 'FACTURA', 'factura-vieja.pdf', pg_temp.id('oc3') || '/factura-vieja.pdf',
          'application/pdf', 2048, pg_temp.id('comprador'));
  set local session_replication_role = origin;
  execute 'alter table public.documentos_compra_material add constraint ck_documento_compra_factura_con_numero ' || v_regla;
end $$;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('dvieja'), 'Factura de antes, sin número: no es de esta OC') = pg_temp.id('dvieja'),
  'Logística anula la factura que anexó antes de que se pidiera su número');
reset role;
select test.afirmar((select anulado_en is not null from public.documentos_compra_material where id = pg_temp.id('dvieja'))
                    and (select not public.compra_tiene_comprobante(c) from public.ordenes_compra_materiales c where c.id = pg_temp.id('oc3'))
                    and (select not convalidated from pg_constraint where conname = 'ck_documento_compra_factura_con_numero'),
  'queda anulada, la OC ya no cuenta con ella como comprobante, y la regla sigue sin revisar las viejas');

-- Pagada entera y con la factura después: sale una vez y en la parte de la
-- lista que no se corta en las 60 últimas canceladas.
set local session_replication_role = replica;
update public.pagos_orden_compra set cancela = true, cancela_sin_completar = true where id = pg_temp.id('p1');
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) = 1 and bool_and(cancelada and comprobante_en_camino = 'F009-421')
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la OC pagada a la que llegó factura sale una vez, con su factura en camino');
reset role;
set local session_replication_role = replica;
update public.pagos_orden_compra set cancela = false, cancela_sin_completar = false where id = pg_temp.id('p1');
set local session_replication_role = origin;

-- ============================================ 7d. Lo que encontró la sexta auditoría
-- Un RQ aparte, con once OC del mismo proveedor: las 72, 75 y 77 van con factura
-- (426.57 con IGV); las demás, con boleta (361.50).
do $$
declare v text;
begin
  foreach v in array array['rq7', 'o71', 'o72', 'o73', 'o74', 'o75', 'o76', 'o77', 'o78', 'o79', 'o7a', 'o7b',
                           'd71', 'd73', 'd74', 'd76', 'd78', 'd7a', 'dfalsa', 'f71', 'f73', 'f74', 'f76', 'f78', 'f78otro',
                           'f79', 'f7a', 'f7b', 'd7b', 'p74', 'p76', 'p7b'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq7'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/21', 'Lo que encontró la sexta auditoría', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 11) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq7'), 'No hay nada de esto');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id(x.oc), pg_temp.id('rq7'), array[x.n::smallint], pg_temp.id('proveedor'), null,
         jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
         null, 'CONTADO', 0, 'PEN', x.oc in ('o72', 'o75', 'o77'))
  from unnest(array['o71', 'o72', 'o73', 'o74', 'o75', 'o76', 'o77', 'o78', 'o79', 'o7a', 'o7b']) with ordinality x(oc, n);
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id(x)) from unnest(array['o71', 'o72', 'o73', 'o74', 'o75', 'o76', 'o77', 'o78', 'o79', 'o7a', 'o7b']) x;
reset role;
select test.afirmar(public.total_orden_compra(pg_temp.id('o72')) = 426.57 and public.total_orden_compra(pg_temp.id('o71')) = 361.50,
  'la OC con factura suma 426.57 con IGV; la de boleta, 361.50');

-- Una factura registrada para otra OC solo es la de esta si lo que le queda
-- alcanza: la de S/ 430 de la OC 72 (426.57) no paga también la OC 71 (361.50) a
-- la que Logística la anexó. Antes bastaba con pasar en un sol a la OC 72, y la
-- OC 71 salía pagada sin que nadie la pagara.
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('f71'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F701-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 430, 'CONTADO', pg_temp.id('o72'));
select pg_temp.con_pdf('f71');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f71');
select pg_temp.como('tesoreria');
insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
values (pg_temp.id('f71'), current_setting('prueba.hoy')::date, 430, 'OP-4271', pg_temp.id('tesoreria'));
select pg_temp.como('comprador');
select pg_temp.anexar('d71', 'o71', 'F701-1');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino_origen = 'REGISTRADA' and not comprobante_en_camino_alcanza and pagada_dos_veces = 0
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('o71')),
  'la factura de S/ 430 de la OC 72 (426.57) no alcanza para la OC 71 (361.50): su anexo está por revisar');
select test.afirmar(pg_temp.pago('o71') = 'ANEXO_POR_REVISAR'
                    and (select (x->'factura'->>'alcanza')::boolean = false and x->'factura'->>'numero' = 'F701-1'
                           from public.trazabilidad_de_compras() t, jsonb_array_elements(t.documentos) x
                          where t.id = pg_temp.id('o71') and x->>'id' = pg_temp.id('d71')::text),
  'y Adquisiciones no la da por pagada: dice que el anexo está por revisar, con la factura que no le alcanza');
reset role;
-- Alcanza si llega al 90 % de las dos OC (788.07): la factura de dos OC con un
-- descuento no deja el anexo «por revisar» (con un sol de holgura, la de S/ 750
-- no alcanzaba, el anexo se anulaba y la OC se pagaba también por su boleta).
select test.afirmar((select public.factura_alcanza_para(jsonb_populate_record(a, '{"total": 750}'), pg_temp.id('o71'))
                            and public.factura_alcanza_para(jsonb_populate_record(a, '{"total": 709.27}'), pg_temp.id('o71'))
                            and not public.factura_alcanza_para(jsonb_populate_record(a, '{"total": 709.26}'), pg_temp.id('o71'))
                       from public.adquisiciones a where a.id = pg_temp.id('f71')),
  'la factura de las dos OC (788.07) con un descuento de S/ 38 alcanza para las dos; por debajo del 90 % (709.26), no');
-- Y la factura sin otras OC ligadas es la de esta aunque sea por menos (un
-- descuento, o una parte): con el 90 % de esta OC, la de S/ 200 dejaba de contar
-- y Tesorería la pagaba encima del pago directo (lo cobró la octava auditoría).
select test.afirmar((select public.factura_alcanza_para(jsonb_populate_record(a, jsonb_build_object('id', gen_random_uuid(), 'total', 200)), pg_temp.id('o71'))
                            and public.factura_alcanza_para(jsonb_populate_record(a, jsonb_build_object('id', gen_random_uuid(), 'total', 330)), pg_temp.id('o71'))
                       from public.adquisiciones a where a.id = pg_temp.id('f71')),
  'la factura sin otras OC es la de la OC con boleta aunque sea por menos: la de S/ 200 y la de S/ 330');
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('d71'), 'Era la factura de la OC 72, no de esta') = pg_temp.id('d71'),
  'Logística anula el anexo que no le alcanza aunque esa factura ya esté pagada: el error es el anexo');
reset role;
select test.afirmar(pg_temp.pago('o71') = 'POR_PAGAR', 'y la OC 71 vuelve a pagarse por su boleta');

-- La factura ligada a la OC por su anexo y ya pagada: anulado el anexo, la
-- corrección le quitaba la OC y la OC se pagaba otra vez por su boleta.
select pg_temp.como('comprador');
select pg_temp.anexar('d73', 'o73', 'F703-1');
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.alta('f73', 'Proveedor de prueba 421', 'F703-1');
reset role;
select pg_temp.con_pdf('f73');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f73');
select test.afirmar((select orden_compra_id = pg_temp.id('o73') and documento_compra_id = pg_temp.id('d73')
                       from public.adquisiciones where id = pg_temp.id('f73')),
  'registrada a mano, se liga sola a la OC 73 por su anexo');
select pg_temp.como('tesoreria');
insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
values (pg_temp.id('f73'), current_setting('prueba.hoy')::date, 361.50, 'OP-4273', pg_temp.id('tesoreria'));
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select public.anular_documento_compra(pg_temp.id('d73'), 'No era de esta OC, era de otra') $$,
  'Logística no anula el anexo de la factura ligada a la OC y ya pagada', 'ya está registrada para la');
reset role;

-- El anexo que no alcanza no traba la factura de la otra OC: Tesorería la paga
-- y Contabilidad la registra aunque la OC del anexo esté pagada directo. Antes
-- el error mandaba a anular ese pago directo, que la tarjeta dice no anular.
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('p74', 'o74', 361.50, true, pg_temp.subir('pagos-compras', 'o74'));
select pg_temp.pagar('p76', 'o76', 361.50, true, pg_temp.subir('pagos-compras', 'o76'));
reset role;
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('f74'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F704-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 426.57, 'CONTADO', pg_temp.id('o75'));
select pg_temp.con_pdf('f74');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f74');
select pg_temp.como('comprador');
select pg_temp.anexar('d74', 'o74', 'F704-1');
select test.afirmar(pg_temp.pago('o74') = 'ANEXO_POR_REVISAR', 'la OC 74, pagada directo, queda con el anexo por revisar');
select pg_temp.como('tesoreria');
insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
values (pg_temp.id('f74'), current_setting('prueba.hoy')::date, 426.57, 'OP-4274', pg_temp.id('tesoreria'));
select test.afirmar((select count(*) from public.pagos_adquisicion where adquisicion_id = pg_temp.id('f74') and anulado_en is null) = 1,
  'Tesorería paga la factura de la OC 75 aunque Logística la anexara por error a la OC 74, pagada directo');
select pg_temp.como('comprador');
select pg_temp.anexar('d76', 'o76', 'F706-1');
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('f76'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F706-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 426.57, 'CONTADO', pg_temp.id('o77'));
select pg_temp.con_pdf('f76');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f76');
select test.afirmar((select estado = 'REGISTRADA' from public.adquisiciones where id = pg_temp.id('f76'))
                    and pg_temp.pago('o76') = 'ANEXO_POR_REVISAR',
  'y Contabilidad registra la de la OC 77 aunque ya estuviera anexada por error a la OC 76, pagada directo');

-- El «Otro» con el número de la factura (la nota de crédito lo lleva) no se liga
-- solo a la OC del anexo ni pasa por su factura: la factura de verdad entra
-- después. Con la razón social completa: escrita igual, la tabla no deja dos
-- comprobantes del mismo proveedor con el mismo número.
select pg_temp.como('comprador');
select pg_temp.anexar('d78', 'o78', 'F708-1');
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (pg_temp.id('f78otro'), 'OTRO', 'PROVEEDOR DE PRUEBA 421 S.A.C.', 'F708-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 50, 'CONTADO');
reset role;
select test.afirmar((select orden_compra_id is null and documento_compra_id is null from public.adquisiciones where id = pg_temp.id('f78otro'))
                    and not exists (select 1 from public.factura_del_anexo(pg_temp.id('d78'))),
  'el «Otro» con el número de la factura no se liga a la OC del anexo ni es su factura');
select test.afirmar((select registrada is false and factura_de_la_oc is null
                       from public.situacion_de_facturas_anexadas(array[pg_temp.id('d78')])),
  'y el desplegable sigue ofreciendo la factura anexada');
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.alta('f78', 'Proveedor de prueba 421', 'F708-1');
reset role;
select test.afirmar((select orden_compra_id = pg_temp.id('o78') and documento_compra_id = pg_temp.id('d78')
                       from public.adquisiciones where id = pg_temp.id('f78')),
  'la factura de verdad entra y se liga sola a la OC 78');

-- Pagada la factura que la cubre en parte, la OC con boleta está pagada en
-- parte, como la de factura: decía PAGADA.
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('f79'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F709-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 200, 'CONTADO', pg_temp.id('o79'));
update public.adquisiciones_ordenes_compra set parcial = true where adquisicion_id = pg_temp.id('f79');
select pg_temp.con_pdf('f79');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f79');
select pg_temp.como('tesoreria');
insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
values (pg_temp.id('f79'), current_setting('prueba.hoy')::date, 200, 'OP-4279', pg_temp.id('tesoreria'));
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(pg_temp.pago('o79') = 'PAGO_PARCIAL', 'la OC con boleta con su factura parcial pagada está pagada en parte');
reset role;

-- El borrador que eligió el anexo no se registra si Logística lo anuló entre los dos pasos.
select pg_temp.como('comprador');
select pg_temp.anexar('d7a', 'o7a', 'F710-1');
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id, documento_compra_id)
values (pg_temp.id('f7a'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F710-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 361.50, 'CONTADO', pg_temp.id('o7a'), pg_temp.id('d7a'));
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_compra(pg_temp.id('d7a'), 'Era la factura de otra OC del proveedor');
reset role;
-- Y el borrador no queda sin salida: la anulación le suelta el anexo (ya no se
-- podía completar, ni corregir, ni darse de alta otra vez, y su OC no se pagaba
-- por ningún lado). Sigue con su OC; Contabilidad lo completa con su PDF.
select test.afirmar((select documento_compra_id is null and estado = 'BORRADOR' and orden_compra_id = pg_temp.id('o7a')
                       from public.adquisiciones where id = pg_temp.id('f7a')),
  'anulado el anexo, el borrador que lo eligió lo suelta y sigue con su OC');
select test.afirmar(pg_temp.avisos('contabilidad', 'Logística anuló una factura que anexó: ') >= 1
    and exists (select 1 from public.notificaciones where usuario_id = pg_temp.id('contabilidad')
                 and titulo like 'Logística anuló una factura que anexó: %' and cuerpo like '%ya no lleva ese anexo: quien la registró la completa con su PDF%'),
  'y a Contabilidad le llega que lo complete con su PDF');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ insert into public.adquisiciones (tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                                             condicion_pago, orden_compra_id, documento_compra_id)
                           values ('FACTURA_COMPRA', 'Proveedor de prueba 421', 'F710-2', current_setting('prueba.hoy')::date,
                                   current_setting('prueba.hoy')::date, 'PEN', 361.50, 'CONTADO', pg_temp.id('o7a'), pg_temp.id('d7a')) $$,
  'no se da de alta un comprobante sobre el anexo anulado', 'Logística anuló la factura F710-1');
reset role;
select pg_temp.con_pdf('f7a');
select pg_temp.como('contabilidad');
set local role authenticated;
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f7a');
select test.afirmar((select estado = 'REGISTRADA' from public.adquisiciones where id = pg_temp.id('f7a')),
  'Contabilidad completa con su PDF el borrador que eligió el anexo anulado');
reset role;

-- El documento nace vigente: la anulación con quién y cuándo la pone la base.
-- Con su PDF subido de verdad, como lo haría quien lo intente.
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('documentos-compras', 'compra/' || pg_temp.id('o7b') || '/' || pg_temp.id('dfalsa') || '.pdf', pg_temp.id('comprador'),
        pg_temp.id('comprador')::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type,
                                    tamano_bytes, subido_por, numero_documento, fecha_emision, anulado_en, anulado_por, motivo_anulacion)
                           values (pg_temp.id('dfalsa'), pg_temp.id('o7b'), 'FACTURA', 'falsa.pdf',
                                   'compra/' || pg_temp.id('o7b') || '/' || pg_temp.id('dfalsa') || '.pdf', 'application/pdf', 2048,
                                   pg_temp.id('comprador'), 'F711-1', current_setting('prueba.hoy')::date,
                                   now() - interval '30 days', pg_temp.id('tesoreria'), 'La anuló Tesorería hace un mes') $$,
  'Logística no da de alta un documento ya anulado a nombre de otra persona', 'se adjunta vigente');
reset role;

-- El orden de la lista de Tesorería: primero el pago directo por anular, después
-- la pagada dos veces (pedir la devolución) y al final lo demás; el anexo por
-- revisar no le pide nada a Tesorería. Con los tres grupos presentes, para que
-- no pase de vacío (la del pago por anular entraba mezclada con las otras dos).
-- La OC 7b se paga dos veces: directo, y por la F712-1 que Contabilidad registró
-- sin OC y Tesorería pagó antes de que Logística la anexara.
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('p7b', 'o7b', 361.50, true, pg_temp.subir('pagos-compras', 'o7b'));
reset role;
select pg_temp.como('contabilidad');
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (pg_temp.id('f7b'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F712-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 361.50, 'CONTADO');
select pg_temp.con_pdf('f7b');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f7b');
select pg_temp.como('tesoreria');
insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por)
values (pg_temp.id('f7b'), current_setting('prueba.hoy')::date, 361.50, 'OP-4272', pg_temp.id('tesoreria'));
select pg_temp.como('comprador');
select pg_temp.anexar('d7b', 'o7b', 'F712-1');
select test.afirmar(pg_temp.pago('o7b') = 'PAGADA_DOS_VECES', 'la OC 7b, pagada directo y por su factura, sale pagada dos veces');
select pg_temp.como('tesoreria');
set local role authenticated;
create temp table orden_tesoreria on commit drop as
  select ordinality as n,
         case when comprobante_en_camino is not null and pagado > 0 and comprobante_en_camino_alcanza is distinct from false
              then case when coalesce(pagada_dos_veces, 0) > 0 then 2 else 1 end else 3 end as grupo,
         comprobante_en_camino is not null and pagado > 0 and comprobante_en_camino_alcanza = false as por_revisar
    from public.compras_con_boleta_por_pagar() with ordinality;
reset role;
select test.afirmar((select count(distinct grupo) = 3 and bool_or(por_revisar) from orden_tesoreria),
  'la lista de Tesorería tiene pagos por anular, pagadas dos veces, un anexo por revisar con pago y las demás');
select test.afirmar((select bool_and(a.grupo <= b.grupo) from orden_tesoreria a join orden_tesoreria b on a.n < b.n),
  'Tesorería ve primero los pagos por anular, después las pagadas dos veces y al final lo demás (el anexo por revisar, también)');

-- ============================================ 7e. Lo que encontró la séptima auditoría
-- Un RQ aparte con tres OC del mismo proveedor: la 7c y la 7e con boleta
-- (361.50), la 7d con factura (426.57). Tesorería paga S/ 100 a cuenta de la 7c
-- y de la 7e.
do $$
declare v text;
begin
  foreach v in array array['rq8', 'o7c', 'o7d', 'o7e', 'd7c', 'd7e', 'f7c', 'f7e', 'p7c', 'p7e'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq8'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/21', 'Lo que encontró la séptima auditoría', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 3) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq8'), 'No hay nada de esto');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id(x.oc), pg_temp.id('rq8'), array[x.n::smallint], pg_temp.id('proveedor'), null,
         jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
         null, 'CONTADO', 0, 'PEN', x.oc = 'o7d')
  from unnest(array['o7c', 'o7d', 'o7e']) with ordinality x(oc, n);
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id(x)) from unnest(array['o7c', 'o7d', 'o7e']) x;
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('p7c', 'o7c', 100, false, pg_temp.subir('pagos-compras', 'o7c'));
select pg_temp.pagar('p7e', 'o7e', 100, false, pg_temp.subir('pagos-compras', 'o7e'));
reset role;
update public.notificaciones set leida_en = now() where usuario_id = pg_temp.id('tesoreria');

-- El aviso de anular el pago directo dice cuánto va con el mismo voucher: lo que
-- llevaba ese pago, no la factura entera (tras un pago a cuenta de S/ 100 se
-- mandaba a pagar con él toda la factura).
select pg_temp.como('comprador');
select pg_temp.anexar('d7c', 'o7c', 'F713-1');
select test.afirmar((select count(*) = 1 and bool_and(cuerpo like '%que ya pagaste por su boleta (S/ 100.00)%'
                                                       and cuerpo like '%con el mismo voucher por esos S/ 100.00: el dinero ya salió. Si la factura es por más, lo que le falte después es un pago nuevo; si es por menos, la diferencia la devuelve el proveedor.')
                       from public.notificaciones
                      where usuario_id = pg_temp.id('tesoreria') and titulo like 'Llegó factura de una OC pagada: %' and leida_en is null),
  'el aviso de anular el pago dice cuánto se paga con el mismo voucher: lo que llevaba ese pago');

-- Contabilidad registra esa factura para la OC 7d por su total: no alcanza para
-- la 7c, que queda «por revisar». El aviso de anular su pago ya no corre: se da
-- por leído y llega el del anexo por revisar.
select pg_temp.como('contabilidad');
select pg_temp.con_pdf('f7c');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago,
                                  orden_compra_id)
values (pg_temp.id('f7c'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F713-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 426.57, 'CONTADO', pg_temp.id('o7d'));
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f7c');
select test.afirmar(pg_temp.pago('o7c') = 'ANEXO_POR_REVISAR', 'registrada para la OC 7d, la factura deja por revisar el anexo de la 7c');
reset role;
select test.afirmar((select count(*) from public.notificaciones where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('o7c')
                       and titulo like 'Llegó factura de una OC pagada: %' and leida_en is null) = 0
    and (select count(*) from public.notificaciones where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('o7c')
          and titulo like 'Factura anexada por revisar: %' and leida_en is null
          and cuerpo like '%que Contabilidad registró para otras OC y que no alcanza para esta. No anules ese pago de la boleta%') = 1,
  'al registrarla, el aviso de anular el pago de la 7c se da por leído y llega el de no anularlo, con el anexo por revisar');

-- Tesorería paga la factura de la 7d, y Logística anula el anexo de la 7c: la OC
-- queda con su pago directo (no «vuelve a pagarse»), y el aviso advierte que esa
-- factura tiene pagos por si la 7c era parte de ella.
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_pago_factura(gen_random_uuid(), pg_temp.id('f7c'), current_setting('prueba.hoy')::date, 426.57, 'OP-4273',
         pg_temp.subir('pagos-facturas', 'f7c'), current_setting('prueba.caja')::uuid, null);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('d7c'), 'Era la factura de la OC 7d, no de esta') = pg_temp.id('d7c'),
  'Logística anula el anexo por revisar de la OC ya pagada a cuenta');
reset role;
select test.afirmar((select count(*) from public.notificaciones where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('d7c')
                       and titulo like 'La OC vuelve a pagarse por su boleta: %') = 0
    and (select count(*) = 1 and bool_and(cuerpo like '%Su pago directo queda como estaba: no lo anules.%'
                                          and cuerpo like '%Ojo: la factura F713-1 ya tiene pagos de S/ 426.57; si esta OC era parte de ella (Contabilidad lo ve en la factura), se pagó dos veces: pide al proveedor la devolución.')
           from public.notificaciones where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('d7c')
            and titulo like 'La OC queda con su pago directo: %'),
  'a Tesorería le llega que la OC queda con su pago directo, no que vuelve a pagarse, y el «Ojo» de la factura con pagos');

-- La factura registrada sin OC que Logística anexa a la 7e, ya pagada a cuenta:
-- con el mismo voucher van los S/ 100 de ese pago; el resto es un pago nuevo.
select pg_temp.como('contabilidad');
select pg_temp.con_pdf('f7e');
set local role authenticated;
select pg_temp.alta('f7e', 'Proveedor de prueba 421', 'F714-1');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f7e');
reset role;
select pg_temp.como('comprador');
select pg_temp.anexar('d7e', 'o7e', 'F714-1');
select test.afirmar((select count(*) = 1 and bool_and(cuerpo like 'Contabilidad registró la factura F714-1 que Logística anexó%(S/ 100.00)%'
                                                       and cuerpo like '%paga la factura con el mismo voucher por esos S/ 100.00: el dinero ya salió. Los S/ 261.50 que le faltan después son un pago nuevo.')
                       from public.notificaciones
                      where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('o7e') and titulo like 'Llegó factura de una OC pagada: %'),
  'con la factura ya registrada, el aviso dice lo que va con el mismo voucher y lo que es un pago nuevo');
-- El desplegable de Contabilidad marca el anexo de la OC con pago directo: la
-- base no lo registra hasta que Tesorería anule ese pago.
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select bool_and(case documento when pg_temp.id('d7e') then pagada_directo else not pagada_directo end)
                       from public.situacion_de_facturas_anexadas(array[pg_temp.id('d7e'), pg_temp.id('d7a')])),
  'el desplegable dice qué anexo es de una OC con pago directo vigente');
reset role;

-- ============================================ 7f. Lo que encontró la octava auditoría
-- Un RQ aparte con tres OC con boleta del mismo proveedor: la 7f, chica (una
-- plancha a S/ 50), y la 7g y la 7h (361.50).
do $$
declare v text;
begin
  foreach v in array array['rq9', 'o7f', 'o7g', 'o7h', 'd7f', 'd7g', 'd7h', 'f7g', 'f7h', 'p7g', 'p7h1', 'p7h2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq9'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/21', 'Lo que encontró la octava auditoría', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 3) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq9'), 'No hay nada de esto');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id(x.oc), pg_temp.id('rq9'), array[x.n::smallint], pg_temp.id('proveedor'), null,
         jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', x.cantidad, 'precio', x.precio)),
         null, 'CONTADO', 0, 'PEN', false)
  from (values ('o7f', 1, 1, 50.00), ('o7g', 2, 3, 120.50), ('o7h', 3, 3, 120.50)) x(oc, n, cantidad, precio);
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id(x)) from unnest(array['o7f', 'o7g', 'o7h']) x;
reset role;
select test.afirmar(public.total_orden_compra(pg_temp.id('o7f')) = 50.00 and public.total_orden_compra(pg_temp.id('o7g')) = 361.50,
  'la OC chica suma S/ 50; las otras, 361.50');

-- La OC chica ya no cabe en el margen de la factura de otra OC: la F701-1 de
-- S/ 430, de la OC 72 (426.57) y ya pagada, llega al 90 % de las dos (428.91),
-- pero lo que deja después de la 72 no cubre la mitad de la chica. Con solo el
-- 90 %, la OC chica salía pagada sin pago y su anexo ya no se anulaba.
select pg_temp.como('comprador');
select pg_temp.anexar('d7f', 'o7f', 'F701-1');
select test.afirmar((select not public.factura_alcanza_para(a, pg_temp.id('o7f'))
                            and public.factura_alcanza_para(jsonb_populate_record(a, '{"total": 451.57}'), pg_temp.id('o7f'))
                            and not public.factura_alcanza_para(jsonb_populate_record(a, '{"total": 451.56}'), pg_temp.id('o7f'))
                       from public.adquisiciones a where a.id = pg_temp.id('f71')),
  'la factura de la OC 72 no alcanza para la OC chica: tiene que dejarle la mitad (451.57 sí, 451.56 no)');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(pg_temp.pago('o7f') = 'ANEXO_POR_REVISAR'
                    and (select not comprobante_en_camino_alcanza from public.compras_con_boleta_por_pagar() where id = pg_temp.id('o7f')),
  'la OC chica no sale pagada por esa factura: su anexo está por revisar y sigue en la lista de Tesorería');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anular_documento_compra(pg_temp.id('d7f'), 'Era la factura de la OC 72, no de esta') = pg_temp.id('d7f'),
  'y Logística anula ese anexo');
select test.afirmar(pg_temp.pago('o7f') = 'POR_PAGAR', 'con lo que la OC chica vuelve a pagarse por su boleta');
reset role;

-- La factura sin OC por menos que la OC sigue siendo la suya: con un pago
-- directo vigente, no se paga encima (con el 90 % de la OC, la de S/ 80 se
-- pagaba y la caja quedaba con 361.50 + 80 por una compra). Y como la factura
-- no tiene pagos, la OC no está pagada dos veces: Tesorería anula el pago y
-- paga la factura con el mismo voucher por lo que le falta; lo de más lo
-- devuelve el proveedor.
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('p7g', 'o7g', 361.50, true, pg_temp.subir('pagos-compras', 'o7g'));
reset role;
update public.notificaciones set leida_en = now() where usuario_id = pg_temp.id('tesoreria');
select pg_temp.como('contabilidad');
select pg_temp.con_pdf('f7g');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (pg_temp.id('f7g'), 'FACTURA_COMPRA', 'Proveedor de prueba 421', 'F716-1', current_setting('prueba.hoy')::date,
        current_setting('prueba.hoy')::date, 'PEN', 80, 'CONTADO');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f7g');
reset role;
select pg_temp.como('comprador');
select pg_temp.anexar('d7g', 'o7g', 'F716-1');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(pg_temp.pago('o7g') = 'PAGO_POR_ANULAR'
                    and (select comprobante_en_camino_alcanza and pagada_dos_veces = 0 and comprobante_en_camino_saldo = 80
                                and salio_por_boleta = 361.50
                           from public.compras_con_boleta_por_pagar() where id = pg_temp.id('o7g')),
  'la factura sin OC de S/ 80 es la de la OC: su pago directo está por anular, sin pago doble (la factura no tiene pagos)');
select set_config('prueba.v7g', pg_temp.subir('pagos-facturas', 'f7g'), true);
select test.debe_fallar($$ select public.registrar_pago_factura(gen_random_uuid(), pg_temp.id('f7g'), current_setting('prueba.hoy')::date, 80,
                             'OP-4276', current_setting('prueba.v7g'), current_setting('prueba.caja')::uuid, null) $$,
  'y Tesorería no paga esa factura encima del pago directo', 'primero se anula ese pago');
reset role;
select test.afirmar((select count(*) = 1 and bool_and(cuerpo like '%con el mismo voucher por lo que le falta, S/ 80.00: el dinero ya salió, y los S/ 281.50 que salieron de más los devuelve el proveedor.')
                       from public.notificaciones
                      where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('o7g') and titulo like 'Llegó factura de una OC pagada: %'),
  'el aviso manda pagar con el voucher lo que le falta a la factura, y dice que lo de más lo devuelve el proveedor');

-- Con dos pagos a cuenta, lo que va con los mismos vouchers es lo que llevaban
-- los dos: anulado el primero, el aviso del segundo solo contaba ese y mandaba a
-- pagar de nuevo lo del primero (S/ 130 por una factura de S/ 100).
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('p7h1', 'o7h', 30, false, pg_temp.subir('pagos-compras', 'o7h'));
select pg_temp.pagar('p7h2', 'o7h', 40, false, pg_temp.subir('pagos-compras', 'o7h'));
reset role;
select pg_temp.como('contabilidad');
select pg_temp.con_pdf('f7h');
set local role authenticated;
select pg_temp.alta('f7h', 'Proveedor de prueba 421', 'F717-1');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f7h');
reset role;
select pg_temp.como('comprador');
select pg_temp.anexar('d7h', 'o7h', 'F717-1');
select test.afirmar((select count(*) = 1 and bool_and(cuerpo like '%(S/ 70.00)%'
                                                       and cuerpo like '%con los mismos vouchers por esos S/ 70.00: el dinero ya salió. Los S/ 291.50 que le faltan después son un pago nuevo.')
                       from public.notificaciones
                      where usuario_id = pg_temp.id('tesoreria') and origen_id = pg_temp.id('o7h') and titulo like 'Llegó factura de una OC pagada: %'),
  'con dos pagos, el aviso suma los dos y habla de los mismos vouchers');
select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_pago_compra(pg_temp.id('p7h1'), 'Se paga por su factura, con este voucher');
select test.afirmar((select pagos_vigentes = 1 and en_camino_salio = 70 from public.situacion_de_pago_de_compra(pg_temp.id('o7h'))),
  'anulado el primero, lo que ya salió por la boleta sigue siendo S/ 70');
select public.anular_pago_compra(pg_temp.id('p7h2'), 'Se paga por su factura, con este voucher');
select test.afirmar((select pagos_vigentes = 0 and en_camino_salio = 70 and en_camino_saldo = 361.50
                       from public.situacion_de_pago_de_compra(pg_temp.id('o7h')))
                    and not exists (select 1 from public.compras_con_boleta_por_pagar() where id = pg_temp.id('o7h')),
  'anulados los dos, con los vouchers van S/ 70 (no solo los 40 del último), a la factura le faltan 361.50 y la OC ya se paga por ella');
select test.afirmar(public.registrar_pago_factura(gen_random_uuid(), pg_temp.id('f7h'), current_setting('prueba.hoy')::date, 70, 'OP-4277',
                      pg_temp.subir('pagos-facturas', 'f7h'), current_setting('prueba.caja')::uuid, null) is not null,
  'y Tesorería paga la factura con esos S/ 70');
reset role;

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
-- La pagada a la que llegó su factura pide algo a Tesorería: sale antes que las por pagar.
set local session_replication_role = replica;
update public.pagos_orden_compra set cancela = true, cancela_sin_completar = true where id = pg_temp.id('p1');
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select array_agg(x.id order by x.ordinality) from public.compras_con_boleta_por_pagar() with ordinality x
                      where x.id in (pg_temp.id('oc1'), pg_temp.id('oc3'))) = array[pg_temp.id('oc1'), pg_temp.id('oc3')]
                    and (select cancelada and comprobante_en_camino is not null from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc1')),
  'la OC pagada con su pago por anular sale antes que la que está por pagar');
reset role;
set local session_replication_role = replica;
update public.pagos_orden_compra set cancela = false, cancela_sin_completar = false where id = pg_temp.id('p1');
set local session_replication_role = origin;
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
-- Contabilidad liga la OC 3 a una factura en borrador: desde ahí se paga por
-- ella, no directo. Con un pago directo vigente no se registra; anulado, entra.
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
select test.debe_fallar($$ select pg_temp.pagar('p4', 'oc3', 50, false, current_setting('prueba.v5')) $$,
  'con la factura en borrador, Tesorería ya no la paga directo', 'en borrador');
select test.afirmar((select comprobante_en_camino = 'F001-4213' and comprobante_en_camino_origen = 'BORRADOR'
                              and comprobante_en_camino_ruta is null
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc3')),
  'su lista dice qué comprobante tiene Contabilidad en borrador (todavía sin PDF)');
select test.afirmar(pg_temp.pago('oc3') = 'POR_FACTURAR', 'y Adquisiciones la da por esperar su factura, no por pagar directo');
reset role;
-- La de antes que trae factura tampoco se da por pagada fuera: se paga por ella.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set pago_en_tesoreria = false where id = pg_temp.id('oc3');
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(pg_temp.pago('oc3') = 'POR_FACTURAR',
  'la de antes con la factura en borrador espera su factura, no sale «pago fuera del sistema» ni ofrece «No se pagó»');
reset role;
set local session_replication_role = replica;
update public.ordenes_compra_materiales set pago_en_tesoreria = true where id = pg_temp.id('oc3');
set local session_replication_role = origin;
-- Con su PDF ya subido, el borrador se ve entre los documentos de Tesorería.
select pg_temp.como('contabilidad');
update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f3');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select comprobante_en_camino_bucket = 'comprobantes-financieros'
                              and comprobante_en_camino_ruta = 'adquisiciones/' || pg_temp.id('f3') || '/comprobante.pdf'
                       from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc3')),
  'el borrador con su PDF dice dónde abrirlo');
reset role;
-- Un pago directo de antes de la guarda, puesto con los disparadores apagados:
-- el borrador ya no se registra mientras siga vigente.
set local session_replication_role = replica;
insert into public.pagos_orden_compra (id, orden_compra_id, fecha_pago, moneda, monto, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('p4'), pg_temp.id('oc3'), current_setting('prueba.hoy')::date, 'PEN', 50, 'oc3/421-antes.pdf', 'application/pdf', 2048,
        pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
select test.debe_fallar($$ update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf'
                           where id = pg_temp.id('f3') $$,
  'y Contabilidad no registra la factura de una OC con pago directo vigente', 'Tesorería ya le pagó');
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
