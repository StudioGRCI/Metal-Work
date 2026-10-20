-- Los cuatro almacenes y la salida por requerimiento (migración 20261013140000),
-- con el rol real: ALMACENERO del área ALM y `set local role authenticated`;
-- un supervisor como quien lee los RQ pero no saca nada. Termina en rollback.
--
-- Armazón como dueño: un material por almacén, un RQ con dos líneas (uno es de
-- Requerimientos: aquí solo se inserta la fila), los objetos de Storage y un
-- accesorio que entró marcado para otra unidad.
begin;

-- ----------------------------------------------------------------- armazón
-- Una cuenta por puesto, cada una en su área, como en producción (como el check
-- 330). Antes se tomaba de la base la primera cuenta activa de cada rol, y en
-- una base sin esas cuentas el check se caía antes de probar nada.
do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ALMACENERO:ALM:almacenero', 'SUPERVISOR:PRD:supervisor'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 3)) || '.331b@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 331b', lower(split_part(v, ':', 3)) || '.331b@prueba.local', r.id,
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

do $$
declare v_und uuid; v_area uuid; v_rq uuid := gen_random_uuid(); v_mat uuid; v_cat uuid; k text; v_alm text;
begin
  select id into v_und from public.unidades_medida where codigo = 'UND';
  select id into v_area from public.areas where activo order by codigo limit 1;
  foreach v_alm in array array['CONSUMIBLES', 'ACCESORIOS', 'MATERIA_PRIMA', 'EPP'] loop
    select id into v_cat from public.categorias_material where almacen = v_alm and activo order by codigo limit 1;
    if v_cat is null then raise exception 'FALLA: no hay categoría del almacén %', v_alm; end if;
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ('CHK331-' || v_alm, 'Material de prueba ' || v_alm, v_cat, v_und) returning id into v_mat;
    perform set_config('prueba.mat_' || lower(v_alm), v_mat::text, true);
    perform set_config('prueba.cat_' || lower(v_alm), v_cat::text, true);
  end loop;
  -- El RQ, como lo deja emitir_requerimiento: UNI-B pide un accesorio y acero.
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
  values (v_rq, 'RQ-CHK331', v_area, 'UNI-B', 'Prueba de salida por requerimiento, se deshace',
          current_setting('prueba.supervisor')::uuid);
  insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id)
  values (v_rq, 1, 'Accesorio de prueba', 4, v_und, current_setting('prueba.cat_accesorios')::uuid),
         (v_rq, 2, 'Plancha de prueba', 5, v_und, current_setting('prueba.cat_materia_prima')::uuid);
  perform set_config('prueba.rq', v_rq::text, true);
  perform set_config('prueba.linea1', (select id::text from public.requerimiento_lineas where requerimiento_id = v_rq and item = 1), true);
  perform set_config('prueba.linea2', (select id::text from public.requerimiento_lineas where requerimiento_id = v_rq and item = 2), true);
  foreach k in array array['s_cons', 's_acc_mal', 's_acc', 's_rq1', 's_rq1_mas', 's_rq2_mal', 's_rq2', 's_epp'] loop
    perform set_config('prueba.' || k, gen_random_uuid()::text, true);
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.' || k) || '.jpg',
            current_setting('prueba.almacenero'), '{"mimetype":"image/jpeg","size":100}'::jsonb);
  end loop;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('evidencias-almacen', current_setting('prueba.almacenero') || '/' || current_setting('prueba.s_rq2') || '-formato.pdf',
          current_setting('prueba.almacenero'), '{"mimetype":"application/pdf","size":2000}'::jsonb);
end $$;

-- Almacén: los ingresos, y el accesorio que entró para UNI-A ---------------------
select pg_temp.como('almacenero');
set local role authenticated;
select public.registrar_ingreso_almacen(gen_random_uuid(), current_setting('prueba.mat_' || a)::uuid, 10, 'INGRESO_GENERAL', 'ENSAYO 331', 1, 'PEN')
  from unnest(array['consumibles', 'accesorios', 'materia_prima', 'epp']) a;
reset role;
-- Cinco de los diez accesorios entraron para la unidad UNI-A (lo pondrá el RQ
-- atendido por Logística; aquí lo pone el armazón).
update public.movimientos_materiales set codigo_interno = 'UNI-A'
 where material_id = current_setting('prueba.mat_accesorios')::uuid and tipo = 'INGRESO';
do $$ begin
  -- Lo que se marcó fue un ingreso de 10; para la prueba, UNI-A tiene 5 marcados.
  update public.movimientos_materiales set cantidad = 5
   where material_id = current_setting('prueba.mat_accesorios')::uuid and tipo = 'INGRESO';
  perform public.registrar_ingreso_almacen(gen_random_uuid(), current_setting('prueba.mat_accesorios')::uuid, 5, 'INGRESO_GENERAL', 'ENSAYO 331 LIBRE', 1, 'PEN');
end $$;

select pg_temp.como('almacenero');
set local role authenticated;
do $$
declare
  v_uid text := auth.uid()::text;
  v_id uuid; v_n int; v_txt text; v_b boolean; v_num numeric;
  v_txt2 text;
begin
  -- Consumible: sale como siempre y no queda formato pendiente.
  v_id := public.registrar_salida_material(current_setting('prueba.s_cons')::uuid, current_setting('prueba.mat_consumibles')::uuid, 3,
    null, 'UNI-X', 'Consumo de prueba', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_cons') || '.jpg', null);
  select formato_pendiente, almacen, codigo_interno into v_b, v_txt, v_txt2 from public.v_kardex_almacen where id = v_id;
  if v_b or v_txt <> 'CONSUMIBLES' or v_txt2 <> 'UNI-X' then
    raise exception 'FALLA: el consumible salió con formato pendiente % o almacén % o código %', v_b, v_txt, v_txt2;
  end if;

  -- Accesorio: 5 entraron para UNI-A; para UNI-B solo salen 5 de los 10.
  begin
    perform public.registrar_salida_material(current_setting('prueba.s_acc_mal')::uuid, current_setting('prueba.mat_accesorios')::uuid, 8,
      null, 'UNI-B', 'Accesorio de prueba', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_acc_mal') || '.jpg', null);
    raise exception 'FALLA: un accesorio marcado para UNI-A salió para UNI-B';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'De este accesorio hay 5 libre para la unidad UNI-B%' then raise; end if;
  end;
  v_id := public.registrar_salida_material(current_setting('prueba.s_acc')::uuid, current_setting('prueba.mat_accesorios')::uuid, 1,
    null, 'UNI-B', 'Accesorio de prueba', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_acc') || '.jpg', null);
  -- Y para UNI-A salen los suyos más los libres: 5 marcados + 4 libres.
  select greatest(disponible, 0) into v_num from public.v_existencias_materiales where material_id = current_setting('prueba.mat_accesorios')::uuid;
  if v_num <> 9 then raise exception 'FALLA: quedan % accesorios y debían quedar 9', v_num; end if;

  -- Por requerimiento: la línea 1 pone el código UNI-B y descuenta lo pedido.
  v_id := public.registrar_salida_material(current_setting('prueba.s_rq1')::uuid, current_setting('prueba.mat_accesorios')::uuid, 4,
    null, null, 'RQ-CHK331 · ítem 1', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_rq1') || '.jpg',
    current_setting('prueba.linea1')::uuid);
  select codigo_unidad, requerimiento_numero into v_txt, v_txt2 from public.v_kardex_almacen where id = v_id;
  if v_txt <> 'UNI-B' or v_txt2 <> 'RQ-CHK331' then
    raise exception 'FALLA: la salida por RQ no heredó la unidad (%) o el número (%)', v_txt, v_txt2;
  end if;
  select pendiente, entregado into v_num, v_n from public.v_rq_lineas_para_salida where linea_id = current_setting('prueba.linea1')::uuid;
  if v_num <> 0 or v_n <> 4 then raise exception 'FALLA: la línea 1 dice pendiente % y entregado %', v_num, v_n; end if;
  -- Repetir el envío no duplica.
  if public.registrar_salida_material(v_id, current_setting('prueba.mat_accesorios')::uuid, 4,
       null, null, 'RQ-CHK331 · ítem 1', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_rq1') || '.jpg',
       current_setting('prueba.linea1')::uuid) <> v_id then
    raise exception 'FALLA: la salida por RQ se duplicó';
  end if;
  -- Más de lo pedido no sale.
  begin
    perform public.registrar_salida_material(current_setting('prueba.s_rq1_mas')::uuid, current_setting('prueba.mat_accesorios')::uuid, 1,
      null, null, 'RQ-CHK331 · ítem 1', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_rq1_mas') || '.jpg',
      current_setting('prueba.linea1')::uuid);
    raise exception 'FALLA: salió más de lo que pedía la línea';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'El requerimiento RQ-CHK331 pide%' then raise; end if;
  end;

  -- La línea 2 pide acero: un consumible no la atiende.
  begin
    perform public.registrar_salida_material(current_setting('prueba.s_rq2_mal')::uuid, current_setting('prueba.mat_consumibles')::uuid, 2,
      null, null, 'RQ-CHK331 · ítem 2', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_rq2_mal') || '.jpg',
      current_setting('prueba.linea2')::uuid);
    raise exception 'FALLA: un consumible atendió una línea de materia prima';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'El requerimiento RQ-CHK331 pide «Plancha de prueba»%' then raise; end if;
  end;
  -- Materia prima: sale y queda abierta hasta el formato firmado.
  v_id := public.registrar_salida_material(current_setting('prueba.s_rq2')::uuid, current_setting('prueba.mat_materia_prima')::uuid, 5,
    null, null, 'RQ-CHK331 · ítem 2', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_rq2') || '.jpg',
    current_setting('prueba.linea2')::uuid);
  select formato_pendiente into v_b from public.v_kardex_almacen where id = v_id;
  if not v_b then raise exception 'FALLA: la materia prima salió sin quedar pendiente de formato'; end if;
  begin
    perform public.cerrar_salida_con_formato(v_id, v_uid || '/' || current_setting('prueba.s_rq2') || '.jpg');
    raise exception 'FALLA: la foto de la salida cerró como formato';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'Adjunta el formato firmado%' then raise; end if;
  end;
  begin
    perform public.cerrar_salida_con_formato(v_id, v_uid || '/' || current_setting('prueba.s_rq2') || '-formato.png');
    raise exception 'FALLA: cerró con un archivo que no se cargó';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'Carga el formato firmado%' then raise; end if;
  end;
  perform public.cerrar_salida_con_formato(v_id, v_uid || '/' || current_setting('prueba.s_rq2') || '-formato.pdf');
  perform public.cerrar_salida_con_formato(v_id, v_uid || '/' || current_setting('prueba.s_rq2') || '-formato.pdf');
  select formato_pendiente, con_formato into v_b, v_txt2 from public.v_kardex_almacen where id = v_id;
  if v_b or v_txt2 <> 'true' then raise exception 'FALLA: el formato no cerró la salida'; end if;
  begin
    perform public.cerrar_salida_con_formato(v_id, v_uid || '/' || current_setting('prueba.s_rq2') || '-formato.jpg');
    raise exception 'FALLA: una salida cerrada aceptó otro formato';
  exception when others then
    if sqlerrm like 'FALLA:%' then raise; end if;
    if sqlerrm not like 'Esa salida ya tiene su formato firmado.' then raise; end if;
  end;

  -- EPP: igual que materia prima.
  v_id := public.registrar_salida_material(current_setting('prueba.s_epp')::uuid, current_setting('prueba.mat_epp')::uuid, 2,
    null, 'UNI-X', 'Entrega de EPP', 'Persona de prueba', v_uid || '/' || current_setting('prueba.s_epp') || '.jpg', null);
  select formato_pendiente into v_b from public.v_kardex_almacen where id = v_id;
  if not v_b then raise exception 'FALLA: el EPP salió sin quedar pendiente de formato'; end if;

  -- El tablero cuenta por almacén.
  select count(distinct almacen) into v_n from public.v_existencias_materiales where codigo like 'CHK331-%';
  if v_n <> 4 then raise exception 'FALLA: las existencias no distinguen los cuatro almacenes (%)', v_n; end if;
end $$;
reset role;

-- Supervisión lee los requerimientos y no saca nada -------------------------------
select pg_temp.como('supervisor');
set local role authenticated;
do $$
declare v_n int; v_uid text := auth.uid()::text;
begin
  select count(*) into v_n from public.v_rq_lineas_para_salida where numero = 'RQ-CHK331';
  if v_n <> 2 then raise exception 'FALLA: Supervisión ve % líneas del RQ y debía ver 2', v_n; end if;
  begin
    perform public.registrar_salida_material(gen_random_uuid(), current_setting('prueba.mat_consumibles')::uuid, 1,
      null, 'UNI-X', 'Intento', 'Persona de prueba', v_uid || '/x.jpg', null);
    raise exception 'FALLA: un supervisor sacó material';
  exception when others then if sqlerrm like 'FALLA:%' then raise; end if; end;
  begin
    perform public.cerrar_salida_con_formato(current_setting('prueba.s_epp')::uuid, v_uid || '/' || current_setting('prueba.s_epp') || '-formato.pdf');
    raise exception 'FALLA: un supervisor cerró una salida';
  exception when others then if sqlerrm like 'FALLA:%' then raise; end if; end;
end $$;
reset role;

do $$ begin raise notice 'OK 331: cuatro almacenes, accesorio por código, salida por RQ y cierre con formato'; end $$;
rollback;
