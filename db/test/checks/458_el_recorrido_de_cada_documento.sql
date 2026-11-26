-- El recorrido de cada documento (migración 20261125130000).
--
--   1. `dias_en_espera` cuenta por fecha de Lima: lo de ayer a las 11:59 p. m.
--      lleva un día, no cero; sin hora, vacío.
--   2. El recorrido del RQ dice, en orden, quién hizo cada paso y cuándo, quién
--      lo tiene ahora y hace cuántos días: registro, sustento y visto de Diseño,
--      revisión de Almacén, compra, listo, entrega y anulación. La vuelta a
--      compra sale de la bitácora.
--   3. El de la cotización: subida, revisión, corrección, código y OT, factura
--      y anulación; desde la 20261126470000, también la factura de lo que falta
--      y el cobro, que Ventas no ve (lo prueba a fondo el check 472).
--   4. Lo lee quien ve el documento y nadie más: la función de la cotización
--      devuelve exactamente las que la política deja ver a cada puesto; el
--      número de la OT, solo a quien lee las órdenes.
--   5. Ninguna de las dos devuelve un importe, un dato de RR. HH. ni el nombre
--      de la persona: solo su puesto (DKS, 2026-11-25).
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000458', 'PRUEBAS 458 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA458', 'Taller prueba del recorrido') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid; v_und uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'DISENO:DIS', 'GERENTE:GGE', 'VENDEDOR:GCO',
                           'ADMINISTRACION:ADM', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'PORTERO:ADM'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.458@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id, sede_id, documento, costo_hora)
    select v_id, initcap(split_part(v, ':', 1)), 'Check 458', lower(replace(v, ':', '.')) || '.458@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2)),
           (select id from public.sedes where codigo = 'QA458'),
           -- Un DNI y un costo por hora que no deben salir en ningún paso.
           '7045' || lpad((row_number() over ())::text, 4, '8'), 45.8
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id from public.areas where codigo = 'MTZ')::text, true);
  foreach v in array array['rqa', 'rqb', 'rqc', 'rqd', 'cot1', 'cot2', 'cot3', 'ot1', 'f1'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
  perform set_config('prueba.carroceria', (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1)::text, true);

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK458-PLA', 'Plancha LAF 3 mm (prueba 458)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1), v_und);
  perform set_config('prueba.pla', (select id::text from public.materiales where codigo = 'CHK458-PLA'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  values (gen_random_uuid(), 'INGRESO', current_setting('prueba.pla')::uuid, 20, 'INGRESO_GENERAL', 'GR 458',
          current_setting('prueba.almacenero')::uuid);

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20990000458', 'QA CLIENTE DEL RECORRIDO S.A.C.') returning id::text into v;
  perform set_config('prueba.cliente', v, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- El recorrido de un RQ en una línea, como lo lee la pantalla: «REGISTRO:HECHO > REVISION_STOCK:AHORA…».
create or replace function pg_temp.camino_rq(p_rq text) returns text language sql as $$
  select string_agg(paso || ':' || situacion, ' > ' order by orden)
    from public.recorrido_de_requerimientos(array[current_setting('prueba.' || p_rq)::uuid]);
$$;
create or replace function pg_temp.camino_cot(p_cot text) returns text language sql as $$
  select string_agg(paso || ':' || situacion, ' > ' order by orden)
    from public.recorrido_de_cotizaciones(array[current_setting('prueba.' || p_cot)::uuid]);
$$;
-- Un paso del RQ, entero.
create or replace function pg_temp.paso_rq(p_rq text, p_paso text, p_situacion text)
returns table (puesto text, en timestamptz, dias integer, espera text, detalle text) language sql as $$
  select puesto, en, dias, espera, detalle
    from public.recorrido_de_requerimientos(array[current_setting('prueba.' || p_rq)::uuid])
   where paso = p_paso and situacion = p_situacion
   order by orden desc limit 1;
$$;
create or replace function pg_temp.paso_cot(p_cot text, p_paso text, p_situacion text)
returns table (puesto text, en timestamptz, dias integer, espera text, detalle text) language sql as $$
  select puesto, en, dias, espera, detalle
    from public.recorrido_de_cotizaciones(array[current_setting('prueba.' || p_cot)::uuid])
   where paso = p_paso and situacion = p_situacion
   order by orden desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ============================================ 1. Los días, por fecha de Lima
do $$
declare v_medianoche timestamptz := ((now() at time zone 'America/Lima')::date)::timestamp at time zone 'America/Lima';
begin
  perform test.afirmar(public.dias_en_espera(now()) = 0, 'lo de ahora lleva 0 días');
  perform test.afirmar(public.dias_en_espera(v_medianoche) = 0, 'lo de las 12:00 a. m. de hoy en Lima, 0 días');
  perform test.afirmar(public.dias_en_espera(v_medianoche - interval '1 second') = 1,
    'lo de ayer a las 11:59:59 p. m. de Lima lleva 1 día, aunque haya pasado un segundo');
  perform test.afirmar(public.dias_en_espera(v_medianoche - interval '2 days 1 second') = 3, 'y lo de hace tres fechas, 3');
  perform test.afirmar(public.dias_en_espera(now() + interval '2 days') = 0, 'una hora por delante no da días negativos');
  perform test.afirmar(public.dias_en_espera(null) is null, 'sin hora no hay días, no cero');
end $$;

-- ============================================ 2. El recorrido del RQ
-- Diseño metra 10 planchas para la unidad.
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.guardar_material_codigo(null, 'chk_458_u1', pg_temp.id('pla'), 10, null, 'Metrado del plano de piso');
end $$;
reset role;

-- Requerimientos pide: A entra en el metrado (4), B se pasa (4 + 8 = 12), C y D van por PLANTA.
select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v record;
begin
  perform public.emitir_requerimiento(pg_temp.id('rqa'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_458_U1',
    'Planchas para el piso de la unidad', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 4)));
  perform public.emitir_requerimiento(pg_temp.id('rqb'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_458_U1',
    'Más planchas para el refuerzo del piso', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 8)));
  perform public.emitir_requerimiento(pg_temp.id('rqc'), 'OPERACION', pg_temp.id('area_mtz'), 'PLANTA',
    'Planchas para una mesa de trabajo', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 2)));
  perform public.emitir_requerimiento(pg_temp.id('rqd'), 'OPERACION', pg_temp.id('area_mtz'), 'PLANTA',
    'Planchas para un estante del almacén', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 2)));

  perform test.afirmar(pg_temp.camino_rq('rqa') = 'REGISTRO:HECHO > REVISION_STOCK:AHORA > LISTO:PENDIENTE > ENTREGA:PENDIENTE',
    'RQ recién registrado: lo tiene Almacén y faltan listo y entrega (' || pg_temp.camino_rq('rqa') || ')');
  select * into v from pg_temp.paso_rq('rqa', 'REGISTRO', 'HECHO');
  perform test.afirmar(v.puesto = 'Requerimientos' and v.en is not null and v.dias is null and v.detalle = 'Maestranza',
    'el registro dice el puesto de la cuenta, la hora y el área que pidió');
  select * into v from pg_temp.paso_rq('rqa', 'REVISION_STOCK', 'AHORA');
  perform test.afirmar(v.puesto = 'Almacén' and v.dias = 0 and v.espera = 'REVISION_STOCK',
    'lo tiene Almacén, desde hoy');

  perform test.afirmar(pg_temp.camino_rq('rqb') = 'REGISTRO:HECHO > SUSTENTO:AHORA > REVISION_STOCK:PENDIENTE > LISTO:PENDIENTE > ENTREGA:PENDIENTE',
    'el que se pasa del metrado espera el sustento de quien lo pidió (' || pg_temp.camino_rq('rqb') || ')');
  select * into v from pg_temp.paso_rq('rqb', 'SUSTENTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Requerimientos' and v.espera = 'SUSTENTO', 'y lo tiene el puesto que lo registró');

  perform public.sustentar_insumos(pg_temp.id('rqb'), '[{"item": 1, "sustento": "El refuerzo del piso lleva dos planchas más que el plano"}]');
  perform test.afirmar(pg_temp.camino_rq('rqb') = 'REGISTRO:HECHO > SUSTENTO:HECHO > VISTO_DISENO:AHORA > REVISION_STOCK:PENDIENTE > LISTO:PENDIENTE > ENTREGA:PENDIENTE',
    'sustentado, lo tiene Diseño (' || pg_temp.camino_rq('rqb') || ')');
  select * into v from pg_temp.paso_rq('rqb', 'VISTO_DISENO', 'AHORA');
  perform test.afirmar(v.puesto = 'Diseño' and v.espera = 'VISTO_DISENO' and v.dias = 0, 'Diseño, desde hoy');
  select * into v from pg_temp.paso_rq('rqb', 'SUSTENTO', 'HECHO');
  perform test.afirmar(v.puesto = 'Requerimientos' and v.detalle = '1', 'el sustento dice qué insumos sustentó (dice ' || coalesce(v.detalle, 'nada') || ')');
end $$;
reset role;

-- El que espera hace tres fechas dice 3 días. Se retrocede la hora del registro sin disparadores: es el armazón.
set local session_replication_role = replica;
update public.requerimientos set creado_en = now() - interval '3 days' where id = pg_temp.id('rqc');
set local session_replication_role = origin;

select pg_temp.como('diseno');
set local role authenticated;
do $$
declare v record;
begin
  perform public.autorizar_insumos(pg_temp.id('rqb'), '{1}', true, null);
  select * into v from pg_temp.paso_rq('rqb', 'VISTO_DISENO', 'HECHO');
  perform test.afirmar(v.puesto = 'Diseño e ingeniería' and v.detalle = 'AUTORIZADO:1',
    'Diseño ve el RQ: su visto queda con su puesto, cómo terminó y sobre qué insumos (dice ' || coalesce(v.detalle, 'nada') || ')');
  perform test.afirmar(pg_temp.camino_rq('rqb') = 'REGISTRO:HECHO > SUSTENTO:HECHO > VISTO_DISENO:HECHO > REVISION_STOCK:AHORA > LISTO:PENDIENTE > ENTREGA:PENDIENTE',
    'autorizado, pasa a Almacén (' || pg_temp.camino_rq('rqb') || ')');
end $$;
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqc', 'REVISION_STOCK', 'AHORA');
  perform test.afirmar(v.dias = 3, 'el RQ registrado hace tres fechas lleva 3 días con Almacén (dice ' || v.dias || ')');

  -- A: hay todo. B: no hay nada.
  perform public.rq_revisar_stock(pg_temp.id('rqa'), '[{"item": 1, "en_stock": 4}]', 'Está en el estante B');
  perform test.afirmar(pg_temp.camino_rq('rqa') = 'REGISTRO:HECHO > REVISION_STOCK:HECHO > LISTO:HECHO > ENTREGA:AHORA',
    'con stock queda listo y lo tiene el área (' || pg_temp.camino_rq('rqa') || ')');
  select * into v from pg_temp.paso_rq('rqa', 'ENTREGA', 'AHORA');
  perform test.afirmar(v.puesto = 'Maestranza' and v.espera = 'RECOJO_DEL_AREA', 'el área que lo pidió lo recoge');
  select * into v from pg_temp.paso_rq('rqa', 'REVISION_STOCK', 'HECHO');
  perform test.afirmar(v.puesto = 'Almacenero', 'la revisión queda con el puesto de Almacén');

  perform public.rq_revisar_stock(pg_temp.id('rqb'), '[{"item": 1, "en_stock": 0}]', null);
  perform test.afirmar(pg_temp.camino_rq('rqb') = 'REGISTRO:HECHO > SUSTENTO:HECHO > VISTO_DISENO:HECHO > REVISION_STOCK:HECHO > COMPRA:AHORA > LISTO:PENDIENTE > ENTREGA:PENDIENTE',
    'sin stock pasa a compra (' || pg_temp.camino_rq('rqb') || ')');
  select * into v from pg_temp.paso_rq('rqb', 'COMPRA', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_COMPRAR', 'y lo tiene Logística, por comprar');
end $$;
reset role;

select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  perform public.rq_marcar_en_atencion(pg_temp.id('rqb'), 'Se pide a Aceros');
  perform test.afirmar(pg_temp.camino_rq('rqb') = 'REGISTRO:HECHO > SUSTENTO:HECHO > VISTO_DISENO:HECHO > REVISION_STOCK:HECHO > COMPRA:HECHO > LISTO:AHORA > ENTREGA:PENDIENTE',
    'Logística lo toma: la compra queda hecha y falta que llegue (' || pg_temp.camino_rq('rqb') || ')');
  select * into v from pg_temp.paso_rq('rqb', 'COMPRA', 'HECHO');
  perform test.afirmar(v.puesto = 'Compras', 'con el puesto de quien lo tomó');
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_COMPRAR' and v.detalle is null,
    'mientras no va en una OC, lo sigue teniendo Logística');
end $$;
reset role;

-- Lo que la tarjeta del RQ llama «Ya llegó todo»: sigue en compra, pero a ningún
-- insumo le falta llegar nada. Ya no lo tiene quien compra: lo tiene Almacén, que
-- lo marca listo. Aquí se arma con lo que Almacén separó de su stock, sin disparadores.
set local session_replication_role = replica;
update public.requerimiento_lineas set cantidad_en_stock = cantidad where requerimiento_id = pg_temp.id('rqb');
set local session_replication_role = origin;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Almacén' and v.espera = 'YA_LLEGO_TODO' and v.detalle is null,
    'en compra y con todo en almacén, lo tiene Almacén (dice ' || coalesce(v.puesto, '?') || ', ' || coalesce(v.espera, '?') || ')');
end $$;
reset role;
set local session_replication_role = replica;
update public.requerimiento_lineas set cantidad_en_stock = 0 where requerimiento_id = pg_temp.id('rqb');
set local session_replication_role = origin;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_COMPRAR', 'y si vuelve a faltar, lo tiene otra vez Logística');
end $$;
reset role;

-- La OC aprobada que Logística todavía no programó con el conductor la tiene
-- Logística: el conductor no la ve en sus recojos hasta que tiene su fila en
-- `programacion_recojo`. Programada, la tiene el conductor. La OC se arma sin
-- disparadores: su ciclo tiene sus checks (329, 333).
select set_config('prueba.oc', gen_random_uuid()::text, true);
set local session_replication_role = replica;
insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en, creado_por)
values (pg_temp.id('oc'), pg_temp.id('rqb'), 'Proveedor del check 458', 'OC-0458-MW', 'APROBADA', pg_temp.id('gerente'), now() - interval '2 days', pg_temp.id('comprador'));
update public.requerimiento_lineas set orden_compra_id = pg_temp.id('oc'), atendida_en = now(), atendida_por = pg_temp.id('comprador')
 where requerimiento_id = pg_temp.id('rqb');
set local session_replication_role = origin;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_PROGRAMAR' and v.detalle like '%OC-0458-MW%' and v.dias = 2,
    'aprobada y sin programar, la tiene Logística desde que se aprobó (dice ' || coalesce(v.puesto, '?') || ', ' || coalesce(v.espera, '?') || ', ' || coalesce(v.dias::text, '?') || ')');
end $$;
reset role;
set local session_replication_role = replica;
insert into public.programacion_recojo (orden_compra_id, posicion, peso_kg, programado_por, programado_en)
values (pg_temp.id('oc'), 1, 120, pg_temp.id('comprador'), now());
set local session_replication_role = origin;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Conductor de Logística' and v.espera = 'PENDIENTE_RECOJO' and v.dias = 0,
    'programada, la tiene el conductor desde que se programó (dice ' || coalesce(v.puesto, '?') || ', ' || coalesce(v.espera, '?') || ')');
end $$;
reset role;
-- Logística la saca de la lista del conductor (`quitar_recojo_de_la_lista` deja
-- la fila sin posición): el conductor ya no la ve, y vuelve a ser de Logística.
set local session_replication_role = replica;
update public.programacion_recojo set posicion = null where orden_compra_id = pg_temp.id('oc');
set local session_replication_role = origin;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_PROGRAMAR',
    'sacada de la lista del conductor, vuelve a Logística (dice ' || coalesce(v.puesto, '?') || ', ' || coalesce(v.espera, '?') || ')');
end $$;
reset role;
-- En un RQA también la programa Logística: Administración no tiene compras.programar_recojo.
set local session_replication_role = replica;
update public.requerimientos set tipo = 'ADMINISTRACION' where id = pg_temp.id('rqb');
set local session_replication_role = origin;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_PROGRAMAR',
    'en un RQA, la OC sin programar también la tiene Logística (dice ' || coalesce(v.puesto, '?') || ')');
end $$;
reset role;
set local session_replication_role = replica;
update public.requerimientos set tipo = 'OPERACION' where id = pg_temp.id('rqb');
set local session_replication_role = origin;

-- Con varias OC, manda la que va más atrás; a igual punto, la que falta
-- programar (o la observada) va antes que la que ya tiene el conductor (o
-- Almacén por validar), sin importar el número del insumo. Se le suma al RQ un
-- segundo insumo con su propia OC, sin disparadores.
select set_config('prueba.oc2', gen_random_uuid()::text, true);
set local session_replication_role = replica;
update public.programacion_recojo set posicion = 1 where orden_compra_id = pg_temp.id('oc');
insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en, creado_por)
values (pg_temp.id('oc2'), pg_temp.id('rqb'), 'Proveedor del check 458', 'OC-0459-MW', 'APROBADA', pg_temp.id('gerente'), now() - interval '1 day', pg_temp.id('comprador'));
insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id, material_id,
                                         cantidad_en_stock, stock_revisado_en, stock_revisado_por, orden_compra_id, atendida_en, atendida_por)
select requerimiento_id, 2, descripcion, cantidad, unidad_medida_id, categoria_id, material_id,
       0, now(), stock_revisado_por, pg_temp.id('oc2'), now(), pg_temp.id('comprador')
  from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rqb') and item = 1;
set local session_replication_role = origin;
select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'POR_PROGRAMAR' and v.detalle like '%OC-0459-MW%',
    'con la OC del insumo 1 en la lista del conductor y la del 2 sin programar, lo tiene Logística por la del 2 (dice '
    || coalesce(v.puesto, '?') || ', ' || coalesce(v.detalle, '?') || ')');
end $$;
reset role;

-- Las dos ya dejadas en almacén: la del insumo 1 por validar y la del 2
-- observada ayer. Lo observado va primero y cuenta desde que Almacén lo observó,
-- no desde que se dejó (hace tres días).
set local session_replication_role = replica;
update public.ordenes_compra_materiales
   set recojo = 'DEJADO', recojo_pedido_en = now() - interval '4 days', recogido_en = now() - interval '3 days', recogido_por = pg_temp.id('comprador'),
       dejado_en = now() - interval '3 days', dejado_por = pg_temp.id('comprador'), entregado_almacen_en = now() - interval '3 days'
 where id in (pg_temp.id('oc'), pg_temp.id('oc2'));
insert into public.orden_compra_material_detalles (id, orden_compra_id, material_id, cantidad)
values (gen_random_uuid(), pg_temp.id('oc'), pg_temp.id('pla'), 8), (gen_random_uuid(), pg_temp.id('oc2'), pg_temp.id('pla'), 8);
insert into public.ingresos_pendientes_almacen (orden_compra_id, orden_compra_detalle_id, material_id, cantidad, dejado_por, dejado_en, estado, validado_por, validado_en, observacion)
select d.orden_compra_id, d.id, d.material_id, 8, pg_temp.id('comprador'), now() - interval '3 days',
       case when d.orden_compra_id = pg_temp.id('oc2') then 'OBSERVADO' else 'PENDIENTE' end,
       case when d.orden_compra_id = pg_temp.id('oc2') then pg_temp.id('almacenero') end,
       case when d.orden_compra_id = pg_temp.id('oc2') then now() - interval '1 day' end,
       case when d.orden_compra_id = pg_temp.id('oc2') then 'Llegaron planchas dobladas' end
  from public.orden_compra_material_detalles d where d.orden_compra_id in (pg_temp.id('oc'), pg_temp.id('oc2'));
set local session_replication_role = origin;
select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v record;
begin
  select * into v from pg_temp.paso_rq('rqb', 'LISTO', 'AHORA');
  perform test.afirmar(v.puesto = 'Logística' and v.espera = 'OBSERVADO' and v.detalle like '%OC-0459-MW%' and v.dias = 1,
    'lo observado va antes que lo que Almacén tiene por validar, y cuenta desde que se observó (dice '
    || coalesce(v.puesto, '?') || ', ' || coalesce(v.espera, '?') || ', ' || coalesce(v.dias::text, '?') || ' día(s))');
end $$;
reset role;

-- La vuelta a compra: el RQ listo que vuelve porque Almacén devolvió parte al
-- proveedor. Lo hace `reabrir_rq_por_lo_devuelto`; aquí, su misma sentencia con
-- la sesión de Almacén, para que la bitácora la anote.
-- Sin disparadores, el «listo» de antes se corre una hora atrás, para que el
-- recorrido lo ponga antes de la vuelta y no por el orden del circuito.
set local session_replication_role = replica;
update public.requerimientos
   set creado_en = now() - interval '2 hours', revision_stock_en = now() - interval '2 hours', listo_en_almacen_en = now() - interval '1 hour'
 where id = pg_temp.id('rqa');
set local session_replication_role = origin;
select pg_temp.como('almacenero');
do $$
declare v record;
begin
  update public.requerimientos set estado = 'EN_ATENCION', listo_en_almacen_en = null, listo_en_almacen_por = null
   where id = pg_temp.id('rqa');
  set local role authenticated;
  select * into v from pg_temp.paso_rq('rqa', 'VUELTA_A_COMPRA', 'HECHO');
  perform test.afirmar(v.puesto = 'Almacenero' and v.en is not null, 'la vuelta a compra sale de la bitácora, con su puesto y su hora');
  perform test.afirmar(pg_temp.camino_rq('rqa') = 'REGISTRO:HECHO > REVISION_STOCK:HECHO > LISTO:HECHO > VUELTA_A_COMPRA:HECHO > LISTO:AHORA > ENTREGA:PENDIENTE',
    'el «listo» que la vuelta borró sigue en el recorrido, y el RQ vuelve a esperar que esté listo (' || pg_temp.camino_rq('rqa') || ')');
  perform test.afirmar((select puesto = 'Almacenero' and en < now() from public.recorrido_de_requerimientos(array[pg_temp.id('rqa')])
                         where paso = 'LISTO' and situacion = 'HECHO'),
    'con el puesto y la hora de quien lo marcó');
  reset role;
  update public.requerimientos set estado = 'LISTO_EN_ALMACEN', listo_en_almacen_en = now(), listo_en_almacen_por = pg_temp.id('almacenero')
   where id = pg_temp.id('rqa');
end $$;

set local role authenticated;
do $$
declare v record;
begin
  perform public.rq_entregar_con_faltante(pg_temp.id('rqa'), 'Lo recogió el supervisor de Maestranza',
    'El resto ya no se necesita: el piso se cerró con lo que había');
  perform test.afirmar(pg_temp.camino_rq('rqa') = 'REGISTRO:HECHO > REVISION_STOCK:HECHO > LISTO:HECHO > VUELTA_A_COMPRA:HECHO > LISTO:HECHO > ENTREGA:HECHO',
    'entregado: todo hecho y nadie lo tiene (' || pg_temp.camino_rq('rqa') || ')');
  select * into v from pg_temp.paso_rq('rqa', 'ENTREGA', 'HECHO');
  perform test.afirmar(v.puesto = 'Almacenero' and v.detalle = 'CON_FALTANTE', 'la entrega con faltante lo dice');
end $$;
reset role;

select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v record;
begin
  perform public.anular_requerimiento(pg_temp.id('rqd'), 'Se pidió dos veces por error');
  perform test.afirmar(pg_temp.camino_rq('rqd') = 'REGISTRO:HECHO > ANULACION:HECHO',
    'anulado: queda lo hecho, sin nadie esperando (' || pg_temp.camino_rq('rqd') || ')');
  -- De varios a la vez, cada uno con su numeración.
  perform test.afirmar((select count(distinct documento) = 4 and bool_and(orden >= 1)
                          from public.recorrido_de_requerimientos(array[pg_temp.id('rqa'), pg_temp.id('rqb'), pg_temp.id('rqc'), pg_temp.id('rqd')])),
    'pedidos juntos, cada RQ trae su recorrido');
  perform test.afirmar((select count(*) from public.recorrido_de_requerimientos(array[pg_temp.id('rqa')]) r
                         group by r.documento having count(*) <> count(distinct r.orden)) is null,
    'el orden no se repite dentro de un RQ');
end $$;
reset role;

-- Gerencia ve los RQ; Portería no.
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.camino_rq('rqb') like 'REGISTRO:HECHO%', 'Gerencia, que ve los requerimientos, ve su recorrido');
reset role;
select pg_temp.como('portero');
set local role authenticated;
select test.debe_fallar(format('select * from public.recorrido_de_requerimientos(array[%L::uuid])', current_setting('prueba.rqa')),
  'Portería no ve requerimientos: tampoco su recorrido', 'No tienes permiso para ver los requerimientos');
select test.debe_fallar(format('select * from public.recorrido_de_cotizaciones(array[%L::uuid])', current_setting('prueba.cot1')),
  'ni el de las cotizaciones', 'No tienes permiso para ver las cotizaciones');
reset role;

-- ============================================ 3. El recorrido de la cotización
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'cotizaciones-pdf', 'cot/' || current_setting('prueba.' || c) || '/' || v || '.pdf', current_setting('prueba.vendedor'),
       '{"mimetype": "application/pdf", "size": 120}'::jsonb
  from unnest(array['cot1', 'cot2', 'cot3']) c, unnest(array['v1', 'v2']) v;

select pg_temp.como('vendedor');
set local role authenticated;
do $$
declare v record; c text;
begin
  foreach c in array array['cot1', 'cot2', 'cot3'] loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
    values (pg_temp.id(c), 'QA-458-' || right(c, 1), pg_temp.id('cliente'), pg_temp.id('carroceria'),
            'v1.pdf', 'cot/' || current_setting('prueba.' || c) || '/v1.pdf', 'application/pdf', 120, pg_temp.id('vendedor'), 45800, 'PEN');
  end loop;
  perform test.afirmar(pg_temp.camino_cot('cot1') = 'SUBIDA:HECHO > REVISION:AHORA > CODIGO_Y_OT:PENDIENTE > FACTURA:PENDIENTE',
    'cotización recién subida: la tiene Gerencia (' || pg_temp.camino_cot('cot1') || ')');
  select * into v from pg_temp.paso_cot('cot1', 'SUBIDA', 'HECHO');
  perform test.afirmar(v.puesto = 'Agente de Ventas', 'la subida, con el puesto de Ventas');
  select * into v from pg_temp.paso_cot('cot1', 'REVISION', 'AHORA');
  perform test.afirmar(v.puesto = 'Gerencia' and v.dias = 0 and v.espera = 'REVISION', 'la tiene Gerencia, desde hoy');
end $$;
reset role;

select pg_temp.como('gerente');
set local role authenticated;
do $$
declare v record;
begin
  update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el plazo de entrega' where id = pg_temp.id('cot1');
  perform test.afirmar(pg_temp.camino_cot('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CORRECCION:AHORA > REVISION:PENDIENTE > CODIGO_Y_OT:PENDIENTE > FACTURA:PENDIENTE > COBRO:PENDIENTE',
    'rechazada: vuelve a quien la subió, y después Gerencia revisa la corrección (' || pg_temp.camino_cot('cot1') || ')');
  select * into v from pg_temp.paso_cot('cot1', 'CORRECCION', 'AHORA');
  perform test.afirmar(v.puesto = 'Agente de Ventas' and v.espera = 'CORRECCION', 'la tiene Ventas');
  select * into v from pg_temp.paso_cot('cot1', 'REVISION', 'HECHO');
  perform test.afirmar(v.puesto = 'Gerencia' and v.detalle = 'RECHAZADA', 'el rechazo, con el puesto de Gerencia');
  -- La cot2 se aprueba de frente; la cot3 se anula.
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = pg_temp.id('cot2');
  update public.cotizaciones_pdf set estado = 'ANULADA', observacion = 'El cliente desistió de la compra' where id = pg_temp.id('cot3');
  perform test.afirmar(pg_temp.camino_cot('cot3') = 'SUBIDA:HECHO > ANULACION:HECHO',
    'anulada: queda lo hecho, sin nadie esperando (' || pg_temp.camino_cot('cot3') || ')');
  perform test.afirmar(pg_temp.camino_cot('cot2') = 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:AHORA > FACTURA:PENDIENTE > COBRO:PENDIENTE',
    'aprobada sin OT: la tiene Administración (' || pg_temp.camino_cot('cot2') || ')');
  select * into v from pg_temp.paso_cot('cot2', 'CODIGO_Y_OT', 'AHORA');
  perform test.afirmar(v.puesto = 'Administración' and v.espera = 'CODIGO_Y_OT', 'Administración le da su código y sube su OT');
end $$;
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
do $$
begin
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || current_setting('prueba.cot1') || '/v2.pdf', nombre_archivo = 'v2.pdf', motivo_correccion = 'Se agregó el plazo de entrega.'
   where id = pg_temp.id('cot1');
  perform test.afirmar(pg_temp.camino_cot('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CORRECCION:HECHO > REVISION:AHORA > CODIGO_Y_OT:PENDIENTE > FACTURA:PENDIENTE',
    'corregida: el rechazo y la corrección quedan en el recorrido, y vuelve a Gerencia (' || pg_temp.camino_cot('cot1') || ')');
  perform test.afirmar((select detalle = 'versión 2' and puesto = 'Agente de Ventas' from pg_temp.paso_cot('cot1', 'CORRECCION', 'HECHO')),
    'la corrección dice a qué versión pasó y quién la subió');
end $$;
reset role;

select pg_temp.como('gerente');
set local role authenticated;
update public.cotizaciones_pdf set estado = 'APROBADA' where id = pg_temp.id('cot1');
reset role;

select pg_temp.como('administracion');
set local role authenticated;
do $$
declare v record;
begin
  perform public.cargar_codigo_y_ot_de_cotizacion(pg_temp.id('cot1'), pg_temp.id('ot1'), 'qa-ci 458', '9458', 'SEMIRREMOLQUE',
    current_setting('prueba.hoy')::date + 30, 'ot/' || current_setting('prueba.ot1') || '/orden.pdf', 'orden.pdf', 100);
  perform test.afirmar(pg_temp.camino_cot('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CORRECCION:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:AHORA > COBRO:PENDIENTE',
    'con su código y su OT, la tiene Contabilidad (' || pg_temp.camino_cot('cot1') || ')');
  select * into v from pg_temp.paso_cot('cot1', 'CODIGO_Y_OT', 'HECHO');
  perform test.afirmar(v.puesto = 'Administración' and v.detalle like 'OT 9458-%',
    'Administración, que lee las órdenes, ve el número de la OT');
  select * into v from pg_temp.paso_cot('cot1', 'FACTURA', 'AHORA');
  perform test.afirmar(v.puesto = 'Contabilidad' and v.espera = 'FACTURA' and v.dias = 0, 'Contabilidad, desde hoy');
end $$;
reset role;

select set_config('prueba.f1_ruta', current_setting('prueba.f1') || '/' || gen_random_uuid() || '.pdf', true);
select pg_temp.como('contabilidad');
set local role authenticated;
do $$
declare v record;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('facturas-venta', current_setting('prueba.f1_ruta'), current_setting('prueba.contabilidad'), '{"mimetype": "application/pdf", "size": 900}');
  perform public.registrar_factura_venta(pg_temp.id('f1'), pg_temp.id('cot1'), 'E001-458',
    current_setting('prueba.hoy')::date, current_setting('prueba.hoy')::date, 'PEN', 22900, 'Inicial 50 %', current_setting('prueba.f1_ruta'), 'f.pdf');
  perform test.afirmar(pg_temp.camino_cot('cot1') = 'SUBIDA:HECHO > REVISION:HECHO > CORRECCION:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > FACTURA_RESTO:AHORA > COBRO:AHORA',
    'facturada la mitad: espera la factura del resto y su cobro (migración 20261126470000) (' || pg_temp.camino_cot('cot1') || ')');
  select * into v from pg_temp.paso_cot('cot1', 'FACTURA', 'HECHO');
  perform test.afirmar(v.puesto = 'Contabilidad' and v.detalle = 'EN_PARTE',
    'la factura sale con su puesto, sin número ni monto; a Contabilidad le dice que es una parte (migración 20261126470000)');
end $$;
reset role;

-- La aprobada que se anula conserva su revisión y cómo terminó: la columna del
-- estado ya dice ANULADA, y la decisión sale de la bitácora.
select pg_temp.como('gerente');
set local role authenticated;
do $$
declare v record;
begin
  update public.cotizaciones_pdf set estado = 'ANULADA', observacion = 'El cliente compró en otra empresa' where id = pg_temp.id('cot2');
  perform test.afirmar(pg_temp.camino_cot('cot2') = 'SUBIDA:HECHO > REVISION:HECHO > ANULACION:HECHO',
    'aprobada y anulada: queda su revisión y su anulación, sin nadie esperando (' || pg_temp.camino_cot('cot2') || ')');
  select * into v from pg_temp.paso_cot('cot2', 'REVISION', 'HECHO');
  perform test.afirmar(v.puesto = 'Gerencia' and v.detalle = 'APROBADA',
    'y su revisión dice que se aprobó (dice ' || coalesce(v.detalle, 'nada') || ')');
end $$;
reset role;

-- ============================================ 4. La ve quien ve el documento, y nadie más
-- Con cada puesto, las cotizaciones que devuelve la función son las que la
-- política de la tabla le deja leer. Si la política cambia y la función no, falla.
do $$
declare
  v_puesto text;
  v_tabla uuid[];
  v_funcion uuid[];
  v_todas uuid[] := array[pg_temp.id('cot1'), pg_temp.id('cot2'), pg_temp.id('cot3')];
begin
  foreach v_puesto in array array['vendedor', 'gerente', 'administracion', 'contabilidad', 'tesoreria', 'diseno', 'almacenero', 'requerimientos', 'comprador'] loop
    perform pg_temp.como(v_puesto);
    set local role authenticated;
    select coalesce(array_agg(c.id order by c.id), '{}') into v_tabla from public.cotizaciones_pdf c where c.id = any(v_todas);
    begin
      select coalesce(array_agg(distinct r.documento order by r.documento), '{}') into v_funcion
        from public.recorrido_de_cotizaciones(v_todas) r;
    exception when insufficient_privilege then
      v_funcion := '{}';
    end;
    reset role;
    perform test.afirmar(v_tabla = v_funcion,
      format('%s: la función devuelve las mismas cotizaciones que la tabla (%s de 3)', v_puesto, cardinality(v_tabla)));
  end loop;
end $$;

-- El número de la OT, solo a quien lee las órdenes. Hoy todo puesto que ve
-- cotizaciones las lee; se le quita el permiso a Ventas para probar la puerta.
delete from public.roles_permisos
 where permiso_codigo = 'ordenes.ver' and rol_id = (select id from public.roles where codigo = 'VENDEDOR');
select pg_temp.como('vendedor');
set local role authenticated;
do $$
declare v record;
begin
  perform test.afirmar((select count(*) from public.ordenes_trabajo where id = pg_temp.id('ot1')) = 0, 'sin ese permiso, Ventas no lee la orden');
  select * into v from pg_temp.paso_cot('cot1', 'CODIGO_Y_OT', 'HECHO');
  perform test.afirmar(v.puesto = 'Administración' and v.detalle is null, 've que ya tiene su código y su OT, sin el número de la OT');
  perform test.afirmar((select count(*) from public.facturas_venta) = 0
                       and (select puesto from pg_temp.paso_cot('cot1', 'FACTURA', 'HECHO')) = 'Contabilidad',
    'y que ya se facturó, sin ver la factura');
end $$;
reset role;

-- ============================================ 5. Ni importes ni datos de RR. HH.
select test.afirmar(
  (select bool_and(pg_get_function_result(p.oid) =
                   'TABLE(documento uuid, orden integer, paso text, situacion text, puesto text, en timestamp with time zone, dias integer, espera text, detalle text)')
     from pg_proc p where p.proname in ('recorrido_de_requerimientos', 'recorrido_de_cotizaciones')),
  'las dos funciones devuelven las mismas nueve columnas: ninguna es un monto ni el nombre de la persona');
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  not exists (
    select 1 from (
      select to_jsonb(r)::text as fila from public.recorrido_de_requerimientos(
        array[pg_temp.id('rqa'), pg_temp.id('rqb'), pg_temp.id('rqc'), pg_temp.id('rqd')]) r
      union all
      select to_jsonb(r)::text from public.recorrido_de_cotizaciones(array[pg_temp.id('cot1'), pg_temp.id('cot2'), pg_temp.id('cot3')]) r
    ) t
    where t.fila ~ '7045|45\.8|45800|22900|prueba\.local|Check 458'),
  'en ningún paso sale un DNI, un costo por hora, un correo, un importe ni el nombre de la cuenta');
reset role;

-- Nadie sin sesión las ejecuta.
select test.afirmar(
  not has_function_privilege('anon', 'public.recorrido_de_requerimientos(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.recorrido_de_cotizaciones(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.dias_en_espera(timestamptz)', 'execute'),
  'ninguna de las tres funciones la ejecuta quien no tiene sesión');

rollback;
