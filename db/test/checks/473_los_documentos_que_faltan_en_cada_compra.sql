-- Qué documento tiene cada OC y cada OS, cuál le falta y desde cuándo (Plan 10, entrega 10.2;
-- migración 20261126480000). Con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
--
-- Una OC con factura de 10 discos, que Gerencia aprobó hace 5 días:
--   1. Falta su factura, desde la aprobación (5 días). Entra a la lista del conductor:
--      falta su guía desde ese momento. Contabilidad la carga: está, con su número.
--   2. Contabilidad registra la factura entera: está, con su número.
--   3. Almacén devuelve 2 sin reposición: falta la nota de crédito, desde la devolución.
--      Contabilidad registra la nota: está, con su número.
-- Una OS afecta a detracción, aprobada hace 3 días, y otra sin detracción:
--   4. Falta su comprobante desde la aprobación; la detracción no se pide antes del
--      primer pago al proveedor. Pagado el proveedor, falta la detracción; depositada
--      en parte, EN_PARTE; entera, está. La OS sin detracción no la pide nunca.
--   5. Adjunto el comprobante, está.
--   6. Quién la lee: Contabilidad, Logística, Tesorería y Gerencia lo mismo; Supervisión
--      y Almacén, no. Y nada de esto borra ni cambia un documento.
--   7. (va antes que la 6) Lo que hallaron los auditores: la OC dejada sin guía la sigue pidiendo; la OC con
--      boleta no pide nota de crédito; la factura anexada y el comprobante anotado al
--      pagar están por registrar; la OS afecta bajo el mínimo no pide detracción.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'SUPERVISOR:MTZ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GGE',
                           'CONDUCTOR:LOG', 'CONTABILIDAD:CON', 'TESORERIA:TES'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.473@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 473', lower(replace(v, ':', '.')) || '.473@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 473') = 8,
    'se crearon los ocho usuarios del check, uno por puesto');
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.hoy', (now() at time zone 'America/Lima')::date::text, true);
  foreach v in array array['rq', 'oc', 'ing', 'f1', 'dev1', 'nc1', 'guia', 'os', 'sin', 'p1', 'p2', 'p3', 'p4', 'rq2', 'rq3', 'ocb', 'oc2', 'ingb', 'devb', 'devb2', 'devb3', 'devb4', 'min', 'p5', 'fb'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$ select current_setting('prueba.' || p_clave)::uuid $$;
-- La fila de un documento de una compra, como la lee quien está en la sesión.
create or replace function pg_temp.doc(p_compra text, p_documento text)
returns table (situacion text, desde timestamptz, dias integer, numeros text) language sql as $$
  select d.situacion, d.desde, d.dias, d.numeros from public.documentos_de_las_compras() d
   where d.compra = pg_temp.id(p_compra) and d.documento = p_documento;
$$;
create or replace function pg_temp.pagar(p_os text, p_pago text, p_monto numeric, p_destino text) returns uuid language plpgsql as $$
declare v_ruta text := pg_temp.id(p_os) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('pagos-servicio', v_ruta, auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  return public.registrar_pago_servicio(pg_temp.id(p_pago), pg_temp.id(p_os), current_setting('prueba.hoy')::date, p_monto, false,
    'OP-473-' || p_pago, null, v_ruta, pg_temp.id('caja'), null, p_destino);
end $$;

-- Armazón, como dueño: un material, una unidad, un proveedor, dos OS aprobadas hace 3 días y la caja.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK473-1', 'Disco de corte de prueba 473', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.unidades (placa, tipo_vehiculo, marca, codigo_interno, activo)
  values ('CHK-473', 'CAMION', 'Volvo', 'CHK473_A', true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 473 S.A.C.'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(473000, 473200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores p where p.numero_documento = x.r)
   order by r limit 1;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 473 S.A.C.'), true);
  perform set_config('prueba.ruc', (select numero_documento from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 473 S.A.C.'), true);
  insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, monto_pen, moneda, codigo_interno,
                                       aprobacion, aprobado_por, aprobado_en, creado_por,
                                       detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo, detraccion_motivo)
  values (pg_temp.id('os'), 'QA-OS-473', pg_temp.id('proveedor'), 'PROVEEDOR DE PRUEBA 473 S.A.C.', 'Servicio de prueba del check 473',
          1800, 1800, 'PEN', 'CHK473_A', 'APROBADA', pg_temp.id('gerente'), now() - interval '3 days', pg_temp.id('comprador'),
          true, '020', 12, 700, null),
         (pg_temp.id('sin'), 'QA-OS-473-SIN', pg_temp.id('proveedor'), 'PROVEEDOR DE PRUEBA 473 S.A.C.', 'Servicio sin detracción del check 473',
          500, 500, 'PEN', 'CHK473_A', 'APROBADA', pg_temp.id('gerente'), now() - interval '3 days', pg_temp.id('comprador'),
          false, null, null, null, 'No llega al mínimo de la detracción');
end $$;
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);

-- Requerimientos pide 10; Logística los compra con factura; Gerencia la aprueba.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), 'OPERACION', pg_temp.id('area_mtz'),
  'CHK473_A', 'Discos para la prueba 473', null, format('[{"material_id": "%s", "cantidad": 10}]', current_setting('prueba.m1'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(pg_temp.id('rq'), '[{"item": 1, "en_stock": 0}]'::jsonb, null);
reset role;
select set_config('prueba.linea', (select l.id::text from public.requerimiento_lineas l where l.requerimiento_id = pg_temp.id('rq')), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(pg_temp.id('oc'),
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 10, 'precio', 10,
                                       'insumos', jsonb_build_array(current_setting('prueba.linea')))),
  pg_temp.id('proveedor'), 'COT-473', null, 'CONTADO', 0, 'PEN', true);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc')) from public.ordenes_compra_materiales
 where id = pg_temp.id('oc') and aprobacion = 'POR_APROBAR';
reset role;
-- La aprobación fue hace 5 días: se corre la fecha como dueño, sin disparadores.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set aprobado_en = now() - interval '5 days' where id = pg_temp.id('oc');
set local session_replication_role = origin;

-- ============================================ 1. La factura y la guía
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' and dias = 5 and numeros is null from pg_temp.doc('oc', 'FACTURA')),
    'a la OC aprobada hace 5 días le falta la factura, desde la aprobación');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('oc', 'GUIA')), 'antes de la lista del conductor no se pide la guía');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('oc', 'NOTA_CREDITO')), 'sin devolución no se pide nota de crédito');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('oc', 'BOLETA')), 'la OC con factura no pide boleta');
end $$;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.mandar_compra_a_recojo(pg_temp.id('oc'));
select public.programar_recojo(pg_temp.id('oc'), 25, null);
reset role;
-- Cuándo entró a la lista, leído como dueño: Contabilidad no lee la lista del conductor.
select set_config('prueba.en_lista', (select coalesce(programado_en, creado_en)::text from public.programacion_recojo
                                       where orden_compra_id = pg_temp.id('oc')), true);
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' and dias = 0
                               and desde = current_setting('prueba.en_lista')::timestamptz
                          from pg_temp.doc('oc', 'GUIA')),
    'en la lista del conductor le falta la guía, desde que entró a la lista');
  perform test.afirmar(exists (select 1 from public.guias_por_emitir() where orden_compra_id = pg_temp.id('oc')),
    'y es la misma que espera en la bandeja de guías de Contabilidad');
end $$;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('guias-remision', 'compra/' || pg_temp.id('oc') || '/' || pg_temp.id('guia') || '.pdf', auth.uid()::text,
        '{"mimetype": "application/pdf", "size": 48211}');
select public.cargar_guia_remision(pg_temp.id('guia'), pg_temp.id('oc'), 'T001-00000473', current_setting('prueba.hoy')::date, 'guia-t001-473.pdf');
do $$ begin
  perform test.afirmar((select situacion = 'ESTA' and dias is null and numeros = 'T001-00000473' from pg_temp.doc('oc', 'GUIA')),
    'cargada la guía, está, con su número');
end $$;
reset role;

-- El conductor la deja y Almacén valida los 10.
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.id('oc'));
select public.marcar_compra_recogida(pg_temp.id('oc'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oc'));
reset role;
select set_config('prueba.ingresos',
  (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', current_setting('prueba.ing'), 'cantidad', 10))
     from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('oc'))::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc'), current_setting('prueba.ingresos')::jsonb, null);
reset role;

-- ============================================ 2. Contabilidad registra la factura entera
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, orden_compra_id)
values (pg_temp.id('f1'), 'FACTURA_COMPRA', 'PROVEEDOR DE PRUEBA 473 S.A.C.', current_setting('prueba.ruc'), 'F001-4731',
        current_setting('prueba.hoy')::date - 1, current_setting('prueba.hoy')::date - 1, 'PEN', 118, 'CONTADO', pg_temp.id('oc'));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || pg_temp.id('f1') || '/comprobante.pdf', auth.uid()::text,
        '{"mimetype": "application/pdf", "size": 2048}');
update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
 where id = pg_temp.id('f1');
do $$ begin
  perform test.afirmar((select situacion = 'ESTA' and dias is null and numeros = 'F001-4731' from pg_temp.doc('oc', 'FACTURA')),
    'registrada la factura entera, está, con su número');
end $$;
reset role;

-- ============================================ 3. La nota de crédito de lo devuelto
select pg_temp.como('almacenero');
set local role authenticated;
select public.devolver_al_proveedor(pg_temp.id('dev1'), pg_temp.id('ing'), 2, 'GR-DEV-473', 'Dos discos llegaron partidos', false);
reset role;
select test.afirmar(exists (select 1 from public.notificaciones n where n.usuario_id = pg_temp.id('contabilidad')
                              and n.origen_id = pg_temp.id('oc') and n.titulo like 'Espera la nota de crédito%'),
  'de la OC con factura, a Contabilidad le llega «Espera la nota de crédito»');
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' and dias = 0 and numeros is null
                               and desde = (select registrado_en from public.movimientos_materiales where id = pg_temp.id('dev1'))
                          from pg_temp.doc('oc', 'NOTA_CREDITO')),
    'devueltos 2 sin reposición, falta la nota de crédito, desde la devolución');
  perform test.afirmar(exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('dev1')),
    'y es la misma que espera en «Esperan nota de crédito»');
end $$;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('notas-credito', pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf', pg_temp.id('contabilidad'),
        pg_temp.id('contabilidad')::text, '{"mimetype": "application/pdf", "size": 2048}');
select public.registrar_nota_credito(pg_temp.id('nc1'), pg_temp.id('f1'), 'FC01-473', current_setting('prueba.hoy')::date, 23.60,
  'DEVOLUCION', pg_temp.id('dev1'), 'Dos discos partidos devueltos', pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf');
do $$ begin
  perform test.afirmar((select situacion = 'ESTA' and dias is null and numeros = 'FC01-473' from pg_temp.doc('oc', 'NOTA_CREDITO')),
    'registrada la nota, está, con su número');
end $$;
reset role;

-- ============================================ 4. El comprobante y la detracción de la OS
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' and dias = 3 from pg_temp.doc('os', 'COMPROBANTE')),
    'a la OS aprobada hace 3 días le falta su comprobante, desde la aprobación');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('os', 'DETRACCION')),
    'la detracción no se pide antes del primer pago al proveedor');
end $$;
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('os', 'p1', 1000, 'PROVEEDOR');
select pg_temp.pagar('sin', 'p4', 200, 'PROVEEDOR');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' and dias = 0
                               and desde = (select fecha_pago::timestamp at time zone 'America/Lima' from public.pagos_orden_servicio where id = pg_temp.id('p1'))
                          from pg_temp.doc('os', 'DETRACCION')),
    'pagado el proveedor, falta la detracción, desde la fecha de ese pago');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('sin', 'DETRACCION')), 'la OS sin detracción no la pide aunque se pague');
end $$;
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('os', 'p2', 100, 'DETRACCION');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'EN_PARTE' and dias = 0 and numeros = 'OP-473-p2' from pg_temp.doc('os', 'DETRACCION')),
    'depositada una parte de la detracción (S/ 100 de S/ 255), está en parte, con su operación');
end $$;
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar('os', 'p3', 155, 'DETRACCION');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'ESTA' and dias is null and numeros = 'OP-473-p2, OP-473-p3' from pg_temp.doc('os', 'DETRACCION')),
    'depositada entera, está, con sus dos operaciones');
end $$;
reset role;

-- ============================================ 5. El comprobante de la OS, adjunto
set local session_replication_role = replica;
insert into public.documentos_orden_servicio (orden_servicio_id, tipo, numero, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (pg_temp.id('os'), 'FACTURA', 'E001-473', 'e001-473.pdf', pg_temp.id('os') || '/e001-473.pdf', 'application/pdf', 2048, pg_temp.id('comprador'));
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'ESTA' and dias is null and numeros = 'E001-473' from pg_temp.doc('os', 'COMPROBANTE')),
    'adjunta su factura, la OS tiene su comprobante');
  perform test.afirmar((select situacion = 'FALTA' from pg_temp.doc('sin', 'COMPROBANTE')),
    'a la otra OS le sigue faltando');
end $$;
-- Lo que ve Contabilidad de estas tres órdenes, para comparar con los demás puestos.
select set_config('prueba.visto', (
  select string_agg(format('%s:%s:%s:%s:%s', d.compra, d.documento, d.situacion, d.dias, d.numeros), '|' order by d.compra, d.documento)
    from public.documentos_de_las_compras() d where d.compra in (pg_temp.id('oc'), pg_temp.id('os'), pg_temp.id('sin'))), true);
reset role;

-- ============================================ 7. Lo que encontraron los auditores
-- a) La OC con boleta que el conductor dejó sin guía, y de la que Almacén devolvió 2:
--    la guía sigue faltando después de dejarla, y la nota de crédito no se le pide
--    (se registra contra una factura, y esta OC no tiene).
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq2'), 'OPERACION', pg_temp.id('area_mtz'),
  'CHK473_A', 'Discos con boleta para la prueba 473', null, format('[{"material_id": "%s", "cantidad": 10}]', current_setting('prueba.m1'))::jsonb);
select public.emitir_requerimiento(pg_temp.id('rq3'), 'OPERACION', pg_temp.id('area_mtz'),
  'CHK473_A', 'Discos con factura anexada para la prueba 473', null, format('[{"material_id": "%s", "cantidad": 10}]', current_setting('prueba.m1'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(pg_temp.id('rq2'), '[{"item": 1, "en_stock": 0}]'::jsonb, null);
select public.rq_revisar_stock(pg_temp.id('rq3'), '[{"item": 1, "en_stock": 0}]'::jsonb, null);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(pg_temp.id('ocb'),
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 10, 'precio', 10,
    'insumos', (select jsonb_agg(l.id) from public.requerimiento_lineas l where l.requerimiento_id = pg_temp.id('rq2')))),
  pg_temp.id('proveedor'), 'COT-473-B', null, 'CONTADO', 0, 'PEN', false);
select public.emitir_compra_de_requerimientos(pg_temp.id('oc2'),
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 10, 'precio', 10,
    'insumos', (select jsonb_agg(l.id) from public.requerimiento_lineas l where l.requerimiento_id = pg_temp.id('rq3')))),
  pg_temp.id('proveedor'), 'COT-473-C', null, 'CONTADO', 0, 'PEN', true);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(c.id) from public.ordenes_compra_materiales c
 where c.id in (pg_temp.id('ocb'), pg_temp.id('oc2')) and c.aprobacion = 'POR_APROBAR';
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.mandar_compra_a_recojo(pg_temp.id('ocb'));
select public.programar_recojo(pg_temp.id('ocb'), 25, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.id('ocb'));
select public.marcar_compra_recogida(pg_temp.id('ocb'));
select public.marcar_compra_dejada_almacen(pg_temp.id('ocb'));
reset role;
select set_config('prueba.ingresos_b',
  (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', current_setting('prueba.ingb'), 'cantidad', 10))
     from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('ocb'))::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('ocb'), current_setting('prueba.ingresos_b')::jsonb, null);
select public.devolver_al_proveedor(pg_temp.id('devb'), pg_temp.id('ingb'), 2, 'GR-DEV-473B', 'Dos discos llegaron partidos', false);
-- Otro que el proveedor iba a reponer y después ya no repone.
select public.devolver_al_proveedor(pg_temp.id('devb2'), pg_temp.id('ingb'), 1, 'GR-DEV-473C', 'Un disco llegó rayado', true);
select public.dejar_de_esperar_reposicion(pg_temp.id('devb2'), 'El proveedor ya no tiene ese disco');
reset role;
-- La OC con boleta no tiene factura contra la cual registrar la nota: a Contabilidad
-- no le llega «Espera la nota de crédito», ni al devolver ni al dejar de esperar
-- la reposición; a Logística sí le llegan sus avisos (20261126970000).
select test.afirmar(not exists (select 1 from public.notificaciones n where n.origen_id = pg_temp.id('ocb')
                                  and n.titulo like 'Espera la nota de crédito%'),
  'de la OC con boleta, a Contabilidad no le llega «Espera la nota de crédito»');
select test.afirmar(exists (select 1 from public.notificaciones n where n.origen_id = pg_temp.id('ocb') and n.usuario_id = pg_temp.id('comprador')
                              and n.titulo like 'Devuelto al proveedor%')
                    and exists (select 1 from public.notificaciones n where n.origen_id = pg_temp.id('ocb') and n.usuario_id = pg_temp.id('comprador')
                              and n.titulo like 'No repone lo devuelto%'),
  'y a Logística le llegan «Devuelto al proveedor» y «No repone lo devuelto»');
-- Logística anexa la factura de la otra OC con factura; Contabilidad todavía no la registra.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('documentos-compras', 'compra/' || pg_temp.id('oc2') || '/anexo-473.pdf', pg_temp.id('comprador')::text,
        '{"mimetype": "application/pdf", "size": 2048}');
set local session_replication_role = replica;
insert into public.documentos_compra_material (orden_compra_id, tipo, numero_documento, fecha_emision, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (pg_temp.id('oc2'), 'FACTURA', 'E102-473', current_setting('prueba.hoy')::date, 'anexo-473.pdf', 'compra/' || pg_temp.id('oc2') || '/anexo-473.pdf', 'application/pdf', 2048,
        pg_temp.id('comprador'));
set local session_replication_role = origin;
-- c) Una OS afecta que no llega al mínimo de la detracción, pagada con el comprobante anotado y sin su PDF.
do $$ begin
  insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, monto_pen, moneda, codigo_interno,
                                       aprobacion, aprobado_por, aprobado_en, creado_por,
                                       detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo)
  values (pg_temp.id('min'), 'QA-OS-473-MIN', pg_temp.id('proveedor'), 'PROVEEDOR DE PRUEBA 473 S.A.C.', 'Servicio chico del check 473',
          500, 500, 'PEN', 'CHK473_A', 'APROBADA', pg_temp.id('gerente'), now() - interval '1 day', pg_temp.id('comprador'),
          true, '020', 12, 700);
  perform test.afirmar((select detraccion_monto is null from public.ordenes_servicio where id = pg_temp.id('min')),
    'la OS afecta que no llega al mínimo no tiene monto de detracción');
end $$;
select pg_temp.como('tesoreria');
set local role authenticated;
do $$
declare v_ruta text := pg_temp.id('min') || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('pagos-servicio', v_ruta, auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  perform public.registrar_pago_servicio(pg_temp.id('p5'), pg_temp.id('min'), current_setting('prueba.hoy')::date, 590, true,
    'OP-473-p5', 'E555-473', v_ruta, pg_temp.id('caja'), null, 'PROVEEDOR');
end $$;
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' and dias = 0 from pg_temp.doc('ocb', 'GUIA')),
    'el conductor la dejó en el almacén sin guía: la guía sigue faltando');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('ocb', 'NOTA_CREDITO')),
    'a la OC con boleta no se le pide nota de crédito de lo devuelto: no tiene factura contra la cual registrarla');
  perform test.afirmar(not exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'y lo que devolvió no espera en «Esperan nota de crédito» (20261126970000)');
  perform test.afirmar((select situacion = 'FALTA' from pg_temp.doc('ocb', 'BOLETA')), 'y le falta su boleta');
  perform test.afirmar((select situacion = 'POR_REGISTRAR' and numeros = 'E102-473' and dias = 0 from pg_temp.doc('oc2', 'FACTURA')),
    'la factura que anexó Logística está por registrar, con su número, no «falta»');
  perform test.afirmar(not exists (select 1 from pg_temp.doc('min', 'DETRACCION')),
    'la OS afecta que no llega al mínimo no pide detracción aunque se pague entera');
  perform test.afirmar((select situacion = 'POR_REGISTRAR' and numeros = 'E555-473' and dias = 1 from pg_temp.doc('min', 'COMPROBANTE')),
    'el comprobante que Tesorería anotó al pagar está por registrar: falta su PDF');
end $$;
-- d) Contabilidad deja en borrador, sin PDF, la factura que el proveedor de la OC con boleta entregó igual.
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, orden_compra_id)
values (pg_temp.id('fb'), 'FACTURA_COMPRA', 'PROVEEDOR DE PRUEBA 473 S.A.C.', current_setting('prueba.ruc'), 'FH2-473',
        current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 50, 'CONTADO', pg_temp.id('ocb'));
do $$ begin
  perform test.afirmar((select estado = 'BORRADOR' from public.adquisiciones where id = pg_temp.id('fb')), 'el comprobante queda en borrador');
  perform test.afirmar((select situacion = 'POR_REGISTRAR' and numeros = 'FH2-473' from pg_temp.doc('ocb', 'BOLETA')),
    'con solo el borrador, la OC con boleta no se da por completa: su comprobante está por registrar');
  perform test.afirmar(not exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'con la factura en borrador, lo devuelto de la OC con boleta todavía no espera nota');
end $$;
reset role;
-- «Lo que falta» y «Esperan nota de crédito» piden la nota con la misma regla (20261126970000): la OC con
-- factura, o la de boleta con una factura registrada, contra la que se registra la nota.
-- a) Una boleta de una parte no es una factura: ni una ni otra piden la nota.
set local session_replication_role = replica;
insert into public.documentos_compra_material (orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
       subido_por, numero_documento, fecha_emision, monto_de_la_parte, parte_trae_igv)
values (pg_temp.id('ocb'), 'COMPROBANTE', 'b.pdf', 'chk473/b.pdf', 'application/pdf', 100,
        pg_temp.id('comprador'), 'B001-473', current_setting('prueba.hoy')::date, 30, true);
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar(not exists (select 1 from pg_temp.doc('ocb', 'NOTA_CREDITO'))
                       and not exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'con una boleta de una parte, la OC con boleta no pide nota en ninguna de las dos');
end $$;
reset role;
-- a2) Registrado como otro comprobante, que no es una factura: `registrar_nota_credito` no lo acepta, y nadie pide la nota.
set local session_replication_role = replica;
update public.adquisiciones set estado = 'REGISTRADA', ruta_storage = 'fb-473.pdf', tipo = 'OTRO' where id = pg_temp.id('fb');
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar(not exists (select 1 from pg_temp.doc('ocb', 'NOTA_CREDITO'))
                       and not exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'con otro comprobante registrado, que no es factura, la OC con boleta no pide nota en ninguna de las dos');
end $$;
reset role;
set local session_replication_role = replica;
update public.adquisiciones set tipo = 'RECIBO_HONORARIOS' where id = pg_temp.id('fb');
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar(not exists (select 1 from pg_temp.doc('ocb', 'NOTA_CREDITO'))
                       and not exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'ni con un recibo por honorarios registrado');
end $$;
reset role;
select test.afirmar(not has_function_privilege('authenticated', 'public.compra_con_factura_registrada(uuid)', 'execute')
                    and not has_function_privilege('anon', 'public.compra_con_factura_registrada(uuid)', 'execute'),
  'la regla la llaman las funciones, no la gente');
-- b) La misma factura, registrada en otra moneda que la OC (sin pasar por sus disparadores: solo importa su estado).
set local session_replication_role = replica;
delete from public.documentos_compra_material where ruta_storage = 'chk473/b.pdf';
update public.adquisiciones set tipo = 'FACTURA_COMPRA', moneda = 'USD' where id = pg_temp.id('fb');
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' from pg_temp.doc('ocb', 'NOTA_CREDITO'))
                       and (select facturas->0->>'numero' = 'FH2-473' from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'con una factura registrada en dólares, las dos piden la nota de lo devuelto, contra esa factura');
end $$;
reset role;
-- c) En la moneda de la OC, lo mismo.
set local session_replication_role = replica;
update public.adquisiciones set moneda = 'PEN' where id = pg_temp.id('fb');
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select situacion = 'FALTA' from pg_temp.doc('ocb', 'NOTA_CREDITO'))
                       and (select facturas->0->>'numero' = 'FH2-473' from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('devb')),
    'con la factura registrada en soles, las dos piden la nota, contra esa factura');
end $$;
reset role;
-- Con esa factura registrada, lo que Almacén devuelve después de la OC con boleta sí avisa a Contabilidad,
-- al devolver sin reposición y al dejar de esperar la reposición.
select pg_temp.como('almacenero');
set local role authenticated;
select public.devolver_al_proveedor(pg_temp.id('devb3'), pg_temp.id('ingb'), 1, 'GR-DEV-473D', 'Un disco llegó doblado', false);
select public.devolver_al_proveedor(pg_temp.id('devb4'), pg_temp.id('ingb'), 1, 'GR-DEV-473E', 'Un disco llegó oxidado', true);
select public.dejar_de_esperar_reposicion(pg_temp.id('devb4'), 'El proveedor ya no tiene ese disco');
reset role;
select test.afirmar((select count(*) from public.notificaciones n where n.usuario_id = pg_temp.id('contabilidad')
                       and n.origen_id = pg_temp.id('ocb') and n.titulo like 'Espera la nota de crédito%') = 2,
  'con la factura registrada, de la OC con boleta a Contabilidad le llegan los dos «Espera la nota de crédito»');
set local session_replication_role = replica;
update public.adquisiciones set estado = 'BORRADOR', ruta_storage = null where id = pg_temp.id('fb');
set local session_replication_role = origin;

-- ============================================ 6. Quién la lee, y que no toca nada
do $$
declare v text; v_visto text;
begin
  foreach v in array array['comprador', 'tesoreria', 'gerente'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    select string_agg(format('%s:%s:%s:%s:%s', d.compra, d.documento, d.situacion, d.dias, d.numeros), '|' order by d.compra, d.documento)
      into v_visto
      from public.documentos_de_las_compras() d where d.compra in (pg_temp.id('oc'), pg_temp.id('os'), pg_temp.id('sin'));
    reset role;
    perform test.afirmar(v_visto = current_setting('prueba.visto'), v || ' ve los mismos documentos que Contabilidad');
  end loop;
  perform test.afirmar(array_length(string_to_array(current_setting('prueba.visto'), '|'), 1) = 6,
    'son seis: factura, guía y nota de la OC; comprobante y detracción de la OS; comprobante de la OS sin detracción');
end $$;
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar('select * from public.documentos_de_las_compras()', 'Supervisión no lee Adquisiciones');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar('select * from public.documentos_de_las_compras()', 'Almacén no lee Adquisiciones');
reset role;
do $$ begin
  perform test.afirmar(not has_function_privilege('anon', 'public.documentos_de_las_compras()', 'execute'),
    'anon no la ejecuta');
  perform test.afirmar(has_function_privilege('authenticated', 'public.documentos_de_las_compras()', 'execute'),
    'authenticated sí, y la función decide quién');
  perform test.afirmar((select provolatile = 's' from pg_proc where proname = 'documentos_de_las_compras'),
    'es stable: solo lee');
  perform test.afirmar((select estado = 'REGISTRADA' from public.adquisiciones where id = pg_temp.id('f1'))
                       and (select anulado_en is null from public.notas_credito_compra where id = pg_temp.id('nc1'))
                       and (select anulada_en is null from public.guias_remision_compra where id = pg_temp.id('guia')),
    'la factura, la nota y la guía siguen como estaban');
end $$;

rollback;
