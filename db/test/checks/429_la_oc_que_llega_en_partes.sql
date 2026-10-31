-- La OC que llega en partes, unas con boleta y otras con factura (decisión de DKS del 22/10,
-- migración 20261022200000). Con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`, con las políticas de Storage encendidas. Termina en rollback.
--
-- Un RQ con tres insumos; Logística compra cada uno en su OC:
--   · OC1, con factura (3 planchas a S/ 100, con IGV): una parte llega con la boleta B001-4291
--     por S/ 118 y el resto con la factura F001-4291 por S/ 236.
--       1. Logística anexa la boleta de la parte; lo que no cuadra no entra.
--       2. Contabilidad la ve esperando la factura del resto, con la boleta ya contada.
--       3. Tesorería paga la boleta en dos partes, hasta su monto, y la caja se mueve.
--       4. Contabilidad registra la factura del resto: calza, ya no espera factura y no toma lo
--          pagado por la boleta. Adquisiciones la da por facturada entera y pagada en parte;
--          pagada la factura, pagada la OC.
--       5. Lo que no se deshace por otro camino: la boleta con pago no se anula, la OC no baja
--          de lo que suman sus boletas ni se anula con un pago vigente; anulado el pago, la caja
--          lo saca.
--   · OC2, con boleta, que Tesorería ya empezó a pagar entera: ya no se le anexa una boleta de
--     una parte (ese pago cuenta para la factura que llegue, como antes).
--   · OC3, con boleta y sin pagos: con la boleta de una parte ya no se paga entera directo, sale
--     de «OC con boleta por pagar» y no cambia de moneda.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GGE', 'CONTABILIDAD:CON',
                           'TESORERIA:TES'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.429@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 429', lower(replace(v, ':', '.')) || '.429@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 429') = 6,
    'se crearon los seis usuarios del check, uno por puesto');
  -- Otra persona de Tesorería, para el mismo id desde otra cuenta.
  v_id := gen_random_uuid();
  insert into auth.users (id, email) values (v_id, 'tesoreria2.429@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
  select v_id, 'TESORERIA', 'Check 429 bis', 'tesoreria2.429@prueba.local', r.id, (select id from public.areas where codigo = 'TES')
    from public.roles r where r.codigo = 'TESORERIA';
  perform set_config('prueba.tesoreria2', v_id::text, true);
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK429-PLA', 'Plancha LAF 3 mm 4x8 (429)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000429' || d, 'Proveedor de prueba 429', 'Av. Argentina 429, Lima', '999 429 429' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000429' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  perform set_config('prueba.ruc', (select numero_documento from public.proveedores where id = v::uuid), true);
  foreach v in array array['rq', 'oc1', 'oc2', 'oc3', 'b1', 'b2', 'b3', 'bx', 'f1', 'p1', 'p2', 'p3', 'px', 'pf', 'pd2'] loop
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
-- Lo que hace el navegador con la sesión de quien sube: `{carpeta}/{archivo}.pdf`, por la política del bucket.
create or replace function pg_temp.subir(p_bucket text, p_carpeta text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_carpeta) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, v_ruta, auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  return v_ruta;
end $$;
-- Logística anexa a la OC la boleta de una parte (o lo que se le pase), como `registrarDocumentoCompra`.
create or replace function pg_temp.anexar(p_doc text, p_oc text, p_tipo text, p_numero text, p_fecha date, p_monto numeric)
returns void language plpgsql as $$
declare v_ruta text := 'compra/' || pg_temp.id(p_oc) || '/' || pg_temp.id(p_doc) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-compras', v_ruta, auth.uid(), auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                                 subido_por, numero_documento, fecha_emision, monto_de_la_parte, parte_trae_igv)
  values (pg_temp.id(p_doc), pg_temp.id(p_oc), p_tipo, 'boleta-' || coalesce(p_numero, 'x') || '.pdf', v_ruta, 'application/pdf', 2048,
          public.usuario_actual(), p_numero, p_fecha, p_monto, case when p_monto is not null then true end);
end $$;
create or replace function pg_temp.pagar_parte(p_pago text, p_doc text, p_monto numeric, p_ruta text)
returns uuid language sql as $$
  select public.registrar_pago_parte_con_boleta(pg_temp.id(p_pago), pg_temp.id(p_doc), current_setting('prueba.hoy')::date,
    p_monto, 'OP-429', p_ruta, current_setting('prueba.caja')::uuid, null);
$$;
create or replace function pg_temp.pago(p_clave text) returns text language sql as $$
  select t.pago from public.trazabilidad_de_compras() t where t.id = pg_temp.id(p_clave);
$$;

-- ============================================ 0. Puertas
do $$
declare f text;
begin
  foreach f in array array['public.registrar_pago_parte_con_boleta(uuid, uuid, date, numeric, text, text, uuid, numeric)',
                           'public.anular_pago_parte_con_boleta(uuid, text)', 'public.partes_con_boleta_por_pagar()'] loop
    perform test.afirmar(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
      f || ': la llama quien inicia sesión, no anon');
  end loop;
  foreach f in array array['public.partes_con_boleta_de_la_compra(uuid)', 'public.compras_facturadas(uuid[], uuid)',
                           'public.fn_parte_con_boleta_valida()', 'public.fn_pago_compra_sin_partes()',
                           'public.fn_compra_con_partes_no_cambia()', 'public.fn_compra_con_partes_total()',
                           'public.fn_pago_parte_guardia()'] loop
    perform test.afirmar(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'),
      f || ': es interna');
  end loop;
  perform test.afirmar((select relrowsecurity from pg_class where oid = 'public.pagos_parte_con_boleta'::regclass),
    'el pago de la boleta de una parte tiene RLS');
  perform test.afirmar(not has_table_privilege('authenticated', 'public.pagos_parte_con_boleta', 'insert')
                       and not has_table_privilege('authenticated', 'public.pagos_parte_con_boleta', 'update')
                       and not has_table_privilege('authenticated', 'public.pagos_parte_con_boleta', 'delete'),
    'y solo se escribe por sus funciones');
end $$;

-- ============================================ 1. Un RQ con tres OC
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('area_mtz'),
  'PLA_SR_O4_1_26/29', 'Armado de la plataforma 29', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 3) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(pg_temp.id('rq'), 'No hay nada de esto');
reset role;
-- La 1 va con factura; la 2 y la 3, con boleta.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_del_requerimiento(pg_temp.id('oc' || n), pg_temp.id('rq'), array[n::smallint], pg_temp.id('proveedor'), null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 100)),
  null, 'CONTADO', 0, 'PEN', n = 1)
  from generate_series(1, 3) n;
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc' || n)) from generate_series(1, 3) n
 where (select aprobacion from public.ordenes_compra_materiales where id = pg_temp.id('oc' || n)) = 'POR_APROBAR';
reset role;
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);
select set_config('prueba.caja2', test.crear_caja('PEN')::text, true);
select test.afirmar(public.total_orden_compra(pg_temp.id('oc1')) = 354 and public.total_orden_compra(pg_temp.id('oc3')) = 300,
  'la OC con factura suma con IGV (S/ 354) y la de boleta sin él (S/ 300)');

-- ============================================ 2. Logística anexa la boleta de una parte
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', 'B001-4290', current_setting('prueba.hoy')::date, 353.50) $$,
  'la boleta de una parte deja algo para la factura', 'tiene que quedar algo para la factura');
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'FACTURA', 'F001-4290', current_setting('prueba.hoy')::date, 100) $$,
  'el monto de la parte es solo de la boleta, nota de venta o recibo', 'ck_documento_compra_parte');
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', 'B001-4290', current_setting('prueba.hoy')::date + 1, 100) $$,
  'la boleta no es de mañana', 'posterior a hoy');
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', null, current_setting('prueba.hoy')::date, 100) $$,
  'la boleta de una parte lleva su número', 'ck_documento_compra_parte');
select pg_temp.anexar('b1', 'oc1', 'COMPROBANTE', 'b001-4291', current_setting('prueba.hoy')::date, 118);
select test.afirmar((select numero_documento = 'B001-4291' and monto_de_la_parte = 118 from public.documentos_compra_material
                      where id = pg_temp.id('b1')),
  'Logística anexa la boleta B001-4291 de una parte, por S/ 118, con su número en mayúsculas');
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', 'B001-004291', current_setting('prueba.hoy')::date, 10) $$,
  'la misma boleta no se anexa dos veces, aunque se escriba con ceros', 'ya está anexada');
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', 'B001-4290', current_setting('prueba.hoy')::date, 236) $$,
  'las boletas de una parte, juntas, también dejan algo para la factura', 'tiene que quedar algo para la factura');
reset role;
select test.afirmar((select count(*) from public.notificaciones where usuario_id = pg_temp.id('tesoreria')
                      and titulo like 'Boleta de una parte por pagar%' and origen_id = pg_temp.id('b1')) = 1,
  'a Tesorería le llega el aviso de la boleta por pagar');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', 'B001-4290', current_setting('prueba.hoy')::date, 10) $$,
  'Contabilidad no anexa a la OC: lo hace Logística', 'row-level security');

-- ============================================ 3. Contabilidad la ve esperando la factura del resto
select test.afirmar(exists (select 1 from public.compras_sin_factura() where orden_compra_id = pg_temp.id('oc1')),
  'la OC sigue esperando la factura del resto');
select test.afirmar((select facturado = 118 and not completa and facturas @> '[{"numero_documento": "boleta B001-4291", "boleta": true}]'
                       from public.facturado_de_compras(array[pg_temp.id('oc1')])),
  'y lo facturado ya cuenta la boleta de la parte, con su nombre');
reset role;

-- ============================================ 4. Tesorería paga la boleta de la parte
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select * from public.partes_con_boleta_por_pagar() $$,
  'Logística no ve la lista de Tesorería', 'No tienes permiso para ver las boletas de una parte por pagar');
select test.debe_fallar($$ select public.registrar_pago_parte_con_boleta(gen_random_uuid(), pg_temp.id('b1'), current_setting('prueba.hoy')::date,
                                    10, null, 'x', current_setting('prueba.caja')::uuid, null) $$,
  'ni la paga', 'permiso');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select monto = 118 and pagado = 0 and saldo = 118 and boleta = 'B001-4291' and con_factura
                            and vence = current_setting('prueba.hoy')::date and proveedor_documento = current_setting('prueba.ruc')
                       from public.partes_con_boleta_por_pagar() where documento_id = pg_temp.id('b1')),
  'Tesorería ve la boleta de la parte por pagar: S/ 118, al contado, con el RUC del proveedor');
select set_config('prueba.v1', pg_temp.subir('pagos-compras', 'oc1'), true);
select pg_temp.pagar_parte('p1', 'b1', 50, current_setting('prueba.v1'));
select test.afirmar((select tipo = 'EGRESO' and monto = 50 and caja_id = current_setting('prueba.caja')::uuid and anulado_en is null
                       from public.movimientos_caja where origen = 'PAGO_PARTE_BOLETA' and origen_id = pg_temp.id('p1')),
  'el pago sale de la cuenta que eligió Tesorería');
select test.afirmar(pg_temp.pagar_parte('p1', 'b1', 50, current_setting('prueba.v1')) = pg_temp.id('p1')
                    and (select count(*) from public.pagos_parte_con_boleta where documento_compra_id = pg_temp.id('b1')) = 1,
  'el mismo envío dos veces entra una vez');
select test.debe_fallar($$ select pg_temp.pagar_parte('p1', 'b1', 40, current_setting('prueba.v1')) $$,
  'con otro monto y el mismo id, se rechaza', 'ya quedó registrado');
-- La cuenta de la que salió también es parte del envío (20261023100000).
select test.debe_fallar($$ select public.registrar_pago_parte_con_boleta(pg_temp.id('p1'), pg_temp.id('b1'),
                                    current_setting('prueba.hoy')::date, 50, 'OP-429', current_setting('prueba.v1'),
                                    current_setting('prueba.caja2')::uuid, null) $$,
  'desde otra cuenta y con el mismo id, ya no es el mismo envío: dice que el primero ya quedó', 'la primera vez que lo enviaste');
reset role;
select pg_temp.como('tesoreria2');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.pagar_parte('p1', 'b1', 50, current_setting('prueba.v1')) $$,
  'el mismo id desde otra cuenta de Tesorería no es su envío: ya existe con otros datos', 'ya existe con otros datos');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) = 1 and min(monto) = 50 from public.movimientos_caja
                      where origen = 'PAGO_PARTE_BOLETA' and origen_id = pg_temp.id('p1')),
  'y la caja sigue con un solo egreso de ese pago, en la cuenta de la primera vez');
select set_config('prueba.v2', pg_temp.subir('pagos-compras', 'oc1'), true);
select test.debe_fallar($$ select pg_temp.pagar_parte('p2', 'b1', 80, current_setting('prueba.v2')) $$,
  'no se paga más que la boleta', 'le quedan S/ 68.00');
select test.debe_fallar($$ select pg_temp.pagar_parte('p2', 'b1', 10, current_setting('prueba.v1')) $$,
  'ni con el voucher de otro pago', 'ya es el de otro pago');
select pg_temp.pagar_parte('p2', 'b1', 68, current_setting('prueba.v2'));
select test.afirmar((select pagado = 118 and saldo = 0 and jsonb_array_length(pagos) = 2
                       from public.partes_con_boleta_por_pagar() where documento_id = pg_temp.id('b1')),
  'con el segundo pago la boleta queda pagada, y sigue a la vista con sus dos pagos');
select set_config('prueba.v3', pg_temp.subir('pagos-compras', 'oc1'), true);
select test.debe_fallar($$ select pg_temp.pagar_parte('p3', 'b1', 1, current_setting('prueba.v3')) $$,
  'pagada, no se paga otra vez', 'ya está pagada');
select test.afirmar((select count(*) from storage.objects where bucket_id = 'pagos-compras' and name = current_setting('prueba.v1')) = 1,
  'Tesorería ve el voucher del pago');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select count(*) from public.pagos_parte_con_boleta where documento_compra_id = pg_temp.id('b1')) = 2,
  'Logística, que emitió la OC, ve los pagos de su boleta');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select count(*) from public.pagos_parte_con_boleta) = 0,
  'Almacén no ve cuánto se le pagó al proveedor');
reset role;

-- ============================================ 5. Contabilidad registra la factura del resto
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago)
values (pg_temp.id('f1'), 'FACTURA_COMPRA', 'Proveedor de prueba 429', current_setting('prueba.ruc'), 'F001-4291',
        current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 236, 'CONTADO');
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id, parcial) values (pg_temp.id('f1'), pg_temp.id('oc1'), true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f1') || '/comprobante.pdf', auth.uid()::text,
        '{"mimetype": "application/pdf", "size": 2048}');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf'
 where id = pg_temp.id('f1');
select test.afirmar((select control = 'CALZA' and total_oc = 236 and diferencia = 0
                       from public.adquisiciones_control(array[pg_temp.id('f1')])),
  'la factura del resto calza: de la OC faltaba facturar S/ 236');
select test.afirmar(not exists (select 1 from public.compras_sin_factura() where orden_compra_id = pg_temp.id('oc1')),
  'y la OC ya no espera factura');
select test.afirmar((select facturada_entera and pago = 'PAGO_PARCIAL'
                            and (select (e->>'monto_de_la_parte')::numeric = 118 and jsonb_array_length(e->'pagos_de_la_parte') = 2
                                   from jsonb_array_elements(documentos) e where e->>'id' = pg_temp.id('b1')::text)
                       from public.trazabilidad_de_compras() where id = pg_temp.id('oc1')),
  'Adquisiciones la da por facturada entera y pagada en parte, con la boleta, su monto y sus pagos');
reset role;
select test.afirmar(not exists (select 1 from public.pagos_adquisicion where adquisicion_id = pg_temp.id('f1')),
  'la factura no toma lo pagado por la boleta de la parte: lo debe entero');
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_pago_factura(pg_temp.id('pf'), pg_temp.id('f1'), current_setting('prueba.hoy')::date, 236, 'OP-429F',
  pg_temp.subir('pagos-facturas', 'f1'), current_setting('prueba.caja')::uuid, null);
select test.afirmar(pg_temp.pago('oc1') = 'PAGADA', 'pagadas la factura y la boleta, la OC está pagada');

-- ============================================ 6. Lo que no se deshace por otro camino
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select public.anular_documento_compra(pg_temp.id('b1'), 'La boleta era de otra compra del proveedor') $$,
  'la boleta con pagos vigentes no se anula', 'primero se anula ese pago');
reset role;
select test.debe_fallar($$ update public.orden_compra_material_detalles set precio_unitario = 30 where orden_compra_id = pg_temp.id('oc1') $$,
  'la OC no baja de lo que suman sus boletas de una parte', 'su total no baja de eso');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ update public.pagos_parte_con_boleta set monto = 1 where id = pg_temp.id('p2') $$,
  'el pago no se corrige a mano', 'permission denied');
select public.anular_pago_parte_con_boleta(pg_temp.id('p2'), 'El banco rechazó la transferencia');
select test.afirmar(public.anular_pago_parte_con_boleta(pg_temp.id('p2'), 'El banco rechazó la transferencia') = pg_temp.id('p2'),
  'un segundo clic en anular no hace nada');
select test.afirmar((select anulado_en is not null from public.movimientos_caja where origen = 'PAGO_PARTE_BOLETA' and origen_id = pg_temp.id('p2'))
                    and (select saldo = 68 from public.partes_con_boleta_por_pagar() where documento_id = pg_temp.id('b1'))
                    and pg_temp.pago('oc1') = 'PAGO_PARCIAL',
  'anulado el pago, la caja lo saca, la boleta vuelve a deber S/ 68 y la OC queda pagada en parte');
select test.debe_fallar($$ select public.anular_pago_parte_con_boleta(pg_temp.id('p1'), 'corto') $$,
  'anular pide su motivo', '10 a 500');
reset role;
select test.debe_fallar($$ delete from public.pagos_parte_con_boleta where id = pg_temp.id('p1') $$,
  'ni el dueño de la tabla borra un pago', 'no se borra');
select test.debe_fallar($$ update public.ordenes_compra_materiales set aprobacion = 'ANULADA' where id = pg_temp.id('oc1') $$,
  'la OC no se anula con un pago vigente de su boleta de una parte', 'no se anula mientras ese pago siga vigente');

-- ============================================ 7. La OC con boleta que Tesorería ya empezó a pagar entera
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_pago_compra(pg_temp.id('pd2'), pg_temp.id('oc2'), current_setting('prueba.hoy')::date, 50, false,
  'OP-429D', null, pg_temp.subir('pagos-compras', 'oc2'), current_setting('prueba.caja')::uuid, null);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anexar('b2', 'oc2', 'COMPROBANTE', 'B001-4292', current_setting('prueba.hoy')::date, 100) $$,
  'a la OC con boleta que Tesorería ya empezó a pagar no se le anexa la boleta de una parte', 'ya empezó a pagar');

-- ============================================ 8. La OC con boleta que llega en partes
select pg_temp.anexar('b3', 'oc3', 'COMPROBANTE', 'B001-4293', current_setting('prueba.hoy')::date, 100);
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.registrar_pago_compra(gen_random_uuid(), pg_temp.id('oc3'), current_setting('prueba.hoy')::date, 10, false,
                                    null, null, pg_temp.subir('pagos-compras', 'oc3'), current_setting('prueba.caja')::uuid, null) $$,
  'con la boleta de una parte, la boleta entera ya no se paga directo', 'llegó en partes');
select test.afirmar(not exists (select 1 from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc3'))
                    and exists (select 1 from public.compras_con_boleta_por_pagar() where id = pg_temp.id('oc2'))
                    and exists (select 1 from public.partes_con_boleta_por_pagar() where documento_id = pg_temp.id('b3') and not con_factura),
  'sale de las OC con boleta por pagar y su boleta, de las boletas de una parte; la que no llegó en partes sigue ahí');
select test.afirmar(pg_temp.pago('oc3') = 'POR_PAGAR', 'Adquisiciones la tiene por pagar');
reset role;
select test.debe_fallar($$ update public.ordenes_compra_materiales set moneda = 'USD' where id = pg_temp.id('oc3') $$,
  'con la boleta de una parte, la OC no cambia de moneda', 'no cambia de moneda');
select test.debe_fallar($$ update public.ordenes_compra_materiales set con_factura = true where id = pg_temp.id('oc3') $$,
  'ni pasa de boleta a factura', 'no cambia de moneda ni de factura a boleta');
select test.debe_fallar($$ update public.ordenes_compra_materiales set con_factura = false where id = pg_temp.id('oc1') $$,
  'ni de factura a boleta, que le quitaría el IGV por debajo de sus boletas', 'no cambia de moneda ni de factura a boleta');

-- ============================================ 9. Lo que no se cuenta dos veces
select set_config('prueba.' || v, gen_random_uuid()::text, true) from unnest(array['fx', 'f3', 'pf3', 'p3b']) v;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($$ insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento,
                                                             moneda, total, condicion_pago)
                          values (pg_temp.id('fx'), 'OTRO', 'Proveedor de prueba 429', current_setting('prueba.ruc'), 'B001-004291',
                                  current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 118, 'CONTADO') $$,
  'la boleta de una parte no se registra además como comprobante en Adquisiciones', 'No se registra otra vez');
-- Al revés: el comprobante que Contabilidad ya registró no se anexa después como boleta de una parte.
select set_config('prueba.fy', gen_random_uuid()::text, true);
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago)
values (pg_temp.id('fy'), 'OTRO', 'Proveedor de prueba 429', current_setting('prueba.ruc'), 'B001-4299',
        current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 10, 'CONTADO');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($$ select pg_temp.anexar('bx', 'oc1', 'COMPROBANTE', 'b001-04299', current_setting('prueba.hoy')::date, 10) $$,
  'ni el comprobante ya registrado en Adquisiciones se anexa después como boleta de una parte', 'ya está registrado en Adquisiciones');
reset role;
select test.afirmar(public.motivo_para_no_anular_compra(pg_temp.id('oc3')) = 'La OC-' || split_part((select numero from public.ordenes_compra_materiales where id = pg_temp.id('oc3')), '-', 2)
                      || '-MW tiene anexada la boleta B001-4293 de una parte: que Logística la anule antes.',
  'Gerencia no ve como anulable la OC con boleta de una parte: dice qué anular antes');
-- La OC 3, con su boleta de una parte de S/ 100 pagada, recibe una factura por toda la OC (S/ 300) y se paga: pagada de más.
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar_parte('p3b', 'b3', 100, pg_temp.subir('pagos-compras', 'oc3'));
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, orden_compra_id)
values (pg_temp.id('f3'), 'FACTURA_COMPRA', 'Proveedor de prueba 429', current_setting('prueba.ruc'), 'F001-4293',
        current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 300, 'CONTADO', pg_temp.id('oc3'));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f3') || '/comprobante.pdf', auth.uid()::text,
        '{"mimetype": "application/pdf", "size": 2048}');
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf' where id = pg_temp.id('f3');
select test.afirmar((select control <> 'CALZA' from public.adquisiciones_control(array[pg_temp.id('f3')])),
  'la factura por toda la OC no calza: una parte ya vino con boleta');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_pago_factura(pg_temp.id('pf3'), pg_temp.id('f3'), current_setting('prueba.hoy')::date, 300, 'OP-429G',
  pg_temp.subir('pagos-facturas', 'f3'), current_setting('prueba.caja')::uuid, null);
select test.afirmar(pg_temp.pago('oc3') = 'PAGADA_DE_MAS', 'pagadas la boleta y la factura entera, Adquisiciones la da por pagada de más, no por pagada');
select public.anular_pago_parte_con_boleta(pg_temp.id('p3b'), 'Se pagó dos veces: la factura ya la cubría');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_compra(pg_temp.id('b3'), 'La factura del proveedor ya cubre toda la OC');
reset role;
select test.afirmar((select count(*) from public.notificaciones where usuario_id = pg_temp.id('tesoreria')
                      and titulo like 'Boleta de una parte anulada%' and origen_id = pg_temp.id('b3')) = 1,
  'anulada la boleta de una parte, a Tesorería le llega el aviso');

rollback;
