-- El dueño ve y quita su archivo suelto en `gastos-ot` y `control-ot`
-- (migración 20261022190000). La pantalla sube el comprobante del gasto y el
-- escaneo del control antes de anotarlos; si la respuesta de Storage se pierde,
-- los quita en el acto, con la sesión de quien subió. Storage quita con un
-- DELETE … RETURNING, y Postgres le aplica también la política de leer: con la
-- de leer pidiendo una fila que lo nombre, el borrado afectaba cero archivos sin
-- error y el PDF quedaba suelto para siempre (duodécima pasada del PR #148).
--
-- Con las cuentas reales y `set local role authenticated`: Logística (gasto) y
-- Requerimientos (control) ven y quitan su archivo sin fila; no ven ni quitan
-- el de otra persona, ni el suyo una vez que una fila lo nombra. El armazón lo
-- pone el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA426', 'Taller prueba 426') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA426' \gset
select test.crear_usuario('Ada', 'Admin', 'admin426@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Lucía', 'Logística', 'logistica426@demo.pe', 'COMPRADOR', :'sede_id') as logistica_id \gset
select test.crear_usuario('Luis', 'Logística', 'logistica426b@demo.pe', 'COMPRADOR', :'sede_id') as otro_id \gset
select test.crear_usuario('Rita', 'Requerimientos', 'requerimientos426@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req_id \gset

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000426', 'QA CLIENTE 426') returning id as cliente_id \gset
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('9426-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY'), :'cliente_id', :'sede_id', 'FABRICACION', 'NORMAL',
        'Tolva 426 con gastos', 'APROBADA')
returning id as orden_id \gset
select id as area_id from public.areas where codigo <> 'ADM' order by codigo limit 1 \gset
select set_config('prueba.gasto', gen_random_uuid()::text, true);
select set_config('prueba.suelto_gasto', 'ot/' || :'orden_id' || '/gastos/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.anotado_gasto', 'ot/' || :'orden_id' || '/gastos/' || current_setting('prueba.gasto') || '.pdf', true);
select set_config('prueba.ajeno_gasto', 'ot/' || :'orden_id' || '/gastos/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.suelto_control', 'ot/' || :'orden_id' || '/control/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.anotado_control', 'ot/' || :'orden_id' || '/control/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.ajeno_control', 'ot/' || :'orden_id' || '/control/' || gen_random_uuid() || '.pdf', true);

-- Lo que dejó en Storage cada subida cuya respuesta se perdió, con su dueño.
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('gastos-ot', current_setting('prueba.suelto_gasto'), :'logistica_id', '{"mimetype":"application/pdf","size":2048}'),
  ('gastos-ot', current_setting('prueba.anotado_gasto'), :'logistica_id', '{"mimetype":"application/pdf","size":2048}'),
  ('gastos-ot', current_setting('prueba.ajeno_gasto'), :'otro_id', '{"mimetype":"application/pdf","size":2048}'),
  ('control-ot', current_setting('prueba.suelto_control'), :'req_id', '{"mimetype":"application/pdf","size":2048}'),
  ('control-ot', current_setting('prueba.anotado_control'), :'req_id', '{"mimetype":"application/pdf","size":2048}'),
  ('control-ot', current_setting('prueba.ajeno_control'), :'otro_id', '{"mimetype":"application/pdf","size":2048}');
-- Uno de cada uno ya lo nombra su fila.
insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, registrado_por)
values (current_setting('prueba.gasto')::uuid, :'orden_id', :'area_id', 'SERVICIO', 'Servicio de doblez para la tolva 426',
        (now() at time zone 'America/Lima')::date, 150, 'PEN', current_setting('prueba.anotado_gasto'), 'doblez-426.pdf', :'logistica_id');
-- La ficha completa con su escaneo, sin pasar por cada ítem de ingreso y
-- salida: aquí solo importa que una fila nombra el escaneo.
set local session_replication_role = replica;
insert into public.ot_control_vehicular (orden_id, ingreso_cerrado_en, salida_cerrada_en, escaneo_ruta, escaneo_nombre)
values (:'orden_id', now(), now(), current_setting('prueba.anotado_control'), 'control-426.pdf');
set local session_replication_role = origin;
select set_config('prueba.logistica', :'logistica_id', true);
select set_config('prueba.req', :'req_id', true);

-- ============================================ 1. Logística y su comprobante en gastos-ot
select test.como_usuario(:'logistica_id');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'gastos-ot' and name = current_setting('prueba.suelto_gasto')) = 1,
  'Logística ve su comprobante suelto, el que ninguna fila nombra');
select test.afirmar((select count(*) from storage.objects where bucket_id = 'gastos-ot' and name = current_setting('prueba.ajeno_gasto')) = 0,
  'y no el suelto de otra persona');
do $$
declare
  v integer;
begin
  -- Como lo hace Storage al quitar: DELETE … RETURNING.
  with quitado as (delete from storage.objects where bucket_id = 'gastos-ot' and name = current_setting('prueba.suelto_gasto') returning 1)
  select count(*) into v from quitado;
  perform test.afirmar(v = 1, 'Logística quita su comprobante suelto (el reintento del mismo gasto ya no choca con él)');
  with quitado as (delete from storage.objects where bucket_id = 'gastos-ot' and name = current_setting('prueba.anotado_gasto') returning 1)
  select count(*) into v from quitado;
  perform test.afirmar(v = 0, 'no quita el que su gasto nombra');
  with quitado as (delete from storage.objects where bucket_id = 'gastos-ot' and name = current_setting('prueba.ajeno_gasto') returning 1)
  select count(*) into v from quitado;
  perform test.afirmar(v = 0, 'ni el suelto de otra persona');
end $$;
reset role;

-- ============================================ 2. Requerimientos y su escaneo en control-ot
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'control-ot' and name = current_setting('prueba.suelto_control')) = 1,
  'Requerimientos ve su escaneo suelto');
select test.afirmar((select count(*) from storage.objects where bucket_id = 'control-ot' and name = current_setting('prueba.ajeno_control')) = 0,
  'y no el suelto de otra persona');
do $$
declare
  v integer;
begin
  with quitado as (delete from storage.objects where bucket_id = 'control-ot' and name = current_setting('prueba.suelto_control') returning 1)
  select count(*) into v from quitado;
  perform test.afirmar(v = 1, 'Requerimientos quita su escaneo suelto');
  with quitado as (delete from storage.objects where bucket_id = 'control-ot' and name = current_setting('prueba.anotado_control') returning 1)
  select count(*) into v from quitado;
  perform test.afirmar(v = 0, 'no quita el que la ficha nombra');
  with quitado as (delete from storage.objects where bucket_id = 'control-ot' and name = current_setting('prueba.ajeno_control') returning 1)
  select count(*) into v from quitado;
  perform test.afirmar(v = 0, 'ni el suelto de otra persona');
end $$;
reset role;

select test.afirmar(
  (select count(*) from storage.objects where name in (current_setting('prueba.anotado_gasto'), current_setting('prueba.ajeno_gasto'),
                                                     current_setting('prueba.anotado_control'), current_setting('prueba.ajeno_control'))) = 4
  and (select count(*) from storage.objects where name in (current_setting('prueba.suelto_gasto'), current_setting('prueba.suelto_control'))) = 0,
  'quedan los anotados y los ajenos; los dos sueltos de su dueño se fueron');

rollback;
