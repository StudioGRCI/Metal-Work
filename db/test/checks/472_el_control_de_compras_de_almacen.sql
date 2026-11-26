-- El control de compras de Almacén (migración 20261126160000).
--
--   1. Almacén ve cada OC y OS del día, con su descripción, destino, total y
--      peso; no ve la anulada ni la rechazada.
--   2. Anota la factura y la guía que le llegaron: la factura queda con la
--      forma del proveedor (F001-123), guardar lo mismo otra vez no mueve la
--      fecha, y vaciarla quita la marca.
--   3. Rechaza un comprobante mal escrito y la orden anulada, con un mensaje
--      para la persona.
--   4. El material sale como va: por aprobar, en camino, por validar, una
--      parte y llegó, contado por línea y con la recepción directa.
--   5. El comprobante que registró Contabilidad sale en su fila.
--   6. Contabilidad y Tesorería leen el control pero no anotan; Ventas no lee
--      ni anota; nadie escribe la tabla directo.
--   7. (en el 3) Una pantalla vieja no pisa lo que anotó otra.
--
-- Cada lectura y escritura con la cuenta del puesto —nunca ADMIN— y `set local
-- role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000472', 'PRUEBAS 472 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA472', 'Taller prueba del control de compras') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid; v_und uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  foreach v in array array['ALMACENERO:ALM', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'VENDEDOR:GCO', 'COMPRADOR:LOG', 'GERENTE:GGE'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.472@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id, sede_id)
    select v_id, initcap(split_part(v, ':', 1)) || ' Prueba', 'Check 472', lower(replace(v, ':', '.')) || '.472@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2)),
           (select id from public.sedes where codigo = 'QA472')
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['oc1', 'oc_anulada', 'oc_rechazada', 'oc_por_aprobar', 'oc_obs', 'oc_dev', 'os1', 'det1', 'det_pa', 'det_obs', 'det_dev', 'det_dev2', 'adq1', 'mov1', 'mov_dev'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK472-ROD', 'RODAMIENTO 6205 (prueba 472)',
     (select id from public.categorias_material where activo order by codigo limit 1), v_und);
  perform set_config('prueba.rod', (select id::text from public.materiales where codigo = 'CHK472-ROD'), true);

  insert into public.proveedores (numero_documento, razon_social)
  select '2060000472' || d, 'PROVEEDOR DE PRUEBA 472' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000472' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
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
grant execute on function pg_temp.id(text) to authenticated;

-- Las órdenes, como dueño de las tablas y sin disparadores: la prueba es del
-- control, no de cómo nace una OC.
set local session_replication_role = replica;
insert into public.ordenes_compra_materiales (id, numero, proveedor, proveedor_id, referencia, creado_por, origen, motivo,
                                              condicion_pago, dias_credito, con_factura, moneda, aprobacion, codigo_interno,
                                              anulada_en, anulada_por, motivo_anulacion, rechazado_por, rechazado_en, motivo_rechazo)
select pg_temp.id(k), 'OC-' || n || '-MW', 'PROVEEDOR DE PRUEBA 472', pg_temp.id('proveedor'), 'Cotización 472-' || n,
       pg_temp.id('comprador'), 'DIRECTA', 'Reposición de rodamientos del check 472', 'CONTADO', 0, true, 'PEN',
       case k when 'oc_rechazada' then 'RECHAZADA' when 'oc_anulada' then 'ANULADA' when 'oc_por_aprobar' then 'POR_APROBAR' else 'NO_REQUERIDA' end,
       case when k = 'oc1' then 'MIXER QA 472' end,
       case when k = 'oc_anulada' then now() end, case when k = 'oc_anulada' then pg_temp.id('comprador') end,
       case when k = 'oc_anulada' then 'Se compró a otro proveedor' end,
       case when k = 'oc_rechazada' then pg_temp.id('gerente') end, case when k = 'oc_rechazada' then now() end,
       case when k = 'oc_rechazada' then 'Gerencia pidió otra cotización' end
  from (values ('oc1', 9472), ('oc_anulada', 9473), ('oc_rechazada', 9474), ('oc_por_aprobar', 9475), ('oc_obs', 9476), ('oc_dev', 9477)) x(k, n);
insert into public.orden_compra_material_detalles (id, orden_compra_id, cantidad, precio_unitario, material_id)
values (pg_temp.id('det1'), pg_temp.id('oc1'), 4, 25.50, pg_temp.id('rod')),
       (pg_temp.id('det_pa'), pg_temp.id('oc_por_aprobar'), 1, 10, pg_temp.id('rod')),
       (pg_temp.id('det_obs'), pg_temp.id('oc_obs'), 2, 10, pg_temp.id('rod')),
       (pg_temp.id('det_dev'), pg_temp.id('oc_dev'), 4, 10, pg_temp.id('rod'));
-- La OC dejada y observada, sin que entre nada.
update public.ordenes_compra_materiales set entregado_almacen_en = now(), entregado_almacen_por = pg_temp.id('comprador')
 where id = pg_temp.id('oc_obs');
insert into public.ingresos_pendientes_almacen (orden_compra_id, orden_compra_detalle_id, material_id, cantidad, dejado_por, dejado_en, estado,
                                               validado_por, validado_en, observacion)
values (pg_temp.id('oc_obs'), pg_temp.id('det_obs'), pg_temp.id('rod'), 2, pg_temp.id('comprador'), now(), 'OBSERVADO',
        pg_temp.id('almacenero'), now(), 'Llegó otro rodamiento, se devolvió');
-- Una línea de la OC que atiende dos RQ.
insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
select gen_random_uuid(), 'RQ-QA472-' || n, (select id from public.areas order by codigo limit 1), 'PLANTA', 'Prueba 472', pg_temp.id('almacenero')
  from generate_series(1, 2) n;
insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id, orden_compra_id,
                                         orden_compra_detalle_id, atendida_en, atendida_por)
select q.id, 1, 'Rodamiento', 2, (select id from public.unidades_medida where codigo = 'UND'),
       (select id from public.categorias_material where activo order by codigo limit 1),
       pg_temp.id('oc_dev'), pg_temp.id('det_dev'), now(), pg_temp.id('comprador')
  from public.requerimientos q where q.numero like 'RQ-QA472-%';
-- La OC que llegó entera y devolvió 1 con nota de crédito, sin reposición.
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
values (pg_temp.id('mov_dev'), 'INGRESO', pg_temp.id('rod'), 4, 'COMPRA', 'OC-9477-MW', pg_temp.id('almacenero'), pg_temp.id('det_dev'));
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id,
                                           devuelve_ingreso, se_repone, motivo_devolucion)
values (gen_random_uuid(), 'DEVOLUCION_PROVEEDOR', pg_temp.id('rod'), 1, 'DEVOLUCION_PROVEEDOR', 'OC-9477-MW', pg_temp.id('almacenero'),
        pg_temp.id('det_dev'), pg_temp.id('mov_dev'), false, 'Llegó golpeado, nota de crédito');
insert into public.programacion_recojo (orden_compra_id, posicion, peso_kg, programado_por)
values (pg_temp.id('oc1'), 1, 12.5, pg_temp.id('comprador'));
insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno,
                                     aprobacion, aprobado_por, aprobado_en, estado, creado_por)
values (pg_temp.id('os1'), 'OS-9472-MW', pg_temp.id('proveedor'), 'PROVEEDOR DE PRUEBA 472', 'ARENADO DE CISTERNA',
        1000, 'PEN', 'CISTERNA QA 472', 'APROBADA', pg_temp.id('gerente'), now(), 'EMITIDA', pg_temp.id('comprador'));
set local session_replication_role = origin;

-- ============================================ 1. Almacén ve el día
select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare r record;
begin
  perform test.afirmar((select count(*) from public.control_de_compras_almacen(current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date)
                         where id in (pg_temp.id('oc1'), pg_temp.id('os1'))) = 2,
                       '1. Almacén ve la OC y la OS del día');
  perform test.afirmar(not exists (select 1 from public.control_de_compras_almacen(null, null)
                                    where id in (pg_temp.id('oc_anulada'), pg_temp.id('oc_rechazada'))),
                       '1. La OC anulada y la rechazada no salen');
  select * into r from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1');
  perform test.afirmar(r.numero = 'OC-9472-MW' and r.tipo = 'OC', '1. La OC sale con su número: ' || coalesce(r.numero, 'vacío'));
  perform test.afirmar(r.descripcion = 'RODAMIENTO 6205 (prueba 472)', '1. La descripción es lo que se compró: ' || coalesce(r.descripcion, 'vacía'));
  perform test.afirmar(r.destino = 'MIXER QA 472', '1. El destino es su código: ' || coalesce(r.destino, 'vacío'));
  -- 4 × 25.50 = 102.00, más IGV 18.36.
  perform test.afirmar(r.total = 120.36, '1. El total con IGV es 120.36: ' || coalesce(r.total::text, 'vacío'));
  perform test.afirmar(r.peso_kg = 12.5, '1. El peso es el que programó Logística');
  perform test.afirmar(r.material = 'EN_CAMINO', '4. Sin dejarla, la OC está en camino: ' || r.material);
  perform test.afirmar(r.factura_numero is null and r.comprobante_registrado is null, '1. Sin nada recibido todavía');
  select * into r from public.control_de_compras_almacen(null, null) where id = pg_temp.id('os1');
  perform test.afirmar(r.total = 1180 and r.destino = 'CISTERNA QA 472' and r.material = 'NO_APLICA',
                       '1. La OS sale con su total con IGV, su destino y sin material');
  perform test.afirmar(not exists (select 1 from public.control_de_compras_almacen(current_setting('prueba.hoy')::date + 1, null)
                                    where id = pg_temp.id('oc1')),
                       '1. Desde mañana, la OC de hoy no sale');
end $$;

-- ============================================ 2. Anota la factura y la guía
do $$
declare v_id uuid; v_id2 uuid; v_en timestamptz; v_version timestamptz; r record;
begin
  -- La primera vez la pantalla no mostró ninguna fila: va sin versión.
  v_id := public.anotar_documentos_recibidos(pg_temp.id('oc1'), null, ' f001-009472 ', 't001 9472', '  FALTA   N/C  ', null);
  perform test.afirmar(v_id is not null, '2. Anotar devuelve la fila');
  select * into r from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1');
  perform test.afirmar(r.factura_numero = 'F001-9472', '2. La factura queda con la forma del proveedor: ' || coalesce(r.factura_numero, 'vacía'));
  perform test.afirmar(r.guia_numero = 'T001 9472', '2. La guía queda en mayúsculas, con un espacio: ' || coalesce(r.guia_numero, 'vacía'));
  perform test.afirmar(r.observacion = 'FALTA N/C', '2. La nota queda con los espacios juntados');
  perform test.afirmar(r.recibio = 'Almacenero Check', '2. Dice quién la recibió: ' || coalesce(r.recibio, 'nadie'));
  perform test.afirmar(r.recepcion_actualizada_en is not null, '2. Devuelve cuándo cambió, para la próxima anotación');
  v_en := r.factura_recibida_en;
  v_version := r.recepcion_actualizada_en;

  -- El mismo envío otra vez (dos toques, o se perdió la respuesta), con la versión vieja: ya está.
  v_id2 := public.anotar_documentos_recibidos(pg_temp.id('oc1'), null, ' f001-009472 ', 't001 9472', '  FALTA   N/C  ', null);
  perform test.afirmar(v_id2 = v_id, '2. Repetir el mismo envío no falla ni crea otra fila');

  v_id2 := public.anotar_documentos_recibidos(pg_temp.id('oc1'), null, 'F001-9472', 'T001 9472', 'Llegó completa', v_version);
  perform test.afirmar(v_id2 = v_id, '2. La misma OC usa la misma fila');
  select * into r from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1');
  perform test.afirmar(r.factura_recibida_en = v_en and r.observacion = 'Llegó completa',
                       '2. Corregir la nota no mueve cuándo llegó la factura');
  -- Dentro de una transacción now() no avanza: la versión que vio la pantalla
  -- vieja se simula un minuto antes.
  perform set_config('prueba.version_vieja', (v_version - interval '1 minute')::text, true);

  perform public.anotar_documentos_recibidos(pg_temp.id('oc1'), null, '', 'T001 9472', null, r.recepcion_actualizada_en);
  select * into r from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1');
  perform test.afirmar(r.factura_numero is null and r.factura_recibida_en is null and r.guia_numero = 'T001 9472' and r.observacion is null,
                       '2. Vaciar la factura quita su marca y deja la guía');
  perform set_config('prueba.version_oc1', r.recepcion_actualizada_en::text, true);

  perform public.anotar_documentos_recibidos(null, pg_temp.id('os1'), ' 0001-000123 ', null, null, null);
  perform test.afirmar((select factura_numero from public.control_de_compras_almacen(null, null) where id = pg_temp.id('os1')) = '0001-123',
                       '2. El comprobante en papel, con serie en números, también vale: 0001-123');
  perform public.anotar_documentos_recibidos(null, pg_temp.id('os1'), 'E001-9473', null, null,
    (select recepcion_actualizada_en from public.control_de_compras_almacen(null, null) where id = pg_temp.id('os1')));
  perform test.afirmar((select factura_numero from public.control_de_compras_almacen(null, null) where id = pg_temp.id('os1')) = 'E001-9473',
                       '2. La OS también lleva su recibo');
end $$;

-- ============================================ 3. Lo que se rechaza
-- Otra pantalla anotó después de que esta abrió: no se pisa.
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, %L::timestamptz)',
         pg_temp.id('oc1'), 'F009-1', current_setting('prueba.version_vieja')),
  '3. Con lo que mostró una pantalla vieja, no pisa lo que anotó la otra', 'cambió después de que lo abriste');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, null)', pg_temp.id('oc1'), 'F009-1'),
  '3. Sin versión, sobre una fila que ya existe, tampoco', 'cambió después de que lo abriste');
select test.afirmar((select factura_numero is null and guia_numero = 'T001 9472' from public.recepcion_documentos_compra
                      where orden_compra_id = pg_temp.id('oc1')), '3. Lo de la otra pantalla quedó como estaba');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, now())', pg_temp.id('oc_por_aprobar'), 'F009-1'),
  '3. Con versión sobre una fila que no existe, se pide recargar', 'cambió después de que lo abriste');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, %L::timestamptz)',
         pg_temp.id('oc1'), 'FACTURA 123', current_setting('prueba.version_oc1')),
  '3. Un comprobante sin serie se rechaza', 'la serie de 4 y el número');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, null)', pg_temp.id('oc_anulada'), 'F001-1'),
  '3. La OC anulada no se anota', 'anulada o rechazada');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, %L::uuid, %L, null, null, null)', pg_temp.id('oc1'), pg_temp.id('os1'), 'F001-1'),
  '3. Una OC y una OS a la vez no', 'Elige una orden');
select test.debe_fallar(
  format('insert into public.recepcion_documentos_compra (orden_compra_id) values (%L)', pg_temp.id('oc_rechazada')),
  '6. Almacén no escribe la tabla directo', 'permission denied');
select test.afirmar((select material from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc_por_aprobar')) = 'POR_APROBAR',
                    '4. La OC que Gerencia no aprueba sale por aprobar, no en camino');
select test.afirmar((select material from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc_obs')) = 'OBSERVADO',
                    '4. Dejada y observada, sin que entre nada, sale observada');
select test.afirmar((select material from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc_dev')) = 'LLEGO',
                    '4. Lo devuelto con nota de crédito, sin reposición, no la deja a medias');
select test.afirmar((select descripcion from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc_dev')) = 'RODAMIENTO 6205 (prueba 472)',
                    '1. La línea que atiende dos RQ se describe una vez');
reset role;

-- ============================================ 4. El material, como va
set local session_replication_role = replica;
insert into public.ingresos_pendientes_almacen (orden_compra_id, orden_compra_detalle_id, material_id, cantidad, dejado_por, dejado_en, estado)
values (pg_temp.id('oc1'), pg_temp.id('det1'), pg_temp.id('rod'), 4, pg_temp.id('comprador'), now(), 'PENDIENTE');
set local session_replication_role = origin;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select material from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1')) = 'POR_VALIDAR',
                    '4. Dejada y sin verificar, está por validar');
reset role;
-- Almacén verifica 3 de los 4: llegó una parte.
set local session_replication_role = replica;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
values (pg_temp.id('mov1'), 'INGRESO', pg_temp.id('rod'), 3, 'COMPRA', 'OC-9472-MW', pg_temp.id('almacenero'), pg_temp.id('det1'));
update public.ingresos_pendientes_almacen set estado = 'VALIDADO', cantidad_validada = 3, validado_por = pg_temp.id('almacenero'),
       validado_en = now(), movimiento_id = pg_temp.id('mov1') where orden_compra_id = pg_temp.id('oc1');
set local session_replication_role = origin;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select material = 'PARCIAL' and material_en is null from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1')),
                    '4. Con 3 de 4, llegó una parte y no tiene fecha de llegada');
reset role;
-- Llega el que faltaba, por la recepción directa.
set local session_replication_role = replica;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
values (gen_random_uuid(), 'INGRESO', pg_temp.id('rod'), 1, 'COMPRA', 'OC-9472-MW', pg_temp.id('almacenero'), pg_temp.id('det1'));
-- ============================================ 5. El comprobante de Contabilidad
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, estado, ruta_storage, registrado_por)
values (pg_temp.id('adq1'), 'FACTURA_COMPRA', 'PROVEEDOR DE PRUEBA 472', 'F001-9472', current_date, current_date, 'PEN', 120.36,
        'CONTADO', 'REGISTRADA', 'prueba/472.pdf', pg_temp.id('contabilidad'));
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values (pg_temp.id('adq1'), pg_temp.id('oc1'));
set local session_replication_role = origin;

select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.control_de_compras_almacen(null, null) where id = pg_temp.id('oc1');
  perform test.afirmar(r.material = 'LLEGO' and r.material_en is not null, '4. Con los 4, llegó, con su fecha: ' || r.material);
  perform test.afirmar(r.comprobante_registrado = 'F001-9472', '5. Sale la factura que registró Contabilidad: ' || coalesce(r.comprobante_registrado, 'ninguna'));
end $$;
reset role;

-- ============================================ 6. Los demás puestos
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select count(*) from public.control_de_compras_almacen(null, null) where id in (pg_temp.id('oc1'), pg_temp.id('os1'))) = 2,
                    '6. Contabilidad lee el control');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, null)', pg_temp.id('oc1'), 'F001-1'),
  '6. Contabilidad no anota lo que recibe Almacén', 'almacen.recibir');
reset role;

select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.control_de_compras_almacen(null, null) where id in (pg_temp.id('oc1'), pg_temp.id('os1'))) = 2,
                    '6. Tesorería lee el control');
select test.afirmar((select count(*) from public.recepcion_documentos_compra where orden_compra_id = pg_temp.id('oc1')) = 1,
                    '6. Tesorería lee la tabla');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, null)', pg_temp.id('oc1'), 'F001-1'),
  '6. Tesorería no anota', 'almacen.recibir');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar('select * from public.control_de_compras_almacen(null, null)',
  '6. Ventas no lee el control', 'No tienes permiso');
select test.debe_fallar(
  format('select public.anotar_documentos_recibidos(%L::uuid, null, %L, null, null, null)', pg_temp.id('oc1'), 'F001-1'),
  '6. Ventas no anota', 'almacen.recibir');
select test.afirmar((select count(*) from public.recepcion_documentos_compra) = 0, '6. Ventas no lee la tabla');
reset role;

rollback;
