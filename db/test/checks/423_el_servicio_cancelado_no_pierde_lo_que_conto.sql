-- El servicio cancelado no pierde lo que contó (migración 20261022165000): el
-- pago a cuenta de una orden de servicio no se anula mientras esté vigente el
-- pago que la canceló contando con él.
-- Con el rol de Tesorería y Contabilidad, y `set local role authenticated`.
-- Termina en rollback.
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'CONTABILIDAD:CON', 'TESORERIA:TES'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.423@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 423', lower(replace(v, ':', '.')) || '.423@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK423-PLA', 'Plancha LAF 2 mm 4x8 (423)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  select '2060000423' || d, 'Proveedor de prueba 423', 'Av. Argentina 423, Lima', '999 423 423' from generate_series(0, 9) d
   where public.ruc_es_valido('2060000423' || d) limit 1
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['rq', 'oc1', 'd1', 'f1', 'os', 'p1', 'p2', 'p3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  -- Una orden de servicio aprobada de S/ 500, como dueño de la tabla.
  insert into public.ordenes_servicio (id, numero, proveedor_id, proveedor, descripcion, monto, moneda, codigo_interno,
                                       aprobacion, aprobado_por, aprobado_en, creado_por)
  values (current_setting('prueba.os')::uuid, 'QA-OS-423', current_setting('prueba.proveedor')::uuid, 'Proveedor de prueba 423',
          'Servicio de prueba del check 423', 500, 'PEN', 'QA423-OS', 'APROBADA', current_setting('prueba.gerente')::uuid, now(),
          current_setting('prueba.comprador')::uuid);
end $$;
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.pagar_os(p_pago text, p_monto numeric, p_cancela boolean) returns uuid language plpgsql as $$
declare v_ruta text := pg_temp.id('os') || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('pagos-servicio', v_ruta, auth.uid()::text, '{"mimetype": "application/pdf", "size": 2048}');
  return public.registrar_pago_servicio(pg_temp.id(p_pago), pg_temp.id('os'), current_setting('prueba.hoy')::date, p_monto, p_cancela,
    'OP-423-' || p_pago, null, v_ruta, current_setting('prueba.caja')::uuid, null);
end $$;
create or replace function pg_temp.pago_os() returns text language sql as $$
  select t.pago from public.trazabilidad_de_compras() t where t.id = pg_temp.id('os');
$$;

-- ============================================ 1. El pago a cuenta de la OS
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.pagar_os('p1', 200, false);
select pg_temp.pagar_os('p2', 250, true);
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(pg_temp.pago_os() = 'PAGADA', 'S/ 200 a cuenta y S/ 250 que la cancelan: la OS está pagada');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar($$ select public.anular_pago_servicio(pg_temp.id('p1'), 'El voucher era de otra orden') $$,
  'el pago a cuenta no se anula mientras esté el que canceló contando con él', 'anula primero ese');
select public.anular_pago_servicio(pg_temp.id('p2'), 'Se canceló contando un pago mal registrado');
select public.anular_pago_servicio(pg_temp.id('p1'), 'El voucher era de otra orden');
select pg_temp.pagar_os('p3', 250, false);
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(pg_temp.pago_os() = 'PAGO_PARCIAL', 'después de anular los dos y pagar S/ 250 a cuenta, la OS se lee con pago parcial');
reset role;

rollback;
