-- Las mejoras de Almacén del 20/11/2026 (migraciones 20261120400000, 410000 y
-- 420000):
--
--   1. Cada insumo de un RQ de unidad se mide contra el metrado de Diseño, menos
--      lo pedido antes. El que se pasa espera el sustento de quien pidió y el
--      visto de Diseño; Almacén no revisa el RQ, Logística no lo compra y
--      Almacén no lo entrega hasta entonces. PLANTA, la OT de garantía y los RQ
--      de antes no se miden.
--   2. La salida de un insumo es del material pedido o del comprado para él; la
--      materia prima y los accesorios no salen sin RQ, salvo por la planilla sin
--      internet.
--   3. La compra por mayor y la lista de reposición; el aviso de stock bajo dice
--      cuánto comprar.
--   4. Gerencia ve lo que hay y lo que viene en otras OC al aprobar.
--   5. El supervisor que pide por unidad (20261120300000) sustenta los suyos y
--      no los de otro supervisor.
--
-- Cada paso con el puesto que lo hace —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000457', 'PRUEBAS 457 S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid; v_und uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'COMPRADOR:LOG', 'DISENO:DIS', 'GERENTE:GGE', 'VENDEDOR:GCO'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.457@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 457', lower(replace(v, ':', '.')) || '.457@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', v_und::text, true);
  foreach v in array array['rq1', 'rq2', 'rq3', 'rq4', 'rq5', 'rqp', 'rqot', 'oc1', 'oc2', 's1', 's2', 's3', 's4', 's5'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  -- Dos planchas, un faro y un disco, con stock.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK457-PLA', 'Plancha LAF 3 mm (prueba 457)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1), v_und),
    ('CHK457-PL6', 'Plancha LAF 6 mm (prueba 457)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1), v_und),
    ('CHK457-FAR', 'Faro LED (prueba 457)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1), v_und),
    ('CHK457-DIS', 'Disco de corte (prueba 457)',
     (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1), v_und);
  foreach v in array array['PLA', 'PL6', 'FAR', 'DIS'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.materiales where codigo = 'CHK457-' || v), true);
  end loop;
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.' || x.m)::uuid, x.c, 'INGRESO_GENERAL', 'GR 457-' || x.m,
         current_setting('prueba.almacenero')::uuid
    from (values ('pla', 20), ('pl6', 20), ('far', 5), ('dis', 12)) x(m, c);

  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20100045711', 'Proveedor de prueba 457', 'Av. Argentina 457, Lima', '999 457 457')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);

  -- Las fotos de las salidas, ya subidas por Almacén.
  foreach v in array array['s1', 's2', 's3', 's4', 's5'] loop
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.' || v) || '.jpg',
            current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
  end loop;

  -- Un RQ de antes de la regla, del mismo código: cuenta como pedido y no se mide.
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por, con_metrado, creado_en)
  values (gen_random_uuid(), 'RQ-CHK457-ANT', current_setting('prueba.area_mtz')::uuid, 'CHK_457_U1',
          'Pedido de antes de la regla del metrado', current_setting('prueba.requerimientos')::uuid, false, now() - interval '2 days')
  returning id::text into v;
  perform set_config('prueba.rq_antes', v, true);
  insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id, material_id)
  select v::uuid, 1, m.descripcion, 2, m.unidad_medida_id, m.categoria_id, m.id from public.materiales m where m.codigo = 'CHK457-PLA';
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
create or replace function pg_temp.linea(p_material text, p_cantidad numeric) returns jsonb language sql as $$
  select jsonb_build_object('material_id', current_setting('prueba.' || p_material), 'cantidad', p_cantidad);
$$;
-- El estado de un insumo, leído como lo lee la pantalla.
create or replace function pg_temp.estado(p_rq text, p_item int) returns text language sql as $$
  select estado from public.metrado_de_requerimientos(array[current_setting('prueba.' || p_rq)::uuid]) where item = p_item;
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns int language sql as $$
  select count(*)::int from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_clave)::uuid and titulo like p_titulo;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Diseño carga el metrado: 10 planchas de 3 mm para la unidad -----------------------
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.guardar_material_codigo(null, 'chk_457_u1', pg_temp.id('pla'), 10, null, 'Metrado del plano de piso');
end $$;
reset role;

-- Requerimientos pide -----------------------------------------------------------------
select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v text;
begin
  -- RQ1: 6 planchas (2 de antes + 6 = 8 de 10) y 5 discos (consumible, sin metrado).
  perform public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_457_U1',
    'Planchas y discos para el piso de la unidad', null, jsonb_build_array(pg_temp.linea('pla', 6), pg_temp.linea('dis', 5)));
  -- RQ2: 5 planchas (8 + 5 = 13: se pasa en 3) y 2 faros (no están en el metrado).
  perform public.emitir_requerimiento(pg_temp.id('rq2'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_457_U1',
    'Más planchas y los faros de la unidad', null, jsonb_build_array(pg_temp.linea('pla', 5), pg_temp.linea('far', 2)));
  -- RQ3: un faro más, solo.
  perform public.emitir_requerimiento(pg_temp.id('rq3'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_457_U1',
    'Un faro de repuesto para la unidad', null, jsonb_build_array(pg_temp.linea('far', 1)));
  -- PLANTA y la OT de garantía no se miden.
  perform public.emitir_requerimiento(pg_temp.id('rqp'), 'OPERACION', pg_temp.id('area_mtz'), 'PLANTA',
    'Planchas para una mesa de trabajo', null, jsonb_build_array(pg_temp.linea('pla', 4)));
  perform public.emitir_requerimiento(pg_temp.id('rqot'), 'OPERACION', pg_temp.id('area_mtz'), 'OT 2939-2026',
    'Faro para la garantía de la unidad', null, jsonb_build_array(pg_temp.linea('far', 1)));

  perform test.afirmar(pg_temp.estado('rq1', 1) = 'EN_METRADO', 'RQ1: 2 de antes + 6 entra en las 10 del metrado');
  perform test.afirmar(pg_temp.estado('rq1', 2) = 'NO_APLICA', 'RQ1: el disco no está en el metrado y es consumible: no se mide');
  perform test.afirmar(pg_temp.estado('rq2', 1) = 'SIN_SUSTENTO', 'RQ2: la plancha se pasa y espera su sustento');
  perform test.afirmar((select exceso from public.metrado_de_requerimientos(array[pg_temp.id('rq2')]) where item = 1) = 3
                       and (select pedido_antes from public.metrado_de_requerimientos(array[pg_temp.id('rq2')]) where item = 1) = 8,
                       'RQ2: lo pedido antes es 8 (el RQ de antes y el RQ1) y se pasa en 3');
  perform test.afirmar(pg_temp.estado('rq2', 2) = 'SIN_SUSTENTO'
                       and (select exceso from public.metrado_de_requerimientos(array[pg_temp.id('rq2')]) where item = 2) = 2,
                       'RQ2: el faro no está en el metrado y se pasa entero');
  perform test.afirmar(pg_temp.estado('rqp', 1) = 'NO_APLICA', 'PLANTA no se mide');
  perform test.afirmar(pg_temp.estado('rqot', 1) = 'NO_APLICA', 'La OT de garantía no se mide');
  perform test.afirmar(pg_temp.estado('rq_antes', 1) = 'NO_APLICA', 'El RQ de antes de la regla no se mide');

  -- El sustento: corto no entra; el de un insumo que entra en el metrado, tampoco.
  begin
    perform public.sustentar_insumos(pg_temp.id('rq2'), '[{"item": 1, "sustento": "corto"}]');
    raise exception 'FALLA: entró un sustento de menos de 10 caracteres';
  exception when check_violation then null;
  end;
  begin
    perform public.sustentar_insumos(pg_temp.id('rq1'), '[{"item": 1, "sustento": "Hace falta más plancha para el piso"}]');
    raise exception 'FALLA: se sustentó un insumo que entra en el metrado';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%entra en el metrado%', 'Lo que entra en el metrado no se sustenta');
  end;
  perform public.sustentar_insumos(pg_temp.id('rq2'),
    '[{"item": 1, "sustento": "El plano de piso se corrigió: van tres planchas más en el refuerzo"}]');
  perform test.afirmar(pg_temp.estado('rq2', 1) = 'POR_AUTORIZAR' and pg_temp.estado('rq2', 2) = 'SIN_SUSTENTO',
                       'Sustentada la plancha, espera a Diseño; el faro sigue sin sustento');
  perform public.sustentar_insumos(pg_temp.id('rq3'), '[{"item": 1, "sustento": "Repuesto por el faro que llegó roto"}]');
end $$;
reset role;

select test.afirmar(pg_temp.avisos('diseno', 'Por autorizar: %') = 2, 'A Diseño le llegó un aviso por cada RQ sustentado');

-- Almacén no revisa lo que se pasa sin visto, ni sustenta por otro ----------------------
select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  perform public.rq_revisar_stock(pg_temp.id('rq1'), '[{"item": 1, "en_stock": 6}, {"item": 2, "en_stock": 5}]', null);
  perform test.afirmar((select estado from public.requerimientos where id = pg_temp.id('rq1')) = 'LISTO_EN_ALMACEN',
                       'El RQ1, en el metrado, se revisa como siempre');
  begin
    perform public.rq_revisar_stock(pg_temp.id('rq2'), '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 2}]', null);
    raise exception 'FALLA: Almacén revisó un RQ que se pasa del metrado sin visto';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%metrado de Diseño (insumo 1, 2)%', 'Almacén no revisa el RQ2 y el mensaje dice qué insumos');
  end;
  begin
    perform public.rq_marcar_sin_stock(pg_temp.id('rq2'), null);
    raise exception 'FALLA: la marca vieja «sin stock» saltó la regla';
  exception when check_violation then null;
  end;
  begin
    perform public.sustentar_insumos(pg_temp.id('rq2'), '[{"item": 2, "sustento": "Almacén no sustenta lo que pidió otro"}]');
    raise exception 'FALLA: Almacén sustentó el insumo de otra área';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.autorizar_insumos(pg_temp.id('rq2'), '{1}', true, null);
    raise exception 'FALLA: Almacén autorizó un insumo';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Ventas no ve nada de esto --------------------------------------------------------------
select pg_temp.como('vendedor');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.requerimiento_sustentos) = 0, 'Ventas no lee los sustentos');
  begin
    perform public.metrado_de_requerimientos(array[pg_temp.id('rq2')]);
    raise exception 'FALLA: Ventas leyó el metrado de un RQ';
  exception when insufficient_privilege then null;
  end;
  perform test.afirmar((select count(*) from public.requerimientos_por_autorizar()) = 0, 'Ventas no tiene nada por autorizar');
end $$;
reset role;

-- Diseño da su visto -----------------------------------------------------------------------
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.requerimientos_por_autorizar()) = 2, 'Diseño ve dos RQ por autorizar');
  perform test.afirmar((select count(*) from public.requerimiento_sustentos) = 2, 'Diseño lee los sustentos');
  begin
    perform public.autorizar_insumos(pg_temp.id('rq2'), '{2}', true, null);
    raise exception 'FALLA: Diseño autorizó un insumo sin sustento';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%ya no espera tu visto%', 'Lo que no tiene sustento no se autoriza');
  end;
  perform public.autorizar_insumos(pg_temp.id('rq2'), '{1}', true, 'Va con la revisión del plano de piso');
  perform test.afirmar(pg_temp.estado('rq2', 1) = 'AUTORIZADO', 'La plancha del RQ2 quedó autorizada');
  begin
    perform public.autorizar_insumos(pg_temp.id('rq3'), '{1}', false, 'no');
    raise exception 'FALLA: Diseño dijo que no sin decir por qué';
  exception when check_violation then null;
  end;
  perform public.autorizar_insumos(pg_temp.id('rq3'), '{1}', true, null);
  begin
    update public.requerimiento_sustentos set sustento = 'Cambiado por Diseño a mano' where decision is not null;
    raise exception 'FALLA: Diseño cambió un sustento a mano';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select test.afirmar(pg_temp.avisos('requerimientos', 'Autorizado: %') = 2, 'A quien pidió le llegó el visto de cada RQ');
select test.afirmar(pg_temp.avisos('almacenero', 'Ya puedes revisar: %') = 1,
                    'A Almacén le llegó «Ya puedes revisar» solo del RQ3, que quedó en regla; el RQ2 sigue con el faro');

-- El faro del RQ2: Diseño dice que no, y después lo mete en el metrado -----------------------
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.sustentar_insumos(pg_temp.id('rq2'), '[{"item": 2, "sustento": "Los faros van en la parte trasera según el cliente"}]');
end $$;
reset role;
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.autorizar_insumos(pg_temp.id('rq2'), '{2}', false, 'Falta ver el plano eléctrico antes de pedirlos');
  perform test.afirmar(pg_temp.estado('rq2', 2) = 'RECHAZADO', 'El faro quedó sin autorizar, con su nota');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('requerimientos', 'No autorizado: %') = 1, 'A quien pidió le llegó el «no» con su nota');

select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  begin
    perform public.rq_revisar_stock(pg_temp.id('rq2'), '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 2}]', null);
    raise exception 'FALLA: Almacén revisó con el faro rechazado';
  exception when check_violation then null;
  end;
end $$;
reset role;

select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.guardar_material_codigo(null, 'CHK_457_U1', pg_temp.id('far'), 4, null, 'Faros del plano eléctrico');
  perform test.afirmar(pg_temp.estado('rq2', 2) = 'EN_METRADO', 'Con el faro en el metrado, el insumo entra solo');
  perform test.afirmar(pg_temp.estado('rq3', 1) = 'EN_METRADO', 'Y el del RQ3 también (2 + 1 de 4)');
end $$;
reset role;

-- Almacén revisa y entrega lo que pidió el RQ -----------------------------------------------------
select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare v_uid text := auth.uid()::text; v_linea uuid;
begin
  perform public.rq_revisar_stock(pg_temp.id('rq2'), '[{"item": 1, "en_stock": 5}, {"item": 2, "en_stock": 2}]', null);
  perform test.afirmar((select estado from public.requerimientos where id = pg_temp.id('rq2')) = 'LISTO_EN_ALMACEN',
                       'Autorizado y en el metrado, Almacén revisa el RQ2');
  select id into v_linea from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq1') and item = 1;
  -- Otra plancha del mismo almacén contra el insumo de 3 mm: no sale.
  begin
    perform public.registrar_salida_material(pg_temp.id('s1'), pg_temp.id('pl6'), 2, null, null, 'Salida de prueba 457',
      'Persona de prueba', v_uid || '/' || current_setting('prueba.s1') || '.jpg', v_linea);
    raise exception 'FALLA: salió la plancha de 6 mm contra el pedido de 3 mm';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%sale ese material o el que se compró para él%', 'Sale lo pedido, no otro del mismo almacén');
  end;
  perform public.registrar_salida_material(pg_temp.id('s2'), pg_temp.id('pla'), 2, null, null, 'Salida de prueba 457',
    'Persona de prueba', v_uid || '/' || current_setting('prueba.s2') || '.jpg', v_linea);
  -- Materia prima y accesorio sin RQ: no salen. El disco sí.
  begin
    perform public.registrar_salida_material(pg_temp.id('s3'), pg_temp.id('pl6'), 1, null, 'CHK_457_U1', 'Salida sin RQ 457',
      'Persona de prueba', v_uid || '/' || current_setting('prueba.s3') || '.jpg', null);
    raise exception 'FALLA: salió materia prima sin RQ';
  exception when check_violation then
    perform test.afirmar(sqlerrm like 'La materia prima sale solo con el requerimiento%', 'La materia prima no sale sin RQ');
  end;
  begin
    perform public.registrar_salida_material(pg_temp.id('s4'), pg_temp.id('far'), 1, null, 'CHK_457_U1', 'Salida sin RQ 457',
      'Persona de prueba', v_uid || '/' || current_setting('prueba.s4') || '.jpg', null);
    raise exception 'FALLA: salió un accesorio sin RQ';
  exception when check_violation then null;
  end;
  perform public.registrar_salida_material(pg_temp.id('s5'), pg_temp.id('dis'), 1, null, 'CHK_457_U1', 'Salida sin RQ 457',
    'Persona de prueba', v_uid || '/' || current_setting('prueba.s5') || '.jpg', null);
end $$;
reset role;

-- La planilla sin internet sí anota la materia prima que ya salió (la marca de la función).
do $$
declare v_id uuid := gen_random_uuid();
begin
  perform set_config('metalwork.desde_planilla', 'si', true);
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, cantidad_de_stock)
  values (v_id, 'SALIDA', pg_temp.id('pl6'), 1, 'SALIDA_GENERAL', 'Vale 457', pg_temp.id('almacenero'), 'Persona de prueba',
          'CHK_457_U1', 1);
  perform set_config('metalwork.desde_planilla', '', true);
  perform test.afirmar(exists (select 1 from public.movimientos_materiales where id = v_id), 'La planilla sin internet anota la salida');
end $$;
select test.afirmar(position('set_config(''metalwork.desde_planilla'', ''si'', true)' in prosrc) > 0,
                    'registrar_salida_planilla pone la marca de la planilla')
  from pg_proc where proname = 'registrar_salida_planilla';

-- Logística no compra lo que se pasó después de la revisión ---------------------------------------
-- RQ4: 1 faro, en el metrado (3 de 4), con el almacén sin faros libres: va a compra.
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.emitir_requerimiento(pg_temp.id('rq4'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_457_U1',
    'Un faro más para la unidad', null, jsonb_build_array(pg_temp.linea('far', 1)));
  perform test.afirmar(pg_temp.estado('rq4', 1) = 'EN_METRADO', 'RQ4: 2 + 1 + 1 = 4 de 4');
end $$;
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  perform public.rq_revisar_stock(pg_temp.id('rq4'), '[{"item": 1, "en_stock": 0}]', null);
end $$;
reset role;
-- Diseño baja el metrado del faro a 3: el RQ4 queda pasado.
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.guardar_material_codigo((select id from public.codigo_materiales where codigo_interno = 'CHK_457_U1'
                                            and material_id = pg_temp.id('far') and quitado_en is null),
                                         null, pg_temp.id('far'), 3, null, 'Se corrigió el plano eléctrico');
  perform test.afirmar(pg_temp.estado('rq4', 1) = 'SIN_SUSTENTO', 'Con el metrado más bajo, el RQ4 se pasa');
end $$;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
do $$ begin
  begin
    perform public.emitir_compra_del_requerimiento(pg_temp.id('oc1'), pg_temp.id('rq4'), null, pg_temp.id('proveedor'), null,
      jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('far'), 'cantidad', 1, 'precio', 80)),
      null, 'CONTADO', 0, 'PEN', true);
    raise exception 'FALLA: Logística compró un insumo que se pasa del metrado';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%no va en la orden de compra%', 'Logística no compra lo que se pasa sin visto');
  end;
end $$;
reset role;

-- Un insumo nuevo, pedido sin material: el visto que Diseño da por su descripción
-- sigue valiendo cuando Almacén lo asocia al material del catálogo al revisar ------
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.emitir_requerimiento(pg_temp.id('rq5'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_457_U1',
    'Una plancha que no está en el catálogo', null,
    jsonb_build_array(jsonb_build_object('descripcion', 'Plancha estriada 1/8 (prueba 457)', 'cantidad', 2,
      'unidad_medida_id', current_setting('prueba.und'),
      'categoria_id', (select categoria_id from public.materiales where id = pg_temp.id('pl6')))));
  perform test.afirmar(pg_temp.estado('rq5', 1) = 'SIN_SUSTENTO', 'El insumo nuevo de materia prima no está en el metrado: se pasa entero');
  perform public.sustentar_insumos(pg_temp.id('rq5'),
    '[{"item": 1, "sustento": "La rampa lleva plancha estriada y no está en el metrado"}]');
end $$;
reset role;
select pg_temp.como('diseno');
set local role authenticated;
select public.autorizar_insumos(pg_temp.id('rq5'), '{1}', true, null);
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  perform public.rq_revisar_stock(pg_temp.id('rq5'),
    format('[{"item": 1, "en_stock": 2, "material_id": "%s"}]', pg_temp.id('pl6'))::jsonb, null);
  perform test.afirmar((select estado from public.requerimientos where id = pg_temp.id('rq5')) = 'LISTO_EN_ALMACEN'
                       and pg_temp.estado('rq5', 1) = 'AUTORIZADO',
                       'Almacén asocia el insumo nuevo a la plancha del catálogo al revisar, y el visto sigue valiendo');
end $$;
reset role;

-- con_metrado no cambia -------------------------------------------------------------------------
do $$ begin
  begin
    update public.requerimientos set con_metrado = false where id = pg_temp.id('rq4');
    raise exception 'FALLA: se le quitó la regla a un RQ';
  exception when check_violation then null;
  end;
end $$;

-- Reposición: Almacén fija mínimo y compra por mayor; Logística la ve ----------------------------
select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  perform public.fijar_stock_de_seguridad(pg_temp.id('dis'), 20, 50);
  begin
    perform public.fijar_stock_de_seguridad(pg_temp.id('dis'), 20, 0);
    raise exception 'FALLA: entró una compra por mayor de cero';
  exception when check_violation then null;
  end;
end $$;
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
do $$ begin
  begin
    perform public.fijar_stock_de_seguridad(pg_temp.id('dis'), 1, null);
    raise exception 'FALLA: Ventas fijó un mínimo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reposicion_de_stock();
    raise exception 'FALLA: Ventas vio la reposición';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.como('comprador');
set local role authenticated;
do $$
declare r record;
begin
  -- 12 discos, salió 1: quedan 11, mínimo 20, sin nada en camino: se compran 50 (por mayor).
  select * into r from public.reposicion_de_stock() where material_id = pg_temp.id('dis');
  perform test.afirmar(r.existencia = 11 and r.stock_minimo = 20 and r.compra_por_mayor = 50 and r.en_camino = 0
                       and r.salio_90_dias = 1 and r.comprar = 50,
                       format('Logística ve el disco: quedan %s, mínimo %s, salió %s, comprar %s', r.existencia, r.stock_minimo, r.salio_90_dias, r.comprar));
  -- Una OC directa de 30 discos: ya vienen en camino.
  perform public.emitir_compra_directa(pg_temp.id('oc2'), pg_temp.id('proveedor'), null, 'Reposición de discos de corte',
    jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('dis'), 'cantidad', 30, 'precio', 3.5)),
    null, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  select * into r from public.reposicion_de_stock() where material_id = pg_temp.id('dis');
  perform test.afirmar(r.en_camino = 30 and r.comprar = 0 and r.en_camino_ocs is not null,
                       'Con 30 en camino ya no pide comprar, y dice en qué OC vienen');
end $$;
reset role;

-- Gerencia ve lo que hay y lo que viene al aprobar --------------------------------------------------
select pg_temp.como('gerente');
set local role authenticated;
do $$
declare r record;
begin
  select * into r from public.stock_al_aprobar_compras(array[pg_temp.id('oc2')]) where material_id = pg_temp.id('dis');
  perform test.afirmar(r.existencia = 11 and r.en_camino = 0,
                       'Al aprobar la OC de discos: hay 11 y no viene nada en otras OC (la propia no cuenta)');
end $$;
reset role;

-- El aviso de stock bajo dice cuánto comprar ---------------------------------------------------------
select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  perform public.fijar_stock_de_seguridad(pg_temp.id('pla'), 15, 40);
end $$;
reset role;
-- 20 planchas, salieron 2: quedan 18. Una salida de 4 cruza el mínimo de 15.
do $$ begin
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, cantidad_de_stock, requerimiento_linea_id)
  values (gen_random_uuid(), 'SALIDA', pg_temp.id('pla'), 4, 'SALIDA_GENERAL', 'Vale 457-2', pg_temp.id('almacenero'),
          'Persona de prueba', 'CHK_457_U1', 4,
          (select id from public.requerimiento_lineas where requerimiento_id = pg_temp.id('rq1') and item = 1));
  perform test.afirmar(exists (select 1 from public.notificaciones
                                where usuario_id = pg_temp.id('comprador') and titulo = 'Stock bajo: CHK457-PLA'
                                  and cuerpo like '%Se compra por mayor: 40.%' and ruta = '/almacen/reposicion'),
                       'Logística recibe el aviso con la compra por mayor y la lista de reposición');
end $$;


-- El supervisor que pide por unidad sustenta los suyos, no los de otro ---------------------------
do $$
declare v text; v_id uuid;
begin
  -- Una sola supervisión activa por área: la que hubiera se aparta mientras dura la prueba.
  set local session_replication_role = replica;
  update public.usuarios u set activo = false
   where u.activo and u.rol_id = (select id from public.roles where codigo = 'SUPERVISOR')
     and u.area_id in (select id from public.areas where codigo in ('MTZ', 'ACB'));
  set local session_replication_role = origin;
  foreach v in array array['MTZ', 'ACB'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, 'sup.' || lower(v) || '.457@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, 'SUPERVISOR ' || v, 'Check 457', 'sup.' || lower(v) || '.457@prueba.local', r.id,
           (select id from public.areas where codigo = v)
      from public.roles r where r.codigo = 'SUPERVISOR';
    perform set_config('prueba.sup_' || lower(v), v_id::text, true);
  end loop;
  perform set_config('prueba.rqsup', gen_random_uuid()::text, true);
end $$;
select pg_temp.como('sup_mtz');
set local role authenticated;
do $$ begin
  -- 2 de antes + 6 + 5 = 13 de 10: dos planchas más se pasan enteras.
  perform public.emitir_requerimiento(pg_temp.id('rqsup'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_457_U1',
    'Planchas para el refuerzo del piso, pedidas por el supervisor', null, jsonb_build_array(pg_temp.linea('pla', 2)));
  perform test.afirmar(pg_temp.estado('rqsup', 1) = 'SIN_SUSTENTO', 'El RQ del supervisor también se mide contra el metrado');
end $$;
reset role;
select pg_temp.como('sup_acb');
set local role authenticated;
do $$ begin
  begin
    perform public.sustentar_insumos(pg_temp.id('rqsup'), '[{"item": 1, "sustento": "Acabados no sustenta lo que pidió Maestranza"}]');
    raise exception 'FALLA: el supervisor de otra área sustentó el RQ de Maestranza';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
do $$ begin
  perform public.sustentar_insumos(pg_temp.id('rqsup'), '[{"item": 1, "sustento": "El refuerzo del piso lleva dos planchas más que el plano"}]');
  perform test.afirmar(pg_temp.estado('rqsup', 1) = 'POR_AUTORIZAR', 'El supervisor sustentó el suyo y espera a Diseño');
end $$;
reset role;

rollback;
