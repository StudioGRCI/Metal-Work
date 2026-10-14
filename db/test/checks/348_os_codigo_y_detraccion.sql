-- La orden de servicio con su código interno y su detracción (migración
-- 20261015141000): Logística la emite con los dos datos; la base calcula lo
-- que se deposita según el porcentaje y el mínimo de SUNAT; Contabilidad
-- corrige la detracción aunque haya conformidad, y Gerencia ve la OS en los
-- documentos del código. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GER', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'SUPERVISOR:MTZ'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.348@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 348', lower(replace(v, ':', '.')) || '.348@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20600000340', 'Proveedor de prueba 348', 'Av. Argentina 348, Lima', '999 348 348')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  perform set_config('prueba.os1', gen_random_uuid()::text, true);
  perform set_config('prueba.os2', gen_random_uuid()::text, true);
  perform set_config('prueba.os3', gen_random_uuid()::text, true);
  perform set_config('prueba.os4', gen_random_uuid()::text, true);
  perform set_config('prueba.os5', gen_random_uuid()::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Emite con el código, el monto sin IGV en soles y la detracción.
create or replace function pg_temp.emitir(p_os text, p_codigo text, p_monto numeric, p_detraccion text, p_motivo text)
returns uuid language sql as $$
  select public.emitir_orden_servicio(current_setting('prueba.' || p_os)::uuid, current_setting('prueba.proveedor')::uuid,
    null, (select id from public.areas where codigo = 'ACB'), p_codigo, 'Arenado y fondo del chasis completo', null,
    null, null, 'PEN', p_monto, 'CONTADO', 0, p_detraccion, p_motivo);
$$;
create or replace function pg_temp.os(p_os text) returns public.ordenes_servicio language sql as $$
  select * from public.ordenes_servicio where id = current_setting('prueba.' || p_os)::uuid;
$$;

-- ============================================ 1. La lista de SUNAT
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.detracciones_servicio where activo) = 11
  and (select porcentaje = 10 and monto_minimo = 700 from public.detracciones_servicio where codigo = '025')
  and (select porcentaje = 12 and monto_minimo = 700 from public.detracciones_servicio where codigo = '037')
  and (select porcentaje = 4 and monto_minimo = 400 from public.detracciones_servicio where codigo = '027'),
  'Logística lee los once tipos de SUNAT con su porcentaje y su mínimo');
select test.debe_fallar(
  $q$update public.detracciones_servicio set porcentaje = 1 where codigo = '025'$q$,
  'nadie cambia el porcentaje desde la aplicación', 'permission denied');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select count(*) from public.detracciones_servicio) = 0, 'un supervisor no lee la lista de detracciones');
reset role;

-- ============================================ 2. Logística emite: sin código o sin detracción, no
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.emitir('os1', ' ', 1000, '025', null)$q$,
  'sin código interno no se emite', 'código interno');
select test.debe_fallar($q$select pg_temp.emitir('os1', 'PLA_SR_O4_1_26/28', 1000, null, null)$q$,
  'sin decir si lleva detracción no se emite', 'lleva detracción');
select test.debe_fallar($q$select pg_temp.emitir('os1', 'PLA_SR_O4_1_26/28', 1000, 'NO_SUJETA', 'no')$q$,
  'no sujeta exige su motivo', 'no está sujeta');
select test.debe_fallar($q$select pg_temp.emitir('os1', 'PLA_SR_O4_1_26/28', 1000, '999', null)$q$,
  'un código que no es de SUNAT no entra', 'lista de SUNAT');
select test.debe_fallar(
  $q$select public.emitir_orden_servicio(gen_random_uuid(), current_setting('prueba.proveedor')::uuid, null, null,
     'Arenado del chasis completo', null, null, null, 'PEN', 800, 'CONTADO', 0)$q$,
  'la firma de antes, sin código ni detracción, ya no se ejecuta', 'permission denied');

-- 1000 sin IGV = 1180 con IGV: pasa de 700, 10 % = 118.
select pg_temp.emitir('os1', 'pla_sr_o4_1_26/28 ', 1000, '025', null);
-- 500 sin IGV = 590 con IGV: no pasa de 700.
select pg_temp.emitir('os2', 'PLA_SR_O4_1_26/28', 500, '037', null);
-- 400 sin IGV = 472 con IGV: el transporte pasa de 400, 4 % = 18.88 → 19.
select pg_temp.emitir('os3', 'PLANTA', 400, '027', null);
-- 593.22 sin IGV = 700.00 con IGV: igual al mínimo, no lo pasa.
select pg_temp.emitir('os4', 'PLANTA', 593.22, '020', null);
select pg_temp.emitir('os5', 'PLANTA', 2000, 'NO_SUJETA', 'El proveedor no cobra IGV: está en el RUS');
reset role;

select test.afirmar(
  (select codigo_interno = 'pla_sr_o4_1_26/28' and detraccion_afecta and detraccion_codigo = '025'
          and detraccion_porcentaje = 10 and detraccion_minimo = 700 and total_con_igv_pen = 1180 and detraccion_monto = 118
     from pg_temp.os('os1')),
  'la OS guarda su código, el tipo con su porcentaje y su mínimo, y la base calcula 118 de 1180');
select test.afirmar(
  (select detraccion_afecta and total_con_igv_pen = 590 and detraccion_monto is null from pg_temp.os('os2')),
  'una OS sujeta que no pasa de S/ 700 con IGV no deposita nada');
select test.afirmar(
  (select total_con_igv_pen = 472 and detraccion_porcentaje = 4 and detraccion_monto = 19 from pg_temp.os('os3')),
  'el transporte de bienes deposita desde S/ 400, en soles enteros');
select test.afirmar(
  (select total_con_igv_pen = 700 and detraccion_monto is null from pg_temp.os('os4')),
  'con IGV justo en S/ 700 no hay detracción: tiene que pasar del mínimo');
select test.afirmar(
  (select detraccion_afecta = false and detraccion_codigo is null and detraccion_motivo like 'El proveedor no cobra IGV%'
          and detraccion_monto is null from pg_temp.os('os5')),
  'la no sujeta queda con su motivo y sin monto');
select test.afirmar(
  (select count(*) from public.notificaciones
    where usuario_id = current_setting('prueba.gerente')::uuid and titulo like 'Servicio por aprobar:%'
      and cuerpo like '%pla_sr_o4_1_26/28%') = 1,
  'el aviso a Gerencia dice el código interno');

-- ============================================ 3. Gerencia ve la OS en su código
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.codigo_interno_documentos('PLA_SR_O4_1_26/28') d
    where d.tipo = 'SERVICIO' and d.estado = 'POR_APROBAR' and d.detalle like 'PROVEEDOR DE PRUEBA 348 · S/ %sin IGV%') = 2,
  'Gerencia ve las dos OS del código, escrito en mayúsculas o minúsculas, por aprobar');
select test.afirmar(
  (select count(*) from public.codigos_internos_resumen() r where r.codigo = 'PLANTA') = 1,
  'un código que solo tiene órdenes de servicio sale en la lista de códigos');
select public.aprobar_orden_servicio(current_setting('prueba.os1')::uuid);
select public.aprobar_orden_servicio(current_setting('prueba.os3')::uuid);
reset role;

-- ============================================ 4. Contabilidad corrige la detracción, no el código
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_servicio) >= 5, 'Contabilidad ve las órdenes de servicio');
select test.debe_fallar($q$select pg_temp.emitir('os2', 'PLANTA', 10, '037', null)$q$,
  'Contabilidad no emite órdenes de servicio', 'permiso');
select test.debe_fallar(
  $q$select public.corregir_orden_servicio(current_setting('prueba.os2')::uuid, 'PLANTA', null, null)$q$,
  'Contabilidad no cambia el código interno', 'lo corrige Logística');
select public.corregir_orden_servicio(current_setting('prueba.os2')::uuid, null, '020', null);
reset role;
select test.afirmar(
  (select codigo_interno = 'PLA_SR_O4_1_26/28' and detraccion_codigo = '020' and detraccion_porcentaje = 12
          and detraccion_monto is null from pg_temp.os('os2')),
  'Contabilidad cambia el tipo y el porcentaje sigue al tipo nuevo');

select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_servicio) >= 5, 'Tesorería ve la detracción de las órdenes de servicio');
select test.debe_fallar(
  $q$select public.corregir_orden_servicio(current_setting('prueba.os2')::uuid, null, '037', null)$q$,
  'Tesorería no corrige la detracción', 'corresponde a Logística');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar((select count(*) from public.ordenes_servicio) = 0, 'un supervisor no ve las órdenes de servicio');
select test.debe_fallar(
  $q$select public.corregir_orden_servicio(current_setting('prueba.os2')::uuid, 'PLANTA', null, null)$q$,
  'un supervisor no corrige nada', 'corresponde a Logística');
reset role;

-- ============================================ 5. Logística corrige; el porcentaje guardado no cambia solo
select pg_temp.como('comprador');
set local role authenticated;
select public.corregir_orden_servicio(current_setting('prueba.os1')::uuid, 'PLA_SR_O4_1_26/28', null, null);
select test.debe_fallar(
  $q$update public.ordenes_servicio set codigo_interno = 'X' where id = current_setting('prueba.os1')::uuid$q$,
  'nadie corrige la OS a mano', 'permission denied');
reset role;
-- Si SUNAT cambiara el porcentaje, la OS emitida guarda el suyo aunque se
-- vuelva a elegir el mismo tipo; otro tipo toma el porcentaje del día.
update public.detracciones_servicio set porcentaje = 11 where codigo = '025';
select pg_temp.como('comprador');
set local role authenticated;
select public.corregir_orden_servicio(current_setting('prueba.os1')::uuid, null, '025', null);
reset role;
select test.afirmar(
  (select codigo_interno = 'PLA_SR_O4_1_26/28' and detraccion_porcentaje = 10 and detraccion_monto = 118 from pg_temp.os('os1')),
  'Logística corrige el código, y la OS conserva el porcentaje con que se emitió');
select pg_temp.como('comprador');
set local role authenticated;
select public.corregir_orden_servicio(current_setting('prueba.os4')::uuid, null, '025', null);
reset role;
select test.afirmar((select detraccion_porcentaje = 11 from pg_temp.os('os4')), 'un tipo nuevo toma el porcentaje vigente');
update public.detracciones_servicio set porcentaje = 10 where codigo = '025';

-- ============================================ 6. Con conformidad, solo la detracción
select pg_temp.como('comprador');
set local role authenticated;
select public.avanzar_orden_servicio(current_setting('prueba.os1')::uuid, 'CONFORME', 'Volvió bien arenado');
select test.debe_fallar(
  $q$select public.corregir_orden_servicio(current_setting('prueba.os1')::uuid, 'PLANTA', null, null)$q$,
  'con conformidad el código no cambia', 'no cambia');
select public.avanzar_orden_servicio(current_setting('prueba.os5')::uuid, 'ANULADA', 'Se encargó a otro proveedor');
select test.debe_fallar(
  $q$select public.corregir_orden_servicio(current_setting('prueba.os5')::uuid, null, '037', null)$q$,
  'la OS anulada no se corrige', 'anulada');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
select public.corregir_orden_servicio(current_setting('prueba.os1')::uuid, null, 'NO_SUJETA', 'El servicio se prestó fuera del país');
reset role;
select test.afirmar(
  (select estado = 'CONFORME' and detraccion_afecta = false and detraccion_porcentaje is null and detraccion_monto is null
     from pg_temp.os('os1')),
  'Contabilidad corrige la detracción de una OS conforme');
select test.debe_fallar(
  $q$update public.ordenes_servicio set descripcion = 'Otra cosa distinta' where id = current_setting('prueba.os1')::uuid$q$,
  'lo demás de una OS conforme no cambia ni con la clave del dueño', 'queda como evidencia');
select test.debe_fallar(
  $q$update public.ordenes_servicio set detraccion_monto = 1 where id = current_setting('prueba.os1')::uuid$q$,
  'el monto de la detracción no se escribe: lo calcula la base', 'DEFAULT');

select 'OK: la orden de servicio lleva su código interno y su detracción, con los roles reales' as comprobacion;
rollback;
