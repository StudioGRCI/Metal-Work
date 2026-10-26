-- La ficha del vehículo que salió y el aviso «Por comprar» (migración
-- 20261026150000), lo que DKS decidió el 26/10/2026 sobre los puntos del manual
-- v4 de Requerimientos.
--
--   1. La ficha de un vehículo que ya salió queda como estaba: Requerimientos
--      la llena mientras está en la planta y, con el vehículo fuera (a la
--      cochera o al arenado), ni guarda ni cierra. La que se cerró antes de
--      salir sigue recibiendo su escaneo firmado.
--   2. Cuando Almacén revisa un RQ de operación y le falta algo, a quien lo
--      registró le llega «Por comprar: RQ-…» con lo que compra Logística; a
--      Logística le sigue llegando el suyo. Si está todo, no llega. El RQ de
--      Administración no lo lleva: la administradora ya recibe su aviso.
--
-- Cada paso con el puesto que lo hace —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000437', 'PRUEBAS 437 S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ADMINISTRACION:ADM', 'ALMACENERO:ALM', 'COMPRADOR:LOG'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.437@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 437', lower(replace(v, ':', '.')) || '.437@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.area_rrh', (select id::text from public.areas where codigo = 'RRH'), true);
  foreach v in array array['v1', 'v2', 'v3', 'pdf', 'rq1', 'rq2', 'rq3', 'rqa'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.todo_ingreso', (select jsonb_object_agg(codigo, jsonb_build_object('ingreso', 'CONFORME'))::text
                                               from public.control_vehicular_items), true);
  perform set_config('prueba.todo_salida', (select jsonb_object_agg(codigo, jsonb_build_object('salida', 'CONFORME'))::text
                                              from public.control_vehicular_items), true);

  -- Dos materiales del catálogo: 10 discos en el almacén y ningún faro.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK437-DIS', 'Disco de corte (prueba 437)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND')),
    ('CHK437-FAR', 'Faro LED (prueba 437)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1),
     (select id from public.unidades_medida where codigo = 'UND'));
  perform set_config('prueba.dis', (select id::text from public.materiales where codigo = 'CHK437-DIS'), true);
  perform set_config('prueba.far', (select id::text from public.materiales where codigo = 'CHK437-FAR'), true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
  values (gen_random_uuid(), 'INGRESO', current_setting('prueba.dis')::uuid, 10, 'INGRESO_GENERAL', 'GR 437-1',
          current_setting('prueba.almacenero')::uuid, null);
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
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
-- La foto ya subida a Storage por Requerimientos, en la carpeta del ingreso.
create or replace function pg_temp.foto(p_registro text, p_momento text) returns jsonb language plpgsql as $$
declare v_ruta text := current_setting('prueba.requerimientos') || '/' || current_setting('prueba.' || p_registro) || '/' || p_momento
                       || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-vehiculos', v_ruta, current_setting('prueba.requerimientos'), '{"mimetype": "image/jpeg", "size": 150000}');
  return jsonb_build_array(v_ruta);
end $$;
create or replace function pg_temp.lineas(p_material text, p_cantidad numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.' || p_material), 'cantidad', p_cantidad));
$$;
-- Los avisos de un RQ a una cuenta, por su título.
create or replace function pg_temp.avisos(p_rq text, p_a text, p_titulo text) returns bigint language sql security definer as $$
  select count(*) from public.notificaciones
   where origen_tabla = 'requerimientos' and origen_id = current_setting('prueba.' || p_rq)::uuid
     and usuario_id = current_setting('prueba.' || p_a)::uuid and titulo like p_titulo || '%';
$$;
create or replace function pg_temp.cuerpo(p_rq text, p_a text, p_titulo text) returns text language sql security definer as $$
  select cuerpo from public.notificaciones
   where origen_tabla = 'requerimientos' and origen_id = current_setting('prueba.' || p_rq)::uuid
     and usuario_id = current_setting('prueba.' || p_a)::uuid and titulo like p_titulo || '%';
$$;

-- ===================================================== 1. La ficha del que salió
select pg_temp.como('requerimientos');
set local role authenticated;

-- v1 entra a la cochera, se empieza su ficha y sale sin esperar nada.
select public.registrar_ingreso_vehiculo(pg_temp.id('v1'), 'CHK437', null, null, 'Camioneta del cliente', 'QA CLIENTE 437',
  'COCHERA', null, null, pg_temp.foto('v1', 'ingreso'));
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'GUARDAR', jsonb_build_object(
  'marca', 'Toyota', 'conductor_ingreso', 'Juan Prueba', 'items', pg_temp.txt('todo_ingreso')::jsonb));
select test.afirmar((select conductor_ingreso = 'Juan Prueba' and ingreso_cerrado_en is null
                       from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v1')),
  'con el vehículo en la planta, Requerimientos guarda la ficha a medias');
select public.registrar_salida_vehiculo(pg_temp.id('v1'), null, 'Sale de la cochera', pg_temp.foto('v1', 'salida'));

select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{"conductor_ingreso": "Otro conductor"}')$q$,
  pg_temp.txt('v1')), 'con el vehículo fuera ya no se guarda', 'ya salió de la planta');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'CERRAR_INGRESO', %L)$q$,
  pg_temp.txt('v1'), jsonb_build_object('conductor_ingreso', 'Juan Prueba', 'fecha_ingreso', current_date,
                                        'items', pg_temp.txt('todo_ingreso')::jsonb)),
  'ni se cierra el ingreso', 'ya salió de la planta');
select test.afirmar((select conductor_ingreso = 'Juan Prueba' and ingreso_cerrado_en is null
                       from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v1')),
  'y la ficha queda como estaba');

-- v2 sale sin ficha: tampoco se empieza después.
select public.registrar_ingreso_vehiculo(pg_temp.id('v2'), 'CHK437B', null, null, 'Furgón del cliente', 'QA CLIENTE 437',
  'COCHERA', null, null, pg_temp.foto('v2', 'ingreso'));
select public.registrar_salida_vehiculo(pg_temp.id('v2'), null, null, pg_temp.foto('v2', 'salida'));
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{"marca": "Hino"}')$q$, pg_temp.txt('v2')),
  'el que salió sin ficha no la empieza después', 'ya salió de la planta');
select test.afirmar(not exists (select 1 from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v2')),
  'y sigue sin ficha');

-- v3 cierra su ficha y sale: el escaneo firmado llega después y se adjunta.
select public.registrar_ingreso_vehiculo(pg_temp.id('v3'), 'CHK437C', null, null, 'Volquete del cliente', 'QA CLIENTE 437',
  'COCHERA', null, null, pg_temp.foto('v3', 'ingreso'));
select public.guardar_ficha_vehiculo(pg_temp.id('v3'), 'CERRAR_INGRESO', jsonb_build_object(
  'marca', 'Volvo', 'conductor_ingreso', 'Juan Prueba', 'dni_ingreso', '00000000', 'fecha_ingreso', current_date,
  'combustible_ingreso', '1/2', 'items', pg_temp.txt('todo_ingreso')::jsonb));
select public.guardar_ficha_vehiculo(pg_temp.id('v3'), 'CERRAR_SALIDA', jsonb_build_object(
  'conductor_salida', 'Ana Prueba', 'dni_salida', '11111111', 'fecha_salida', current_date, 'combustible_salida', '1/4',
  'items', pg_temp.txt('todo_salida')::jsonb));
select public.registrar_salida_vehiculo(pg_temp.id('v3'), null, null, pg_temp.foto('v3', 'salida'));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('fichas-vehiculos', pg_temp.txt('v3') || '/' || pg_temp.txt('pdf') || '.pdf', pg_temp.txt('requerimientos'),
        '{"mimetype": "application/pdf", "size": 350000}');
select public.adjuntar_ficha_vehiculo_firmada(pg_temp.id('v3'), pg_temp.txt('v3') || '/' || pg_temp.txt('pdf') || '.pdf', 'ficha.pdf');
reset role;
select test.afirmar((select escaneo_ruta is not null from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v3')),
  'la ficha cerrada antes de salir recibe su escaneo firmado con el vehículo fuera');

-- ===================================================== 2. «Por comprar» a quien lo pidió
select pg_temp.como('requerimientos');
set local role authenticated;
-- rq1 pide 4 discos (hay 10); rq2, 6 discos y 2 faros (no hay faros); rq3, 3 faros.
select public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK437-A',
  'Discos para la prueba 437', null, pg_temp.lineas('dis', 4));
select public.emitir_requerimiento(pg_temp.id('rq2'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK437-A', 'Discos y faros de la prueba 437',
  null, pg_temp.lineas('dis', 6) || pg_temp.lineas('far', 2));
select public.emitir_requerimiento(pg_temp.id('rq3'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK437-A',
  'Faros para la prueba 437', null, pg_temp.lineas('far', 3));
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rqa'), 'ADMINISTRACION', pg_temp.id('area_rrh'), 'PLANTA',
  'Faros para la oficina de prueba 437', null, pg_temp.lineas('far', 1));
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(pg_temp.id('rq1'), '[{"item": 1, "en_stock": 4}]', null);
select public.rq_revisar_stock(pg_temp.id('rq2'), '[{"item": 1, "en_stock": 6}, {"item": 2, "en_stock": 0}]', null);
select public.rq_revisar_stock(pg_temp.id('rq3'), '[{"item": 1, "en_stock": 0}]', null);
select public.rq_revisar_stock(pg_temp.id('rqa'), '[{"item": 1, "en_stock": 0}]', null);
reset role;

select test.afirmar(pg_temp.avisos('rq1', 'requerimientos', 'Por comprar') = 0
                    and pg_temp.avisos('rq1', 'requerimientos', 'Listo en almacén') = 1,
  'con todo en el almacén, a Requerimientos le llega «Listo en almacén» y no «Por comprar»');
select test.afirmar(pg_temp.avisos('rq2', 'requerimientos', 'Por comprar: RQ-') = 1,
  'si falta algo, a quien registró el RQ le llega «Por comprar»');
select test.afirmar(pg_temp.cuerpo('rq2', 'requerimientos', 'Por comprar')
                    = 'Almacén tiene parte; Logística compra 1 de 2 insumos · CHK437-A: 2 UND Faro LED (prueba 437)',
  'con lo que compra Logística: ' || coalesce(pg_temp.cuerpo('rq2', 'requerimientos', 'Por comprar'), '(sin aviso)'));
select test.afirmar(pg_temp.cuerpo('rq3', 'requerimientos', 'Por comprar')
                    = 'Almacén no tiene nada; Logística compra 1 de 1 insumo · CHK437-A: 3 UND Faro LED (prueba 437)',
  'y si no hay nada, lo dice: ' || coalesce(pg_temp.cuerpo('rq3', 'requerimientos', 'Por comprar'), '(sin aviso)'));
select test.afirmar(pg_temp.avisos('rq2', 'comprador', 'Requerimiento por comprar') = 1
                    and pg_temp.avisos('rq2', 'comprador', 'Por comprar') = 0,
  'a Logística le sigue llegando el suyo, y solo ese');
select test.afirmar(pg_temp.avisos('rq2', 'almacenero', 'Por comprar') = 0,
  'a Almacén, que lo revisó, no le llega');
select test.afirmar(pg_temp.avisos('rqa', 'administracion', 'Requerimiento por comprar') = 1
                    and pg_temp.avisos('rqa', 'administracion', 'Por comprar') = 0,
  'el RQ de Administración no repite el aviso a la administradora');

-- Volver a dejar un RQ en SIN_STOCK por otro camino no repite el aviso.
update public.requerimientos set estado = 'EN_ATENCION' where id = pg_temp.id('rq3');
update public.requerimientos set estado = 'SIN_STOCK' where id = pg_temp.id('rq3');
select test.afirmar(pg_temp.avisos('rq3', 'requerimientos', 'Por comprar') = 1,
  'el aviso sale solo al pasar de la revisión de Almacén a por comprar');

-- Nadie llama a la función del disparador por su cuenta.
select test.afirmar(not has_function_privilege('authenticated', 'public.fn_rq_avisar_por_comprar()', 'execute')
                    and not has_function_privilege('anon', 'public.fn_rq_avisar_por_comprar()', 'execute'),
  'la función del disparador no se ejecuta desde la aplicación');

rollback;
