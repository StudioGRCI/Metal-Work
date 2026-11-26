-- El motivo del atraso se enmienda contra la fecha del documento, y anular el
-- pago de una OS la devuelve a su tipo de cambio (migración 20261126945000). Con
-- la cuenta de cada puesto —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
--
-- Motivo:
--   os1: debía volver hace 3 días; Logística corrigió la fecha a pasado mañana
--        con un motivo equivocado y volvió hoy: entre las dos fechas. Ahora
--        acepta otro motivo.
--   os2: debía volver en 5 días y volvió hoy: no está atrasada, sigue sin motivo.
--   oc:  prometida hace 3 días; llegó una parte hace 5 y el resto ayer; la
--        fecha se había corregido a pasado mañana. Llegó completa tarde: acepta
--        otro motivo, y la pantalla ofrece «Anotar motivo» (compras_que_aceptan_motivo).
-- Pago:
--   os4: en dólares, emitida con el cambio de ayer (3,70), el único que había.
--        Nadie corrige ese cambio: anular su pago no la mueve al de hoy.
--   os3: en dólares, sin tipo de cambio. Contabilidad registra el de hoy mal
--        (37,50); Tesorería paga una parte; Contabilidad lo corrige a 3,75 y la
--        OS sigue con lo pagado. Tesorería anula el pago: la OS toma 3,75.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONTABILIDAD:CON', 'TESORERIA:TES'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.488@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 488', lower(replace(v, ':', '.')) || '.488@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 488') = 4,
    'se crearon los cuatro usuarios del check, uno por puesto');
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 488'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(488000, 488200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 488'), true);
  foreach v in array array['os1', 'os2', 'os3', 'os4', 'tc', 'tc_ayer', 'pago', 'pago4', 'oc', 'det'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select current_setting('prueba.' || p)::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Lima')::date $$;
create or replace function pg_temp.os(p text) returns public.ordenes_servicio language sql as $$
  select * from public.ordenes_servicio where id = pg_temp.id(p);
$$;

select test.afirmar((select count(*) from public.tipos_de_cambio) = 0, 'no hay ningún tipo de cambio registrado');

-- Contabilidad registra el cambio de ayer: es el único que hay cuando se emite la os4.
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (id, fecha, compra, venta, fuente, registrado_por)
values (pg_temp.id('tc_ayer'), pg_temp.hoy() - 1, 3.65, 3.70, 'SUNAT', pg_temp.id('contabilidad'));
reset role;

-- ============================================ Logística emite, Gerencia aprueba
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_orden_servicio(pg_temp.id('os1'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Torneado de ejes, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('os2'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Pintura de la tolva, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 700, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('os3'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Arenado del chasis, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('os4'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Rolado de planchas, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
reset role;
select test.afirmar((pg_temp.os('os4')).monto_pen = 3700.00,
  format('la os4 se emitió con el cambio de ayer, el único registrado (dice %s)', (pg_temp.os('os4')).monto_pen));
-- La os3 se emitió igual con ese cambio: se le vacía para seguir el caso de un cambio que falta.
set local session_replication_role = replica;
update public.ordenes_servicio set monto_pen = null where id = pg_temp.id('os3');
set local session_replication_role = origin;
-- La os1 debía volver hace 3 días (se emitió antes).
update public.ordenes_servicio set fecha_inicio = pg_temp.hoy() - 8, fecha_fin = pg_temp.hoy() - 3 where id = pg_temp.id('os1');

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('os1'));
select public.aprobar_orden_servicio(pg_temp.id('os2'));
select public.aprobar_orden_servicio(pg_temp.id('os3'));
select public.aprobar_orden_servicio(pg_temp.id('os4'));
reset role;

-- ============================================ El motivo se enmienda contra la fecha del documento
select pg_temp.como('comprador');
set local role authenticated;
select public.corregir_fecha_esperada(gen_random_uuid(), 'OS', pg_temp.id('os1'), pg_temp.hoy() + 2, 'PROVEEDOR', 'Se anotó por error');
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'CONFORME', 'Volvió bien torneado');
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'CONFORME', 'Volvió bien pintada');
do $$
begin
  perform public.anotar_motivo_atraso(gen_random_uuid(), 'OS', pg_temp.id('os1'), 'PAGO', 'Fue nuestro pago, no el proveedor');
  perform test.afirmar(true, 'la OS que pasó la fecha del documento acepta otro motivo, aunque volvió antes de la corregida');
end $$;
select test.debe_fallar(
  format('select public.anotar_motivo_atraso(gen_random_uuid(), ''OS'', %L, ''PAGO'', null)', pg_temp.id('os2')),
  'la OS que volvió antes de la fecha del documento sigue sin motivo', 'no está atrasada');
reset role;
select test.afirmar((select s.motivo from public.seguimiento_de_compras s
                      where s.orden_servicio_id = pg_temp.id('os1') and s.tipo = 'MOTIVO_ATRASO'
                      order by s.registrado_en desc, s.id desc limit 1) = 'PAGO',
  'el motivo enmendado quedó anotado');

-- ============================================ La OC que llegó por partes y completó tarde
-- Prometida hace 3 días. Llegó una parte hace 5 (antes de la fecha) y el resto ayer
-- (después). Logística había corregido la fecha a pasado mañana, por error.
set local session_replication_role = replica;
insert into public.ordenes_compra_materiales (id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en, creado_por, creado_en,
                                              fecha_estimada, entregado_almacen_en, origen, motivo)
values (pg_temp.id('oc'), 'PROVEEDOR DE PRUEBA 488', 'OC-0488-MW', 'APROBADA', pg_temp.id('gerente'), now() - interval '9 days',
        pg_temp.id('comprador'), now() - interval '10 days', pg_temp.hoy() - 3, now() - interval '5 days', 'DIRECTA', 'Compra de prueba 488');
insert into public.orden_compra_material_detalles (id, orden_compra_id, cantidad, material_id)
values (pg_temp.id('det'), pg_temp.id('oc'), 10, (select id from public.materiales order by codigo limit 1));
insert into public.movimientos_materiales (id, tipo, cantidad, orden_compra_detalle_id, registrado_en, material_id, origen, documento_referencia, registrado_por)
values (gen_random_uuid(), 'INGRESO', 4, pg_temp.id('det'), now() - interval '5 days', (select id from public.materiales order by codigo limit 1), 'COMPRA', 'GR prueba 488-1', pg_temp.id('comprador')),
       (gen_random_uuid(), 'INGRESO', 6, pg_temp.id('det'), now() - interval '1 day', (select id from public.materiales order by codigo limit 1), 'COMPRA', 'GR prueba 488-2', pg_temp.id('comprador'));
insert into public.seguimiento_de_compras (orden_compra_id, tipo, motivo, fecha_anterior, fecha_nueva, registrado_por, registrado_en)
values (pg_temp.id('oc'), 'FECHA_ESPERADA', 'PROVEEDOR', pg_temp.hoy() - 3, pg_temp.hoy() + 2, pg_temp.id('comprador'), now() - interval '4 days');
set local session_replication_role = origin;

select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_que_aceptan_motivo('OC', array[pg_temp.id('oc')])) = 1
                and (select count(*) from public.compras_que_aceptan_motivo('OS', array[pg_temp.id('os1'), pg_temp.id('os2')])) = 1
                and (select documento from public.compras_que_aceptan_motivo('OS', array[pg_temp.id('os1'), pg_temp.id('os2')])) = pg_temp.id('os1'),
  'la pantalla ofrece el motivo en la OC que completó tarde y en la os1, no en la os2');
do $$
begin
  perform public.anotar_motivo_atraso(gen_random_uuid(), 'OC', pg_temp.id('oc'), 'PAGO', 'Fue nuestro pago, no el proveedor');
  perform test.afirmar(true, 'la OC que llegó por partes y completó después de la fecha del documento acepta otro motivo');
end $$;
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.compras_que_aceptan_motivo('OC', array[pg_temp.id('oc')])) = 0,
  'a quien no anota motivos (Tesorería) no le dice nada');
reset role;

-- ============================================ El pago anulado devuelve la OS a su cambio
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (id, fecha, compra, venta, fuente, registrado_por)
values (pg_temp.id('tc'), pg_temp.hoy(), 37.00, 37.50, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar((pg_temp.os('os3')).monto_pen = 37500.00, 'la OS en dólares toma el cambio registrado, aunque esté mal');
set local session_replication_role = replica;
insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('pago'), pg_temp.id('os3'), current_date, 'USD', 500, false, 'prueba/488/pago.pdf', 'application/pdf', 1000, pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
update public.tipos_de_cambio set compra = 3.70, venta = 3.75 where id = pg_temp.id('tc');
reset role;
select test.afirmar((pg_temp.os('os3')).monto_pen = 37500.00, 'con un pago vigente, corregir el cambio no la recalcula');

select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_pago_servicio(pg_temp.id('pago'), 'Se pagó con el cambio equivocado');
reset role;
select test.afirmar((pg_temp.os('os3')).monto_pen = 3750.00,
  format('anulado el pago, la OS toma el cambio de su día (dice %s)', (pg_temp.os('os3')).monto_pen));
select test.afirmar((pg_temp.os('os3')).total_con_igv_pen = 4425.00,
  format('y con él su total con IGV (dice %s)', (pg_temp.os('os3')).total_con_igv_pen));

-- La os4 no tiene la cifra de ningún valor corregido: anular su pago no la mueve.
set local session_replication_role = replica;
insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('pago4'), pg_temp.id('os4'), current_date, 'USD', 300, false, 'prueba/488/pago4.pdf', 'application/pdf', 1000, pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_pago_servicio(pg_temp.id('pago4'), 'Se pagó a la cuenta equivocada');
reset role;
select test.afirmar((pg_temp.os('os4')).monto_pen = 3700.00,
  format('la OS emitida con el cambio de ayer, sin corrección, sigue igual al anular su pago (dice %s)', (pg_temp.os('os4')).monto_pen));

do $$
begin
  perform test.afirmar(not has_function_privilege('authenticated', 'public.compra_paso_su_primera_fecha(text, uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.compras_que_pasaron_su_primera_fecha(text, uuid[])', 'execute')
                   and not has_function_privilege('authenticated', 'public.fn_pago_anulado_recalcula_servicio()', 'execute')
                   and not has_function_privilege('anon', 'public.compras_que_aceptan_motivo(text, uuid[])', 'execute'),
    'los ayudantes nuevos no los ejecuta nadie con sesión');
end $$;

rollback;
