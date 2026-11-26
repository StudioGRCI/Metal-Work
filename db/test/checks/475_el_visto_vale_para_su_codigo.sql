-- El visto de Diseño vale para su código, y el sustento que no cambió conserva
-- sus días (migración 20261126920000, Plan 6, entrega 6.2). Dos fallas del
-- metrado que encontró la revisión del Plan 0:
--
--   1. Diseño autorizaba un insumo contra el metrado de un código, el RQ pasaba
--      a otro código que también se pasa del metrado, y Almacén lo revisaba con
--      el visto del código de antes.
--   2. «Corregir el sustento» reenvía todos los insumos que esperan a Diseño, y
--      cada uno volvía a la hora de hoy aunque su texto no cambiara: sus días
--      en espera volvían a cero, y a Diseño le llegaba otro aviso.
--
-- Cada paso con el puesto que lo hace —nunca ADMIN— y `set local role
-- authenticated`. El cambio de código lo hace la corrección del RQ
-- (`corregir_requerimiento`, con su justificante, check 382); aquí se escribe
-- directo porque lo que se prueba es el metrado, y el disparador que anota
-- `codigo_desde` corre igual. Todo pasa en una transacción, así que «hace unos
-- días» se simula corriendo las horas hacia atrás: el sustento toma la hora de
-- la transacción y el código la del reloj. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000475', 'PRUEBAS 475 S.A.C.' where not exists (select 1 from public.empresa);

do $$
declare v text; v_id uuid; v_und uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'ALMACENERO:ALM', 'DISENO:DIS'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.475@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 475', lower(replace(v, ':', '.')) || '.475@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  foreach v in array array['rqa', 'rqb', 'rqc', 'rqd', 'rqlleno'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id) values
    ('CHK475-PLA', 'Plancha LAF 3 mm (prueba 475)',
     (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1), v_und),
    ('CHK475-FAR', 'Faro LED (prueba 475)',
     (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1), v_und);
  foreach v in array array['PLA', 'FAR'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.materiales where codigo = 'CHK475-' || v), true);
  end loop;
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', current_setting('prueba.' || x.m)::uuid, x.c, 'INGRESO_GENERAL', 'GR 475-' || x.m,
         current_setting('prueba.almacenero')::uuid
    from (values ('pla', 40), ('far', 5)) x(m, c);
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
create or replace function pg_temp.estado(p_rq text, p_item int) returns text language sql as $$
  select estado from public.metrado_de_requerimientos(array[current_setting('prueba.' || p_rq)::uuid]) where item = p_item;
$$;
-- Lo cuenta quien corre el check: la cuenta que sustenta no lee los avisos de Diseño.
create or replace function pg_temp.avisos_a_diseno() returns int language sql security definer as $$
  select count(*)::int from public.notificaciones
   where usuario_id = current_setting('prueba.diseno')::uuid and titulo like 'Por autorizar: %';
$$;
create or replace function pg_temp.avisos_a_diseno_que_dicen(p_cuerpo text) returns int language sql security definer as $$
  select count(*)::int from public.notificaciones
   where usuario_id = current_setting('prueba.diseno')::uuid and titulo like 'Por autorizar: %' and cuerpo like p_cuerpo;
$$;
-- El sustento vigente de un insumo (el que espera o el último que se decidió).
create or replace function pg_temp.sustentado_en(p_rq text, p_item int) returns timestamptz language sql as $$
  select s.sustentado_en from public.requerimiento_sustentos s
    join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
   where l.requerimiento_id = current_setting('prueba.' || p_rq)::uuid and l.item = p_item
   order by s.sustentado_en desc, s.creado_en desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Diseño carga los metrados ----------------------------------------------------------------
--   U1: 10 planchas. U2: 4 planchas. U3: 30 planchas. U4: 2 planchas (el faro no está).
select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  perform public.guardar_material_codigo(null, 'chk_475_u1', pg_temp.id('pla'), 10, null, 'Metrado del plano de piso');
  perform public.guardar_material_codigo(null, 'chk_475_u2', pg_temp.id('pla'), 4, null, 'Metrado del plano de piso');
  perform public.guardar_material_codigo(null, 'chk_475_u3', pg_temp.id('pla'), 30, null, 'Metrado del plano de piso');
  perform public.guardar_material_codigo(null, 'chk_475_u4', pg_temp.id('pla'), 2, null, 'Metrado del plano de piso');
end $$;
reset role;

-- Requerimientos pide ------------------------------------------------------------------------
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  -- U2 ya tiene pedidas sus 4 planchas.
  perform public.emitir_requerimiento(pg_temp.id('rqlleno'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_475_U2',
    'Las planchas del metrado de la unidad', null, jsonb_build_array(pg_temp.linea('pla', 4)));
  -- RQA: 12 planchas en U1 (se pasa en 2). RQC: 11 en U1 (se pasa: ya hay 12
  -- pedidas). RQD: 1 en U1 (se pasa: ya hay 23).
  perform public.emitir_requerimiento(pg_temp.id('rqa'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_475_U1',
    'Planchas para el piso y el refuerzo', null, jsonb_build_array(pg_temp.linea('pla', 12)));
  perform public.emitir_requerimiento(pg_temp.id('rqc'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_475_U1',
    'Planchas para las barandas de la unidad', null, jsonb_build_array(pg_temp.linea('pla', 11)));
  perform public.emitir_requerimiento(pg_temp.id('rqd'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_475_U1',
    'Una plancha para la tapa de la caja', null, jsonb_build_array(pg_temp.linea('pla', 1)));
  -- RQB: 5 planchas en U4 (se pasa en 3) y un faro que no está en el metrado.
  perform public.emitir_requerimiento(pg_temp.id('rqb'), 'OPERACION', pg_temp.id('area_mtz'), 'CHK_475_U4',
    'Planchas y el faro de la unidad', null, jsonb_build_array(pg_temp.linea('pla', 5), pg_temp.linea('far', 1)));

  perform test.afirmar(pg_temp.estado('rqlleno', 1) = 'EN_METRADO', 'U2: las 4 planchas entran en su metrado');
  perform test.afirmar(pg_temp.estado('rqa', 1) = 'SIN_SUSTENTO' and pg_temp.estado('rqc', 1) = 'SIN_SUSTENTO'
                       and pg_temp.estado('rqb', 1) = 'SIN_SUSTENTO' and pg_temp.estado('rqb', 2) = 'SIN_SUSTENTO',
                       'Lo que se pasa del metrado espera su sustento');

  perform public.sustentar_insumos(pg_temp.id('rqa'), '[{"item": 1, "sustento": "El refuerzo del piso lleva dos planchas más"}]');
  perform public.sustentar_insumos(pg_temp.id('rqc'), '[{"item": 1, "sustento": "Las barandas se hacen con plancha de 3 mm"}]');
  perform public.sustentar_insumos(pg_temp.id('rqd'), '[{"item": 1, "sustento": "La tapa de la caja va en plancha de 3 mm"}]');
  perform public.sustentar_insumos(pg_temp.id('rqb'),
    '[{"item": 1, "sustento": "El piso de U4 se agrandó por pedido del cliente"}, {"item": 2, "sustento": "El cliente pidió un faro de trabajo atrás"}]');
end $$;
reset role;

select pg_temp.como('diseno');
set local role authenticated;
select public.autorizar_insumos(pg_temp.id('rqa'), '{1}', true, 'Va con el refuerzo del plano de piso');
select test.afirmar(pg_temp.estado('rqa', 1) = 'AUTORIZADO', 'Diseño autorizó las planchas del RQA contra el metrado de U1');
reset role;

-- 1. El visto vale para su código ===========================================================
-- El sustento y el visto son de antes de corregir el código (de ayer).
set local session_replication_role = replica;
update public.requerimiento_sustentos s set sustentado_en = now() - interval '2 days'
  from public.requerimiento_lineas l
 where l.id = s.requerimiento_linea_id and l.requerimiento_id in (pg_temp.id('rqa'), pg_temp.id('rqc'), pg_temp.id('rqd'));
set local session_replication_role = origin;

-- El RQA (autorizado) y el RQD (esperando el visto) pasan a U2, que ya tiene
-- pedido todo su metrado; el RQC pasa a U3, donde entra.
select pg_temp.como('requerimientos');
select set_config('metalwork.corrigiendo', 'requerimiento', true);
update public.requerimientos set codigo_interno = 'CHK_475_U2' where id = pg_temp.id('rqa');
update public.requerimientos set codigo_interno = 'CHK_475_U3' where id = pg_temp.id('rqc');
update public.requerimientos set codigo_interno = 'CHK_475_U2' where id = pg_temp.id('rqd');
select set_config('metalwork.corrigiendo', '', true);
select test.afirmar((select codigo_desde from public.requerimientos where id = pg_temp.id('rqa')) > now(),
                    'Corregir el código anota desde cuándo el RQ es de U2');

select pg_temp.como('requerimientos');
set local role authenticated;
select test.afirmar(pg_temp.estado('rqa', 1) = 'SIN_SUSTENTO'
                    and (select exceso from public.metrado_de_requerimientos(array[pg_temp.id('rqa')]) where item = 1) = 12,
                    'En U2 las 12 planchas se pasan: el visto de U1 ya no vale y el insumo vuelve a «sin sustento»');
select test.afirmar(pg_temp.estado('rqc', 1) = 'EN_METRADO', 'En U3 las 11 planchas entran en el metrado: no se pide nada');
select test.afirmar(pg_temp.estado('rqd', 1) = 'SIN_SUSTENTO', 'El RQD, que esperaba el visto para U1, vuelve a «sin sustento» en U2');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  begin
    perform public.rq_revisar_stock(pg_temp.id('rqa'), '[{"item": 1, "en_stock": 12}]', null);
    raise exception 'FALLA: Almacén revisó el RQA con el visto de otro código';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%espera el visto de Diseño%', 'Almacén no revisa el RQA hasta el visto para U2');
  end;
  perform public.rq_revisar_stock(pg_temp.id('rqc'), '[{"item": 1, "en_stock": 11}]', null);
  perform test.afirmar((select estado from public.requerimientos where id = pg_temp.id('rqc')) = 'LISTO_EN_ALMACEN',
                       'El RQC, que en U3 entra en el metrado, se revisa como siempre');
end $$;
reset role;

select pg_temp.como('diseno');
set local role authenticated;
do $$ begin
  begin
    perform public.autorizar_insumos(pg_temp.id('rqa'), '{1}', true, null);
    raise exception 'FALLA: Diseño volvió a autorizar sin sustento para U2';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%ya no espera tu visto%', 'Diseño no autoriza para U2 hasta que se sustente contra U2');
  end;
  begin
    perform public.autorizar_insumos(pg_temp.id('rqd'), '{1}', true, null);
    raise exception 'FALLA: Diseño autorizó para U2 el sustento que se escribió para U1';
  exception when check_violation then
    perform test.afirmar(sqlerrm like '%ya no espera tu visto%', 'Lo que esperaba el visto para U1 tampoco se autoriza en U2');
  end;
  perform test.afirmar(not exists (select 1 from public.requerimientos_por_autorizar() x where x.requerimiento_id = pg_temp.id('rqd')),
                       'El RQD sale de lo que espera el visto de Diseño');
end $$;
reset role;

-- Un sustento que llega mientras se corrige el código (aquí, en la misma
-- transacción: la corrección quedó después de su hora) se rechaza con su motivo.
select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.sustentar_insumos(pg_temp.id('rqa'), '[{"item": 1, "sustento": "El refuerzo del piso lleva dos planchas más"}]');
  raise exception 'FALLA: entró un sustento escrito para el código de antes';
exception when check_violation then
  perform test.afirmar(sqlerrm like '%cambió mientras enviabas el sustento%', 'El sustento que llega durante la corrección del código se rechaza y dice por qué');
end $$;
reset role;

-- Se sustenta contra U2 (al día siguiente de corregir el código) y Diseño lo autoriza.
set local session_replication_role = replica;
update public.requerimientos set codigo_desde = now() - interval '1 day' where id = pg_temp.id('rqa');
set local session_replication_role = origin;

select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v_antes int := pg_temp.avisos_a_diseno();
begin
  -- El mismo texto que ya tenía: no importa, el sustento es para otro código.
  perform public.sustentar_insumos(pg_temp.id('rqa'), '[{"item": 1, "sustento": "El refuerzo del piso lleva dos planchas más"}]');
  perform test.afirmar(pg_temp.estado('rqa', 1) = 'POR_AUTORIZAR', 'Sustentado contra U2, el RQA espera otra vez a Diseño');
  perform test.afirmar(pg_temp.sustentado_en('rqa', 1) = now(), 'Sus días en espera empiezan hoy');
  perform test.afirmar(pg_temp.avisos_a_diseno() = v_antes + 1, 'A Diseño le llegó el aviso del RQA en U2');
end $$;
reset role;

select pg_temp.como('diseno');
set local role authenticated;
select public.autorizar_insumos(pg_temp.id('rqa'), '{1}', true, 'U2 también lleva el refuerzo');
select test.afirmar(pg_temp.estado('rqa', 1) = 'AUTORIZADO', 'Con el visto para U2, el RQA queda autorizado');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_revisar_stock(pg_temp.id('rqa'), '[{"item": 1, "en_stock": 12}]', null);
select test.afirmar((select estado from public.requerimientos where id = pg_temp.id('rqa')) = 'LISTO_EN_ALMACEN',
                    'Con el visto para su código, Almacén revisa el RQA');
reset role;

-- 2. Corregir el sustento no vuelve a cero los días de lo que no cambió =======================
set local session_replication_role = replica;
update public.requerimiento_sustentos s set sustentado_en = now() - interval '3 days'
  from public.requerimiento_lineas l
 where l.id = s.requerimiento_linea_id and l.requerimiento_id = pg_temp.id('rqb');
set local session_replication_role = origin;

select pg_temp.como('requerimientos');
set local role authenticated;
do $$
declare v_antes int := pg_temp.avisos_a_diseno();
begin
  perform test.afirmar(pg_temp.estado('rqb', 1) = 'POR_AUTORIZAR' and pg_temp.estado('rqb', 2) = 'POR_AUTORIZAR',
                       'Los dos insumos del RQB esperan a Diseño desde hace 3 días');
  -- «Corregir el sustento» sin cambiar nada (con espacios de más en un texto).
  perform public.sustentar_insumos(pg_temp.id('rqb'),
    '[{"item": 1, "sustento": "  El piso de U4 se agrandó por pedido del cliente "}, {"item": 2, "sustento": "El cliente pidió un faro de trabajo atrás"}]');
  perform test.afirmar(pg_temp.sustentado_en('rqb', 1) = now() - interval '3 days'
                       and pg_temp.sustentado_en('rqb', 2) = now() - interval '3 days',
                       'Reenviar el mismo sustento conserva su hora: siguen 3 días en espera');
  perform test.afirmar(pg_temp.avisos_a_diseno() = v_antes, 'Si nada cambió, a Diseño no le llega otro aviso');
  perform test.afirmar((select dias from public.recorrido_de_requerimientos(array[pg_temp.id('rqb')]) where situacion = 'AHORA') >= 3,
                       'El recorrido del RQB sigue contando sus días en espera, no vuelve a cero');
  perform test.afirmar((select count(*) from public.requerimiento_sustentos s
                          join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
                         where l.requerimiento_id = pg_temp.id('rqb')) = 2,
                       'No nace otro sustento por reenviar el mismo');

  -- Se corrige solo el del faro.
  perform public.sustentar_insumos(pg_temp.id('rqb'),
    '[{"item": 1, "sustento": "El piso de U4 se agrandó por pedido del cliente"}, {"item": 2, "sustento": "El cliente pidió un faro de trabajo en la puerta trasera"}]');
  perform test.afirmar(pg_temp.sustentado_en('rqb', 1) = now() - interval '3 days', 'La plancha, que no cambió, sigue con sus 3 días');
  perform test.afirmar(pg_temp.sustentado_en('rqb', 2) >= now(), 'El faro, con el texto nuevo, empieza hoy');
  perform test.afirmar(pg_temp.avisos_a_diseno() = v_antes + 1
                       and pg_temp.avisos_a_diseno_que_dicen('El insumo 2 de CHK_475_U4 %') = 1,
                       'A Diseño le llega un aviso, solo por el faro');
end $$;
reset role;

-- Diseño amplía el metrado de U4 a 3 planchas: el exceso baja de 3 a 2. Reenviar el
-- mismo sustento no toca sus días ni lo que decía el metrado cuando se escribió.
select pg_temp.como('diseno');
set local role authenticated;
select public.guardar_material_codigo(
  (select id from public.codigo_materiales where public.normalizar_codigo_interno(codigo_interno) = 'CHK_475_U4' limit 1),
  'chk_475_u4', pg_temp.id('pla'), 3, null, 'El plano de piso se corrigió');
reset role;

select pg_temp.como('requerimientos');
set local role authenticated;
do $$ begin
  perform public.sustentar_insumos(pg_temp.id('rqb'), '[{"item": 1, "sustento": "El piso de U4 se agrandó por pedido del cliente"}]');
  perform test.afirmar((select s.exceso from public.requerimiento_sustentos s
                          join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
                         where l.requerimiento_id = pg_temp.id('rqb') and l.item = 1) = 3
                       and (select exceso from public.metrado_de_requerimientos(array[pg_temp.id('rqb')]) where item = 1) = 2
                       and pg_temp.sustentado_en('rqb', 1) = now() - interval '3 days',
                       'El sustento que no cambió guarda el exceso de cuando se escribió (3), el metrado dice el de hoy (2), y conserva sus 3 días');
end $$;
reset role;

-- Quien no pidió no sustenta, ni para conservar la hora --------------------------------------
select pg_temp.como('almacenero');
set local role authenticated;
do $$ begin
  begin
    perform public.sustentar_insumos(pg_temp.id('rqb'), '[{"item": 1, "sustento": "El piso de U4 se agrandó por pedido del cliente"}]');
    raise exception 'FALLA: Almacén reenvió el sustento de otra área';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select 'ok · 475 el visto vale para su código y el sustento que no cambió conserva sus días';
rollback;
