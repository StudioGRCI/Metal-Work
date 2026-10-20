-- La compra que nace del requerimiento de una OT sigue el mismo circuito que la
-- directa: lista para comprarse, sale sola hacia el conductor; él la recoge y la
-- deja, y Almacén recibe el ingreso pendiente atado a la OT. Probado con el rol
-- que hace cada trabajo (nunca como ADMIN) y `set local role authenticated`.
-- Termina en rollback.
begin;

-- ----------------------------------------------------------------- armazón
-- Una cuenta por puesto, cada una en su área, como en producción (como el check
-- 330). Antes se tomaba de la base la primera cuenta activa de cada rol, y en
-- una base sin esas cuentas el check se caía antes de probar nada.
do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG:comprador', 'GERENTE:GGE:gerente', 'SUPERVISOR:PRD:supervisor', 'CONDUCTOR:LOG:conductor'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 3)) || '.329@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 329', lower(split_part(v, ':', 3)) || '.329@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- ----------------------------------------------------------------- armazón
-- Un proveedor del padrón y una OT con una línea de 10 derivada a compra. Cada
-- compra de la prueba lleva 2 de esa línea. Se arma como dueño de las tablas.
do $$
declare v_id uuid; v_ot uuid; v_req uuid; v_mat uuid; v_om uuid; v_det uuid;
begin
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono, contacto)
  values ('20100047218', 'PROVEEDOR DE PRUEBA 329', 'Av. Argentina 456, Lima', '999 333 444', 'Lucho')
  on conflict (tipo_documento, numero_documento) do update set activo = true
  returning id into v_id;
  perform set_config('prueba.proveedor', v_id::text, true);

  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Prueba de recojo · check 329')
  returning id into v_ot;
  perform set_config('prueba.ot', v_ot::text, true);
  perform set_config('prueba.ot_numero', (select numero::text from public.ordenes_trabajo where id = v_ot), true);
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (v_ot, 'PRD', current_setting('prueba.supervisor')::uuid) returning id into v_req;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK329-REQ', 'Material de requerimiento 329',
          (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1))
  returning id into v_mat;
  perform set_config('prueba.mat', v_mat::text, true);
  insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
  values (v_ot, v_mat, 10, 'PRD') returning id into v_om;
  insert into public.requerimiento_material_detalles
    (requerimiento_id, ot_material_id, cantidad_solicitada, aprobacion_diseno, decision_almacen, cantidad_stock)
  values (v_req, v_om, 10, 'APROBADO', 'COMPRA', 0) returning id into v_det;
  update public.requerimiento_material_detalles
     set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0
   where id = v_det;
  perform set_config('prueba.det', v_det::text, true);

  update public.regla_aprobacion_compras set activa = false where unica;
  perform set_config('prueba.oc1', gen_random_uuid()::text, true);
  perform set_config('prueba.oc2', gen_random_uuid()::text, true);
  perform set_config('prueba.oc3', gen_random_uuid()::text, true);
end $$;

-- ================================== 1. SIN APROBACIÓN QUE PEDIR: SALE SOLA
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_agrupada(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-329A',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det'), 'cantidad', 2, 'precio', 15)),
  null, 'CONTADO', 0, 'PEN', true, 'PLANTA');
set constraints all immediate;
select test.afirmar(
  (select aprobacion = 'NO_REQUERIDA' and recojo = 'POR_RECOGER' and recojo_pedido_en is not null
          and recojo_pedido_por = current_setting('prueba.comprador')::uuid
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'con la regla apagada, la compra de requerimiento sale sola hacia el conductor al emitirse');
-- Ya está con el conductor: «Mandar a recojo» no hace nada.
select test.afirmar(public.mandar_compra_a_recojo(current_setting('prueba.oc1')::uuid) = current_setting('prueba.oc1')::uuid,
  'volver a mandarla a recojo no la mueve');
-- Logística la pone en la lista del conductor con su peso (migración 20261015140000).
select public.programar_recojo(current_setting('prueba.oc1')::uuid, 25, null);
reset role;

select test.afirmar(
  exists (select 1 from public.notificaciones
           where usuario_id = current_setting('prueba.conductor')::uuid and ruta = '/recojos'
             and origen_id = current_setting('prueba.oc1')::uuid),
  'al conductor le llega el aviso del recojo');

select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select current_setting('prueba.ot_numero') = any(r.ordenes)
     from public.compras_para_recojo() r where r.id = current_setting('prueba.oc1')::uuid),
  'el conductor ve la compra con el número de su OT');
select public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid);
reset role;

select test.afirmar(
  (select count(*) from public.ingresos_pendientes_almacen
    where orden_compra_id = current_setting('prueba.oc1')::uuid and estado = 'PENDIENTE' and cantidad = 2
      and requerimiento_detalle_id = current_setting('prueba.det')::uuid and orden_id = current_setting('prueba.ot')::uuid
      and material_id = current_setting('prueba.mat')::uuid) = 1,
  'al dejarla, Almacén tiene el ingreso pendiente con su línea de requerimiento y su OT');

-- ================================== 2. CON APROBACIÓN: SALE AL APROBARSE
-- Gerencia enciende la regla desde S/ 0: todas las de requerimiento le pasan.
select pg_temp.como('gerente');
set local role authenticated;
select public.fijar_regla_aprobacion_compras(true, 0, (select id from public.roles where codigo = 'GERENTE'));
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_agrupada(current_setting('prueba.oc2')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-329B',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det'), 'cantidad', 2, 'precio', 15)),
  null, 'CONTADO', 0, 'PEN', true, 'PLANTA');
set constraints all immediate;
select test.afirmar(
  (select aprobacion = 'POR_APROBAR' and recojo is null
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid),
  'con la regla desde S/ 0, la de requerimiento espera a Gerencia y no sale todavía');
select test.debe_fallar(
  format($q$select public.mandar_compra_a_recojo('%s')$q$, current_setting('prueba.oc2')),
  'Logística no la manda a recojo mientras espera a Gerencia');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc2')::uuid);
reset role;
select test.afirmar(
  (select aprobacion = 'APROBADA' and recojo = 'POR_RECOGER' and recojo_pedido_por = current_setting('prueba.gerente')::uuid
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid),
  'aprobada por Gerencia, la de requerimiento sale sola hacia el conductor');

-- ================================== 3. UNA DE ANTES, SIN PRECIO: SALE AL PONÉRSELO
-- Las compras de antes podían nacer sin precio. Se arma una así como dueño de
-- las tablas (con los disparadores quietos), y Logística le pone el precio.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_agrupada(current_setting('prueba.oc3')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-329C',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det'), 'cantidad', 2, 'precio', 15)),
  null, 'CONTADO', 0, 'PEN', true, 'PLANTA');
set constraints all immediate;
reset role;
set local session_replication_role = replica;
update public.orden_compra_material_detalles set precio_unitario = null where orden_compra_id = current_setting('prueba.oc3')::uuid;
update public.ordenes_compra_materiales
   set aprobacion = 'NO_REQUERIDA', aprobacion_pedida_en = null, recojo = null, recojo_pedido_en = null, recojo_pedido_por = null
 where id = current_setting('prueba.oc3')::uuid;
update public.regla_aprobacion_compras set activa = false where unica;
set local session_replication_role = origin;

select test.afirmar(
  (select recojo is null from public.ordenes_compra_materiales where id = current_setting('prueba.oc3')::uuid),
  'la compra de antes, sin precio, todavía no está con el conductor');

select pg_temp.como('comprador');
set local role authenticated;
select public.fijar_precio_compra_material(
  (select id from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc3')::uuid), 15);
set constraints all immediate;
reset role;
select test.afirmar(
  (select aprobacion = 'NO_REQUERIDA' and recojo = 'POR_RECOGER'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc3')::uuid),
  'con todos sus precios, la compra de antes sale sola hacia el conductor');

do $$ begin raise notice 'OK 329: la OC de requerimiento sigue el circuito del conductor'; end $$;
rollback;
