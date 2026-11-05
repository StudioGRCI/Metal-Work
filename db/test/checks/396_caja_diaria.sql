-- La caja diaria de Tesorería (migraciones 20261017200000 y 20261017210000):
-- las cuentas con su saldo inicial, los ingresos y egresos de cada día, las transferencias entre
-- cuentas y el cierre contra el estado de cuenta. Cada paso con el rol que lo
-- da —Tesorería, nunca ADMIN— y `set local role authenticated`; Gerencia y
-- Contabilidad no la ven ni la escriben. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['tesoreria:TESORERIA', 'gerente:GERENTE', 'contabilidad:CONTABILIDAD'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 1) || '.396@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
    select v_id, split_part(v, ':', 2), 'Check 396', split_part(v, ':', 1) || '.396@prueba.local', r.id
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || split_part(v, ':', 1), v_id::text, true);
  end loop;
  foreach v in array array['bcp_pen', 'bcp_usd', 'chica', 'otra', 'm1', 'm2', 'm3', 'm4', 't1', 't2', 't3', 'c1', 'c2', 'c3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  -- Los días en Lima: la base rechaza el futuro con la fecha de Lima.
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.d3', ((now() at time zone 'America/Lima')::date - 3)::text, true);
  perform set_config('prueba.d2', ((now() at time zone 'America/Lima')::date - 2)::text, true);
  perform set_config('prueba.d4', ((now() at time zone 'America/Lima')::date - 4)::text, true);
  perform set_config('prueba.manana', ((now() at time zone 'America/Lima')::date + 1)::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

create or replace function pg_temp.dia(p_clave text) returns date language sql as $$
  select current_setting('prueba.' || p_clave)::date;
$$;

-- ============================================ 0. Puertas
do $$
begin
  perform test.afirmar(exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                where r.codigo = 'TESORERIA' and rp.permiso_codigo = 'tesoreria.caja'),
                       'Tesorería tiene tesoreria.caja');
  perform test.afirmar(not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                                    where r.codigo in ('GERENTE', 'CONTABILIDAD') and rp.permiso_codigo = 'tesoreria.caja'),
                       'Gerencia y Contabilidad no lo tienen');
  perform test.afirmar(not has_function_privilege('anon', 'public.registrar_movimiento_caja(uuid, uuid, date, text, numeric, text, text, text, numeric)', 'execute')
                       and not has_function_privilege('anon', 'public.caja_del_dia(date)', 'execute')
                       and not has_function_privilege('authenticated', 'public.caja_dia_abierto(uuid, date)', 'execute'),
                       'anon no ejecuta la caja y nadie llama al ayudante que bloquea la cuenta');
  perform test.afirmar(not has_table_privilege('authenticated', 'public.movimientos_caja', 'insert')
                       and not has_table_privilege('authenticated', 'public.movimientos_caja', 'update')
                       and not has_table_privilege('authenticated', 'public.cierres_caja', 'delete')
                       and not has_table_privilege('authenticated', 'public.cajas', 'insert'),
                       'las tablas de la caja se escriben solo por sus funciones');
end $$;

-- ============================================ 1. Tesorería da de alta sus cuentas
-- Cada banco con la captura de su saldo (migración 20261020174500), que el
-- navegador sube antes; el check 404 prueba la subida con la política de Storage.
do $$
declare v text;
begin
  foreach v in array array['bcp_pen', 'bcp_usd'] loop
    perform set_config('prueba.cap_' || v, pg_temp.id(v) || '/' || gen_random_uuid() || '.png', true);
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('apertura-caja', current_setting('prueba.cap_' || v), current_setting('prueba.tesoreria'), '{"mimetype":"image/png","size":100}'::jsonb);
  end loop;
end $$;

do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform public.guardar_caja(pg_temp.id('bcp_pen'), '  BCP   soles 396 ', 'BANCO', 'BCP', 'PEN', 10000, pg_temp.dia('d3'), true,
                              current_setting('prueba.cap_bcp_pen'));
  perform public.guardar_caja(pg_temp.id('bcp_usd'), 'BCP dólares 396', 'BANCO', 'BCP', 'USD', 2000, pg_temp.dia('d3'), true,
                              current_setting('prueba.cap_bcp_usd'));
  perform public.guardar_caja(pg_temp.id('chica'), 'Caja chica 396', 'EFECTIVO', 'no va', 'PEN', 500, pg_temp.dia('d3'), true);
  perform test.afirmar((select nombre from public.cajas where id = pg_temp.id('bcp_pen')) = 'BCP soles 396',
                       'el nombre se guarda sin espacios de más');
  perform test.afirmar((select banco from public.cajas where id = pg_temp.id('chica')) is null,
                       'la caja chica en efectivo no lleva banco');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''bcp SOLES 396'', ''BANCO'', ''BCP'', ''PEN'', 0, %L, true)',
      pg_temp.id('otra'), pg_temp.dia('d3')), 'dos cuentas no se llaman igual', 'Ya hay una cuenta');
  -- check_violation: un unique_violation llegaría a la persona como «Ya existe un registro con esos datos».
  begin
    perform public.guardar_caja(pg_temp.id('otra'), 'bcp SOLES 396', 'BANCO', 'BCP', 'PEN', 0, pg_temp.dia('d3'), true);
    perform test.afirmar(false, 'el nombre repetido se rechaza');
  exception when check_violation then
    perform test.afirmar(sqlerrm like 'Ya hay una cuenta que se llama BCP soles 396%', 'el nombre repetido llega con su propio mensaje');
  end;
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 396'', ''BANCO'', '''', ''PEN'', 0, %L, true)',
      pg_temp.id('otra'), pg_temp.dia('d3')), 'una cuenta de banco dice su banco', 'Escribe el banco');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 396'', ''BANCO'', ''Interbank'', ''PEN'', 0, %L, true)',
      pg_temp.id('otra'), pg_temp.dia('manana')), 'el saldo inicial no es de mañana', 'hasta hoy');
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Interbank 396'', ''BANCO'', ''Interbank'', ''EUR'', 0, %L, true)',
      pg_temp.id('otra'), pg_temp.dia('d3')), 'soles o dólares', 'moneda');
  reset role;
end $$;

-- ============================================ 2. Gerencia y Contabilidad no la ven ni la escriben
do $$
declare v_clave text;
begin
  foreach v_clave in array array['gerente', 'contabilidad'] loop
    perform pg_temp.como(v_clave);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.cajas where nombre like '%396') = 0, v_clave || ' no ve las cuentas');
    perform test.afirmar((select count(*) from public.caja_del_dia(pg_temp.dia('d3')) where nombre like '%396') = 0,
                         v_clave || ' no ve la caja del día');
    perform test.afirmar((select count(*) from public.movimientos_caja_del_dia(pg_temp.dia('d3'))) = 0
                         and (select count(*) from public.cierres_caja_reabiertos(pg_temp.dia('d3'))) = 0,
                         v_clave || ' no ve sus movimientos ni sus cierres');
    perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 10, ''ITF'', null, null, null)',
        pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), v_clave || ' no registra movimientos', 'tesoreria.caja');
    perform test.debe_fallar(format('select public.guardar_caja(%L, ''Otra 396'', ''EFECTIVO'', null, ''PEN'', 0, %L, true)',
        pg_temp.id('otra'), pg_temp.dia('d3')), v_clave || ' no da de alta cuentas', 'tesoreria.caja');
    perform test.debe_fallar('select * from public.caja_codigos_internos()', v_clave || ' no lista los códigos de la caja', 'tesoreria.caja');
    reset role;
  end loop;
end $$;

-- ============================================ 3. Ingresos y egresos del día
do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform public.registrar_movimiento_caja(pg_temp.id('m1'), pg_temp.id('bcp_pen'), pg_temp.dia('d3'), 'EGRESO', 1000,
                                           'OC-0001-MW   Ferretería de prueba', ' pla_sr_o4_1_26/96 ', '  00123 ', null);
  perform public.registrar_movimiento_caja(pg_temp.id('m2'), pg_temp.id('bcp_pen'), pg_temp.dia('d3'), 'egreso', 0.15, 'ITF', null, null, null);
  perform public.registrar_movimiento_caja(pg_temp.id('m3'), pg_temp.id('bcp_pen'), pg_temp.dia('d3'), 'INGRESO', 5000,
                                           'Cobro de prueba', null, null, 3.75);
  -- El reintento con el mismo id no registra otro. Es el mismo envío si dice lo
  -- mismo, escrito con otros espacios o en minúsculas (migración 20261023100000).
  perform public.registrar_movimiento_caja(pg_temp.id('m1'), pg_temp.id('bcp_pen'), pg_temp.dia('d3'), 'EGRESO', 1000,
                                           'OC-0001-MW Ferretería de prueba', 'PLA_SR_O4_1_26/96', '00123', null);
  perform test.afirmar((select count(*) from public.movimientos_caja where caja_id = pg_temp.id('bcp_pen')) = 3,
                       'tres movimientos: el reintento no duplica');
  perform test.afirmar((select codigo_interno = 'PLA_SR_O4_1_26/96' and descripcion = 'OC-0001-MW Ferretería de prueba'
                               and operacion = '00123' and origen = 'MANUAL' and registrado_por = pg_temp.id('tesoreria')
                          from public.movimientos_caja where id = pg_temp.id('m1')),
                       'el código interno se normaliza y el movimiento es manual, de quien lo registró');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 10, ''ITF'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d4')), 'antes del saldo inicial no hay movimientos', 'empieza el');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 10, ''ITF'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('manana')), 'ni movimientos de mañana', 'hasta hoy');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 0, ''ITF'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'el monto va mayor que cero', 'mayor que cero');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 1.234, ''ITF'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'con dos decimales como máximo', 'dos decimales');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 10, ''x'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'con su descripción', 'Describe el movimiento');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''COBRO'', 10, ''ITF'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'ingreso o egreso', 'ingreso o un egreso');
  perform test.afirmar(exists (select 1 from public.caja_codigos_internos() where codigo = 'PLA_SR_O4_1_26/96'),
                       'el código usado en la caja sale en la lista para elegir');
  reset role;
end $$;

-- ============================================ 4. Transferencias entre cuentas
do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform public.registrar_transferencia_caja(pg_temp.id('t1'), pg_temp.id('bcp_pen'), pg_temp.id('chica'), pg_temp.dia('d2'),
                                              300, 999, '', null);
  perform test.afirmar((select count(*) = 2 and bool_and(origen = 'TRANSFERENCIA') and bool_and(descripcion = 'Transferencia entre cuentas')
                               and sum(case when tipo = 'INGRESO' then monto else -monto end) = 0 and bool_and(tipo_cambio is null)
                          from public.movimientos_caja where origen_id = pg_temp.id('t1')),
                       'en la misma moneda: sale y entra lo mismo, sin cambio, aunque llegue otro monto de destino');
  perform public.registrar_transferencia_caja(pg_temp.id('t2'), pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd'), pg_temp.dia('d2'),
                                              3750, 1000, 'Compra de dólares', '7788');
  perform test.afirmar((select count(*) = 2 and bool_and(tipo_cambio = 3.75)
                               and max(monto) filter (where tipo = 'EGRESO') = 3750
                               and max(monto) filter (where tipo = 'INGRESO') = 1000
                          from public.movimientos_caja where origen_id = pg_temp.id('t2')),
                       'compra de dólares: sale en soles, entra en dólares, la base saca el cambio');
  perform public.registrar_transferencia_caja(pg_temp.id('t2'), pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd'), pg_temp.dia('d2'),
                                              3750, 1000, 'Compra de dólares', '7788');
  perform test.afirmar((select count(*) from public.movimientos_caja where origen_id = pg_temp.id('t2')) = 2,
                       'el reintento de la transferencia no duplica');
  perform test.afirmar((select otra_cuenta = 'BCP dólares 396' and registrado_por is not null
                          from public.movimientos_caja_del_dia(pg_temp.dia('d2'))
                         where origen_id = pg_temp.id('t2') and tipo = 'EGRESO'),
                       'la caja del día dice a qué cuenta fue la transferencia y qué puesto la registró');
  perform test.debe_fallar(format('select public.registrar_transferencia_caja(%L, %L, %L, %L, 100, 100, null, null)',
      gen_random_uuid(), pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd'), pg_temp.dia('d2')),
      'un dólar a S/ 1.00 es un monto mal escrito', 'el dólar sale a S/ 1');
  perform test.debe_fallar(format('select public.registrar_transferencia_caja(%L, %L, %L, %L, 1000, 3750, null, null)',
      gen_random_uuid(), pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd'), pg_temp.dia('d2')),
      'los montos al revés no pasan', 'el dólar sale a');
  perform test.debe_fallar(format('select public.registrar_transferencia_caja(%L, %L, %L, %L, 1000, null, null, null)',
      gen_random_uuid(), pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd'), pg_temp.dia('d2')),
      'entre monedas se escribe lo que entró', 'cuánto entró');
  perform test.debe_fallar(format('select public.registrar_transferencia_caja(%L, %L, %L, %L, 10, null, null, null)',
      gen_random_uuid(), pg_temp.id('chica'), pg_temp.id('chica'), pg_temp.dia('d2')),
      'no se transfiere a la misma cuenta', 'otra a la que entra');
  reset role;
end $$;

-- ============================================ 5. Los saldos de cada día
do $$
declare r record;
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  select * into r from public.caja_del_dia(pg_temp.dia('d3')) where caja_id = pg_temp.id('bcp_pen');
  perform test.afirmar(r.saldo_inicial = 10000 and r.ingresos = 5000 and r.egresos = 1000.15 and r.saldo_final = 13999.85
                       and r.movimientos = 3 and r.cierre_id is null,
                       'BCP soles el primer día: 10 000 + 5 000 − 1 000.15 = 13 999.85, sin cerrar');
  select * into r from public.caja_del_dia(pg_temp.dia('d2')) where caja_id = pg_temp.id('bcp_pen');
  perform test.afirmar(r.saldo_inicial = 13999.85 and r.egresos = 4050 and r.saldo_final = 9949.85,
                       'el saldo final de ayer es el inicial de hoy');
  select * into r from public.caja_del_dia(pg_temp.dia('hoy')) where caja_id = pg_temp.id('chica');
  perform test.afirmar(r.saldo_inicial = 800 and r.movimientos = 0, 'la caja chica arrastra la reposición');
  select * into r from public.caja_del_dia(pg_temp.dia('d4')) where caja_id = pg_temp.id('bcp_usd');
  perform test.afirmar(r.saldo_inicial is null, 'antes de su saldo inicial la cuenta no tiene saldo');
  select * into r from public.caja_del_dia(pg_temp.dia('hoy')) where caja_id = pg_temp.id('bcp_pen');
  perform test.afirmar(r.primer_dia_sin_cerrar = pg_temp.dia('d3') and r.ultimo_cierre is null,
                       'la caja avisa el primer día con movimientos sin cerrar');
  reset role;
end $$;

-- ============================================ 6. El cierre contra el estado de cuenta
do $$
declare r record;
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.cerrar_dia_caja(%L, %L, %L, 9949.85, null)',
      pg_temp.id('c1'), pg_temp.id('bcp_pen'), pg_temp.dia('d2')), 'los días se cierran en orden', 'Primero cierra el');
  perform test.debe_fallar(format('select public.cerrar_dia_caja(%L, %L, %L, 13900, null)',
      pg_temp.id('c1'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'si no cuadra, se dice por qué', 'cuenta en las observaciones');
  perform test.debe_fallar(format('select public.cerrar_dia_caja(%L, %L, %L, 13900, ''no'')',
      pg_temp.id('c1'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'una observación corta pide los 10 caracteres', '10 caracteres');
  perform public.cerrar_dia_caja(pg_temp.id('c1'), pg_temp.id('bcp_pen'), pg_temp.dia('d3'), 13900,
                                 'Comisión del banco que falta registrar');
  select * into r from public.cierres_caja where id = pg_temp.id('c1');
  perform test.afirmar(r.saldo_inicial = 10000 and r.ingresos = 5000 and r.egresos = 1000.15 and r.saldo_final = 13999.85
                       and r.saldo_banco = 13900 and r.diferencia = -99.85 and r.cerrado_por = pg_temp.id('tesoreria'),
                       'el cierre guarda lo que decía la caja, lo que dice el banco y la diferencia');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 99.85, ''Comisión'', null, null, null)',
      pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'un día cerrado no recibe movimientos', 'cerrada hasta');
  perform test.debe_fallar(format('select public.anular_movimiento_caja(%L, ''Mal registrado en la prueba'')', pg_temp.id('m2')),
      'ni los pierde', 'cerrada hasta');
  perform test.debe_fallar(format('select public.cerrar_dia_caja(%L, %L, %L, 13999.85, null)',
      pg_temp.id('c2'), pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'un día se cierra una vez', 'cerrada hasta');
  -- Lo que faltó va en un día abierto.
  perform public.registrar_movimiento_caja(pg_temp.id('m4'), pg_temp.id('bcp_pen'), pg_temp.dia('d2'), 'EGRESO', 99.85,
                                           'Comisión del 13 que faltó', null, null, null);
  perform public.cerrar_dia_caja(pg_temp.id('c2'), pg_temp.id('bcp_pen'), pg_temp.dia('d2'), 9850, null);
  perform test.afirmar((select diferencia from public.cierres_caja where id = pg_temp.id('c2')) = 0,
                       'cuadra sin observaciones');
  -- Un día sin movimientos también se cierra, con su comprobación.
  perform public.cerrar_dia_caja(pg_temp.id('c3'), pg_temp.id('chica'), pg_temp.dia('d3'), 500, null);
  select * into r from public.caja_del_dia(pg_temp.dia('hoy')) where caja_id = pg_temp.id('bcp_pen');
  perform test.afirmar(r.ultimo_cierre = pg_temp.dia('d2') and r.primer_dia_sin_cerrar is null, 'BCP soles queda al día');
  reset role;
end $$;

-- ============================================ 7. Anular un movimiento y una transferencia
do $$
declare r record;
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.anular_movimiento_caja(%L, ''corto'')', pg_temp.id('t1')),
      'se anula con su motivo', '10 a 500');
  -- La pata de la caja chica está abierta; la del BCP se cerró el día 2: no se anula.
  perform test.debe_fallar(format('select public.anular_movimiento_caja(id, ''Se repuso dos veces en la prueba'') from public.movimientos_caja where origen_id = %L and tipo = ''INGRESO''',
      pg_temp.id('t1')), 'una transferencia con una pata en un día cerrado no se anula', 'cerrada hasta');
  perform test.afirmar((select count(*) from public.movimientos_caja where origen_id = pg_temp.id('t1') and anulado_en is null) = 2,
                       'y no se anuló ninguna de sus patas');
  perform test.debe_fallar(format('update public.movimientos_caja set monto = 1 where id = %L', pg_temp.id('m4')),
      'nadie corrige un movimiento por debajo', 'permission denied');
  reset role;
end $$;

-- ============================================ 8. Reabrir el último cierre
do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.reabrir_dia_caja(%L, ''Faltó un egreso del banco'')', pg_temp.id('c1')),
      'solo se reabre el último cierre', 'Solo se reabre el último');
  perform public.reabrir_dia_caja(pg_temp.id('c2'), 'Faltó registrar la reposición duplicada');
  perform test.afirmar((select anulado_en is not null and anulado_por = pg_temp.id('tesoreria') from public.cierres_caja where id = pg_temp.id('c2')),
                       'el cierre reabierto queda anulado, como evidencia');
  perform test.afirmar((select count(*) from public.cierres_caja_reabiertos(pg_temp.dia('d2')) where id = pg_temp.id('c2')) = 1,
                       'y la caja de ese día lo muestra con su motivo');
  -- Con el día 2 abierto, la transferencia se anula entera.
  perform public.anular_movimiento_caja((select id from public.movimientos_caja where origen_id = pg_temp.id('t1') and tipo = 'INGRESO'),
                                        'Se repuso dos veces en la prueba');
  perform test.afirmar((select count(*) from public.movimientos_caja where origen_id = pg_temp.id('t1') and anulado_en is not null) = 2,
                       'anular una pata anula la transferencia entera');
  perform test.afirmar((select saldo_final from public.caja_del_dia(pg_temp.dia('hoy')) where caja_id = pg_temp.id('chica')) = 500,
                       'y la caja chica vuelve a su saldo');
  perform public.reabrir_dia_caja(pg_temp.id('c1'), 'Se revisa el día otra vez');
  perform public.registrar_movimiento_caja(gen_random_uuid(), pg_temp.id('bcp_pen'), pg_temp.dia('d3'), 'EGRESO', 5,
                                           'Envío de estado de cuenta', null, null, null);
  perform test.afirmar((select egresos from public.caja_del_dia(pg_temp.dia('d3')) where caja_id = pg_temp.id('bcp_pen')) = 1005.15,
                       'reabierto, el día vuelve a recibir movimientos');
  reset role;
end $$;

-- ============================================ 9. La cuenta con movimientos no cambia su saldo inicial
do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''BCP soles 396'', ''BANCO'', ''BCP'', ''PEN'', 12000, %L, true)',
      pg_temp.id('bcp_pen'), pg_temp.dia('d3')), 'con movimientos el saldo inicial no cambia', 'ya tiene movimientos');
  perform public.guardar_caja(pg_temp.id('bcp_pen'), 'BCP soles principal 396', 'BANCO', 'BCP', 'PEN', 10000, pg_temp.dia('d3'), true);
  perform test.afirmar((select nombre from public.cajas where id = pg_temp.id('bcp_pen')) = 'BCP soles principal 396',
                       'el nombre sí se corrige');
  -- Con plata adentro no se desactiva: saldría del consolidado sin que nadie la moviera.
  perform test.debe_fallar(format('select public.guardar_caja(%L, ''Caja chica 396'', ''EFECTIVO'', null, ''PEN'', 500, %L, false)',
      pg_temp.id('chica'), pg_temp.dia('d3')), 'una cuenta con saldo no se desactiva', 'todavía tiene S/ ');
  perform public.registrar_transferencia_caja(pg_temp.id('t3'), pg_temp.id('chica'), pg_temp.id('bcp_pen'), pg_temp.dia('hoy'),
      (select saldo_final from public.caja_del_dia(pg_temp.dia('hoy')) where caja_id = pg_temp.id('chica')), null, 'Cierre de la caja chica', null);
  perform test.afirmar((select saldo_final from public.caja_del_dia(pg_temp.dia('hoy')) where caja_id = pg_temp.id('chica')) = 0,
                       'la caja chica queda en cero después de pasar su saldo');
  perform public.guardar_caja(pg_temp.id('chica'), 'Caja chica 396', 'EFECTIVO', null, 'PEN', 500, pg_temp.dia('d3'), false);
  perform test.afirmar(not (select activa from public.cajas where id = pg_temp.id('chica')), 'en cero, sí se desactiva');
  perform test.debe_fallar(format('select public.anular_movimiento_caja(%L, ''Prueba: anular con la cuenta desactivada'')',
      (select id from public.movimientos_caja where origen_id = pg_temp.id('t3') and tipo = 'INGRESO')),
      'anular la transferencia no le devuelve el saldo a una cuenta ya desactivada', 'está desactivada');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 10, ''Pago en dólares'', null, null, 1)',
      gen_random_uuid(), pg_temp.id('bcp_pen'), pg_temp.dia('hoy')), 'un tipo de cambio de 1.00 no entra', 'entre 2 y 6');
  perform test.debe_fallar(format('select public.registrar_movimiento_caja(%L, %L, %L, ''EGRESO'', 10, ''Almuerzo'', null, null, null)',
      gen_random_uuid(), pg_temp.id('chica'), pg_temp.dia('hoy')), 'una cuenta desactivada no recibe movimientos', 'desactivada');
  reset role;
end $$;

-- ============================================ 10. Cada banco con los soles antes que los dólares
do $$
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.afirmar((select array_agg(caja_id order by n) from (
                          select caja_id, row_number() over () as n from public.caja_del_dia(pg_temp.dia('hoy'))
                           where caja_id in (pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd'))) x)
                       = array[pg_temp.id('bcp_pen'), pg_temp.id('bcp_usd')],
                       'la caja del día pone BCP soles antes que BCP dólares, como el estado de caja');
  reset role;
end $$;

-- ============================================ 11. Nada se borra
do $$
begin
  perform test.debe_fallar(format('delete from public.movimientos_caja where id = %L', pg_temp.id('m1')),
      'un movimiento no se borra ni con la llave del dueño', 'no se borran');
  perform test.debe_fallar(format('update public.movimientos_caja set monto = 1 where id = %L', pg_temp.id('m1')),
      'ni se corrige', 'no se corrige');
  perform test.debe_fallar(format('delete from public.cierres_caja where id = %L', pg_temp.id('c3')),
      'un cierre no se borra', 'no se borran');
  perform test.debe_fallar(format('update public.cierres_caja set motivo_anulacion = ''x'' where id = %L', pg_temp.id('c2')),
      'un cierre reabierto queda como evidencia', 'anulado');
  perform test.debe_fallar(format('delete from public.cajas where id = %L', pg_temp.id('chica')),
      'una cuenta no se borra', 'se desactiva');
end $$;

rollback;
