-- El RQ del área es gasto operativo (migración 20261127160000), con el rol real:
-- un SUPERVISOR de Producción registra el RQ del área y un ALMACENERO saca lo
-- suyo, los dos con `set local role authenticated`. Termina en rollback.
--
-- 1. El supervisor registra el RQ del área: de operación, de Producción, con
--    PLANTA y marcado. Repetir el envío no duplica; con el id de un RQ que no
--    es del área, no lo marca. Otra área, no.
-- 2. Un RQ del área con otro código no entra; corregido a otro código, deja
--    de ser del área.
-- 3. Lo que sale para el RQ del área va a PLANTA: hacia una unidad, no.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ALMACENERO:ALM:almacenero', 'SUPERVISOR:PRD:supervisor'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 3)) || '.501@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 501', lower(split_part(v, ':', 3)) || '.501@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Un consumible del catálogo con stock.
do $$
declare v_mat uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK501-HERR', 'Disco de corte del check 501',
          (select id from public.categorias_material where almacen = 'CONSUMIBLES' and activo order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'))
  returning id into v_mat;
  perform set_config('prueba.mat', v_mat::text, true);
  perform set_config('prueba.rq', gen_random_uuid()::text, true);
  perform set_config('prueba.otro', gen_random_uuid()::text, true);
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
end $$;

-- 1. El supervisor registra el RQ del área ------------------------------------------
select pg_temp.como('supervisor');
set local role authenticated;
do $$
declare v_id uuid; v_lineas jsonb := jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 2));
begin
  v_id := public.emitir_requerimiento_del_area(current_setting('prueba.rq')::uuid, current_setting('prueba.prd')::uuid,
    'Discos para el área de Producción, se deshace', null, v_lineas);
  if v_id is distinct from current_setting('prueba.rq')::uuid then raise exception 'FALLA: devolvió otro id (%)', v_id; end if;
  -- El mismo envío otra vez: el mismo RQ, sin otro.
  v_id := public.emitir_requerimiento_del_area(current_setting('prueba.rq')::uuid, current_setting('prueba.prd')::uuid,
    'Discos para el área de Producción, se deshace', null, v_lineas);
  if v_id is distinct from current_setting('prueba.rq')::uuid then raise exception 'FALLA: el reenvío devolvió otro id (%)', v_id; end if;

  -- Un RQ de una unidad con su id: el del área no lo marca.
  perform public.emitir_requerimiento(current_setting('prueba.otro')::uuid, 'OPERACION', current_setting('prueba.prd')::uuid, 'UNI-501',
    'Para la unidad del check 501, se deshace', null, v_lineas);
  begin
    perform public.emitir_requerimiento_del_area(current_setting('prueba.otro')::uuid, current_setting('prueba.prd')::uuid,
      'Para la unidad del check 501, se deshace', null, v_lineas);
    raise exception 'FALLA: marcó del área un RQ de una unidad';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'Este requerimiento ya existe con otros datos%' then raise; end if;
  end;

  -- Otra área, no.
  begin
    perform public.emitir_requerimiento_del_area(gen_random_uuid(), current_setting('prueba.mtz')::uuid,
      'Discos para Maestranza desde Producción, se deshace', null, v_lineas);
    raise exception 'FALLA: el supervisor de Producción registró un RQ del área de Maestranza';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'No tienes permiso para registrar requerimientos de otra área%' then raise; end if;
  end;
end $$;
reset role;

select test.afirmar(
  (select count(*) = 1 from public.requerimientos r join public.areas a on a.id = r.area_id
    where r.id = current_setting('prueba.rq')::uuid and r.para_el_area and r.tipo = 'OPERACION'
      and r.codigo_interno = 'PLANTA' and a.codigo = 'PRD' and r.creado_por = current_setting('prueba.supervisor')::uuid),
  'el RQ del área queda de operación, de Producción, con PLANTA, marcado y a nombre del supervisor');
select test.afirmar(
  (select count(*) = 1 from public.requerimientos where id in (current_setting('prueba.rq')::uuid) ),
  'el reenvío no duplicó el RQ del área');
select test.afirmar(
  (select not para_el_area from public.requerimientos where id = current_setting('prueba.otro')::uuid),
  'el RQ de la unidad sigue sin ser del área');

-- 2. Solo con PLANTA, y corregido a otro código deja de serlo --------------------------
select test.debe_fallar(
  $q$insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por, para_el_area)
     values (gen_random_uuid(), 'RQ-CHK501', current_setting('prueba.prd')::uuid, 'UNI-501', 'Del área con otro código', current_setting('prueba.supervisor')::uuid, true)$q$,
  'un RQ del área con otro código que PLANTA no entra', 'va con PLANTA');
do $$
begin
  perform set_config('metalwork.corrigiendo', 'requerimiento', true);
  update public.requerimientos set codigo_interno = 'UNI-501' where id = current_setting('prueba.rq')::uuid;
  if (select para_el_area from public.requerimientos where id = current_setting('prueba.rq')::uuid) then
    raise exception 'FALLA: corregido a una unidad, siguió siendo del área';
  end if;
  update public.requerimientos set codigo_interno = 'PLANTA', para_el_area = true where id = current_setting('prueba.rq')::uuid;
  perform set_config('metalwork.corrigiendo', '', true);
end $$;

-- 3. Lo que sale para él va a PLANTA ------------------------------------------------------
select test.metrado_autorizado();
do $$
declare k text;
begin
  perform set_config('prueba.linea', (select id::text from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid and item = 1), true);
  foreach k in array array['s_unidad', 's_planta'] loop
    perform set_config('prueba.' || k, gen_random_uuid()::text, true);
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.' || k) || '.jpg',
            current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
  end loop;
end $$;

select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_ingreso_almacen(gen_random_uuid(), current_setting('prueba.mat')::uuid, 10, 'INGRESO_GENERAL', 'ENSAYO 501', 1, 'PEN');
do $$
declare v_uid text := auth.uid()::text; v_id uuid; v_cod text; v_ot uuid; v_uni uuid;
begin
  begin
    perform public.registrar_salida_material(current_setting('prueba.s_unidad')::uuid, current_setting('prueba.mat')::uuid, 1,
      null, 'UNI-501', 'Salida del check 501', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_unidad') || '.jpg',
      current_setting('prueba.linea')::uuid);
    raise exception 'FALLA: lo del RQ del área salió hacia una unidad';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like '%es gasto operativo de Producción: lo que sale para él va a PLANTA%' then raise; end if;
  end;
  v_id := public.registrar_salida_material(current_setting('prueba.s_planta')::uuid, current_setting('prueba.mat')::uuid, 2,
    null, 'PLANTA', 'Salida del check 501', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_planta') || '.jpg',
    current_setting('prueba.linea')::uuid);
  select codigo_interno, orden_id, unidad_id into v_cod, v_ot, v_uni from public.movimientos_materiales where id = v_id;
  if v_cod is distinct from 'PLANTA' or v_ot is not null or v_uni is not null then
    raise exception 'FALLA: la salida del RQ del área quedó con código %, OT % y unidad %', v_cod, v_ot, v_uni;
  end if;
end $$;
reset role;

select 'OK 501 el RQ del área es gasto operativo' as resultado;
rollback;
