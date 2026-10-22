-- La nota de crédito del proveedor (decisiones de DKS del 22/10, migración 20261022190000).
-- Con la cuenta de cada puesto —nunca ADMIN— y `set local role authenticated`. Termina en rollback.
--
-- Un RQ de Maestranza pide 10 de un material; Logística los compra con factura a 10 cada uno, el
-- conductor los deja y Almacén los valida. Contabilidad registra la factura F1 por 118.
--   1. Almacén devuelve 2 sin reposición: Contabilidad la ve en «Esperan nota de crédito».
--      Registra la nota por lo devuelto, ligada a la devolución: la factura baja a 94.40, sin
--      tocar la caja, y la devolución deja de esperar nota. Lo que no cuadra no pasa, y
--      Tesorería no registra notas.
--   2. Almacén devuelve 1 con reposición; la nota de esa devolución deja de esperar la reposición
--      y lo que falta vuelve a la lista de Logística.
--   3. Tesorería paga lo que queda de F1. Llega una nota por descuento de 30: no cabe en F1 y
--      queda a favor. Tesorería la descuenta en parte de F2, del mismo proveedor, y registra que
--      el proveedor devolvió el resto: entra a la caja.
--   4. El costeo del código baja con el descuento, y lo ve Requerimientos en su gasto por código.
--   5. Lo que no se deshace por otro camino: el abono de la nota no se anula como un pago, la
--      nota no se borra; se anula, y con ella sus abonos.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'SUPERVISOR:MTZ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GGE',
                           'CONDUCTOR:LOG', 'CONTABILIDAD:CON', 'TESORERIA:TES'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.427@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 427', lower(replace(v, ':', '.')) || '.427@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 427') = 8,
    'se crearon los ocho usuarios del check, uno por puesto');
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.hoy', (now() at time zone 'America/Lima')::date::text, true);
  foreach v in array array['rq', 'oc', 'ing', 'f1', 'f2', 'dev1', 'dev2', 'nc1', 'nc2', 'nc3', 'pago', 'reem'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$ select current_setting('prueba.' || p_clave)::uuid $$;
-- El archivo que sube quien registra, como lo deja Storage.
create or replace function pg_temp.archivo(p_carpeta text, p_id text, p_quien text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_carpeta) || '/' || pg_temp.id(p_id) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('notas-credito', v_ruta, pg_temp.id(p_quien), pg_temp.id(p_quien)::text, '{"mimetype": "application/pdf", "size": 2048}');
  return v_ruta;
end $$;

-- Armazón, como dueño: un material, una unidad, un proveedor y la cuenta de Tesorería.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK427-1', 'Disco de corte de prueba 427', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.unidades (placa, tipo_vehiculo, marca, codigo_interno, activo)
  values ('CHK-427', 'CAMION', 'Volvo', 'CHK427_A', true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 427 S.A.C.'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(427000, 427200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores p where p.numero_documento = x.r)
   order by r limit 1;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 427 S.A.C.'), true);
  perform set_config('prueba.ruc', (select numero_documento from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 427 S.A.C.'), true);
end $$;

-- Requerimientos pide 10; Logística los compra con factura; el conductor los deja; Almacén los valida.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), 'OPERACION', pg_temp.id('area_mtz'),
  'CHK427_A', 'Discos para la prueba 427', null, format('[{"material_id": "%s", "cantidad": 10}]', current_setting('prueba.m1'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(pg_temp.id('rq'), '[{"item": 1, "en_stock": 0}]'::jsonb, null);
reset role;
select set_config('prueba.linea', (select l.id::text from public.requerimiento_lineas l where l.requerimiento_id = pg_temp.id('rq')), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(pg_temp.id('oc'),
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 10, 'precio', 10,
                                       'insumos', jsonb_build_array(current_setting('prueba.linea')))),
  pg_temp.id('proveedor'), 'COT-427', null, 'CONTADO', 0, 'PEN', true);
reset role;
select set_config('prueba.detalle', (select id::text from public.orden_compra_material_detalles where orden_compra_id = pg_temp.id('oc')), true);
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc')) from public.ordenes_compra_materiales
 where id = pg_temp.id('oc') and aprobacion = 'POR_APROBAR';
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.mandar_compra_a_recojo(pg_temp.id('oc'));
select public.programar_recojo(pg_temp.id('oc'), 25, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(pg_temp.id('oc'));
select public.marcar_compra_recogida(pg_temp.id('oc'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oc'));
reset role;
select set_config('prueba.ingresos',
  (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', current_setting('prueba.ing'), 'cantidad', 10))
     from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('oc'))::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc'), current_setting('prueba.ingresos')::jsonb, null);
reset role;

-- Contabilidad registra F1 por la OC (118) y F2, otra factura del mismo proveedor, por 59.
select pg_temp.como('contabilidad');
set local role authenticated;
insert into public.adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                  condicion_pago, orden_compra_id)
values (pg_temp.id('f1'), 'FACTURA_COMPRA', 'PROVEEDOR DE PRUEBA 427 S.A.C.', current_setting('prueba.ruc'), 'F001-4271',
        current_setting('prueba.hoy')::date - 5, current_setting('prueba.hoy')::date - 5, 'PEN', 118, 'CONTADO', pg_temp.id('oc')),
       (pg_temp.id('f2'), 'FACTURA_TESORERIA', 'PROVEEDOR DE PRUEBA 427 S.A.C.', current_setting('prueba.ruc'), 'F001-4272',
        current_setting('prueba.hoy')::date - 5, current_setting('prueba.hoy')::date - 5, 'PEN', 59, 'CONTADO', null);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'comprobantes-financieros', 'adquisiciones/' || pg_temp.id(x) || '/comprobante.pdf', auth.uid()::text,
       '{"mimetype": "application/pdf", "size": 2048}'
  from unnest(array['f1', 'f2']) x;
update public.adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA'
 where id in (pg_temp.id('f1'), pg_temp.id('f2'));
reset role;

create or replace function pg_temp.saldo(p_factura text) returns numeric language sql as $$
  select a.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x where x.adquisicion_id = a.id and x.anulado_en is null), 0)
    from public.adquisiciones a where a.id = pg_temp.id(p_factura);
$$;
select set_config('prueba.caja', test.crear_caja('PEN')::text, true);

-- ============================================ 1. Nota por lo devuelto
select pg_temp.como('almacenero');
set local role authenticated;
select public.devolver_al_proveedor(pg_temp.id('dev1'), pg_temp.id('ing'), 2, 'GR-DEV-427', 'Dos discos llegaron partidos', false);
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
do $$ begin
  perform test.afirmar((select cantidad from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('dev1')) = 2
    and (select importe from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('dev1')) = 20
    and (select facturas->0->>'numero' from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('dev1')) = 'F001-4271',
    'Contabilidad ve que la devolución de 2 (S/ 20 sin IGV) espera su nota, con la factura de su OC');
end $$;
select pg_temp.archivo('f1', 'nc1', 'contabilidad');
-- Lo que no cuadra no pasa.
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'nota 1', current_date, 23.60, 'DEVOLUCION', '%s', 'Dos discos partidos devueltos', '%s')$q$,
  pg_temp.id('nc1'), pg_temp.id('f1'), pg_temp.id('dev1'), pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf'), 'el número de la nota va con su serie');
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'FC01-427', current_date, 200, 'DEVOLUCION', null, 'Dos discos partidos devueltos', '%s')$q$,
  pg_temp.id('nc1'), pg_temp.id('f1'), pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf'), 'la nota no pasa del total de su factura');
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'FC01-427', current_date, 23.60, 'DESCUENTO', '%s', 'Dos discos partidos devueltos', '%s')$q$,
  pg_temp.id('nc1'), pg_temp.id('f1'), pg_temp.id('dev1'), pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf'), 'un descuento no va ligado a una devolución');
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'FC01-427', current_date + 1, 23.60, 'DEVOLUCION', null, 'Dos discos partidos devueltos', '%s')$q$,
  pg_temp.id('nc1'), pg_temp.id('f1'), pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf'), 'la nota no tiene fecha futura');
select public.registrar_nota_credito(pg_temp.id('nc1'), pg_temp.id('f1'), 'fc01-427', current_setting('prueba.hoy')::date, 23.60,
  'DEVOLUCION', pg_temp.id('dev1'), 'Dos discos partidos devueltos', pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf');
select public.registrar_nota_credito(pg_temp.id('nc1'), pg_temp.id('f1'), 'fc01-427', current_setting('prueba.hoy')::date, 23.60,
  'DEVOLUCION', pg_temp.id('dev1'), 'Dos discos partidos devueltos', pg_temp.id('f1') || '/' || pg_temp.id('nc1') || '.pdf');
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'FC01-427', current_date, 23.60, 'DEVOLUCION', '%s', 'Dos discos partidos devueltos', '%s/%s.pdf')$q$,
  pg_temp.id('nc1'), pg_temp.id('f1'), pg_temp.id('dev1'), pg_temp.id('f1'), gen_random_uuid()), 'otro envío con el mismo id no pasa por el mismo');
do $$ begin
  perform test.afirmar((select count(*) from public.notas_credito_compra where adquisicion_id = pg_temp.id('f1')) = 1
    and (select numero from public.notas_credito_compra where id = pg_temp.id('nc1')) = 'FC01-427',
    'la nota entra una vez, con su número en mayúsculas, aunque se envíe dos veces');
  perform test.afirmar(pg_temp.saldo('f1') = 94.40, 'la factura baja a 94.40');
  perform test.afirmar(not exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('dev1')),
    'la devolución ya no espera nota');
end $$;
reset role;
do $$ begin
  perform test.afirmar(not exists (select 1 from public.movimientos_caja where origen_id in
                                     (select id from public.pagos_adquisicion where nota_credito_id = pg_temp.id('nc1'))),
    'lo que baja la nota no mueve la caja');
end $$;
select pg_temp.archivo('f1', 'nc2', 'contabilidad');
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'FC01-427', current_date, 10, 'DESCUENTO', null, 'La misma nota otra vez', '%s')$q$,
  pg_temp.id('nc2'), pg_temp.id('f1'), pg_temp.id('f1') || '/' || pg_temp.id('nc2') || '.pdf'), 'la misma nota del mismo proveedor no entra dos veces');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_nota_credito('%s', '%s', 'FC01-428', current_date, 10, 'DESCUENTO', null, 'Tesorería no registra notas', '%s')$q$,
  pg_temp.id('nc2'), pg_temp.id('f1'), pg_temp.id('f1') || '/' || pg_temp.id('nc2') || '.pdf'), 'Tesorería no registra la nota: es de Contabilidad');
select test.debe_fallar(format($q$insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, nota_credito_id) values ('%s', current_date, 5, 'NC a mano', '%s')$q$,
  pg_temp.id('f1'), pg_temp.id('nc1')), 'el abono de una nota no se escribe a mano');
select test.debe_fallar(format($q$select public.anular_pago_factura(id, 'Quiero quitar la nota') from public.pagos_adquisicion where nota_credito_id = '%s'$q$,
  pg_temp.id('nc1')), 'el abono de la nota no se anula como un pago');
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.notas_credito_compra) = 0, 'Supervisión no lee las notas de crédito');
end $$;
select test.debe_fallar('select * from public.devoluciones_sin_nota_credito()', 'Supervisión no ve lo que espera nota');
select test.debe_fallar('select * from public.notas_credito_a_favor()', 'Supervisión no ve lo que queda a favor');
reset role;

-- ============================================ 2. La nota de una devolución que esperaba reposición
select pg_temp.como('almacenero');
set local role authenticated;
select public.devolver_al_proveedor(pg_temp.id('dev2'), pg_temp.id('ing'), 1, 'GR-DEV-427B', 'Un disco vino sin etiqueta', true);
reset role;
select pg_temp.archivo('f1', 'nc3', 'contabilidad');
select pg_temp.como('contabilidad');
set local role authenticated;
select public.registrar_nota_credito(pg_temp.id('nc3'), pg_temp.id('f1'), 'FC01-429', current_setting('prueba.hoy')::date, 11.80,
  'DEVOLUCION', pg_temp.id('dev2'), 'El proveedor no tiene más de ese disco', pg_temp.id('f1') || '/' || pg_temp.id('nc3') || '.pdf');
reset role;
do $$ begin
  perform test.afirmar((select not se_repone and reposicion_cancelada_en is not null from public.movimientos_materiales
                         where id = pg_temp.id('dev2')),
    'con su nota, la devolución deja de esperar reposición');
  perform test.afirmar(exists (select 1 from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq')
                                  and recompra_por = pg_temp.id('dev2') and cantidad = 1 and orden_compra_detalle_id is null),
    'lo que no se repone vuelve a la lista de Logística');
  perform test.afirmar(pg_temp.saldo('f1') = 82.60, 'la factura baja a 82.60');
  perform test.afirmar((select count(*) from public.notificaciones where usuario_id = pg_temp.id('contabilidad')
                         and titulo like 'Espera la nota de crédito:%') = 1,
    'Contabilidad tiene el aviso de la primera devolución, y no otro por la nota que ella misma registró');
end $$;

-- ============================================ 3. Lo que queda a favor
-- Tesorería paga lo que queda de F1 (sin caja: aquí solo importa el saldo).
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('pagos-facturas', pg_temp.id('f1') || '/' || pg_temp.id('pago') || '.pdf', pg_temp.id('tesoreria')::text,
        '{"mimetype": "application/pdf", "size": 2048}');
select pg_temp.como('tesoreria');
set local role authenticated;
select public.registrar_pago_factura(pg_temp.id('pago'), pg_temp.id('f1'), current_setting('prueba.hoy')::date, 82.60, 'OP-427',
  pg_temp.id('f1') || '/' || pg_temp.id('pago') || '.pdf', pg_temp.id('caja'), null);
reset role;
select set_config('prueba.nc4', gen_random_uuid()::text, true);
select pg_temp.archivo('f1', 'nc4', 'contabilidad');
select pg_temp.como('contabilidad');
set local role authenticated;
select public.registrar_nota_credito(pg_temp.id('nc4'), pg_temp.id('f1'), 'FC01-430', current_setting('prueba.hoy')::date, 30,
  'DESCUENTO', null, 'Descuento por pronto pago acordado', pg_temp.id('f1') || '/' || pg_temp.id('nc4') || '.pdf');
reset role;
do $$ begin
  perform test.afirmar(pg_temp.saldo('f1') = 0 and not exists (select 1 from public.pagos_adquisicion where nota_credito_id = pg_temp.id('nc4')),
    'F1 ya estaba pagada: la nota no baja nada de ella');
  perform test.afirmar(exists (select 1 from public.notificaciones where usuario_id = pg_temp.id('tesoreria')
                                  and titulo = 'Saldo a favor: nota de crédito FC01-430' and cuerpo like '%quedan S/ 30.00 a favor%'),
    'Tesorería recibe el aviso del saldo a favor');
end $$;
select pg_temp.como('tesoreria');
set local role authenticated;
do $$ begin
  perform test.afirmar((select a_favor from public.notas_credito_a_favor() where nota_id = pg_temp.id('nc4')) = 30,
    'Tesorería ve la nota con 30 a favor');
  perform test.afirmar((select saldo from public.facturas_para_la_nota(pg_temp.id('nc4')) where factura_id = pg_temp.id('f2')) = 59
    and not exists (select 1 from public.facturas_para_la_nota(pg_temp.id('nc4')) where factura_id = pg_temp.id('f1')),
    'puede descontarla de F2, que debe 59; F1 ya no debe');
end $$;
select test.debe_fallar(format($q$select public.descontar_nota_credito('%s', '%s', 31)$q$, pg_temp.id('nc4'), pg_temp.id('f2')),
  'no se descuenta más de lo que queda a favor');
select public.descontar_nota_credito(pg_temp.id('nc4'), pg_temp.id('f2'), 20);
select test.debe_fallar(format($q$select public.descontar_nota_credito('%s', '%s', 5)$q$, pg_temp.id('nc4'), pg_temp.id('f2')),
  'la misma nota no descuenta dos veces de la misma factura');
do $$ begin
  perform test.afirmar(pg_temp.saldo('f2') = 39, 'F2 baja a 39');
  perform test.afirmar((select a_favor from public.notas_credito_a_favor() where nota_id = pg_temp.id('nc4')) = 10,
    'a la nota le quedan 10');
end $$;
reset role;
select pg_temp.archivo('nc4', 'reem', 'tesoreria');
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar(format($q$select public.registrar_reembolso_nota_credito('%s', '%s', current_date, 11, 'OP-DEV-427', '%s', '%s', null)$q$,
  pg_temp.id('reem'), pg_temp.id('nc4'), pg_temp.id('nc4') || '/' || pg_temp.id('reem') || '.pdf', pg_temp.id('caja')),
  'no se devuelve más de lo que queda a favor');
select public.registrar_reembolso_nota_credito(pg_temp.id('reem'), pg_temp.id('nc4'), current_setting('prueba.hoy')::date, 10, 'OP-DEV-427',
  pg_temp.id('nc4') || '/' || pg_temp.id('reem') || '.pdf', pg_temp.id('caja'), null);
do $$ begin
  perform test.afirmar((select tipo = 'INGRESO' and monto = 10 from public.movimientos_caja
                         where origen = 'REEMBOLSO_NOTA_CREDITO' and origen_id = pg_temp.id('reem')),
    'lo que el proveedor devolvió entra a la caja como un ingreso');
  perform test.afirmar((select a_favor from public.notas_credito_a_favor() where nota_id = pg_temp.id('nc4')) = 0
    and (select jsonb_array_length(usado) from public.notas_credito_a_favor() where nota_id = pg_temp.id('nc4')) = 2,
    'a la nota no le queda nada, y se ve en qué se usó');
end $$;
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_nota_credito('%s', 'Se registró con el monto mal')$q$, pg_temp.id('nc4')),
  'con dinero devuelto, la nota no se anula hasta anular esa devolución');
reset role;

-- ============================================ 4. El costeo baja con el descuento
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  -- 30 de 118 es la parte de la factura que baja; la OC lleva 100 a este código: −25.42.
  perform test.afirmar((select monto from public.codigo_interno_gasto('CHK427_A') where referencia_id = pg_temp.id('nc4')) = -25.42,
    'el código baja 25.42: la parte de la OC que va a él, en la proporción del descuento sobre la factura');
  perform test.afirmar(not exists (select 1 from public.codigo_interno_gasto('CHK427_A') where referencia_id = pg_temp.id('nc1')),
    'la nota por lo devuelto no toca el costeo: lo devuelto no llegó a ningún código');
end $$;
reset role;

-- ============================================ 5. Deshacer
select pg_temp.como('tesoreria');
set local role authenticated;
select public.anular_reembolso_nota_credito(pg_temp.id('reem'), 'La transferencia rebotó en el banco');
select test.debe_fallar(format($q$select public.quitar_descuento_nota_credito(id, 'No va en su propia factura') from public.pagos_adquisicion where nota_credito_id = '%s'$q$,
  pg_temp.id('nc1')), 'lo que la nota baja de su propia factura no se quita en Tesorería');
select public.quitar_descuento_nota_credito(id, 'Se descontó de la factura equivocada')
  from public.pagos_adquisicion where nota_credito_id = pg_temp.id('nc4') and anulado_en is null;
do $$ begin
  perform test.afirmar(pg_temp.saldo('f2') = 59, 'F2 vuelve a deber 59');
  perform test.afirmar((select a_favor from public.notas_credito_a_favor() where nota_id = pg_temp.id('nc4')) = 30,
    'a la nota vuelven a quedarle 30');
  perform test.afirmar(exists (select 1 from public.movimientos_caja where origen = 'REEMBOLSO_NOTA_CREDITO'
                                  and origen_id = pg_temp.id('reem') and anulado_en is not null),
    'anular la devolución anula su ingreso en la caja');
end $$;
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_nota_credito('%s', 'corto')$q$, pg_temp.id('nc1')), 'sin motivo no se anula');
select public.anular_nota_credito(pg_temp.id('nc1'), 'La nota se registró contra la factura equivocada');
do $$ begin
  perform test.afirmar(pg_temp.saldo('f1') = 23.60,
    'sin la nota, F1 vuelve a deber lo que ella bajaba');
  perform test.afirmar(exists (select 1 from public.devoluciones_sin_nota_credito() where devolucion_id = pg_temp.id('dev1')),
    'la devolución vuelve a esperar su nota');
end $$;
-- El reintento no la anula dos veces ni cambia el motivo.
select public.anular_nota_credito(pg_temp.id('nc1'), 'Otra vez la misma nota');
do $$ begin
  perform test.afirmar((select motivo_anulacion from public.notas_credito_compra where id = pg_temp.id('nc1'))
                        = 'La nota se registró contra la factura equivocada',
    'el reintento de la anulación no cambia nada');
end $$;
reset role;
select test.debe_fallar(format($q$delete from public.notas_credito_compra where id = '%s'$q$, pg_temp.id('nc3')), 'la nota no se borra, ni el dueño');
select test.debe_fallar(format($q$update public.notas_credito_compra set monto = 1 where id = '%s'$q$, pg_temp.id('nc3')), 'lo que dice la nota no se corrige');
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform test.afirmar(exists (select 1 from public.codigo_interno_gasto('CHK427_A') where referencia_id = pg_temp.id('nc4')),
    'la nota por descuento sigue bajando el código');
end $$;
reset role;

rollback;
