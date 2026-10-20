-- Requerimientos deja de ver el kardex, los gastos del mes y la valorización
-- del almacén, y ve en cambio lo que se gastó en cada código interno:
-- materiales salidos del almacén con su precio y compras aparte, sin la mano de
-- obra. Sus números son los mismos que ve Gerencia. Y el vehículo entra y sale
-- de la planta con sus fotos, de 1 a 15 cada vez, que no se cambian ni se
-- borran. Probado con el rol real y `set local role authenticated`, nunca como
-- ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Lo que la base ya tenga cargado «a todos los activos» este mes se repartiría
-- también entre los códigos de esta prueba y movería sus montos: se saca del mes.
update public.movimientos_materiales set registrado_en = registrado_en - interval '50 years'
 where public.normalizar_codigo_interno(codigo_interno) = 'TODOS LOS ACTIVOS';

insert into public.empresa (ruc, razon_social)
select '20100000046', 'PRUEBAS GASTO S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T46', 'Taller de pruebas del gasto') on conflict (codigo) do nothing;

select test.crear_usuario('Rita', 'Requerimientos', 'requerimientos346@demo.pe', 'REQUERIMIENTOS', (select id from public.sedes limit 1)) as req_id \gset
select test.crear_usuario('Raúl', 'Requerimientos', 'requerimientos2.346@demo.pe', 'REQUERIMIENTOS', (select id from public.sedes limit 1)) as req2_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia346@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas346@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Luis', 'Logística', 'logistica346@demo.pe', 'COMPRADOR', (select id from public.sedes limit 1)) as comprador_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh346@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset

select set_config('prueba.req', :'req_id', true);
select set_config('prueba.req2', :'req2_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.oc1', gen_random_uuid()::text, true);
select set_config('prueba.codigo', 'CHK346_SR_O4_1_26/30', true);
select set_config('prueba.solo_rq', 'CHK346_SOLO_PEDIDO', true);

-- ============================================================ armazón del gasto
-- RR. HH.: una hora de Juan (S/ 10 la hora) en el código. Es mano de obra:
-- Gerencia la ve, Requerimientos no.
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v := public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Juan', 'Soldador', '70000461', 'Soldador',
         null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-46', null);
  v := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t1')::uuid, 2400);
  v := public.rrhh_registrar_tareo(gen_random_uuid(), current_setting('prueba.t1')::uuid,
         (now() at time zone 'America/Lima')::date - 1, current_setting('prueba.codigo'), 1, 'Soldadura de la tolva');
  reset role;
end $$;

-- Almacén y los pedidos, como dueño: lo que se prueba aquí es la lectura.
do $$
declare
  v_reg uuid := current_setting('prueba.req')::uuid;
  v_m1 uuid; v_m2 uuid; v_sal uuid := gen_random_uuid();
  v_cat uuid := (select id from public.categorias_material order by 1 limit 1);
  v_um  uuid := (select id from public.unidades_medida order by 1 limit 1);
begin
  -- Sin cuenta: lo arma el dueño de las tablas.
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK346-1', 'Soldadura de prueba 346', v_cat, v_um) returning id into v_m1;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK346-2', 'Disco sin precio 346', v_cat, v_um) returning id into v_m2;
  perform set_config('prueba.m1', v_m1::text, true);
  perform set_config('prueba.m2', v_m2::text, true);

  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m1, 20, 'INGRESO_GENERAL', 'Compra en tienda', v_reg, 5.5, 'PEN', now() - interval '3 days'),
         (gen_random_uuid(), 'INGRESO', v_m2, 5, 'SALDO_INICIAL', 'Saldo inicial', v_reg, null, 'PEN', now() - interval '3 days');
  -- 10 de soldadura al código y se devuelven 2: cuentan 8 × 5.50 = 44.00.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (v_sal, 'SALIDA', v_m1, 10, 'SALIDA_GENERAL', 'Para la tolva', v_reg, 'Área de Maestranza',
          current_setting('prueba.codigo'), current_setting('prueba.codigo'), 10);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, devolucion_de)
  values (gen_random_uuid(), 'INGRESO', v_m1, 2, 'DEVOLUCION', 'Sobró', v_reg, v_sal);
  -- 3 discos, que no tienen ningún precio.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (gen_random_uuid(), 'SALIDA', v_m2, 3, 'SALIDA_GENERAL', 'Para la tolva', v_reg, 'Área de Maestranza',
          current_setting('prueba.codigo'), current_setting('prueba.codigo'), 3);

  -- Un RQ vivo y uno anulado para el código; y un código que por ahora solo tiene su pedido.
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
  values (gen_random_uuid(), 'RQ-CHK346-1', (select id from public.areas where codigo = 'MTZ'), lower(current_setting('prueba.codigo')),
          'Soldadura para la tolva de prueba', v_reg),
         (gen_random_uuid(), 'RQ-CHK346-3', (select id from public.areas where codigo = 'MTZ'), current_setting('prueba.solo_rq'),
          'Pintura para la unidad de prueba', v_reg);
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por, estado, anulado_por, anulado_en, motivo_anulacion)
  values (gen_random_uuid(), 'RQ-CHK346-2', (select id from public.areas where codigo = 'MTZ'), current_setting('prueba.codigo'),
          'Pedido repetido de la prueba', v_reg, 'ANULADO', v_reg, now(), 'Se pidió dos veces lo mismo');

  -- Un gasto del mes: luz del local. No es de ningún código.
  insert into public.gastos_generales_mes (id, periodo, concepto, descripcion, monto, moneda, reparto, registrado_por)
  values (gen_random_uuid(), date_trunc('month', now())::date, (select codigo from public.conceptos_gasto_general order by 1 limit 1),
          'Luz del local de prueba', 900, 'PEN', 'PARTES_IGUALES', v_reg);

  -- La OT a la que Requerimientos le pide el pago a Tesorería.
  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Tolva de prueba · check 346');
  perform set_config('prueba.ot', (select id::text from public.ordenes_trabajo where descripcion = 'Tolva de prueba · check 346'), true);
  update public.regla_aprobacion_compras set activa = false where unica;
end $$;

-- Logística compra para el código: 4 × 10.00 + 1 × 15.50 = 55.50 sin IGV.
select test.como_usuario(:'comprador_id');
set local role authenticated;
insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
values ('20999346007', 'Proveedor de prueba 346', 'Av. Argentina 456, Lima', '999 333 446');
select public.emitir_compra_directa(current_setting('prueba.oc1')::uuid,
  (select id from public.proveedores where numero_documento = '20999346007'), null,
  'Soldadura para la tolva de prueba',
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 4, 'precio', 10),
                    jsonb_build_object('material_id', current_setting('prueba.m2'), 'cantidad', 1, 'precio', 15.5)),
  null, 'CONTADO', 0, 'PEN', true, current_setting('prueba.codigo'));
set constraints all immediate;
reset role;

-- ================================================ 1. LOS PERMISOS DE REQUERIMIENTOS
select test.afirmar(
  not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
               where r.codigo = 'REQUERIMIENTOS' and rp.permiso_codigo in ('almacen.ver', 'costos.ver')),
  'Requerimientos ya no tiene almacen.ver ni costos.ver');
select test.afirmar(
  (select array_agg(r.codigo::text order by r.codigo) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo = 'codigos_internos.gasto') = array['REQUERIMIENTOS'],
  'el gasto por código lo tiene Requerimientos y nadie más');
select test.afirmar(
  exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
           where r.codigo = 'REQUERIMIENTOS' and rp.permiso_codigo = 'costos.solicitar_pago'),
  'Requerimientos sigue pidiendo el pago a Tesorería');
select test.afirmar(
  not has_function_privilege('authenticated', 'public.codigo_interno_lineas(text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.codigo_interno_lineas(text, boolean)', 'execute'),
  'las líneas del costeo son internas: ni la aplicación las pide sin permiso');
select test.afirmar(
  not has_function_privilege('anon', 'public.codigos_internos_gasto()', 'execute')
  and not has_function_privilege('anon', 'public.codigo_interno_gasto(text)', 'execute'),
  'el anónimo no ve el gasto por código');

-- ============================================ 2. REQUERIMIENTOS NO VE EL KARDEX
do $$
declare v_id uuid;
begin
  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.movimientos_materiales
                         where material_id in (current_setting('prueba.m1')::uuid, current_setting('prueba.m2')::uuid)) = 0,
    'Requerimientos ya no lee el kardex');
  perform test.afirmar((select count(*) from public.gastos_generales_mes) = 0, 'ni los gastos del mes');
  perform test.debe_fallar('select * from public.materiales_para_valorizar()', 'ni la valorización del almacén', 'valorización');
  perform test.afirmar((select count(*) from public.conteos_inventario) = 0, 'ni los conteos del almacén');
  -- Desde la migración 20261016120000 tampoco lee la OT: lo que le pedía a
  -- Tesorería desde ella va en el vehículo (check 363).
  perform test.afirmar((select count(*) from public.ordenes_trabajo where id = current_setting('prueba.ot')::uuid) = 0,
    'Requerimientos ya no lee la OT');
  perform test.debe_fallar(format(
    $q$insert into public.ot_solicitudes_tesoreria (orden_id, tipo, concepto, monto, moneda)
       values (%L, 'MATERIALES', 'Pago de la soldadura de la tolva de prueba', 55.5, 'PEN') returning id$q$,
    current_setting('prueba.ot')), 'ni manda solicitudes a Tesorería desde la OT', 'row-level security');
  reset role;
end $$;

-- ================================= 3. REQUERIMIENTOS VE EL GASTO DE CADA CÓDIGO
do $$
declare
  v   record;
  v_c text := current_setting('prueba.codigo');
begin
  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;

  perform test.afirmar((select count(*) from public.codigos_internos_gasto() g where upper(g.codigo) = v_c) = 1,
    'el código escrito de dos maneras sale una sola vez');
  select * into v from public.codigos_internos_gasto() g where g.codigo = v_c;
  perform test.afirmar(v.materiales_pen = 44 and v.materiales_usd = 0 and v.materiales_sin_precio = 1 and v.salidas = 2,
    format('materiales: 8 × 5.50 = 44 (lo devuelto no cuenta) y una salida sin precio (salió %s, %s, %s)',
           v.materiales_pen, v.materiales_sin_precio, v.salidas));
  perform test.afirmar(v.compras = 1 and v.compras_pen = 55.5 and v.compras_sin_precio = 0,
    format('una compra de S/ 55.50 sin IGV, aparte (salió %s, %s)', v.compras, v.compras_pen));
  perform test.afirmar(v.requerimientos = 1, format('un RQ vivo; el anulado no cuenta (salió %s)', v.requerimientos));

  select * into v from public.codigos_internos_gasto() g where g.codigo = current_setting('prueba.solo_rq');
  perform test.afirmar(found and v.requerimientos = 1 and v.salidas = 0 and v.compras = 0 and v.materiales_pen = 0,
    'el código aparece apenas se pide algo para él, aunque aún no tenga gasto');

  perform test.afirmar((select count(*) from public.codigo_interno_gasto(lower(v_c)) where fuente like 'MANO_OBRA%') = 0,
    'el gasto por código no lleva la mano de obra');
  perform test.afirmar((select sum(monto) from public.codigo_interno_gasto(v_c) where fuente = 'MATERIALES') = 44,
    'las líneas de materiales suman lo mismo que la lista, aunque se pida en minúsculas');
  perform test.afirmar((select count(*) from public.codigo_interno_gasto(v_c) where fuente = 'MATERIALES_SIN_PRECIO' and monto is null) = 1,
    'el disco sale marcado sin precio, no en cero');
  perform test.afirmar((select count(*) = 1 and sum(monto) = 55.5 and min(lineas) = 2 from public.codigo_interno_compras(v_c)),
    've la orden de compra del código, con su monto y sus dos líneas');

  -- La huella de lo que ve, para compararla con lo de Gerencia.
  perform set_config('prueba.huella',
    (select md5(string_agg(concat_ws('|', g.fuente, g.fecha, g.concepto, g.detalle, g.cantidad, g.precio_unitario, g.monto, g.moneda, g.documento),
                           ';' order by g.fuente, g.documento, g.concepto, g.cantidad))
       from public.codigo_interno_gasto(v_c) g), true);

  -- Lo que es de Gerencia y RR. HH. sigue cerrado.
  perform test.debe_fallar('select * from public.codigos_internos_resumen()', 'Requerimientos no ve la lista de Gerencia', 'codigos_internos.ver');
  perform test.debe_fallar(format('select * from public.codigo_interno_costeo(%L)', v_c), 'ni el costeo con mano de obra', 'codigos_internos.ver');
  perform test.debe_fallar(format('select * from public.codigo_interno_personal(%L)', v_c), 'ni las horas de cada persona', 'codigos_internos.ver');
  perform test.afirmar((select count(*) from public.tareos) = 0, 'ni el tareo');
  reset role;
end $$;

-- ================================= 4. GERENCIA VE LOS MISMOS NÚMEROS, Y MÁS
do $$
declare
  v   record;
  v_c text := current_setting('prueba.codigo');
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select md5(string_agg(concat_ws('|', g.fuente, g.fecha, g.concepto, g.detalle, g.cantidad, g.precio_unitario, g.monto, g.moneda, g.documento),
                           ';' order by g.fuente, g.documento, g.concepto, g.cantidad))
       from public.codigo_interno_costeo(v_c) g where g.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO', 'COMPRAS'))
    = current_setting('prueba.huella'),
    'Gerencia y Requerimientos ven las mismas líneas de materiales y compras');
  select * into v from public.codigos_internos_resumen() r where r.codigo = v_c;
  perform test.afirmar(v.materiales_pen = 44 and v.compras_pen = 55.5 and v.mano_obra = 10,
    format('el resumen de Gerencia dice lo mismo y suma la hora de Juan (salió %s, %s, %s)', v.materiales_pen, v.compras_pen, v.mano_obra));
  perform test.afirmar((select count(*) from public.codigo_interno_compras(v_c)) = 1, 'Gerencia sigue viendo las compras del código');
  perform test.debe_fallar('select * from public.codigos_internos_gasto()', 'la lista del gasto es la puerta de Requerimientos', 'codigos_internos.gasto');
  perform test.debe_fallar(format('select * from public.codigo_interno_gasto(%L)', v_c), 'y el gasto de un código también', 'codigos_internos.gasto');
  reset role;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar('select * from public.codigos_internos_gasto()', 'Ventas no ve el gasto por código', 'codigos_internos.gasto');
  perform test.debe_fallar(format('select * from public.codigo_interno_compras(%L)', v_c), 'ni las compras de un código', 'codigos_internos.ver');
  reset role;
end $$;

-- ===================================================== 5. LAS FOTOS DEL VEHÍCULO
select set_config('prueba.v1', gen_random_uuid()::text, true);
select set_config('prueba.f1', :'req_id' || '/' || current_setting('prueba.v1') || '/ingreso/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.f2', :'req_id' || '/' || current_setting('prueba.v1') || '/ingreso/' || gen_random_uuid() || '.webp', true);
select set_config('prueba.suelta', :'req_id' || '/' || current_setting('prueba.v1') || '/ingreso/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.falta', :'req_id' || '/' || current_setting('prueba.v1') || '/ingreso/' || gen_random_uuid() || '.jpg', true);
select set_config('prueba.s1', :'req_id' || '/' || current_setting('prueba.v1') || '/salida/' || gen_random_uuid() || '.jpg', true);

-- Storage local no trae RLS: aquí se prende, como en Supabase, para probar las
-- políticas del bucket con el rol real. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
begin
  -- Requerimientos sube las fotos a su carpeta.
  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata) values
    ('fotos-vehiculos', current_setting('prueba.f1'), current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 240000}'),
    ('fotos-vehiculos', current_setting('prueba.f2'), current_setting('prueba.req'), '{"mimetype": "image/webp", "size": 180000}'),
    ('fotos-vehiculos', current_setting('prueba.suelta'), current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 1000}'),
    ('fotos-vehiculos', current_setting('prueba.s1'), current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 200000}');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-vehiculos') = 4,
    'Requerimientos ve las fotos que acaba de subir');
  reset role;

  -- Otra cuenta de Requerimientos no sube a una carpeta ajena ni ve fotos sueltas ajenas.
  perform test.como_usuario(current_setting('prueba.req2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-vehiculos'', %L, %L, ''{}'')',
      current_setting('prueba.req') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.req2')),
    'nadie sube a la carpeta de otra cuenta', 'row-level security');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-vehiculos') = 0,
    'las fotos sueltas de otra cuenta no se ven');
  reset role;

  -- Ventas no registra vehículos: no sube fotos.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (''fotos-vehiculos'', %L, %L, ''{}'')',
      current_setting('prueba.vendedor') || '/x/' || gen_random_uuid() || '.jpg', current_setting('prueba.vendedor')),
    'Ventas no sube fotos de vehículos', 'row-level security');
  reset role;
end $$;

-- Motivo «otro» o «cochera»: desde 20261020166000 el trabajo del taller entra con
-- el código de una unidad con OT y sale con el 100 %; eso lo prueba el check 405.
-- ---------------------------------------------------------- el ingreso, con fotos
create or replace function pg_temp.ingreso(p_fotos jsonb) returns text language sql as $$
  select format($q$select public.registrar_ingreso_vehiculo('%s', 'CHK 346', null, 'CHK346_SR_O4_1_26/30', 'Tolva 18 m3 de prueba',
                  'EMPRESA DE PRUEBA', 'OTRO', null, null, %L::jsonb)$q$, current_setting('prueba.v1'), p_fotos);
$$;

do $$
begin
  perform test.como_usuario(current_setting('prueba.req')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.ingreso('[]'), 'sin fotos no entra el vehículo', 'al menos una foto');
  perform test.debe_fallar(pg_temp.ingreso(null), 'ni con las fotos vacías', 'al menos una foto');
  perform test.debe_fallar(pg_temp.ingreso((select jsonb_agg(current_setting('prueba.f1')) from generate_series(1, 16))),
    'van hasta 15 fotos al entrar', 'hasta 15');
  perform test.debe_fallar(pg_temp.ingreso(jsonb_build_array(current_setting('prueba.s1'))),
    'una foto de la salida no va en el ingreso', 'Vuelve a poner');
  perform test.debe_fallar(pg_temp.ingreso(jsonb_build_array(
      replace(current_setting('prueba.f1'), current_setting('prueba.req'), current_setting('prueba.req2')))),
    'ni una de otra cuenta', 'Vuelve a poner');
  perform test.debe_fallar(pg_temp.ingreso(jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.falta'))),
    'una foto que no terminó de subir no se anota', 'no terminó de subir');
  perform test.debe_fallar(pg_temp.ingreso(jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f1'))),
    'la misma foto dos veces no', 'repetida');
  perform test.afirmar((select count(*) from public.registro_vehiculos where id = current_setting('prueba.v1')::uuid) = 0,
    'ningún intento fallido dejó el ingreso a medias');

  -- Con dos fotos entra. Un reintento del mismo formulario no duplica nada.
  execute pg_temp.ingreso(jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2')));
  execute pg_temp.ingreso(jsonb_build_array(current_setting('prueba.f1'), current_setting('prueba.f2')));
  perform test.afirmar((select count(*) = 2 and min(orden) = 1 and max(orden) = 2 and bool_and(momento = 'INGRESO')
                               and sum(tamano_bytes) = 420000 and count(*) filter (where mime_type = 'image/webp') = 1
                          from public.registro_vehiculo_fotos where registro_id = current_setting('prueba.v1')::uuid),
    'el ingreso queda con sus dos fotos en orden, con su tipo y su peso; el reintento no duplicó');

  -- La pantalla vieja (sin fotos) ya no registra.
  perform test.debe_fallar(
    format($q$select public.registrar_ingreso_vehiculo('%s', 'XYZ346', null, null, 'Tolva', 'EMPRESA', 'OTRO', null, null)$q$,
           gen_random_uuid()),
    'la pantalla vieja no registra un ingreso sin fotos', 'recarga la pantalla');
  perform test.debe_fallar(
    format($q$select public.registrar_salida_vehiculo('%s', null, null)$q$, current_setting('prueba.v1')),
    'ni una salida sin fotos', 'recarga la pantalla');
  -- Las fotos no se anotan por fuera de la función.
  perform test.debe_fallar(
    format($q$insert into public.registro_vehiculo_fotos (registro_id, momento, orden, ruta, mime_type, tamano_bytes)
              values ('%s', 'INGRESO', 3, '%s', 'image/jpeg', 1000)$q$, current_setting('prueba.v1'), current_setting('prueba.suelta')),
    'Requerimientos no anota fotos por debajo', 'permission denied');
  perform test.debe_fallar('select public.vehiculo_anotar_fotos(gen_random_uuid(), ''INGRESO'', ''[]'')',
    'ni llama directo a la que las anota', 'permission denied');

  -- -------------------------------------------------------- la salida, con fotos
  perform test.debe_fallar(format($q$select public.registrar_salida_vehiculo('%s', null, 'Sale reparado', '[]')$q$, current_setting('prueba.v1')),
    'sin fotos no sale', 'al salir');
  perform test.debe_fallar(format($q$select public.registrar_salida_vehiculo('%s', null, 'Sale reparado', %L)$q$, current_setting('prueba.v1'),
                                  jsonb_build_array(current_setting('prueba.suelta'))),
    'una foto del ingreso no va en la salida', 'Vuelve a poner');
  perform public.registrar_salida_vehiculo(current_setting('prueba.v1')::uuid, null, 'Sale reparado',
                                           jsonb_build_array(current_setting('prueba.s1')));
  perform test.afirmar((select salida_en is not null from public.registro_vehiculos where id = current_setting('prueba.v1')::uuid)
                       and (select count(*) from public.registro_vehiculo_fotos
                             where registro_id = current_setting('prueba.v1')::uuid and momento = 'SALIDA') = 1,
    'la salida queda marcada con su foto');

  -- La foto suelta (subida y quitada del formulario) se retira; las del registro, no.
  delete from storage.objects where bucket_id = 'fotos-vehiculos' and name = current_setting('prueba.suelta');
  delete from storage.objects where bucket_id = 'fotos-vehiculos' and name = current_setting('prueba.f1');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-vehiculos') = 3,
    'se retira la foto suelta y las del registro se quedan');
  reset role;
end $$;

-- Ni el dueño de las tablas cambia o borra una foto anotada.
select test.debe_fallar(
  format($q$update public.registro_vehiculo_fotos set orden = 9 where registro_id = '%s'$q$, current_setting('prueba.v1')),
  'una foto anotada no se cambia', 'no se cambian ni se borran');
select test.debe_fallar(
  format($q$delete from public.registro_vehiculo_fotos where registro_id = '%s'$q$, current_setting('prueba.v1')),
  'ni se borra', 'no se cambian ni se borran');

-- ------------------------------------------------------------- quién ve las fotos
do $$
declare v text;
begin
  foreach v in array array['gerente', 'req2'] loop
    perform test.como_usuario(current_setting('prueba.' || v)::uuid);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.registro_vehiculo_fotos where registro_id = current_setting('prueba.v1')::uuid) = 3,
      v || ' ve las tres fotos del registro');
    perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-vehiculos') = 3,
      v || ' abre sus archivos');
    perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-vehiculos'
                            and name = current_setting('prueba.suelta')) = 0,
      v || ' no ve la foto que se retiró');
    reset role;
  end loop;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.registro_vehiculo_fotos) = 0, 'Ventas no ve las fotos de los vehículos');
  perform test.afirmar((select count(*) from storage.objects where bucket_id = 'fotos-vehiculos') = 0, 'ni sus archivos');
  reset role;
end $$;

\echo '✔ 346 · Requerimientos ve el gasto por código, no el kardex; el vehículo entra y sale con fotos'
rollback;
