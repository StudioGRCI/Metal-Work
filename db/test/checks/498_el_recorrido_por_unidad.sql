-- El recorrido de la cotización, unidad por unidad (migración 20261126998800).
--
-- Una cotización de tres camabajas tiene tres OT, y cada factura dice de qué
-- unidad es. El recorrido la contaba como una sola cosa. Ahora:
--
--   1. Mientras nadie hizo nada con ella, lo que falta se dice una vez.
--   2. Aprobada, cada unidad tiene su OT, su factura y su cobro: quién lo hizo
--      o quién lo tiene. La unidad con su OT pasa a Contabilidad sin esperar a
--      las otras; una puede estar cobrada y otra sin OT.
--   3. La factura por toda la cotización cuenta en cada unidad, y su cobro.
--   4. La unidad facturada que se quedó sin OT no pierde de vista lo que le falta.
--   5. Quién ve qué no cambia: Ventas, sin «en parte» ni el cobro.
--   6. La cotización de una unidad da los pasos de siempre, sin unidad.
--   7. La ficha del código encuentra su cotización en cualquier unidad, y dice cuál.
--   8. La cotización con una factura vigente no cambia su cantidad de unidades.
--   9. La unidad que perdió su OT espera desde esa anulación, no desde la
--      aprobación: los días que Administración no la tuvo no se le cuentan.
--  10. El número de la OT de cada unidad, solo a quien lee las órdenes.
--  11. Anulada la cotización, la anulación cuenta sus días desde lo último que
--      se hizo en cualquier unidad, y ya no espera a nadie.
--
-- Cada paso con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000498', 'PRUEBAS 498 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA498', 'Taller prueba del recorrido por unidad') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['VENDEDOR', 'GERENTE', 'ADMINISTRACION', 'CONTABILIDAD', 'TESORERIA', 'ALMACENERO'] loop
    v_id := test.crear_usuario(initcap(v), 'Check 498', lower(v) || '.498@prueba.local', v, (select id from public.sedes where codigo = 'QA498'));
    perform set_config('prueba.' || lower(v), v_id::text, true);
  end loop;
  foreach v in array array['cot3', 'cot1', 'cotp', 'ot1', 'ot2', 'ot3', 'ots', 'f1', 'f2', 'f3', 'fs', 'c1', 'c2', 'c3', 'c4'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  -- El PDF de cada factura va en su carpeta; el voucher del cobro, en la de la factura que cobra.
  foreach v in array array['f1:f1', 'f2:f2', 'f3:f3', 'fs:fs', 'c1:f1', 'c2:f2', 'c3:f2', 'c4:f3'] loop
    perform set_config('prueba.' || split_part(v, ':', 1) || '_ruta',
                       current_setting('prueba.' || split_part(v, ':', 2), true) || '/' || gen_random_uuid() || '.pdf', true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.anio', to_char((now() at time zone 'America/Lima')::date, 'YYYY'), true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
  perform set_config('prueba.caja', test.crear_caja('PEN')::text, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000498', 'QA CLIENTE DEL RECORRIDO POR UNIDAD S.A.C.') returning id::text into v;
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
create or replace function pg_temp.facturar(p_f text, p_cot text, p_numero text, p_total numeric, p_unidad integer)
returns uuid language sql as $$
  select public.registrar_factura_venta_de_unidad(pg_temp.id(p_f), pg_temp.id(p_cot), p_numero,
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date + 30, 'PEN', p_total, null,
    current_setting('prueba.' || p_f || '_ruta'), 'f.pdf', p_unidad);
$$;
-- Tesorería cobra una factura.
create or replace function pg_temp.cobrar(p_c text, p_f text, p_monto numeric, p_cancela boolean) returns void language plpgsql as $$
begin
  perform public.registrar_cobro_factura(pg_temp.id(p_c), pg_temp.id(p_f), current_setting('prueba.hoy')::date, p_monto, p_cancela,
    'OP-' || left(current_setting('prueba.' || p_c), 6), current_setting('prueba.' || p_c || '_ruta'), current_setting('prueba.caja')::uuid, null);
end $$;
-- El recorrido como lo lee un puesto, con su rol real. Cada paso: «unidad·PASO:SITUACIÓN»,
-- con quién lo tiene si espera y con su detalle. `p_unidad` 0 es todo; -1, solo lo
-- de toda la cotización; otro número, solo esa unidad (sin el prefijo).
create or replace function pg_temp.camino(p_quien text, p_cot text, p_unidad integer default 0) returns text
language plpgsql as $$
declare v text;
begin
  reset role;
  perform pg_temp.como(p_quien);
  set local role authenticated;
  select string_agg(
           case when p_unidad = 0 then coalesce(r.unidad || '·', '') else '' end
           || r.paso || ':' || r.situacion
           || case when r.situacion = 'AHORA' then coalesce(':' || r.puesto, '') else '' end
           || coalesce(':' || r.detalle, ''), ' > ' order by r.orden)
    into v
    from public.recorrido_de_cotizaciones(array[pg_temp.id(p_cot)]) r
   where r.paso in ('CODIGO_Y_OT', 'OTRO_COMPRADOR', 'FACTURA', 'FACTURA_RESTO', 'COBRO')
     and (p_unidad = 0 or (p_unidad = -1 and r.unidad is null) or r.unidad = p_unidad);
  reset role;
  return coalesce(v, 'nada');
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================ 0. Las puertas
select test.afirmar(
  pg_get_function_result('public.recorrido_de_cotizaciones(uuid[])'::regprocedure) =
    'TABLE(documento uuid, orden integer, paso text, situacion text, puesto text, en timestamp with time zone, dias integer, espera text, detalle text, unidad integer, unidades integer)',
  'el recorrido suma la unidad y cuántas son: ni un monto ni un nombre');
select test.afirmar(
  not has_function_privilege('anon', 'public.recorrido_de_cotizaciones(uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.recorrido_de_cotizaciones(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.codigo_interno_recorrido(text)', 'execute')
  and has_function_privilege('authenticated', 'public.codigo_interno_recorrido(text)', 'execute'),
  'sin sesión no se lee ningún recorrido');
select test.afirmar(
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public'])
     from pg_proc p where p.proname in ('recorrido_de_cotizaciones', 'codigo_interno_recorrido')),
  'las dos funciones llevan su search_path');

-- ============================================ Tres cotizaciones: dos de tres unidades y una de una
-- La de tres, sin IGV: 30 000 + 18 % = 35 400 con IGV, 11 800 por unidad. La de una, 9 000 con IGV.
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['cot3', 'cot1', 'cotp']) c;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'facturas-venta', current_setting('prueba.' || f || '_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['f1', 'f2', 'f3', 'fs']) f;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cobros-venta', current_setting('prueba.' || c || '_ruta'), current_setting('prueba.tesoreria'), '{"mimetype": "application/pdf", "size": 900}'::jsonb
  from unnest(array['c1', 'c2', 'c3', 'c4']) c;

select pg_temp.como('vendedor');
set local role authenticated;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
select pg_temp.id(c), 'QA-498-' || upper(right(c, 1)), pg_temp.id('cliente'), pg_temp.id('carroceria'),
       'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), m, 'PEN', n
  from (values ('cot3', 30000, 3), ('cot1', 9000, 1), ('cotp', 30000, 3)) x(c, m, n);
reset role;
insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por)
values (pg_temp.id('cot3'), 1, false, pg_temp.id('vendedor')), (pg_temp.id('cot1'), 1, true, pg_temp.id('vendedor')),
       (pg_temp.id('cotp'), 1, false, pg_temp.id('vendedor'))
on conflict (cotizacion_id) do update set incluye_igv = excluded.incluye_igv;

-- ============================================ 1. Sin aprobar y sin nada: lo que falta se dice una vez
select test.afirmar(pg_temp.camino('vendedor', 'cotp') = 'CODIGO_Y_OT:PENDIENTE > FACTURA:PENDIENTE',
  'la de tres unidades que Gerencia todavía no revisa dice lo que falta una sola vez (' || pg_temp.camino('vendedor', 'cotp') || ')');

select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id in (pg_temp.id('cot3'), pg_temp.id('cot1'));
reset role;

-- ============================================ 2. Aprobada: cada unidad con lo suyo
select test.afirmar(pg_temp.camino('vendedor', 'cot3') =
    '1·CODIGO_Y_OT:AHORA:Administración > 1·FACTURA:PENDIENTE'
    || ' > 2·CODIGO_Y_OT:AHORA:Administración > 2·FACTURA:PENDIENTE'
    || ' > 3·CODIGO_Y_OT:AHORA:Administración > 3·FACTURA:PENDIENTE',
  'aprobada, Ventas ve cada unidad esperando su OT, sin el cobro (' || pg_temp.camino('vendedor', 'cot3') || ')');
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 2) = 'CODIGO_Y_OT:AHORA:Administración > FACTURA:PENDIENTE > COBRO:PENDIENTE',
  'Contabilidad ve además el cobro que falta de cada unidad (' || pg_temp.camino('contabilidad', 'cot3', 2) || ')');
select test.afirmar(pg_temp.camino('vendedor', 'cot1') = 'CODIGO_Y_OT:AHORA:Administración > FACTURA:PENDIENTE',
  'la de una unidad, como siempre y sin unidad (' || pg_temp.camino('vendedor', 'cot1') || ')');

-- Los pasos de toda la cotización no llevan unidad; los de cada unidad dicen cuántas
-- son, van después y en orden; y el orden no se repite.
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  select count(*) filter (where r.unidad is null) as de_toda,
         bool_and(r.unidades is null) filter (where r.unidad is null) as sin_cuantas,
         bool_and(r.unidades = 3) filter (where r.unidad is not null) as de_tres,
         array_agg(coalesce(r.unidad, 0) order by r.orden) as unidades,
         count(distinct r.orden) = count(*) as sin_repetir,
         string_agg(r.paso, ',' order by r.orden) filter (where r.unidad is null) as pasos
    into v from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')]) r;
  perform test.afirmar(v.pasos = 'SUBIDA,REVISION' and v.sin_cuantas and v.de_tres and v.sin_repetir
    and v.unidades = array[0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
    format('primero lo de toda la cotización (%s) y después cada unidad, en orden (%s)', v.pasos, v.unidades));
  perform test.afirmar(
    (select bool_and(r.unidad is null and r.unidades is null) from public.recorrido_de_cotizaciones(array[pg_temp.id('cot1'), pg_temp.id('cotp')]) r),
    'la de una unidad, y la de varias que nadie tocó, no llevan unidad en ningún paso');
end $$;
reset role;

-- ============================================ 3. La unidad con su OT pasa a Contabilidad sin esperar a las otras
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot3', 'ot1', 'qa-498 u1', '49801');
reset role;
select test.afirmar(pg_temp.camino('contabilidad', 'cot3') =
    '1·CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > 1·FACTURA:AHORA:Contabilidad > 1·COBRO:PENDIENTE'
    || ' > 2·CODIGO_Y_OT:AHORA:Administración > 2·FACTURA:PENDIENTE > 2·COBRO:PENDIENTE'
    || ' > 3·CODIGO_Y_OT:AHORA:Administración > 3·FACTURA:PENDIENTE > 3·COBRO:PENDIENTE',
  'con 1 de 3 OT, la unidad 1 espera su factura y las otras dos su OT (' || pg_temp.camino('contabilidad', 'cot3') || ')');
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  select r.puesto, r.dias, r.en into v from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')]) r
   where r.unidad = 1 and r.paso = 'CODIGO_Y_OT' and r.situacion = 'HECHO';
  perform test.afirmar(v.puesto = public.puesto_de(pg_temp.id('administracion')) and v.dias = 0 and v.en is not null,
    format('el paso dice el puesto de quien cargó la OT (%s) y cuánto tardó desde la aprobación (%s)', v.puesto, v.dias));
  select r.dias, r.espera into v from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')]) r
   where r.unidad = 1 and r.paso = 'FACTURA' and r.situacion = 'AHORA';
  perform test.afirmar(v.dias = 0 and v.espera = 'FACTURA', 'y la factura de esa unidad espera desde hoy');
end $$;
reset role;

-- ============================================ 4. Facturada en parte, completa y cobrada: solo esa unidad
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.facturar('f1', 'cot3', 'E001-4981', 5000, 1);
reset role;
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 1) =
    'CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > FACTURA:HECHO:EN_PARTE > FACTURA_RESTO:AHORA:Contabilidad > COBRO:AHORA:Tesorería',
  'con 5 000 de sus 11 800, la unidad 1 está facturada en parte: falta su resto y su cobro (' || pg_temp.camino('contabilidad', 'cot3', 1) || ')');
select test.afirmar(pg_temp.camino('vendedor', 'cot3', 1) =
    'CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > FACTURA:HECHO',
  'Ventas ve que se facturó, sin «en parte», sin lo que falta y sin el cobro (' || pg_temp.camino('vendedor', 'cot3', 1) || ')');
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 2) = 'CODIGO_Y_OT:AHORA:Administración > FACTURA:PENDIENTE > COBRO:PENDIENTE'
  and pg_temp.camino('contabilidad', 'cot3', 3) = 'CODIGO_Y_OT:AHORA:Administración > FACTURA:PENDIENTE > COBRO:PENDIENTE',
  'la factura de la unidad 1 no toca a las otras dos');

select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.facturar('f2', 'cot3', 'E001-4982', 6800, 1);
reset role;
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 1) =
    'CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > FACTURA:HECHO > COBRO:AHORA:Tesorería',
  'con sus 11 800 facturados, a la unidad 1 solo le falta el cobro (' || pg_temp.camino('contabilidad', 'cot3', 1) || ')');

select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.cobrar('c1', 'f1', 5000, true);
select pg_temp.cobrar('c2', 'f2', 1000, false);
reset role;
select test.afirmar(pg_temp.camino('tesoreria', 'cot3', 1) like '%FACTURA:HECHO > COBRO:AHORA:Tesorería:EN_PARTE',
  'cobrada una factura y la otra a cuenta, Tesorería ve que ya cobró una parte (' || pg_temp.camino('tesoreria', 'cot3', 1) || ')');
select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.cobrar('c3', 'f2', 5800, true);
reset role;
-- Lo que decidió DKS: una unidad puede estar cobrada y otra sin OT, y el recorrido dice cuál.
select test.afirmar(pg_temp.camino('tesoreria', 'cot3') =
    '1·CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > 1·FACTURA:HECHO > 1·COBRO:HECHO'
    || ' > 2·CODIGO_Y_OT:AHORA:Administración > 2·FACTURA:PENDIENTE > 2·COBRO:PENDIENTE'
    || ' > 3·CODIGO_Y_OT:AHORA:Administración > 3·FACTURA:PENDIENTE > 3·COBRO:PENDIENTE',
  'la unidad 1 quedó cobrada y las otras dos siguen sin OT (' || pg_temp.camino('tesoreria', 'cot3') || ')');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar(
  (select r.puesto = public.puesto_de(pg_temp.id('tesoreria')) and r.dias = 0
     from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')]) r
    where r.unidad = 1 and r.paso = 'COBRO' and r.situacion = 'HECHO'),
  'el cobro dice el puesto de quien lo registró, y cuánto tardó desde la factura');
reset role;

-- ============================================ 5. La factura por toda la cotización cuenta en cada unidad
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot3', 'ot2', 'qa-498 u2', '49802');
select pg_temp.cargar('cot3', 'ot3', 'qa-498 u3', '49803');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.facturar('f3', 'cot3', 'E001-4983', 3000, 0);
reset role;
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 2) =
    'CODIGO_Y_OT:HECHO:OT 49802-' || current_setting('prueba.anio') || ' > FACTURA:HECHO:EN_PARTE > FACTURA_RESTO:AHORA:Contabilidad > COBRO:AHORA:Tesorería',
  'la factura por toda la cotización deja a la unidad 2 facturada en parte, con 1 000 de sus 11 800 (' || pg_temp.camino('contabilidad', 'cot3', 2) || ')');
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 1) =
    'CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > FACTURA:HECHO > COBRO:AHORA:Tesorería',
  'y la unidad 1, que estaba cobrada, vuelve a esperar el cobro de su parte de esa factura (' || pg_temp.camino('contabilidad', 'cot3', 1) || ')');

-- ============================================ 6. La unidad facturada que se quedó sin OT
-- La OT de la unidad 3 se anula: su parte del anticipo sigue siendo suya.
do $$
begin
  set local session_replication_role = replica;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se cargó con el código equivocado' where id = pg_temp.id('ot3');
  set local session_replication_role = origin;
end $$;
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 3) =
    'FACTURA:HECHO:EN_PARTE > CODIGO_Y_OT:AHORA:Administración > COBRO:AHORA:Tesorería > FACTURA_RESTO:PENDIENTE',
  'sin su OT, la unidad 3 vuelve a Administración, y lo que le falta facturar queda pendiente, no se pierde (' || pg_temp.camino('contabilidad', 'cot3', 3) || ')');
select test.afirmar(pg_temp.camino('vendedor', 'cot3', 3) = 'FACTURA:HECHO > CODIGO_Y_OT:AHORA:Administración',
  'Ventas ve que esa unidad espera su OT y que ya tiene una factura (' || pg_temp.camino('vendedor', 'cot3', 3) || ')');

-- 8. Con la unidad 3 facturada (y ya sin OT), Ventas no puede corregir la cotización a dos
-- unidades: la facturada no se corrige. Si esa regla se suelta, la parte de la unidad 3
-- se quedaría sin unidad y dejaría de contarse sin que nadie lo vea.
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(format(
  'update public.cotizaciones_pdf set cantidad_unidades = 2, ruta_storage = %L, nombre_archivo = %L, motivo_correccion = %L, estado = %L where id = %L',
  'cot/' || current_setting('prueba.cot3') || '/v2.pdf', 'v2.pdf', 'El cliente redujo el pedido', 'POR_REVISAR', current_setting('prueba.cot3')),
  'la cotización facturada no cambia su cantidad de unidades',
  'ya está facturada: no se corrige');
reset role;
select test.afirmar((select cantidad_unidades from public.cotizaciones_pdf where id = pg_temp.id('cot3')) = 3, 'y sigue siendo de tres');

-- 8b. Gerencia aprobó hace nueve días y la OT de la unidad 3 se anuló hace dos: esa unidad
-- espera a Administración desde hace dos días, no nueve. (La OT anulada no acepta más
-- cambios: su `actualizado_en` es la hora en que se anuló.)
do $$
begin
  set local session_replication_role = replica;
  update public.cotizaciones_pdf set revisado_en = now() - interval '9 days' where id in (pg_temp.id('cot3'), pg_temp.id('cotp'));
  update public.ordenes_trabajo set actualizado_en = now() - interval '2 days' where id = pg_temp.id('ot3');
  set local session_replication_role = origin;
end $$;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  select r.dias, r.en into v from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')]) r
   where r.unidad = 3 and r.paso = 'CODIGO_Y_OT' and r.situacion = 'AHORA';
  perform test.afirmar(v.dias = 2 and v.en = now() - interval '2 days',
    format('la unidad que perdió su OT hace dos días espera desde entonces, no desde la aprobación de hace nueve (%s días)', v.dias));
end $$;
reset role;
-- La que nunca tuvo OT sí espera desde la aprobación.
select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id = pg_temp.id('cotp');
reset role;
do $$
begin
  set local session_replication_role = replica;
  update public.cotizaciones_pdf set revisado_en = now() - interval '9 days' where id = pg_temp.id('cotp');
  set local session_replication_role = origin;
end $$;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.afirmar(
  (select count(*) = 3 and bool_and(r.dias = 9) from public.recorrido_de_cotizaciones(array[pg_temp.id('cotp')]) r
    where r.paso = 'CODIGO_Y_OT' and r.situacion = 'AHORA'),
  'las tres unidades que nunca tuvieron OT esperan desde la aprobación: nueve días');
reset role;

select pg_temp.como('tesoreria');
set local role authenticated;
select pg_temp.cobrar('c4', 'f3', 3000, true);
reset role;
select test.afirmar(pg_temp.camino('tesoreria', 'cot3', 3) =
    'FACTURA:HECHO:EN_PARTE > CODIGO_Y_OT:AHORA:Administración > FACTURA_RESTO:PENDIENTE > COBRO:PENDIENTE',
  'cobrado el anticipo, a la unidad 3 le falta su OT, el resto de su factura y ese cobro (' || pg_temp.camino('tesoreria', 'cot3', 3) || ')');
select test.afirmar(pg_temp.camino('tesoreria', 'cot3', 1) =
    'CODIGO_Y_OT:HECHO:OT 49801-' || current_setting('prueba.anio') || ' > FACTURA:HECHO > COBRO:HECHO',
  'y la unidad 1 queda cobrada otra vez (' || pg_temp.camino('tesoreria', 'cot3', 1) || ')');
select test.afirmar(pg_temp.camino('tesoreria', 'cot3', -1) = 'nada',
  'ningún paso de OT, factura o cobro queda suelto fuera de su unidad');

-- ============================================ 7. La cotización de una unidad, como siempre
select pg_temp.como('administracion');
set local role authenticated;
select pg_temp.cargar('cot1', 'ots', 'qa-498 s', '49810');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.facturar('fs', 'cot1', 'E001-4989', 4000, 1);
reset role;
select test.afirmar(pg_temp.camino('contabilidad', 'cot1') =
    'CODIGO_Y_OT:HECHO:OT 49810-' || current_setting('prueba.anio') || ' > FACTURA:HECHO:EN_PARTE > FACTURA_RESTO:AHORA:Contabilidad > COBRO:AHORA:Tesorería',
  'la de una unidad da los pasos de siempre, sin unidad (' || pg_temp.camino('contabilidad', 'cot1') || ')');

-- ============================================ 9. Quien no ve cotizaciones no lee el recorrido
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format('select * from public.recorrido_de_cotizaciones(array[%L::uuid])', current_setting('prueba.cot3')),
  'Almacén no lee el recorrido de una cotización', 'No tienes permiso para ver las cotizaciones');
select test.debe_fallar('select * from public.codigo_interno_recorrido(''QA-498 U1'')',
  'ni el recorrido de un código', 'permiso');
reset role;

-- ============================================ 10. La ficha del código encuentra su cotización en cualquier unidad
-- Antes solo la encontraba el código de la OT más nueva: los demás decían «Sin cotización».
select pg_temp.como('gerente');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from public.codigo_interno_recorrido('QA-498 U1');
  perform test.afirmar(v.cotizacion_numero = 'QA-498-3' and v.cotizacion_unidad = 1 and v.cotizacion_unidades = 3
    and v.cotizaciones = 1 and v.ot_numero like '49801-%',
    format('el código de la unidad 1 tiene su cotización y dice que es la 1 de 3 (%s, %s de %s)', v.cotizacion_numero, v.cotizacion_unidad, v.cotizacion_unidades));
  select * into v from public.codigo_interno_recorrido('qa-498 u2');
  perform test.afirmar(v.cotizacion_numero = 'QA-498-3' and v.cotizacion_unidad = 2 and v.cotizacion_unidades = 3 and v.ot_numero like '49802-%',
    format('y el de la unidad 2, la 2 de 3 (%s, %s de %s)', v.cotizacion_numero, v.cotizacion_unidad, v.cotizacion_unidades));
  -- La OT de la unidad 3 está anulada: su código ya no es de ninguna cotización.
  select * into v from public.codigo_interno_recorrido('QA-498 U3');
  perform test.afirmar(v.cotizacion_id is null and v.ot_id is null and v.cotizacion_unidad is null,
    'el código de la OT anulada no cuenta la historia de la cotización');
  select * into v from public.codigo_interno_recorrido('QA-498 S');
  perform test.afirmar(v.cotizacion_numero = 'QA-498-1' and v.cotizacion_unidad is null and v.cotizacion_unidades is null,
    'el código de la cotización de una unidad, como siempre: sin unidad');
end $$;
reset role;

-- ============================================ 11. El número de la OT de cada unidad, solo a quien lee las órdenes
-- Hoy todo puesto que ve cotizaciones las lee; se le quita el permiso a Ventas para probar la puerta.
delete from public.roles_permisos
 where permiso_codigo = 'ordenes.ver' and rol_id = (select id from public.roles where codigo = 'VENDEDOR');
select test.afirmar(pg_temp.camino('vendedor', 'cot3', 1) = 'CODIGO_Y_OT:HECHO > FACTURA:HECHO'
  and pg_temp.camino('vendedor', 'cot3', 2) = 'CODIGO_Y_OT:HECHO > FACTURA:HECHO',
  'sin leer las órdenes, Ventas ve que cada unidad tiene su OT, sin el número (' || pg_temp.camino('vendedor', 'cot3', 1) || ')');
select test.afirmar(pg_temp.camino('contabilidad', 'cot3', 2) like 'CODIGO_Y_OT:HECHO:OT 49802-%',
  'y Contabilidad, que sí las lee, lo sigue viendo');

-- ============================================ 12. Anulada la cotización, nadie la espera y la anulación cuenta bien sus días
-- Las OT que quedaban se anulan y Gerencia anula la cotización. Lo último que se hizo
-- fue el cobro de hoy: la anulación dice «el mismo día», no los nueve días desde la aprobación.
do $$
begin
  set local session_replication_role = replica;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El cliente desistió' where id in (pg_temp.id('ot1'), pg_temp.id('ot2'));
  set local session_replication_role = origin;
end $$;
select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'ANULADA', observacion = 'El cliente desistió de la compra' where id = pg_temp.id('cot3');
reset role;
-- Con la cuenta de Gerencia: la anulada ya no la ven Contabilidad ni Tesorería, como siempre.
select pg_temp.como('gerente');
set local role authenticated;
do $$
declare v record;
begin
  select count(*) filter (where r.situacion <> 'HECHO') as esperan,
         max(r.orden) filter (where r.paso = 'ANULACION') = max(r.orden) as al_final,
         max(r.dias) filter (where r.paso = 'ANULACION') as dias,
         bool_and(r.unidad is null) filter (where r.paso = 'ANULACION') as sin_unidad,
         count(*) filter (where r.unidad is not null and r.paso = 'FACTURA') as facturas
    into v from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')]) r;
  perform test.afirmar(v.esperan = 0 and v.al_final and v.sin_unidad and v.facturas = 3,
    format('anulada, no espera a nadie; quedan los hechos de cada unidad y la anulación va al final, sin unidad (esperan %s, facturas %s)', v.esperan, v.facturas));
  perform test.afirmar(v.dias = 0,
    format('la anulación cuenta sus días desde lo último que se hizo en cualquier unidad, no desde la aprobación (%s)', v.dias));
end $$;
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.recorrido_de_cotizaciones(array[pg_temp.id('cot3')])) = 0,
  'y Tesorería ya no lee el recorrido de la anulada, como antes');
reset role;

rollback;
