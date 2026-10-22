-- El RQ pasa primero por Almacén: con stock queda listo; sin stock lo compra
-- Logística, Almacén lo recepciona y lo entrega al área. Cada paso con el rol
-- que lo da —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'SUPERVISOR:MTZ', 'SUPERVISOR:PRD', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.331@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 331', lower(replace(v, ':', '.')) || '.331@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  perform set_config('prueba.rq1', gen_random_uuid()::text, true);
  perform set_config('prueba.rq2', gen_random_uuid()::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Desde la migración 20261020196000, «Entregado» pide antes la salida del kardex
-- de cada insumo, y la salida pide que haya saldo. Como dueño de las tablas se
-- monta el armazón: lo que el almacén ya tenía o lo que llegó de la compra entra
-- al kardex (la recepción tiene sus checks), y la foto se sube. La salida la
-- registra Almacén con su función y su rol (la salida tiene su check, el 416).
create or replace function pg_temp.sacar_del_kardex(p_rq text) returns void language plpgsql as $$
declare
  v_alm text := current_setting('prueba.almacenero_alm');
  v_sesion text[] := array[current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.claim.role', true),
                           current_setting('request.jwt.claims', true)];
  v_id uuid;
  l record;
begin
  for l in
    select x.linea_id, x.pendiente, rl.orden_compra_detalle_id,
           coalesce(x.material_comprado, d.material_id, x.material_id) as material
      from public.v_rq_lineas_para_salida x
      join public.requerimiento_lineas rl on rl.id = x.linea_id
      left join public.orden_compra_material_detalles d on d.id = rl.orden_compra_detalle_id
     where x.requerimiento_id = current_setting('prueba.' || p_rq)::uuid and x.pendiente > 0
  loop
    insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                               orden_compra_detalle_id)
    values (gen_random_uuid(), 'INGRESO', l.material, l.pendiente,
            case when l.orden_compra_detalle_id is null then 'INGRESO_GENERAL' else 'COMPRA' end,
            'Ingreso de la prueba', v_alm::uuid, l.orden_compra_detalle_id);
    v_id := gen_random_uuid();
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', v_alm || '/' || v_id || '.jpg', v_alm, '{"mimetype": "image/jpeg", "size": 2048}');
    perform pg_temp.como('almacenero_alm');
    set local role authenticated;
    perform public.registrar_salida_material(v_id, l.material, l.pendiente, null, null, 'Salida de la prueba',
      'Supervisor de Maestranza', v_alm || '/' || v_id || '.jpg', l.linea_id);
    reset role;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(v_sesion[1], ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_sesion[2], ''), true);
  perform set_config('request.jwt.claims', coalesce(v_sesion[3], ''), true);
end $$;

create or replace function pg_temp.lineas() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('descripcion', 'Plancha LAF 2 mm 4x8', 'cantidad', 3,
    'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')));
$$;

create or replace function pg_temp.estado(p text) returns text language sql as $$
  select estado from public.requerimientos where id = current_setting('prueba.' || p)::uuid;
$$;

-- ============================================ 1. Emitir: el aviso va a Almacén
select pg_temp.como('requerimientos_req');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq1')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLA_SR_O4_1_26/28', 'Armado del chasis de la plataforma 28', null, pg_temp.lineas());
select public.emitir_requerimiento(current_setting('prueba.rq2')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLANTA', 'Consumibles de soldadura del mes', null, pg_temp.lineas());
reset role;
select test.afirmar(pg_temp.estado('rq1') = 'POR_ATENDER', 'el RQ nace POR_ATENDER');
select test.afirmar(
  exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.almacenero_alm')::uuid
             and origen_id = current_setting('prueba.rq1')::uuid and ruta = '/requerimientos/atencion'),
  'al emitir, el aviso le llega a Almacén con la ruta de atención');
select test.afirmar(
  not exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.comprador_log')::uuid
                 and origen_id = current_setting('prueba.rq1')::uuid),
  'al emitir, Logística todavía no recibe aviso');

-- ============================================ 2. Quién lo ve
select pg_temp.como('almacenero_alm');
set local role authenticated;
select test.afirmar((select count(*) from public.requerimientos where id = current_setting('prueba.rq1')::uuid) = 1, 'Almacén ve el RQ');
reset role;
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar((select count(*) from public.requerimientos where id = current_setting('prueba.rq1')::uuid) = 1, 'el supervisor ve el RQ');
select test.debe_fallar(format($q$select public.rq_marcar_sin_stock('%s', null)$q$, current_setting('prueba.rq1')),
  'el supervisor no revisa stock');
reset role;
select pg_temp.como('vendedor_gco');
set local role authenticated;
select test.afirmar((select count(*) from public.requerimientos) = 0, 'Ventas no ve ningún RQ');
reset role;

-- ============================================ 3. Logística no puede antes que Almacén
select pg_temp.como('comprador_log');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_marcar_en_atencion('%s', null)$q$, current_setting('prueba.rq1')),
  'Logística no toma un RQ que Almacén no revisó');
select test.debe_fallar(format($q$select public.rq_marcar_sin_stock('%s', null)$q$, current_setting('prueba.rq1')),
  'Logística no marca el stock');
reset role;

-- ============================================ 4. Almacén: rq1 sin stock, rq2 con stock
select pg_temp.como('almacenero_alm');
set local role authenticated;
select public.rq_marcar_sin_stock(current_setting('prueba.rq1')::uuid, 'No queda plancha de 2 mm');
select public.rq_marcar_sin_stock(current_setting('prueba.rq1')::uuid, 'otra vez');
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq2')::uuid, 'Está en el estante B');
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Pedro')$q$, current_setting('prueba.rq1')),
  'sin stock no se entrega');
reset role;
select test.afirmar(pg_temp.estado('rq1') = 'SIN_STOCK', 'rq1 queda SIN_STOCK');
select test.afirmar((select nota_almacen from public.requerimientos where id = current_setting('prueba.rq1')::uuid) = 'No queda plancha de 2 mm',
  'el segundo toque no pisa la nota');
select test.afirmar(pg_temp.estado('rq2') = 'LISTO_EN_ALMACEN', 'rq2 queda LISTO_EN_ALMACEN con stock');
select test.afirmar(
  exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.comprador_log')::uuid
             and origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Requerimiento por comprar%'),
  'sin stock avisa a Logística');
select test.afirmar(
  exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.supervisor_mtz')::uuid
             and origen_id = current_setting('prueba.rq2')::uuid and titulo like 'Listo en almacén%'),
  'listo en almacén avisa al supervisor del área que pidió');
select test.afirmar(
  not exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.supervisor_prd')::uuid
                 and origen_id = current_setting('prueba.rq2')::uuid),
  'y no al supervisor de otra área');
select test.afirmar(
  exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.requerimientos_req')::uuid
             and origen_id = current_setting('prueba.rq2')::uuid and titulo like 'Listo en almacén%'),
  'y a quien lo emitió');

-- ============================================ 5. Logística compra, Almacén recepciona
select pg_temp.como('comprador_log');
set local role authenticated;
select public.rq_marcar_en_atencion(current_setting('prueba.rq1')::uuid, 'OC con Aceros Arequipa');
reset role;
select test.afirmar(pg_temp.estado('rq1') = 'EN_ATENCION', 'rq1 pasa a EN_ATENCION');

-- Ya no se anula: Logística está comprando.
select pg_temp.como('requerimientos_req');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya no hace falta la plancha')$q$, current_setting('prueba.rq1')),
  'no se anula un RQ en atención');
reset role;

select pg_temp.como('almacenero_alm');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq1')::uuid, 'Llegó con el conductor, 3 planchas');
reset role;
select test.afirmar(pg_temp.estado('rq1') = 'LISTO_EN_ALMACEN', 'al recepcionar queda LISTO_EN_ALMACEN');

-- ============================================ 6. Entrega: cierra y congela
select pg_temp.como('almacenero_alm');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', '')$q$, current_setting('prueba.rq1')),
  'la entrega exige anotar quién recogió');
reset role;
select pg_temp.sacar_del_kardex('rq1');
set local role authenticated;
select public.rq_marcar_entregado(current_setting('prueba.rq1')::uuid, 'Supervisor de Maestranza');
select public.rq_marcar_entregado(current_setting('prueba.rq1')::uuid, 'Supervisor de Maestranza');
select test.debe_fallar(format($q$select public.rq_marcar_sin_stock('%s', null)$q$, current_setting('prueba.rq1')),
  'entregado no vuelve atrás');
reset role;
select test.afirmar(pg_temp.estado('rq1') = 'ENTREGADO', 'rq1 queda ENTREGADO');
select test.afirmar(
  exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.requerimientos_req')::uuid
             and origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Entregado%'),
  'la entrega avisa a quien lo emitió');
select test.debe_fallar(format($q$update public.requerimientos set estado = 'POR_ATENDER' where id = '%s'$q$, current_setting('prueba.rq1')),
  'ni el dueño de la base lo reabre');

-- ============================================ 7. Anular sigue valiendo sin stock
select pg_temp.como('requerimientos_req');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya lo recogieron, no hace falta')$q$, current_setting('prueba.rq2')),
  'listo en almacén no se anula');
reset role;

rollback;
