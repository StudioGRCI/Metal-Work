-- La factura dice de qué unidad es (migración 20261126998000).
--
-- Una cotización de tres camabajas tiene tres OT y tres códigos. Hasta aquí la
-- factura caía en el código de la OT más nueva. Ahora:
--
--   1. Contabilidad factura una unidad apenas tiene su OT con código, sin
--      esperar a las demás, y la factura queda en el código de ESA unidad.
--   2. La factura de toda la cotización (el anticipo) espera a que estén todas
--      las OT y se reparte en partes iguales que suman su total.
--   3. Lo cobrado y el saldo de cada factura se reparten como su total.
--   4. `facturacion_por_unidad` y el globo del menú cuentan unidad por unidad.
--   5. `codigo_interno_lo_vendido` da lo de la unidad de ese código.
--   6. La cotización de una unidad se porta como antes, también por la función
--      vieja; con varias, la vieja pide recargar.
--   7. El reparto no se corrige ni se borra, y lo lee solo quien lee la factura.
--
-- Cada paso con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000492', 'PRUEBAS 492 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA492', 'Taller prueba de la factura por unidad') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['VENDEDOR', 'GERENTE', 'ADMINISTRACION', 'CONTABILIDAD', 'TESORERIA', 'ALMACENERO'] loop
    v_id := test.crear_usuario(initcap(v), 'Check 492', lower(v) || '.492@prueba.local', v, (select id from public.sedes where codigo = 'QA492'));
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  foreach v in array array['cot3', 'cot1', 'ot1', 'ot2', 'ot3', 'ot3b', 'ots', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'fx', 'fd', 'c1', 'c2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  -- El PDF de cada factura va en su carpeta; el voucher del cobro, en la de la factura que cobra.
  foreach v in array array['f1:f1', 'f2:f2', 'f3:f3', 'f4:f4', 'f5:f5', 'f6:f6', 'f7:f7', 'fx:fx', 'c1:f2', 'c2:f2'] loop
    perform set_config('prueba.' || split_part(v, ':', 1) || '_ruta',
                       current_setting('prueba.' || split_part(v, ':', 2), true) || '/' || gen_random_uuid() || '.pdf', true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
  perform set_config('prueba.caja', test.crear_caja('PEN')::text, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000492', 'QA CLIENTE DE TRES CAMABAJAS S.A.C.') returning id::text into v;
  perform set_config('prueba.cliente', v, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- Administración carga la OT de una unidad, con su PDF ya subido.
create or replace function pg_temp.cargar(p_cot text, p_ot text, p_codigo text, p_numero text) returns uuid language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', 'ot/' || current_setting('prueba.' || p_ot) || '/orden.pdf', current_setting('prueba.administracion'),
          '{"mimetype": "application/pdf", "size": 100}');
  return public.cargar_codigo_y_ot_de_cotizacion(
    pg_temp.id(p_cot), pg_temp.id(p_ot), p_codigo, p_numero, 'SEMIRREMOLQUE',
    current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.' || p_ot) || '/orden.pdf', 'orden.pdf', 100);
end $$;
-- Contabilidad registra una factura en soles: p_unidad = 0 es toda la cotización.
create or replace function pg_temp.facturar(p_f text, p_cot text, p_numero text, p_total numeric, p_unidad integer, p_moneda text default 'PEN')
returns uuid language sql as $$
  select public.registrar_factura_venta_de_unidad(pg_temp.id(p_f), pg_temp.id(p_cot), p_numero,
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, p_moneda, p_total, null,
    current_setting('prueba.' || p_f || '_ruta'), 'f.pdf', p_unidad);
$$;
-- La llamada anterior, como texto, para probar que falla.
create or replace function pg_temp.facturar_sql(p_f text, p_cot text, p_numero text, p_total numeric, p_unidad text) returns text language sql as $$
  select format('select public.registrar_factura_venta_de_unidad(%L, %L, %L, %L::date, %L::date + 30, ''PEN'', %s, null, %L, ''f.pdf'', %s)',
    current_setting('prueba.' || p_f), current_setting('prueba.' || p_cot), p_numero, current_setting('prueba.hoy'),
    current_setting('prueba.hoy'), p_total, current_setting('prueba.' || p_f || '_ruta'), p_unidad);
$$;
-- Las partes de una factura: «unidad:código:monto» por unidad.
create or replace function pg_temp.partes(p_f text) returns text language sql as $$
  select string_agg(p.numero_de_unidad || ':' || p.codigo_interno || ':' || p.monto, ' | ' order by p.numero_de_unidad)
    from public.facturas_venta_unidades p where p.factura_id = pg_temp.id(p_f);
$$;
-- Una unidad de la bandeja de Contabilidad.
create or replace function pg_temp.unidad(p_cot text, p_unidad integer)
returns table (unidades integer, codigo_interno text, desde timestamptz, dias integer, parte numeric, facturas integer,
               facturado numeric, cobrado numeric, facturado_otra_moneda numeric, cobrado_otra_moneda numeric) language sql as $$
  select u.unidades, u.codigo_interno, u.desde, u.dias, u.parte, u.facturas, u.facturado, u.cobrado, u.facturado_otra_moneda, u.cobrado_otra_moneda
    from public.facturacion_por_unidad(array[pg_temp.id(p_cot)]) u where u.numero_de_unidad = p_unidad;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================ 0. Las partes suman el total
select test.afirmar(
  (select bool_and((select sum(public.parte_de_unidad(t, n, k)) from generate_series(1, n) k) = t)
     from (values (100.00, 3), (0.05, 3), (35400.00, 3), (10000.00, 7), (999999999.00, 50), (1.00, 1)) x(t, n))
  and public.parte_de_unidad(100.00, 3, 1) = 33.33 and public.parte_de_unidad(100.00, 3, 2) = 33.34
  and public.parte_de_unidad(100.00, 3, 3) = 33.33
  and public.parte_de_unidad(100.00, 3, 4) is null and public.parte_de_unidad(null, 3, 1) is null,
  'las partes de un total suman el total, con cualquier cantidad de unidades');
select test.afirmar(not has_function_privilege('authenticated', 'public.parte_de_unidad(numeric, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.codigo_interno_de_ot_desde(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.facturacion_por_unidad(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer)', 'execute'),
  'los ayudantes no se llaman de afuera, y sin sesión no se factura ni se lee lo que falta');

-- ============================================ Una cotización de tres unidades y otra de una
-- La de tres, sin IGV: 30 000 + 18 % = 35 400 con IGV, 11 800 por unidad. La de una, 9 000 con IGV.
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['cot3', 'cot1']) c;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'facturas-venta', current_setting('prueba.' || f || '_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'fx']) f;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cobros-venta', current_setting('prueba.' || c || '_ruta'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['c1', 'c2']) c;

select pg_temp.como('vendedor');
set local role authenticated;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
select pg_temp.id(c), 'QA-492-' || right(c, 1), pg_temp.id('cliente'), pg_temp.id('carroceria'),
       'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), m, 'PEN', n
  from (values ('cot3', 30000, 3), ('cot1', 9000, 1)) x(c, m, n);
reset role;
insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por)
values (pg_temp.id('cot3'), 1, false, pg_temp.id('vendedor')), (pg_temp.id('cot1'), 1, true, pg_temp.id('vendedor'))
on conflict (cotizacion_id) do update set incluye_igv = excluded.incluye_igv;

select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id in (pg_temp.id('cot3'), pg_temp.id('cot1'));
reset role;

-- ============================================ 1. Sin OT no se factura ninguna unidad
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  perform set_config('prueba.globo', (select por_facturar from public.facturacion_pendientes())::text, true);
  perform test.debe_fallar(pg_temp.facturar_sql('f1', 'cot3', 'E001-4921', 5000, '1'),
    'la unidad sin OT no se factura', 'La unidad 1 de la cotización QA-492-3 todavía no tiene su OT');
  perform test.debe_fallar(pg_temp.facturar_sql('f1', 'cot3', 'E001-4921', 5000, '0'),
    'ni toda la cotización, sin ninguna OT', 'tiene 0 de sus 3 OT');
  select count(*) as filas, count(u.codigo_interno) as con_codigo, min(u.parte) as parte, sum(u.parte) as total, max(u.unidades) as unidades
    into v from public.facturacion_por_unidad(array[pg_temp.id('cot3')]) u;
  perform test.afirmar(v.filas = 3 and v.con_codigo = 0 and v.unidades = 3 and v.parte = 11800 and v.total = 35400,
    format('la bandeja trae las tres unidades, sin código todavía, con 11 800 cada una (dice %s filas, %s y %s)', v.filas, v.parte, v.total));
end $$;
reset role;

-- ============================================ 2. La unidad se factura apenas tiene su OT
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot3', 'ot1', 'qa-492 u1', '94921');
select pg_temp.cargar('cot3', 'ot2', 'qa-492 u2', '94922');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.unidad('cot3', 2);
  perform test.afirmar(v.codigo_interno = 'QA-492 U2' and v.desde is not null and v.dias = 0 and v.facturas = 0,
    'la unidad 2 ya tiene su código y espera desde hoy');
  select * into v from pg_temp.unidad('cot3', 3);
  perform test.afirmar(v.codigo_interno is null and v.desde is null and v.dias is null,
    'la unidad 3 sigue sin OT: sin código y sin espera');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 2,
    'el globo cuenta las dos unidades que ya tienen su OT, no la cotización');

  -- La 2 primero: no espera a la 1 ni a la 3, y cae en SU código (la OT más nueva es la suya, pero se probará también con la 1).
  perform pg_temp.facturar('f1', 'cot3', 'E001-4921', 5000, 2);
  perform test.afirmar((select codigo_interno from public.facturas_venta where id = pg_temp.id('f1')) = 'QA-492 U2'
    and pg_temp.partes('f1') = '2:QA-492 U2:5000.00',
    'la factura de la unidad 2 queda en el código de la unidad 2, entera (' || pg_temp.partes('f1') || ')');
  -- El mismo envío repetido no registra otra ni otro reparto.
  perform test.afirmar(pg_temp.facturar('f1', 'cot3', 'E001-4921', 5000, 2) = pg_temp.id('f1')
    and (select count(*) from public.facturas_venta_unidades where factura_id = pg_temp.id('f1')) = 1,
    'el mismo envío repetido devuelve la misma factura, con su única parte');

  perform test.debe_fallar(pg_temp.facturar_sql('f2', 'cot3', 'E001-4922', 5000, '3'),
    'la unidad 3 todavía no', 'La unidad 3 de la cotización QA-492-3 todavía no tiene su OT');
  perform test.debe_fallar(pg_temp.facturar_sql('f2', 'cot3', 'E001-4922', 5000, '0'),
    'toda la cotización espera a la última OT', 'tiene 2 de sus 3 OT');
  perform test.debe_fallar(pg_temp.facturar_sql('f2', 'cot3', 'E001-4922', 5000, '4'),
    'no hay unidad 4', 'la unidad 4 no existe');
  perform test.debe_fallar(pg_temp.facturar_sql('f2', 'cot3', 'E001-4922', 5000, 'null'),
    'con varias unidades hay que decir cuál', 'elige de cuál es la factura');
  -- La función de antes no sabe de cuál es.
  perform test.debe_fallar(format('select public.registrar_factura_venta(%L, %L, ''E001-4922'', %L::date, %L::date, ''PEN'', 5000, null, %L, ''f.pdf'')',
    current_setting('prueba.f2'), current_setting('prueba.cot3'), current_setting('prueba.hoy'), current_setting('prueba.hoy'), current_setting('prueba.f2_ruta')),
    'la pestaña de antes del despliegue no factura una de varias unidades', 'recarga la pantalla');

  select * into v from pg_temp.unidad('cot3', 2);
  perform test.afirmar(v.facturas = 1 and v.facturado = 5000 and v.cobrado = 0, 'la bandeja le cuenta a la unidad 2 sus 5 000');
  select * into v from pg_temp.unidad('cot3', 1);
  perform test.afirmar(v.facturas = 0 and v.facturado = 0, 'y a la unidad 1, nada');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 2,
    'facturada en parte, la unidad 2 sigue contando');
end $$;
reset role;

-- ============================================ 3. La factura de toda la cotización
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot3', 'ot3', 'qa-492 u3', '94923');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  -- El anticipo de las tres: 10 000 en tres partes que suman 10 000.
  perform pg_temp.facturar('f2', 'cot3', 'E001-4922', 10000, 0);
  perform test.afirmar(pg_temp.partes('f2') = '1:QA-492 U1:3333.33 | 2:QA-492 U2:3333.34 | 3:QA-492 U3:3333.33',
    'el anticipo se reparte entre los tres códigos y suma su total (' || pg_temp.partes('f2') || ')');
  perform test.afirmar((select codigo_interno from public.facturas_venta where id = pg_temp.id('f2')) = 'QA-492 U1',
    'la factura de toda la cotización lleva el código de su primera unidad');
  select unidades_cubiertas, numero_de_unidad, unidades_de_la_cotizacion into v from public.v_facturas_venta where id = pg_temp.id('f2');
  perform test.afirmar(v.unidades_cubiertas = 3 and v.numero_de_unidad is null and v.unidades_de_la_cotizacion = 3,
    'la vista dice que cubre las tres');
  select unidades_cubiertas, numero_de_unidad, unidades_de_la_cotizacion into v from public.v_facturas_venta where id = pg_temp.id('f1');
  perform test.afirmar(v.unidades_cubiertas = 1 and v.numero_de_unidad = 2 and v.unidades_de_la_cotizacion = 3,
    'y de la otra, que es de la unidad 2 de 3');
  perform test.debe_fallar(pg_temp.facturar_sql('fx', 'cot3', 'E001-4929', 0.02, '0'),
    'dos céntimos no se reparten entre tres', 'no alcanza para repartirlo');

  select * into v from pg_temp.unidad('cot3', 2);
  perform test.afirmar(v.facturas = 2 and v.facturado = 8333.34, format('la unidad 2 lleva su factura y su parte del anticipo (dice %s)', v.facturado));
  select * into v from pg_temp.unidad('cot3', 1);
  perform test.afirmar(v.facturas = 1 and v.facturado = 3333.33, 'la unidad 1, solo su parte del anticipo');
  perform test.afirmar((select sum(u.facturado) from public.facturacion_por_unidad(array[pg_temp.id('cot3')]) u) = 15000,
    'las tres unidades suman lo facturado de la cotización');
  perform test.afirmar((select c.facturado from public.cotizaciones_para_facturar() c where c.cotizacion_id = pg_temp.id('cot3')) = 15000,
    'que es lo mismo que dice la cotización entera');
end $$;
reset role;

-- ============================================ 4. Lo cobrado se reparte igual
select pg_temp.como('tesoreria');
set local role authenticated;
do $$
declare v record;
begin
  perform public.registrar_cobro_factura(pg_temp.id('c1'), pg_temp.id('f2'), current_setting('prueba.hoy')::date, 1000, false,
    'OP-4921', current_setting('prueba.c1_ruta'), current_setting('prueba.caja')::uuid, null);
  select string_agg(p.numero_de_unidad || ':' || p.codigo_interno || ':' || p.cobrado || ':' || p.saldo, ' | ' order by p.numero_de_unidad) as partes,
         sum(p.cobrado) as cobrado, sum(p.saldo) as saldo
    into v from public.v_facturas_venta_por_unidad p where p.factura_id = pg_temp.id('f2');
  perform test.afirmar(v.partes = '1:QA-492 U1:333.33:3000.00 | 2:QA-492 U2:333.34:3000.00 | 3:QA-492 U3:333.33:3000.00'
    and v.cobrado = 1000 and v.saldo = 9000,
    'Tesorería ve el cobro a cuenta repartido entre los tres códigos (' || v.partes || ')');
  perform test.afirmar((select sum(p.saldo) from public.v_facturas_venta_por_unidad p
                         where p.codigo_interno = 'QA-492 U2' and p.anulada_en is null) = 8000,
    'al código de la unidad 2 le falta cobrar su factura entera y su parte del anticipo');
  -- Cancelada con menos que el total (detracción): no queda saldo en ninguna parte.
  perform public.registrar_cobro_factura(pg_temp.id('c2'), pg_temp.id('f2'), current_setting('prueba.hoy')::date, 8000, true,
    'OP-4922', current_setting('prueba.c2_ruta'), current_setting('prueba.caja')::uuid, null);
  select sum(p.cobrado) as cobrado, sum(p.saldo) as saldo, bool_and(p.cancelada) as cancelada
    into v from public.v_facturas_venta_por_unidad p where p.factura_id = pg_temp.id('f2');
  perform test.afirmar(v.cobrado = 9000 and v.saldo = 0 and v.cancelada, 'cancelada la factura, ninguna de sus partes tiene saldo');
end $$;
reset role;

-- ============================================ 5. Lo vendido de cada código es lo de su unidad
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  select count(*) as filas, min(l.monto_venta) as monto, bool_and(l.incluye_igv) as con_igv, min(l.facturas) as facturas,
         min(l.facturado_en_su_moneda) as facturado
    into v from public.codigo_interno_lo_vendido('qa-492 u1') l;
  perform test.afirmar(v.filas = 1 and v.monto = 11800 and v.con_igv and v.facturas = 1 and v.facturado = 3333.33,
    format('el código de la unidad 1 tiene su cotización, con su parte de la venta y de lo facturado (dice %s filas, %s y %s)', v.filas, v.monto, v.facturado));
  select count(*) as filas, min(l.monto_venta) as monto, min(l.facturas) as facturas, min(l.facturado_en_su_moneda) as facturado
    into v from public.codigo_interno_lo_vendido('QA-492 U2') l;
  perform test.afirmar(v.filas = 1 and v.monto = 11800 and v.facturas = 2 and v.facturado = 8333.34,
    'el de la unidad 2, la suya');
  select * into v from pg_temp.unidad('cot3', 2);
  perform test.afirmar(v.cobrado = 3000.00, format('y lo cobrado de la unidad 2 es su parte del anticipo (dice %s)', v.cobrado));

  -- La unidad 1 completa lo suyo: 11 800 - 3 333.33 = 8 466.67. Deja de contar; las otras dos siguen.
  perform pg_temp.facturar('f3', 'cot3', 'E001-4923', 8466.67, 1);
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 2,
    'facturada entera la unidad 1, quedan por facturar la 2 y la 3');
  -- Una factura en dólares de una cotización en soles no se compara: la unidad 3 deja de contar y lo dice aparte.
  perform pg_temp.facturar('f4', 'cot3', 'E001-4924', 500, 3, 'USD');
  select * into v from pg_temp.unidad('cot3', 3);
  perform test.afirmar(v.facturado = 3333.33 and v.facturado_otra_moneda = 500 and v.facturas = 2,
    'la factura en dólares de la unidad 3 va aparte, sin sumarse');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 1,
    'y con una factura en otra moneda, la unidad 3 ya no se cuenta por facturar');
end $$;
reset role;

-- ============================================ 6. La cotización de una unidad, como antes
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot1', 'ots', 'qa-492 sola', '94929');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 2,
    'la de una unidad cuenta una vez');
  select * into v from pg_temp.unidad('cot1', 1);
  perform test.afirmar(v.unidades = 1 and v.codigo_interno = 'QA-492 SOLA' and v.parte = 9000, 'su única unidad lleva el total');
  perform test.debe_fallar(pg_temp.facturar_sql('f5', 'cot1', 'E001-4925', 4000, '2'),
    'la de una unidad no tiene unidad 2', 'tiene una sola unidad');
  -- Por la función de antes, como la llama la pestaña que quedó abierta.
  perform public.registrar_factura_venta(pg_temp.id('f5'), pg_temp.id('cot1'), 'E001-4925',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 4000, 'Inicial',
    current_setting('prueba.f5_ruta'), 'f.pdf');
  perform test.afirmar(pg_temp.partes('f5') = '1:QA-492 SOLA:4000.00', 'la función de antes registra la de una unidad con su parte');
  -- Y por la nueva, «toda la cotización» de una unidad es su unidad.
  perform pg_temp.facturar('f6', 'cot1', 'E001-4926', 5000, 0);
  perform test.afirmar(pg_temp.partes('f6') = '1:QA-492 SOLA:5000.00', 'toda la cotización de una unidad es su unidad');
  select unidades_cubiertas, numero_de_unidad, unidades_de_la_cotizacion into v from public.v_facturas_venta where id = pg_temp.id('f6');
  perform test.afirmar(v.unidades_cubiertas = 1 and v.numero_de_unidad = 1 and v.unidades_de_la_cotizacion = 1, 'la vista la da como siempre');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 1,
    'facturada entera, deja de contar');
  select l.monto_venta, l.incluye_igv, l.facturas, l.facturado_en_su_moneda into v from public.codigo_interno_lo_vendido('QA-492 SOLA') l;
  perform test.afirmar(v.monto_venta = 9000 and v.incluye_igv and v.facturas = 2 and v.facturado_en_su_moneda = 9000,
    'lo vendido de su código sale como antes');

  -- Anulada, la factura deja de contar y su reparto queda como evidencia.
  perform public.anular_factura_venta(pg_temp.id('f6'), 'Se registró con el total equivocado.');
  select * into v from pg_temp.unidad('cot1', 1);
  perform test.afirmar(v.facturas = 1 and v.facturado = 4000 and pg_temp.partes('f6') = '1:QA-492 SOLA:5000.00',
    'anulada, no suma, y su reparto sigue a la vista');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer + 2,
    'y la unidad vuelve a contar por facturar');
end $$;
reset role;

-- ============================================ 7. El reparto no se toca y lo lee quien lee la factura
select test.debe_fallar(format('update public.facturas_venta_unidades set monto = 1 where factura_id = %L', current_setting('prueba.f1')),
  'el reparto no se corrige ni desde la base', 'no se corrige');
select test.debe_fallar(format('delete from public.facturas_venta_unidades where factura_id = %L', current_setting('prueba.f1')),
  'ni se borra', 'no se borra');
select test.afirmar(not exists (select 1 from public.facturas_venta f
                                 where f.total <> (select coalesce(sum(p.monto), 0) from public.facturas_venta_unidades p where p.factura_id = f.id)),
  'toda factura tiene su reparto, y suma su total');

do $$
declare v_puesto text; v integer;
begin
  -- Contabilidad no escribe el reparto por la API: entra solo con la factura.
  perform pg_temp.como('contabilidad');
  set local role authenticated;
  perform test.debe_fallar(format('insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto) values (%L, 1, 3, ''QA-492 U1'', 10)',
    current_setting('prueba.f1')), 'el reparto no se escribe por la API', 'permission denied');
  reset role;

  -- Tesorería lee el reparto de lo que cobra.
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  select count(*) into v from public.facturas_venta_unidades where factura_id = pg_temp.id('f2');
  perform test.afirmar(v = 3, 'Tesorería lee las partes de la factura que cobra');
  -- Y lo de cada unidad, con la misma puerta que las cotizaciones aprobadas (las lee para saber qué viene por cobrar).
  select count(*) into v from public.facturacion_por_unidad(array[pg_temp.id('cot3')]);
  perform test.afirmar(v = 3, 'y lo facturado de cada unidad, como lee las cotizaciones aprobadas');
  perform test.debe_fallar(pg_temp.facturar_sql('f7', 'cot3', 'E001-4927', 100, '1'), 'pero no factura', 'permiso');
  reset role;

  -- Ventas y Almacén no ven facturas: tampoco su reparto ni lo que falta facturar.
  foreach v_puesto in array array['vendedor', 'almacenero'] loop
    perform pg_temp.como(v_puesto);
    set local role authenticated;
    select count(*) into v from public.facturas_venta_unidades;
    perform test.afirmar(v = 0, v_puesto || ' no lee el reparto de ninguna factura');
    select count(*) into v from public.v_facturas_venta_por_unidad;
    perform test.afirmar(v = 0, v_puesto || ' tampoco por la vista');
    perform test.debe_fallar(format('select * from public.facturacion_por_unidad(array[%L::uuid])', current_setting('prueba.cot3')),
      v_puesto || ' no lee lo que falta facturar', 'No tienes permiso para ver las cotizaciones aprobadas');
    perform test.debe_fallar(pg_temp.facturar_sql('f7', 'cot3', 'E001-4927', 100, '1'), v_puesto || ' no factura');
    reset role;
  end loop;
end $$;

-- La factura que entra sin pasar por la función (una carga, la siembra de una
-- prueba) no queda sin unidad: recibe su única parte, la de la OT que lleva su código.
insert into public.facturas_venta (id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision, fecha_vencimiento,
                                   moneda, total, ruta_storage, nombre_archivo, tamano_bytes)
select pg_temp.id('fd'), 'QA-492 U3', c.id, c.numero, 'CLIENTE DEL CHECK 492 S.A.C.', 'E001-4929', current_date, current_date + 30,
       'PEN', 250, 'f/E001-4929.pdf', 'E001-4929.pdf', 1024
  from public.cotizaciones_pdf c where c.id = pg_temp.id('cot3');
select test.afirmar(pg_temp.partes('fd') = '3:QA-492 U3:250.00',
  'la factura que entra directo a la tabla nace con su parte, en la unidad de su código (' || coalesce(pg_temp.partes('fd'), 'sin parte') || ')');
select test.afirmar((select unidades_cubiertas = 1 and numero_de_unidad = 3 and unidades_de_la_cotizacion = 3 from public.v_facturas_venta where id = pg_temp.id('fd')),
  'y la vista dice que es de la unidad 3 de 3');

-- ============================================ 8. La OT se anula y se carga otra con otro código
-- La unidad 3 ya tiene facturas (su parte del anticipo y la que entró directo).
-- Su OT se anula y Administración carga otra con otro código: la unidad es la
-- misma venta, y lo facturado se lee en el código que tiene hoy. Con dos llaves
-- (el número de unidad y el código guardado), la ficha del código nuevo decía
-- «facturado» y «sin facturas» a la vez (auditoría de funcionamiento, 26/11).
do $$
begin
  set local session_replication_role = replica;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se cargó con el código equivocado' where id = pg_temp.id('ot3');
  set local session_replication_role = origin;
end $$;
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot3', 'ot3b', 'qa-492 u3b', '94933');
reset role;

select pg_temp.como('tesoreria');
set local role authenticated;
do $$
declare v record; v_por_codigo numeric;
begin
  select * into v from pg_temp.unidad('cot3', 3);
  perform test.afirmar(v.codigo_interno = 'QA-492 U3B' and v.facturas > 0,
    'la OT nueva es la unidad 3, con su código nuevo y las facturas que ya tenía (' || v.codigo_interno || ', ' || v.facturas || ')');
  select coalesce(sum(p.monto), 0) into v_por_codigo
    from public.v_facturas_venta_por_unidad p
   where p.codigo_interno = 'QA-492 U3B' and p.anulada_en is null and p.moneda = 'PEN';
  perform test.afirmar(v_por_codigo = v.facturado and v.facturado > 0,
    'lo facturado del código nuevo es lo de su unidad: por código ' || v_por_codigo || ', por unidad ' || v.facturado);
  perform test.afirmar(not exists (select 1 from public.v_facturas_venta_por_unidad p where p.codigo_interno = 'QA-492 U3'),
    'y el código de la OT anulada ya no lleva facturas');
  perform test.afirmar((select bool_and(p.codigo_al_facturar = 'QA-492 U3') from public.v_facturas_venta_por_unidad p
                         where p.codigo_interno = 'QA-492 U3B'),
    'el código que tenía al facturar queda guardado');
  perform test.afirmar((select l.facturado_en_su_moneda from public.codigo_interno_lo_vendido('QA-492 U3B') l) = v.facturado,
    'la cabecera del código nuevo dice lo mismo');
end $$;
reset role;

-- Quien no ve facturas no saca por esta puerta el código de una unidad.
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(public.codigo_de_la_unidad_de_cotizacion(pg_temp.id('cot3'), 3) is null,
  'el almacenero no lee el código de la unidad por la función de las facturas');
reset role;

-- El número repetido de una factura por toda la cotización nombra la cotización, no un solo código.
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar(pg_temp.facturar_sql('f7', 'cot3', 'E001-4922', 100, '1'),
  'el número de la factura por toda la cotización no se repite, y lo dice por su cotización', 'ya está registrada en la cotización QA-492-3, por todas sus unidades');
reset role;

-- La bitácora no guarda copia del reparto: se leería con solo `auditoria.ver`.
select test.afirmar(not exists (select 1 from public.audit_log where tabla = 'facturas_venta_unidades'),
  'el reparto no va a la bitácora genérica');

rollback;
