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
-- Pago:
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
  foreach v in array array['os1', 'os2', 'os3', 'tc', 'pago'] loop
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

-- ============================================ Logística emite, Gerencia aprueba
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_orden_servicio(pg_temp.id('os1'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Torneado de ejes, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('os2'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Pintura de la tolva, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 700, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('os3'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Arenado del chasis, prueba 488', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
reset role;
-- La os1 debía volver hace 3 días (se emitió antes).
update public.ordenes_servicio set fecha_inicio = pg_temp.hoy() - 8, fecha_fin = pg_temp.hoy() - 3 where id = pg_temp.id('os1');

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('os1'));
select public.aprobar_orden_servicio(pg_temp.id('os2'));
select public.aprobar_orden_servicio(pg_temp.id('os3'));
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

do $$
begin
  perform test.afirmar(not has_function_privilege('authenticated', 'public.compra_paso_su_primera_fecha(text, uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.fn_pago_anulado_recalcula_servicio()', 'execute'),
    'los ayudantes nuevos no los ejecuta nadie con sesión');
end $$;

rollback;
