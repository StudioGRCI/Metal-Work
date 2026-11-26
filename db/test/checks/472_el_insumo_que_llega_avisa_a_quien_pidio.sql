-- El insumo que llega avisa a quien lo pidió (migración 20261126300000, plan 3,
-- entrega 3.1). Cuando entra al kardex lo comprado para un insumo de un RQ en
-- compra, la campana le avisa a quien registró ese RQ, una vez por ingreso; si
-- la OC junta dos RQ, cada uno recibe el suyo. No avisa lo que vuelve de una
-- salida, ni al RQ que ya está listo, ni a quien registró el ingreso si es el
-- mismo que pidió. El aviso lo lee quien registró el RQ con su rol, y nadie más.
-- Cada paso con el rol que lo hace —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS RQ S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  -- Dos cuentas que piden (la de Requerimientos y un supervisor de Producción),
  -- Almacén, Logística y una de Ventas que no tiene nada que ver.
  -- El supervisor, de un área que pide y todavía no tiene el suyo (una por área).
  perform set_config('prueba.area_prd', (
    select a.id::text from public.areas a
     where a.activo and a.requerimiento = 'OPERACION'
       and not exists (select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
                        where u.area_id = a.id and u.activo and r.codigo = 'SUPERVISOR')
     order by a.codigo limit 1), true);
  foreach v in array array['REQUERIMIENTOS:REQ:requerimientos', 'SUPERVISOR:-:supervisor', 'ALMACENERO:ALM:almacenero',
                           'COMPRADOR:LOG:comprador', 'GERENTE:GER:gerente', 'VENDEDOR:GCO:vendedor'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, split_part(v, ':', 3) || '.472@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 472', split_part(v, ':', 3) || '.472@prueba.local', r.id,
           case when split_part(v, ':', 2) = '-' then current_setting('prueba.area_prd')::uuid
                else (select id from public.areas where codigo = split_part(v, ':', 2)) end
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rq1', 'rq2', 'rq3', 'oc', 'oc3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select c, d, (select id from public.categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
         (select id from public.unidades_medida where codigo = 'UND')
    from (values ('CHK472-PLA', 'Plancha LAF 2 mm (prueba 472)'), ('CHK472-DIS', 'Disco de corte (prueba 472)')) x(c, d);
  perform set_config('prueba.pla', (select id::text from public.materiales where codigo = 'CHK472-PLA'), true);
  perform set_config('prueba.dis', (select id::text from public.materiales where codigo = 'CHK472-DIS'), true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20999472002', 'Proveedor de prueba 472', 'Av. Argentina 457, Lima', '999 333 472');
  perform set_config('prueba.prov', (select id::text from public.proveedores where numero_documento = '20999472002'), true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.insumo(p_rq text, p_item int) returns uuid language sql as $$
  select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p_rq)::uuid and item = p_item;
$$;

-- Los avisos de «llegó» de un RQ, como dueño (sin RLS).
create or replace function pg_temp.avisos(p_rq text) returns bigint language sql as $$
  select count(*) from public.notificaciones
   where origen_id = current_setting('prueba.' || p_rq)::uuid and titulo like 'Llegó a almacén:%';
$$;

-- Un ingreso de compra al kardex, como dueño: la recepción tiene sus propios checks.
-- Lo registra la cuenta `p_quien`, que es lo que mira el aviso para no avisarse a sí mismo.
create or replace function pg_temp.ingreso(p_rq text, p_item int, p_cantidad numeric, p_quien text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_quien), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
  select gen_random_uuid(), 'INGRESO', d.material_id, p_cantidad, 'COMPRA', 'GR 472', current_setting('prueba.' || p_quien)::uuid, d.id
    from public.requerimiento_lineas l
    join public.orden_compra_material_detalles d on d.id = l.orden_compra_detalle_id
   where l.id = pg_temp.insumo(p_rq, p_item);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ============================================ 1. Dos RQ, de dos personas, por comprar
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq1')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK472_A', 'Armado de la tolva de prueba 472', null,
  format('[{"material_id": "%s", "cantidad": 5}, {"material_id": "%s", "cantidad": 4}]',
         current_setting('prueba.pla'), current_setting('prueba.dis'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq3')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK472_A', 'Refuerzo de la tolva de prueba 472', null,
  format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.dis'))::jsonb);
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq2')::uuid, 'OPERACION', current_setting('prueba.area_prd')::uuid,
  'CHK472_B', 'Pintura del furgón de prueba 472', null,
  format('[{"material_id": "%s", "cantidad": 3}]', current_setting('prueba.pla'))::jsonb);
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.metrado_autorizado();
select public.rq_revisar_stock(current_setting('prueba.rq1')::uuid, '[{"item": 1, "en_stock": 0}, {"item": 2, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq2')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq3')::uuid, '[{"item": 1, "en_stock": 0}]', null);
reset role;

-- Una OC con las planchas de los dos RQ en una línea y los discos del RQ 1 en otra;
-- y otra OC con el disco del RQ 3. Gerencia las aprueba.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc')::uuid,
  format('[{"material_id": "%s", "cantidad": 8, "precio": 10, "insumos": ["%s", "%s"]}, {"material_id": "%s", "cantidad": 4, "precio": 6, "insumos": ["%s"]}]',
         current_setting('prueba.pla'), pg_temp.insumo('rq1', 1), pg_temp.insumo('rq2', 1), current_setting('prueba.dis'), pg_temp.insumo('rq1', 2))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 472', null, 'CONTADO', 0, 'PEN', true);
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc3')::uuid,
  format('[{"material_id": "%s", "cantidad": 1, "precio": 6, "insumos": ["%s"]}]', current_setting('prueba.dis'), pg_temp.insumo('rq3', 1))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 472-B', null, 'CONTADO', 0, 'PEN', true);
reset role;
-- La aprobación se decide al confirmar la transacción: se adelanta aquí.
set constraints all immediate;
set constraints all deferred;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc')::uuid);
select public.aprobar_compra(current_setting('prueba.oc3')::uuid);
reset role;
-- El conductor las deja en Almacén: el recojo tiene sus propios checks, así que se
-- anota como dueño y sin disparadores. Los del movimiento sí corren después.
set local session_replication_role = replica;
update public.ordenes_compra_materiales set entregado_almacen_en = now()
 where id in (current_setting('prueba.oc')::uuid, current_setting('prueba.oc3')::uuid);
set local session_replication_role = origin;

select test.afirmar(pg_temp.avisos('rq1') = 0 and pg_temp.avisos('rq2') = 0, 'antes de que llegue nada, ningún aviso de «llegó»');

-- ============================================ 2. Llega una parte de las planchas: avisa a los dos RQ de esa línea
select pg_temp.ingreso('rq1', 1, 3, 'almacenero');
select test.afirmar(pg_temp.avisos('rq1') = 1 and pg_temp.avisos('rq2') = 1,
  'una parte de la línea compartida avisa a cada RQ una vez');
select test.afirmar((select usuario_id = current_setting('prueba.requerimientos')::uuid
                            and ruta = '/requerimientos?rq=' || current_setting('prueba.rq1')
                            and cuerpo like '%Plancha LAF 2 mm (prueba 472)%' and cuerpo like '%CHK472_A%'
                       from public.notificaciones
                      where origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Llegó a almacén:%'),
  'el del RQ 1 va a quien lo registró, nombra el insumo y el código, y abre solo ese RQ');
select test.afirmar((select usuario_id = current_setting('prueba.supervisor')::uuid
                       from public.notificaciones
                      where origen_id = current_setting('prueba.rq2')::uuid and titulo like 'Llegó a almacén:%'),
  'el del RQ 2 va al supervisor que lo registró, no a la cuenta de Requerimientos');

-- ============================================ 3. Llega el resto: otro aviso; y los discos, el suyo
select pg_temp.ingreso('rq1', 1, 5, 'almacenero');
select pg_temp.ingreso('rq1', 2, 4, 'almacenero');
select test.afirmar(pg_temp.avisos('rq1') = 3 and pg_temp.avisos('rq2') = 2,
  'cada ingreso avisa: el resto de las planchas y los discos');

-- ============================================ 4. Lo que no avisa
-- El que registró el ingreso es el mismo que pidió: no se avisa a sí mismo.
select pg_temp.ingreso('rq3', 1, 1, 'requerimientos');
select test.afirmar(pg_temp.avisos('rq3') = 0, 'quien registra el ingreso no se avisa a sí mismo');
-- Con el RQ ya listo en almacén, otro ingreso de su línea no avisa otra vez.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq2')::uuid, null);
reset role;
select pg_temp.ingreso('rq2', 1, 0.5, 'almacenero');
select test.afirmar(pg_temp.avisos('rq2') = 2, 'el RQ listo en almacén ya tuvo su aviso: no recibe otro');
select test.afirmar(pg_temp.avisos('rq1') = 4, 'el otro RQ de la misma línea, todavía en compra, sí lo recibe');
-- Lo que vuelve al almacén de una salida no es compra.
select test.afirmar(not exists (
  select 1 from pg_trigger t where t.tgname = 'trg_rq_avisar_lo_que_llego'
     and pg_get_triggerdef(t.oid) not like '%devolucion_de IS NULL%'),
  'el disparador deja fuera lo que vuelve de una salida');

-- ============================================ 5. Quién lo lee
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select count(*) from public.notificaciones
                      where origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Llegó a almacén:%') = 4,
  'quien registró el RQ 1 ve sus cuatro avisos con su rol');
select test.afirmar((select count(*) from public.notificaciones
                      where origen_id = current_setting('prueba.rq2')::uuid and titulo like 'Llegó a almacén:%') = 0,
  'y no ve los del RQ del supervisor');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar((select count(*) from public.notificaciones where titulo like 'Llegó a almacén:%') = 0,
  'Ventas no ve ningún aviso de «llegó»');
reset role;
select test.afirmar(not has_function_privilege('authenticated', 'public.fn_rq_avisar_lo_que_llego()', 'execute')
                    and not has_function_privilege('anon', 'public.fn_rq_avisar_lo_que_llego()', 'execute'),
  'la función del disparador no la llama nadie a mano');

rollback;
