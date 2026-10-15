-- El requerimiento pide con los nombres del catálogo de Almacén: cada insumo es
-- un material del catálogo, o un material nuevo que Almacén asocia o da de alta
-- al revisar el stock. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS RQ S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'COMPRADOR:LOG'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.380@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 380', lower(replace(v, ':', '.')) || '.380@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  insert into public.unidades_medida (codigo, nombre)
  select 'GLN', 'Galón' where not exists (select 1 from public.unidades_medida where codigo = 'GLN');
  perform set_config('prueba.gln', (select id::text from public.unidades_medida where codigo = 'GLN'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  perform set_config('prueba.cat2', (select id::text from public.categorias_material
                                      where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo desc limit 1), true);
  foreach v in array array['rq1', 'rq2', 'm1', 'm2', 'm3', 'm4'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  -- El catálogo, como dueño de las tablas: uno con su unidad, uno con la unidad
  -- provisional, uno dado de baja y uno en galones.
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente, activo) values
    (current_setting('prueba.m1')::uuid, 'CHK380-1', 'Disco de corte 7 pulgadas (prueba 380)', current_setting('prueba.cat2')::uuid, current_setting('prueba.und')::uuid, false, true),
    (current_setting('prueba.m2')::uuid, 'CHK380-2', 'Thinner acrílico (prueba 380)', current_setting('prueba.cat2')::uuid, current_setting('prueba.und')::uuid, true, true),
    (current_setting('prueba.m3')::uuid, 'CHK380-3', 'Electrodo viejo (prueba 380)', current_setting('prueba.cat2')::uuid, current_setting('prueba.und')::uuid, false, false),
    (current_setting('prueba.m4')::uuid, 'CHK380-4', 'Pintura gloss amarilla (prueba 380)', current_setting('prueba.cat2')::uuid, current_setting('prueba.gln')::uuid, false, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.emitir(p_rq text, p_lineas jsonb) returns uuid language sql as $$
  select public.emitir_requerimiento(current_setting('prueba.' || p_rq)::uuid, 'OPERACION', current_setting('prueba.area_mtz')::uuid,
    'CHK380_SR_1', 'Armado de la tolva de prueba 380', null, p_lineas);
$$;

create or replace function pg_temp.linea(p_rq text, p_item int) returns public.requerimiento_lineas language sql as $$
  select * from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.' || p_rq)::uuid and item = p_item;
$$;

-- ============================================ 1. Requerimientos pide del catálogo
select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar((select count(*) from public.materiales where codigo like 'CHK380-%') = 4,
                    'Requerimientos lee el catálogo de Almacén');
select pg_temp.emitir('rq1', jsonb_build_array(
  -- Del catálogo: la unidad que manda no cuenta, vale la del material.
  jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 4, 'unidad_medida_id', current_setting('prueba.gln')),
  -- Unidad provisional: vale la que dice quien pide.
  jsonb_build_object('material_id', current_setting('prueba.m2'), 'cantidad', 2, 'unidad_medida_id', current_setting('prueba.gln')),
  -- Material nuevo, que Almacén dará de alta.
  jsonb_build_object('nuevo', true, 'descripcion', 'Rejilla galvanizada 1x2 (prueba 380)', 'cantidad', 3,
                     'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')),
  -- Escrito a mano como en la pantalla de antes, igual que uno del catálogo: es ese.
  jsonb_build_object('descripcion', '  PINTURA  gloss amarilla (prueba 380) ', 'cantidad', 1,
                     'unidad_medida_id', current_setting('prueba.gln'), 'categoria_id', current_setting('prueba.cat')),
  -- Escrito a mano y sin igual en el catálogo: es un material nuevo.
  jsonb_build_object('descripcion', 'Perno hexagonal 1/2 (prueba 380)', 'cantidad', 10,
                     'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat'))));

select test.debe_fallar(format($q$select pg_temp.emitir('rq2', '[{"material_id": "%s", "cantidad": 1}, {"material_id": "%s", "cantidad": 2}]'::jsonb)$q$,
  current_setting('prueba.m1'), current_setting('prueba.m1')), 'el mismo material dos veces no entra', 'dos veces');
select test.debe_fallar(format($q$select pg_temp.emitir('rq2', '[{"material_id": "%s", "cantidad": 1}]'::jsonb)$q$,
  current_setting('prueba.m3')), 'un material dado de baja no se pide', 'ya no está en el catálogo');
select test.debe_fallar(format($q$select pg_temp.emitir('rq2', '[{"nuevo": true, "descripcion": "Rejilla", "cantidad": 1, "unidad_medida_id": "%s", "categoria_id": "%s"}]'::jsonb)$q$,
  current_setting('prueba.und'), (select id from public.categorias_material where codigo = 'ALM_POR_CLASIFICAR')),
  'un material nuevo lleva su categoría', 'categoría');
reset role;

select test.afirmar((pg_temp.linea('rq1', 1)).material_id = current_setting('prueba.m1')::uuid
                    and (pg_temp.linea('rq1', 1)).descripcion = 'Disco de corte 7 pulgadas (prueba 380)'
                    and (pg_temp.linea('rq1', 1)).unidad_medida_id = current_setting('prueba.und')::uuid
                    and (pg_temp.linea('rq1', 1)).categoria_id = current_setting('prueba.cat2')::uuid
                    and not (pg_temp.linea('rq1', 1)).material_nuevo,
                    'el insumo del catálogo lleva el nombre, la unidad y la categoría del catálogo');
select test.afirmar((pg_temp.linea('rq1', 2)).unidad_medida_id = current_setting('prueba.gln')::uuid,
                    'con la unidad provisional vale la que dice quien pide');
select test.afirmar((pg_temp.linea('rq1', 3)).material_nuevo and (pg_temp.linea('rq1', 3)).material_id is null,
                    'el material nuevo queda sin material hasta que Almacén lo revise');
select test.afirmar((pg_temp.linea('rq1', 4)).material_id = current_setting('prueba.m4')::uuid
                    and not (pg_temp.linea('rq1', 4)).material_nuevo
                    and (pg_temp.linea('rq1', 4)).descripcion = 'Pintura gloss amarilla (prueba 380)',
                    'escrito igual que uno del catálogo y en su unidad, es ese material');
select test.afirmar((pg_temp.linea('rq1', 5)).material_nuevo and (pg_temp.linea('rq1', 5)).material_id is null,
                    'lo escrito a mano sin igual en el catálogo entra como material nuevo');
select test.afirmar(exists (select 1 from public.notificaciones
                             where usuario_id = current_setting('prueba.almacenero')::uuid
                               and origen_id = current_setting('prueba.rq1')::uuid and cuerpo like '%2 son materiales nuevos%'),
                    'a Almacén le llega cuántos materiales nuevos trae');

-- ============================================ 2. El material queda; nadie lo cambia por fuera
select test.debe_fallar(format($q$update public.requerimiento_lineas set material_id = '%s' where requerimiento_id = '%s' and item = 1$q$,
  current_setting('prueba.m4'), current_setting('prueba.rq1')), 'el material de un insumo del catálogo no se cambia', 'ya quedó');

-- ============================================ 3. Almacén revisa y resuelve los nuevos
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[]'::jsonb, null)$q$, current_setting('prueba.rq1')),
  'Requerimientos no revisa el stock', 'permiso');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 0}, {"item": 2, "en_stock": 0},
  {"item": 3, "en_stock": 0, "material_id": "%s"}, {"item": 4, "en_stock": 0}, {"item": 5, "en_stock": 0}]'::jsonb, null)$q$,
  current_setting('prueba.rq1'), current_setting('prueba.m4')),
  'Almacén no asocia un material nuevo a uno que se cuenta en otra unidad', 'se cuenta en');
select test.debe_fallar(format($q$select public.rq_revisar_stock('%s', '[{"item": 1, "en_stock": 0, "material_id": "%s"}, {"item": 2, "en_stock": 0},
  {"item": 3, "en_stock": 0}, {"item": 4, "en_stock": 0}, {"item": 5, "en_stock": 0}]'::jsonb, null)$q$,
  current_setting('prueba.rq1'), current_setting('prueba.m4')),
  'el insumo que ya tiene material no se cambia en la revisión', 'ya tiene su material');
-- El 3 se asocia al disco que ya existe; el 5 se da de alta solo.
select public.rq_revisar_stock(current_setting('prueba.rq1')::uuid, format('[{"item": 1, "en_stock": 4}, {"item": 2, "en_stock": 0},
  {"item": 3, "en_stock": 1, "material_id": "%s"}, {"item": 4, "en_stock": 0}, {"item": 5, "en_stock": 0}]', current_setting('prueba.m1'))::jsonb, null);
reset role;

select test.afirmar((pg_temp.linea('rq1', 3)).material_id = current_setting('prueba.m1')::uuid
                    and (pg_temp.linea('rq1', 3)).material_nuevo
                    and (pg_temp.linea('rq1', 3)).descripcion = 'Rejilla galvanizada 1x2 (prueba 380)',
                    'el nuevo queda asociado al material que eligió Almacén y conserva lo que se pidió');
select test.afirmar(exists (select 1 from public.materiales m
                             where m.id = (pg_temp.linea('rq1', 5)).material_id and m.codigo like 'PROV-%' and m.activo
                               and m.descripcion = 'Perno hexagonal 1/2 (prueba 380)' and not m.unidad_pendiente
                               and m.unidad_medida_id = current_setting('prueba.und')::uuid
                               and m.categoria_id = current_setting('prueba.cat')::uuid
                               and m.creado_por = current_setting('prueba.almacenero')::uuid),
                    'el nuevo sin material se da de alta con lo que pidió el área');
select test.afirmar((select not unidad_pendiente and unidad_medida_id = current_setting('prueba.gln')::uuid
                       from public.materiales where id = current_setting('prueba.m2')::uuid),
                    'revisarlo confirma la unidad provisional con la del insumo');
select test.afirmar((select estado from public.requerimientos where id = current_setting('prueba.rq1')::uuid) = 'SIN_STOCK',
                    'falta algo: el RQ queda por comprar');
select test.afirmar((select count(*) from public.v_rq_lineas_para_salida
                      where requerimiento_id = current_setting('prueba.rq1')::uuid and material_id is not null) = 5,
                    'la salida del kardex sabe qué material es cada insumo');

-- Un segundo RQ con el mismo perno nuevo no lo duplica: toma el que ya se dio de alta.
select pg_temp.como('requerimientos');
set local role authenticated;
select pg_temp.emitir('rq2', jsonb_build_array(
  jsonb_build_object('nuevo', true, 'descripcion', 'Perno hexagonal 1/2 (prueba 380)', 'cantidad', 2,
                     'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat'))));
reset role;
select test.afirmar((pg_temp.linea('rq2', 1)).material_id = (pg_temp.linea('rq1', 5)).material_id
                    and not (pg_temp.linea('rq2', 1)).material_nuevo,
                    'lo que Almacén dio de alta ya sale del catálogo en el siguiente RQ');
select test.afirmar((select count(*) from public.materiales where descripcion = 'Perno hexagonal 1/2 (prueba 380)') = 1,
                    'el material nuevo no se duplica');

rollback;
