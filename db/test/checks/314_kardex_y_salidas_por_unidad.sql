-- Kardex de Almacén y salidas vinculadas a una unidad (migración 20261001100000).
-- Todo con el rol que hace el trabajo: Almacén registra, Costos solo lee y
-- Supervisión no ve ni escribe. El armazón (material, unidad, fotos) lo pone
-- postgres y se deshace con el rollback final.
begin;
select set_config('prueba.material',(select m.id::text from public.materiales m
  where m.activo and not m.unidad_pendiente
    and not exists (select 1 from public.ot_materiales om join public.requerimiento_material_detalles d on d.ot_material_id=om.id where om.material_id=m.id)
  order by m.codigo limit 1),true);
select set_config('prueba.unidad',(select u.id::text from public.unidades u where u.activo and nullif(btrim(u.codigo_interno),'') is not null order by u.creado_en desc limit 1),true);
select set_config('prueba.codigo',(select upper(btrim(u.codigo_interno)) from public.unidades u where u.id=current_setting('prueba.unidad')::uuid),true);
select set_config('prueba.ingreso',gen_random_uuid()::text,true);
select set_config('prueba.salida1',gen_random_uuid()::text,true);
select set_config('prueba.salida2',gen_random_uuid()::text,true);
select set_config('prueba.salida3',gen_random_uuid()::text,true);
select set_config('prueba.devolucion',gen_random_uuid()::text,true);
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='ALMACENERO' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'evidencias-almacen',current_setting('request.jwt.claim.sub')||'/'||current_setting(s)||'.jpg',current_setting('request.jwt.claim.sub'),'{"mimetype":"image/jpeg","size":100}'::jsonb
  from unnest(array['prueba.salida1','prueba.salida2','prueba.salida3']) s;

set local role authenticated;
do $$
declare
  v_mat uuid := current_setting('prueba.material')::uuid;
  v_uni uuid := current_setting('prueba.unidad')::uuid;
  v_uid text := auth.uid()::text;
  v_id uuid; v_n int; v_saldo numeric; v_txt text; v_otra uuid;
begin
  if v_mat is null or v_uni is null then raise exception 'FAIL: el armazón no encontró material o unidad'; end if;
  perform public.registrar_ingreso_almacen(current_setting('prueba.ingreso')::uuid,v_mat,10,'INGRESO_GENERAL','ENSAYO REVERTIDO',5,'PEN');

  -- Una salida sin destino no entra; con los dos destinos tampoco.
  begin
    perform public.registrar_salida_almacen(current_setting('prueba.salida1')::uuid,v_mat,3,null,null,'Consumo de prueba','Persona de prueba',v_uid||'/'||current_setting('prueba.salida1')||'.jpg');
    raise exception 'FAIL: salida sin unidad';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'Vincula la salida%' then raise; end if; end;
  begin
    perform public.registrar_salida_almacen(current_setting('prueba.salida1')::uuid,v_mat,3,v_uni,'OTRO-CODIGO','Consumo de prueba','Persona de prueba',v_uid||'/'||current_setting('prueba.salida1')||'.jpg');
    raise exception 'FAIL: salida con dos destinos';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'Vincula la salida%' then raise; end if; end;
  -- Sin foto no sale.
  begin
    perform public.registrar_salida_almacen(gen_random_uuid(),v_mat,1,v_uni,null,'Consumo de prueba','Persona de prueba',null);
    raise exception 'FAIL: salida sin foto';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'Indica material%' then raise; end if; end;

  -- A un vehículo registrado; repetir el envío no duplica.
  v_id := public.registrar_salida_almacen(current_setting('prueba.salida1')::uuid,v_mat,3,v_uni,null,'Consumo de prueba','Persona de prueba',v_uid||'/'||current_setting('prueba.salida1')||'.jpg');
  if public.registrar_salida_almacen(v_id,v_mat,3,v_uni,null,'Consumo de prueba','Persona de prueba',v_uid||'/'||current_setting('prueba.salida1')||'.jpg')<>v_id then
    raise exception 'FAIL: salida duplicada';
  end if;
  select codigo_unidad into v_txt from public.v_kardex_almacen where id=v_id;
  if v_txt is null or v_txt not like '%'||current_setting('prueba.codigo')||'%' then raise exception 'FAIL: la salida no nombra su unidad (%)', v_txt; end if;

  -- A un código escrito a mano que no está registrado.
  perform public.registrar_salida_almacen(current_setting('prueba.salida2')::uuid,v_mat,2,null,'  ensayo-cod-01 ','Consumo de prueba','Persona de prueba',v_uid||'/'||current_setting('prueba.salida2')||'.jpg');
  select unidad_id, codigo_unidad into v_otra, v_txt from public.v_kardex_almacen where id=current_setting('prueba.salida2')::uuid;
  if v_otra is not null or v_txt<>'ENSAYO-COD-01' then raise exception 'FAIL: código escrito mal guardado (%, %)', v_otra, v_txt; end if;

  -- El código de una unidad registrada se vincula a ella.
  perform public.registrar_salida_almacen(current_setting('prueba.salida3')::uuid,v_mat,1,null,lower(current_setting('prueba.codigo')),'Consumo de prueba','Persona de prueba',v_uid||'/'||current_setting('prueba.salida3')||'.jpg');
  if (select unidad_id from public.v_kardex_almacen where id=current_setting('prueba.salida3')::uuid) is distinct from v_uni then
    raise exception 'FAIL: el código de una unidad registrada no se vinculó a ella';
  end if;

  -- No sale más de lo que hay.
  begin
    perform public.registrar_salida_almacen(gen_random_uuid(),v_mat,100,v_uni,null,'Consumo de prueba','Persona de prueba',v_uid||'/x.jpg');
    raise exception 'FAIL: salida sin saldo';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'Indica material%' and sqlerrm not like 'Solo hay%' then raise; end if; end;

  -- El kardex: 10 entran, 3+2+1 salen, saldo 4.
  select count(*), sum(entrada)-sum(salida) into v_n, v_saldo from public.v_kardex_almacen where material_id=v_mat;
  if v_n<>4 or v_saldo<>4 then raise exception 'FAIL: kardex con % filas y saldo %', v_n, v_saldo; end if;
  select saldo into v_saldo from public.v_kardex_almacen where material_id=v_mat order by fecha desc, id desc limit 1;
  if v_saldo<>4 then raise exception 'FAIL: saldo final del kardex %', v_saldo; end if;

  -- La devolución de una salida general entra y hereda su unidad.
  perform public.registrar_ingreso_almacen(current_setting('prueba.devolucion')::uuid,v_mat,1,'DEVOLUCION','DEVOLUCION DE PRUEBA',null,'PEN',current_setting('prueba.salida1')::uuid);
  select codigo_unidad into v_txt from public.v_kardex_almacen where id=current_setting('prueba.devolucion')::uuid;
  if v_txt not like '%'||current_setting('prueba.codigo')||'%' then raise exception 'FAIL: la devolución no hereda la unidad'; end if;
  begin
    perform public.registrar_ingreso_almacen(gen_random_uuid(),v_mat,3,'DEVOLUCION','DEVOLUCION DE PRUEBA',null,'PEN',current_setting('prueba.salida1')::uuid);
    raise exception 'FAIL: devolvió más de lo entregado';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'La devolución supera%' then raise; end if; end;

  select count(*) into v_n from public.unidades_para_salida_almacen() u where u.id=v_uni;
  if v_n<>1 then raise exception 'FAIL: Almacén no ve la unidad para elegirla'; end if;
end $$;
reset role;

-- Costos y Materiales lee el kardex pero no saca material.
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='COSTOS_MATERIALES' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.v_kardex_almacen where material_id=current_setting('prueba.material')::uuid)<>5 then
    raise exception 'FAIL: Costos no ve el kardex completo';
  end if;
  begin
    perform public.registrar_salida_almacen(gen_random_uuid(),current_setting('prueba.material')::uuid,1,current_setting('prueba.unidad')::uuid,null,'Consumo de prueba','Persona de prueba','x');
    raise exception 'FAIL: Costos registró una salida';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Supervisión no ve el kardex ni las unidades de Almacén, y no saca material.
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='SUPERVISOR' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.v_kardex_almacen)<>0 then raise exception 'FAIL: Supervisión lee el kardex'; end if;
  begin
    perform public.registrar_salida_almacen(gen_random_uuid(),current_setting('prueba.material')::uuid,1,current_setting('prueba.unidad')::uuid,null,'Consumo de prueba','Persona de prueba','x');
    raise exception 'FAIL: Supervisión registró una salida';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.unidades_para_salida_almacen();
    raise exception 'FAIL: Supervisión lee las unidades de Almacén';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('authenticated','public.nombre_unidad_almacen(public.unidades)','EXECUTE')
     or has_function_privilege('authenticated','public.fn_destino_movimiento_almacen()','EXECUTE') then
    raise exception 'FAIL: funciones internas abiertas a authenticated';
  end if;
end $$;
reset role;

-- El despacho de una solicitud hereda la unidad y la OT.
select set_config('prueba.detalle',(select d.id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id join public.ordenes_trabajo o on o.id=om.orden_id where o.estado::text<>'ANULADA' and d.aprobacion_diseno='APROBADO' and o.unidad_id is not null limit 1),true);
select set_config('prueba.despacho',gen_random_uuid()::text,true);
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='ALMACENERO' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
update public.requerimiento_material_detalles set decision_almacen='PENDIENTE',cantidad_stock=null where id=nullif(current_setting('prueba.detalle'),'')::uuid;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('evidencias-almacen',current_setting('request.jwt.claim.sub')||'/'||current_setting('prueba.despacho')||'.jpg',current_setting('request.jwt.claim.sub'),'{"mimetype":"image/jpeg","size":100}'::jsonb);
set local role authenticated;
do $$
declare v_det uuid := nullif(current_setting('prueba.detalle'),'')::uuid; v_mat uuid; v_destino uuid; v_orden uuid; v_mov record;
begin
  if v_det is null then raise notice 'Sin solicitud aprobada: no se ensaya el despacho.'; return; end if;
  select om.material_id, r.orden_id into v_mat, v_orden from public.requerimiento_material_detalles d
    join public.ot_materiales om on om.id=d.ot_material_id join public.requerimientos_materiales r on r.id=d.requerimiento_id where d.id=v_det;
  perform public.registrar_ingreso_almacen(gen_random_uuid(),v_mat,1000,'INGRESO_GENERAL','ENSAYO REVERTIDO',5,'PEN');
  perform public.revisar_stock_requerimiento(v_det,'STOCK');
  select u.id into v_destino from public.usuarios u join public.areas a on a.id=u.area_id
   where u.activo and a.codigo=(select r.area_destino from public.requerimientos_materiales r join public.requerimiento_material_detalles d on d.requerimiento_id=r.id where d.id=v_det) limit 1;
  perform public.despachar_material_con_foto(current_setting('prueba.despacho')::uuid,v_det,1,v_destino,'Persona de prueba',auth.uid()::text||'/'||current_setting('prueba.despacho')||'.jpg');
  select orden_id, orden_numero, codigo_unidad into v_mov from public.v_kardex_almacen where id=current_setting('prueba.despacho')::uuid;
  if v_mov.orden_id is distinct from v_orden or v_mov.codigo_unidad is null or v_mov.orden_numero is null then
    raise exception 'FAIL: el despacho no hereda OT y unidad (%, %, %)', v_mov.orden_id, v_mov.orden_numero, v_mov.codigo_unidad;
  end if;
end $$;
reset role;
select 'OK: salida exige unidad o código, foto y saldo libre; código registrado se vincula; kardex con saldo; devolución hereda unidad; despacho hereda OT y unidad; Costos lee, Supervisión no. Ensayo revertido.' comprobacion;
rollback;
