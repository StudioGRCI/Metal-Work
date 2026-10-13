-- La OC nace del requerimiento (migración 20261013120000): Logística genera
-- la orden desde un RQ que Almacén dejó sin stock, eligiendo qué insumos cubre;
-- el RQ pasa solo a EN_ATENCION, cada insumo guarda su OC, una OC rechazada
-- libera el insumo y Almacén cierra el circuito con lo suyo. Cada paso con el
-- rol que lo da —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.332@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 332', lower(replace(v, ':', '.')) || '.332@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK332-PLA', 'Plancha LAF 2 mm 4x8 (332)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20100047218', 'Proveedor de prueba 332', 'Av. Argentina 456, Lima', '999 333 444')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  perform set_config('prueba.rq', gen_random_uuid()::text, true);
  perform set_config('prueba.rq_con_stock', gen_random_uuid()::text, true);
  perform set_config('prueba.oc1', gen_random_uuid()::text, true);
  perform set_config('prueba.oc2', gen_random_uuid()::text, true);
  perform set_config('prueba.oc3', gen_random_uuid()::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.lineas() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('descripcion', 'Plancha LAF 2 mm 4x8', 'cantidad', 3,
      'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')),
    jsonb_build_object('descripcion', 'Guantes de cuero', 'cantidad', 6,
      'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')));
$$;

create or replace function pg_temp.detalle() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50));
$$;

-- Generar la OC desde el RQ, como Logística: p_oc, p_items y el resto fijo.
create or replace function pg_temp.generar(p_oc text, p_items smallint[]) returns uuid language sql as $$
  select public.emitir_compra_del_requerimiento(current_setting('prueba.' || p_oc)::uuid, current_setting('prueba.rq')::uuid, p_items,
    current_setting('prueba.proveedor')::uuid, null, pg_temp.detalle(), null, 'CONTADO', 0, 'PEN', true);
$$;

create or replace function pg_temp.estado(p text) returns text language sql as $$
  select estado from public.requerimientos where id = current_setting('prueba.' || p)::uuid;
$$;

create or replace function pg_temp.oc_del_insumo(p_item int) returns uuid language sql as $$
  select orden_compra_id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and item = p_item;
$$;

-- ============================================ 1. Requerimientos emite dos RQ
select pg_temp.como('requerimientos_req');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLA_SR_O4_1_26/28', 'Armado del chasis de la plataforma 28', null, pg_temp.lineas());
select public.emitir_requerimiento(current_setting('prueba.rq_con_stock')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLANTA', 'Consumibles de soldadura del mes', null, pg_temp.lineas());
reset role;

-- ============================================ 2. Antes de Almacén, Logística no genera nada
select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.generar('oc1', null)$q$, 'por revisar: la OC no se genera hasta que Almacén diga sin stock');
reset role;

select pg_temp.como('almacenero_alm');
set local role authenticated;
select public.rq_marcar_sin_stock(current_setting('prueba.rq')::uuid, 'No queda plancha de 2 mm');
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq_con_stock')::uuid, 'Estante B');
reset role;

-- ============================================ 3. Quién puede generar
select pg_temp.como('vendedor_gco');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.generar('oc1', null)$q$, 'Ventas no genera la OC del RQ');
reset role;
select pg_temp.como('almacenero_alm');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.generar('oc1', null)$q$, 'Almacén no genera la OC del RQ');
reset role;

-- ============================================ 4. Logística genera la OC del insumo 1
select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.generar('oc1', array[9]::smallint[])$q$, 'un insumo que no es del RQ no pasa');
select pg_temp.generar('oc1', array[1]::smallint[]);
select pg_temp.generar('oc1', array[1]::smallint[]);  -- el reintento devuelve la misma OC
set constraints all immediate;
select test.afirmar(pg_temp.estado('rq') = 'EN_ATENCION', 'al generar la OC el RQ pasa a EN_ATENCION');
select test.afirmar(pg_temp.oc_del_insumo(1) = current_setting('prueba.oc1')::uuid, 'el insumo 1 guarda su OC');
select test.afirmar(pg_temp.oc_del_insumo(2) is null, 'el insumo 2 sigue libre');
select test.afirmar(
  (select origen = 'DIRECTA' and aprobacion = 'POR_APROBAR' and codigo_interno = 'PLA_SR_O4_1_26/28'
          and motivo like 'Atiende el requerimiento RQ-%Armado del chasis%'
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'la OC lleva el código interno y el motivo del RQ y espera a Gerencia');
select test.afirmar(
  (select count(*) from public.ordenes_compra_materiales where motivo like 'Atiende el requerimiento RQ-%') = 1,
  'el reintento no duplicó la orden');
select test.afirmar(
  (select nota_logistica from public.requerimientos where id = current_setting('prueba.rq')::uuid)
    = 'Orden ' || (select numero from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'el RQ anota qué orden lo atiende');
-- El insumo 1 ya tiene su compra viva: no se pisa.
select test.debe_fallar($q$select pg_temp.generar('oc2', array[1]::smallint[])$q$, 'un insumo con OC viva no se vuelve a comprar');
-- Sin lista, toma lo libre (el insumo 2) y deja en paz al 1.
select pg_temp.generar('oc2', null);
set constraints all immediate;
select test.afirmar(pg_temp.oc_del_insumo(2) = current_setting('prueba.oc2')::uuid, 'sin lista, la segunda OC cubre el insumo libre');
select test.afirmar(pg_temp.oc_del_insumo(1) = current_setting('prueba.oc1')::uuid, 'y no toca el insumo 1');
select test.debe_fallar($q$select pg_temp.generar('oc3', null)$q$, 'con todo comprado no se genera otra OC');
reset role;

-- ============================================ 5. Quién ve el enlace
select pg_temp.como('almacenero_alm');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and orden_compra_id is not null) = 2,
  'Almacén ve con qué OC viene cada insumo');
reset role;
select pg_temp.como('requerimientos_req');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and orden_compra_id is not null) = 2,
  'Requerimientos también');
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya no hace falta la plancha')$q$, current_setting('prueba.rq')),
  'en atención ya no se anula');
reset role;

-- ============================================ 6. Gerencia rechaza la OC del insumo 2: queda libre
select pg_temp.como('gerente_ger');
set local role authenticated;
select public.rechazar_compra(current_setting('prueba.oc2')::uuid, 'Precio fuera de mercado, cotiza con otro');
reset role;
select test.afirmar(pg_temp.estado('rq') = 'EN_ATENCION', 'el RQ sigue en atención: Logística compra con otro');
select pg_temp.como('comprador_log');
set local role authenticated;
select pg_temp.generar('oc3', array[2]::smallint[]);
set constraints all immediate;
select test.afirmar(pg_temp.oc_del_insumo(2) = current_setting('prueba.oc3')::uuid, 'el insumo de la OC rechazada se compra con otra');
reset role;

-- ============================================ 7. Almacén recepciona y entrega; con stock no se compra
select pg_temp.como('almacenero_alm');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq')::uuid, 'Llegó con el conductor');
select public.rq_marcar_entregado(current_setting('prueba.rq')::uuid, 'Supervisor de Maestranza');
reset role;
select test.afirmar(pg_temp.estado('rq') = 'ENTREGADO', 'Almacén cierra el RQ como siempre');
select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.generar('oc1', null)$q$, 'entregado: no se le generan más compras');
select test.debe_fallar(
  format($q$select public.emitir_compra_del_requerimiento('%s', '%s', null, '%s', null, pg_temp.detalle(), null, 'CONTADO', 0, 'PEN', true)$q$,
         gen_random_uuid(), current_setting('prueba.rq_con_stock'), current_setting('prueba.proveedor')),
  'un RQ que Almacén dejó listo con stock no se compra');
reset role;

do $$ begin raise notice 'OK 332: la OC nace del requerimiento'; end $$;
rollback;
