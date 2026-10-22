-- Lo que llegó malo vuelve al proveedor, y si no lo repone, Logística lo recompra
-- (decisiones de DKS del 22/10, migración 20261022180000). Con la cuenta de cada
-- puesto —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Dos RQ de Maestranza piden 6 y 4 de un material que Almacén no tiene; Logística
-- compra los 10 en una sola línea de OC, el conductor la deja y Almacén la valida.
-- Almacén da por listo el segundo RQ.
--   1. Almacén devuelve 3 que llegaron rotos y el proveedor los repone: el kardex
--      baja, la OC vuelve a esperar 3, el segundo RQ (el último en pedir) se queda
--      con 1 de 4 y vuelve a «en atención». Logística no devuelve; los números
--      que no cuadran no pasan.
--   2. Llegan 2 de la reposición; Logística dice que el 1 que falta ya no viene:
--      la OC deja de esperarlo y el segundo RQ se parte: 3 que ya tiene y 1 nuevo,
--      sin compra, que Logística puede comprar en otra OC. Contabilidad recibe el
--      aviso de la nota de crédito.
--   3. Almacén devuelve 3 más, sin reposición: el segundo RQ se queda sin nada que
--      esperar de la OC y su insumo se suelta entero; el primero no pierde nada.
--   4. Lo que ya salió al taller no se devuelve sin volver antes al almacén; quien
--      no es de Almacén no ve la lista.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'SUPERVISOR:MTZ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GGE',
                           'CONDUCTOR:LOG', 'CONTABILIDAD:CON'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.426@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 426', lower(replace(v, ':', '.')) || '.426@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 426') = 7,
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
  values ('CHK426-1', 'Disco de corte de prueba 426', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.unidades (placa, tipo_vehiculo, marca, codigo_interno, activo)
  values ('CHK-426', 'CAMION', 'Volvo', 'CHK426_A', true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 426'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(426000, 426200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 426'), true);
end $$;

-- Requerimientos pide 6 y después 4; Almacén no tiene nada.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq_a')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK426_A', 'Discos para la prueba 426', null, format('[{"material_id": "%s", "cantidad": 6}]', current_setting('prueba.m1'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq_b')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK426_A', 'Más discos para la prueba 426', null, format('[{"material_id": "%s", "cantidad": 4}]', current_setting('prueba.m1'))::jsonb);
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
  current_setting('prueba.proveedor')::uuid, 'COT-426', null, 'CONTADO', 0, 'PEN', true);
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

select pg_temp.como('almacenero');
set local role authenticated;
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 10 and pg_temp.pendiente() = 0, 'antes: 10 en el kardex y nada pendiente de la OC');
  perform test.afirmar(pg_temp.llegado('rq_a') = 6 and pg_temp.llegado('rq_b') = 4, 'antes: al primer RQ le llegaron 6 y al segundo 4');
  perform test.afirmar((select estado from public.requerimientos where id = current_setting('prueba.rq_b')::uuid) = 'LISTO_EN_ALMACEN',
    'antes: el segundo RQ está listo en almacén');
  perform test.afirmar((select se_puede from public.ingresos_para_devolver() where ingreso_id = current_setting('prueba.ing')::uuid) = 10,
    'Almacén ve el ingreso de la compra con 10 para devolver');
end $$;
reset role;

-- ============================================ 1. Devolución con reposición
-- Logística no devuelve: lo hace Almacén.
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 3, 'GR-426-1', 'Llegaron con el disco partido', true)$q$,
  gen_random_uuid(), current_setting('prueba.ing')), 'Logística no registra la devolución al proveedor');
select test.debe_fallar('select * from public.ingresos_para_devolver()', 'Logística no lee la lista de lo que se puede devolver');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 11, 'GR-426-1', 'Llegaron con el disco partido', true)$q$,
  gen_random_uuid(), current_setting('prueba.ing')), 'no se devuelve más de lo que entró');
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 3, 'GR-426-1', 'roto', true)$q$,
  gen_random_uuid(), current_setting('prueba.ing')), 'sin un motivo que se entienda no se devuelve');
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 3, 'GR-426-1', 'Llegaron con el disco partido', null)$q$,
  gen_random_uuid(), current_setting('prueba.ing')), 'hay que decir si el proveedor lo repone');
select public.devolver_al_proveedor(current_setting('prueba.dev1')::uuid, current_setting('prueba.ing')::uuid, 3, 'GR-426-1',
  'Llegaron con el disco partido', true);
-- El mismo envío otra vez no devuelve dos veces.
select public.devolver_al_proveedor(current_setting('prueba.dev1')::uuid, current_setting('prueba.ing')::uuid, 3, 'GR-426-1',
  'Llegaron con el disco partido', true);
do $$
begin
  perform test.afirmar((select count(*) from public.movimientos_materiales where devuelve_ingreso = current_setting('prueba.ing')::uuid) = 1,
    'el reintento no devolvió dos veces');
  perform test.afirmar(pg_temp.saldo() = 7, 'el kardex baja a 7: lo devuelto sale del almacén');
  perform test.afirmar((select salida from public.v_kardex_almacen where id = current_setting('prueba.dev1')::uuid) = 3
    and (select movimiento from public.v_kardex_almacen where id = current_setting('prueba.dev1')::uuid) = 'DEVOLUCION_PROVEEDOR',
    'el kardex muestra la devolución como un egreso de 3');
  perform test.afirmar(pg_temp.pendiente() = 3 and pg_temp.recibido() = 7, 'la OC vuelve a esperar 3 y tiene 7 en mano');
  perform test.afirmar(pg_temp.llegado('rq_a') = 6 and pg_temp.llegado('rq_b') = 1,
    'lo devuelto le falta al último en pedir: el primero sigue con 6 y el segundo queda con 1');
  perform test.afirmar((select estado from public.requerimientos where id = current_setting('prueba.rq_b')::uuid) = 'EN_ATENCION',
    'el segundo RQ ya no está listo: vuelve a «en atención»');
  perform test.afirmar((select estado from public.requerimientos where id = current_setting('prueba.rq_a')::uuid) = 'EN_ATENCION',
    'el primero, que no estaba listo, no cambia');
  perform test.afirmar((select se_puede from public.ingresos_para_devolver() where ingreso_id = current_setting('prueba.ing')::uuid) = 7,
    'del ingreso quedan 7 para devolver');
  perform test.afirmar((select devuelto - repuesto from public.devoluciones_por_reponer()
                         where devolucion_id = current_setting('prueba.dev1')::uuid) = 3,
    'la devolución espera 3 de reposición');
  perform test.afirmar(not exists (select 1 from public.requerimiento_lineas where recompra_de is not null
                                    and requerimiento_id = current_setting('prueba.rq_b')::uuid),
    'con reposición no se recompra nada');
end $$;
reset role;
do $$
begin
  perform test.afirmar(exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.comprador')::uuid
                                  and titulo like 'Devuelto al proveedor:%' and cuerpo like '%El proveedor lo repone.%'),
    'Logística recibe el aviso de la devolución, con que el proveedor la repone');
  perform test.afirmar(not exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.contabilidad')::uuid
                                      and titulo like 'Espera la nota de crédito:%'),
    'con reposición, Contabilidad no espera nota de crédito');
end $$;

-- Logística ve lo que espera reposición; Requerimientos no.
select pg_temp.como('comprador');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.devoluciones_por_reponer() where devolucion_id = current_setting('prueba.dev1')::uuid) = 1,
    'Logística ve la devolución que espera reposición');
end $$;
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar('select * from public.devoluciones_por_reponer()', 'Requerimientos no lee las devoluciones al proveedor');
reset role;

-- ============================================ 2. Llega parte de la reposición y el resto ya no
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.recibir_reposicion('%s', '%s', 4, 'GR-PROV-426')$q$,
  gen_random_uuid(), current_setting('prueba.dev1')), 'no se repone más de lo devuelto');
select public.recibir_reposicion(current_setting('prueba.rep1')::uuid, current_setting('prueba.dev1')::uuid, 2, 'GR-PROV-426');
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 9 and pg_temp.pendiente() = 1, 'entran 2 de la reposición: 9 en el kardex y falta 1');
  perform test.afirmar(pg_temp.llegado('rq_b') = 3, 'al segundo RQ le llegan 3');
end $$;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(format($q$select public.dejar_de_esperar_reposicion('%s', 'no')$q$, current_setting('prueba.dev1')),
  'sin motivo no se deja de esperar la reposición');
select public.dejar_de_esperar_reposicion(current_setting('prueba.dev1')::uuid, 'El proveedor ya no tiene ese disco: emite nota de crédito');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.recibir_reposicion('%s', '%s', 1, 'GR-PROV-426-B')$q$,
  gen_random_uuid(), current_setting('prueba.dev1')), 'lo que ya no se espera no entra como reposición');
do $$
declare v_nueva public.requerimiento_lineas%rowtype;
begin
  perform test.afirmar(pg_temp.pendiente() = 0 and pg_temp.recibido() = 9, 'la OC ya no espera nada y tiene 9 en mano');
  perform test.afirmar((select cantidad from public.requerimiento_lineas where id = current_setting('prueba.linea_b')::uuid) = 3,
    'el insumo del segundo RQ se queda con los 3 que tiene');
  select * into v_nueva from public.requerimiento_lineas
   where requerimiento_id = current_setting('prueba.rq_b')::uuid and recompra_de = current_setting('prueba.linea_b')::uuid;
  perform test.afirmar(v_nueva.id is not null and v_nueva.cantidad = 1 and v_nueva.item = 2 and v_nueva.orden_compra_id is null
    and v_nueva.cantidad_en_stock = 0 and v_nueva.material_id = current_setting('prueba.m1')::uuid
    and v_nueva.recompra_por = current_setting('prueba.dev1')::uuid,
    'el que falta pasa a un insumo nuevo del mismo RQ, sin compra, que dice de dónde salió');
  perform set_config('prueba.linea_nueva', v_nueva.id::text, true);
  perform test.afirmar(pg_temp.llegado('rq_a') = 6 and pg_temp.llegado('rq_b') = 3, 'el primero sigue con 6 y el segundo con sus 3');
  perform test.afirmar(not exists (select 1 from public.devoluciones_por_reponer() where devolucion_id = current_setting('prueba.dev1')::uuid),
    'la devolución ya no está en la lista de lo que espera reposición');
end $$;
reset role;
do $$
begin
  perform test.afirmar(exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.contabilidad')::uuid
                                  and titulo like 'Espera la nota de crédito:%'),
    'Contabilidad recibe el aviso de que viene una nota de crédito');
  perform test.afirmar(exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.requerimientos')::uuid
                                  and titulo like 'Por comprar otra vez:%'),
    'quien pidió el RQ sabe que se compra otra vez');
  perform test.afirmar((select reposicion_cancelada_por from public.movimientos_materiales where id = current_setting('prueba.dev1')::uuid)
                         = current_setting('prueba.comprador')::uuid, 'queda quién dijo que ya no se repone');
end $$;
-- El avance del RQ lo muestra por comprar, y Logística lo compra en otra OC.
select pg_temp.como('comprador');
set local role authenticated;
do $$ begin
  perform test.afirmar((select l->>'etapa' from public.avance_de_requerimientos(array[current_setting('prueba.rq_b')::uuid]) a,
                               jsonb_array_elements(a.lineas) l where (l->>'item')::int = 2) = 'POR_COMPRAR',
    'el insumo nuevo sale «por comprar» en el avance del RQ');
end $$;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc2')::uuid,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 1, 'precio', 8,
                                       'insumos', jsonb_build_array(current_setting('prueba.linea_nueva')))),
  current_setting('prueba.proveedor')::uuid, 'COT-426-B', null, 'CONTADO', 0, 'PEN', true);
reset role;
do $$ begin
  perform test.afirmar((select orden_compra_id from public.requerimiento_lineas where id = current_setting('prueba.linea_nueva')::uuid)
                         = current_setting('prueba.oc2')::uuid, 'Logística compra lo que falta en otra OC');
end $$;

-- ============================================ 3. Sin reposición, el insumo se suelta entero
select pg_temp.como('almacenero');
set local role authenticated;
select public.devolver_al_proveedor(current_setting('prueba.dev2')::uuid, current_setting('prueba.ing')::uuid, 3, 'GR-426-2',
  'Tres discos más con fisuras al revisarlos', false);
do $$
begin
  perform test.afirmar(pg_temp.saldo() = 6 and pg_temp.pendiente() = 0 and pg_temp.recibido() = 6,
    'sin reposición: 6 en el kardex y la OC no espera nada');
  perform test.afirmar((select orden_compra_id is null and orden_compra_detalle_id is null and atendida_en is null
                          from public.requerimiento_lineas where id = current_setting('prueba.linea_b')::uuid),
    'el insumo del segundo RQ, que se queda sin nada de la OC, se suelta de ella entero');
  perform test.afirmar((select cantidad from public.requerimiento_lineas where id = current_setting('prueba.linea_b')::uuid) = 3,
    'y conserva lo que pidió');
  perform test.afirmar(pg_temp.llegado('rq_a') = 6, 'el primer RQ no pierde nada');
  perform test.afirmar((select l->>'etapa' from public.avance_de_requerimientos(array[current_setting('prueba.rq_b')::uuid]) a,
                               jsonb_array_elements(a.lineas) l where (l->>'item')::int = 1) = 'POR_COMPRAR',
    'el insumo suelto vuelve a «por comprar»');
end $$;

-- ============================================ 4. Lo que salió al taller y quien no es de Almacén
-- Salen 5 al taller (como dueño, para no armar la salida entera): quedan 1 en el almacén.
savepoint con_salida;
reset role;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           registrado_por, codigo_unidad)
values (current_setting('prueba.sal')::uuid, 'SALIDA', current_setting('prueba.m1')::uuid, 5, 'SALIDA_GENERAL', 'Vale 426',
        'Operario de prueba 426', current_setting('prueba.almacenero')::uuid, 'CHK426_A');
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 2, 'GR-426-3', 'Dos discos más con fisuras', false)$q$,
  gen_random_uuid(), current_setting('prueba.ing')), 'no se devuelve lo que ya salió al taller');
do $$ begin
  perform test.afirmar((select se_puede from public.ingresos_para_devolver() where ingreso_id = current_setting('prueba.ing')::uuid) = 1,
    'la lista ofrece solo lo que hay en el almacén');
end $$;
reset role;
rollback to savepoint con_salida;

select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar(format($q$select public.devolver_al_proveedor('%s', '%s', 1, 'GR-426-4', 'Un disco con fisuras', true)$q$,
  gen_random_uuid(), current_setting('prueba.ing')), 'Maestranza no devuelve al proveedor');
select test.debe_fallar(format($q$select public.dejar_de_esperar_reposicion('%s', 'Maestranza no decide esto')$q$,
  current_setting('prueba.dev2')), 'Maestranza no dice que ya no se repone');
reset role;

-- Lo que el sistema anota solo no lo escribe nadie a mano.
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$update public.movimientos_materiales set se_repone = true where id = '%s'$q$, current_setting('prueba.dev2')),
  'la devolución no se corrige a mano');
select test.debe_fallar('select public.recomprar_lo_devuelto(null, null)', 'la recompra la hace el sistema, no se llama');
reset role;

rollback;
