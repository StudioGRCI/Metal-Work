-- Un archivo de 0 bytes no es un documento, y el que una cotización nombra no
-- lo borra nadie, tampoco el administrador (migración 20261022141500). Con las
-- cuentas reales y `set local role authenticated`: Diseño no anota un Excel
-- vacío como cronograma, y sí uno con peso; Ventas no registra una cotización
-- con un PDF vacío, y sí una con peso; el administrador no quita de Storage el
-- PDF que una cotización nombra, y sí uno suelto. El armazón lo pone el
-- administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA416', 'Taller prueba 416') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA416' \gset
select test.crear_usuario('Ada', 'Admin', 'admin416@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Dina', 'Diseño', 'diseno416@demo.pe', 'DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas416@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.ventas', :'ventas_id', true);

-- Las tres tablas llevan la regla, y en una base limpia queda validada.
select test.afirmar((select count(*) from pg_constraint
                      where conname in ('ot_adjuntos_tamano_no_vacio', 'cotizaciones_pdf_tamano_no_vacio',
                                        'cotizaciones_pdf_versiones_tamano_no_vacio')
                        and convalidated) = 3,
  'El PDF de la orden, la cotización y sus versiones no aceptan 0 bytes');

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000416', 'QA CLIENTE 416') returning id as cliente_id \gset
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('9416-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY'), :'cliente_id', :'sede_id', 'FABRICACION', 'NORMAL',
        'Tolva 416 con cronograma', 'APROBADA')
returning id as orden_id \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
select set_config('prueba.orden', :'orden_id', true);
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.carroceria', :'carroceria_id', true);
select set_config('prueba.excel', 'ot/' || :'orden_id' || '/' || gen_random_uuid() || '.xlsx', true);
select set_config('prueba.cotizacion', gen_random_uuid()::text, true);
select set_config('prueba.pdf', 'cot/' || current_setting('prueba.cotizacion') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.suelto', 'cot/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf', true);

-- ============================================ 1. El Excel vacío no se anota en la orden
select test.como_usuario(:'diseno_id');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('adjuntos-ot', current_setting('prueba.excel'), current_setting('prueba.diseno'),
        '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":4096}'::jsonb);
select test.debe_fallar(format($q$insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
                                  values (%L, 'CRONOGRAMA', 'vacio-416.xlsx', %L,
                                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 0, %L)$q$,
                               current_setting('prueba.orden'), current_setting('prueba.excel'), current_setting('prueba.diseno')),
  'Diseño no anota un Excel de 0 bytes como cronograma', 'ot_adjuntos_tamano_no_vacio');
insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (current_setting('prueba.orden')::uuid, 'CRONOGRAMA', 'cronograma-416.xlsx', current_setting('prueba.excel'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4096, current_setting('prueba.diseno')::uuid);
reset role;
select test.afirmar((select tamano_bytes from public.ot_adjuntos where ruta_storage = current_setting('prueba.excel')) = 4096,
  'y sí uno con peso');

-- ============================================ 2. La cotización con un PDF vacío no se registra
select test.como_usuario(:'ventas_id');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', current_setting('prueba.pdf'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":120}'::jsonb),
       ('cotizaciones-pdf', current_setting('prueba.suelto'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":120}'::jsonb);
select test.debe_fallar(format($q$insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
                                  values (%L, 'QA-PDF-416', %L, %L, 'POR_REVISAR', 'vacia-416.pdf', %L, 'application/pdf', 0, %L)$q$,
                               current_setting('prueba.cotizacion'), current_setting('prueba.cliente'), current_setting('prueba.carroceria'),
                               current_setting('prueba.pdf'), current_setting('prueba.ventas')),
  'Ventas no registra una cotización con un PDF de 0 bytes', 'cotizaciones_pdf_tamano_no_vacio');
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
values (current_setting('prueba.cotizacion')::uuid, 'QA-PDF-416', current_setting('prueba.cliente')::uuid, current_setting('prueba.carroceria')::uuid,
        'POR_REVISAR', 'cotizacion-416.pdf', current_setting('prueba.pdf'), 'application/pdf', 120, current_setting('prueba.ventas')::uuid);
reset role;
select test.afirmar((select tamano_bytes from public.cotizaciones_pdf where id = current_setting('prueba.cotizacion')::uuid) = 120,
  'y sí una con peso');

-- ============================================ 3. El administrador no borra el PDF que una cotización nombra
select test.como_usuario(:'admin_id');
set local role authenticated;
do $$
declare
  v integer;
begin
  delete from storage.objects where bucket_id = 'cotizaciones-pdf' and name = current_setting('prueba.pdf');
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'El administrador no quita de Storage el PDF que una cotización nombra');
  delete from storage.objects where bucket_id = 'cotizaciones-pdf' and name = current_setting('prueba.suelto');
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'y sí uno suelto, que ninguna cotización nombra');
end $$;
reset role;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'cotizaciones-pdf' and name = current_setting('prueba.pdf')) = 1,
  'el PDF de la cotización sigue en Storage');

rollback;
