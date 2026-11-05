-- El circuito del RQ sin cabos sueltos (migración 20261020196000). Lo que los
-- auditores de «Stock en almacén» encontraron en el circuito del requerimiento:
-- corregir un RQ listo subiendo la cantidad, «Entregado» sin la salida del
-- kardex, el RQ anulado que respondía «ya pasó la revisión», el material que
-- llegó de la compra, el código con dos espacios y el accesorio devuelto que
-- quedaba libre para cualquier unidad. Y lo que encontró la segunda vuelta: el
-- motivo en blanco, cómo se entregó reescrito después, el reintento de una
-- salida tras la entrega y el RQ anulado con salidas. Y la tercera: el código
-- interno corregido después de una salida, el reintento hacia otra unidad, lo
-- que no salió puesto fuera de la entrega, el aviso con nota y motivo largos y
-- el RQ entregado con faltante donde Gerencia mira el código interno. Y la de
-- la salida con la lista de códigos: el accesorio que salía a PLANTA, OFICINA o
-- todos los activos (sale solo si su RQ lo pide así), también con un blanco
-- pegado, y la unidad del padrón con dos espacios. Y la de lo libre en la
-- salida: lo que sale con un RQ de PLANTA hacia una unidad se le descontaba
-- también a la unidad, y lo libre subía. Y la cuarta: lo que pasaba de lo
-- separado por ese RQ no se le descontaba a nadie. Y la quinta: la salida de
-- antes de la columna de_la_unidad se contaba dos veces, y el vehículo sin
-- código interno se rechazaba pidiendo elegir la unidad. Y la sexta: esa
-- salida de antes, hacia una unidad que no tenía nada propio (lo normal en
-- producción), dejaba al RQ con lo separado que ya había salido. Y la
-- séptima: contada al leerla, la salida de antes daba otra cifra en cada
-- función, cambiaba con lo que entraba después o al corregir el código del RQ
-- y lo libre podía subir; ahora la migración la anota una vez. Y la placa sin
-- guion de un vehículo sin código interno se tomaba por un código nuevo. Y la
-- octava: el RQ de PLANTA corregido al código de la unidad antes de la
-- migración dejaba su salida sin anotar, un código de la lista escrito como
-- la placa de un vehículo se vinculaba al vehículo, y con dos vehículos de la
-- misma placa el accesorio salía hacia un código de nadie. Y la novena: la
-- salida de un RQ corregido después a otro código se anotaba aunque al salir
-- fuera del mismo, y la placa de un vehículo con código iba al código de cuando
-- no lo tenía. Y la décima: con el código del RQ o el de la lista escrito como
-- una placa, la salida ya no quedaba en el vehículo y salía del costeo de su
-- OT, y volver a aplicar la migración no soltaba lo que una versión anterior
-- había anotado con la regla vieja.
-- Cada paso con el rol que lo hace —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS RQ S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'GERENTE:GER'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.416@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 416', lower(replace(v, ':', '.')) || '.416@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rq1', 'rq2', 'rq3', 'rq4', 'rq5', 'rq6', 'rq7', 'rq8', 'rq9', 'rq10', 'rq11', 'rq12', 'rq13', 'rq14', 'rq15',
                           'rq16', 'rq17', 'rq18', 'rq19', 'rq20', 'rq21', 'rq22', 'rq23', 'rq24', 'rq25', 'rq26', 'rq27', 'rq28',
                           'rq29', 'rq30', 'rq31', 'rq32', 'oc', 'oc2', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11',
                           's12', 's13', 's14', 's15', 's16', 's17', 's18', 's19', 's20', 's21', 's22', 's23', 's24', 's25', 's26', 's27',
                           's28', 's29', 's30', 's31', 's32', 's33', 's34', 's35', 's36', 's37', 's38', 's39', 's40', 's41', 's42',
                           's43', 's44', 's45', 's46', 's47', 's48', 's49', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  -- La foto de cada salida, que la salida exige.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.' || s) || '.jpg',
         current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb
    from unnest(array['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13', 's14', 's15', 's16', 's17',
                      's18', 's19', 's20', 's21', 's22', 's23', 's24', 's25', 's26', 's27', 's28', 's29', 's30', 's31', 's32', 's33',
                      's34', 's35', 's36', 's37', 's38', 's39', 's40', 's41', 's42', 's43', 's44', 's45', 's46', 's47', 's48', 's49']) s;

  -- El catálogo y el kardex, como dueño de las tablas.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK416-DIS', 'Disco de corte (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK416-DS2', 'Disco de corte de otra marca (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK416-FAR', 'Faro LED (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK416-EPP', 'Disco de corte con guarda, de EPP (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'EPP' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK416-FA2', 'Faro de neblina (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  foreach v in array array['DIS', 'DS2', 'FAR', 'EPP', 'FA2'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.materiales where codigo = 'CHK416-' || v), true);
  end loop;
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20999416005', 'Proveedor de prueba 416', 'Av. Argentina 457, Lima', '999 416 416');
  perform set_config('prueba.prov', (select id::text from public.proveedores where numero_documento = '20999416005'), true);

  -- 20 discos; 2 faros libres y 3 que entraron para la unidad CHK416-X.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  values
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.dis')::uuid, 20, 'INGRESO_GENERAL', 'GR 416-1', current_setting('prueba.almacenero')::uuid, null),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.far')::uuid, 2, 'INGRESO_GENERAL', 'GR 416-2', current_setting('prueba.almacenero')::uuid, null),
    (gen_random_uuid(), 'INGRESO', current_setting('prueba.far')::uuid, 3, 'INGRESO_GENERAL', 'GR 416-3', current_setting('prueba.almacenero')::uuid, 'CHK416-X');
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.emitir(p_rq text, p_codigo text, p_material text, p_cantidad numeric) returns uuid language sql as $$
  select public.emitir_requerimiento(current_setting('prueba.' || p_rq)::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
    p_codigo, 'Material de la prueba 416', null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.' || p_material), 'cantidad', p_cantidad)));
$$;

create or replace function pg_temp.insumo(p_rq text) returns uuid language sql as $$
  select id from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p_rq)::uuid and item = 1;
$$;

create or replace function pg_temp.estado(p_rq text) returns text language sql as $$
  select estado from public.requerimientos where id = current_setting('prueba.' || p_rq)::uuid;
$$;

-- Una salida con la foto subida: con RQ, a su unidad; sin RQ, al código que se escribe.
create or replace function pg_temp.salida(p_id text, p_material text, p_cantidad numeric, p_rq text, p_codigo text default null)
returns uuid language sql as $$
  select public.registrar_salida_material(current_setting('prueba.' || p_id)::uuid, current_setting('prueba.' || p_material)::uuid,
    p_cantidad, null, p_codigo, 'Salida de la prueba 416', 'Soldador MTZ',
    auth.uid()::text || '/' || current_setting('prueba.' || p_id) || '.jpg', case when p_rq is not null then pg_temp.insumo(p_rq) end);
$$;

create or replace function pg_temp.justificante(p_documento text, p_correccion text) returns text language plpgsql as $$
declare v_ruta text := current_setting('prueba.' || p_documento) || '/' || current_setting('prueba.' || p_correccion) || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('justificantes-correccion', v_ruta, public.usuario_actual()::text, '{"mimetype": "application/pdf", "size": 3072}');
  return v_ruta;
end $$;

create or replace function pg_temp.separado(p_material text, p_codigo text) returns numeric language sql as $$
  select coalesce((select (c->>'cantidad')::numeric
                     from public.stock_libre_en_almacen(array[current_setting('prueba.' || p_material)::uuid]) s,
                          jsonb_array_elements(s.por_codigo) c
                    where c->>'codigo' = p_codigo), 0);
$$;

-- ============================================ 1. Los requerimientos
select pg_temp.como('requerimientos');
set local role authenticated;
-- RQ1: 4 discos para CHK416-A. RQ2: 2 discos para CHK416-B. RQ3 y RQ4 se anulan.
select pg_temp.emitir('rq1', 'CHK416-A', 'dis', 4);
select pg_temp.emitir('rq2', 'CHK416-B', 'dis', 2);
select pg_temp.emitir('rq3', 'CHK416-C', 'dis', 1);
select pg_temp.emitir('rq4', 'CHK416-C', 'dis', 2);
-- RQ5: 2 discos para CHK416-D, que se compran de otra marca. RQ6: 1 disco para CHK416-E.
select pg_temp.emitir('rq5', 'CHK416-D', 'dis', 2);
select pg_temp.emitir('rq6', 'CHK416-E', 'dis', 1);
-- RQ7: 1 disco para CHK416-F, que Logística compra de la categoría de EPP. RQ8: 1 disco para «T1».
select pg_temp.emitir('rq7', 'CHK416-F', 'dis', 1);
select pg_temp.emitir('rq8', 'T1', 'dis', 1);
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq1')::uuid, '[{"item": 1, "en_stock": 4}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq2')::uuid, '[{"item": 1, "en_stock": 2}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq4')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq5')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq7')::uuid, '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq8')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select test.afirmar(pg_temp.estado('rq1') = 'LISTO_EN_ALMACEN' and pg_temp.separado('dis', 'CHK416-A') = 4,
  'RQ1 queda listo en almacén con sus 4 discos separados');
reset role;

-- ============================================ 2. Corregir un RQ listo: la cantidad solo baja
-- El justificante subido, como dueño de las tablas: la subida tiene su check (382).
select pg_temp.como('requerimientos');
select pg_temp.justificante('rq1', 'c1');
select pg_temp.justificante('rq1', 'c2');
set local role authenticated;
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Maestranza necesita dos discos más', '%s/%s.pdf', 'correo.pdf',
  '{"lineas": [{"item": 1, "cantidad": 6}]}'::jsonb)$q$, current_setting('prueba.c1'), current_setting('prueba.rq1'),
  current_setting('prueba.rq1'), current_setting('prueba.c1')),
  'en un RQ listo no se sube la cantidad: lo de más no lo separó nadie', 'solo puede bajar');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.separado('dis', 'CHK416-A') = 4, 'lo separado para CHK416-A sigue en 4, no en 6');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select public.corregir_requerimiento(current_setting('prueba.c2')::uuid, current_setting('prueba.rq1')::uuid,
  'Maestranza solo necesita tres discos', current_setting('prueba.rq1') || '/' || current_setting('prueba.c2') || '.pdf', 'correo.pdf',
  '{"lineas": [{"item": 1, "cantidad": 3}]}'::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.separado('dis', 'CHK416-A') = 3 and pg_temp.estado('rq1') = 'LISTO_EN_ALMACEN',
  'bajar la cantidad sí se puede: quedan 3 separados y el RQ sigue listo');
reset role;

-- ============================================ 3. «Entregado» pide la salida del kardex
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Supervisor de Maestranza')$q$, current_setting('prueba.rq1')),
  'sin la salida del kardex no se entrega', 'la salida de 3 UND de «Disco de corte (prueba 416)»');
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Supervisor de Maestranza')$q$, current_setting('prueba.rq1')),
  'y dice que lo comprado que no está en el kardex se ingresa antes', 'registra antes su ingreso');
-- Un ítem de RQ que no existe no se confunde con uno entregado o anulado.
select test.debe_fallar(format($q$select public.registrar_salida_material('%1$s', '%2$s', 1, null, null, 'Salida de la prueba 416', 'Soldador MTZ',
                                   auth.uid()::text || '/%1$s.jpg', gen_random_uuid())$q$, gen_random_uuid(), current_setting('prueba.dis')),
  'la salida para un ítem que no existe lo dice', 'Ese ítem de requerimiento no existe');
select pg_temp.salida('s1', 'dis', 2, 'rq1');
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Supervisor de Maestranza')$q$, current_setting('prueba.rq1')),
  'con una salida parcial dice lo que falta', 'la salida de 1 UND');
select pg_temp.salida('s2', 'dis', 1, 'rq1');
select public.rq_marcar_entregado(current_setting('prueba.rq1')::uuid, 'Supervisor de Maestranza');
select test.afirmar(pg_temp.estado('rq1') = 'ENTREGADO', 'con todo fuera del kardex, RQ1 se entrega');
-- Lo devuelto vuelve a faltar: RQ2 sacó 2 y le devolvieron 1.
select pg_temp.salida('s3', 'dis', 2, 'rq2');
select public.registrar_ingreso_almacen(current_setting('prueba.d1')::uuid, current_setting('prueba.dis')::uuid, 1,
  'DEVOLUCION', 'Devolución de la prueba 416', null, 'PEN', current_setting('prueba.s3')::uuid);
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Supervisor de Maestranza')$q$, current_setting('prueba.rq2')),
  'lo devuelto vuelve a faltar para entregar', 'la salida de 1 UND');
select test.afirmar(pg_temp.estado('rq2') = 'LISTO_EN_ALMACEN', 'RQ2 sigue listo en almacén');
reset role;

-- ============================================ 3b. Lo que ya no va a salir se entrega con faltante
-- El disco devuelto sobró: el área ya no lo necesita. Sin esto, RQ2 quedaba
-- listo para siempre (ya no se anula, y lo que salió no se corrige).
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Supervisor de Maestranza')$q$, current_setting('prueba.rq2')),
  '«Entregado» dice que lo que ya no va a salir se entrega con faltante', 'entrégalo con faltante');
select test.debe_fallar(format($q$select public.rq_entregar_con_faltante('%s', 'Supervisor de Maestranza', 'corto')$q$, current_setting('prueba.rq2')),
  'el faltante pide su motivo', 'de 10 a 500 caracteres');
select test.debe_fallar(format($q$select public.rq_entregar_con_faltante('%s', 'Supervisor de Maestranza', '            ')$q$, current_setting('prueba.rq2')),
  'un motivo en blanco pide el motivo, no la salida del kardex', 'de 10 a 500 caracteres');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_entregar_con_faltante('%s', 'Supervisor de Maestranza', 'El área ya no necesita el resto')$q$,
                               current_setting('prueba.rq2')),
  'Requerimientos no entrega con faltante: la entrega es de Almacén');
reset role;
select test.afirmar(pg_temp.separado('dis', 'CHK416-B') = 1, 'antes, RQ2 tiene 1 disco separado para CHK416-B');
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_entregar_con_faltante(current_setting('prueba.rq2')::uuid, 'Supervisor de Maestranza',
  'Devolvieron el disco que sobró: el área ya no lo necesita');
select test.afirmar(pg_temp.estado('rq2') = 'ENTREGADO' and pg_temp.separado('dis', 'CHK416-B') = 0,
  'RQ2 se entrega con faltante y ya no deja nada separado en el stock');
reset role;
select test.afirmar((select faltante_al_entregar = '1 UND de «Disco de corte (prueba 416)»'
                        and motivo_del_faltante = 'Devolvieron el disco que sobró: el área ya no lo necesita'
                       from public.requerimientos where id = current_setting('prueba.rq2')::uuid),
  'queda escrito en el RQ qué no salió y por qué');
select test.afirmar(exists (select 1 from public.notificaciones
                             where origen_id = current_setting('prueba.rq2')::uuid
                               and usuario_id = current_setting('prueba.requerimientos')::uuid
                               and titulo like 'Entregado con faltante:%' and cuerpo like '%Motivo: Devolvieron el disco%No salió: 1 UND%'),
  'a quien lo pidió le llega qué no salió y el motivo');
select test.afirmar((select sin_salida_al_entregar = 1 from public.requerimiento_lineas where id = pg_temp.insumo('rq2')),
  'y en el insumo queda cuánto no salió del kardex');
-- Cómo se entregó queda como evidencia: ni el dueño de las tablas lo reescribe.
select test.debe_fallar(format($q$update public.requerimientos set motivo_del_faltante = 'Otro motivo escrito después' where id = '%s'$q$,
                               current_setting('prueba.rq2')),
  'el motivo del faltante no se reescribe', 'queda como evidencia');
select test.debe_fallar(format($q$update public.requerimientos set nota_entrega = 'Otra persona' where id = '%s'$q$, current_setting('prueba.rq2')),
  'quién lo recogió no se reescribe', 'queda como evidencia');
select test.debe_fallar(format($q$update public.requerimiento_lineas set sin_salida_al_entregar = 2 where id = '%s'$q$, pg_temp.insumo('rq2')),
  'lo que no salió de un insumo no se reescribe', 'queda como evidencia');
-- Ni se pone después: RQ1 se entregó con todo fuera del kardex.
select test.debe_fallar(format($q$update public.requerimiento_lineas set sin_salida_al_entregar = 3 where id = '%s'$q$, pg_temp.insumo('rq1')),
  'a un insumo entregado completo no se le pone después que algo no salió', 'lo anota Almacén al entregar');
select test.afirmar(not exists (select 1 from pg_constraint where conrelid = 'public.requerimientos'::regclass
                                   and pg_get_constraintdef(oid) like '%faltante_al_entregar%'),
  'el detalle de lo que no salió no tiene tope: cortado dejaba fuera los últimos insumos');

-- ============================================ 4. El RQ anulado dice que se anuló
select pg_temp.como('requerimientos');
set local role authenticated;
select public.anular_requerimiento(current_setting('prueba.rq3')::uuid, 'Ya no hace falta (prueba 416)');
select public.anular_requerimiento(current_setting('prueba.rq4')::uuid, 'Ya no hace falta (prueba 416)');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 1}]', null)$q$, current_setting('prueba.rq3')),
  'revisar el stock de un RQ anulado dice que se anuló, no que ya pasó la revisión', 'se anuló');
select test.debe_fallar(format($q$select public.rq_marcar_entregado('%s', 'Supervisor de Maestranza')$q$, current_setting('prueba.rq4')),
  'entregar un RQ anulado dice que se anuló', 'se anuló');
reset role;

-- ============================================ 5. «Registrar salida» sabe qué material llegó de la compra
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc')::uuid,
  format('[{"material_id": "%s", "cantidad": 2, "precio": 9, "insumos": ["%s"]}]', current_setting('prueba.ds2'), pg_temp.insumo('rq5'))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 416', null, 'CONTADO', 0, 'PEN', true);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select material_comprado is null from public.v_rq_lineas_para_salida where linea_id = pg_temp.insumo('rq5')),
  'antes de que llegue la compra, no hay material comprado que proponer');
reset role;
-- Llegan los 2 de otra marca. El armazón, como dueño: la recepción tiene sus propios checks.
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc')::uuid;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
select gen_random_uuid(), 'INGRESO', current_setting('prueba.ds2')::uuid, 2, 'COMPRA', 'GR 416-4', current_setting('prueba.almacenero')::uuid,
       orden_compra_detalle_id
  from public.requerimiento_lineas where id = pg_temp.insumo('rq5');
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar((select material_comprado = current_setting('prueba.ds2')::uuid and material_id = current_setting('prueba.dis')::uuid
                       from public.v_rq_lineas_para_salida where linea_id = pg_temp.insumo('rq5')),
  'Almacén ve en la línea por entregar el disco de otra marca que llegó de su compra, y el pedido aparte');
reset role;

-- ============================================ 6. La salida: el código con sus espacios juntados
-- Un RQ de antes, con el código escrito con dos espacios y en minúsculas.
set local session_replication_role = replica;
update public.requerimientos set codigo_interno = 'chk416   e' where id = current_setting('prueba.rq6')::uuid;
set local session_replication_role = origin;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq6')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select pg_temp.salida('s4', 'dis', 1, 'rq6');
reset role;
select test.afirmar((select codigo_interno = 'CHK416 E' from public.movimientos_materiales where id = current_setting('prueba.s4')::uuid),
  'la salida guarda el código del RQ con los espacios juntados, como el costeo y el stock');
-- Si ya salió todo, «Entregar con faltante» entrega sin faltante: el motivo sobra.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_entregar_con_faltante(current_setting('prueba.rq6')::uuid, 'Supervisor de Maestranza', 'Pensé que faltaba algo, pero no');
reset role;
select test.afirmar((select estado = 'ENTREGADO' and faltante_al_entregar is null and motivo_del_faltante is null
                       from public.requerimientos where id = current_setting('prueba.rq6')::uuid),
  'con todo fuera del kardex, entregar con faltante no anota faltante');
-- Un RQ con código de dos letras, que el RQ acepta, deja registrar su salida.
select pg_temp.como('almacenero');
set local role authenticated;
select pg_temp.salida('s9', 'dis', 1, 'rq8');
reset role;
select test.afirmar((select codigo_interno = 'T1' from public.movimientos_materiales where id = current_setting('prueba.s9')::uuid),
  'la salida de un RQ con código «T1» entra con su código');
-- Con todo fuera del kardex, el motivo no se mira: «corto» no detiene la entrega.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_entregar_con_faltante(current_setting('prueba.rq8')::uuid, 'Supervisor de Maestranza', 'corto');
select test.afirmar(pg_temp.estado('rq8') = 'ENTREGADO', 'si ya salió todo, el motivo sobra y no detiene la entrega');
-- El reintento de la salida (la respuesta no llegó) la devuelve aunque el RQ ya se entregó.
select test.afirmar(pg_temp.salida('s9', 'dis', 1, 'rq8') = current_setting('prueba.s9')::uuid,
  'el reintento de una salida que ya entró la devuelve, aunque su RQ ya se entregó');
reset role;

-- ============================================ 7. El accesorio devuelto vuelve a ser de su unidad
select pg_temp.como('almacenero');
set local role authenticated;
-- Salen 2 de los 3 faros de CHK416-X y los devuelven: vuelven a ser de CHK416-X.
select pg_temp.salida('s5', 'far', 2, null, 'CHK416-X');
select public.registrar_ingreso_almacen(current_setting('prueba.d2')::uuid, current_setting('prueba.far')::uuid, 2,
  'DEVOLUCION', 'Devolución de faros de la prueba 416', null, 'PEN', current_setting('prueba.s5')::uuid);
select test.afirmar(pg_temp.separado('far', 'CHK416-X') = 3, '«Stock en almacén» da los 3 faros a CHK416-X');
-- El mismo envío hacia otra unidad no es un reintento; con el mismo código escrito distinto, sí.
select test.debe_fallar($q$select pg_temp.salida('s5', 'far', 2, null, 'CHK416-Y')$q$,
  'el mismo envío hacia otra unidad no se toma por reintento: la primera salida ya quedó (20261023200000)',
  'Esta salida ya quedó registrada la primera vez que la enviaste');
select test.afirmar(pg_temp.salida('s5', 'far', 2, null, ' chk416-x ') = current_setting('prueba.s5')::uuid,
  'con el mismo código, aunque escrito con espacios y en minúsculas, es el reintento');
-- Para otra unidad hay solo los 2 libres, no los devueltos de CHK416-X.
select test.debe_fallar($q$select pg_temp.salida('s6', 'far', 3, null, 'CHK416-Y')$q$,
  'el faro devuelto de CHK416-X no sale para otra unidad', 'hay 2 libre para la unidad CHK416-Y');
select pg_temp.salida('s7', 'far', 2, null, 'chk416-y');
select test.afirmar((select libre = 0 from public.stock_libre_en_almacen(array[current_setting('prueba.far')::uuid]))
                    and pg_temp.separado('far', 'CHK416-X') = 3,
  'salen los 2 libres para CHK416-Y; los 3 de CHK416-X siguen siendo suyos y no queda nada libre');
reset role;

-- ============================================ 7b. Un accesorio sale solo para una unidad
-- PLANTA, OFICINA y TODOS LOS ACTIVOS son códigos que la lista de la salida
-- ofrece, pero no son una unidad: un accesorio no sale con ellos por decisión
-- de Almacén, tampoco con un blanco pegado desde Excel. Un disco, sí.
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, 'PLANTA')$q$,
  'un accesorio no sale a PLANTA', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, 'oficina')$q$,
  'ni a OFICINA', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, 'Todos  los activos')$q$,
  'ni a todos los activos, escrito como sea', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, E'Oficina\t')$q$,
  'ni a OFICINA con un tabulador al final', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, U&'TODOS\00A0LOS ACTIVOS')$q$,
  'ni a todos los activos con un espacio duro', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, U&'\200BPLANTA')$q$,
  'ni a PLANTA con un espacio de ancho cero delante', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, U&'OFICINA\202F')$q$,
  'ni a OFICINA con un espacio angosto al final', 'Un accesorio sale solo para una unidad');
select test.debe_fallar($q$select pg_temp.salida('s13', 'far', 1, null, U&'PLAN\200CTA')$q$,
  'ni a PLANTA con un carácter invisible en medio', 'Un accesorio sale solo para una unidad');
select test.afirmar(pg_temp.salida('s13', 'dis', 1, null, 'PLANTA') = current_setting('prueba.s13')::uuid,
  'un disco sí sale a PLANTA');
reset role;

-- Si el RQ lo pide así, el accesorio sale a ese código: lo pidió alguien, y lo
-- de la planta o la oficina no se queda sin poder salir. Un RQ de OFICINA (como
-- un RQA) y uno de PLANTA; desde el de PLANTA, Almacén no lo manda a OFICINA.
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.far')::uuid, 3, 'INGRESO_GENERAL', 'GR 416-4', current_setting('prueba.almacenero')::uuid, null);
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq12', 'Oficina', 'far', 1);
select pg_temp.emitir('rq13', 'PLANTA', 'far', 2);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.salida('s15', 'far', 1, 'rq12') = current_setting('prueba.s15')::uuid,
  'el faro que pide un RQ de OFICINA sale para él');
select test.debe_fallar($q$select pg_temp.salida('s16', 'far', 1, 'rq13', 'OFICINA')$q$,
  'el faro de un RQ de PLANTA no sale a OFICINA', 'Un accesorio sale solo para una unidad');
select test.afirmar(pg_temp.salida('s16', 'far', 1, 'rq13', 'planta') = current_setting('prueba.s16')::uuid,
  'el faro que pide un RQ de PLANTA sale a PLANTA');
reset role;
select test.afirmar((select string_agg(codigo_interno, ',' order by codigo_interno) from public.movimientos_materiales
                      where id in (current_setting('prueba.s15')::uuid, current_setting('prueba.s16')::uuid)) = 'OFICINA,PLANTA',
  'las dos salidas quedan con el código de su RQ: OFICINA y PLANTA');

-- ============================================ 7c. El código de una unidad con dos espacios la encuentra
-- La lista muestra «CHK416 UNI» (los espacios juntados) y la salida lo manda
-- así: se vincula a la unidad aunque el padrón la tenga con dos espacios. Y la
-- que en el padrón lleva un espacio duro, elegida como la da la lista, también.
insert into public.unidades (codigo_interno, placa) values ('chk416  uni', null), (U&'chk416\00A0nb', null);
select pg_temp.como('almacenero');
set local role authenticated;
select pg_temp.salida('s14', 'dis', 1, null, 'CHK416 UNI');
select pg_temp.salida('s17', 'dis', 1, null,
  (select codigo from public.codigos_internos_para_elegir() where codigo like 'CHK416%NB'));
reset role;
select test.afirmar((select u.codigo_interno = 'chk416  uni'
                       from public.movimientos_materiales m join public.unidades u on u.id = m.unidad_id
                      where m.id = current_setting('prueba.s14')::uuid),
  'la salida al código de la lista queda vinculada a su unidad del padrón, aunque esta tenga dos espacios');
select test.afirmar((select u.codigo_interno = U&'chk416\00A0nb'
                       from public.movimientos_materiales m join public.unidades u on u.id = m.unidad_id
                      where m.id = current_setting('prueba.s17')::uuid),
  'y la que tiene un espacio duro, elegida como la da la lista');

-- ============================================ 8. Lo comprado de otra categoría sale para su insumo
-- Logística compra para el disco de RQ7 uno de la categoría de EPP.
select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_de_requerimientos(current_setting('prueba.oc2')::uuid,
  format('[{"material_id": "%s", "cantidad": 1, "precio": 15, "insumos": ["%s"]}]', current_setting('prueba.epp'), pg_temp.insumo('rq7'))::jsonb,
  current_setting('prueba.prov')::uuid, 'Cotización 416-2', null, 'CONTADO', 0, 'PEN', true);
reset role;
update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = current_setting('prueba.oc2')::uuid;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
select gen_random_uuid(), 'INGRESO', current_setting('prueba.epp')::uuid, 1, 'COMPRA', 'GR 416-5', current_setting('prueba.almacenero')::uuid,
       orden_compra_detalle_id
  from public.requerimiento_lineas where id = pg_temp.insumo('rq7');
select pg_temp.como('almacenero');
set local role authenticated;
select pg_temp.salida('s8', 'epp', 1, 'rq7');
reset role;
select test.afirmar((select material_id = current_setting('prueba.epp')::uuid and requerimiento_linea_id = pg_temp.insumo('rq7')
                       from public.movimientos_materiales where id = current_setting('prueba.s8')::uuid),
  'lo que llegó de la compra del insumo sale para él aunque sea de otra categoría de almacén');

-- ============================================ 9. Un RQ del que ya salió algo no se anula
-- RQ9: 2 discos para CHK416-G; Almacén tiene 1 y sale. RQ10: 2 discos para
-- CHK416-H; sale 1 antes de que Almacén revise el stock.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq9', 'CHK416-G', 'dis', 2);
select pg_temp.emitir('rq10', 'CHK416-H', 'dis', 2);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq9')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select test.afirmar(pg_temp.estado('rq9') = 'SIN_STOCK', 'RQ9 queda sin stock: falta 1 disco');
select pg_temp.salida('s10', 'dis', 1, 'rq9');
select pg_temp.salida('s11', 'dis', 1, 'rq10');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya no hace falta (prueba 416)')$q$, current_setting('prueba.rq9')),
  'un RQ sin stock del que ya salió un disco no se anula', 'ya salió material del kardex');
select test.debe_fallar(format($q$select public.anular_requerimiento('%s', 'Ya no hace falta (prueba 416)')$q$, current_setting('prueba.rq10')),
  'ni uno por atender', 'ya salió material del kardex');
-- Lo que salió se cargó a CHK416-G: el código ya no cambia; escribirlo distinto, sí.
select pg_temp.justificante('rq9', 'c3');
select pg_temp.justificante('rq9', 'c4');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Era para otra unidad', '%s/%s.pdf', 'correo.pdf',
  '{"codigo_interno": "CHK416-G2"}'::jsonb)$q$, current_setting('prueba.c3'), current_setting('prueba.rq9'),
  current_setting('prueba.rq9'), current_setting('prueba.c3')),
  'con una salida, el código interno del RQ ya no cambia', 'el código interno ya no cambia');
select public.corregir_requerimiento(current_setting('prueba.c4')::uuid, current_setting('prueba.rq9')::uuid,
  'El código iba con espacios de más', current_setting('prueba.rq9') || '/' || current_setting('prueba.c4') || '.pdf', 'correo.pdf',
  '{"codigo_interno": "chk416-g "}'::jsonb);
reset role;
select test.afirmar((select public.normalizar_codigo_interno(codigo_interno) = 'CHK416-G' from public.requerimientos where id = current_setting('prueba.rq9')::uuid),
  'escribir el mismo código distinto sí se corrige');
-- Si el disco vuelve entero, ya no salió nada: RQ9 se anula.
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_ingreso_almacen(current_setting('prueba.d3')::uuid, current_setting('prueba.dis')::uuid, 1,
  'DEVOLUCION', 'Devolución de la prueba 416', null, 'PEN', current_setting('prueba.s10')::uuid);
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
-- Lo que volvió entero ya no está cargado a nadie: como al anular, el código sí cambia.
select pg_temp.justificante('rq9', 'c5');
select public.corregir_requerimiento(current_setting('prueba.c5')::uuid, current_setting('prueba.rq9')::uuid,
  'Era para otra unidad', current_setting('prueba.rq9') || '/' || current_setting('prueba.c5') || '.pdf', 'correo.pdf',
  '{"codigo_interno": "CHK416-G2"}'::jsonb);
select test.afirmar((select codigo_interno = 'CHK416-G2' from public.requerimientos where id = current_setting('prueba.rq9')::uuid),
  'con el disco de vuelta entero, el código interno de RQ9 sí cambia');
select public.anular_requerimiento(current_setting('prueba.rq9')::uuid, 'Ya no hace falta (prueba 416)');
select test.afirmar(pg_temp.estado('rq9') = 'ANULADO', 'con lo que salió de vuelta en el kardex, RQ9 se anula');
reset role;
-- Lo que dice el mensaje se puede hacer: Almacén deja listo RQ10 y lo entrega con faltante.
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq10')::uuid, null);
-- Con la nota y el motivo casi en su tope, el aviso no corta el motivo.
select public.rq_entregar_con_faltante(current_setting('prueba.rq10')::uuid, 'Supervisor de Maestranza ' || repeat('n', 470),
  'Maestranza ya no necesita el segundo disco ' || repeat('m', 440) || ' FIN');
select test.afirmar(pg_temp.estado('rq10') = 'ENTREGADO', 'RQ10 se cierra como dice el mensaje: listo y entregado con faltante');
reset role;
select test.afirmar(exists (select 1 from public.notificaciones
                             where origen_id = current_setting('prueba.rq10')::uuid
                               and usuario_id = current_setting('prueba.requerimientos')::uuid
                               and cuerpo like 'Motivo: Maestranza ya no necesita%FIN. Lo recogió: Supervisor de Maestranza n%…. No salió: 1 UND%'
                               and char_length(cuerpo) <= 1000),
  'con nota y motivo largos, el aviso lleva el motivo entero, quién lo recogió (cortado) y qué no salió');

-- Un RQ de PLANTA cuya salida fue a una unidad escrita en la salida: el costo
-- quedó en esa unidad, así que el RQ puede pasar a su código, y a otro no.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq11', 'PLANTA', 'dis', 1);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq11')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select pg_temp.salida('s12', 'dis', 1, 'rq11', 'CHK416-P');
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.justificante('rq11', 'c6');
select pg_temp.justificante('rq11', 'c7');
select test.debe_fallar(format($q$select public.corregir_requerimiento('%s', '%s', 'Era para otra unidad', '%s/%s.pdf', 'correo.pdf',
  '{"codigo_interno": "CHK416-Q"}'::jsonb)$q$, current_setting('prueba.c6'), current_setting('prueba.rq11'),
  current_setting('prueba.rq11'), current_setting('prueba.c6')),
  'un RQ de PLANTA cuya salida fue a CHK416-P no pasa a otro código, y el mensaje dice a dónde se cargó', 'para CHK416-P: el código interno ya no cambia');
select public.corregir_requerimiento(current_setting('prueba.c7')::uuid, current_setting('prueba.rq11')::uuid,
  'Era para la unidad de la salida', current_setting('prueba.rq11') || '/' || current_setting('prueba.c7') || '.pdf', 'correo.pdf',
  '{"codigo_interno": "chk416-p"}'::jsonb);
reset role;
select test.afirmar((select public.normalizar_codigo_interno(codigo_interno) = 'CHK416-P' from public.requerimientos where id = current_setting('prueba.rq11')::uuid),
  'y sí pasa al código de la unidad a la que fue su salida');

-- 10. Donde Gerencia mira el código interno, RQ10 sale entregado con faltante y RQ1, entregado.
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select estado from public.codigo_interno_documentos('CHK416-H')
                      where tipo = 'REQUERIMIENTO' and id = current_setting('prueba.rq10')::uuid) = 'ENTREGADO_CON_FALTANTE',
  'en los documentos del código, el RQ entregado con faltante no sale «Entregado» a secas');
select test.afirmar((select array_agg(distinct estado) from public.codigo_interno_lo_pedido('CHK416-H')) = array['ENTREGADO_CON_FALTANTE'],
  'en lo pedido para el código, tampoco');
select test.afirmar((select estado from public.codigo_interno_documentos('CHK416-A')
                      where tipo = 'REQUERIMIENTO' and id = current_setting('prueba.rq1')::uuid) = 'ENTREGADO',
  'el que salió entero sigue «Entregado»');
reset role;

-- ============================================ 11. Lo que sale con un RQ es de ese RQ
-- 2 faros de neblina generales y 3 que entraron para la unidad CHK416-U. Un RQ
-- de PLANTA pide 2 y Almacén le separa los 2 generales; uno de CHK416-U pide 1
-- y se lo separa de lo de su unidad. Lo de PLANTA sale hacia CHK416-U: la
-- función se lo descontaba al RQ (por su línea) y también a la unidad (por el
-- código de la salida), y lo libre subía de 0 a 2 con una salida.
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
values
  (gen_random_uuid(), 'INGRESO', current_setting('prueba.fa2')::uuid, 2, 'INGRESO_GENERAL', 'GR 416-5', current_setting('prueba.almacenero')::uuid, null),
  (gen_random_uuid(), 'INGRESO', current_setting('prueba.fa2')::uuid, 3, 'INGRESO_GENERAL', 'GR 416-6', current_setting('prueba.almacenero')::uuid, 'CHK416-U');
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq14', 'PLANTA', 'fa2', 2);
select pg_temp.emitir('rq15', 'CHK416-U', 'fa2', 1);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq14')::uuid, '[{"item": 1, "en_stock": 2}]', null);
select public.rq_revisar_stock(current_setting('prueba.rq15')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select test.afirmar((select libre = 0 and separado = 5 from public.stock_libre_en_almacen(array[current_setting('prueba.fa2')::uuid]))
                    and pg_temp.separado('fa2', 'CHK416-U') = 3 and pg_temp.separado('fa2', 'PLANTA') = 2,
  'antes: los 5 faros tienen dueño, 3 de CHK416-U y 2 del RQ de PLANTA');
-- Cuánto separó cada línea y cuánto entró para cada unidad, para que la salida dé la cifra exacta.
select test.afirmar((select (c->>'del_kardex')::numeric = 3 and jsonb_array_length(c->'lineas') = 1
                            and (c->'lineas'->0->>'linea')::uuid = pg_temp.insumo('rq15') and (c->'lineas'->0->>'cantidad')::numeric = 1
                       from public.stock_libre_en_almacen(array[current_setting('prueba.fa2')::uuid]) s, jsonb_array_elements(s.por_codigo) c
                      where c->>'codigo' = 'CHK416-U'),
  'cada código dice lo que entró para su unidad (3) y lo que separó cada línea de sus RQ (1, la de RQ15)');
select pg_temp.salida('s18', 'fa2', 2, 'rq14', 'CHK416-U');
select test.afirmar((select existencia = 3 and libre = 0 from public.stock_libre_en_almacen(array[current_setting('prueba.fa2')::uuid]))
                    and pg_temp.separado('fa2', 'CHK416-U') = 3 and pg_temp.separado('fa2', 'PLANTA') = 0,
  'lo que sale con el RQ de PLANTA hacia CHK416-U se descuenta solo del RQ: CHK416-U sigue con sus 3 y lo libre sigue en 0');
-- La base dice lo mismo: los 3 que quedan son de CHK416-U y no salen para otra unidad.
select test.debe_fallar($q$select pg_temp.salida('s19', 'fa2', 1, null, 'CHK416-V')$q$,
  'lo que entró para CHK416-U no sale para CHK416-V', 'hay 0 libre para la unidad CHK416-V');
-- Lo devuelto de esa salida vuelve al RQ, no a la unidad.
select public.registrar_ingreso_almacen(current_setting('prueba.d4')::uuid, current_setting('prueba.fa2')::uuid, 1,
  'DEVOLUCION', 'Devolución de un faro de la prueba 416', null, 'PEN', current_setting('prueba.s18')::uuid);
select test.afirmar((select existencia = 4 and libre = 0 from public.stock_libre_en_almacen(array[current_setting('prueba.fa2')::uuid]))
                    and pg_temp.separado('fa2', 'CHK416-U') = 3 and pg_temp.separado('fa2', 'PLANTA') = 1,
  'el faro devuelto vuelve a ser del RQ de PLANTA, y CHK416-U sigue con 3');
-- Sin RQ hacia la unidad, se le descuenta a ella, como antes.
select pg_temp.salida('s20', 'fa2', 1, null, 'chk416-u');
select test.afirmar(pg_temp.separado('fa2', 'CHK416-U') = 2 and (select libre = 0 from public.stock_libre_en_almacen(array[current_setting('prueba.fa2')::uuid])),
  'una salida sin RQ hacia CHK416-U sí se le descuenta a la unidad');
reset role;

-- ============================================ 12. Lo que pasa de lo separado por el RQ es de la unidad
-- Una salida con un RQ de PLANTA hacia CHK416-U se lleva primero lo que separó
-- su línea, después lo que entró para CHK416-U y al final lo libre, y anota al
-- registrarse la parte de la unidad. Con la regla de antes, lo que pasaba de lo
-- separado no se le descontaba a nadie: la unidad seguía con accesorios que ya
-- no estaban. Calculada después, cambiaba al marcar el RQ listo, al corregir su
-- código o al devolver. Cada caso con su propio faro y las cuentas a mano.
create or replace function pg_temp.cifras(p_material text) returns text language sql as $$
  select format('existencia %s · CHK416-U %s · CHK416-V %s · PLANTA %s · libre %s',
    trim_scale(s.existencia), trim_scale(pg_temp.separado(p_material, 'CHK416-U')), trim_scale(pg_temp.separado(p_material, 'CHK416-V')),
    trim_scale(pg_temp.separado(p_material, 'PLANTA')), trim_scale(s.libre))
    from public.stock_libre_en_almacen(array[current_setting('prueba.' || p_material)::uuid]) s;
$$;
create or replace function pg_temp.de_la_unidad(p_salida text) returns numeric language sql as $$
  select trim_scale(de_la_unidad) from public.movimientos_materiales where id = current_setting('prueba.' || p_salida)::uuid;
$$;
create or replace function pg_temp.devolver(p_id text, p_material text, p_cantidad numeric, p_salida text) returns uuid language sql as $$
  select public.registrar_ingreso_almacen(current_setting('prueba.' || p_id)::uuid, current_setting('prueba.' || p_material)::uuid, p_cantidad,
    'DEVOLUCION', 'Devolución de un faro de la prueba 416', null, 'PEN', current_setting('prueba.' || p_salida)::uuid);
$$;

-- Seis faros más, de accesorios. Lo general y lo que entró para cada unidad, como dueño de las tablas.
do $$
declare v text;
begin
  foreach v in array array['FA3', 'FA4', 'FA5', 'FA6', 'FA7', 'FA8'] loop
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ('CHK416-' || v, 'Faro ' || v || ' (prueba 416)',
            (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
            (select id from public.unidades_medida where codigo = 'UND'));
    perform set_config('prueba.' || lower(v), (select id::text from public.materiales where codigo = 'CHK416-' || v), true);
  end loop;
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.' || x.material)::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-12',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values ('fa3', 2, null), ('fa3', 3, 'CHK416-U'),
                 ('fa4', 2, null), ('fa4', 3, 'CHK416-U'), ('fa4', 3, 'CHK416-V'),
                 ('fa5', 4, null), ('fa5', 3, 'CHK416-U'),
                 ('fa6', 2, null), ('fa6', 3, 'CHK416-U'),
                 ('fa7', 4, null), ('fa7', 3, 'CHK416-U'),
                 ('fa8', 3, null)) x(material, cantidad, codigo);
end $$;

select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq16', 'PLANTA', 'fa3', 4);
select pg_temp.emitir('rq17', 'PLANTA', 'fa4', 4);
select pg_temp.emitir('rq18', 'PLANTA', 'fa5', 4);
select pg_temp.emitir('rq19', 'PLANTA', 'fa6', 4);
select pg_temp.emitir('rq20', 'PLANTA', 'fa7', 4);
select pg_temp.emitir('rq21', 'PLANTA', 'fa8', 3);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.' || r)::uuid, '[{"item": 1, "en_stock": 2}]', null)
  from unnest(array['rq16', 'rq17', 'rq18', 'rq20']) r;
select public.rq_revisar_stock(current_setting('prueba.rq21')::uuid, '[{"item": 1, "en_stock": 0}]', null);

-- 12a. Separó 2 y salen 4 hacia CHK416-U, que tenía 3: 2 del RQ y 2 de la
-- unidad. Quedan 5 − 4 = 1, de CHK416-U (3 − 2); lo libre sigue en 0.
select test.afirmar(pg_temp.cifras('fa3') = 'existencia 5 · CHK416-U 3 · CHK416-V 0 · PLANTA 2 · libre 0', '12a, antes: ' || pg_temp.cifras('fa3'));
select pg_temp.salida('s21', 'fa3', 4, 'rq16', 'CHK416-U');
select test.afirmar(pg_temp.cifras('fa3') = 'existencia 1 · CHK416-U 1 · CHK416-V 0 · PLANTA 0 · libre 0',
  'lo que pasa de lo separado por el RQ se le descuenta a CHK416-U (antes seguía con 3 y solo queda 1): ' || pg_temp.cifras('fa3'));
select test.afirmar(pg_temp.de_la_unidad('s21') = 2, 'la salida anota los 2 que le tocaron a la unidad');
select test.debe_fallar($q$select pg_temp.salida('s22', 'fa3', 1, null, 'CHK416-V')$q$,
  'el último faro es de CHK416-U y no sale hacia CHK416-V', 'hay 0 libre para la unidad CHK416-V');
-- Lo devuelto vuelve primero a la unidad: 1 de 4 → CHK416-U 2. Dos más: lo
-- de la unidad ya volvió entero (3) y el último es del RQ, al que le faltan 3.
select pg_temp.devolver('d5', 'fa3', 1, 's21');
select test.afirmar(pg_temp.cifras('fa3') = 'existencia 2 · CHK416-U 2 · CHK416-V 0 · PLANTA 0 · libre 0',
  'el primer faro devuelto vuelve a CHK416-U: ' || pg_temp.cifras('fa3'));
select pg_temp.devolver('d6', 'fa3', 2, 's21');
select test.afirmar(pg_temp.cifras('fa3') = 'existencia 4 · CHK416-U 3 · CHK416-V 0 · PLANTA 1 · libre 0',
  'con 3 devueltos, CHK416-U vuelve a 3 y el RQ recupera 1 de lo que separó: ' || pg_temp.cifras('fa3'));

-- 12b. La misma línea saca 2 hacia CHK416-V (lo que separó) y 2 hacia
-- CHK416-U (de la unidad): quedan 8 − 4 = 4, CHK416-U 1 y CHK416-V 3. Antes, el
-- orden de los códigos le cobraba a CHK416-V lo que salió hacia CHK416-U.
select pg_temp.salida('s23', 'fa4', 2, 'rq17', 'CHK416-V');
select pg_temp.salida('s24', 'fa4', 2, 'rq17', 'CHK416-U');
select test.afirmar(pg_temp.cifras('fa4') = 'existencia 4 · CHK416-U 1 · CHK416-V 3 · PLANTA 0 · libre 0',
  'cada salida descuenta lo suyo: la primera, lo del RQ; la segunda, lo de CHK416-U: ' || pg_temp.cifras('fa4'));
-- Vuelven los 2 de CHK416-V, que eran del RQ: el RQ los recupera, no la unidad,
-- y salen otra vez con él hacia PLANTA.
select pg_temp.devolver('d7', 'fa4', 2, 's23');
select test.afirmar(pg_temp.cifras('fa4') = 'existencia 6 · CHK416-U 1 · CHK416-V 3 · PLANTA 2 · libre 0',
  'lo devuelto de la salida que se llevó lo del RQ vuelve al RQ: ' || pg_temp.cifras('fa4'));
select pg_temp.salida('s25', 'fa4', 2, 'rq17', 'PLANTA');
select test.afirmar(pg_temp.cifras('fa4') = 'existencia 4 · CHK416-U 1 · CHK416-V 3 · PLANTA 0 · libre 0',
  'y el RQ los saca hacia PLANTA: ' || pg_temp.cifras('fa4'));

-- 12c. «Listo en almacén» separa lo pedido (4) aunque la revisión anotó 2:
-- los 4 que salen hacia CHK416-U son del RQ y la unidad sigue con sus 3.
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq18')::uuid, null);
select test.afirmar(pg_temp.cifras('fa5') = 'existencia 7 · CHK416-U 3 · CHK416-V 0 · PLANTA 4 · libre 0', '12c, antes: ' || pg_temp.cifras('fa5'));
select pg_temp.salida('s26', 'fa5', 4, 'rq18', 'CHK416-U');
select test.afirmar(pg_temp.cifras('fa5') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0' and pg_temp.de_la_unidad('s26') = 0,
  'lo que separó el RQ listo sale sin tocar a CHK416-U, y lo libre no sube: ' || pg_temp.cifras('fa5'));

-- 12d. Listo sin revisar: separó 4 cuando fuera de las unidades había 2. De los
-- 4 que salen, 2 son del RQ y 2 de CHK416-U, que queda con 1 (5 − 4).
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq19')::uuid, null);
select pg_temp.salida('s27', 'fa6', 4, 'rq19', 'CHK416-U');
select test.afirmar(pg_temp.cifras('fa6') = 'existencia 1 · CHK416-U 1 · CHK416-V 0 · PLANTA 0 · libre 0' and pg_temp.de_la_unidad('s27') = 2,
  'lo separado de más no se lleva lo de la unidad gratis: ' || pg_temp.cifras('fa6'));

-- 12e. Primero salen 2 hacia CHK416-U (lo que separó) y después 2 con el mismo
-- RQ hacia PLANTA, de lo libre: CHK416-U sigue con 3 y lo libre baja a 0.
select pg_temp.salida('s28', 'fa7', 2, 'rq20', 'CHK416-U');
select pg_temp.salida('s29', 'fa7', 2, 'rq20', 'PLANTA');
select test.afirmar(pg_temp.cifras('fa7') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0',
  'una salida posterior del RQ hacia PLANTA no le cobra a CHK416-U la que ya estaba cubierta: ' || pg_temp.cifras('fa7'));

-- 12f. Sin nada separado y sin nada de CHK416-U, los 3 salen de lo libre y la
-- unidad no queda debiendo: lo que entra después para ella es suyo.
select pg_temp.salida('s30', 'fa8', 3, 'rq21', 'CHK416-U');
select test.afirmar(pg_temp.cifras('fa8') = 'existencia 0 · CHK416-U 0 · CHK416-V 0 · PLANTA 0 · libre 0' and pg_temp.de_la_unidad('s30') = 0,
  'si la unidad no tenía nada, no se le descuenta nada: ' || pg_temp.cifras('fa8'));
reset role;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.fa8')::uuid, 2, 'INGRESO_GENERAL', 'GR 416-13', current_setting('prueba.almacenero')::uuid, 'CHK416-U');
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.salida('s31', 'fa8', 2, null, 'CHK416-V')$q$,
  'lo que entró después para CHK416-U no sale hacia CHK416-V', 'hay 0 libre para la unidad CHK416-V');
reset role;

-- 12g. El RQ de 12d pasa al código de la unidad a la que fue su salida: lo de
-- CHK416-U no cambia sin ningún movimiento.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.justificante('rq19', 'c8');
select public.corregir_requerimiento(current_setting('prueba.c8')::uuid, current_setting('prueba.rq19')::uuid,
  'Era para la unidad de la salida', current_setting('prueba.rq19') || '/' || current_setting('prueba.c8') || '.pdf', 'correo.pdf',
  '{"codigo_interno": "CHK416-U"}'::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.cifras('fa6') = 'existencia 1 · CHK416-U 1 · CHK416-V 0 · PLANTA 0 · libre 0',
  'con el RQ corregido a CHK416-U, la unidad sigue con lo mismo: ' || pg_temp.cifras('fa6'));
reset role;

-- 12h. Una salida de antes de la columna (de_la_unidad nula) de un RQ de PLANTA
-- hacia CHK416-U, que tenía 3 propios. La migración la anota en 0
-- (anotar_salidas_de_antes), como la habría anotado la función: salieron los 2
-- que separó el RQ. Contada a la unidad y otra vez a la línea, lo libre subía
-- de 0 a 2; contada solo a la unidad, CHK416-U se quedaba con 1 y el RQ con 2
-- que ya habían salido.
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK416-FA9', 'Faro FA9 (prueba 416)',
          (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.fa9', (select id::text from public.materiales where codigo = 'CHK416-FA9'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.fa9')::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-14',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values (2, null), (3, 'CHK416-U')) x(cantidad, codigo);
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq22', 'PLANTA', 'fa9', 4);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq22')::uuid, '[{"item": 1, "en_stock": 2}]', null);
select pg_temp.salida('s32', 'fa9', 2, 'rq22', 'CHK416-U');
reset role;
-- Como la dejaba la función de antes: sin anotar cuánto le tocó a la unidad.
-- Y lo que hace la migración con ella.
update public.movimientos_materiales set de_la_unidad = null where id = current_setting('prueba.s32')::uuid;
select public.anotar_salidas_de_antes();
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.de_la_unidad('s32') = 0 and pg_temp.cifras('fa9') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0',
  'la salida de antes se lleva lo del RQ, CHK416-U sigue con sus 3 y lo libre no sube: ' || pg_temp.cifras('fa9'));
-- El candado guarda los 3 de la unidad.
select test.debe_fallar($q$select pg_temp.salida('s33', 'fa9', 1, null, 'CHK416-V')$q$,
  'los faros de CHK416-U no salen hacia CHK416-V', 'hay 0 libre para la unidad CHK416-V');
reset role;

-- 12i. Un vehículo registrado sin código interno: el accesorio no sale, y el
-- mensaje dice por qué (antes pedía elegir la unidad, que ya estaba elegida).
-- Almacén no lee la tabla de vehículos: el id se guarda aquí para afirmar después.
with v as (insert into public.unidades (codigo_interno, placa, marca, modelo) values (null, 'CHK-416', 'Volvo', 'FH') returning id)
select set_config('prueba.v416', id::text, true) from v;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.salida('s33', 'fa9', 1, null, 'chk-416')$q$,
  'el accesorio no sale hacia un vehículo sin código interno, y lo dice', 'La unidad elegida no tiene código interno');
-- Su placa sin guion o con un espacio es el mismo vehículo: antes quedaba
-- como un código nuevo y el accesorio salía hacia él.
select test.debe_fallar($q$select pg_temp.salida('s33', 'fa9', 1, null, 'chk416')$q$,
  'la placa sin guion es el mismo vehículo sin código interno', 'La unidad elegida no tiene código interno');
select test.debe_fallar($q$select pg_temp.salida('s33', 'fa9', 1, null, 'Chk 416')$q$,
  'y con un espacio en vez del guion, también', 'La unidad elegida no tiene código interno');
reset role;

-- 12j. Lo normal en producción: la unidad no tenía nada propio, porque ninguna
-- pantalla registra un ingreso con código interno (solo una carga a mano). La
-- salida de antes de un RQ de PLANTA que separó 2 y sacó 2 hacia CHK416-W se
-- llevó lo del RQ: el RQ ya no tiene nada separado y lo que entra después es
-- libre. Contada entera a la unidad, el RQ seguía con 2 separados que ya no
-- estaban.
-- 12k. Si la unidad tenía 1, la salida de antes también se llevó lo del RQ y
-- la unidad sigue con el suyo (contada por lo que entró para ella, le sacaba
-- ese 1 y el RQ se quedaba con 1).
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'CHK416-' || v, 'Faro ' || v || ' (prueba 416)',
         (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
         (select id from public.unidades_medida where codigo = 'UND')
    from unnest(array['F10', 'F11']) v;
  perform set_config('prueba.f10', (select id::text from public.materiales where codigo = 'CHK416-F10'), true);
  perform set_config('prueba.f11', (select id::text from public.materiales where codigo = 'CHK416-F11'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.' || x.material)::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-15',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values ('f10', 2, null), ('f11', 2, null), ('f11', 1, 'CHK416-U')) x(material, cantidad, codigo);
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq23', 'PLANTA', 'f10', 4);
select pg_temp.emitir('rq24', 'PLANTA', 'f11', 4);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.' || r)::uuid, '[{"item": 1, "en_stock": 2}]', null)
  from unnest(array['rq23', 'rq24']) r;
select pg_temp.salida('s34', 'f10', 2, 'rq23', 'CHK416-W');
select pg_temp.salida('s35', 'f11', 2, 'rq24', 'CHK416-U');
reset role;
update public.movimientos_materiales set de_la_unidad = null
 where id in (current_setting('prueba.s34')::uuid, current_setting('prueba.s35')::uuid);
select public.anotar_salidas_de_antes();
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.cifras('f10') = 'existencia 0 · CHK416-U 0 · CHK416-V 0 · PLANTA 0 · libre 0',
  'la salida de antes hacia una unidad sin nada propio se llevó lo del RQ: ' || pg_temp.cifras('f10'));
select test.afirmar(pg_temp.cifras('f11') = 'existencia 1 · CHK416-U 1 · CHK416-V 0 · PLANTA 0 · libre 0',
  'con 1 de la unidad, la salida de antes se llevó lo del RQ y la unidad sigue con el suyo: ' || pg_temp.cifras('f11'));
reset role;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.f10')::uuid, 2, 'INGRESO_GENERAL', 'GR 416-16', current_setting('prueba.almacenero')::uuid);
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.cifras('f10') = 'existencia 2 · CHK416-U 0 · CHK416-V 0 · PLANTA 0 · libre 2',
  'lo que entra después de esa salida es libre, no del RQ: ' || pg_temp.cifras('f10'));
reset role;

-- 12l. Lo que entra con el código de la unidad después de una salida de antes
-- es de la unidad, y no sale hacia otra. Contada al leerla por lo que entró
-- para la unidad, ese ingreso le devolvía al RQ lo separado que ya había
-- salido, y la base dejaba sacarlo con el RQ hacia otra unidad.
-- 12m. Corregido después el código del RQ a esa unidad, nada cambia: la
-- salida ya está anotada. Contada al leerla, lo libre subía a 1 aun antes de
-- corregirlo.
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'CHK416-' || v, 'Faro ' || v || ' (prueba 416)',
         (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
         (select id from public.unidades_medida where codigo = 'UND')
    from unnest(array['F12', 'F13']) v;
  perform set_config('prueba.f12', (select id::text from public.materiales where codigo = 'CHK416-F12'), true);
  perform set_config('prueba.f13', (select id::text from public.materiales where codigo = 'CHK416-F13'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.' || x.material)::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-17',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values ('f12', 2, null), ('f13', 2, null), ('f13', 3, 'CHK416-U')) x(material, cantidad, codigo);
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq25', 'PLANTA', 'f12', 4);
select pg_temp.emitir('rq26', 'PLANTA', 'f13', 3);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.' || r)::uuid, '[{"item": 1, "en_stock": 2}]', null)
  from unnest(array['rq25', 'rq26']) r;
select pg_temp.salida('s36', 'f12', 2, 'rq25', 'CHK416-U');
select pg_temp.salida('s37', 'f13', 2, 'rq26', 'CHK416-U');
reset role;
update public.movimientos_materiales set de_la_unidad = null
 where id in (current_setting('prueba.s36')::uuid, current_setting('prueba.s37')::uuid);
select public.anotar_salidas_de_antes();
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.f12')::uuid, 2, 'INGRESO_GENERAL', 'GR 416-18',
        current_setting('prueba.almacenero')::uuid, 'CHK416-U');
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.cifras('f12') = 'existencia 2 · CHK416-U 2 · CHK416-V 0 · PLANTA 0 · libre 0',
  'lo que entró para CHK416-U después de la salida de antes es de la unidad, no del RQ: ' || pg_temp.cifras('f12'));
select test.debe_fallar($q$select pg_temp.salida('s38', 'f12', 2, 'rq25', 'CHK416-V')$q$,
  'y no sale con el RQ hacia CHK416-V', 'hay 0 libre para la unidad CHK416-V');
select test.afirmar(pg_temp.cifras('f13') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0',
  'la salida de antes que no pasó de lo separado deja a la unidad con lo suyo y nada libre: ' || pg_temp.cifras('f13'));
reset role;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.justificante('rq26', 'c9');
select public.corregir_requerimiento(current_setting('prueba.c9')::uuid, current_setting('prueba.rq26')::uuid,
  'Era para la unidad de la salida', current_setting('prueba.rq26') || '/' || current_setting('prueba.c9') || '.pdf', 'correo.pdf',
  '{"codigo_interno": "CHK416-U"}'::jsonb);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.cifras('f13') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0',
  'con el RQ corregido a CHK416-U, la salida de antes cuenta igual: ' || pg_temp.cifras('f13'));

-- 12o. Un RQ de PLANTA cuya salida fue hacia CHK416-U y que, todavía antes de
-- la migración, se corrigió al código de esa unidad: hoy los dos códigos son
-- el mismo, pero al salir no lo eran, y la salida se anota igual. Sin anotar,
-- se descontaba entera a la unidad y a la línea: CHK416-U bajaba a 1 y lo
-- libre subía de 0 a 2 sin que entrara nada.
reset role;
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK416-F14', 'Faro F14 (prueba 416)',
          (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.f14', (select id::text from public.materiales where codigo = 'CHK416-F14'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.f14')::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-19',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values (2, null), (3, 'CHK416-U')) x(cantidad, codigo);
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq27', 'PLANTA', 'f14', 3);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq27')::uuid, '[{"item": 1, "en_stock": 2}]', null);
select pg_temp.salida('s39', 'f14', 2, 'rq27', 'CHK416-U');
reset role;
-- Como la dejaba la función de antes, una hora antes de la corrección.
update public.movimientos_materiales set de_la_unidad = null, registrado_en = registrado_en - interval '1 hour'
 where id = current_setting('prueba.s39')::uuid;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.justificante('rq27', 'c10');
select public.corregir_requerimiento(current_setting('prueba.c10')::uuid, current_setting('prueba.rq27')::uuid,
  'Era para la unidad de la salida', current_setting('prueba.rq27') || '/' || current_setting('prueba.c10') || '.pdf', 'correo.pdf',
  '{"codigo_interno": "CHK416-U"}'::jsonb);
reset role;
select public.anotar_salidas_de_antes();
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.de_la_unidad('s39') = 0 and pg_temp.cifras('f14') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0',
  'la salida de un RQ corregido antes de la migración se anota con el código que tenía al salir: ' || pg_temp.cifras('f14'));
select test.debe_fallar($q$select pg_temp.salida('s33', 'f14', 1, null, 'CHK416-V')$q$,
  'y los faros de CHK416-U no salen hacia CHK416-V', 'hay 0 libre para la unidad CHK416-V');

-- 12n. Anotar otra vez no cambia nada, la salida sin RQ hacia la unidad no se
-- anota (se le descuenta a ella), y nadie la llama desde la aplicación.
select test.debe_fallar($q$select public.anotar_salidas_de_antes()$q$,
  'la aplicación no anota salidas de antes', 'permission denied');
reset role;
select test.afirmar(public.anotar_salidas_de_antes() = 0, 'volver a aplicar la migración no anota nada más');
select test.afirmar((select de_la_unidad is null from public.movimientos_materiales where id = current_setting('prueba.s20')::uuid),
  'la salida sin RQ hacia CHK416-U sigue sin anotar');

-- 12p. El límite de anotar en 0: la unidad tenía accesorios propios y la
-- salida pasó de lo que su RQ tenía separado fuera de ellos. Con 2 generales y
-- 3 de CHK416-U, un RQ de PLANTA «Listo» sin revisar saca 4 hacia CHK416-U: la
-- función le anota 2 a la unidad (12d), y anotada en 0 la unidad figura con
-- sus 3. Lo libre no sube, y lo que entra después queda detrás de ellos.
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK416-F15', 'Faro F15 (prueba 416)',
          (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.f15', (select id::text from public.materiales where codigo = 'CHK416-F15'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.f15')::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-20',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values (2, null), (3, 'CHK416-U')) x(cantidad, codigo);
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq28', 'PLANTA', 'f15', 4);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_listo_en_almacen(current_setting('prueba.rq28')::uuid, null);
select pg_temp.salida('s40', 'f15', 4, 'rq28', 'CHK416-U');
select test.afirmar(pg_temp.de_la_unidad('s40') = 2, 'la función le anota 2 a la unidad');
reset role;
update public.movimientos_materiales set de_la_unidad = null where id = current_setting('prueba.s40')::uuid;
select public.anotar_salidas_de_antes();
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
values (gen_random_uuid(), 'INGRESO', current_setting('prueba.f15')::uuid, 2, 'INGRESO_GENERAL', 'GR 416-21', current_setting('prueba.almacenero')::uuid);
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.de_la_unidad('s40') = 0 and pg_temp.cifras('f15') = 'existencia 3 · CHK416-U 3 · CHK416-V 0 · PLANTA 0 · libre 0',
  'anotada en 0, la unidad figura con sus 3 y lo libre no sube (con la función: CHK416-U 1 y libre 2): ' || pg_temp.cifras('f15'));
reset role;

-- 12q. Un código de la lista es ese código aunque se escriba como la placa de
-- un vehículo sin código interno: «CHK416» lo usa un RQ, y la salida va a
-- CHK416 y queda en el vehículo CHK-416 (12i), que la lleva al costeo de su
-- OT. Con el código del vehículo, el accesorio no salía y el consumible perdía
-- el código y su costo; sin el vehículo, salía del costeo de la OT.
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK416-F16', 'Faro F16 (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK416-D16', 'Disco D16 (prueba 416)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.f16', (select id::text from public.materiales where codigo = 'CHK416-F16'), true);
  perform set_config('prueba.d16', (select id::text from public.materiales where codigo = 'CHK416-D16'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.' || m)::uuid, 5, 'INGRESO_GENERAL', 'GR 416-22',
         current_setting('prueba.almacenero')::uuid
    from unnest(array['f16', 'd16']) m;
  -- Dos vehículos con la misma placa por sus letras y números: uno sin código
  -- y otro, de un cliente, con código. El padrón no los junta, porque la
  -- placa solo es única entre los que no tienen cliente.
  insert into public.clientes (numero_documento, razon_social) values ('20999416017', 'Cliente de prueba 416');
  insert into public.unidades (codigo_interno, placa, marca, modelo, cliente_id) values
    (null, 'CHK-417', 'Isuzu', 'NPR', null),
    ('CHK416-Y', 'CHK417', 'Hino', '500', (select id from public.clientes where numero_documento = '20999416017'));
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq29', 'CHK416', 'd16', 1);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select pg_temp.salida('s41', 'f16', 1, null, 'chk416');
select pg_temp.salida('s42', 'd16', 1, null, 'CHK416');
select test.afirmar((select count(*) = 2 from public.movimientos_materiales
                      where id in (current_setting('prueba.s41')::uuid, current_setting('prueba.s42')::uuid)
                        and codigo_interno = 'CHK416'
                        and unidad_id = current_setting('prueba.v416')::uuid),
  'el código de la lista escrito como la placa de un vehículo sin código sale a ese código y queda en el vehículo, el accesorio y el consumible');
-- 12r. La placa tal cual es su vehículo; solo si ninguno la tiene así, por sus
-- letras y números, y si así es de dos, no se adivina cuál: antes el accesorio
-- salía hacia «CHK 417» como código nuevo, de nadie.
select pg_temp.salida('s43', 'f16', 1, null, 'chk417');
select test.afirmar((select codigo_interno = 'CHK416-Y' and unidad_id is not null from public.movimientos_materiales
                      where id = current_setting('prueba.s43')::uuid),
  'la placa exacta del vehículo con código lo vincula a él');
select test.debe_fallar($q$select pg_temp.salida('s33', 'f16', 1, null, 'chk-417')$q$,
  'la placa exacta del vehículo sin código es ese vehículo, y el accesorio no sale', 'La unidad elegida no tiene código interno');
select test.debe_fallar($q$select pg_temp.salida('s33', 'f16', 1, null, 'Chk 417')$q$,
  'la placa que por sus letras es de dos vehículos no sale como código nuevo', 'es de más de un vehículo registrado');
select test.debe_fallar($q$select pg_temp.salida('s33', 'd16', 1, null, 'chk 417')$q$,
  'tampoco un consumible', 'es de más de un vehículo registrado');
reset role;

-- 12s. Lo contrario de 12o: la salida de un RQ de CHK416-U hacia su unidad, y
-- el RQ corregido después a CHK416-V, que antes de la migración se podía. Al
-- salir era del código de su RQ y la función no la habría anotado. Anotada en
-- 0 por el código de hoy, CHK416-U figuraba con lo que ya salió, lo libre
-- bajaba de 2 a 0 y el candado frenaba una salida legítima hacia otra unidad.
do $$
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK416-F17', 'Faro F17 (prueba 416)',
          (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.f17', (select id::text from public.materiales where codigo = 'CHK416-F17'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.f17')::uuid, x.cantidad, 'INGRESO_GENERAL', 'GR 416-23',
         current_setting('prueba.almacenero')::uuid, x.codigo
    from (values (2, null), (3, 'CHK416-U')) x(cantidad, codigo);
end $$;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq30', 'CHK416-U', 'f17', 2);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq30')::uuid, '[{"item": 1, "en_stock": 2}]', null);
select pg_temp.salida('s44', 'f17', 2, 'rq30');
select set_config('prueba.cifras_s44', pg_temp.cifras('f17'), true);
reset role;
-- La salida, una hora antes; el RQ corregido como lo dejaba la corrección de
-- la migración 20261016602000, sin mirar sus salidas.
update public.movimientos_materiales set registrado_en = registrado_en - interval '1 hour'
 where id = current_setting('prueba.s44')::uuid;
select set_config('metalwork.corrigiendo', 'requerimiento', true);
update public.requerimientos set codigo_interno = 'CHK416-V' where id = current_setting('prueba.rq30')::uuid;
select set_config('metalwork.corrigiendo', '', true);
select public.anotar_salidas_de_antes();
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.de_la_unidad('s44') is null and pg_temp.cifras('f17') = current_setting('prueba.cifras_s44'),
  'la salida que al salir era del código de su RQ no se anota, aunque el RQ se corrigiera después: '
  || pg_temp.cifras('f17') || ' (antes: ' || current_setting('prueba.cifras_s44') || ')');
select pg_temp.salida('s45', 'f17', 1, null, 'CHK416-W');
select test.afirmar((select count(*) = 1 from public.movimientos_materiales where id = current_setting('prueba.s45')::uuid),
  'y lo libre sale hacia otra unidad');
reset role;
-- Si una versión anterior de la migración ya la había anotado en 0 (comparaba
-- con el código de hoy), aplicar esta la suelta: la función nunca anota una
-- salida con el código que su RQ tenía al salir.
update public.movimientos_materiales set de_la_unidad = 0 where id = current_setting('prueba.s44')::uuid;
select public.anotar_salidas_de_antes();
select pg_temp.como('almacenero');
set local role authenticated;
select test.afirmar(pg_temp.de_la_unidad('s44') is null,
  'lo que una versión anterior anotó con la regla vieja se suelta al volver a aplicar la migración');
reset role;

-- 12t. La placa de un vehículo que ya tiene código va a su código, aunque la
-- placa siga en la lista de cuando no lo tenía (un RQ la usó como código).
-- Antes iba al código-placa, y el costo del mismo vehículo se partía según se
-- escribiera la placa.
with v as (insert into public.unidades (codigo_interno, placa, marca, modelo) values ('CHK416-Z', 'CHK-418', 'Volvo', 'FH') returning id)
select set_config('prueba.v418', id::text, true) from v;
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq31', 'CHK-418', 'd16', 1);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select pg_temp.salida('s46', 'd16', 1, null, 'CHK-418');
select pg_temp.salida('s47', 'f16', 1, null, 'chk418');
select test.afirmar((select count(*) = 2 from public.movimientos_materiales
                      where id in (current_setting('prueba.s46')::uuid, current_setting('prueba.s47')::uuid)
                        and codigo_interno = 'CHK416-Z' and unidad_id = current_setting('prueba.v418')::uuid),
  'la placa del vehículo con código va a su código, también escrita como el código de la lista');

-- 12u. Con un RQ, la salida lleva el código del RQ aunque sea la placa de un
-- vehículo, porque es el código del pedido, y queda en ese vehículo, que la
-- lleva al costeo de su OT (así lo hacía la salida de 20261013140000).
select public.rq_revisar_stock(current_setting('prueba.rq31')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select pg_temp.salida('s48', 'd16', 1, 'rq31');
select test.afirmar((select codigo_interno = 'CHK-418'
                            and unidad_id = current_setting('prueba.v418')::uuid
                       from public.movimientos_materiales where id = current_setting('prueba.s48')::uuid),
  'con un RQ, la salida lleva el código del RQ aunque sea la placa de un vehículo con código, y queda en el vehículo');
reset role;

-- 12v. Con un RQ cuyo código es la placa de dos vehículos, no se adivina cuál
-- ni se rechaza: sale con el código del RQ y no queda en ninguno.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq32', 'Chk 417', 'd16', 1);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(current_setting('prueba.rq32')::uuid, '[{"item": 1, "en_stock": 1}]', null);
select pg_temp.salida('s49', 'd16', 1, 'rq32');
select test.afirmar((select upper(codigo_interno) = 'CHK 417' and unidad_id is null
                       from public.movimientos_materiales where id = current_setting('prueba.s49')::uuid),
  'con un RQ cuyo código es la placa de dos vehículos, sale con ese código y sin vehículo');
reset role;

do $$ begin raise notice 'OK 416: el circuito del RQ sin cabos sueltos'; end $$;
rollback;
