-- Dos requerimientos: el de operación (Maestranza, Producción, Acabados y
-- Almacén) lo registra Requerimientos y lo compra Logística; el de
-- Administración (la oficina) lo registra y lo compra la administradora. Los
-- dos pasan primero por Almacén, que revisa cada insumo y anota cuánto tiene:
-- se compra solo lo que falta. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS RQ S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.349@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 349', lower(replace(v, ':', '.')) || '.349@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['MTZ', 'PRD', 'RRH', 'SAP', 'GCO'] loop
    perform set_config('prueba.area_' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  foreach v in array array['rqo', 'rqo2', 'rqo3', 'rqa', 'rqa2', 'rqa3', 'oc1', 'oc2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  -- Lo que se compra y a quién, como dueño de las tablas.
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK349-1', 'Plancha LAF 2 mm (prueba 349)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid),
         ('CHK349-2', 'Disco de corte (prueba 349)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid);
  perform set_config('prueba.m1', (select id::text from public.materiales where codigo = 'CHK349-1'), true);
  perform set_config('prueba.m2', (select id::text from public.materiales where codigo = 'CHK349-2'), true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20999349006', 'Proveedor de prueba 349', 'Av. Argentina 457, Lima', '999 333 447');
  perform set_config('prueba.prov', (select id::text from public.proveedores where numero_documento = '20999349006'), true);
  update public.regla_aprobacion_compras set activa = false where unica;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- n insumos: 5, 4 y 2 unidades.
create or replace function pg_temp.lineas(n int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('descripcion', d, 'cantidad', c, 'unidad_medida_id', current_setting('prueba.und'),
                                      'categoria_id', current_setting('prueba.cat')) order by o)
    from (values (1, 'Plancha LAF 2 mm 4x8', 5), (2, 'Disco de corte 4 1/2', 4), (3, 'Electrodo 1/8', 2)) x(o, d, c)
   where o <= n;
$$;

create or replace function pg_temp.rq(p text) returns public.requerimientos language sql as $$
  select * from public.requerimientos where id = current_setting('prueba.' || p)::uuid;
$$;

create or replace function pg_temp.stock(p text) returns numeric[] language sql as $$
  select array_agg(cantidad_en_stock order by item) from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p)::uuid;
$$;

create or replace function pg_temp.avisos(p_cuenta text, p_rq text, p_titulo text) returns int language sql as $$
  select count(*)::int from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_cuenta)::uuid and origen_id = current_setting('prueba.' || p_rq)::uuid
     and titulo like p_titulo || '%';
$$;

create or replace function pg_temp.comprar(p_oc text, p_rq text, p_items text) returns text language sql as $$
  select format($q$select public.emitir_compra_del_requerimiento('%s', '%s', %s, '%s', null,
    '[{"material_id": "%s", "cantidad": 2, "precio": 10}, {"material_id": "%s", "cantidad": 3, "precio": 4.5}]'::jsonb,
    null, 'CONTADO', 0, 'PEN', true)$q$,
    current_setting('prueba.' || p_oc), current_setting('prueba.' || p_rq), p_items, current_setting('prueba.prov'),
    current_setting('prueba.m1'), current_setting('prueba.m2'));
$$;

-- ============================================ 1. Qué área pide qué
select test.afirmar((select array_agg(codigo order by codigo) from public.areas where requerimiento = 'OPERACION')
                    = array['ACB', 'ALM', 'MTZ', 'PRD'], 'el de operación lo piden Acabados, Almacén, Maestranza y Producción');
select test.afirmar((select requerimiento = 'ADMINISTRACION' and activo from public.areas where codigo = 'SAP'),
                    'Servicios de apoyo existe y pide por el de Administración');
select test.afirmar((select bool_and(requerimiento = 'ADMINISTRACION') from public.areas
                      where codigo in ('RRH', 'LOG', 'DIS', 'ING', 'GGE', 'GCO')),
                    'RR. HH., Logística, Diseño, Ingeniería, Gerencia y Ventas piden por el de Administración');
select test.afirmar(exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                             where r.codigo = 'ADMINISTRACION' and rp.permiso_codigo = 'requerimientos.administracion'),
                    'la administradora tiene requerimientos.administracion');
select test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                 where r.codigo in ('REQUERIMIENTOS', 'COMPRADOR') and rp.permiso_codigo = 'requerimientos.administracion'),
                    'ni Requerimientos ni Logística tienen el de Administración');

-- ============================================ 2. Requerimientos: solo el de operación
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqo')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK349_SR_1', 'Armado de la tolva de prueba 349', null, pg_temp.lineas(3));
select public.emitir_requerimiento(current_setting('prueba.rqo3')::uuid, 'OPERACION', current_setting('prueba.area_prd')::uuid,
  'CHK349_SR_2', 'Pintura de la tolva de prueba 349', null, pg_temp.lineas(2));
select test.debe_fallar(format($q$select public.emitir_requerimiento(gen_random_uuid(), 'OPERACION', '%s', 'PLANTA',
  'Útiles para la oficina de prueba', null, pg_temp.lineas(1))$q$, current_setting('prueba.area_rrh')),
  'RR. HH. no pide por el de operación', 'requerimiento de Administración');
select test.debe_fallar(format($q$select public.emitir_requerimiento(gen_random_uuid(), 'ADMINISTRACION', '%s', 'PLANTA',
  'Útiles para la oficina de prueba', null, pg_temp.lineas(1))$q$, current_setting('prueba.area_rrh')),
  'Requerimientos no registra el de Administración', 'permiso');
-- La función de antes, sin tipo, es la de operación.
select public.emitir_requerimiento(current_setting('prueba.rqo2')::uuid, current_setting('prueba.area_prd')::uuid,
  'PLANTA', 'Consumibles de soldadura de prueba', null, pg_temp.lineas(2));
select test.debe_fallar(format($q$select public.emitir_requerimiento(gen_random_uuid(), '%s', 'PLANTA',
  'Consumibles de prueba para Servicios', null, pg_temp.lineas(1))$q$, current_setting('prueba.area_sap')),
  'sin tipo tampoco pide Servicios de apoyo', 'requerimiento de operación');
reset role;
select test.afirmar((pg_temp.rq('rqo')).tipo = 'OPERACION' and (pg_temp.rq('rqo')).numero like 'RQ-%', 'el de operación sale RQ-…');
select test.afirmar((pg_temp.rq('rqo2')).tipo = 'OPERACION', 'el de la función de antes es de operación');

-- ============================================ 3. La administradora: solo el de Administración
select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqa')::uuid, 'ADMINISTRACION', current_setting('prueba.area_rrh')::uuid,
  'PLANTA', 'Útiles de oficina para RR. HH.', null, pg_temp.lineas(2));
select public.emitir_requerimiento(current_setting('prueba.rqa2')::uuid, 'ADMINISTRACION', current_setting('prueba.area_sap')::uuid,
  'PLANTA', 'Limpieza para Servicios de apoyo', null, pg_temp.lineas(1));
select public.emitir_requerimiento(current_setting('prueba.rqa3')::uuid, 'ADMINISTRACION', current_setting('prueba.area_gco')::uuid,
  'PLANTA', 'Folletos para Ventas de prueba', null, pg_temp.lineas(1));
select test.debe_fallar(format($q$select public.emitir_requerimiento(gen_random_uuid(), 'ADMINISTRACION', '%s', 'PLANTA',
  'Soldadura para la tolva de prueba', null, pg_temp.lineas(1))$q$, current_setting('prueba.area_mtz')),
  'Maestranza no pide por el de Administración', 'requerimiento de operación');
select test.debe_fallar(format($q$select public.emitir_requerimiento(gen_random_uuid(), 'OPERACION', '%s', 'PLANTA',
  'Soldadura para la tolva de prueba', null, pg_temp.lineas(1))$q$, current_setting('prueba.area_mtz')),
  'la administradora no registra el de operación', 'permiso');
select test.afirmar((select count(*) from public.requerimientos where id = current_setting('prueba.rqo')::uuid) = 1,
  'la administradora ve el de operación');
reset role;
select test.afirmar((pg_temp.rq('rqa')).tipo = 'ADMINISTRACION' and (pg_temp.rq('rqa')).numero like 'RQA-%', 'el de Administración sale RQA-…');
select test.afirmar(pg_temp.avisos('almacenero', 'rqa', 'Requerimiento por revisar') = 1, 'el de Administración pasa primero por Almacén');

-- ============================================ 4. Almacén revisa cada insumo
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 1}]', null)$q$,
  current_setting('prueba.rqo')), 'no se revisa a medias', 'cada insumo');
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 6}, {"item": 2, "en_stock": 1}, {"item": 3, "en_stock": 0}]', null)$q$,
  current_setting('prueba.rqo')), 'no tiene más de lo pedido', 'de 0 a la cantidad');
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": -1}, {"item": 2, "en_stock": 1}, {"item": 3, "en_stock": 0}]', null)$q$,
  current_setting('prueba.rqo')), 'ni menos de cero', 'de 0 a la cantidad');
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 5}, {"item": 1, "en_stock": 5}, {"item": 3, "en_stock": 0}]', null)$q$,
  current_setting('prueba.rqo')), 'ni un insumo dos veces', 'una vez');
select public.rq_revisar_stock(current_setting('prueba.rqo')::uuid,
  '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 1.5}, {"item": 3, "en_stock": 0}]', 'Del electrodo no hay');
select public.rq_revisar_stock(current_setting('prueba.rqo')::uuid,
  '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 1.5}, {"item": 3, "en_stock": 0}]', 'Del electrodo no hay');
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 2}, {"item": 3, "en_stock": 0}]', null)$q$,
  current_setting('prueba.rqo')), 'lo revisado no se vuelve a revisar con otro número', 'ya pasó');
select public.rq_revisar_stock(current_setting('prueba.rqa2')::uuid, '[{"item": 1, "en_stock": 5}]', null);
select public.rq_revisar_stock(current_setting('prueba.rqo3')::uuid, '[{"item": 1, "en_stock": 0}, {"item": 2, "en_stock": 0}]', null);
-- Los botones de antes: «sin stock» es cero de todo y «listo» es todo de todo.
select public.rq_marcar_sin_stock(current_setting('prueba.rqa')::uuid, null);
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rqo2')::uuid, 'Estante B');
reset role;
select test.afirmar((pg_temp.rq('rqo')).estado = 'SIN_STOCK', 'con algo que falta, el RQ queda por comprar');
select test.afirmar(pg_temp.stock('rqo') = array[5, 1.5, 0]::numeric[], 'queda lo que Almacén tiene de cada insumo');
select test.afirmar((pg_temp.rq('rqa2')).estado = 'LISTO_EN_ALMACEN', 'con todo, el RQ queda listo en almacén');
select test.afirmar((pg_temp.rq('rqa')).estado = 'SIN_STOCK' and pg_temp.stock('rqa') = array[0, 0]::numeric[], '«sin stock» anota cero en cada insumo');
select test.afirmar((pg_temp.rq('rqo2')).estado = 'LISTO_EN_ALMACEN' and pg_temp.stock('rqo2') = array[5, 4]::numeric[], '«listo» anota todo en cada insumo');
select test.afirmar(
  pg_temp.avisos('comprador', 'rqo', 'Requerimiento por comprar') = 1
  and (select cuerpo from public.notificaciones where usuario_id = current_setting('prueba.comprador')::uuid
          and origen_id = current_setting('prueba.rqo')::uuid and titulo like 'Requerimiento por comprar%') like '%comprar 2 de 3 insumos%2.5 UND Disco%2 UND Electrodo%',
  'a Logística le llega solo lo que falta del de operación');
select test.afirmar(pg_temp.avisos('administracion', 'rqo', 'Requerimiento por comprar') = 0, 'la administradora no recibe el de operación');
select test.afirmar(pg_temp.avisos('administracion', 'rqa', 'Requerimiento por comprar') = 1, 'a la administradora le llega el suyo por comprar');
select test.afirmar(pg_temp.avisos('comprador', 'rqa', 'Requerimiento por comprar') = 0, 'Logística no recibe el de Administración');
select test.afirmar(pg_temp.avisos('administracion', 'rqa2', 'Listo en almacén') = 1, 'a la administradora le avisan que el suyo está listo');
select test.debe_fallar(format($q$update public.requerimiento_lineas set cantidad_en_stock = 0 where requerimiento_id = '%s' and item = 1$q$,
  current_setting('prueba.rqo')), 'lo que Almacén anotó no se cambia', 'ya revisó');

-- ============================================ 5. El avance cuenta lo que hay en almacén
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar(
  (select lineas from public.avance_de_requerimientos(array[current_setting('prueba.rqo')::uuid]))
    @> '[{"item": 1, "etapa": "EN_STOCK", "por_comprar": 0}, {"item": 2, "etapa": "POR_COMPRAR", "en_stock": 1.5, "por_comprar": 2.5}, {"item": 3, "etapa": "POR_COMPRAR", "por_comprar": 2}]',
  'el avance dice qué tiene Almacén y qué falta comprar de cada insumo');
reset role;

-- ============================================ 6. Cada uno compra lo suyo, y solo lo que falta
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(pg_temp.comprar('oc1', 'rqa', 'null'), 'Logística no compra el de Administración',
  'No tienes permiso para hacer la orden de compra de un requerimiento de Administración');
select test.debe_fallar(format($q$select public.rq_marcar_en_atencion('%s', null)$q$, current_setting('prueba.rqa')),
  'ni lo marca en compra', 'No tienes permiso para hacer la orden de compra de un requerimiento de Administración');
select test.debe_fallar(pg_temp.comprar('oc1', 'rqo', 'array[1]::smallint[]'), 'lo que Almacén tiene completo no se compra', 'Almacén ya tiene completo');
select public.emitir_compra_del_requerimiento(current_setting('prueba.oc1')::uuid, current_setting('prueba.rqo')::uuid, null,
  current_setting('prueba.prov')::uuid, null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m2'), 'cantidad', 2.5, 'precio', 4.5)),
  null, 'CONTADO', 0, 'PEN', true);
reset role;
select test.afirmar((select array_agg(orden_compra_id::text order by item) from public.requerimiento_lineas
                      where requerimiento_id = current_setting('prueba.rqo')::uuid)
                    = array[null, current_setting('prueba.oc1'), current_setting('prueba.oc1')],
                    'la OC cubre solo los insumos que faltaban');
select test.afirmar((pg_temp.rq('rqo')).estado = 'EN_ATENCION', 'el de operación queda en compra');

select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(pg_temp.comprar('oc2', 'rqo3', 'null'), 'la administradora no compra el de operación',
  'No tienes permiso para hacer la orden de compra de un requerimiento de operación');
select test.debe_fallar(format($q$select public.rq_marcar_en_atencion('%s', null)$q$, current_setting('prueba.rqo3')),
  'ni lo marca en compra', 'No tienes permiso para hacer la orden de compra de un requerimiento de operación');
select public.emitir_compra_del_requerimiento(current_setting('prueba.oc2')::uuid, current_setting('prueba.rqa')::uuid, null,
  current_setting('prueba.prov')::uuid, null,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 5, 'precio', 2)),
  null, 'CONTADO', 0, 'PEN', true);
select test.afirmar((select count(*) from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid) = 1,
  'la administradora ve la OC que hizo');
reset role;
select test.afirmar((pg_temp.rq('rqa')).estado = 'EN_ATENCION', 'el de Administración queda en compra');
select test.afirmar((select codigo_interno from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid) = 'PLANTA',
  'la OC lleva el código del RQ');

-- ============================================ 7. Lo anula quien lo registra
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya no hace falta en la oficina')$q$, current_setting('prueba.rqa3')),
  'Requerimientos no anula el de Administración', 'permiso');
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya no hace falta en la planta')$q$, current_setting('prueba.rqo3')),
  'la administradora no anula el de operación', 'permiso');
select public.anular_requerimiento(current_setting('prueba.rqa3')::uuid, 'Ya no hace falta en la oficina');
reset role;
select test.afirmar((pg_temp.rq('rqa3')).estado = 'ANULADO', 'la administradora anula el suyo');

-- ============================================ 8. Ventas no ve ninguno
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar((select count(*) from public.requerimientos) = 0, 'Ventas no ve ningún RQ');
reset role;

rollback;
