-- La OT sin cotización lleva el número de su papel (migración 20261021110000).
-- Con la cuenta de Administración y `set local role authenticated`: el número
-- se escribe como 2922 o 2922-2026, no se repite (ni con el de una OT de
-- cotización), un número mal escrito no deja orden y la serie automática salta
-- por encima del papel. Ventas no registra. El armazón lo pone el
-- administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA414', 'Taller prueba 414') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA414' \gset
select test.crear_usuario('Ada', 'Admin', 'admin414@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Alma', 'Administración', 'administracion414@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas414@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select set_config('prueba.sede', :'sede_id', true);
select set_config('prueba.adm', :'adm_id', true);
select set_config('prueba.anio', to_char((now() at time zone 'America/Lima')::date, 'YYYY'), true);

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000414', 'QA CLIENTE 414') returning id as cliente_id \gset
select set_config('prueba.cliente', :'cliente_id', true);
-- Una OT que ya tiene el número 9414 del año, como si viniera de una cotización.
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('9414-' || current_setting('prueba.anio'), :'cliente_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Tolva 414 de cotización', 'APROBADA');

-- La orden y su PDF ya subido, para cada intento: una orden nueva por número.
create or replace function pg_temp.registrar(p_numero text) returns text language plpgsql as $$
declare
  v_orden uuid := gen_random_uuid();
  v_ruta  text := 'ot/' || v_orden || '/orden.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', v_ruta, current_setting('prueba.adm'), '{"mimetype":"application/pdf","size":2048}'::jsonb);
  return format($q$select public.registrar_orden_sin_cotizacion(%L, %L, %L, null, %L, null, 'REPARACION', 'NORMAL',
    'Reparación de prueba 414', null, null, null, null, null, null, %L, 'orden.pdf', 2048)$q$,
    v_orden, p_numero, current_setting('prueba.cliente'), current_setting('prueba.sede'), v_ruta);
end;
$$;
grant execute on function pg_temp.registrar(text) to authenticated;

select coalesce(max(correlativo_actual), 0) as serie_antes from public.series_documentarias
 where tipo = 'ORDEN_TRABAJO' and (sede_id is null or sede_id = :'sede_id') \gset
select test.afirmar(:'serie_antes'::bigint < 12414, 'la serie empieza por debajo del papel de la prueba');

select test.como_usuario(:'adm_id');
set local role authenticated;

do $$
declare
  v_id uuid;
begin
  -- 1. Sin número, o mal escrito, no hay orden.
  perform test.debe_fallar(pg_temp.registrar(null), 'sin número no se registra', 'el que trae su papel');
  perform test.debe_fallar(pg_temp.registrar('OT-2922'), 'un número con letras no entra', 'el que trae su papel');
  perform test.debe_fallar(pg_temp.registrar('2922-26'), 'el año va con cuatro cifras', 'el que trae su papel');
  perform test.debe_fallar(pg_temp.registrar('0000'), 'el cero no es número de orden', 'el que trae su papel');
  perform test.debe_fallar(pg_temp.registrar('2930-0000'), 'el año 0000 no es de ningún papel', 'el que trae su papel');
  perform test.debe_fallar(pg_temp.registrar('2930-' || (current_setting('prueba.anio')::integer + 1)),
    'ni un año que todavía no llega', 'el que trae su papel');
  perform test.afirmar(not exists (select 1 from public.ordenes_trabajo where descripcion = 'Reparación de prueba 414'),
    'los intentos fallidos no dejaron orden');

  -- 2. «8414» toma el año en curso.
  execute pg_temp.registrar('8414') into v_id;
  perform test.afirmar((select numero from public.ordenes_trabajo where id = v_id) = '8414-' || current_setting('prueba.anio'),
    'Administración registra la orden con el número de su papel y el año en curso');
  perform test.afirmar((select estado::text from public.ordenes_trabajo where id = v_id) = 'BORRADOR'
                       and (select cotizacion_pdf_id from public.ordenes_trabajo where id = v_id) is null,
    'nace en borrador y sin cotización, como antes');

  -- 3. «814-2025» entra con su año y con las cuatro cifras.
  execute pg_temp.registrar(' 814-2025 ') into v_id;
  perform test.afirmar((select numero from public.ordenes_trabajo where id = v_id) = '0814-2025',
    'un número con su año entra tal cual, con cuatro cifras');

  -- 3b. Un número de cinco cifras no se recorta a cuatro (con `lpad` quedaba 1241).
  execute pg_temp.registrar('12414') into v_id;
  perform test.afirmar((select numero from public.ordenes_trabajo where id = v_id) = '12414-' || current_setting('prueba.anio'),
    'un número de cinco cifras entra entero, sin recortarse');

  -- 4. No se repite: ni el de otra sin cotización, ni el de una de cotización.
  perform test.debe_fallar(pg_temp.registrar('8414-' || current_setting('prueba.anio')),
    'el mismo número no se usa dos veces', 'Ya hay una orden de trabajo 8414-');
  perform test.debe_fallar(pg_temp.registrar('9414'),
    'el número de una OT de cotización tampoco', 'Ya hay una orden de trabajo 9414-');
end $$;

reset role;

-- 5. La serie automática quedó por encima del papel: la siguiente que numera
-- el sistema no choca con 12414.
select test.afirmar(
  (select max(correlativo_actual) from public.series_documentarias
    where tipo = 'ORDEN_TRABAJO' and (sede_id is null or sede_id = :'sede_id')) >= 12414,
  'la serie del sistema salta por encima del número del papel');

-- 6. Ventas no registra órdenes.
select test.como_usuario(:'ventas_id');
set local role authenticated;
-- El permiso se exige antes que el PDF: no hace falta subirle uno.
select test.debe_fallar(format($q$select public.registrar_orden_sin_cotizacion(gen_random_uuid(), '7414', %L, null, %L, null,
  'REPARACION', 'NORMAL', 'Reparación de prueba 414', null, null, null, null, null, null, 'ot/x/orden.pdf', 'orden.pdf', 2048)$q$,
  current_setting('prueba.cliente'), current_setting('prueba.sede')), 'Ventas no registra la orden sin cotización', 'ordenes.crear');
reset role;

-- 7. La firma vieja, sin número, ya no registra: pide recargar.
select test.como_usuario(:'adm_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_orden_sin_cotizacion(gen_random_uuid(), %L, null, %L, null,
  'REPARACION', 'NORMAL', 'Reparación de prueba 414', null, null, null, null, null, null, 'ot/x/orden.pdf', 'orden.pdf', 2048)$q$,
  current_setting('prueba.cliente'), current_setting('prueba.sede')),
  'la orden sin número ya no tiene puerta: la firma vieja pide recargar', 'Recarga la página');
reset role;

rollback;
