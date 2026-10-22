-- Un archivo de 0 bytes no es un documento, y el que una cotización nombra no
-- lo borra nadie, tampoco el administrador (migración 20261022141500). Con las
-- cuentas reales y `set local role authenticated`: Diseño no anota un Excel
-- vacío como cronograma, ni uno vacío que dice pesar, y sí uno con peso, con
-- el tamaño que guardó Storage; Ventas no registra una cotización con un PDF
-- vacío, y sí una con peso; una cotización anterior con 0 bytes no
-- queda trabada: Gerencia la rechaza y Ventas la corrige con un PDF que pesa,
-- pero no con otro vacío; el administrador no quita de Storage el PDF que una
-- cotización nombra, y sí uno suelto. Y ninguna función que anota un archivo
-- da por registrado otro envío con el mismo id (migraciones 20261022160000,
-- 20261022177000 y 20261022180000; el caso de cada una, en los checks 347, 357,
-- 360, 361, 382, 399, 412 y 421). El armazón lo pone el administrador. Termina
-- en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA417', 'Taller prueba 417') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA417' \gset
select test.crear_usuario('Ada', 'Admin', 'admin417@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Dina', 'Diseño', 'diseno417@demo.pe', 'DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas417@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Gema', 'Gerencia', 'gerencia417@demo.pe', 'GERENTE', :'sede_id') as gerencia_id \gset
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.ventas', :'ventas_id', true);

-- La regla la lleva un disparador que juzga el archivo que llega, no una
-- restricción que se revisa en cada cambio de la fila.
select test.afirmar((select count(*) from pg_trigger
                      where tgname = 'trg_archivo_no_vacio'
                        and tgrelid in ('public.ot_adjuntos'::regclass, 'public.cotizaciones_pdf'::regclass)) = 2
                    and not exists (select 1 from pg_constraint where conname like '%\_tamano\_no\_vacio'),
  'El PDF de la orden y el de la cotización no aceptan 0 bytes, por un disparador y sin restricción');

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000417', 'QA CLIENTE 417') returning id as cliente_id \gset
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('9417-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY'), :'cliente_id', :'sede_id', 'FABRICACION', 'NORMAL',
        'Tolva 417 con cronograma', 'APROBADA')
returning id as orden_id \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
select set_config('prueba.orden', :'orden_id', true);
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.carroceria', :'carroceria_id', true);
select set_config('prueba.excel', 'ot/' || :'orden_id' || '/' || gen_random_uuid() || '.xlsx', true);
select set_config('prueba.excel_vacio', 'ot/' || :'orden_id' || '/' || gen_random_uuid() || '.xlsx', true);
select set_config('prueba.cotizacion', gen_random_uuid()::text, true);
select set_config('prueba.pdf', 'cot/' || current_setting('prueba.cotizacion') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.pdf_vacio_nuevo', 'cot/' || current_setting('prueba.cotizacion') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.suelto', 'cot/' || gen_random_uuid() || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.vieja', gen_random_uuid()::text, true);
select set_config('prueba.pdf_vacio', 'cot/' || current_setting('prueba.vieja') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.correccion', 'cot/' || current_setting('prueba.vieja') || '/' || gen_random_uuid() || '.pdf', true);
select set_config('prueba.correccion_vacia', 'cot/' || current_setting('prueba.vieja') || '/' || gen_random_uuid() || '.pdf', true);

-- ============================================ 1. El Excel vacío no se anota en la orden
select test.como_usuario(:'diseno_id');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('adjuntos-ot', current_setting('prueba.excel'), current_setting('prueba.diseno'),
        '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":4096}'::jsonb),
       ('adjuntos-ot', current_setting('prueba.excel_vacio'), current_setting('prueba.diseno'),
        '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":0}'::jsonb);
select test.debe_fallar(format($q$insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
                                  values (%L, 'CRONOGRAMA', 'vacio-417.xlsx', %L,
                                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 0, %L)$q$,
                               current_setting('prueba.orden'), current_setting('prueba.excel_vacio'), current_setting('prueba.diseno')),
  'Diseño no anota un Excel de 0 bytes como cronograma', 'El archivo está vacío');
-- El tamaño que vale es el que guardó Storage, no el que dice el navegador.
select test.debe_fallar(format($q$insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
                                  values (%L, 'CRONOGRAMA', 'dice-pesar-417.xlsx', %L,
                                          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4096, %L)$q$,
                               current_setting('prueba.orden'), current_setting('prueba.excel_vacio'), current_setting('prueba.diseno')),
  'ni uno vacío que dice pesar 4096 bytes', 'El archivo está vacío');
insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
values (current_setting('prueba.orden')::uuid, 'CRONOGRAMA', 'cronograma-417.xlsx', current_setting('prueba.excel'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, current_setting('prueba.diseno')::uuid);
reset role;
select test.afirmar((select tamano_bytes from public.ot_adjuntos where ruta_storage = current_setting('prueba.excel')) = 4096,
  'y sí uno con peso, anotado con el tamaño que guardó Storage aunque la pantalla no lo diga');

-- ============================================ 2. La cotización con un PDF vacío no se registra
select test.como_usuario(:'ventas_id');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', current_setting('prueba.pdf'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":120}'::jsonb),
       ('cotizaciones-pdf', current_setting('prueba.pdf_vacio_nuevo'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":0}'::jsonb),
       ('cotizaciones-pdf', current_setting('prueba.suelto'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":120}'::jsonb);
select test.debe_fallar(format($q$insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
                                  values (%L, 'QA-PDF-417', %L, %L, 'POR_REVISAR', 'vacia-417.pdf', %L, 'application/pdf', null, %L)$q$,
                               current_setting('prueba.cotizacion'), current_setting('prueba.cliente'), current_setting('prueba.carroceria'),
                               current_setting('prueba.pdf_vacio_nuevo'), current_setting('prueba.ventas')),
  'Ventas no registra una cotización con un PDF de 0 bytes, aunque no diga su tamaño', 'El archivo está vacío');
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
values (current_setting('prueba.cotizacion')::uuid, 'QA-PDF-417', current_setting('prueba.cliente')::uuid, current_setting('prueba.carroceria')::uuid,
        'POR_REVISAR', 'cotizacion-417.pdf', current_setting('prueba.pdf'), 'application/pdf', 120, current_setting('prueba.ventas')::uuid);
reset role;
select test.afirmar((select tamano_bytes from public.cotizaciones_pdf where id = current_setting('prueba.cotizacion')::uuid) = 120,
  'y sí una con peso');

-- ============================================ 3. La cotización anterior con 0 bytes no queda trabada
-- Así quedaron las que se registraron antes de la regla: se siembra sin
-- disparadores, como estaban.
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', current_setting('prueba.pdf_vacio'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":0}'::jsonb);
set local session_replication_role = replica;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, version, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por)
values (current_setting('prueba.vieja')::uuid, 'QA-VACIA-417', current_setting('prueba.cliente')::uuid, current_setting('prueba.carroceria')::uuid,
        'POR_REVISAR', 1, 'vacia-de-antes.pdf', current_setting('prueba.pdf_vacio'), 'application/pdf', 0, current_setting('prueba.ventas')::uuid);
set local session_replication_role = origin;

select test.como_usuario(:'gerencia_id');
set local role authenticated;
do $$
declare
  v integer;
begin
  update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'El PDF llegó vacío: súbelo otra vez.'
   where id = current_setting('prueba.vieja')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Gerencia rechaza la cotización anterior con 0 bytes: cambiar su estado no juzga el archivo');
end $$;
reset role;

select test.como_usuario(:'ventas_id');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('cotizaciones-pdf', current_setting('prueba.correccion'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":1000}'::jsonb),
       ('cotizaciones-pdf', current_setting('prueba.correccion_vacia'), current_setting('prueba.ventas'), '{"mimetype":"application/pdf","size":0}'::jsonb);
do $$
declare
  v integer;
begin
  update public.cotizaciones_pdf
     set ruta_storage = current_setting('prueba.correccion'), nombre_archivo = 'corregida-417.pdf', mime_type = 'application/pdf',
         tamano_bytes = 1000, motivo_correccion = 'El PDF anterior estaba vacío'
   where id = current_setting('prueba.vieja')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas la corrige con un PDF que pesa');
end $$;
select test.debe_fallar(format($q$update public.cotizaciones_pdf
                                    set ruta_storage = %L, nombre_archivo = 'otra-vacia-417.pdf', tamano_bytes = 0,
                                        motivo_correccion = 'Vuelvo a subir el PDF'
                                  where id = %L$q$,
                               current_setting('prueba.correccion_vacia'), current_setting('prueba.vieja')),
  'pero no con otro PDF de 0 bytes', 'El archivo está vacío');
reset role;
select test.afirmar((select version = 2 and tamano_bytes = 1000 and estado = 'POR_REVISAR'
                       from public.cotizaciones_pdf where id = current_setting('prueba.vieja')::uuid)
                    and (select tamano_bytes = 0 from public.cotizaciones_pdf_versiones
                          where cotizacion_id = current_setting('prueba.vieja')::uuid and version = 1),
  'la corrección vuelve a revisión y la versión vacía queda archivada como estaba');

-- ============================================ 4. El administrador no borra el PDF que una cotización nombra
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

-- ============================================ 5. El mismo envío, y no otro
-- La pantalla repite el envío cuando no le llegó la respuesta; si la fila ya
-- está, la función la reconoce por su archivo y por quién la anotó. Ninguna
-- función que recibe la ruta de un archivo puede darla por registrada solo
-- porque el id coincide: otro envío con el mismo id dejaría su archivo suelto.
-- Cualquier argumento que nombre un archivo (su ruta, el justificante, la
-- foto), el id con el nombre que tenga y otras condiciones que no miren el
-- archivo (`and documento_id = p_id`), en una línea o en varias. La primera
-- versión solo buscaba «ruta» y `id = p_id` sola, y no vio las tres
-- correcciones con justificante (migración 20261022180000, undécima pasada).
select test.afirmar(not exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and pg_get_function_arguments(p.oid) ~* '\mp_\w*(ruta|justificante|archivo|foto)\w* text'
       and p.prosrc ~* 'where\s+(\w+\.)?id\s*=\s*p_\w+(\s+and\s+[^)]*)?\)\s*then\s+return\s+p_\w+\s*;'),
  'Ninguna función que anota un archivo da por registrado otro envío con el mismo id');
-- Las fotos (`p_fotos jsonb`, o dentro de `p_codigos`) también son archivos, y
-- el id también se reconoce leyendo la fila (`select … into; if found then if
-- v.registrado_por = v_yo then return p_id`) o por algo que no es el envío
-- (`if v_reg.salida_en is not null then return p_id`). Esta segunda mirada
-- busca cualquier `if … then return` del id que no compare el envío —su
-- huella, su archivo o su nombre—: la primera no vio el reporte diario ni el
-- vehículo (duodécima pasada, migración 20261022194000).
select test.afirmar(not exists (
    select 1 from pg_proc p, regexp_matches(p.prosrc, '\mif\s+([^;]*?)\s+then\s+return\s+[pv]_\w+\s*;', 'gi') m
     where p.pronamespace = 'public'::regnamespace
       and pg_get_function_arguments(p.oid) ~* '\mp_\w*(ruta|justificante|archivo|foto|codigos)\w* (text|jsonb)'
       and m[1] !~* 'mismo_envio|nombre|ruta|archivo|justificante|huella|foto|cambios'),
  'ni lo da por registrado leyendo la fila o mirando algo que no es el envío, tampoco con fotos');

rollback;
