-- Lo que DKS pidió para Requerimientos el 2026-10-20 (migraciones 20261020190000
-- y 20261020191000), con la cuenta de cada puesto —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
--
--   1. El código interno se elige de una lista, la misma en cada formulario:
--      los códigos que conoce el sistema, cada uno una vez, escritos como los
--      guarda el costeo, con su unidad (placa y marca, o lo que anotó la
--      portería). El de costeo cerrado viene marcado; el reabierto no. No vienen
--      TODOS LOS ACTIVOS, el código de un RQ anulado ni el de una unidad dada de
--      baja. `registrada` marca el del padrón de unidades: entre CHK420_A y la
--      variante CHK42O_A (con O) que escribió un RQ, el bueno. La abre cada uno
--      de los permisos de los formularios que la usan, uno por uno; Almacén y la
--      portería no la leen.
--   2. Lo entregado de cada insumo: Maestranza ve cuánto salió ya del almacén
--      para su RQ, menos lo devuelto, aunque no lea el kardex. Con 15 pedidos,
--      10 en almacén y 4 entregados de los que devolvieron 2, la lista dice
--      2 entregados, 8 para recoger y 5 que faltan de Logística.
--   3. Lo que llegó de la compra: otro RQ pide 4 que Almacén no tiene, y
--      Logística compra los 9 que faltan de los dos en una sola línea de OC.
--      El proveedor trae 6 y Almacén los valida con observación: al primer RQ
--      le llegaron sus 5 y al segundo 1, aunque la etapa diga «Observado».
--      Antes de validarlos no llegó nada.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ADMINISTRACION:ADM', 'SUPERVISOR:MTZ', 'PORTERO:SAP', 'ALMACENERO:ALM',
                           'TESORERIA:TES', 'RECURSOS_HUMANOS:RRH', 'COMPRADOR:LOG', 'GERENTE:GGE', 'CONDUCTOR:LOG'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.420@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 420', lower(replace(v, ':', '.')) || '.420@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  -- El insert…select no falla si un código de rol cambia: sin esto, un usuario que
  -- no se creó recibiría el mismo «sin permiso» y los debe_fallar pasarían igual.
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 420') = 10,
    'se crearon los diez usuarios del check, uno por puesto');
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rq', 'rq_anulado', 'rq_gemelo', 'rq2', 'oc', 'sal', 'dev1', 'dev2', 'ing'] loop
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
    ('CHK-420', 'CAMION', 'Volvo', 'FH', 'CHK420_A', true),
    (null, 'FURGON', 'Hino', null, 'CHK420_CERRADO', true),
    (null, 'FURGON', 'Isuzu', 'NQR', 'CHK420_REABIERTO', true),
    ('BAJ-420', 'CAMION', 'Scania', null, 'CHK420_INACTIVA', false);
  -- La portería la registró en minúsculas y sin unidad en el padrón.
  insert into public.registro_vehiculos (placa, codigo_interno, unidad, empresa, motivo, ingreso_en, ingreso_por)
  values ('POR-420', 'chk420_porteria', 'Hino 500', 'Transportes de prueba 420', 'FABRICACION', now() - interval '2 days', v_req);
  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, cerrado_por)
  values ('CHK420_CERRADO', 1000, 1500, 500, 33.3, '{}'::jsonb, v_req);
  insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por, cerrado_en, reabierto_por, reabierto_en, motivo_reapertura)
  values ('CHK420_REABIERTO', 800, '{}'::jsonb, v_req, now() - interval '3 days', v_req, now() - interval '1 day',
          'Faltaba cargar una compra de prueba 420');

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK420-1', 'Aceite de prueba 420', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.m1', v_m::text, true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m, 20, 'INGRESO_GENERAL', 'Compra de prueba 420', current_setting('prueba.almacenero')::uuid,
          10, 'PEN', now() - interval '1 hour');
  -- El proveedor de la compra de la sección 3, como en el check 306.
  insert into public.proveedores (id, numero_documento, razon_social) values (gen_random_uuid(), '20100047218', 'PROVEEDOR DE PRUEBA')
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal') || '.jpg',
          current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
end $$;

-- Requerimientos registra dos RQ: uno con el código en minúsculas, y otro que anula.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'chk420_a', 'Aceite para la prueba 420', null, format('[{"material_id": "%s", "cantidad": 15}]', current_setting('prueba.m1'))::jsonb);
select public.emitir_requerimiento(current_setting('prueba.rq_anulado')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK420_ANULADO', 'Pedido equivocado de la prueba 420', null, format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.m1'))::jsonb);
select public.anular_requerimiento(current_setting('prueba.rq_anulado')::uuid, 'Se pidió con el código equivocado (prueba 420)');
-- Y otro con la O por el cero, como pasa al escribirlo de memoria: la variante que la lista avisa.
select public.emitir_requerimiento(current_setting('prueba.rq_gemelo')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'chk42o_a', 'Pedido con el código mal escrito (prueba 420)', null, format('[{"material_id": "%s", "cantidad": 1}]', current_setting('prueba.m1'))::jsonb);

-- ============================================ 1. La lista de códigos para elegir
create temp table _lista on commit drop as select * from public.codigos_internos_para_elegir();
reset role;
do $$
declare v_n int; v_unidad text; v_cerrado boolean;
begin
  select count(*) into v_n from _lista where codigo = 'CHK420_A';
  perform test.afirmar(v_n = 1, format('CHK420_A sale una vez, aunque lo nombren la unidad y el RQ escrito en minúsculas (%s)', v_n));
  select unidad, cerrado into v_unidad, v_cerrado from _lista where codigo = 'CHK420_A';
  perform test.afirmar(v_unidad = 'CHK-420 · Volvo FH' and not v_cerrado, format('CHK420_A con su placa y su marca: «%s»', v_unidad));
  perform test.afirmar((select registrada from _lista where codigo = 'CHK420_A'), 'CHK420_A es de una unidad del padrón');
  perform test.afirmar((select not registrada and unidad is null from _lista where codigo = 'CHK42O_A'),
    'la variante CHK42O_A que escribió un RQ sale, sin unidad y sin ser del padrón: la pantalla la avisa como casi igual');
  perform test.afirmar(not (select registrada from _lista where codigo = 'CHK420_PORTERIA'), 'el que solo anotó la portería no es del padrón');
  select unidad into v_unidad from _lista where codigo = 'CHK420_PORTERIA';
  perform test.afirmar(v_unidad = 'POR-420 · Hino 500', format('el código que solo anotó la portería, normalizado y con lo que ella anotó: «%s»', v_unidad));
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'chk420_porteria'), 'no sale también como lo escribió la portería');
  perform test.afirmar((select cerrado from _lista where codigo = 'CHK420_CERRADO'), 'el código con costeo cerrado viene marcado como cerrado');
  perform test.afirmar((select unidad from _lista where codigo = 'CHK420_CERRADO') = 'Hino', 'sin placa, la unidad dice solo la marca');
  perform test.afirmar(not (select cerrado from _lista where codigo = 'CHK420_REABIERTO'), 'el código reabierto vuelve a estar abierto');
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'CHK420_INACTIVA'), 'el de una unidad dada de baja no sale');
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'CHK420_ANULADO'), 'el código de un RQ anulado no sale');
  perform test.afirmar(not exists (select 1 from _lista where codigo = 'TODOS LOS ACTIVOS'), 'TODOS LOS ACTIVOS no es un código de la lista');
  perform test.afirmar((select count(*) from _lista) = (select count(distinct codigo) from _lista), 'cada código sale una sola vez');
  perform test.afirmar(not exists (select 1 from _lista where codigo <> public.normalizar_codigo_interno(codigo)),
    'todos escritos como los guarda el costeo');
end $$;

-- La lista no trae montos: solo el código, la unidad y si está cerrado.
select test.afirmar(pg_get_function_result('public.codigos_internos_para_elegir()'::regprocedure)
                    = 'TABLE(codigo text, unidad text, cerrado boolean, registrada boolean)',
  'la lista trae código, unidad, cerrado y si es del padrón, sin el costo ni el margen del cierre');

-- La misma lista en cada formulario que pide el código, con la cuenta de cada puesto.
create or replace function pg_temp.lee_la_lista(p_clave text, p_para text) returns void language plpgsql as $$
declare v int;
begin
  perform pg_temp.como(p_clave);
  set local role authenticated;
  select count(*) into v from public.codigos_internos_para_elegir() where codigo = 'CHK420_A';
  reset role;
  perform test.afirmar(v = 1, format('%s la lee, para %s', p_clave, p_para));
end $$;
select pg_temp.lee_la_lista('administracion', 'su RQA, la compra directa, el servicio y el subcontrato');
select pg_temp.lee_la_lista('tesoreria', 'la caja diaria');
select pg_temp.lee_la_lista('recursos_humanos', 'el costeo de horas y las observaciones');
select pg_temp.lee_la_lista('supervisor', 'el reporte diario');

-- Cada permiso de la puerta, solo, la abre: un rol de prueba por permiso, con
-- ese y ningún otro. Si la función dejara de aceptar uno, ese formulario se
-- quedaría sin lista sin que nada avise.
do $$
declare v_permiso text; v_rol uuid; v_usuario uuid; v int; i int := 0;
begin
  foreach v_permiso in array array['requerimientos.emitir', 'requerimientos.administracion', 'tesoreria.caja', 'rrhh.personal',
                                   'reporte_diario.registrar', 'compras.crear', 'subcontratos.gestionar'] loop
    i := i + 1;
    insert into public.roles (codigo, nombre) values ('CHK420_' || i, 'Prueba 420 · ' || v_permiso) returning id into v_rol;
    insert into public.roles_permisos (rol_id, permiso_codigo) values (v_rol, v_permiso);
    v_usuario := gen_random_uuid();
    insert into auth.users (id, email) values (v_usuario, 'permiso' || i || '.420@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
    values (v_usuario, 'Permiso ' || i, 'Check 420', 'permiso' || i || '.420@prueba.local', v_rol);
    perform set_config('prueba.permiso' || i, v_usuario::text, true);
    perform pg_temp.como('permiso' || i);
    set local role authenticated;
    select count(*) into v from public.codigos_internos_para_elegir() where codigo = 'CHK420_A';
    reset role;
    perform test.afirmar(v = 1, format('con solo %s se lee la lista', v_permiso));
  end loop;
end $$;

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar('select * from public.codigos_internos_para_elegir()',
  'Almacén no lee la lista: su salida sin RQ pide el código o la placa, y queda fuera de este cambio', 'No tienes permiso para ver la lista de códigos internos');
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
  null, null, 'RQ de la prueba 420', 'Supervisor de Maestranza',
  current_setting('prueba.almacenero') || '/' || current_setting('prueba.sal') || '.jpg',
  (select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1));
select public.registrar_ingreso_almacen(current_setting('prueba.dev1')::uuid, current_setting('prueba.m1')::uuid, 1,
  'DEVOLUCION', 'Devolución 1 de la prueba 420', null, 'PEN', current_setting('prueba.sal')::uuid);
select public.registrar_ingreso_almacen(current_setting('prueba.dev2')::uuid, current_setting('prueba.m1')::uuid, 1,
  'DEVOLUCION', 'Devolución 2 de la prueba 420', null, 'PEN', current_setting('prueba.sal')::uuid);
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

-- ============================================ 3. Lo que llegó de la compra
-- Cada paso con la cuenta de su puesto. Otro RQ de Maestranza pide 4 del mismo
-- material, y Almacén no tiene para él.
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq2')::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
  'CHK420_A', 'Segundo pedido de la prueba 420', null, format('[{"material_id": "%s", "cantidad": 4}]', current_setting('prueba.m1'))::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq2')::uuid, '[{"item": 1, "en_stock": 0}]'::jsonb, null);
reset role;
-- Logística compra lo que falta de los dos, 5 + 4, en una sola línea de OC.
select set_config('prueba.insumos',
  (select jsonb_agg(l.id order by r.numero) from public.requerimiento_lineas l join public.requerimientos r on r.id = l.requerimiento_id
    where r.id in (current_setting('prueba.rq')::uuid, current_setting('prueba.rq2')::uuid))::text, true);
select set_config('prueba.proveedor',
  (select id::text from public.proveedores where tipo_documento = 'RUC' and numero_documento = '20100047218'), true);
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc')::uuid,
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 9, 'precio', 12,
                                       'insumos', current_setting('prueba.insumos')::jsonb)),
  current_setting('prueba.proveedor')::uuid, 'COT-420', null, 'CONTADO', 0, 'PEN', true);
reset role;
-- Gerencia la aprueba, si el monto lo pide (una compra chica entra aprobada).
select set_config('prueba.por_aprobar',
  (select (aprobacion = 'POR_APROBAR')::text from public.ordenes_compra_materiales where id = current_setting('prueba.oc')::uuid), true);
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc')::uuid) where current_setting('prueba.por_aprobar')::boolean;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select public.mandar_compra_a_recojo(current_setting('prueba.oc')::uuid);
select public.programar_recojo(current_setting('prueba.oc')::uuid, 25, null);
reset role;
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(current_setting('prueba.oc')::uuid);
select public.marcar_compra_recogida(current_setting('prueba.oc')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc')::uuid);
reset role;
-- Dejada en almacén y sin validar: todavía no llegó nada.
select pg_temp.como('supervisor');
set local role authenticated;
create temp table _antes on commit drop as
  select * from public.entregado_de_requerimientos(array[current_setting('prueba.rq')::uuid, current_setting('prueba.rq2')::uuid]);
reset role;
-- El proveedor trajo 6 de los 9: Almacén valida esos 6 con observación.
select set_config('prueba.ingresos',
  (select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', current_setting('prueba.ing'), 'cantidad', 6,
                                       'observacion', 'Llegaron 6 de 9: el proveedor no tenía más (prueba 420)'))
     from public.ingresos_pendientes_almacen i where i.orden_compra_id = current_setting('prueba.oc')::uuid)::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(current_setting('prueba.oc')::uuid, current_setting('prueba.ingresos')::jsonb, null);
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
create temp table _llegado on commit drop as
  select * from public.entregado_de_requerimientos(array[current_setting('prueba.rq')::uuid, current_setting('prueba.rq2')::uuid]);
create temp table _avance2 on commit drop as
  select * from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]);
reset role;
do $$
declare
  v_rq uuid := current_setting('prueba.rq')::uuid;
  v_rq2 uuid := current_setting('prueba.rq2')::uuid;
  v_detalles integer;
begin
  select count(distinct orden_compra_detalle_id) into v_detalles from public.requerimiento_lineas where requerimiento_id in (v_rq, v_rq2);
  perform test.afirmar(v_detalles = 1 and not exists (select 1 from public.requerimiento_lineas where requerimiento_id in (v_rq, v_rq2) and orden_compra_detalle_id is null),
    format('los dos insumos van en la misma línea de la OC (%s distinta)', v_detalles));
  perform test.afirmar((select estado from public.ingresos_pendientes_almacen where orden_compra_id = current_setting('prueba.oc')::uuid) = 'OBSERVADO',
    'el ingreso queda observado: llegaron 6 de 9');
  perform test.afirmar((select coalesce(sum(llegado), -1) from _antes) = 0,
    format('dejada en almacén y sin validar, no llegó nada (%s)', (select string_agg(coalesce(llegado::text, 'null'), ', ') from _antes)));
  perform test.afirmar((select llegado from _llegado where requerimiento_id = v_rq and item = 1) = 5,
    format('al primer RQ le llegaron sus 5, aunque la etapa diga observado (%s)', (select llegado from _llegado where requerimiento_id = v_rq and item = 1)));
  perform test.afirmar((select llegado from _llegado where requerimiento_id = v_rq2 and item = 1) = 1,
    format('al segundo, el que sobra de los 6: 1 (%s)', (select llegado from _llegado where requerimiento_id = v_rq2 and item = 1)));
  perform test.afirmar((select entregado from _llegado where requerimiento_id = v_rq and item = 1) = 2,
    'lo entregado no cambia con la compra: siguen 2');
  -- Con esto la pantalla parte el insumo del primer RQ: 2 entregados, 10 + 5 − 2 = 13 para recoger y nada por llegar.
  perform test.afirmar((select a.lineas -> 0 ->> 'etapa' from _avance2 a) = 'OBSERVADO',
    format('la etapa sola diría que no llegó: %s', (select a.lineas -> 0 ->> 'etapa' from _avance2 a)));
  perform test.afirmar(not exists (select 1 from _entregado where llegado is not null),
    'sin línea de OC, lo llegado viene vacío y la pantalla sigue con la etapa');
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
