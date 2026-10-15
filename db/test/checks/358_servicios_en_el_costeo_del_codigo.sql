-- Las órdenes de servicio en el costeo de su código interno (migración
-- 20261015180000): la aprobada suma al costo del código, la que espera a
-- Gerencia se muestra aparte, y la rechazada y la anulada no aparecen. El gasto
-- por código de Requerimientos sigue sin servicios. Cada paso con el rol que lo
-- da —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GER', 'REQUERIMIENTOS:', 'SUPERVISOR:MTZ'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.358@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 358', lower(split_part(v, ':', 1)) || '.358@prueba.local', r.id,
           (select id from public.areas where codigo = nullif(split_part(v, ':', 2), ''))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20600000358', 'Proveedor de prueba 358', 'Av. Argentina 358, Lima', '999 358 358')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  foreach v in array array['os1', 'os2', 'os3', 'os4', 'os5', 'os6'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.emitir(p_os text, p_codigo text, p_moneda text, p_monto numeric, p_descripcion text)
returns uuid language sql as $$
  select public.emitir_orden_servicio(current_setting('prueba.' || p_os)::uuid, current_setting('prueba.proveedor')::uuid,
    null, (select id from public.areas where codigo = 'ACB'), p_codigo, p_descripcion, null,
    null, null, p_moneda, p_monto, 'CONTADO', 0, '025', null);
$$;
create or replace function pg_temp.id(p_os text) returns uuid language sql as $$
  select current_setting('prueba.' || p_os)::uuid;
$$;

-- ============================================ 1. Logística emite seis OS para el código
-- La de dólares va al costeo en dólares: no necesita el tipo de cambio.
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.emitir('os1', 'PRB_SR_358_1', 'PEN', 1000, 'Torneado de cuatro ejes para la prueba 358');
select pg_temp.emitir('os2', 'PRB_SR_358_1', 'USD', 200, 'Pintura en horno de la tolva, prueba 358');
select pg_temp.emitir('os3', 'PRB_SR_358_1', 'PEN', 500, 'Servicio que Gerencia rechaza, prueba 358');
select pg_temp.emitir('os4', 'PRB_SR_358_1', 'PEN', 300, 'Servicio que Logística anula, prueba 358');
-- Escrito en minúsculas y con espacios: es el mismo código.
select pg_temp.emitir('os5', '  prb_sr_358_1 ', 'PEN', 700, 'Doblado de planchas que espera a Gerencia, prueba 358');
select pg_temp.emitir('os6', 'OTRO_358', 'PEN', 999, 'Servicio de otro código, prueba 358');
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_orden_servicio(pg_temp.id('os1'));
select public.aprobar_orden_servicio(pg_temp.id('os2'));
select public.aprobar_orden_servicio(pg_temp.id('os4'));
select public.rechazar_orden_servicio(pg_temp.id('os3'), 'El precio está muy alto para este servicio');
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'EN_EJECUCION', null);
select public.avanzar_orden_servicio(pg_temp.id('os4'), 'ANULADA', 'Se emitió dos veces por error');
reset role;

-- ============================================ 2. Gerencia: el costeo del código
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.codigo_interno_costeo('PRB_SR_358_1') where fuente = 'SERVICIOS') = 2
  and (select sum(monto) from public.codigo_interno_costeo('PRB_SR_358_1') where fuente = 'SERVICIOS' and moneda = 'PEN') = 1000
  and (select sum(monto) from public.codigo_interno_costeo('PRB_SR_358_1') where fuente = 'SERVICIOS' and moneda = 'USD') = 200,
  'las dos OS aprobadas entran al costeo del código, sin IGV y en su moneda (S/ 1,000 y US$ 200)');
select test.afirmar(
  (select count(*) from public.codigo_interno_costeo('PRB_SR_358_1') where fuente = 'SERVICIOS_POR_APROBAR') = 1
  and (select monto from public.codigo_interno_costeo('PRB_SR_358_1') where fuente = 'SERVICIOS_POR_APROBAR') = 700,
  'la que espera a Gerencia aparece aparte, aunque se escribió en minúsculas y con espacios');
select test.afirmar(
  not exists (select 1 from public.codigo_interno_costeo('PRB_SR_358_1')
               where referencia_id in (pg_temp.id('os3'), pg_temp.id('os4'), pg_temp.id('os6'))),
  'la rechazada, la anulada y la de otro código no están en el costeo');
select test.afirmar(
  (select documento = (select numero from public.ordenes_servicio where id = pg_temp.id('os1'))
          and detalle = upper('Proveedor de prueba 358') and concepto like 'Torneado%'
     from public.codigo_interno_costeo('PRB_SR_358_1') where referencia_id = pg_temp.id('os1')),
  'cada línea dice el número de la OS, el proveedor y qué se hizo');

-- La lista de todos los códigos
select test.afirmar(
  (select servicios = 2 and servicios_pen = 1000 and servicios_usd = 200
          and por_aprobar = 1 and por_aprobar_pen = 700 and por_aprobar_usd = 0
     from public.codigos_internos_servicios() where codigo = 'PRB_SR_358_1'),
  'la lista de Gerencia trae lo mismo que el costeo del código');
select test.afirmar(
  (select servicios = 0 and por_aprobar = 1 from public.codigos_internos_servicios() where codigo = 'OTRO_358'),
  'cada código lleva solo sus OS');
select test.afirmar(
  (select count(*) from public.codigos_internos_resumen() where codigo = 'PRB_SR_358_1') = 1,
  'el resumen de los códigos sigue funcionando y lista el código que solo tiene OS');
select test.debe_fallar($q$select public.codigo_interno_lineas_servicio('PRB_SR_358_1')$q$,
  'la función interna no se llama desde afuera', 'permission denied');
reset role;

-- ============================================ 3. Requerimientos: su gasto no cambia
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar(
  not exists (select 1 from public.codigo_interno_gasto('PRB_SR_358_1')),
  'el gasto por código de Requerimientos no trae las OS');
select test.afirmar(
  not exists (select 1 from public.codigos_internos_gasto() where codigo in ('PRB_SR_358_1', 'OTRO_358')),
  'un código que solo tiene OS no entra a la lista de gasto de Requerimientos');
select test.debe_fallar($q$select * from public.codigos_internos_servicios()$q$,
  'Requerimientos no ve los servicios de Gerencia', 'codigos_internos.ver');
reset role;

-- ============================================ 4. Un supervisor no ve nada de esto
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigos_internos_servicios()$q$,
  'un supervisor no ve los servicios de los códigos', 'codigos_internos.ver');
select test.debe_fallar($q$select * from public.codigo_interno_costeo('PRB_SR_358_1')$q$,
  'un supervisor no ve el costeo', 'codigos_internos.ver');
reset role;

select 'OK: las órdenes de servicio entran al costeo de su código con los roles reales' as resultado;
rollback;
