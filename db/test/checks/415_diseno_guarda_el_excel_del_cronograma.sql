-- Diseño guarda el Excel del cronograma en la orden (migración 20261021120000).
-- Con la cuenta de Diseño y `set local role authenticated`: sube a Storage el
-- `.xlsx` de la orden y lo anota como CRONOGRAMA, y lo quita si se equivocó;
-- el PDF de la orden no lo sube, ni en Storage ni como fila. Almacén, que no
-- carga cronogramas, tampoco guarda el Excel. El armazón lo pone el
-- administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA415', 'Taller prueba 415') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA415' \gset
select test.crear_usuario('Ada', 'Admin', 'admin415@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Dina', 'Diseño', 'diseno415@demo.pe', 'DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('Alan', 'Almacén', 'almacen415@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.almacen', :'almacen_id', true);

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000415', 'QA CLIENTE 415') returning id as cliente_id \gset
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('9415-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY'), :'cliente_id', :'sede_id', 'FABRICACION', 'NORMAL',
        'Tolva 415 con cronograma', 'APROBADA')
returning id as orden_id \gset
select set_config('prueba.orden', :'orden_id', true);
select set_config('prueba.excel', 'ot/' || :'orden_id' || '/' || gen_random_uuid() || '.xlsx', true);
select set_config('prueba.pdf', 'ot/' || :'orden_id' || '/' || gen_random_uuid() || '.pdf', true);

-- ============================================ 1. Diseño guarda el Excel y lo anota
select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.afirmar(public.puede_ver_orden(current_setting('prueba.orden')::uuid), 'Diseño ve la orden');
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('adjuntos-ot', current_setting('prueba.excel'), current_setting('prueba.diseno'),
        '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":4096}'::jsonb);
insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (current_setting('prueba.orden')::uuid, 'CRONOGRAMA', 'cronograma-415.xlsx', current_setting('prueba.excel'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4096, current_setting('prueba.diseno')::uuid);
reset role;
select test.afirmar((select count(*) from public.ot_adjuntos
                      where orden_id = current_setting('prueba.orden')::uuid and tipo = 'CRONOGRAMA'
                        and subido_por = current_setting('prueba.diseno')::uuid) = 1,
  'Diseño guarda el Excel del cronograma en la orden');
select test.afirmar((select count(*) from storage.objects where bucket_id = 'adjuntos-ot' and name = current_setting('prueba.excel')) = 1,
  'y el archivo queda en Storage');

-- ============================================ 2. El PDF de la orden no
select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.debe_fallar(format($q$insert into storage.objects (bucket_id, name, owner_id, metadata)
                                  values ('adjuntos-ot', %L, %L, '{"mimetype":"application/pdf","size":2048}'::jsonb)$q$,
                               current_setting('prueba.pdf'), current_setting('prueba.diseno')),
  'Diseño no sube un PDF a la orden', 'row-level security');
select test.debe_fallar(format($q$insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
                                  values (%L, 'ORDEN', 'orden-415.pdf', %L, 'application/pdf', 2048, %L)$q$,
                               current_setting('prueba.orden'), current_setting('prueba.pdf'), current_setting('prueba.diseno')),
  'ni lo anota como el PDF de la orden', 'row-level security');
select test.debe_fallar(format($q$insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
                                  values (%L, 'CRONOGRAMA', 'ajeno.xlsx', %L, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 10, %L)$q$,
                               current_setting('prueba.orden'), 'ot/' || current_setting('prueba.orden') || '/otro.xlsx', current_setting('prueba.almacen')),
  'ni a nombre de otro', 'row-level security');
reset role;

-- ============================================ 3. Quien no carga cronogramas no guarda el Excel
select test.como_usuario(:'almacen_id');
set local role authenticated;
select test.debe_fallar(format($q$insert into storage.objects (bucket_id, name, owner_id, metadata)
                                  values ('adjuntos-ot', %L, %L, '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":10}'::jsonb)$q$,
                               'ot/' || current_setting('prueba.orden') || '/' || gen_random_uuid() || '.xlsx', current_setting('prueba.almacen')),
  'Almacén no sube el Excel del cronograma', 'row-level security');
reset role;

-- ============================================ 4. Diseño quita lo que guardó por error
select test.como_usuario(:'diseno_id');
set local role authenticated;
do $$
declare
  v_ruta text;
  v integer;
begin
  delete from public.ot_adjuntos where orden_id = current_setting('prueba.orden')::uuid and tipo = 'CRONOGRAMA'
  returning ruta_storage into v_ruta;
  perform test.afirmar(v_ruta = current_setting('prueba.excel'), 'Diseño quita de la orden el Excel que guardó');
  delete from storage.objects where bucket_id = 'adjuntos-ot' and name = v_ruta;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'y el archivo sale de Storage');
end $$;
reset role;

rollback;
