begin;

select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='COMPRADOR' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
select set_config('prueba.compra',(select id::text from public.ordenes_compra_materiales order by creado_en desc limit 1),true);
select set_config('prueba.documento',gen_random_uuid()::text,true);
insert into storage.objects(bucket_id,name,owner_id,metadata) values('documentos-compras','compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf',current_setting('request.jwt.claim.sub'),'{"mimetype":"application/pdf","size":5}'::jsonb);
set local role authenticated;
do $$ declare v_id uuid; begin
 if not exists(select 1 from storage.objects where name='compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf') then raise exception 'FAIL: Logística no puede comprobar su archivo'; end if;
 begin
 insert into public.documentos_compra_material(id,orden_compra_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por) values(current_setting('prueba.documento')::uuid,current_setting('prueba.compra')::uuid,'FACTURA','Prueba.pdf','compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf','application/pdf',6,public.usuario_actual());
 raise exception 'FAIL: aceptó tamaño falso';
 exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'El tamaño o tipo%' then raise; end if; end;
 insert into public.documentos_compra_material(id,orden_compra_id,tipo,nombre_archivo,ruta_storage,mime_type,tamano_bytes,subido_por) values(current_setting('prueba.documento')::uuid,current_setting('prueba.compra')::uuid,'FACTURA','Prueba.pdf','compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf','application/pdf',5,public.usuario_actual()) returning id into v_id;
 if v_id is null then raise exception 'FAIL: no registró factura'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='SUPERVISOR' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin if exists(select 1 from storage.objects where name='compra/'||current_setting('prueba.compra')||'/'||current_setting('prueba.documento')||'.pdf') then raise exception 'FAIL: Supervisión leyó documento financiero'; end if; end $$;
reset role;
select 'OK: Logística registra, tamaño falso rechazado y Supervisión sin acceso al PDF financiero. Ensayo revertido.' as comprobacion;
rollback;
