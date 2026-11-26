-- Ventas ve dónde va su cotización (migración 20261126200000, Plan 9 · 9.1).
--
--   1. El recorrido da los días de cada paso hecho: las fechas de Lima desde el
--      paso hecho anterior. La subida no tiene anterior; lo que espera sigue
--      con sus días en espera.
--   2. La campana del vendedor cuando Gerencia responde: aprobada, rechazada
--      con su observación o anulada con su motivo, cada una con su frase. La
--      anulada, que antes no avisaba, lleva al filtro de anuladas.
--   3. Lo lee quien ve la cotización: Ventas sí; Almacén, que no la ve, no.
--   4. Sin importes: ni en los pasos ni en los avisos.
--
-- Cada lectura y cada escritura con la cuenta del puesto —nunca ADMIN— y
-- `set local role authenticated`. Las fechas de antes se siembran con
-- `session_replication_role = replica`, para no pasar por los disparadores que
-- ponen la hora. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000472', 'PRUEBAS 472 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA472', 'Taller prueba de Ventas') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['VENDEDOR:GCO', 'GERENTE:GGE', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.472@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id, sede_id, documento)
    select v_id, initcap(split_part(v, ':', 1)), 'Check 472', lower(replace(v, ':', '.')) || '.472@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2)),
           (select id from public.sedes where codigo = 'QA472'), '7247' || lpad((row_number() over ())::text, 4, '0')
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['apr', 'rec', 'anu', 'ot'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000472', 'QA TRANSPORTES DE VENTAS S.A.C.') returning id::text into v;
  perform set_config('prueba.cliente', v, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- Hace N fechas de Lima, al mediodía: sin el borde de la medianoche.
create or replace function pg_temp.hace(p_dias integer) returns timestamptz language sql as $$
  select ((current_setting('prueba.hoy')::date - p_dias)::timestamp + interval '12 hours') at time zone 'America/Lima';
$$;
-- El recorrido en una línea con los días: «SUBIDA:HECHO:- > REVISION:HECHO:2 > …».
create or replace function pg_temp.camino(p_cot text) returns text language sql as $$
  select string_agg(paso || ':' || situacion || ':' || coalesce(dias::text, '-'), ' > ' order by orden)
    from public.recorrido_de_cotizaciones(array[current_setting('prueba.' || p_cot)::uuid]);
$$;
grant execute on all functions in schema pg_temp to authenticated;

insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['apr', 'rec', 'anu']) c;

-- Ventas sube las tres.
select pg_temp.como('vendedor');
set local role authenticated;
do $$
declare c text;
begin
  foreach c in array array['apr', 'rec', 'anu'] loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
    values (pg_temp.id(c), 'QA-472-' || c, pg_temp.id('cliente'), pg_temp.id('carroceria'),
            'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), 47200, 'PEN');
  end loop;
end $$;
reset role;

-- Se subieron hace 5 fechas (apr) y hace 4 (rec, anu).
set local session_replication_role = replica;
update public.cotizaciones_pdf set creado_en = pg_temp.hace(5), archivo_subido_en = pg_temp.hace(5) where id = pg_temp.id('apr');
update public.cotizaciones_pdf set creado_en = pg_temp.hace(4), archivo_subido_en = pg_temp.hace(4) where id in (pg_temp.id('rec'), pg_temp.id('anu'));
set local session_replication_role = origin;

-- ============================================ 1. Los días, mientras espera a Gerencia
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(pg_temp.camino('apr') = 'SUBIDA:HECHO:- > REVISION:AHORA:5 > CODIGO_Y_OT:PENDIENTE:- > FACTURA:PENDIENTE:-',
  'subida hace 5 fechas: la tiene Gerencia hace 5 días y la subida no lleva días (' || pg_temp.camino('apr') || ')');
reset role;

-- ============================================ 2. Gerencia responde, y la campana avisa a Ventas
select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id = pg_temp.id('apr');
update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el plazo de entrega' where id = pg_temp.id('rec');
update public.cotizaciones_pdf set estado = 'ANULADA', observacion = 'El cliente desistió' where id = pg_temp.id('anu');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
do $$
declare v record;
begin
  select titulo, cuerpo, ruta into v from public.notificaciones where origen_id = pg_temp.id('apr') and usuario_id = pg_temp.id('vendedor');
  perform test.afirmar(v.titulo = 'Gerencia aprobó tu cotización' and v.ruta = '/cotizaciones/pdf',
    'aprobada: la campana lo dice y lleva a Cotización (la campana le suma el #id) (' || coalesce(v.titulo, 'sin aviso') || ' · ' || coalesce(v.ruta, '') || ')');

  select titulo, cuerpo, ruta into v from public.notificaciones where origen_id = pg_temp.id('rec') and usuario_id = pg_temp.id('vendedor');
  perform test.afirmar(v.titulo = 'Gerencia rechazó tu cotización' and v.cuerpo like '%Falta el plazo de entrega%'
                       and v.ruta = '/cotizaciones/pdf',
    'rechazada: con la observación de Gerencia (' || coalesce(v.cuerpo, 'sin aviso') || ')');

  select titulo, cuerpo, ruta into v from public.notificaciones where origen_id = pg_temp.id('anu') and usuario_id = pg_temp.id('vendedor');
  perform test.afirmar(v.titulo = 'Gerencia anuló tu cotización' and v.cuerpo like '%El cliente desistió%'
                       and v.ruta = '/cotizaciones/pdf?estado=ANULADA',
    'anulada: avisa, con su motivo, y lleva al filtro de anuladas (' || coalesce(v.titulo, 'sin aviso') || ' · ' || coalesce(v.ruta, '') || ')');

  perform test.afirmar((select count(*) from public.notificaciones where usuario_id = pg_temp.id('vendedor')
                          and origen_id in (pg_temp.id('apr'), pg_temp.id('rec'), pg_temp.id('anu'))) = 3,
    'un aviso por respuesta, ni uno más');
  perform test.afirmar(not exists (select 1 from public.notificaciones where usuario_id = pg_temp.id('vendedor') and cuerpo ~ '47200|47\.200'),
    'ningún aviso al vendedor lleva el importe');
end $$;
reset role;

-- Gerencia aprobó hace 3 fechas y rechazó hace 1.
set local session_replication_role = replica;
update public.cotizaciones_pdf set revisado_en = pg_temp.hace(3) where id = pg_temp.id('apr');
update public.cotizaciones_pdf set revisado_en = pg_temp.hace(1) where id = pg_temp.id('rec');
set local session_replication_role = origin;

select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(pg_temp.camino('apr') = 'SUBIDA:HECHO:- > REVISION:HECHO:2 > CODIGO_Y_OT:AHORA:3 > FACTURA:PENDIENTE:-',
  'aprobada a los 2 días de subida; Administración la tiene hace 3 (' || pg_temp.camino('apr') || ')');
select test.afirmar(pg_temp.camino('rec') = 'SUBIDA:HECHO:- > REVISION:HECHO:3 > CORRECCION:AHORA:1 > REVISION:PENDIENTE:- > CODIGO_Y_OT:PENDIENTE:- > FACTURA:PENDIENTE:-',
  'devuelta a los 3 días; vuelve a Ventas hace 1 (' || pg_temp.camino('rec') || ')');
select test.afirmar(pg_temp.camino('anu') = 'SUBIDA:HECHO:- > ANULACION:HECHO:4',
  'anulada hoy, a las 4 fechas de subida: lo hecho con sus días, sin nadie esperando (' || pg_temp.camino('anu') || ')');
reset role;

-- Ventas corrige hoy: la corrección lleva 1 día desde el rechazo.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', 'cot/' || current_setting('prueba.rec') || '/v2.pdf', current_setting('prueba.vendedor'),
        '{"mimetype": "application/pdf", "size": 120}'::jsonb);
select pg_temp.como('vendedor');
set local role authenticated;
update public.cotizaciones_pdf
   set ruta_storage = 'cot/' || current_setting('prueba.rec') || '/v2.pdf', nombre_archivo = 'v2.pdf', motivo_correccion = 'Con el plazo de entrega.'
 where id = pg_temp.id('rec');
select test.afirmar(pg_temp.camino('rec') = 'SUBIDA:HECHO:- > REVISION:HECHO:3 > CORRECCION:HECHO:1 > REVISION:AHORA:0 > CODIGO_Y_OT:PENDIENTE:- > FACTURA:PENDIENTE:-',
  'corregida hoy, al día siguiente del rechazo; Gerencia la tiene desde hoy (' || pg_temp.camino('rec') || ')');
reset role;

-- Administración le da hoy su código y su OT.
select pg_temp.como('administracion');
set local role authenticated;
select public.cargar_codigo_y_ot_de_cotizacion(pg_temp.id('apr'), pg_temp.id('ot'), 'qa-ci 472', '9472', 'SEMIRREMOLQUE',
  current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot') || '/orden.pdf', 'orden.pdf', 100);
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(pg_temp.camino('apr') = 'SUBIDA:HECHO:- > REVISION:HECHO:2 > CODIGO_Y_OT:HECHO:3 > FACTURA:AHORA:0',
  'con OT a los 3 días de aprobada; Contabilidad la tiene desde hoy (' || pg_temp.camino('apr') || ')');
-- ============================================ 4. Sin importes
select test.afirmar(
  not exists (select 1 from public.recorrido_de_cotizaciones(array[pg_temp.id('apr'), pg_temp.id('rec'), pg_temp.id('anu')]) r
               where to_jsonb(r)::text ~ '47200|7247|prueba\.local|Check 472'),
  'en ningún paso sale el importe, un DNI, un correo ni el nombre de la cuenta');
reset role;

-- ============================================ 3. Quien no ve la cotización, no ve su recorrido
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format('select * from public.recorrido_de_cotizaciones(array[%L::uuid])', current_setting('prueba.apr')),
  'Almacén no lee el recorrido de la cotización', 'No tienes permiso para ver las cotizaciones');
select test.afirmar((select count(*) from public.notificaciones where origen_id = pg_temp.id('rec')) = 0,
  'ni los avisos de Ventas');
reset role;

rollback;
