-- El supervisor sigue cada insumo de su RQ (migración 20261126332000; Plan 1,
-- entrega 1.2).
--
--   1. `seguimiento_de_insumos` da de cada insumo el visto de Diseño cuando se
--      pasa del metrado (sin sustento, por autorizar, autorizado), la fecha en
--      que se espera su compra y quién lo recibió del almacén y cuándo.
--   2. De la compra, solo la fecha: la función no tiene columna de proveedor ni
--      de precio, y la OC rechazada no da fecha.
--   3. Solo los RQ del área de quien mira: el supervisor de Acabados no recibe
--      los de Maestranza aunque los pida por id; Administración recibe el RQA
--      aunque su cuenta no tenga área, y no los de operación; Ventas no entra.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA474', 'Taller prueba de insumos') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid; v_und uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  foreach v in array array['SUPERVISOR:MTZ:sup_mtz', 'SUPERVISOR:ACB:sup_acb', 'REQUERIMIENTOS:REQ:requerimientos',
                           'DISENO:DIS:diseno', 'ADMINISTRACION:ADM:adm', 'VENDEDOR:GCO:ven'] loop
    v_id := test.crear_usuario('Nombre' || split_part(v, ':', 3), 'Apellido474', split_part(v, ':', 3) || '.474@prueba.local',
                               split_part(v, ':', 1), (select id from public.sedes where codigo = 'QA474'));
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
    perform set_config('prueba.area_' || split_part(v, ':', 3), split_part(v, ':', 2), true);
  end loop;
  foreach v in array array['rq1', 'rq2', 'racb', 'rqa', 'oc', 'oc_rechazada'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id from public.areas where codigo = 'MTZ')::text, true);
  perform set_config('prueba.area_acb', (select id from public.areas where codigo = 'ACB')::text, true);

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK474-PLA', 'Plancha LAF 3 mm (prueba 474)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1), v_und);
  perform set_config('prueba.pla', (select id::text from public.materiales where codigo = 'CHK474-PLA'), true);
end $$;

-- El área de cada cuenta, sin el disparador que solo deja cambiarla a Administración.
-- Administración queda sin área: el RQA lo sigue igual.
set local session_replication_role = replica;
update public.usuarios u set area_id = case when split_part(u.correo, '.474@', 1) = 'adm' then null else a.id end
  from public.areas a
 where u.correo like '%.474@prueba.local'
   and a.codigo = current_setting('prueba.area_' || split_part(u.correo, '.474@', 1));
set local session_replication_role = origin;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
-- Lo que da la función para los cuatro RQ, como texto: «rq1/1», «rq2/1»…
create or replace function pg_temp.que_ve() returns text language sql as $$
  select coalesce(string_agg(x.cual, ' ' order by x.cual), '(nada)')
    from (select case s.requerimiento_id
                   when current_setting('prueba.rq1')::uuid then 'rq1'
                   when current_setting('prueba.rq2')::uuid then 'rq2'
                   when current_setting('prueba.racb')::uuid then 'racb'
                   when current_setting('prueba.rqa')::uuid then 'rqa'
                 end || '/' || s.item as cual
            from public.seguimiento_de_insumos(array[current_setting('prueba.rq1')::uuid, current_setting('prueba.rq2')::uuid,
                                                     current_setting('prueba.racb')::uuid, current_setting('prueba.rqa')::uuid]) s) x;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Diseño metra 10 planchas para la unidad.
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.guardar_material_codigo(null, 'chk_474_u1', pg_temp.id('pla'), 10, null, 'Metrado del plano de piso');
end $$;
reset role;

-- Requerimientos registra: rq1 entra en el metrado (4), rq2 se pasa (4 + 8 = 12);
-- racb es de Acabados y rqa, de Administración.
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.emitir_requerimiento(pg_temp.id('rq1'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_474_U1',
    'Planchas para el piso de la unidad', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 4)));
  perform public.emitir_requerimiento(pg_temp.id('rq2'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_474_U1',
    'Más planchas para el refuerzo del piso', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 8)));
  perform public.emitir_requerimiento(pg_temp.id('racb'), 'OPERACION', pg_temp.id('area_acb'), 'PLANTA',
    'Planchas para una mesa de Acabados', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 2)));
  perform public.emitir_requerimiento(pg_temp.id('rqa'), 'OPERACION', pg_temp.id('area_mtz'), 'PLANTA',
    'Planchas para la oficina', null, jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('pla'), 'cantidad', 1)));
end $$;
reset role;

-- El RQA es de Administración: se le cambia el tipo y el área sin disparadores, es el armazón.
set local session_replication_role = replica;
update public.requerimientos set tipo = 'ADMINISTRACION', area_id = (select id from public.areas where codigo = 'ADM') where id = pg_temp.id('rqa');
set local session_replication_role = origin;

-- 1. El visto de Diseño ----------------------------------------------------------
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select visto_diseno from public.seguimiento_de_insumos(array[pg_temp.id('rq1')])) is null,
  'el insumo que entra en el metrado no espera el visto de Diseño');
select test.afirmar((select visto_diseno from public.seguimiento_de_insumos(array[pg_temp.id('rq2')])) = 'SIN_SUSTENTO',
  'el que se pasa del metrado espera su sustento');
reset role;

select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.sustentar_insumos(pg_temp.id('rq2'), '[{"item": 1, "sustento": "El refuerzo del piso lleva dos planchas más que el plano"}]');
end $$;
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select visto_diseno from public.seguimiento_de_insumos(array[pg_temp.id('rq2')])) = 'POR_AUTORIZAR',
  'sustentado, espera a Diseño');
reset role;

select pg_temp.como('diseno');
set local role authenticated;
do $$ begin perform public.autorizar_insumos(pg_temp.id('rq2'), '{1}', true, null); end $$;
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select visto_diseno from public.seguimiento_de_insumos(array[pg_temp.id('rq2')])) = 'AUTORIZADO',
  'Diseño lo autorizó');
reset role;

-- 2. La compra: solo la fecha. Quién lo recibió ---------------------------------
-- rq1 va en una OC aprobada que se espera el 5 de diciembre; rq2, en una
-- rechazada. Del almacén salen dos partes de rq1, a dos personas.
set local session_replication_role = replica;
insert into public.ordenes_compra_materiales (id, requerimiento_id, proveedor, referencia, aprobacion, aprobado_por, aprobado_en,
                                              rechazado_por, rechazado_en, motivo_rechazo, creado_por, fecha_estimada)
values (pg_temp.id('oc'), pg_temp.id('rq1'), 'PROVEEDOR SECRETO 474 S.A.C.', 'OC-0474-MW', 'APROBADA', pg_temp.id('requerimientos'), now(),
        null, null, null, pg_temp.id('requerimientos'), date '2026-12-05'),
       (pg_temp.id('oc_rechazada'), pg_temp.id('rq2'), 'PROVEEDOR SECRETO 474 S.A.C.', 'OC-0475-MW', 'RECHAZADA', null, null,
        pg_temp.id('requerimientos'), now(), 'El precio no cuadra con la cotización', pg_temp.id('requerimientos'), date '2026-12-09');
update public.requerimiento_lineas set orden_compra_id = pg_temp.id('oc'), atendida_en = now(), atendida_por = pg_temp.id('requerimientos') where requerimiento_id = pg_temp.id('rq1');
update public.requerimiento_lineas set orden_compra_id = pg_temp.id('oc_rechazada'), atendida_en = now(), atendida_por = pg_temp.id('requerimientos') where requerimiento_id = pg_temp.id('rq2');
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           requerimiento_linea_id, codigo_unidad, registrado_por, registrado_en)
select gen_random_uuid(), 'SALIDA', pg_temp.id('pla'), x.cantidad, 'SALIDA_GENERAL', 'Salida 474', x.quien,
       (select l.id from public.requerimiento_lineas l where l.requerimiento_id = pg_temp.id('rq1') and l.item = 1),
       'CHK_474_U1', pg_temp.id('requerimientos'), x.en
  from (values (1, 'Juan Prueba', now() - interval '2 days'), (1, 'Rosa Prueba', now() - interval '1 day')) as x(cantidad, quien, en);
-- Una tercera salida volvió entera al almacén: quien la recibió ya no tiene nada.
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre,
                                           requerimiento_linea_id, codigo_unidad, registrado_por, registrado_en)
select '00000000-0000-4000-8000-000000000474', 'SALIDA', pg_temp.id('pla'), 1, 'SALIDA_GENERAL', 'Salida 474', 'Pedro Devolvió',
       l.id, 'CHK_474_U1', pg_temp.id('requerimientos'), now() - interval '3 days'
  from public.requerimiento_lineas l where l.requerimiento_id = pg_temp.id('rq1') and l.item = 1;
insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, devolucion_de,
                                           codigo_unidad, registrado_por, registrado_en)
values (gen_random_uuid(), 'INGRESO', pg_temp.id('pla'), 1, 'DEVOLUCION', 'Devolución 474', '00000000-0000-4000-8000-000000000474',
        'CHK_474_U1', pg_temp.id('requerimientos'), now() - interval '3 days');
set local session_replication_role = origin;

select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select fecha_esperada from public.seguimiento_de_insumos(array[pg_temp.id('rq1')])) = date '2026-12-05',
  'de la OC aprobada, la fecha en que se espera');
select test.afirmar((select fecha_esperada from public.seguimiento_de_insumos(array[pg_temp.id('rq2')])) is null,
  'la OC rechazada no da fecha');
select test.afirmar((select recibido_por = 'Juan Prueba, Rosa Prueba' and recibido_en > now() - interval '25 hours'
                       from public.seguimiento_de_insumos(array[pg_temp.id('rq1')])),
  'quién recibió el insumo del almacén y cuándo fue la última salida; la que volvió entera no cuenta');
reset role;

select test.afirmar(
  pg_get_function_result('public.seguimiento_de_insumos(uuid[])'::regprocedure) !~* '(proveedor|precio|monto|total|moneda)',
  'la función no tiene columna de proveedor ni de precio: ' || pg_get_function_result('public.seguimiento_de_insumos(uuid[])'::regprocedure));

-- 3. Solo lo de su área -----------------------------------------------------------
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.que_ve() = 'rq1/1 rq2/1', 'el supervisor de Maestranza sigue solo los de su área: ' || pg_temp.que_ve());
reset role;
select pg_temp.como('sup_acb');
set local role authenticated;
select test.afirmar(pg_temp.que_ve() = 'racb/1', 'el de Acabados, solo el suyo, aunque pida los de Maestranza: ' || pg_temp.que_ve());
reset role;
select pg_temp.como('adm');
set local role authenticated;
select test.afirmar(pg_temp.que_ve() = 'rqa/1', 'Administración, sin área, sigue el RQA y no los de operación: ' || pg_temp.que_ve());
reset role;
select pg_temp.como('ven');
set local role authenticated;
select test.debe_fallar($q$select * from public.seguimiento_de_insumos(array[gen_random_uuid()])$q$,
  'Ventas no sigue insumos de nadie');
reset role;

rollback;
