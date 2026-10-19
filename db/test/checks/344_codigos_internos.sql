-- Gerencia ve todos los códigos internos del sistema y, por cada uno, su avance
-- (los reportes diarios vigentes) y su costeo separado en mano de obra (el
-- tareo, con las horas que esperan costo aparte), materiales salidos del
-- almacén (con su precio o «sin precio») y compras, que no van al total. Ve
-- las horas de cada persona, nunca su costo. RR. HH., Supervisión general y el
-- supervisor no lo ven. Probado con el rol real y `set local role
-- authenticated`, nunca como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000044', 'PRUEBAS CODIGOS S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T44', 'Taller de pruebas de los códigos') on conflict (codigo) do nothing;

select test.crear_usuario('Gema', 'Gerente', 'gerencia344@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Rosa', 'Humanos', 'rrhh344@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
select test.crear_usuario('Mario', 'Maestranza', 'sup.mtz344@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup_id \gset
select test.crear_usuario('Sara', 'General', 'sup.general344@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes limit 1)) as supgen_id \gset
select test.crear_usuario('Luis', 'Logística', 'logistica344@demo.pe', 'COMPRADOR', (select id from public.sedes limit 1)) as comprador_id \gset
select test.crear_usuario('Ada', 'Admin', 'admin344@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'sup_id';

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.comprador', :'comprador_id', true);
select set_config('prueba.t1', gen_random_uuid()::text, true);
select set_config('prueba.t2', gen_random_uuid()::text, true);
select set_config('prueba.r_viejo', gen_random_uuid()::text, true);
select set_config('prueba.r_hoy', gen_random_uuid()::text, true);
select set_config('prueba.r_anulado', gen_random_uuid()::text, true);
select set_config('prueba.oc1', gen_random_uuid()::text, true);
select set_config('prueba.oc2', gen_random_uuid()::text, true);
-- El código, escrito de tres maneras distintas en el sistema: es uno solo.
select set_config('prueba.codigo', 'CHK344_SR_O4_1_26/28', true);

-- ------------------------------------------------- RR. HH. registra a dos personas
do $$
declare v uuid;
begin
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  v := public.rrhh_guardar_trabajador(current_setting('prueba.t1')::uuid, 'Juan', 'Soldador', '70000441', 'Soldador',
         null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-41', null);
  v := public.rrhh_guardar_trabajador(current_setting('prueba.t2')::uuid, 'Ana', 'Sin Costo', '70000442', 'Pintora',
         null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-42', null);
  -- S/ 2400 al mes: S/ 10 la hora. Ana no tiene costo: sus horas esperan.
  v := public.rrhh_guardar_costo_trabajador(current_setting('prueba.t1')::uuid, 2400);
  -- Una hora a mano, en el código escrito en minúsculas y con espacios.
  v := public.rrhh_registrar_tareo(gen_random_uuid(), current_setting('prueba.t1')::uuid,
         (now() at time zone 'America/Lima')::date - 1, '  ' || lower(current_setting('prueba.codigo')) || ' ', 1, 'Pintura de fondo');
  -- Y dos horas en PLANTA.
  v := public.rrhh_registrar_tareo(gen_random_uuid(), current_setting('prueba.t1')::uuid,
         (now() at time zone 'America/Lima')::date - 1, 'PLANTA', 2, 'Limpieza del taller');
  reset role;
end $$;

-- ------------------------------------------------------- el supervisor sube sus reportes
do $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v uuid;
begin
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  -- Hace dos días: la soldadura iba en 10 %, escrita con otras mayúsculas y espacios.
  v := public.registrar_reporte_diario(current_setting('prueba.r_viejo')::uuid, v_hoy - 2, lower(current_setting('prueba.codigo')),
         'Avance de la tolva', 'Se empezó a soldar', jsonb_build_array(
           jsonb_build_object('descripcion', 'soldadura  de la TOLVA', 'avance', 10, 'personal', jsonb_build_array(
             jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 3)))),
         null, null);
  -- Hoy: la soldadura va en 40 % y el armado en 20 %; Ana trabajó 4 h sin costo.
  v := public.registrar_reporte_diario(current_setting('prueba.r_hoy')::uuid, v_hoy, current_setting('prueba.codigo'),
         'Avance de la tolva', 'Se soldó y se armó', jsonb_build_array(
           jsonb_build_object('descripcion', 'Soldadura de la tolva', 'avance', 40, 'personal', jsonb_build_array(
             jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 6),
             jsonb_build_object('trabajador_id', current_setting('prueba.t2'), 'horas', 4))),
           jsonb_build_object('descripcion', 'Armado del bastidor', 'avance', 20, 'personal', jsonb_build_array(
             jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 2)))),
         null, null);
  -- Uno que se anula: ni su avance ni sus horas cuentan.
  v := public.registrar_reporte_diario(current_setting('prueba.r_anulado')::uuid, v_hoy - 1, current_setting('prueba.codigo'),
         'Reporte equivocado', 'Se subió dos veces', jsonb_build_array(
           jsonb_build_object('descripcion', 'Soldadura de la tolva', 'avance', 90, 'personal', jsonb_build_array(
             jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 5)))),
         null, null);
  perform public.anular_reporte_diario(current_setting('prueba.r_anulado')::uuid, 'Se subió dos veces el mismo día');
  reset role;
end $$;

-- ------------------------------------- Almacén: salidas al código, con y sin precio (armazón)
-- Se arman como dueño: lo que se prueba aquí es la lectura, no la salida.
do $$
declare
  v_reg uuid := current_setting('prueba.sup')::uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid; v_sal uuid := gen_random_uuid();
  v_cat uuid := (select id from public.categorias_material order by 1 limit 1);
  v_um  uuid := (select id from public.unidades_medida order by 1 limit 1);
begin
  -- Sin sesión: la OT de la unidad la abre el taller, y el supervisor ya no
  -- tiene ningún permiso de la OT (migración 20261016120000).
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK344-1', 'Soldadura de prueba 344', v_cat, v_um) returning id into v_m1;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK344-2', 'Disco sin precio 344', v_cat, v_um) returning id into v_m2;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK344-3', 'Pintura valorizada 344', v_cat, v_um) returning id into v_m3;
  perform set_config('prueba.m1', v_m1::text, true);

  -- m1 entró a S/ 5.50 hace tres días y a S/ 8.00 mañana: la salida de hoy vale 5.50.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m1, 20, 'INGRESO_GENERAL', 'Compra en tienda', v_reg, 5.5, 'PEN', now() - interval '3 days'),
         (gen_random_uuid(), 'INGRESO', v_m1, 5, 'INGRESO_GENERAL', 'Compra en tienda', v_reg, 8, 'PEN', now() + interval '1 day'),
         (gen_random_uuid(), 'INGRESO', v_m2, 5, 'SALDO_INICIAL', 'Saldo inicial', v_reg, null, 'PEN', now() - interval '3 days'),
         (gen_random_uuid(), 'INGRESO', v_m3, 5, 'SALDO_INICIAL', 'Saldo inicial', v_reg, null, 'PEN', now() - interval '3 days');
  -- m3 no se compró: Logística le fijó S/ 12.
  insert into public.valorizaciones_material (id, material_id, precio, moneda, observacion, registrado_por, vigente_desde)
  values (gen_random_uuid(), v_m3, 12, 'PEN', 'Precio de lista', v_reg, now() - interval '5 days');

  -- 10 de m1 al código, y se devuelven 2: cuentan 8 × 5.50 = 44.00.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (v_sal, 'SALIDA', v_m1, 10, 'SALIDA_GENERAL', 'Para la tolva', v_reg, 'Área de Maestranza',
          current_setting('prueba.codigo'), current_setting('prueba.codigo'), 10);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, devolucion_de)
  values (gen_random_uuid(), 'INGRESO', v_m1, 2, 'DEVOLUCION', 'Sobró', v_reg, v_sal);
  -- 3 de m2, que no tiene ningún precio.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (gen_random_uuid(), 'SALIDA', v_m2, 3, 'SALIDA_GENERAL', 'Para la tolva', v_reg, 'Área de Maestranza',
          current_setting('prueba.codigo'), current_setting('prueba.codigo'), 3);
  -- 1 de m3 de antes de que el kardex guardara el código: vale lo que Almacén escribió.
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, cantidad_de_stock)
  values (gen_random_uuid(), 'SALIDA', v_m3, 1, 'SALIDA_GENERAL', 'Para la tolva', v_reg, 'Área de Maestranza',
          ' ' || lower(current_setting('prueba.codigo')), 1);

  -- La unidad registrada con el código, y un requerimiento vivo y uno anulado.
  insert into public.unidades (placa, tipo_vehiculo, marca, modelo, codigo_interno)
  values ('CHK-344', 'CAMION', 'Marca', 'Modelo', current_setting('prueba.codigo'));
  -- La OT de esa unidad: hoy es el único camino del código a la OT.
  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion, unidad_id)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Tolva de prueba · check 344',
          (select id from public.unidades where placa = 'CHK-344'));
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
  values (gen_random_uuid(), 'RQ-CHK344-1', (select id from public.areas where codigo = 'MTZ'), lower(current_setting('prueba.codigo')),
          'Soldadura para la tolva de prueba', v_reg);
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por, estado, anulado_por, anulado_en, motivo_anulacion)
  values (gen_random_uuid(), 'RQ-CHK344-2', (select id from public.areas where codigo = 'MTZ'), current_setting('prueba.codigo'),
          'Pedido repetido de la prueba', v_reg, 'ANULADO', v_reg, now(), 'Se pidió dos veces lo mismo');
  update public.regla_aprobacion_compras set activa = false where unica;
end $$;

-- --------------------------------------------- Logística compra para el código (dos OC)
select test.como_usuario(:'comprador_id');
set local role authenticated;
insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
values ('20999344004', 'Proveedor de prueba 344', 'Av. Argentina 456, Lima', '999 333 444');
select set_config('prueba.proveedor', (select id::text from public.proveedores where numero_documento = '20999344004'), true);
-- 4 × 10.00 + 1 × 15.50 = 55.50 sin IGV.
select public.emitir_compra_directa(current_setting('prueba.oc1')::uuid, current_setting('prueba.proveedor')::uuid, null,
  'Soldadura para la tolva de prueba',
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 4, 'precio', 10),
                    jsonb_build_object('material_id', (select id from public.materiales where codigo = 'CHK344-2'), 'cantidad', 1, 'precio', 15.5)),
  null, 'CONTADO', 0, 'PEN', true, current_setting('prueba.codigo'));
select public.emitir_compra_directa(current_setting('prueba.oc2')::uuid, current_setting('prueba.proveedor')::uuid, null,
  'Compra que Gerencia rechaza',
  jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.m1'), 'cantidad', 100, 'precio', 10)),
  null, 'CONTADO', 0, 'PEN', true, current_setting('prueba.codigo'));
set constraints all immediate;
reset role;
select test.como_usuario(:'gerente_id');
set local role authenticated;
select public.rechazar_compra(current_setting('prueba.oc2')::uuid, 'No se necesita tanta soldadura');
reset role;

-- ============================================== 1. QUIEN NO ES GERENCIA NO LO VE
do $$
declare v text;
begin
  foreach v in array array['rrhh', 'supgen', 'sup', 'comprador'] loop
    perform test.como_usuario(current_setting('prueba.' || v)::uuid);
    set local role authenticated;
    perform test.debe_fallar('select * from public.codigos_internos_resumen()', v || ' no ve la lista de códigos', 'codigos_internos.ver');
    perform test.debe_fallar(format('select * from public.codigo_interno_costeo(%L)', current_setting('prueba.codigo')),
      v || ' no ve el costeo de un código', 'codigos_internos.ver');
    perform test.debe_fallar(format('select * from public.codigo_interno_personal(%L)', current_setting('prueba.codigo')),
      v || ' no ve las horas por persona de un código', 'codigos_internos.ver');
    perform test.debe_fallar(format('select * from public.codigo_interno_avance(%L)', current_setting('prueba.codigo')),
      v || ' no ve el avance de un código', 'codigos_internos.ver');
    perform test.debe_fallar(format('select * from public.codigo_interno_compras(%L)', current_setting('prueba.codigo')),
      v || ' no ve las compras de un código', 'codigos_internos.ver');
    perform test.debe_fallar(format('select * from public.codigo_interno_documentos(%L)', current_setting('prueba.codigo')),
      v || ' no ve los documentos de un código', 'codigos_internos.ver');
    reset role;
  end loop;
end $$;

select test.afirmar(not has_function_privilege('anon', 'public.codigos_internos_resumen()', 'execute'),
  'el anónimo no ejecuta la lista de códigos');
select test.afirmar(not has_function_privilege('anon', 'public.codigo_interno_costeo(text)', 'execute'),
  'el anónimo no ejecuta el costeo de un código');
select test.afirmar(not has_function_privilege('authenticated', 'public.normalizar_codigo_interno(text)', 'execute'),
  'normalizar el código es interno: ni la aplicación lo llama');
-- Desde el 2026-10-19 (migración 20261017400000) también Administración, en lectura.
select test.afirmar((select array_agg(r.codigo order by r.codigo) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                      where rp.permiso_codigo = 'codigos_internos.ver') = array['ADMINISTRACION', 'GERENTE'],
  'el permiso lo tienen Gerencia y Administración, y nadie más');

-- ============================================== 2. GERENCIA VE TODOS LOS CÓDIGOS
do $$
declare
  v_c   text := current_setting('prueba.codigo');
  v     record;
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;

  perform test.afirmar((select count(*) from public.codigos_internos_resumen() r where upper(r.codigo) = v_c) = 1,
    'el código escrito de tres maneras sale una sola vez, en mayúsculas');
  select * into v from public.codigos_internos_resumen() r where r.codigo = v_c;
  perform test.afirmar(v.reportes = 2 and v.ultimo_reporte = v_hoy,
    format('dos reportes vigentes, el último de hoy (salió %s, %s)', v.reportes, v.ultimo_reporte));
  perform test.afirmar(v.trabajos = 2 and v.trabajos_terminados = 0 and v.avance_medio = 30,
    format('dos trabajos (la soldadura escrita de dos maneras es uno), cada uno con su último avance: 40 y 20, en promedio 30 (salió %s, %s, %s)',
           v.trabajos, v.trabajos_terminados, v.avance_medio));
  perform test.afirmar(v.horas = 16 and v.horas_sin_costo = 4,
    format('16 h en el código (3 + 8 + 1 de Juan y 4 de Ana), 4 esperando costo; el reporte anulado no cuenta (salió %s y %s)',
           v.horas, v.horas_sin_costo));
  perform test.afirmar(v.mano_obra = 120,
    format('la mano de obra son las 12 h de Juan a S/ 10; las de Ana no valen cero, esperan (salió %s)', v.mano_obra));
  perform test.afirmar(v.materiales_pen = 56 and v.materiales_usd = 0 and v.materiales_sin_precio = 1 and v.salidas = 3,
    format('materiales: 8 × 5.50 (menos lo devuelto, al precio del ingreso anterior) + 1 × 12 (precio de Logística) = 56; una salida sin precio (salió %s, %s, %s)',
           v.materiales_pen, v.materiales_sin_precio, v.salidas));
  perform test.afirmar(v.compras = 1 and v.compras_pen = 55.5 and v.compras_sin_precio = 0,
    format('una compra de S/ 55.50 sin IGV; la rechazada no cuenta (salió %s, %s)', v.compras, v.compras_pen));
  perform test.afirmar(v.requerimientos = 1 and v.unidades = 1 and v.ordenes = 1 and v.vehiculos = 0,
    format('un RQ vivo (el anulado no cuenta), la unidad registrada con el código y su OT (salió %s, %s, %s)',
           v.requerimientos, v.unidades, v.ordenes));

  select * into v from public.codigos_internos_resumen() r where r.codigo = 'PLANTA';
  perform test.afirmar(found and v.mano_obra >= 20, 'PLANTA es un código más, con sus horas');

  -- El costeo de un código: la suma de sus líneas es el resumen.
  perform test.afirmar((select sum(monto) from public.codigo_interno_costeo(lower(v_c)) where fuente = 'MANO_OBRA') = 120,
    'las líneas de mano de obra suman lo mismo que el resumen, aunque se pida el código en minúsculas');
  perform test.afirmar((select count(*) from public.codigo_interno_costeo(v_c)
                         where fuente = 'MANO_OBRA' and concepto = 'Pintura de fondo' and detalle = 'Cargadas por Recursos Humanos') = 1,
    'la hora cargada a mano sale con su labor');
  perform test.afirmar((select count(*) from public.codigo_interno_costeo(v_c)
                         where fuente = 'MANO_OBRA_SIN_COSTO' and horas = 4 and monto is null) = 1,
    'las horas de Ana salen sin costo, no en cero');
  perform test.afirmar((select monto from public.codigo_interno_costeo(v_c) where fuente = 'MATERIALES' and cantidad = 8) = 44,
    'la soldadura vale 8 × 5.50, el precio del ingreso de antes de la salida y no el de después');
  perform test.afirmar((select count(*) from public.codigo_interno_costeo(v_c) where fuente = 'MATERIALES_SIN_PRECIO' and monto is null) = 1,
    'el disco sale marcado sin precio');

  -- Las horas de cada persona, sin su costo.
  perform test.afirmar((select count(*) from public.codigo_interno_personal(v_c)) = 2, 'dos personas trabajaron en el código');
  perform test.afirmar((select horas = 12 and horas_sin_costo = 0 and dias = 3 from public.codigo_interno_personal(v_c)
                         where trabajador_id = current_setting('prueba.t1')::uuid),
    'Juan: 12 h en tres días, todas con costo');
  perform test.afirmar((select horas = 4 and horas_sin_costo = 4 from public.codigo_interno_personal(v_c)
                         where trabajador_id = current_setting('prueba.t2')::uuid),
    'Ana: 4 h, todas esperando su costo');

  -- El avance: tres trabajos de dos reportes vigentes, por validar.
  perform test.afirmar((select count(*) from public.codigo_interno_avance(v_c)) = 3, 'tres trabajos en dos reportes vigentes');
  perform test.afirmar((select bool_and(estado = 'POR_VALIDAR') from public.codigo_interno_avance(v_c)), 'los dos reportes esperan su validación');
  perform test.afirmar((select horas = 10 and personas = 2 from public.codigo_interno_avance(v_c) where trabajo = 'Soldadura de la tolva'),
    'la soldadura de hoy: 10 h de dos personas');

  -- Las compras, con en qué va cada una.
  perform test.afirmar((select count(*) from public.codigo_interno_compras(v_c)) = 1, 'una compra viva');
  perform test.afirmar((select monto = 55.5 and lineas = 2 and aprobacion = 'POR_APROBAR' from public.codigo_interno_compras(v_c)),
    'la compra de S/ 55.50 en dos líneas espera a Gerencia');

  -- Los documentos: los dos RQ (el anulado con su estado) y la unidad.
  perform test.afirmar((select count(*) from public.codigo_interno_documentos(v_c) where tipo = 'REQUERIMIENTO') = 2,
    'los dos requerimientos, el anulado también');
  perform test.afirmar((select count(*) from public.codigo_interno_documentos(v_c) where tipo = 'UNIDAD' and numero = 'CHK-344') = 1,
    'la unidad registrada con el código');
  perform test.afirmar((select count(*) from public.codigo_interno_documentos(v_c) where tipo = 'OT' and detalle = 'Tolva de prueba · check 344') = 1,
    'la OT de la unidad, que hoy es el único camino del código a la OT');

  -- Gerencia sigue sin leer el tareo ni el costo de cada persona.
  perform test.afirmar((select count(*) from public.tareos) = 0, 'Gerencia no lee el tareo');
  perform test.afirmar((select count(*) from public.trabajador_costos) = 0, 'Gerencia no lee el costo mensual de nadie');
  reset role;
end $$;

-- ================================= 3. EL AVANCE DICE EN QUÉ VA CADA REPORTE
do $$
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r_hoy')::uuid, 'GERENCIA');
  reset role;
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform public.validar_reporte_diario(current_setting('prueba.r_hoy')::uuid, 'RRHH');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select bool_and(estado = 'VALIDADO') from public.codigo_interno_avance(current_setting('prueba.codigo'))
                         where reporte_id = current_setting('prueba.r_hoy')::uuid),
    'validado por las dos áreas, el reporte de hoy sale validado');

  -- Si RR. HH. le pone costo a Ana, sus horas entran solas a la mano de obra.
  reset role;
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  set local role authenticated;
  perform public.rrhh_guardar_costo_trabajador(current_setting('prueba.t2')::uuid, 1200);
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select mano_obra = 140 and horas_sin_costo = 0 from public.codigos_internos_resumen()
                         where codigo = current_setting('prueba.codigo')),
    'con su costo, las 4 h de Ana (S/ 5 la hora) entran a la mano de obra: 120 + 20');
  reset role;
end $$;

\echo '✔ 344 · Gerencia ve cada código interno con su avance y su costeo'
rollback;
