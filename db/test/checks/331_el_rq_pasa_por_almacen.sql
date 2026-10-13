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
             and origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Requerimiento sin stock%'),
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
