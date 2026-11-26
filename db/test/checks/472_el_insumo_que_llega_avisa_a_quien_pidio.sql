-- El insumo que llega avisa a quien lo pidió (migración 20261126300000, plan 3,
-- entrega 3.1). Cuando entra al kardex lo comprado para un insumo de un RQ en
-- compra, la campana le avisa a quien registró ese RQ cuánto le llegó: un aviso
-- por RQ y por recepción, aunque la recepción traiga varios materiales, y solo
-- al RQ al que el ingreso le trajo algo (lo que entra se reparte en el orden en
-- que se pidió). No avisa al RQ que ya está listo, ni lo
-- que vuelve de una salida. El aviso lo lee quien registró el RQ con su rol, y
-- nadie más. Cada paso con el rol que lo hace —nunca ADMIN— y `set local role
-- authenticated`: el ingreso entra por las funciones de Almacén
-- (`validar_ingresos_compra`, `registrar_recepcion_material`). El disparador
-- corre al cerrar la transacción; aquí se adelanta con `set constraints`.
-- Termina en rollback.
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
                           'COMPRADOR:LOG:comprador', 'GERENTE:GER:gerente', 'CONDUCTOR:LOG:conductor', 'VENDEDOR:GCO:vendedor'] loop
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

-- La línea de OC de un insumo.
create or replace function pg_temp.linea_oc(p_rq text, p_item int) returns uuid language sql as $$
  select orden_compra_detalle_id from public.requerimiento_lineas where id = pg_temp.insumo(p_rq, p_item);
$$;

-- Lo que deja el disparador al cerrar la transacción. El check corre entero en
-- una sola, y el aviso de la misma recepción se reconoce por su hora (la de la
-- transacción): los ya dejados se corren un minuto atrás, como si cada paso
-- fuera su propia transacción.
create or replace function pg_temp.cerrar() returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
  update public.notificaciones set creado_en = creado_en - interval '1 minute'
   where titulo like 'Llegó a almacén:%' and creado_en = now();
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
-- Logística la pone en la lista del conductor, que la recoge y la deja en Almacén.
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(current_setting('prueba.oc')::uuid, 50, null);
select public.programar_recojo(current_setting('prueba.oc3')::uuid, 5, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(current_setting('prueba.oc')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc')::uuid);
select public.marcar_compra_recogida(current_setting('prueba.oc3')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc3')::uuid);
reset role;
select pg_temp.cerrar();

select test.afirmar(pg_temp.avisos('rq1') = 0 and pg_temp.avisos('rq2') = 0, 'antes de que llegue nada, ningún aviso de «llegó»');

-- ============================================ 2. Una recepción con dos materiales: un solo aviso, y solo a quien le tocó
-- De las 8 planchas llegan 3 y los 4 discos. Las planchas se reparten en el orden
-- en que se pidieron: las 3 son del RQ 1 (pidió 5 antes que el RQ 2), y al RQ 2 no le llega nada.
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(current_setting('prueba.oc')::uuid, (
  select jsonb_agg(jsonb_build_object('id', p.id, 'movimiento_id', gen_random_uuid(),
           'cantidad', case when p.material_id = current_setting('prueba.pla')::uuid then 3 else p.cantidad end,
           'observacion', case when p.material_id = current_setting('prueba.pla')::uuid then 'Llegaron 3, el resto llega el viernes' end))
    from public.ingresos_pendientes_almacen p where p.orden_compra_id = current_setting('prueba.oc')::uuid), 'GR 001-472');
reset role;
select pg_temp.cerrar();
select test.afirmar(pg_temp.avisos('rq1') = 1, 'la recepción de dos materiales deja un solo aviso al RQ 1, no uno por material');
select test.afirmar(pg_temp.avisos('rq2') = 0, 'al RQ 2 no le llegó nada de esas 3 planchas: no se le avisa');
select test.afirmar((select usuario_id = current_setting('prueba.requerimientos')::uuid
                            and ruta = '/requerimientos?rq=' || current_setting('prueba.rq1')
                            and cuerpo like 'Entró al almacén, para CHK472_A: %'
                            and cuerpo like '%3 UND del insumo 1, Plancha LAF 2 mm (prueba 472)%'
                            and cuerpo like '%4 UND del insumo 2, Disco de corte (prueba 472)%'
                            and cuerpo like '%(prueba 472) (OC-%). Mira en el RQ cuánto ya puedes recoger.'
                            and cuerpo not like '%(OC-%(OC-%'
                       from public.notificaciones
                      where origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Llegó a almacén:%'),
  'el aviso va a quien registró el RQ 1, dice cuánto entró de cada insumo, nombra la OC una vez y abre solo ese RQ');

-- ============================================ 3. Llega el resto de las planchas, a mano: a cada RQ lo suyo
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_recepcion_material(gen_random_uuid(), pg_temp.linea_oc('rq1', 1), 5, 'GR 001-473');
reset role;
select pg_temp.cerrar();
select test.afirmar(pg_temp.avisos('rq1') = 2 and pg_temp.avisos('rq2') = 1, 'el resto avisa a los dos RQ de la línea');
select test.afirmar((select cuerpo like '%: 2 UND del insumo 1,%' from public.notificaciones
                      where origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Llegó a almacén:%' and cuerpo not like '%Disco%'),
  'al RQ 1 le dice que entraron las 2 que le faltaban');
select test.afirmar((select usuario_id = current_setting('prueba.supervisor')::uuid and cuerpo like '%: 3 UND del insumo 1,%'
                       from public.notificaciones
                      where origen_id = current_setting('prueba.rq2')::uuid and titulo like 'Llegó a almacén:%'),
  'y al supervisor que registró el RQ 2, las 3 suyas, no a la cuenta de Requerimientos');

-- ============================================ 4. Lo que no avisa
-- Lo que entra de más no se puede recibir: la recepción no pasa de lo comprado
-- («La recepción supera lo pendiente»). Si entrara, los insumos ya completos no
-- suben y nadie recibe aviso: el cálculo es el mismo de la sección 2, con el RQ 2.
-- El RQ que queda «Listo en almacén» antes de cerrar ya tuvo ese aviso: no recibe «Llegó».
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(current_setting('prueba.oc3')::uuid, (
  select jsonb_agg(jsonb_build_object('id', p.id, 'movimiento_id', gen_random_uuid(), 'cantidad', p.cantidad))
    from public.ingresos_pendientes_almacen p where p.orden_compra_id = current_setting('prueba.oc3')::uuid), 'GR 001-475');
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq3')::uuid, null);
reset role;
select pg_temp.cerrar();
select test.afirmar(pg_temp.avisos('rq3') = 0, 'el RQ que quedó listo con ese ingreso no recibe además «Llegó»');
-- Lo que vuelve al almacén de una salida no es compra; y corre al cerrar la transacción.
select test.afirmar(exists (
  select 1 from pg_trigger t where t.tgname = 'trg_rq_avisar_lo_que_llego'
     and pg_get_triggerdef(t.oid) like '%devolucion_de IS NULL%' and t.tgdeferrable and t.tginitdeferred),
  'el disparador deja fuera lo que vuelve de una salida y corre al cerrar la transacción');

-- ============================================ 5. Quién lo lee
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select count(*) from public.notificaciones
                      where origen_id = current_setting('prueba.rq1')::uuid and titulo like 'Llegó a almacén:%') = 2,
  'quien registró el RQ 1 ve sus dos avisos con su rol');
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
