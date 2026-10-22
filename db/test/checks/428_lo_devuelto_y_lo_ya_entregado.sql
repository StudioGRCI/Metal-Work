-- Lo devuelto al proveedor no le falta a quien ya lo recibió (migración 20261022185000;
-- los dos casos los encontró el auditor de funcionamiento el 22/10). Con la cuenta de
-- cada puesto y `set local role authenticated`. Termina en rollback.
--
-- Dos RQ comparten una línea de OC de 10: el primero pide 6 y el segundo 4.
--   G. Al segundo, el más nuevo, ya se le entregaron sus 4. Almacén devuelve 3 sin
--      reposición: le faltan al primero, que sigue abierto; él se parte y Logística
--      compra esos 3. El segundo no cambia.
--   H. Lo mismo, pero con reposición y 5 de otro ingreso: «Stock en almacén» le separa
--      al primero lo que le llegó (3), no 6, y deja libres los 5 (auditor, 22/10).
--   J. Los dos RQ se entregaron de otro stock antes de que llegara la OC: lo de la
--      OC sigue en el almacén y se devuelve (auditor de realización, 22/10).
--   I. Todo lo de la OC ya salió al taller con sus RQ y en el almacén hay 5 de otro
--      ingreso: no se devuelve «de la OC» lo que ya no está, ni se ofrece.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GGE',
                           'CONDUCTOR:LOG', 'CONTABILIDAD:CON'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.428@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 428', lower(replace(v, ':', '.')) || '.428@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 428') = 6,
    'se crearon los siete usuarios del check, uno por puesto');
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rq_a', 'rq_b', 'oc', 'oc2', 'ing', 'dev1', 'rep1', 'dev2', 'sal'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Armazón, como dueño: un material sin stock y un proveedor con un RUC inventado.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK428-1', 'Disco de corte de prueba 428', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.unidades (placa, tipo_vehiculo, marca, codigo_interno, activo)
  values ('CHK-428', 'CAMION', 'Volvo', 'CHK428_A', true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 428'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(428000, 428200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 428'), true);
end $$;

-- Requerimientos pide 6 y después 4; Almacén no tiene nada.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq_a')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK428_A', 'Discos para la prueba 428', null, format('[{"material_id": "%s", "cantidad": 6}]', current_setting('prueba.m1'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq_b')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK428_A', 'Más discos para la prueba 428', null, format('[{"material_id": "%s", "cantidad": 4}]', current_setting('prueba.m1'))::jsonb);
reset role;
-- En la misma transacción los dos tienen la misma hora: el reparto sigue el número, y el segundo va después.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq_a')::uuid, '[{"item": 1, "en_stock": 0}]'::jsonb, null);
select public.rq_revisar_stock(current_setting('prueba.rq_b')::uuid, '[{"item": 1, "en_stock": 0}]'::jsonb, null);
reset role;
select set_config('prueba.insumos',
  (select jsonb_agg(l.id order by r.numero) from public.requerimiento_lineas l join public.requerimientos r on r.id = l.requerimiento_id
    where r.id in (current_setting('prueba.rq_a')::uuid, current_setting('prueba.rq_b')::uuid))::text, true);
select set_config('prueba.linea_b',
  (select l.id::text from public.requerimiento_lineas l where l.requerimiento_id = current_setting('prueba.rq_b')::uuid), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc')::uuid,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 10, 'precio', 8,
                                       'insumos', current_setting('prueba.insumos')::jsonb)),
  current_setting('prueba.proveedor')::uuid, 'COT-428', null, 'CONTADO', 0, 'PEN', true);
reset role;
select set_config('prueba.por_aprobar',
  (select (aprobacion = 'POR_APROBAR')::text from public.ordenes_compra_materiales where id = current_setting('prueba.oc')::uuid), true);
select set_config('prueba.detalle',
  (select id::text from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc')::uuid), true);
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc')::uuid) where current_setting('prueba.por_aprobar')::boolean;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.mandar_compra_a_recojo(current_setting('prueba.oc')::uuid);
select public.programar_recojo(current_setting('prueba.oc')::uuid, 25, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(current_setting('prueba.oc')::uuid);
select public.marcar_compra_recogida(current_setting('prueba.oc')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc')::uuid);
reset role;
select set_config('prueba.ingresos',
  (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', current_setting('prueba.ing'), 'cantidad', 10))
     from public.ingresos_pendientes_almacen i where i.orden_compra_id = current_setting('prueba.oc')::uuid)::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(current_setting('prueba.oc')::uuid, current_setting('prueba.ingresos')::jsonb, null);
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq_b')::uuid, null);
reset role;

-- Lo que dicen las cuentas, leídas como Almacén.
create or replace function pg_temp.pendiente() returns numeric language sql as $$
  select cantidad_pendiente::numeric from public.v_orden_compra_material_pendiente where id = current_setting('prueba.detalle')::uuid
$$;
create or replace function pg_temp.recibido() returns numeric language sql as $$
  select cantidad_recibida::numeric from public.v_orden_compra_material_pendiente where id = current_setting('prueba.detalle')::uuid
$$;
create or replace function pg_temp.llegado(p_rq text) returns numeric language sql as $$
  select sum(e.llegado) from public.entregado_de_requerimientos(array[current_setting('prueba.' || p_rq)::uuid]) e
$$;
create or replace function pg_temp.saldo() returns numeric language sql as $$
  select coalesce(sum(entrada - salida), 0) from public.v_kardex_almacen where material_id = current_setting('prueba.m1')::uuid
$$;

-- ============================================ G. El RQ más nuevo ya se entregó
savepoint antes_de_g;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           registrado_por, codigo_unidad, codigo_interno, requerimiento_linea_id)
values (gen_random_uuid(), 'SALIDA', current_setting('prueba.m1')::uuid, 4, 'SALIDA_GENERAL', 'Vale G',
        'Operario de prueba G', current_setting('prueba.almacenero')::uuid, 'CHK428_A', 'CHK428_A', current_setting('prueba.linea_b')::uuid);
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_entregar_con_faltante(current_setting('prueba.rq_b')::uuid, 'Lo recogió el operario G', null);
select public.devolver_al_proveedor(current_setting('prueba.dev1')::uuid, current_setting('prueba.ing')::uuid, 3, 'GR-G-1',
  'Tres discos con fisuras', false);
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 3 and pg_temp.llegado('rq_a') = 3 and pg_temp.llegado('rq_b') = 4,
    'quedan 3 en el almacén: al primero le llegaron 3, y el segundo sigue con los 4 que se llevó');
  perform test.afirmar((select string_agg(format('%s:%s', l.item, l.cantidad::numeric), ',' order by l.item)
                          from public.requerimiento_lineas l where l.requerimiento_id = current_setting('prueba.rq_a')::uuid
                            and (l.orden_compra_detalle_id is not null or l.recompra_por = current_setting('prueba.dev1')::uuid)) = '1:3.000,2:3.000',
    'el primero se parte: 3 que tiene de la OC y 3 que Logística compra otra vez');
  perform test.afirmar((select count(*) from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq_b')::uuid) = 1
    and (select cantidad from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq_b')::uuid) = 4,
    'el segundo, ya entregado, no cambia');
end $$;
reset role;
do $$
begin
  perform test.afirmar(not exists (select 1 from public.notificaciones where titulo = 'Devuelto sin reponer: ' ||
                         (select numero from public.requerimientos where id = current_setting('prueba.rq_b')::uuid)),
    'a quien ya recibió todo no se le avisa que le falta');
end $$;
rollback to savepoint antes_de_g;

-- ============================================ H. Con reposición: lo separado y lo llegado dicen lo mismo
savepoint antes_de_h;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           registrado_por, codigo_unidad, codigo_interno, requerimiento_linea_id)
values (gen_random_uuid(), 'SALIDA', current_setting('prueba.m1')::uuid, 4, 'SALIDA_GENERAL', 'Vale H',
        'Operario de prueba H', current_setting('prueba.almacenero')::uuid, 'CHK428_A', 'CHK428_A', current_setting('prueba.linea_b')::uuid);
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.m1')::uuid, 5, 'INGRESO_GENERAL', 'Saldo de otra obra H',
        current_setting('prueba.almacenero')::uuid);
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_entregar_con_faltante(current_setting('prueba.rq_b')::uuid, 'Lo recogió el operario H', null);
select public.devolver_al_proveedor(current_setting('prueba.dev1')::uuid, current_setting('prueba.ing')::uuid, 3, 'GR-H-1',
  'Tres discos con fisuras', true);
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 8 and pg_temp.llegado('rq_a') = 3, 'quedan 8 en el almacén y al primero le llegaron 3');
  perform test.afirmar((select libre from public.stock_libre_en_almacen(array[current_setting('prueba.m1')::uuid])) = 5,
    'de los 8, al primero se le separan sus 3 y quedan libres los 5 del otro ingreso');
end $$;
reset role;
rollback to savepoint antes_de_h;

-- ============================================ J. Se entregó de otro stock antes de que llegara la OC
savepoint antes_de_j;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, registrado_en)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.m1')::uuid, 10, 'INGRESO_GENERAL', 'Saldo de otra obra J',
        current_setting('prueba.almacenero')::uuid, now() - interval '2 hours');
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           registrado_por, codigo_unidad, codigo_interno, requerimiento_linea_id, registrado_en)
select gen_random_uuid(), 'SALIDA', current_setting('prueba.m1')::uuid, l.cantidad, 'SALIDA_GENERAL', 'Vale J',
       'Operario de prueba J', current_setting('prueba.almacenero')::uuid, 'CHK428_A', 'CHK428_A', l.id, now() - interval '1 hour'
  from public.requerimiento_lineas l
 where l.requerimiento_id in (current_setting('prueba.rq_a')::uuid, current_setting('prueba.rq_b')::uuid);
do $$
begin
  perform test.afirmar((select count(*) from public.movimientos_materiales where documento_referencia = 'Vale J' and registrado_en < now()) = 2,
    'las dos entregas quedaron antes de que llegara la OC');
end $$;
select pg_temp.como('almacenero');
set local role authenticated;
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 10, 'en el almacén siguen los 10 de la OC');
  perform test.afirmar(exists (select 1 from public.ingresos_para_devolver() where ingreso_id = current_setting('prueba.ing')::uuid),
    'el ingreso de la OC se ofrece para devolver');
end $$;
select public.devolver_al_proveedor(current_setting('prueba.dev1')::uuid, current_setting('prueba.ing')::uuid, 3, 'GR-J-1',
  'Tres discos con fisuras', false);
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 7, 'se devuelven 3 de los 10 de la OC');
end $$;
reset role;
rollback to savepoint antes_de_j;

-- ============================================ I. Lo de la OC ya salió al taller
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           registrado_por, codigo_unidad, codigo_interno, requerimiento_linea_id)
select gen_random_uuid(), 'SALIDA', current_setting('prueba.m1')::uuid, l.cantidad, 'SALIDA_GENERAL', 'Vale I',
       'Operario de prueba I', current_setting('prueba.almacenero')::uuid, 'CHK428_A', 'CHK428_A', l.id
  from public.requerimiento_lineas l
 where l.requerimiento_id in (current_setting('prueba.rq_a')::uuid, current_setting('prueba.rq_b')::uuid);
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.m1')::uuid, 5, 'INGRESO_GENERAL', 'Saldo de otra obra',
        current_setting('prueba.almacenero')::uuid);
select pg_temp.como('almacenero');
set local role authenticated;
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 5, 'en el almacén hay 5, de otro ingreso');
  perform test.afirmar(not exists (select 1 from public.ingresos_para_devolver() where ingreso_id = current_setting('prueba.ing')::uuid),
    'el ingreso de la OC ya no se ofrece para devolver');
end $$;
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 3, 'GR-I-1', 'Tres discos con fisuras', false)$q$,
  current_setting('prueba.dev1'), current_setting('prueba.ing')), 'no se devuelve de la OC lo que ya se entregó a sus RQ');
reset role;

rollback;
