-- El detector de la factura guarda lo que leyó con el comprobante: lo guarda
-- Contabilidad con su rol, la base pone cuándo se leyó y rechaza lecturas mal
-- formadas. Nunca ADMIN y con `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'contabilidad.381@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
  select v_id, 'Contabilidad', 'Check 381', 'contabilidad.381@prueba.local', r.id from public.roles r where r.codigo = 'CONTABILIDAD';
  perform set_config('prueba.contabilidad', v_id::text, true);
  perform set_config('prueba.a1', gen_random_uuid()::text, true);
  perform set_config('prueba.a2', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end $$;

set local role authenticated;

-- 1. Contabilidad registra un recibo con lo que el detector leyó del PDF.
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, observacion, lectura_fuente, lectura_total, lectura_moneda, lectura_numero, lectura_ordenes)
values (current_setting('prueba.a1')::uuid, 'OTRO', 'FERRETERIA PRUEBA 381', 'E001-482', current_date, current_date, 'PEN', 1180,
        'CONTADO', '', 'PDF', 1180.00, 'PEN', 'E001-482', array['5583']);

select test.afirmar(
  (select lectura_en is not null and lectura_fuente = 'PDF' and lectura_ordenes = array['5583']
     from public.adquisiciones where id = current_setting('prueba.a1')::uuid),
  'Contabilidad guarda lo leído y la base sella cuándo');

-- 2. Lo leído mal formado no entra: ni una fuente que no existe, ni OC con ceros.
select test.debe_fallar($q$
  insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                    condicion_pago, observacion, lectura_fuente, lectura_ordenes)
  values (current_setting('prueba.a2')::uuid, 'OTRO', 'PROVEEDOR 381', 'E001-1', current_date, current_date, 'PEN', 10, 'CONTADO', '',
          'FOTO', array['5583'])$q$, 'una fuente que no es XML, PDF ni OCR se rechaza', 'ck_adquisicion_lectura');
select test.debe_fallar($q$
  insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                    condicion_pago, observacion, lectura_fuente, lectura_ordenes)
  values (current_setting('prueba.a2')::uuid, 'OTRO', 'PROVEEDOR 381', 'E001-1', current_date, current_date, 'PEN', 10, 'CONTADO', '',
          'PDF', array['0583'])$q$, 'un número de OC con ceros a la izquierda se rechaza', 'ck_adquisicion_lectura');
select test.debe_fallar($q$
  insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                    condicion_pago, observacion, lectura_total)
  values (current_setting('prueba.a2')::uuid, 'OTRO', 'PROVEEDOR 381', 'E001-1', current_date, current_date, 'PEN', 10, 'CONTADO', '',
          10)$q$, 'un total leído sin decir de dónde se leyó se rechaza', 'ck_adquisicion_lectura');

-- 3. El sello no lo pone quien escribe: un lectura_en inventado se reemplaza.
update public.adquisiciones set lectura_en = '2020-01-01', observacion = 'nota'
 where id = current_setting('prueba.a1')::uuid;
select test.afirmar(
  (select lectura_en > now() - interval '1 minute' from public.adquisiciones where id = current_setting('prueba.a1')::uuid),
  'el sello de la lectura no se cambia a mano');

-- 4. Sin lectura, el comprobante entra igual (el detector nunca frena).
insert into public.adquisiciones (id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, observacion)
values (current_setting('prueba.a2')::uuid, 'OTRO', 'SIN LECTURA 381', 'E001-2', current_date, current_date, 'PEN', 50, 'CONTADO', '');
select test.afirmar(
  (select lectura_fuente is null and lectura_en is null from public.adquisiciones where id = current_setting('prueba.a2')::uuid),
  'un comprobante sin lectura se registra igual');

reset role;
rollback;
