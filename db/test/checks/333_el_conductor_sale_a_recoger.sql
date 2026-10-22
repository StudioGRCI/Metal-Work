-- El conductor sale a recoger y el RQ muestra su avance (migración
-- 20261013121000): «Salgo a recoger» pasa la OC a EN_RECOJO, «Ya la recogí»
-- vale desde ahí o directo desde POR_RECOGER, y `avance_de_requerimientos`
-- dice en qué porcentaje va cada RQ, también a quien no lee las órdenes de
-- compra. Cada paso con el rol que lo da —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER',
                           'CONDUCTOR:LOG', 'SUPERVISOR:MTZ', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.333@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 333', lower(replace(v, ':', '.')) || '.333@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK333-PLA', 'Plancha LAF 2 mm 4x8 (333)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20600000331', 'Proveedor de prueba 333', 'Av. Argentina 789, Lima', '999 333 555')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  perform set_config('prueba.rq', gen_random_uuid()::text, true);
  perform set_config('prueba.rq_anulado', gen_random_uuid()::text, true);
  perform set_config('prueba.oc1', gen_random_uuid()::text, true);
  perform set_config('prueba.oc2', gen_random_uuid()::text, true);
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
  v_alm text := current_setting('prueba.almacenero');
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
    perform pg_temp.como('almacenero');
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
  select jsonb_build_array(
    jsonb_build_object('descripcion', 'Plancha LAF 2 mm 4x8', 'cantidad', 3,
      'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')),
    jsonb_build_object('descripcion', 'Guantes de cuero', 'cantidad', 6,
      'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')));
$$;

create or replace function pg_temp.generar(p_oc text, p_items smallint[]) returns uuid language sql as $$
  select public.emitir_compra_del_requerimiento(current_setting('prueba.' || p_oc)::uuid, current_setting('prueba.rq')::uuid, p_items,
    current_setting('prueba.proveedor')::uuid, null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
    null, 'CONTADO', 0, 'PEN', true);
$$;

-- El avance del RQ de prueba, leído con la sesión que esté puesta.
create or replace function pg_temp.avance() returns record language sql as $$
  select (a.porcentaje, a.etapa, a.lineas)
    from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a;
$$;
create or replace function pg_temp.pct() returns integer language sql as $$
  select a.porcentaje from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a;
$$;
create or replace function pg_temp.etapa() returns text language sql as $$
  select a.etapa from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a;
$$;
create or replace function pg_temp.etapa_insumo(p_item int) returns text language sql as $$
  select l->>'etapa' from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a,
         jsonb_array_elements(a.lineas) l where (l->>'item')::int = p_item;
$$;
create or replace function pg_temp.recojo(p_oc text) returns text language sql as $$
  select recojo from public.ordenes_compra_materiales where id = current_setting('prueba.' || p_oc)::uuid;
$$;

-- ============================================ 1. Emitido: Almacén revisa (10 %)
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLA_SR_O4_1_26/28', 'Armado del chasis de la plataforma 28', null, pg_temp.lineas());
select public.emitir_requerimiento(current_setting('prueba.rq_anulado')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLANTA', 'Pedido que se va a anular', null, pg_temp.lineas());
select public.anular_requerimiento(current_setting('prueba.rq_anulado')::uuid, 'Se registró por error');
select test.afirmar(pg_temp.pct() = 10 and pg_temp.etapa() = 'POR_REVISAR', 'recién emitido, el RQ va en 10 % y lo revisa Almacén');
select test.afirmar(
  (select count(*) from public.avance_de_requerimientos(array[current_setting('prueba.rq_anulado')::uuid])) = 0,
  'el RQ anulado no tiene avance');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.pct()$q$, 'quien no ve requerimientos no ve su avance');
reset role;

-- ============================================ 2. Sin stock y una OC por aprobar
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(current_setting('prueba.rq')::uuid, 'No queda plancha de 2 mm');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.generar('oc1', array[1]::smallint[]);
set constraints all immediate;
reset role;
select set_config('prueba.oc1_numero', (select numero from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid), true);

-- Supervisión no lee las OC, pero ve el avance con su número.
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid) = 0,
  'Supervisión no lee la orden de compra');
select test.afirmar(pg_temp.etapa_insumo(1) = 'OC_POR_APROBAR' and pg_temp.etapa_insumo(2) = 'POR_COMPRAR',
  'insumo 1 con OC por aprobar, insumo 2 por comprar');
select test.afirmar(pg_temp.pct() = 25 and pg_temp.etapa() = 'POR_COMPRAR',
  'el RQ va en el promedio (30 y 20 = 25 %) y su etapa es la del más atrasado');
select test.afirmar(
  (select l->>'orden_compra' from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a,
          jsonb_array_elements(a.lineas) l where (l->>'item')::int = 1)
    = current_setting('prueba.oc1_numero'),
  'y ve con qué OC va el insumo 1');
reset role;

-- ============================================ 3. Gerencia aprueba: pendiente de recojo
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc1')::uuid);
reset role;
select test.afirmar(pg_temp.recojo('oc1') = 'POR_RECOGER', 'aprobada, la OC sale sola hacia el conductor');
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(pg_temp.etapa_insumo(1) = 'PENDIENTE_RECOJO', 'aprobada: el insumo 1 queda pendiente de recojo');
reset role;

-- ============================================ 4. «Salgo a recoger»: solo el conductor
-- Sale con lo que Logística le programó (migración 20261015140000).
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(current_setting('prueba.oc1')::uuid, 90, null);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_compra_en_recojo(current_setting('prueba.oc1')::uuid)$q$,
  'Almacén no marca la salida del conductor');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_compra_en_recojo(current_setting('prueba.oc1')::uuid)$q$,
  'Logística tampoco: la marca el conductor');
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid)$q$,
  'no deja en almacén lo que no recogió', 'Marca primero');
select public.marcar_compra_en_recojo(current_setting('prueba.oc1')::uuid);
select public.marcar_compra_en_recojo(current_setting('prueba.oc1')::uuid);  -- el segundo toque no cambia nada
select test.afirmar(
  (select count(*) from public.compras_para_recojo() r where r.id = current_setting('prueba.oc1')::uuid and r.recojo = 'EN_RECOJO') = 1
  and (select count(*) from public.datos_de_recojo() d where d.id = current_setting('prueba.oc1')::uuid) = 1
  and (select count(*) from public.salidas_a_recojo() s where s.id = current_setting('prueba.oc1')::uuid and s.en_recojo_en is not null) = 1,
  'la bandeja del conductor la sigue mostrando, en recojo y con la hora de salida');
select test.debe_fallar($q$select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid)$q$,
  'en recojo todavía no se deja en almacén', 'Marca primero');
reset role;

select test.afirmar(
  (select recojo = 'EN_RECOJO' and en_recojo_por = current_setting('prueba.conductor')::uuid and en_recojo_en is not null
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc1')::uuid),
  'la salida queda con el conductor y la hora');
select test.debe_fallar(
  $q$update public.ordenes_compra_materiales set en_recojo_en = now() - interval '1 hour' where id = current_setting('prueba.oc1')::uuid$q$,
  'la hora de salida no se corrige', 'no se corrige');
select test.debe_fallar(
  $q$update public.ordenes_compra_materiales set recojo = 'POR_RECOGER' where id = current_setting('prueba.oc1')::uuid$q$,
  'el recojo no retrocede', 'no puede pasar');
select test.debe_fallar(
  $q$update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc1')::uuid$q$,
  'en recojo, la entrega a Almacén la marca el conductor al dejarla', 'está con el conductor');

select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar(pg_temp.etapa_insumo(1) = 'EN_RECOJO' and pg_temp.pct() = 40,
  'Requerimientos ve el insumo 1 en recojo y el RQ en 40 % (60 y 20)');
reset role;

-- ============================================ 5. Recogida y dejada
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid);
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(pg_temp.etapa_insumo(1) = 'RECOGIDO', 'recogida: va hacia el almacén');
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc1')::uuid);
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(pg_temp.etapa_insumo(1) = 'POR_VALIDAR', 'dejada: espera que Almacén valide');
reset role;

-- Almacén observa el ingreso (se pone a mano: aquí se prueba la lectura).
update public.ingresos_pendientes_almacen
   set estado = 'OBSERVADO', validado_por = current_setting('prueba.almacenero')::uuid, validado_en = now(),
       observacion = 'Llegaron dos planchas, falta una'
 where orden_compra_id = current_setting('prueba.oc1')::uuid;
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(pg_temp.etapa_insumo(1) = 'OBSERVADO', 'observada por Almacén: lo dice el avance');
reset role;

-- ============================================ 6. Sin tocar «Salgo a recoger» también pasa
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.generar('oc2', array[2]::smallint[]);
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc2')::uuid);
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.programar_recojo(current_setting('prueba.oc2')::uuid, 15, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(current_setting('prueba.oc2')::uuid);
reset role;
select test.afirmar(
  (select recojo = 'RECOGIDO' and en_recojo_en is null and en_recojo_por is null and recogido_en is not null
     from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid),
  'marcada directo como recogida: la salida queda en blanco, sin inventar hora');
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(current_setting('prueba.oc2')::uuid);  -- pantalla vieja: no cambia nada
reset role;
select test.afirmar(pg_temp.recojo('oc2') = 'RECOGIDO', '«Salgo a recoger» tarde no hace retroceder la compra');

-- ============================================ 7. Listo y entregado: 90 % y 100 %
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq')::uuid, 'Llegó con el conductor');
select test.afirmar(pg_temp.pct() = 90 and pg_temp.etapa() = 'LISTO_EN_ALMACEN', 'listo en almacén: 90 %');
reset role;
select pg_temp.sacar_del_kardex('rq');
set local role authenticated;
select public.rq_marcar_entregado(current_setting('prueba.rq')::uuid, 'Supervisor de Maestranza');
select test.afirmar(pg_temp.pct() = 100 and pg_temp.etapa() = 'ENTREGADO', 'entregado: 100 %');
reset role;

do $$ begin raise notice 'OK 333: el conductor sale a recoger y el RQ muestra su avance'; end $$;
rollback;
