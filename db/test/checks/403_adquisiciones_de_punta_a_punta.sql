-- Adquisiciones de punta a punta (migraciones 20261020170000 y 20261020171000):
-- una fila por OC y por OS con de dónde salió, su factura, su pago y cada
-- documento, que leen Contabilidad, Tesorería, Logística y Gerencia y nadie
-- más; la Gestión de compras queda para Logística y el conductor, y la guía de
-- remisión la carga Contabilidad desde Adquisiciones. Cada paso con el rol que
-- lo da —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
begin;

-- En Supabase el bucket ya trae RLS y el permiso; el shim no.
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'CONDUCTOR:LOG',
                           'CONTABILIDAD:CON', 'TESORERIA:TES', 'ADMINISTRACION:ADM', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.403@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 403', lower(replace(v, ':', '.')) || '.403@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK403-PLA', 'Plancha LAF 2 mm 4x8 (403)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000403' || d, 'Proveedor de prueba 403', 'Av. Argentina 403, Lima', '999 403 403' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000403' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['rq', 'oc1', 'oc2', 'oc3', 'oc4', 'oc5', 'oc6', 'oc7', 'os1', 'os2', 'os3', 'os4', 'os5',
                           'f3', 'f4', 'f5', 'f6', 'doc', 'guia'] loop
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

-- Una OC por cada insumo del RQ, de tres planchas a S/ 120.50.
create or replace function pg_temp.generar(p_oc text, p_item smallint, p_con_factura boolean) returns uuid language sql as $$
  select public.emitir_compra_del_requerimiento(current_setting('prueba.' || p_oc)::uuid, current_setting('prueba.rq')::uuid,
    array[p_item], current_setting('prueba.proveedor')::uuid, null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
    null, 'CONTADO', 0, 'PEN', p_con_factura);
$$;
-- Si ya se pagó esa orden, según Adquisiciones, leído con la sesión puesta.
create or replace function pg_temp.pago(p_clave text) returns text language sql as $$
  select t.pago from public.trazabilidad_de_compras() t where t.id = current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text, p_ruta text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_clave)::uuid and titulo like p_titulo || '%'
     and (p_ruta is null or ruta = p_ruta);
$$;
-- Lo que hace Storage al subir: anota el objeto con su dueño, tipo y tamaño.
create or replace function pg_temp.subir(p_bucket text, p_ruta text, p_dueno text, p_tamano integer default 2048)
returns text language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (p_bucket, p_ruta, current_setting('prueba.' || p_dueno)::uuid, current_setting('prueba.' || p_dueno),
          jsonb_build_object('mimetype', 'application/pdf', 'size', p_tamano))
  returning name;
$$;

-- ============================================ 1. Un RQ con siete OC, cada una en otro punto
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLA_SR_O4_1_26/28', 'Armado del chasis de la plataforma 28', null,
  (select jsonb_agg(jsonb_build_object('descripcion', 'Insumo ' || n, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from generate_series(1, 7) n));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(current_setting('prueba.rq')::uuid, 'No hay nada de esto');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.generar('oc' || n, n::smallint, n <> 7) from generate_series(1, 7) n;
set constraints all immediate;
reset role;
-- La OC 7 la emitió Administración, que no programa recojos.
update public.ordenes_compra_materiales set creado_por = current_setting('prueba.administracion')::uuid
 where id = current_setting('prueba.oc7')::uuid;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc' || n)::uuid) from generate_series(3, 7) n;
select public.rechazar_compra(current_setting('prueba.oc2')::uuid, 'El proveedor subió el precio');
reset role;

select test.afirmar(pg_temp.avisos('comprador', 'Compra aprobada', '/compras/gestion') = 4
    and pg_temp.avisos('comprador', 'Compra aprobada', '/compras') = 0,
  'a Logística, que la emitió, el aviso de aprobada la lleva a programarla en Gestión de compras');
select test.afirmar(pg_temp.avisos('administracion', 'Compra aprobada', '/compras') = 1
    and pg_temp.avisos('administracion', 'Compra aprobada', '/compras/gestion') = 0
    and (select cuerpo like '%Logística la programa%' from public.notificaciones
          where usuario_id = current_setting('prueba.administracion')::uuid and titulo like 'Compra aprobada%'),
  'a quien la emitió sin programar recojos, el aviso no lo manda a una pantalla que no abre');
select test.afirmar(pg_temp.avisos('comprador', 'Programa el recojo', '/compras/gestion') = 1
    and pg_temp.avisos('contabilidad', 'Programa el recojo', null) = 0
    and pg_temp.avisos('conductor', 'Programa el recojo', null) = 0,
  'la OC que no emitió Logística le llega a Logística para programarla, y a nadie más');

-- ============================================ 2. Las facturas, sus pagos y las OS
do $$
declare v_total numeric; v_n int; v_hoy date := current_setting('prueba.hoy')::date;
begin
  -- Contabilidad registra una factura por OC, por el total impreso, como en el 390.
  perform pg_temp.como('contabilidad');
  foreach v_n in array array[3, 4, 5, 6] loop
    v_total := public.total_orden_compra(current_setting('prueba.oc' || v_n)::uuid);
    perform set_config('prueba.total' || v_n, v_total::text, true);
    insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
    values (current_setting('prueba.f' || v_n)::uuid, 'FACTURA_COMPRA', 'Proveedor de prueba 403', 'F001-40' || v_n,
            v_hoy - 2, v_hoy - 2, 'PEN', v_total, 'CONTADO');
    insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id)
    values (current_setting('prueba.f' || v_n)::uuid, current_setting('prueba.oc' || v_n)::uuid);
    perform pg_temp.subir('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.f' || v_n) || '/comprobante.pdf',
                          'contabilidad');
    -- La de la OC 3 se queda en borrador: todavía no cuenta como registrada.
    if v_n <> 3 then
      update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
       where id = current_setting('prueba.f' || v_n)::uuid;
    end if;
  end loop;

  -- Tesorería paga una parte de la 5 y la 6 entera.
  perform pg_temp.como('tesoreria');
  insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, archivo_ruta, archivo_mime, archivo_tamano)
  values (current_setting('prueba.f5')::uuid, v_hoy, 100, 'OP-403-5',
          pg_temp.subir('pagos-facturas', current_setting('prueba.f5') || '/voucher.pdf', 'tesoreria'), 'application/pdf', 2048),
         (current_setting('prueba.f6')::uuid, v_hoy, public.total_orden_compra(current_setting('prueba.oc6')::uuid), 'OP-403-6',
          pg_temp.subir('pagos-facturas', current_setting('prueba.f6') || '/voucher.pdf', 'tesoreria'), 'application/pdf', 2048);

  -- Las órdenes de servicio, como dueño de las tablas: aprobada sin pago, pagada,
  -- esperando a Gerencia, anulada y pagada en parte.
  insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno,
                                       aprobacion, aprobado_por, aprobado_en, estado, anulado_por, anulado_en, motivo_anulacion,
                                       creado_por)
  select current_setting('prueba.os' || n)::uuid, 'QA-OS-403-' || n, current_setting('prueba.proveedor')::uuid,
         'Proveedor de prueba 403', 'Servicio de prueba ' || n || ' del check 403', 500, 'PEN', 'QA403-OS',
         case when n = 3 then 'POR_APROBAR' else 'APROBADA' end,
         case when n <> 3 then current_setting('prueba.gerente')::uuid end, case when n <> 3 then now() end,
         case when n = 4 then 'ANULADA' else 'EMITIDA' end,
         case when n = 4 then current_setting('prueba.comprador')::uuid end, case when n = 4 then now() end,
         case when n = 4 then 'Se contrató a otro proveedor' end,
         current_setting('prueba.comprador')::uuid
    from generate_series(1, 5) n;
  insert into public.pagos_orden_servicio (orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion, comprobante_proveedor,
                                           archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (current_setting('prueba.os2')::uuid, v_hoy, 'PEN', 590, true, 'OP-403-OS2', 'E001-403',
          pg_temp.subir('pagos-servicio', current_setting('prueba.os2') || '/voucher.pdf', 'tesoreria'), 'application/pdf', 2048,
          current_setting('prueba.tesoreria')::uuid),
         (current_setting('prueba.os5')::uuid, v_hoy, 'PEN', 200, false, 'OP-403-OS5', null,
          pg_temp.subir('pagos-servicio', current_setting('prueba.os5') || '/voucher.pdf', 'tesoreria'), 'application/pdf', 2048,
          current_setting('prueba.tesoreria')::uuid);
end $$;

-- ============================================ 3. Logística adjunta la cotización
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.subir('documentos-compras',
  'compra/' || current_setting('prueba.oc3') || '/' || current_setting('prueba.doc') || '.pdf', 'comprador', 51234);
insert into public.documentos_compra_material (id, orden_compra_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes)
values (current_setting('prueba.doc')::uuid, current_setting('prueba.oc3')::uuid, 'COTIZACION', 'cotizacion-403.pdf',
        'compra/' || current_setting('prueba.oc3') || '/' || current_setting('prueba.doc') || '.pdf', 'application/pdf', 51234);
select test.afirmar((select tipo from public.documentos_compra_material where id = current_setting('prueba.doc')::uuid) = 'COTIZACION',
  'la cotización del proveedor se adjunta con su propio tipo');
reset role;

-- ============================================ 4. Quién lee Adquisiciones
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(pg_temp.pago('oc1') = 'ESPERA_APROBACION', 'la OC que Gerencia no aprueba espera a Gerencia');
select test.afirmar(pg_temp.pago('oc2') = 'NO_SE_PAGA'
    and (select total is null and aprobacion = 'RECHAZADA' from public.trazabilidad_de_compras()
          where id = current_setting('prueba.oc2')::uuid),
  'la rechazada no se paga ni lleva total');
select test.afirmar(pg_temp.pago('oc3') = 'POR_FACTURAR'
    and (select jsonb_array_length(facturas) = 1 and facturas->0->>'estado' = 'BORRADOR' from public.trazabilidad_de_compras()
          where id = current_setting('prueba.oc3')::uuid),
  'una factura en borrador se muestra, pero la OC sigue esperando su factura');
select test.afirmar(pg_temp.pago('oc4') = 'POR_PAGAR', 'con la factura registrada y sin pago, está por pagar');
select test.afirmar(pg_temp.pago('oc5') = 'PAGO_PARCIAL'
    and (select (facturas->0->>'pagado')::numeric = 100
                and (facturas->0->>'saldo')::numeric = current_setting('prueba.total5')::numeric - 100
                and facturas->0->'pagos'->0->>'referencia' = 'OP-403-5'
                and facturas->0->>'bucket' = 'comprobantes-financieros'
           from public.trazabilidad_de_compras() where id = current_setting('prueba.oc5')::uuid),
  'pagada en parte, con lo pagado, el saldo y su voucher');
select test.afirmar(pg_temp.pago('oc6') = 'PAGADA'
    and (select total = current_setting('prueba.total6')::numeric and (facturas->0->>'saldo')::numeric = 0
           from public.trazabilidad_de_compras() where id = current_setting('prueba.oc6')::uuid),
  'la factura entera pagada deja la OC pagada, con el total impreso y sin saldo');
select test.afirmar(pg_temp.pago('oc7') = 'SIN_FACTURA', 'la que va con boleta no espera factura');
select test.afirmar(pg_temp.pago('os1') = 'POR_PAGAR' and pg_temp.pago('os2') = 'PAGADA' and pg_temp.pago('os3') = 'ESPERA_APROBACION'
    and pg_temp.pago('os4') = 'NO_SE_PAGA' and pg_temp.pago('os5') = 'PAGO_PARCIAL',
  'las OS: por pagar, pagada, esperando a Gerencia, anulada y pagada en parte');
select test.afirmar(
  (select total = 590 and codigos = array['QA403-OS'] and jsonb_array_length(pagos) = 1 and pagos->0->>'operacion' = 'OP-403-OS2'
     from public.trazabilidad_de_compras() where id = current_setting('prueba.os2')::uuid),
  'la OS lleva su total con IGV, su código interno y su pago');
select test.afirmar(
  (select requerimientos->0->>'numero' = (select numero from public.requerimientos where id = current_setting('prueba.rq')::uuid)
          and codigos = array['PLA_SR_O4_1_26/28'] and areas = array['Maestranza']
          and jsonb_array_length(documentos) = 1 and documentos->0->>'tipo' = 'COTIZACION'
     from public.trazabilidad_de_compras() where id = current_setting('prueba.oc3')::uuid),
  'la OC dice de qué RQ, código y área sale, y trae la cotización que adjuntó Logística');
select test.afirmar(
  (select count(*) from public.trazabilidad_de_compras()
    where id in (select current_setting('prueba.' || x)::uuid
                   from unnest(array['oc1','oc2','oc3','oc4','oc5','oc6','oc7','os1','os2','os3','os4','os5']) x)) = 12,
  'Contabilidad ve las siete OC y las cinco OS');
-- Los archivos que nombra la fila los abre con su sesión.
select test.afirmar(
  (select count(*) from public.documentos_compra_material where id = current_setting('prueba.doc')::uuid) = 1
  and (select count(*) from storage.objects where bucket_id = 'documentos-compras'
         and name = 'compra/' || current_setting('prueba.oc3') || '/' || current_setting('prueba.doc') || '.pdf') = 1,
  'Contabilidad abre la cotización que adjuntó Logística');
select test.afirmar(
  (select count(*) from public.pagos_orden_servicio
    where orden_servicio_id in (current_setting('prueba.os2')::uuid, current_setting('prueba.os5')::uuid)) = 2
  and (select count(*) from storage.objects where bucket_id = 'pagos-servicio'
         and name in (current_setting('prueba.os2') || '/voucher.pdf', current_setting('prueba.os5') || '/voucher.pdf')) = 2,
  'y ve si se pagó la OS, con su voucher');
select test.afirmar(
  (select count(*) from storage.objects where bucket_id = 'pagos-facturas'
         and name in (current_setting('prueba.f5') || '/voucher.pdf', current_setting('prueba.f6') || '/voucher.pdf')) = 2,
  'y el voucher de cada pago de factura');
reset role;

do $$
declare v text;
begin
  foreach v in array array['tesoreria', 'comprador', 'gerente'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar(
      (select count(*) from public.trazabilidad_de_compras() where id = current_setting('prueba.oc5')::uuid
         or id = current_setting('prueba.os2')::uuid) = 2,
      v || ' también lee Adquisiciones');
    reset role;
  end loop;
  foreach v in array array['vendedor', 'almacenero', 'conductor'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.debe_fallar('select count(*) from public.trazabilidad_de_compras()', v || ' no lee Adquisiciones',
      'Adquisiciones la ven Contabilidad');
    perform test.afirmar((select count(*) from public.pagos_orden_servicio) = 0
        and (select count(*) from storage.objects where bucket_id = 'pagos-servicio') = 0,
      v || ' tampoco lee los pagos de la OS ni su voucher por la API');
    reset role;
  end loop;
  -- Almacén ve los PDF de Logística desde antes (compras.ver); Ventas y el conductor no.
  foreach v in array array['vendedor', 'conductor'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.documentos_compra_material) = 0
        and (select count(*) from storage.objects where bucket_id = 'documentos-compras') = 0,
      v || ' no lee los PDF de Logística');
    reset role;
  end loop;
end $$;

-- ============================================ 5. La gestión de compras, solo para Logística y el conductor
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.programar_recojo(current_setting('prueba.oc3')::uuid, 200, null) = 1, 'Logística programa el recojo');
select test.afirmar(public.programar_recojo(current_setting('prueba.oc4')::uuid, 90, null) = 2, 'y la siguiente');
select test.afirmar(public.programar_recojo(current_setting('prueba.oc5')::uuid, 60, null) = 3, 'y otra más');
select public.quitar_recojo_de_la_lista(current_setting('prueba.oc4')::uuid);
select test.afirmar((select not en_lista from public.compras_en_gestion() where id = current_setting('prueba.oc4')::uuid),
  'y la saca de la lista');
select test.debe_fallar('select count(*) from public.guias_por_emitir()', 'Logística no carga guías', 'las carga Contabilidad');
reset role;

do $$
declare v text;
begin
  foreach v in array array['contabilidad', 'gerente', 'administracion', 'tesoreria', 'vendedor'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.debe_fallar('select count(*) from public.compras_en_gestion()', v || ' no abre la gestión de compras',
      'la ven Logística y el conductor');
    perform test.debe_fallar(format('select public.programar_recojo(%L, 100, null)', current_setting('prueba.oc6')),
      v || ' no programa el recojo', 'compras.programar_recojo');
    perform test.debe_fallar(format('select public.quitar_recojo_de_la_lista(%L)', current_setting('prueba.oc3')),
      v || ' no saca una compra de la lista', 'compras.programar_recojo');
    perform test.afirmar((select count(*) from public.programacion_recojo) = 0, v || ' no lee la lista del conductor');
    reset role;
  end loop;
end $$;

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.compras_en_gestion() where en_lista
      and id in (current_setting('prueba.oc3')::uuid, current_setting('prueba.oc5')::uuid)) = 2
  and (select count(*) from public.programacion_recojo) = 3,
  'el conductor sí ve la gestión y su lista');
select test.debe_fallar($q$select public.programar_recojo(current_setting('prueba.oc6')::uuid, 100, null)$q$,
  'pero no se programa solo', 'compras.programar_recojo');
select test.debe_fallar($q$select public.quitar_recojo_de_la_lista(current_setting('prueba.oc3')::uuid)$q$,
  'ni se saca nada de la lista', 'compras.programar_recojo');
reset role;

-- ============================================ 6. Contabilidad carga la guía desde Adquisiciones
select test.afirmar(pg_temp.avisos('contabilidad', 'Guía de remisión por emitir', '/adquisiciones?situacion=guia') = 3
    and pg_temp.avisos('contabilidad', 'Guía de remisión por emitir', '/compras/gestion') = 0,
  'el aviso de guía por emitir lleva a Contabilidad a Adquisiciones, no a la gestión');

select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(
  (select peso_kg = 200 and numero is not distinct from (select numero from public.ordenes_compra_materiales
                                                          where id = current_setting('prueba.oc3')::uuid)
     from public.guias_por_emitir() where orden_compra_id = current_setting('prueba.oc3')::uuid)
  and not exists (select 1 from public.guias_por_emitir() where orden_compra_id = current_setting('prueba.oc4')::uuid),
  'Contabilidad ve qué guía falta, con el peso de Logística; la que salió de la lista no cuenta');
select test.afirmar((select peso_kg = 200 and guia is null from public.trazabilidad_de_compras()
                      where id = current_setting('prueba.oc3')::uuid),
  'y la fila de la OC en Adquisiciones dice el peso y que no tiene guía');
reset role;
-- El peso y la lista del conductor no salen por Adquisiciones a quien no lleva el recojo.
do $$
declare v text;
begin
  foreach v in array array['tesoreria', 'gerente'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar((select peso_kg is null and not en_lista from public.trazabilidad_de_compras()
                           where id = current_setting('prueba.oc3')::uuid),
      v || ' no ve el peso ni la lista del conductor en Adquisiciones');
    reset role;
  end loop;
  perform pg_temp.como('comprador');
  set local role authenticated;
  perform test.afirmar((select peso_kg = 200 and en_lista from public.trazabilidad_de_compras()
                         where id = current_setting('prueba.oc3')::uuid),
    'Logística sí');
  reset role;
end $$;
-- Ni por la auditoría: programacion_recojo está auditada y Gerencia tiene
-- auditoria.ver. Sigue leyendo la auditoría de lo demás.
select set_config('prueba.auditados', (select count(*) from public.audit_log
  where tabla = 'programacion_recojo' and datos_despues->>'orden_compra_id' = current_setting('prueba.oc3'))::text, true);
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(current_setting('prueba.auditados')::int > 0
    and (select count(*) from public.audit_log where tabla = 'programacion_recojo') = 0
    and (select count(*) from public.audit_log where tabla <> 'programacion_recojo') > 0,
  'Gerencia no lee la lista del conductor en la auditoría (' || current_setting('prueba.auditados')
    || ' filas auditadas de la OC 3), y sí el resto de la auditoría');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.subir('guias-remision', 'compra/' || current_setting('prueba.oc3') || '/' || current_setting('prueba.guia') || '.pdf',
                     'contabilidad', 48211);
select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc3')::uuid,
  'T001-00000403', current_setting('prueba.hoy')::date, 'guia-t001-403.pdf');
select test.afirmar(not exists (select 1 from public.guias_por_emitir() where orden_compra_id = current_setting('prueba.oc3')::uuid),
  'cargada, ya no falta');
select test.afirmar((select guia->>'numero' = 'T001-00000403' and guia->>'id' = current_setting('prueba.guia')
                       from public.trazabilidad_de_compras() where id = current_setting('prueba.oc3')::uuid),
  'y la fila la muestra');
reset role;
select test.afirmar(pg_temp.avisos('conductor', 'Guía de remisión lista', null) = 1, 'al conductor le avisan que su guía está lista');

-- La ven también Tesorería y Gerencia, que leen Adquisiciones; no quien no la lee.
do $$
declare v text;
begin
  foreach v in array array['tesoreria', 'gerente', 'comprador', 'conductor'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar(
      (select count(*) from public.guias_remision_compra where id = current_setting('prueba.guia')::uuid) = 1
      and (select count(*) from storage.objects where bucket_id = 'guias-remision'
             and name = 'compra/' || current_setting('prueba.oc3') || '/' || current_setting('prueba.guia') || '.pdf') = 1,
      v || ' ve la guía y su PDF');
    reset role;
  end loop;
  foreach v in array array['vendedor', 'almacenero'] loop
    perform pg_temp.como(v);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.guias_remision_compra) = 0
        and (select count(*) from storage.objects where bucket_id = 'guias-remision') = 0,
      v || ' no ve guías ni sus PDF');
    perform test.debe_fallar('select count(*) from public.guias_por_emitir()', v || ' no ve qué guía falta', 'las carga Contabilidad');
    reset role;
  end loop;
end $$;

select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($q$select public.anular_guia_remision(current_setting('prueba.guia')::uuid, 'Peso mal escrito')$q$,
  'Tesorería la ve, pero no la anula');
reset role;

do $$ begin raise notice 'OK 403: cada OC y OS de su RQ hasta su pago, la gestión de compras para Logística y el conductor, y la guía desde Adquisiciones'; end $$;
rollback;
