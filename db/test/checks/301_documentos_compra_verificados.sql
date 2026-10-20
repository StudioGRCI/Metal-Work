-- Los documentos de compra: Logística registra el PDF que ya subió, la base
-- rechaza un tamaño que no coincide con el archivo de Storage y Supervisión no
-- lee el PDF financiero.
--
-- El check se arma sus propias cuentas y su propia compra: antes leía la
-- primera cuenta COMPRADOR y la última compra de la base, y en una base vacía
-- se quedaba con un uuid en blanco.
\set ON_ERROR_STOP on
begin;

-- Como en Supabase, Storage guarda los archivos con RLS y el rol authenticated
-- llega a la tabla; el shim local no lo trae puesto.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social) values ('20100000301', 'PRUEBAS DOCUMENTOS S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA301', 'Taller documentos');

select test.crear_usuario('QA', 'Admin',     'qa-301-admin@demo.pe',     'ADMIN',      (select id from public.sedes where codigo = 'QA301')) as admin_id \gset
select test.crear_usuario('QA', 'Compras',   'qa-301-compras@demo.pe',   'COMPRADOR',  (select id from public.sedes where codigo = 'QA301')) as comprador_id \gset
select test.crear_usuario('QA', 'Supervisa', 'qa-301-super@demo.pe',     'SUPERVISOR', (select id from public.sedes where codigo = 'QA301')) as supervisor_id \gset

select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'supervisor_id';

-- Una compra directa al proveedor del padrón, sembrada como dueño de las
-- tablas: lo que se prueba aquí es el documento, no cómo nace la compra.
insert into public.proveedores (numero_documento, razon_social) values ('20100047218', 'Proveedor QA 301');
select gen_random_uuid() as compra_id \gset
insert into public.ordenes_compra_materiales (id, proveedor, proveedor_id, referencia, origen, motivo, creado_por)
values (:'compra_id', 'Proveedor QA 301', (select id from public.proveedores where numero_documento = '20100047218'),
        'QA-OC-301', 'DIRECTA', 'Compra de prueba de documentos', :'comprador_id');

select test.como_usuario(:'comprador_id');
select set_config('prueba.compra', :'compra_id', true);
select set_config('prueba.documento', gen_random_uuid()::text, true);
insert into storage.objects(bucket_id,name,owner_id,metadata) values('documentos-compras','compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf',current_setting('request.jwt.claim.sub'),'{"mimetype":"application/pdf","size":5}'::jsonb);
set local role authenticated;
do $$ declare v_id uuid; begin
 if not exists(select 1 from storage.objects where name='compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf') then raise exception 'FAIL: Logística no puede comprobar su archivo'; end if;
 begin
 insert into public.documentos_compra_material(id,orden_compra_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por,numero_documento,fecha_emision) values(current_setting('prueba.documento')::uuid,current_setting('prueba.compra')::uuid,'FACTURA','Prueba.pdf','compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf','application/pdf',6,public.usuario_actual(),'F001-1',current_date);
 raise exception 'FAIL: aceptó tamaño falso';
 exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'El tamaño o tipo%' then raise; end if; end;
 insert into public.documentos_compra_material(id,orden_compra_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por,numero_documento,fecha_emision) values(current_setting('prueba.documento')::uuid,current_setting('prueba.compra')::uuid,'FACTURA','Prueba.pdf','compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf','application/pdf',5,public.usuario_actual(),'F001-1',current_date) returning id into v_id;
 if v_id is null then raise exception 'FAIL: no registró factura'; end if;
end $$;
reset role;
select test.como_usuario(:'supervisor_id');
set local role authenticated;
do $$ begin if exists(select 1 from storage.objects where name='compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf') then raise exception 'FAIL: Supervisión leyó documento financiero'; end if; end $$;
reset role;
select 'OK: Logística registra, tamaño falso rechazado y Supervisión sin acceso al PDF financiero. Ensayo revertido.' as comprobacion;
rollback;
