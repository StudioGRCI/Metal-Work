-- Lo que DKS pidió para Requerimientos el 2026-10-20 (migraciones 20261020190000
-- y 20261020191000), con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
--
--   1. El código interno se elige de una lista, la misma en cada formulario:
--      los códigos que conoce el sistema, cada uno una vez, escritos como los
--      guarda el costeo, con su unidad (placa y marca, o lo que anotó la
--      portería). El de costeo cerrado viene marcado; el reabierto no. No vienen
--      TODOS LOS ACTIVOS, el código de un RQ anulado ni el de una unidad dada de
--      baja. La leen Requerimientos, la administradora, Tesorería (caja), RR. HH.
--      (costeo de horas) y Supervisión (reporte diario); Almacén y la portería no.
--   2. Lo entregado de cada insumo: Maestranza ve cuánto salió ya del almacén
--      para su RQ, menos lo devuelto, aunque no lea el kardex. Con 15 pedidos,
--      10 en almacén y 4 entregados de los que devolvieron 2, la lista dice
--      2 entregados, 8 para recoger y 5 que faltan de Logística.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ADMINISTRACION:ADM', 'SUPERVISOR:MTZ', 'PORTERO:SAP', 'ALMACENERO:ALM',
                           'TESORERIA:TES', 'RECURSOS_HUMANOS:RRH'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.405@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 405', lower(replace(v, ':', '.')) || '.405@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rq', 'rq_anulado', 'sal', 'dev1', 'dev2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Armazón, como dueño: las unidades, lo que anotó la portería, los cierres y un
-- material con 20 en stock.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
  v_req uuid := current_setting('prueba.requerimientos')::uuid;
begin
  insert into public.unidades (placa, tipo_vehiculo, marca, modelo, codigo_interno, activo) values
    ('CHK-405', 'CAMION', 'Volvo', 'FH', 'CHK405_A', true),
    (null, 'FURGON', 'Hino', null, 'CHK405_CERRADO', true),
    (null, 'FURGON', 'Isuzu', 'NQR', 'CHK405_REABIERTO', true),
    ('BAJ-405', 'CAMION', 'Scania', null, 'CHK405_INACTIVA', false);
  -- La portería la registró en minúsculas y sin unidad en el padrón.
  insert into public.registro_vehiculos (placa, codigo_interno, unidad, empresa, motivo, ingreso_en, ingreso_por)
  values ('POR-405', 'chk405_porteria', 'Hino 500', 'Transportes de prueba 405', 'FABRICACION', now() - interval '2 days', v_req);
  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, cerrado_por)
  values ('CHK405_CERRADO', 1000, 1500, 500, 33.3, '{}'::jsonb, v_req);
  insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por, cerrado_en, reabierto_por, reabierto_en, motivo_reapertura)
  values ('CHK405_REABIERTO', 800, '{}'::jsonb, v_req, now() - interval '3 days', v_req, now() - interval '1 day',
          'Faltaba cargar una compra de prueba 405');

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK405-1', 'Aceite de prueba 405', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m, 20, 'INGRESO_GENERAL', 'Compra de prueba 405', current_setting('prueba.almacenero')::uuid,
          10, 'PEN', now() - interval '1 hour');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal') || '.jpg',
          current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
end $$;

-- Requerimientos registra dos RQ: uno con el código en minúsculas, y otro que anula.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'chk405_a', 'Aceite para la prueba 405', null, format('[{"material_id": "%s", "cantidad": 15}]', current_setting('prueba.m1'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq_anulado')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK405_ANULADO', 'Pedido equivocado de la prueba 405', null, format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.m1'))::jsonb);
select public.anular_requerimiento(current_setting('prueba.rq_anulado')::uuid, 'Se pidió con el código equivocado (prueba 405)');

-- ============================================ 1. La lista de códigos para elegir
create temp table _lista on commit drop as select * from public.codigos_internos_para_elegir();
reset role;
do $$
declare v_n int; v_unidad text; v_cerrado boolean;
begin
  select count(*) into v_n from _lista where codigo = 'CHK405_A';
  perform test.afirmar(v_n = 1, format('CHK405_A sale una vez, aunque lo nombren la unidad y el RQ escrito en minúsculas (%s)', v_n));
  select unidad, cerrado into v_unidad, v_cerrado from _lista where codigo = 'CHK405_A';
  perform test.afirmar(v_unidad = 'CHK-405 · Volvo FH' and not v_cerrado, format('CHK405_A con su placa y su marca: «%s»', v_unidad));
  select unidad into v_unidad from _lista where codigo = 'CHK405_PORTERIA';
  perform test.afirmar(v_unidad = 'POR-405 · Hino 500', format('el código que solo anotó la portería, normalizado y con lo que ella anotó: «%s»', v_unidad));
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'chk405_porteria'), 'no sale también como lo escribió la portería');
  perform test.afirmar((select cerrado from _lista where codigo = 'CHK405_CERRADO'), 'el código con costeo cerrado viene marcado como cerrado');
  perform test.afirmar((select unidad from _lista where codigo = 'CHK405_CERRADO') = 'Hino', 'sin placa, la unidad dice solo la marca');
  perform test.afirmar(not (select cerrado from _lista where codigo = 'CHK405_REABIERTO'), 'el código reabierto vuelve a estar abierto');
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'CHK405_INACTIVA'), 'el de una unidad dada de baja no sale');
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'CHK405_ANULADO'), 'el código de un RQ anulado no sale');
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'TODOS LOS ACTIVOS'), 'TODOS LOS ACTIVOS no es un código de la lista');
  perform test.afirmar((select count(*) from _lista) = (select count(distinct codigo) from _lista), 'cada código sale una sola vez');
  perform test.afirmar(not exists (select 1 from _lista where codigo <> public.normalizar_codigo_interno(codigo)),
    'todos escritos como los guarda el costeo');
end $$;

-- La lista no trae montos: solo el código, la unidad y si está cerrado.
select test.afirmar(pg_get_function_result('public.codigos_internos_para_elegir()'::regprocedure)
                    = 'TABLE(codigo text, unidad text, cerrado boolean)',
  'la lista trae código, unidad y cerrado, sin el costo ni el margen del cierre');

-- La misma lista en cada formulario que pide el código, con la cuenta de cada puesto.
create or replace function pg_temp.lee_la_lista(p_clave text, p_para text) returns void language plpgsql as $$
declare v int;
begin
  perform pg_temp.como(p_clave);
  set local role authenticated;
  select count(*) into v from public.codigos_internos_para_elegir() where codigo = 'CHK405_A';
  reset role;
  perform test.afirmar(v = 1, format('%s la lee, para %s', p_clave, p_para));
end $$;
select pg_temp.lee_la_lista('administracion', 'su RQA');
select pg_temp.lee_la_lista('tesoreria', 'la caja diaria');
select pg_temp.lee_la_lista('recursos_humanos', 'el costeo de horas');
select pg_temp.lee_la_lista('supervisor', 'el reporte diario');

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar('select * from public.codigos_internos_para_elegir()',
  'Almacén no lee la lista: no registra nada con ella', 'No tienes permiso para ver la lista de códigos internos');
reset role;

select pg_temp.como('portero');
set local role authenticated;
select test.debe_fallar('select * from public.codigos_internos_para_elegir()',
  'la portería no lee la lista', 'No tienes permiso para ver la lista de códigos internos');
reset role;

-- ============================================ 2. Lo entregado de cada insumo
-- Almacén tiene 10 de los 15: el RQ queda por comprar.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq')::uuid, '[{"item": 1, "en_stock": 10}]'::jsonb, null);
-- Entrega 4 por el RQ y después le devuelven 1 y otra vez 1.
select public.registrar_salida_material(current_setting('prueba.sal')::uuid, current_setting('prueba.m1')::uuid, 4,
  null, null, 'RQ de la prueba 405', 'Supervisor de Maestranza',
  current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal') || '.jpg',
  (select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1));
select public.registrar_ingreso_almacen(current_setting('prueba.dev1')::uuid, current_setting('prueba.m1')::uuid, 1,
  'DEVOLUCION', 'Devolución 1 de la prueba 405', null, 'PEN', current_setting('prueba.sal')::uuid);
select public.registrar_ingreso_almacen(current_setting('prueba.dev2')::uuid, current_setting('prueba.m1')::uuid, 1,
  'DEVOLUCION', 'Devolución 2 de la prueba 405', null, 'PEN', current_setting('prueba.sal')::uuid);
reset role;
select test.afirmar((select estado from public.requerimientos where id = current_setting('prueba.rq')::uuid) = 'SIN_STOCK',
  'con 10 de 15 en almacén, el RQ queda por comprar');

-- Maestranza lo ve con su cuenta.
select pg_temp.como('supervisor');
set local role authenticated;
create temp table _entregado on commit drop as
  select * from public.entregado_de_requerimientos(array[current_setting('prueba.rq')::uuid, current_setting('prueba.rq_anulado')::uuid]);
create temp table _avance on commit drop as
  select * from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]);
reset role;
do $$
declare v_l jsonb := (select a.lineas -> 0 from _avance a);
begin
  perform test.afirmar((select entregado from _entregado where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1) = 2,
    format('Maestranza ve 2 entregados: 4 que salieron menos 1 y 1 devueltos (%s)',
           (select entregado from _entregado where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1)));
  perform test.afirmar(not exists (select 1 from _entregado where requerimiento_id = current_setting('prueba.rq_anulado')::uuid),
    'el RQ anulado no trae nada');
  -- Con esto la pantalla parte el insumo: 2 entregados, 10 − 2 = 8 para recoger, 15 − 10 = 5 que faltan de Logística.
  perform test.afirmar((v_l ->> 'en_stock')::numeric = 10 and (v_l ->> 'por_comprar')::numeric = 5 and v_l ->> 'etapa' = 'POR_COMPRAR',
    format('el avance dice 10 en almacén y 5 por comprar: %s', v_l));
end $$;
-- La vista de Almacén cuenta la salida una vez por cada devolución (4 + 4 − 2): se deja dicho, no se corrige aquí.
do $$
begin
  raise notice '  nota · v_rq_lineas_para_salida dice % entregados de la misma línea',
    (select entregado from public.v_rq_lineas_para_salida where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1);
end $$;

select pg_temp.como('portero');
set local role authenticated;
select test.debe_fallar(format('select * from public.entregado_de_requerimientos(array[%L::uuid])', current_setting('prueba.rq')),
  'la portería no ve lo entregado de los requerimientos', 'No tienes permiso para ver los requerimientos');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar('select * from public.entregado_de_requerimientos(array(select gen_random_uuid() from generate_series(1, 501)))',
  'se piden hasta 500 requerimientos a la vez', 'hasta 500');
reset role;

rollback;
