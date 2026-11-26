-- La OS en dólares emitida sin tipo de cambio toma su monto en soles cuando el
-- cambio se registra después (migración 20261126626000). Con la cuenta de cada
-- puesto —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Sin ningún tipo de cambio en la base, Logística emite cuatro OS en dólares:
--   1. aprobada y en ejecución, afecta a detracción;
--   2. aprobada y conforme;
--   3. aprobada y anulada: queda como estaba;
--   4. en soles: ya tiene su monto y no cambia.
-- Administración registra el primer tipo de cambio: la 1 y la 2 toman su monto
-- en soles, y la 1 su total con IGV y su detracción. Contabilidad lo corrige
-- después: lo que ya se completó no cambia. Y la guarda de la OS conforme sigue
-- frenando cualquier otro cambio.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONTABILIDAD:CON', 'ADMINISTRACION:ADM'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.487@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 487', lower(replace(v, ':', '.')) || '.487@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 487') = 4,
    'se crearon los cuatro usuarios del check, uno por puesto');
  -- Un RUC inventado que pasa el dígito verificador.
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 487'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(487000, 487200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 487'), true);
  foreach v in array array['os1', 'os2', 'os3', 'os4', 'tc'] loop
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
create or replace function pg_temp.os(p text) returns public.ordenes_servicio language sql as $$
  select * from public.ordenes_servicio where id = pg_temp.id(p);
$$;

-- La base del check no trae tipos de cambio: así la OS en dólares nace sin monto en soles.
select test.afirmar((select count(*) from public.tipos_de_cambio) = 0, 'no hay ningún tipo de cambio registrado');

select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v text;
begin
  foreach v in array array['os1', 'os2', 'os3'] loop
    perform public.emitir_orden_servicio(pg_temp.id(v), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
      'PLANTA', 'Arenado del chasis, prueba 487 ' || v, null, current_date, current_date + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
  end loop;
  perform public.emitir_orden_servicio(pg_temp.id('os4'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Pintura de la tolva, prueba 487', null, current_date, current_date + 5, 'PEN', 900, 'CONTADO', 0, '025', null);
end $$;
reset role;
select test.afirmar((pg_temp.os('os1')).monto_pen is null and (pg_temp.os('os1')).detraccion_monto is null,
  'la OS en dólares emitida sin tipo de cambio nace sin monto en soles ni detracción');
select test.afirmar((pg_temp.os('os4')).monto_pen = 900, 'la OS en soles nace con su monto');

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('os1'));
select public.aprobar_orden_servicio(pg_temp.id('os2'));
select public.aprobar_orden_servicio(pg_temp.id('os3'));
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os2'), 'CONFORME', 'Volvió bien arenado');
select public.avanzar_orden_servicio(pg_temp.id('os3'), 'ANULADA', 'Se encargó a otro proveedor');
reset role;

-- ============================================ Administración registra el cambio
select pg_temp.como('administracion');
set local role authenticated;
insert into public.tipos_de_cambio (id, fecha, compra, venta, fuente, registrado_por)
values (pg_temp.id('tc'), current_date, 3.70, 3.75, 'SUNAT', pg_temp.id('administracion'));
reset role;
select test.afirmar((pg_temp.os('os1')).monto_pen = 3750.00,
  format('la OS en ejecución toma su monto en soles con el cambio registrado (dice %s)', (pg_temp.os('os1')).monto_pen));
select test.afirmar((pg_temp.os('os1')).total_con_igv_pen = 4425.00 and (pg_temp.os('os1')).detraccion_monto is not null,
  format('y con él su total con IGV y su detracción (total %s, detracción %s)',
         (pg_temp.os('os1')).total_con_igv_pen, (pg_temp.os('os1')).detraccion_monto));
select test.afirmar((pg_temp.os('os2')).monto_pen = 3750.00 and (pg_temp.os('os2')).estado = 'CONFORME',
  'la OS conforme también toma su monto en soles, y sigue conforme');
select test.afirmar((pg_temp.os('os3')).monto_pen is null, 'la OS anulada queda como estaba: es evidencia');
select test.afirmar((pg_temp.os('os4')).monto_pen = 900, 'la OS en soles no cambia');

-- ============================================ Contabilidad corrige el cambio: lo completado no cambia
select pg_temp.como('contabilidad');
set local role authenticated;
update public.tipos_de_cambio set venta = 3.80 where id = pg_temp.id('tc');
reset role;
select test.afirmar((pg_temp.os('os1')).monto_pen = 3750.00,
  'corregir el tipo de cambio no cambia el monto en soles que la OS ya tenía');

-- ============================================ Las guardas siguen en pie
select test.debe_fallar(
  format('update public.ordenes_servicio set monto_pen = 1 where id = %L', pg_temp.id('os2')),
  'sin pasar por la base, la OS conforme sigue sin cambiar', 'queda como evidencia');
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar('select public.completar_monto_pen_de_servicios()',
  'nadie llama al completado directo: lo hace el tipo de cambio', 'permission denied');
select test.debe_fallar(
  format('update public.ordenes_servicio set monto_pen = 1 where id = %L', pg_temp.id('os1')),
  'ni corrige la OS a mano', 'permission denied');
reset role;
do $$
begin
  perform test.afirmar(not has_function_privilege('authenticated', 'public.completar_monto_pen_de_servicios()', 'execute')
                   and not has_function_privilege('anon', 'public.completar_monto_pen_de_servicios()', 'execute'),
    'el completado no lo ejecuta nadie con sesión');
end $$;

rollback;
