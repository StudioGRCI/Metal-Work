-- La orden de compra junta los insumos de varios requerimientos: Logística
-- marca lo que falta de varios RQ de operación y emite una sola orden para un
-- proveedor, con una línea por material. Cada insumo sigue anexado a su RQ y a
-- su código interno, y en el costeo cada línea se reparte entre los códigos en
-- proporción a lo que faltaba. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS RQ S.A.C.' where not exists (select 1 from public.empresa);

-- El justificante de la corrección sube a Storage, como en Supabase.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GGE', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.383@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 383', lower(replace(v, ':', '.')) || '.383@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['MTZ', 'PRD', 'RRH'] loop
    perform set_config('prueba.area_' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  foreach v in array array['rq1', 'rq2', 'rq3', 'rq4', 'rqa', 'oc1', 'oc2', 'oc3', 'oc4', 'c1'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  -- Lo que se compra y a quién, como dueño de las tablas.
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK383-1', 'Plancha LAF 2 mm (prueba 383)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid),
         ('CHK383-2', 'Disco de corte (prueba 383)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid);
  perform set_config('prueba.m1', (select id::text from public.materiales where codigo = 'CHK383-1'), true);
  perform set_config('prueba.m2', (select id::text from public.materiales where codigo = 'CHK383-2'), true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20999383000', 'Proveedor de prueba 383', 'Av. Argentina 457, Lima', '999 333 447');
  perform set_config('prueba.prov', (select id::text from public.proveedores where numero_documento = '20999383000'), true);
  -- Gerencia aprueba todas las compras, desde S/ 0.
  update public.regla_aprobacion_compras set activa = true, monto_desde = 0,
         rol_aprobador_id = (select id from public.roles where codigo = 'GERENTE') where unica;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- El id del insumo `item` del RQ `p_rq`.
create or replace function pg_temp.insumo(p_rq text, p_item int) returns text language sql as $$
  select id::text from public.requerimiento_lineas where requerimiento_id = nullif(current_setting('prueba.' || p_rq, true), '')::uuid and item = p_item;
$$;

create or replace function pg_temp.linea(p_rq text, p_item int) returns public.requerimiento_lineas language sql as $$
  select * from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p_rq)::uuid and item = p_item;
$$;

create or replace function pg_temp.rq(p text) returns public.requerimientos language sql as $$
  select * from public.requerimientos where id = current_setting('prueba.' || p)::uuid;
$$;

create or replace function pg_temp.oc(p text) returns public.ordenes_compra_materiales language sql as $$
  select * from public.ordenes_compra_materiales where id = current_setting('prueba.' || p)::uuid;
$$;

-- Emite la orden `p_oc` con estas líneas (texto JSON con {m1}, {m2} y {rqN.i} por reemplazar).
create or replace function pg_temp.comprar(p_oc text, p_lineas text) returns text language plpgsql as $$
declare v text := p_lineas; r record;
begin
  v := replace(replace(v, '{m1}', current_setting('prueba.m1')), '{m2}', current_setting('prueba.m2'));
  for r in select (regexp_matches(p_lineas, '\{(rq[0-9a]+)\.([0-9]+)\}', 'g')) as m loop
    v := replace(v, '{' || r.m[1] || '.' || r.m[2] || '}', coalesce(pg_temp.insumo(r.m[1], r.m[2]::int), gen_random_uuid()::text));
  end loop;
  return format($q$select public.emitir_compra_de_requerimientos('%s', '%s'::jsonb, '%s', null, null, 'CONTADO', 0, 'PEN', true)$q$,
                current_setting('prueba.' || p_oc), v, current_setting('prueba.prov'));
end $$;

-- ============================================ 1. Tres RQ de operación y uno de Administración
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq1')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK383_A', 'Armado de la tolva de prueba 383', null,
  format('[{"material_id": "%s", "cantidad": 5}, {"material_id": "%s", "cantidad": 4}]',
         current_setting('prueba.m1'), current_setting('prueba.m2'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq2')::uuid, 'OPERACION', current_setting('prueba.area_prd')::uuid,
  'CHK383_B', 'Pintura del furgón de prueba 383', null,
  format('[{"material_id": "%s", "cantidad": 3}, {"material_id": "%s", "cantidad": 2}]',
         current_setting('prueba.m1'), current_setting('prueba.m2'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq3')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK383_A', 'Refuerzo de la tolva de prueba 383', null,
  format('[{"material_id": "%s", "cantidad": 2}]', current_setting('prueba.m1'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq4')::uuid, 'OPERACION', current_setting('prueba.area_prd')::uuid,
  'CHK383_B', 'Discos para el furgón de prueba 383', null,
  format('[{"material_id": "%s", "cantidad": 6}]', current_setting('prueba.m2'))::jsonb);
reset role;
select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rqa')::uuid, 'ADMINISTRACION', current_setting('prueba.area_rrh')::uuid,
  'PLANTA', 'Planchas para la oficina de prueba 383', null,
  format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.m1'))::jsonb);
reset role;

-- ============================================ 2. Almacén revisa: del RQ 1 tiene todos los discos y una plancha
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq1')::uuid, '[{"item": 1, "en_stock": 1}, {"item": 2, "en_stock": 4}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq2')::uuid, '[{"item": 1, "en_stock": 0}, {"item": 2, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq4')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rqa')::uuid, '[{"item": 1, "en_stock": 0}]', null);
reset role;
select test.afirmar((pg_temp.rq('rq1')).estado = 'SIN_STOCK' and (pg_temp.rq('rq2')).estado = 'SIN_STOCK'
                    and (pg_temp.rq('rq3')).estado = 'POR_ATENDER', 'dos RQ por comprar y uno sin revisar');

-- ============================================ 3. Lo que no entra en la orden
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m2}", "cantidad": 2, "precio": 6, "insumos": ["{rq1.2}"]}]'),
  'lo que Almacén tiene completo no se compra', 'Almacén ya tiene completo');
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 6, "precio": 10, "insumos": ["{rq1.1}", "{rq3.1}"]}]'),
  'sin la revisión de Almacén no se compra', 'todavía no revisó');
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 5, "precio": 10, "insumos": ["{rq1.1}", "{rqa.1}"]}]'),
  'no se mezclan el de operación y el de Administración', 'mismo tipo');
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 5, "precio": 10, "insumos": ["{rqa.1}"]}]'),
  'Logística no compra el de Administración', 'administradora');
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 7, "precio": 10, "insumos": ["{rq1.1}"]},
                                              {"material_id": "{m2}", "cantidad": 2, "precio": 6, "insumos": ["{rq1.1}"]}]'),
  'un insumo va en una sola línea', 'una sola línea');
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 7, "precio": 10, "insumos": []}]'),
  'cada línea cubre algún insumo', 'al menos un insumo');
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 7, "precio": 10, "insumos": ["{rq9.1}"]}]'),
  'un insumo que no existe no se compra', 'ya no está');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(pg_temp.comprar('oc1', '[{"material_id": "{m1}", "cantidad": 7, "precio": 10, "insumos": ["{rq1.1}", "{rq2.1}"]}]'),
  'Ventas no emite órdenes de compra', 'permiso');
reset role;

-- ============================================ 4. Una orden para dos RQ: las planchas de los dos y los discos del RQ 2
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.emitir_compra_de_requerimientos(current_setting('prueba.oc1')::uuid,
  format('[{"material_id": "%s", "cantidad": 7, "precio": 10, "insumos": ["%s", "%s"]}, {"material_id": "%s", "cantidad": 2, "precio": 6, "insumos": ["%s"]}]',
         current_setting('prueba.m1'), pg_temp.insumo('rq1', 1), pg_temp.insumo('rq2', 1), current_setting('prueba.m2'), pg_temp.insumo('rq2', 2))::jsonb,
  current_setting('prueba.prov')::uuid, null, null, 'CONTADO', 0, 'PEN', true) = current_setting('prueba.oc1')::uuid,
  'Logística emite una orden con insumos de dos RQ');
-- El reintento devuelve la misma orden.
select test.afirmar(public.emitir_compra_de_requerimientos(current_setting('prueba.oc1')::uuid,
  format('[{"material_id": "%s", "cantidad": 7, "precio": 10, "insumos": ["%s", "%s"]}, {"material_id": "%s", "cantidad": 2, "precio": 6, "insumos": ["%s"]}]',
         current_setting('prueba.m1'), pg_temp.insumo('rq1', 1), pg_temp.insumo('rq2', 1), current_setting('prueba.m2'), pg_temp.insumo('rq2', 2))::jsonb,
  current_setting('prueba.prov')::uuid, null, null, 'CONTADO', 0, 'PEN', true) = current_setting('prueba.oc1')::uuid,
  'el reintento no emite otra');
select test.afirmar((select count(*) from public.insumos_de_compras(array[current_setting('prueba.oc1')::uuid])) = 3,
  'Logística ve los tres insumos de la orden');
select test.debe_fallar(pg_temp.comprar('oc2', '[{"material_id": "{m1}", "cantidad": 4, "precio": 10, "insumos": ["{rq1.1}"]}]'),
  'un insumo que ya tiene su orden no va en otra', 'Ya va en otra compra');
reset role;
-- La aprobación se decide al confirmar la transacción: se adelanta aquí.
set constraints all immediate;
set constraints all deferred;

select test.afirmar((select count(*) from public.ordenes_compra_materiales where proveedor_id = current_setting('prueba.prov')::uuid) = 1,
  'sale una sola orden');
select test.afirmar((select count(*) from public.orden_compra_material_detalles where orden_compra_id = current_setting('prueba.oc1')::uuid) = 2,
  'con una línea por material');
select test.afirmar((pg_temp.linea('rq1', 1)).orden_compra_id = current_setting('prueba.oc1')::uuid
                    and (pg_temp.linea('rq2', 1)).orden_compra_id = current_setting('prueba.oc1')::uuid
                    and (pg_temp.linea('rq2', 2)).orden_compra_id = current_setting('prueba.oc1')::uuid
                    and (pg_temp.linea('rq1', 2)).orden_compra_id is null,
  'cada insumo comprado queda anexado a la orden; el que estaba en stock, no');
select test.afirmar((pg_temp.linea('rq1', 1)).orden_compra_detalle_id = (pg_temp.linea('rq2', 1)).orden_compra_detalle_id
                    and (select material_id from public.orden_compra_material_detalles where id = (pg_temp.linea('rq2', 2)).orden_compra_detalle_id)
                        = current_setting('prueba.m2')::uuid,
  'las planchas de los dos RQ van en la misma línea, y los discos en la suya');
select test.afirmar((pg_temp.rq('rq1')).estado = 'EN_ATENCION' and (pg_temp.rq('rq2')).estado = 'EN_ATENCION',
  'los dos RQ pasan a en compra');
select test.afirmar((pg_temp.oc('oc1')).codigo_interno is null,
  'con insumos de dos códigos, la orden no tiene un código propio');
select test.afirmar((pg_temp.oc('oc1')).motivo like 'Atiende los requerimientos %' || (pg_temp.rq('rq1')).numero || ' (%'
                    and (pg_temp.oc('oc1')).motivo like '%' || (pg_temp.rq('rq2')).numero || ' (%',
  'el motivo nombra los dos RQ con su área');
select test.afirmar((pg_temp.oc('oc1')).aprobacion = 'POR_APROBAR', 'Gerencia la aprueba como cualquier otra');

-- ============================================ 5. El costeo de cada código: su parte de cada línea
-- Planchas: 7 × 10 = 70; faltaban 4 del código A y 3 del B → 40 y 30. Discos: 2 × 6 = 12, todo del B.
select test.afirmar((select monto from public.codigo_interno_lineas('CHK383_A', false)
                      where fuente = 'COMPRAS' and referencia_id = current_setting('prueba.oc1')::uuid) = 40,
  'el código A lleva 40 de las planchas');
select test.afirmar((select monto from public.codigo_interno_lineas('CHK383_B', false)
                      where fuente = 'COMPRAS' and referencia_id = current_setting('prueba.oc1')::uuid) = 42,
  'el código B lleva 30 de las planchas y los 12 de los discos');
select test.afirmar((select sum(monto) from public.codigo_interno_lineas(null, false)
                      where fuente = 'COMPRAS' and referencia_id = current_setting('prueba.oc1')::uuid)
                    = (select sum(cantidad * precio_unitario) from public.orden_compra_material_detalles
                        where orden_compra_id = current_setting('prueba.oc1')::uuid),
  'entre los dos códigos suman la orden entera, sin perder ni duplicar');

select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select monto = 40 and requerimientos = (pg_temp.rq('rq1')).numero
                       from public.codigo_interno_compras('CHK383_A') where id = current_setting('prueba.oc1')::uuid),
  'Gerencia ve la orden en el código A con su parte y solo el RQ de ese código');
select test.afirmar((select requerimientos = (pg_temp.rq('rq2')).numero
                       from public.codigo_interno_compras('CHK383_B') where id = current_setting('prueba.oc1')::uuid),
  'y en el código B, con el RQ del B');
reset role;

-- ============================================ 6. Un solo RQ: la orden lleva su código, como antes
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc3')::uuid,
  format('[{"material_id": "%s", "cantidad": 10, "precio": 5, "insumos": ["%s"]}]', current_setting('prueba.m2'), pg_temp.insumo('rq4', 1))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 383', null, 'CONTADO', 0, 'PEN', false);
reset role;
select test.afirmar((pg_temp.oc('oc3')).codigo_interno = 'CHK383_B'
                    and (pg_temp.oc('oc3')).motivo like 'Atiende el requerimiento ' || (pg_temp.rq('rq4')).numero || ' de %',
  'la orden de un solo RQ lleva su código y su motivo de siempre');
select test.afirmar((select monto from public.codigo_interno_lineas('CHK383_B', false)
                      where fuente = 'COMPRAS' and referencia_id = current_setting('prueba.oc3')::uuid) = 50,
  'y entera en su código, aunque compre más de lo que faltaba');

-- ============================================ 7. Quien no ve las compras no ve los insumos
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(format($q$select * from public.insumos_de_compras(array['%s']::uuid[])$q$, current_setting('prueba.oc1')),
  'Ventas no ve los insumos de las compras', 'permiso');
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.insumos_de_compras(uuid[])', 'execute')
                    and not has_function_privilege('anon', 'public.emitir_compra_de_requerimientos(uuid, jsonb, uuid, text, date, text, integer, text, boolean)', 'execute'),
  'nada de esto lo llama quien no inició sesión');

-- ============================================ 8. El código de un insumo se corrige en su RQ, no en la OC
select pg_temp.como('comprador');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('justificantes-correccion', current_setting('prueba.oc1') || '/' || current_setting('prueba.c1') || '.pdf',
        public.usuario_actual()::text, '{"mimetype": "application/pdf", "size": 3072}');
select test.debe_fallar(format($q$select public.corregir_orden_compra('%s', '%s', 'El código de la orden estaba mal puesto', '%s/%s.pdf',
  'correo.pdf', '{"codigo_interno": "CHK383_C"}'::jsonb)$q$, current_setting('prueba.c1'), current_setting('prueba.oc1'),
  current_setting('prueba.oc1'), current_setting('prueba.c1')),
  'la OC de insumos no cambia el código', 'corrige el requerimiento');
select public.corregir_orden_compra(current_setting('prueba.c1')::uuid, current_setting('prueba.oc1')::uuid,
  'El proveedor confirmó otro precio de la plancha', current_setting('prueba.oc1') || '/' || current_setting('prueba.c1') || '.pdf',
  'cotizacion.pdf', format('{"lineas": [{"detalle_id": "%s", "precio_unitario": 12}]}', (pg_temp.linea('rq1', 1)).orden_compra_detalle_id)::jsonb);
reset role;
select test.afirmar((select monto from public.codigo_interno_lineas('CHK383_A', false)
                      where fuente = 'COMPRAS' and referencia_id = current_setting('prueba.oc1')::uuid) = 48
                    and (pg_temp.oc('oc1')).codigo_interno is null,
  'el precio sí se corrige, y el reparto lo sigue: 7 × 12 × 4/7 = 48');

-- ============================================ 9. Gerencia la rechaza: los insumos quedan libres
select pg_temp.como('gerente');
set local role authenticated;
select public.rechazar_compra(current_setting('prueba.oc1')::uuid, 'Precio alto: cotizar con otro proveedor.');
reset role;
select test.afirmar((pg_temp.linea('rq1', 1)).orden_compra_detalle_id is null
                    and (pg_temp.linea('rq2', 1)).orden_compra_detalle_id is null,
  'al rechazarla, sus líneas se van y el enlace de cada insumo se vacía');
select test.afirmar(not exists (select 1 from public.codigo_interno_lineas('CHK383_A', false)
                                 where referencia_id = current_setting('prueba.oc1')::uuid),
  'y la rechazada ya no suma al costeo');
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc2')::uuid,
  format('[{"material_id": "%s", "cantidad": 7, "precio": 9, "insumos": ["%s", "%s"]}]',
         current_setting('prueba.m1'), pg_temp.insumo('rq1', 1), pg_temp.insumo('rq2', 1))::jsonb,
  current_setting('prueba.prov')::uuid, null, null, 'CONTADO', 0, 'PEN', true);
reset role;
select test.afirmar((pg_temp.linea('rq1', 1)).orden_compra_id = current_setting('prueba.oc2')::uuid
                    and (pg_temp.linea('rq1', 1)).orden_compra_detalle_id is not null,
  'los insumos de la rechazada entran en otra orden');

-- ============================================ 10. La administradora junta los suyos
select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc4')::uuid,
  format('[{"material_id": "%s", "cantidad": 1, "precio": 10, "insumos": ["%s"]}]', current_setting('prueba.m1'), pg_temp.insumo('rqa', 1))::jsonb,
  current_setting('prueba.prov')::uuid, null, null, 'CONTADO', 0, 'PEN', true);
reset role;
select test.afirmar((pg_temp.rq('rqa')).estado = 'EN_ATENCION' and (pg_temp.oc('oc4')).codigo_interno = 'PLANTA',
  'la administradora compra el RQA con la misma función');

-- ============================================ 11. Anulada, sigue diciendo para qué código era
-- Al anularla se sueltan sus líneas: el destino de cada una queda escrito en la OC
-- para que su PDF no diga «ALMACÉN» (migración 20261022150000).
select pg_temp.como('gerente');
set local role authenticated;
select public.anular_orden_compra(current_setting('prueba.oc2')::uuid, 'El proveedor ya no tiene la plancha');
reset role;
select test.afirmar((pg_temp.oc('oc2')).lineas_anuladas->0->>'destino'
                      = 'CHK383_A · ' || (pg_temp.rq('rq1')).numero || '; CHK383_B · ' || (pg_temp.rq('rq2')).numero,
  'la OC anulada que juntaba dos RQ guarda el código y el RQ de su línea');

rollback;
