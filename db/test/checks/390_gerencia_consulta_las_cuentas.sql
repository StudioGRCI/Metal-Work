-- Gerencia consulta las Cuentas por cobrar y por pagar desde su menú (migración
-- 20261016800000). Contabilidad registra una factura de compra con su PDF y
-- Tesorería la paga con su voucher; Gerencia ve la factura, su pago, los dos
-- archivos y el aviso de si calza, pero no registra ni paga. Quien no tiene el
-- permiso no ve nada. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- En Supabase el bucket ya trae RLS y el permiso; el shim no.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['CONTABILIDAD', 'TESORERIA', 'GERENTE', 'VENDEDOR'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(v) || '.390@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
    select v_id, v, 'Check 390', lower(v) || '.390@prueba.local', r.id from public.roles r where r.codigo = v;
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  foreach v in array array['adq', 'pago', 'otra'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', (now() at time zone 'America/Lima')::date::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- 1. Contabilidad registra la factura de compra con su PDF.
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
values (current_setting('prueba.adq')::uuid, 'FACTURA_COMPRA', 'PROVEEDOR 390', 'F001-390',
        current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 1180, 'CONTADO');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('comprobantes-financieros', 'adquisiciones/' || current_setting('prueba.adq') || '/comprobante.pdf', current_setting('prueba.contabilidad'),
        '{"mimetype": "application/pdf", "size": 2048}');
update public.adquisiciones set ruta_storage = 'adquisiciones/' || current_setting('prueba.adq') || '/comprobante.pdf', estado = 'REGISTRADA'
 where id = current_setting('prueba.adq')::uuid;
reset role;

-- 2. Tesorería paga una parte con su voucher.
select pg_temp.como('tesoreria');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('pagos-facturas', current_setting('prueba.adq') || '/' || current_setting('prueba.pago') || '.pdf', current_setting('prueba.tesoreria'),
        '{"mimetype": "application/pdf", "size": 1024}');
select public.registrar_pago_factura(current_setting('prueba.pago')::uuid, current_setting('prueba.adq')::uuid, current_setting('prueba.hoy')::date,
  500, 'OP-390', current_setting('prueba.adq') || '/' || current_setting('prueba.pago') || '.pdf');
reset role;

-- 3. Gerencia la ve en Cuentas por pagar: la factura con su saldo, el pago, los dos archivos y el aviso.
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select saldo = 680 and pagado = 500 from public.v_cuentas_pagar where id = current_setting('prueba.adq')::uuid),
  'Gerencia ve la factura de compra con lo pagado y su saldo');
select test.afirmar(
  (select count(*) from public.pagos_adquisicion where adquisicion_id = current_setting('prueba.adq')::uuid) = 1,
  'Gerencia ve el pago de Tesorería');
select test.afirmar(
  (select count(*) from storage.objects
    where (bucket_id = 'comprobantes-financieros' and name = 'adquisiciones/' || current_setting('prueba.adq') || '/comprobante.pdf')
       or (bucket_id = 'pagos-facturas' and name = current_setting('prueba.adq') || '/' || current_setting('prueba.pago') || '.pdf')) = 2,
  'Gerencia abre el PDF de la factura y el voucher del pago');
select test.afirmar(
  (select count(*) from public.adquisiciones_control(array[current_setting('prueba.adq')::uuid])) = 1,
  'Gerencia ve si la factura calza con sus OC');

-- 4. Pero no paga, no registra ni corrige facturas.
select test.debe_fallar(format($q$select public.registrar_pago_factura('%s', '%s', '%s', 10, 'OP-390-G', null)$q$,
    current_setting('prueba.otra'), current_setting('prueba.adq'), current_setting('prueba.hoy')),
  'Gerencia no registra pagos');
select test.debe_fallar(format($q$insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago)
    values ('%s', 'FACTURA_COMPRA', 'PROVEEDOR 390', 'F001-391', current_date, current_date, 'PEN', 10, 'CONTADO')$q$, current_setting('prueba.otra')),
  'Gerencia no registra facturas de compra', 'row-level security');
update public.adquisiciones set total = 1 where id = current_setting('prueba.adq')::uuid;
reset role;
select test.afirmar((select total = 1180 from public.adquisiciones where id = current_setting('prueba.adq')::uuid),
  'Gerencia no cambia una factura de compra');

-- 5. Quien no tiene el permiso no ve ninguna.
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.v_cuentas_pagar where id = current_setting('prueba.adq')::uuid) = 0
  and (select count(*) from public.pagos_adquisicion where adquisicion_id = current_setting('prueba.adq')::uuid) = 0,
  'Ventas no ve las cuentas por pagar');
reset role;

rollback;
