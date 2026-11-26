-- La OS en dólares toma el tipo de cambio de su factura (migración 20261126947000).
-- Con la cuenta de cada puesto —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
--
-- Cambios registrados: ayer 3,70 (el único al emitir) y hace 3 días 3,80.
--
--   osa: US$ 1 000, emitida a 3 700. Logística adjunta su factura de hace 3
--        días: pasa a 3 800, con su total y su detracción. Anulada la factura,
--        vuelve a 3 700.
--   osb: US$ 1 000. Su factura es de hace 15 días, sin cambio registrado: queda
--        sin monto en soles. Contabilidad registra ese cambio (3,60) y se
--        completa; lo corrige a 3,65 y la sigue.
--   osc: US$ 1 000, con un adelanto al proveedor. La factura la mueve igual:
--        la detracción todavía no se depositó.
--   osd: US$ 1 000, con su detracción depositada. La factura no la mueve;
--        anulado el depósito —aunque le quede un adelanto—, toma el cambio de
--        su factura.
--   ose: US$ 1 000, emitida hace 40 días con un cambio de hace 60 (3,50).
--        Anulada su factura, vuelve a 3 500 y no queda vacía.
--   osf: US$ 1 000. Su factura es de hoy, y el cambio de hoy todavía no está:
--        toma el de ayer (3 700). Contabilidad registra el de hoy (3,90) y pasa
--        a 3 900; la que no tiene factura sigue como se emitió.
--   osp: en soles. Su factura no pide fecha y no cambia nada.
--
-- Quien no debe (Ventas) no adjunta; nadie con sesión ejecuta los ayudantes.
\set ON_ERROR_STOP on
begin;

-- En Supabase el bucket ya trae RLS y el permiso; el shim no.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.490@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 490', lower(replace(v, ':', '.')) || '.490@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 490') = 5,
    'se crearon los cinco usuarios del check, uno por puesto');
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 490'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(490000, 490200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 490'), true);
  foreach v in array array['osa', 'osb', 'osc', 'osd', 'ose', 'osf', 'osp', 'tc15', 'pago', 'pagod', 'adelantod', 'fa', 'fb', 'fc', 'fd', 'fe', 'ff', 'fp'] loop
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
-- Un archivo ya subido a la carpeta de esa OS, a nombre de quien lo va a anotar.
create or replace function pg_temp.subir(p_os text, p_de text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_os) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('documentos-servicio', v_ruta, pg_temp.id(p_de), pg_temp.id(p_de)::text,
          jsonb_build_object('mimetype', 'application/pdf', 'size', 2048 + (random() * 1000)::int));
  return v_ruta;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select test.afirmar((select count(*) from public.tipos_de_cambio) = 0, 'no hay ningún tipo de cambio registrado');

select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy() - 1, 3.65, 3.70, 'SUNAT', pg_temp.id('contabilidad'));
reset role;

-- ============================================ Logística emite, Gerencia aprueba
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_orden_servicio(pg_temp.id('osa'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Torneado de ejes, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osb'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Arenado del chasis, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osc'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Rolado de planchas, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osd'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Soldadura del bastidor, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('ose'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Galvanizado de barandas, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osf'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Plegado de pisos, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'USD', 1000, 'CONTADO', 0, '025', null);
select public.emitir_orden_servicio(pg_temp.id('osp'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
  'PLANTA', 'Pintura de la tolva, prueba 490', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('osa'));
select public.aprobar_orden_servicio(pg_temp.id('osb'));
select public.aprobar_orden_servicio(pg_temp.id('osc'));
select public.aprobar_orden_servicio(pg_temp.id('osd'));
select public.aprobar_orden_servicio(pg_temp.id('ose'));
select public.aprobar_orden_servicio(pg_temp.id('osf'));
select public.aprobar_orden_servicio(pg_temp.id('osp'));
reset role;
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00 and (pg_temp.os('osa')).fecha_cambio is null,
  format('la OS en dólares se emitió con el cambio de ayer y sin día de factura (dice %s)', (pg_temp.os('osa')).monto_pen));
select set_config('prueba.detraccion_antes', coalesce((pg_temp.os('osa')).detraccion_monto::text, 'sin'), true);

-- Contabilidad registra después el cambio de hace 3 días: la OS ya tiene su monto y no se mueve.
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy() - 3, 3.75, 3.80, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00, 'registrar el cambio de otro día no mueve la OS que ya tiene su monto');

-- ============================================ La factura pide su fecha
select set_config('prueba.ruta_a', pg_temp.subir('osa', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''FACTURA'', ''F001-4901'', ''factura.pdf'', %L, null::date)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a')),
  'la factura de una OS en dólares no entra sin su fecha de emisión', 'fecha de emisión');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''FACTURA'', ''F001-4901'', ''factura.pdf'', %L)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a')),
  'ni desde la pestaña que no se recargó: le pide recargar', 'recarga la pantalla');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''FACTURA'', ''F001-4901'', ''factura.pdf'', %L, %L::date)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a'), pg_temp.hoy() + 1),
  'ni con una fecha que todavía no llega', 'todavía no llega');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''CONTRATO'', null, ''contrato.pdf'', %L, %L::date)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a'), pg_temp.hoy() - 3),
  'el contrato no lleva fecha de emisión', 'va solo con la factura');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''BOLETA'', ''B001-4901'', ''boleta.pdf'', %L, %L::date)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a'), pg_temp.hoy() - 3),
  'ni la boleta: la fecha es de la factura, que decide el cambio', 'va solo con la factura');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''FACTURA'', ''F001-4901'', ''factura.pdf'', %L, %L::date)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a'), pg_temp.hoy() - 500),
  'ni una factura de más de un año antes de la OS', 'más de un año antes');
reset role;
select test.afirmar((select count(*) from public.documentos_orden_servicio where orden_servicio_id = pg_temp.id('osa')) = 0
                and (pg_temp.os('osa')).monto_pen = 3700.00,
  'los seis rechazos no dejaron nada: ni documento ni cambio');

-- ============================================ Con su factura, toma el cambio de ese día
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  public.adjuntar_documento_servicio(pg_temp.id('fa'), pg_temp.id('osa'), 'FACTURA', 'F001-4901', 'factura.pdf',
                                     current_setting('prueba.ruta_a'), pg_temp.hoy() - 3) = pg_temp.id('fa'),
  'Logística adjunta la factura de hace 3 días');
-- El mismo envío repetido contesta lo mismo, por la función nueva y por la de antes.
select test.afirmar(
  public.adjuntar_documento_servicio(pg_temp.id('fa'), pg_temp.id('osa'), 'FACTURA', 'F001-4901', 'factura.pdf',
                                     current_setting('prueba.ruta_a'), pg_temp.hoy() - 3) = pg_temp.id('fa')
  and public.adjuntar_documento_servicio(pg_temp.id('fa'), pg_temp.id('osa'), 'FACTURA', 'F001-4901', 'factura.pdf',
                                         current_setting('prueba.ruta_a')) = pg_temp.id('fa'),
  'el mismo envío repetido no anota otra ni falla');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(%L, %L, ''FACTURA'', ''F001-4901'', ''factura.pdf'', %L, %L::date)',
         pg_temp.id('fa'), pg_temp.id('osa'), current_setting('prueba.ruta_a'), pg_temp.hoy() - 2),
  'el mismo envío con otra fecha no contesta «listo»: no es el mismo', 'ya quedó adjuntado');
reset role;
select test.afirmar((select count(*) from public.documentos_orden_servicio where orden_servicio_id = pg_temp.id('osa')) = 1
                and (select fecha_emision from public.documentos_orden_servicio where id = pg_temp.id('fa')) = pg_temp.hoy() - 3,
  'quedó una sola factura, con su fecha de emisión');
select test.afirmar((pg_temp.os('osa')).monto_pen = 3800.00 and (pg_temp.os('osa')).fecha_cambio = pg_temp.hoy() - 3,
  format('la OS toma el cambio del día de su factura: US$ 1 000 a 3,80 (dice %s)', (pg_temp.os('osa')).monto_pen));
select test.afirmar((pg_temp.os('osa')).total_con_igv_pen = 4484.00,
  format('y con él su total con IGV (dice %s)', (pg_temp.os('osa')).total_con_igv_pen));
select test.afirmar(
  (pg_temp.os('osa')).detraccion_afecta
  and (pg_temp.os('osa')).detraccion_monto = round(4484.00 * (pg_temp.os('osa')).detraccion_porcentaje / 100, 0)
  and (pg_temp.os('osa')).detraccion_monto::text is distinct from current_setting('prueba.detraccion_antes'),
  format('la detracción se recalcula sobre ese total (antes %s, ahora %s)',
         current_setting('prueba.detraccion_antes'), (pg_temp.os('osa')).detraccion_monto));

-- Tesorería, que paga, lee el día del cambio y la fecha de la factura.
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select fecha_cambio from public.ordenes_servicio where id = pg_temp.id('osa')) = pg_temp.hoy() - 3
                and (select fecha_emision from public.documentos_orden_servicio where id = pg_temp.id('fa')) = pg_temp.hoy() - 3,
  'Tesorería lee el día del cambio de la OS y la fecha de su factura');
reset role;

-- ============================================ La factura de un día sin cambio registrado
select set_config('prueba.ruta_b', pg_temp.subir('osb', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.adjuntar_documento_servicio(pg_temp.id('fb'), pg_temp.id('osb'), 'FACTURA', 'F001-4902', 'factura-b.pdf',
                                          current_setting('prueba.ruta_b'), pg_temp.hoy() - 15);
reset role;
select test.afirmar((pg_temp.os('osb')).monto_pen is null and (pg_temp.os('osb')).fecha_cambio = pg_temp.hoy() - 15
                and (pg_temp.os('osb')).detraccion_monto is null,
  'la factura de un día sin cambio registrado deja la OS sin monto en soles ni detracción: falta el cambio de ese día');
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (id, fecha, compra, venta, fuente, registrado_por)
values (pg_temp.id('tc15'), pg_temp.hoy() - 15, 3.55, 3.60, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar((pg_temp.os('osb')).monto_pen = 3600.00,
  format('Contabilidad registra el cambio de ese día y la OS se completa (dice %s)', (pg_temp.os('osb')).monto_pen));
select pg_temp.como('contabilidad');
set local role authenticated;
update public.tipos_de_cambio set compra = 3.60, venta = 3.65 where id = pg_temp.id('tc15');
reset role;
select test.afirmar((pg_temp.os('osb')).monto_pen = 3650.00,
  format('y si lo corrige, la sigue: el cambio corregido es el del día de la factura (dice %s)', (pg_temp.os('osb')).monto_pen));
select test.afirmar((pg_temp.os('osa')).monto_pen = 3800.00 and (pg_temp.os('osc')).monto_pen = 3700.00,
  'las otras OS, que son de otro día, no se mueven');

-- ============================================ Un adelanto al proveedor no la detiene
-- Los pagos se siembran sin su función: exige la conformidad y el archivo, que no son de este check.
set local session_replication_role = replica;
insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, destino, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('pago'), pg_temp.id('osc'), current_date, 'USD', 300, false, 'PROVEEDOR', 'prueba/490/pago.pdf', 'application/pdf', 1000, pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select set_config('prueba.ruta_c', pg_temp.subir('osc', 'tesoreria'), true);
select pg_temp.como('tesoreria');
set local role authenticated;
select public.adjuntar_documento_servicio(pg_temp.id('fc'), pg_temp.id('osc'), 'FACTURA', 'F001-4903', 'factura-c.pdf',
                                          current_setting('prueba.ruta_c'), pg_temp.hoy() - 3);
reset role;
select test.afirmar((pg_temp.os('osc')).monto_pen = 3800.00 and (pg_temp.os('osc')).fecha_cambio = pg_temp.hoy() - 3
                and (pg_temp.os('osc')).detraccion_monto = (pg_temp.os('osa')).detraccion_monto,
  format('con un adelanto al proveedor, la factura mueve igual la OS: la detracción todavía no se depositó (dice %s)',
         (pg_temp.os('osc')).monto_pen));
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(
  (select s.pagado_proveedor = 300 and s.saldo_detraccion = (pg_temp.os('osc')).detraccion_monto
          and s.saldo_proveedor = s.total - s.detraccion_en_moneda - 300
     from public.saldos_de_servicios(array[pg_temp.id('osc')]) s),
  'y Tesorería ve el adelanto descontado y la detracción entera por depositar, con el cambio de la factura');
reset role;

-- ============================================ Con la detracción depositada no se mueve
set local session_replication_role = replica;
insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, destino, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('adelantod'), pg_temp.id('osd'), current_date, 'USD', 300, false, 'PROVEEDOR', 'prueba/490/adelanto-d.pdf', 'application/pdf', 1000, pg_temp.id('tesoreria')),
       (pg_temp.id('pagod'), pg_temp.id('osd'), current_date, 'PEN', (pg_temp.os('osd')).detraccion_monto, false, 'DETRACCION', 'prueba/490/detraccion-d.pdf', 'application/pdf', 1000, pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select set_config('prueba.ruta_d', pg_temp.subir('osd', 'tesoreria'), true);
select pg_temp.como('tesoreria');
set local role authenticated;
select public.adjuntar_documento_servicio(pg_temp.id('fd'), pg_temp.id('osd'), 'FACTURA', 'F001-4905', 'factura-d.pdf',
                                          current_setting('prueba.ruta_d'), pg_temp.hoy() - 3);
reset role;
select test.afirmar((pg_temp.os('osd')).monto_pen = 3700.00 and (pg_temp.os('osd')).fecha_cambio is null,
  'la OS con su detracción ya depositada no se mueve al adjuntar su factura');
select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_pago_servicio(pg_temp.id('pagod'), 'Se depositó con el cambio equivocado');
reset role;
select test.afirmar((pg_temp.os('osd')).monto_pen = 3800.00 and (pg_temp.os('osd')).fecha_cambio = pg_temp.hoy() - 3,
  format('anulado el depósito, toma el cambio de su factura aunque le quede el adelanto (dice %s)', (pg_temp.os('osd')).monto_pen));

-- ============================================ Anulada la factura, vuelve al día en que se emitió
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_servicio(pg_temp.id('fa'), 'Se adjuntó la factura de otra orden');
reset role;
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00 and (pg_temp.os('osa')).fecha_cambio is null,
  format('anulada la factura, la OS vuelve al cambio del día en que se emitió (dice %s)', (pg_temp.os('osa')).monto_pen));

-- ============================================ La que se emitió con un cambio viejo vuelve a él
-- Como si se hubiera emitido hace 40 días, con el último cambio de entonces (hace 60, a 3,50).
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy() - 60, 3.45, 3.50, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
set local session_replication_role = replica;
update public.ordenes_servicio set creado_en = now() - interval '40 days', monto_pen = 3500.00 where id = pg_temp.id('ose');
set local session_replication_role = origin;
select set_config('prueba.ruta_e', pg_temp.subir('ose', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.adjuntar_documento_servicio(pg_temp.id('fe'), pg_temp.id('ose'), 'FACTURA', 'F001-4906', 'factura-e.pdf',
                                          current_setting('prueba.ruta_e'), pg_temp.hoy() - 3);
reset role;
select test.afirmar((pg_temp.os('ose')).monto_pen = 3800.00, 'la OS emitida hace 40 días toma el cambio de su factura');
select pg_temp.como('comprador');
set local role authenticated;
select public.anular_documento_servicio(pg_temp.id('fe'), 'Se adjuntó la factura de otra orden');
reset role;
select test.afirmar((pg_temp.os('ose')).monto_pen = 3500.00 and (pg_temp.os('ose')).fecha_cambio is null,
  format('y anulada la factura vuelve al cambio con que se emitió, aunque sea de más de diez días antes (dice %s)',
         coalesce((pg_temp.os('ose')).monto_pen::text, 'vacío')));

-- ============================================ La factura de hoy, antes que el cambio de hoy
select set_config('prueba.ruta_f', pg_temp.subir('osf', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.adjuntar_documento_servicio(pg_temp.id('ff'), pg_temp.id('osf'), 'FACTURA', 'F001-4907', 'factura-f.pdf',
                                          current_setting('prueba.ruta_f'), pg_temp.hoy());
reset role;
select test.afirmar((pg_temp.os('osf')).monto_pen = 3700.00 and (pg_temp.os('osf')).fecha_cambio = pg_temp.hoy(),
  'la factura de hoy, sin el cambio de hoy, toma el último registrado: el de ayer');
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.tipos_de_cambio (fecha, compra, venta, fuente, registrado_por)
values (pg_temp.hoy(), 3.85, 3.90, 'SUNAT', pg_temp.id('contabilidad'));
reset role;
select test.afirmar((pg_temp.os('osf')).monto_pen = 3900.00
                and (pg_temp.os('osf')).detraccion_monto = round(1000 * 3.90 * 1.18 * (pg_temp.os('osf')).detraccion_porcentaje / 100, 0),
  format('Contabilidad registra el cambio de hoy y la OS con factura de hoy lo toma, con su detracción (dice %s)', (pg_temp.os('osf')).monto_pen));
select test.afirmar((pg_temp.os('osa')).monto_pen = 3700.00 and (pg_temp.os('osa')).fecha_cambio is null
                and (pg_temp.os('osc')).monto_pen = 3800.00 and (pg_temp.os('osb')).monto_pen = 3650.00,
  'la que no tiene factura sigue como se emitió, y las de otro día no se mueven');
-- Con la detracción depositada, el cambio que llega después tampoco la mueve.
set local session_replication_role = replica;
insert into public.pagos_orden_servicio (orden_servicio_id, fecha_pago, moneda, monto, cancela, destino, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
values (pg_temp.id('osf'), current_date, 'PEN', (pg_temp.os('osf')).detraccion_monto, false, 'DETRACCION', 'prueba/490/detraccion-f.pdf', 'application/pdf', 1000, pg_temp.id('tesoreria'));
set local session_replication_role = origin;
select pg_temp.como('contabilidad');
set local role authenticated;
update public.tipos_de_cambio set venta = 3.95, compra = 3.90 where fecha = pg_temp.hoy();
reset role;
select test.afirmar((pg_temp.os('osf')).monto_pen = 3900.00,
  'depositada su detracción, corregir después el cambio de ese día no la mueve');

-- ============================================ La OS en soles no pide fecha
select set_config('prueba.ruta_p', pg_temp.subir('osp', 'comprador'), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.adjuntar_documento_servicio(pg_temp.id('fp'), pg_temp.id('osp'), 'FACTURA', 'F001-4904', 'factura-p.pdf',
                                          current_setting('prueba.ruta_p'));
reset role;
select test.afirmar((select fecha_emision is null from public.documentos_orden_servicio where id = pg_temp.id('fp'))
                and (pg_temp.os('osp')).fecha_cambio is null and (pg_temp.os('osp')).moneda = 'PEN',
  'la factura de una OS en soles entra sin fecha y no cambia nada');

-- ============================================ Quien no debe
select set_config('prueba.ruta_v', pg_temp.subir('osb', 'vendedor'), true);
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(gen_random_uuid(), %L, ''FACTURA'', ''F001-4909'', ''factura.pdf'', %L, %L::date)',
         pg_temp.id('osb'), current_setting('prueba.ruta_v'), pg_temp.hoy() - 3),
  'Ventas no adjunta la factura con fecha', 'No tienes permiso');
select test.debe_fallar(
  format('select public.adjuntar_documento_servicio(gen_random_uuid(), %L, ''FACTURA'', ''F001-4909'', ''factura.pdf'', %L)',
         pg_temp.id('osb'), current_setting('prueba.ruta_v')),
  'ni por la función de antes', 'No tienes permiso');
select test.afirmar((select count(*) from public.ordenes_servicio where id = pg_temp.id('osb')) = 0,
  'ni lee la orden de servicio');
reset role;
select test.afirmar((pg_temp.os('osb')).monto_pen = 3650.00 and (pg_temp.os('osb')).fecha_cambio = pg_temp.hoy() - 15,
  'y la OS quedó como estaba');

do $$
begin
  perform test.afirmar(not has_function_privilege('authenticated', 'public.cambio_de_la_factura_de_servicio(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.fn_documento_servicio_aplica_cambio()', 'execute')
                   and not has_function_privilege('authenticated', 'public.fn_tipo_de_cambio_alcanza_a_las_facturas()', 'execute')
                   and not has_function_privilege('authenticated', 'public.servicio_con_el_cambio_fijo(uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date)', 'execute')
                   and not has_function_privilege('anon', 'public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text)', 'execute')
                   and not has_table_privilege('authenticated', 'public.ordenes_servicio', 'update'),
    'los ayudantes no los ejecuta nadie con sesión, y nadie escribe el día del cambio por fuera');
end $$;

rollback;
