-- Lo que falta facturar, desde cuándo, y su cobro (migración 20261126210000, Plan 10.1).
--
--   1. `facturacion_en_espera` cuenta la espera desde que la OT tiene código
--      interno: si la unidad lo recibió después de la OT, desde entonces. La lee
--      Contabilidad; Ventas, Almacén y Portería no.
--   2. El recorrido de la cotización facturada en parte espera la factura de lo
--      que falta (con el IGV sumado si la cotización no lo incluía), y deja de
--      esperarla cuando lo facturado alcanza el total. El globo del menú
--      (`facturacion_pendientes`) la cuenta igual.
--   3. El cobro: Tesorería lo tiene desde la factura, «en parte» con un cobro a
--      cuenta, y hecho cuando todas las facturas quedan cobradas, con su puesto.
--   4. El cobro lo ve quien lee los cobros (Contabilidad, Tesorería, Gerencia,
--      Administración); Ventas y la Gerencia Comercial no: para ellos el
--      recorrido termina en la factura. Sin importes en ningún paso.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000472', 'PRUEBAS 472 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA472', 'Taller prueba de lo que falta facturar') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['VENDEDOR', 'GERENTE', 'GERENTE_COMERCIAL', 'ADMINISTRACION', 'CONTABILIDAD', 'TESORERIA', 'ALMACENERO', 'PORTERO'] loop
    v_id := test.crear_usuario(initcap(v), 'Check 472', lower(v) || '.472@prueba.local', v, (select id from public.sedes where codigo = 'QA472'));
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  foreach v in array array['cot1', 'cot2', 'ot1', 'ot2', 'f1', 'f2', 'f3', 'c1', 'c2', 'c3', 'c4'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  -- El archivo de la factura va en la carpeta de la factura; el voucher del cobro, en la de la factura que cobra.
  foreach v in array array['f1:f1', 'f2:f2', 'f3:f3', 'c1:f1', 'c2:f2', 'c3:f1', 'c4:f3'] loop
    perform set_config('prueba.' || split_part(v, ':', 1) || '_ruta',
                       current_setting('prueba.' || split_part(v, ':', 2), true) || '/' || gen_random_uuid() || '.pdf', true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
  perform set_config('prueba.caja', test.crear_caja('PEN')::text, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000472', 'QA CLIENTE POR FACTURAR S.A.C.') returning id::text into v;
  perform set_config('prueba.cliente', v, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.camino(p_cot text) returns text language sql as $$
  select string_agg(paso || ':' || situacion, ' > ' order by orden)
    from public.recorrido_de_cotizaciones(array[current_setting('prueba.' || p_cot)::uuid]);
$$;
create or replace function pg_temp.paso(p_cot text, p_paso text, p_situacion text)
returns table (puesto text, en timestamptz, dias integer, espera text, detalle text) language sql as $$
  select puesto, en, dias, espera, detalle
    from public.recorrido_de_cotizaciones(array[current_setting('prueba.' || p_cot)::uuid])
   where paso = p_paso and situacion = p_situacion
   order by orden desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================ Dos cotizaciones aprobadas con su OT
-- La cot1 sin IGV (10 000 + 18 % = 11 800 con IGV); la cot2 con IGV (5 000).
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['cot1', 'cot2']) c;

select pg_temp.como('vendedor');
set local role authenticated;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
select pg_temp.id(c), 'QA-472-' || right(c, 1), pg_temp.id('cliente'), pg_temp.id('carroceria'),
       'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), m, 'PEN'
  from (values ('cot1', 10000), ('cot2', 5000)) x(c, m);
reset role;
insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por)
values (pg_temp.id('cot1'), 1, false, pg_temp.id('vendedor')), (pg_temp.id('cot2'), 1, true, pg_temp.id('vendedor'))
on conflict (cotizacion_id) do update set incluye_igv = excluded.incluye_igv;

select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id in (pg_temp.id('cot1'), pg_temp.id('cot2'));
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select public.cargar_codigo_y_ot_de_cotizacion(pg_temp.id('cot1'), pg_temp.id('ot1'), 'qa-ci 4721', '9472', 'SEMIRREMOLQUE',
  current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot1') || '/orden.pdf', 'orden.pdf', 100);
select public.cargar_codigo_y_ot_de_cotizacion(pg_temp.id('cot2'), pg_temp.id('ot2'), 'qa-ci 4722', '9473', 'SEMIRREMOLQUE',
  current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot2') || '/orden.pdf', 'orden.pdf', 100);
reset role;

-- ============================================ 1. Desde que la OT tiene código interno
-- La OT de la cot1 se cargó hace 6 días; su unidad recibió el código hace 4
-- (la bitácora lo dice). Espera desde hace 4, no desde la OT. La de la cot2,
-- con OT y código del mismo día, hace 2.
set local session_replication_role = replica;
-- La cotización se subió y se aprobó antes de todo eso.
update public.cotizaciones_pdf set creado_en = now() - interval '8 days', archivo_subido_en = now() - interval '8 days', revisado_en = now() - interval '7 days'
 where id in (pg_temp.id('cot1'), pg_temp.id('cot2'));
update public.ordenes_trabajo set creado_en = now() - interval '6 days' where id = pg_temp.id('ot1');
update public.unidades set creado_en = now() - interval '6 days' where id = (select unidad_id from public.ordenes_trabajo where id = pg_temp.id('ot1'));
update public.audit_log set creado_en = now() - interval '6 days'
 where tabla = 'unidades' and registro_id = (select unidad_id from public.ordenes_trabajo where id = pg_temp.id('ot1'));
insert into public.audit_log (tabla, registro_id, accion, datos_antes, datos_despues, creado_en)
select 'unidades', o.unidad_id, 'UPDATE', jsonb_build_object('codigo_interno', null), jsonb_build_object('codigo_interno', 'QA-CI 4721'), now() - interval '4 days'
  from public.ordenes_trabajo o where o.id = pg_temp.id('ot1');
-- Y la fila de la unidad al crearse, sin código: la bitácora la tiene así.
update public.audit_log set datos_despues = datos_despues - 'codigo_interno'
 where tabla = 'unidades' and accion = 'INSERT'
   and registro_id = (select unidad_id from public.ordenes_trabajo where id = pg_temp.id('ot1'));
update public.ordenes_trabajo set creado_en = now() - interval '2 days' where id = pg_temp.id('ot2');
update public.unidades set creado_en = now() - interval '2 days' where id = (select unidad_id from public.ordenes_trabajo where id = pg_temp.id('ot2'));
update public.audit_log set creado_en = now() - interval '2 days'
 where tabla = 'unidades' and registro_id = (select unidad_id from public.ordenes_trabajo where id = pg_temp.id('ot2'));
set local session_replication_role = origin;

select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from public.facturacion_en_espera(array[pg_temp.id('cot1')]);
  perform test.afirmar(v.dias = 4, format('la cot1 espera desde que su unidad tiene código, hace 4 días (dice %s)', v.dias));
  select * into v from public.facturacion_en_espera(array[pg_temp.id('cot2')]);
  perform test.afirmar(v.dias = 2, format('la cot2, desde su OT con código, hace 2 días (dice %s)', v.dias));
  select * into v from pg_temp.paso('cot1', 'FACTURA', 'AHORA');
  perform test.afirmar(v.puesto = 'Contabilidad' and v.dias = 4 and v.espera = 'FACTURA',
    'el recorrido cuenta lo mismo: la tiene Contabilidad hace 4 días');
  perform test.afirmar(pg_temp.camino('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:AHORA > COBRO:PENDIENTE',
    'sin factura: Contabilidad la tiene y el cobro falta (' || pg_temp.camino('cot1') || ')');
  perform set_config('prueba.globo', (select por_facturar from public.facturacion_pendientes())::text, true);
end $$;
reset role;

-- Quien no lee las cotizaciones aprobadas no lee su espera.
do $$
declare v_puesto text;
begin
  foreach v_puesto in array array['vendedor', 'gerente_comercial', 'almacenero', 'portero'] loop
    perform pg_temp.como(v_puesto);
    set local role authenticated;
    perform test.debe_fallar(format('select * from public.facturacion_en_espera(array[%L::uuid])', current_setting('prueba.cot1')),
      v_puesto || ' no lee la espera de facturación', 'No tienes permiso para ver las cotizaciones aprobadas');
    reset role;
  end loop;
end $$;

-- El ayudante es interno y la espera no se lee sin sesión.
select test.afirmar(not has_function_privilege('authenticated', 'public.codigo_interno_de_cotizacion_desde(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.facturacion_en_espera(uuid[])', 'execute'),
  'el ayudante no lo llama nadie de afuera, y sin sesión no se lee la espera');

-- ============================================ 2. La factura de lo que falta
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'facturas-venta', current_setting('prueba.' || f || '_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['f1', 'f2']) f;

select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  -- La mitad del total con IGV: 5 900 de 11 800.
  perform public.registrar_factura_venta(pg_temp.id('f1'), pg_temp.id('cot1'), 'E001-4721',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'PEN', 5900, 'Inicial 50 %',
    current_setting('prueba.f1_ruta'), 'f.pdf');
  perform test.afirmar(pg_temp.camino('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > FACTURA_RESTO:AHORA > COBRO:AHORA',
    'facturada la mitad: espera la factura del resto y su cobro (' || pg_temp.camino('cot1') || ')');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer,
    'el globo del menú la sigue contando por facturar, como la lista');
  select * into v from pg_temp.paso('cot1', 'FACTURA_RESTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Contabilidad' and v.dias = 4 and v.detalle is null,
    'el resto también espera desde que la OT tiene código, sin decir cuánto');
  select * into v from pg_temp.paso('cot1', 'COBRO', 'AHORA');
  perform test.afirmar(v.puesto = 'Tesorería' and v.dias = 0 and v.espera = 'COBRO' and v.detalle is null,
    'el cobro lo tiene Tesorería desde que se registró la factura');

  -- 10 000 sin IGV no completa: el total con IGV es 11 800.
  perform test.afirmar((select count(*) from public.recorrido_de_cotizaciones(array[pg_temp.id('cot1')]) where paso = 'FACTURA_RESTO') = 1,
    'la cuenta es con el IGV sumado');

  perform public.registrar_factura_venta(pg_temp.id('f2'), pg_temp.id('cot1'), 'E001-4722',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'PEN', 5900, 'Saldo 50 %',
    current_setting('prueba.f2_ruta'), 'f.pdf');
  perform test.afirmar(pg_temp.camino('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:AHORA',
    'facturada entera: ya no espera factura, solo el cobro (' || pg_temp.camino('cot1') || ')');
  perform test.afirmar((select por_facturar from public.facturacion_pendientes()) = current_setting('prueba.globo')::integer - 1,
    'y facturada entera deja de contarla');
end $$;
reset role;

-- ============================================ 3. El cobro
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cobros-venta', current_setting('prueba.' || c || '_ruta'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['c1', 'c2']) c;

select pg_temp.como('tesoreria');
set local role authenticated;
do $$
declare v record;
begin
  -- A cuenta de la primera factura.
  perform public.registrar_cobro_factura(pg_temp.id('c1'), pg_temp.id('f1'), current_setting('prueba.hoy')::date, 2000, false,
    'OP-4721', current_setting('prueba.c1_ruta'), current_setting('prueba.caja')::uuid, null);
  select * into v from pg_temp.paso('cot1', 'COBRO', 'AHORA');
  perform test.afirmar(v.puesto = 'Tesorería' and v.detalle = 'EN_PARTE', 'con un cobro a cuenta, el cobro va en parte');
  perform test.afirmar(pg_temp.camino('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:AHORA',
    'y sigue esperándolo: falta la segunda factura entera (' || pg_temp.camino('cot1') || ')');
end $$;
reset role;

-- Las dos facturas cobradas: la segunda por su total, la primera cancelada con su saldo.
select pg_temp.como('tesoreria');
set local role authenticated;
do $$
declare v record;
begin
  perform public.registrar_cobro_factura(pg_temp.id('c2'), pg_temp.id('f2'), current_setting('prueba.hoy')::date, 5900, true,
    'OP-4722', current_setting('prueba.c2_ruta'), current_setting('prueba.caja')::uuid, null);
  perform test.afirmar((select count(*) from public.recorrido_de_cotizaciones(array[pg_temp.id('cot1')]) where paso = 'COBRO' and situacion = 'AHORA') = 1,
    'con una factura todavía por cobrar, el cobro sigue esperando');
end $$;
reset role;

insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cobros-venta', current_setting('prueba.c3_ruta'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 900}');
select pg_temp.como('tesoreria');
set local role authenticated;
do $$
declare v record;
begin
  perform public.registrar_cobro_factura(pg_temp.id('c3'), pg_temp.id('f1'), current_setting('prueba.hoy')::date, 3900, true,
    'OP-4723', current_setting('prueba.c3_ruta'), current_setting('prueba.caja')::uuid, null);
  perform test.afirmar(pg_temp.camino('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > COBRO:HECHO',
    'cobradas las dos: todo hecho (' || pg_temp.camino('cot1') || ')');
  select * into v from pg_temp.paso('cot1', 'COBRO', 'HECHO');
  perform test.afirmar(v.puesto = 'Tesorería' and v.detalle is null and v.dias is null, 'el cobro, con el puesto de Tesorería');
end $$;
reset role;

-- El adelanto cobrado no es la cotización cobrada: la segunda se factura por la mitad
-- (2 500 de 5 000 con IGV) y Tesorería cancela esa factura. Falta facturar y cobrar el resto.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('facturas-venta', current_setting('prueba.f3_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}');
select pg_temp.como('contabilidad');
set local role authenticated;
select public.registrar_factura_venta(pg_temp.id('f3'), pg_temp.id('cot2'), 'E001-4723',
  current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'PEN', 2500, 'Adelanto 50 %',
  current_setting('prueba.f3_ruta'), 'f.pdf');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cobros-venta', current_setting('prueba.c4_ruta'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 900}');
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_cobro_factura(pg_temp.id('c4'), pg_temp.id('f3'), current_setting('prueba.hoy')::date, 2500, true,
  'OP-4724', current_setting('prueba.c4_ruta'), current_setting('prueba.caja')::uuid, null);
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(pg_temp.camino('cot2') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > FACTURA_RESTO:AHORA > COBRO:PENDIENTE',
  'cobrado el adelanto, el cobro no está hecho: falta facturar y cobrar el resto (' || pg_temp.camino('cot2') || ')');
select test.afirmar((select detalle from pg_temp.paso('cot2', 'FACTURA', 'HECHO')) = 'EN_PARTE',
  'a Contabilidad la factura hecha le dice que fue solo una parte');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(pg_temp.camino('cot2') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO',
  'Ventas, que no lee las facturas, no se entera de que está facturada en parte (' || pg_temp.camino('cot2') || ')');
select test.afirmar((select detalle from pg_temp.paso('cot2', 'FACTURA', 'HECHO')) is null,
  'ni por el detalle de la factura hecha');
reset role;

-- ============================================ 4. El cobro, solo a quien lee los cobros
do $$
declare v_puesto text; v_ve boolean; v_cobros integer;
begin
  foreach v_puesto in array array['vendedor', 'gerente_comercial', 'gerente', 'administracion', 'contabilidad', 'tesoreria'] loop
    perform pg_temp.como(v_puesto);
    set local role authenticated;
    v_ve := (select count(*) from public.cobros_factura_venta where factura_id = pg_temp.id('f1')) > 0;
    v_cobros := (select count(*) from public.recorrido_de_cotizaciones(array[pg_temp.id('cot1'), pg_temp.id('cot2')]) where paso = 'COBRO');
    reset role;
    perform test.afirmar(v_ve = (v_cobros > 0),
      format('%s: ve el paso del cobro solo si lee los cobros (lee cobros: %s; pasos de cobro: %s)', v_puesto, v_ve, v_cobros));
  end loop;
end $$;

select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(pg_temp.camino('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO',
  'para Ventas, el recorrido termina en la factura (' || pg_temp.camino('cot1') || ')');
reset role;

-- Ningún paso lleva un importe ni el nombre de la cuenta.
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(
  not exists (
    select 1 from public.recorrido_de_cotizaciones(array[pg_temp.id('cot1'), pg_temp.id('cot2')]) r
     where concat_ws(' ', r.detalle, r.puesto, r.espera) ~ '11800|5900|3900|2500|2000|10000|E001-47|OP-472|prueba\.local|Check 472'),
  'en ningún paso sale un importe, un número de factura u operación, un correo ni el nombre de la cuenta');
reset role;

rollback;
