begin;
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='ALMACENERO' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if has_function_privilege('authenticated','public.despachar_material(uuid,uuid,public.cantidad,uuid)','EXECUTE') then raise exception 'FAIL: sigue abierta la entrega sin foto'; end if;
 if not has_function_privilege('authenticated','public.despachar_material_con_foto(uuid,uuid,numeric,uuid,text,text)','EXECUTE') then raise exception 'FAIL: cerró también la entrega con evidencia'; end if;
 begin
   perform public.despachar_material(gen_random_uuid(),gen_random_uuid(),1::public.cantidad,gen_random_uuid());
   raise exception 'FAIL: Almacén pudo usar la función antigua';
 exception when insufficient_privilege then null;end;
 if has_table_privilege('authenticated','public.movimientos_materiales','INSERT') then raise exception 'FAIL: puede saltar el despacho por inserción directa'; end if;
end $$;
reset role;
select 'OK: despacho sin foto y escritura directa cerrados; RPC con evidencia disponible.' as comprobacion;
rollback;
