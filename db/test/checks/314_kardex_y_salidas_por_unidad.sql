-- Kardex de Almacén y salidas vinculadas a una unidad (migración 20261001100000).
-- Todo con el rol que hace el trabajo: Almacén registra, Costos solo lee y
-- Supervisión no ve ni escribe. El armazón (material, unidad, fotos) lo pone
-- postgres y se deshace con el rollback final.
\set ON_ERROR_STOP on
begin;
-- El check se arma su propio almacén: antes tomaba el primer material, la
-- última unidad y la primera cuenta de cada rol de la base, y en una base
-- vacía se quedaba con un uuid en blanco.
insert into public.empresa (ruc, razon_social) values ('20100000314', 'PRUEBAS KARDEX UNIDAD S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA314', 'Taller kardex');
select test.crear_usuario('QA', 'Admin',   'qa-314-admin@demo.pe',   'ADMIN',             (select id from public.sedes where codigo = 'QA314')) as admin_id \gset
select test.crear_usuario('QA', 'Almacen', 'qa-314-almacen@demo.pe', 'ALMACENERO',        (select id from public.sedes where codigo = 'QA314')) as almacen_id \gset
select test.crear_usuario('QA', 'Costos',  'qa-314-costos@demo.pe',  'COSTOS_MATERIALES', (select id from public.sedes where codigo = 'QA314')) as costos_id \gset
select test.crear_usuario('QA', 'Mtz',     'qa-314-mtz@demo.pe',     'SUPERVISOR',        (select id from public.sedes where codigo = 'QA314')) as supervisor_id \gset
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'ALM') where id = :'almacen_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'supervisor_id';
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000314', 'QA Cliente 314');
insert into public.unidades_medida (codigo, nombre) values ('QA-UND-314', 'Unidad prueba') on conflict (codigo) do nothing;
insert into public.categorias_material (codigo, nombre) values ('QA-CAT-314', 'Material prueba') on conflict (codigo) do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
select v.codigo, v.descripcion, c.id, u.id from public.categorias_material c, public.unidades_medida u,
  (values ('QA-MAT-314', 'Material del kardex'), ('QA-MAT-314B', 'Material de la solicitud')) v(codigo, descripcion)
 where c.codigo = 'QA-CAT-314' and u.codigo = 'QA-UND-314';
-- Una unidad con código interno para las salidas y otra, con su OT y una
-- solicitud aprobada por Diseño, para el despacho del final.
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo, codigo_interno)
select id, v.placa, 'VOLQUETE', 'VOLVO', 'FMX', v.codigo from public.clientes,
  (values ('K3A-314', 'QA-UNI-314'), ('K3B-314', null)) v(placa, codigo) where numero_documento = '20990000314';
select gen_random_uuid() as orden_id \gset
insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, sede_id, descripcion)
select :'orden_id', '9314-2099', c.id, (select id from public.unidades where placa = 'K3B-314'), (select id from public.sedes where codigo = 'QA314'), 'OT de prueba 314'
  from public.clientes c where c.numero_documento = '20990000314';
update public.ordenes_trabajo set estado = 'APROBADA' where id = :'orden_id';
insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
select :'orden_id', id, 10, 'MTZ' from public.materiales where codigo = 'QA-MAT-314B';
insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por) values (:'orden_id', 'MTZ', :'supervisor_id');
insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
select r.id, om.id, 3 from public.requerimientos_materiales r, public.ot_materiales om
 where r.orden_id = :'orden_id' and om.orden_id = :'orden_id';
update public.requerimiento_material_detalles d set aprobacion_diseno = 'APROBADO'
  from public.requerimientos_materiales r where r.id = d.requerimiento_id and r.orden_id = :'orden_id';
select set_config('prueba.material',(select id::text from public.materiales where codigo = 'QA-MAT-314'),true);
select set_config('prueba.unidad',(select id::text from public.unidades where placa = 'K3A-314'),true);
select set_config('prueba.codigo',(select upper(btrim(u.codigo_interno)) from public.unidades u where u.id=current_setting('prueba.unidad')::uuid),true);
select set_config('prueba.ingreso',gen_random_uuid()::text,true);
select set_config('prueba.salida1',gen_random_uuid()::text,true);
select set_config('prueba.salida2',gen_random_uuid()::text,true);
select set_config('prueba.salida3',gen_random_uuid()::text,true);
select set_config('prueba.devolucion',gen_random_uuid()::text,true);
select test.como_usuario(:'almacen_id');
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
select test.como_usuario(:'costos_id');
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
select test.como_usuario(:'supervisor_id');
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
select set_config('prueba.detalle',(select d.id::text from public.requerimiento_material_detalles d join public.ot_materiales om on om.id=d.ot_material_id join public.ordenes_trabajo o on o.id=om.orden_id where o.id=:'orden_id' and d.aprobacion_diseno='APROBADO' limit 1),true);
select set_config('prueba.despacho',gen_random_uuid()::text,true);
select test.como_usuario(:'almacen_id');
update public.requerimiento_material_detalles set decision_almacen='PENDIENTE',cantidad_stock=null where id=nullif(current_setting('prueba.detalle'),'')::uuid;
-- El material y la OT de la línea los lee el armazón: desde la migración
-- 20261016120000 Almacén ya no lee la OT (`ordenes.ver`) y la línea de la lista
-- técnica le queda oculta; lo que se prueba es el despacho, no esa lectura.
select set_config('prueba.material_despacho', om.material_id::text, true), set_config('prueba.orden_despacho', om.orden_id::text, true)
  from public.requerimiento_material_detalles d join public.ot_materiales om on om.id = d.ot_material_id
 where d.id = current_setting('prueba.detalle')::uuid;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('evidencias-almacen',current_setting('request.jwt.claim.sub')||'/'||current_setting('prueba.despacho')||'.jpg',current_setting('request.jwt.claim.sub'),'{"mimetype":"image/jpeg","size":100}'::jsonb);
set local role authenticated;
do $$
declare v_det uuid := nullif(current_setting('prueba.detalle'),'')::uuid;
  v_mat uuid := current_setting('prueba.material_despacho')::uuid;
  v_orden uuid := current_setting('prueba.orden_despacho')::uuid;
  v_destino uuid; v_mov record;
begin
  if v_det is null then raise exception 'FAIL: el armazón no dejó una solicitud aprobada'; end if;
  perform public.registrar_ingreso_almacen(gen_random_uuid(),v_mat,1000,'INGRESO_GENERAL','ENSAYO REVERTIDO',5,'PEN');
  perform public.revisar_stock_requerimiento(v_det,'STOCK');
  select u.id into v_destino from public.usuarios u join public.areas a on a.id=u.area_id
   where u.activo and a.codigo=(select r.area_destino from public.requerimientos_materiales r join public.requerimiento_material_detalles d on d.requerimiento_id=r.id where d.id=v_det) limit 1;
  perform public.despachar_material_con_foto(current_setting('prueba.despacho')::uuid,v_det,1,v_destino,'Persona de prueba',auth.uid()::text||'/'||current_setting('prueba.despacho')||'.jpg');
  select orden_id, orden_numero, codigo_unidad into v_mov from public.v_kardex_almacen where id=current_setting('prueba.despacho')::uuid;
  -- Desde la migración 20261016120000 Almacén ya no lee la OT: el kardex le
  -- trae el vínculo (`orden_id`) y la unidad, pero no el número de la OT, que
  -- la pantalla muestra solo cuando llega. El número se comprueba abajo con
  -- Costos, que sí lee la OT.
  if v_mov.orden_id is distinct from v_orden or v_mov.codigo_unidad is null then
    raise exception 'FAIL: el despacho no hereda OT y unidad (%, %, %)', v_mov.orden_id, v_mov.orden_numero, v_mov.codigo_unidad;
  end if;
end $$;
reset role;
select test.como_usuario(:'costos_id');
set local role authenticated;
do $$ begin
  if (select orden_numero from public.v_kardex_almacen where id=current_setting('prueba.despacho')::uuid) is distinct from '9314-2099' then
    raise exception 'FAIL: el kardex no nombra la OT del despacho a quien lee la OT';
  end if;
end $$;
reset role;
select 'OK: salida exige unidad o código, foto y saldo libre; código registrado se vincula; kardex con saldo; devolución hereda unidad; despacho hereda OT y unidad; Costos lee, Supervisión no. Ensayo revertido.' comprobacion;
rollback;
