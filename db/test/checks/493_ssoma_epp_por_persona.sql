-- SSOMA, entrega 15.5 (migración 20261126998500): entrega de EPP por persona,
-- enlazada a la salida de Almacén sin cambiar el kardex, con fecha de renovación.
--
-- Almacén registra la salida del equipo como siempre. SSOMA anota a quién de
-- RR. HH. le tocó, cuánto y hasta cuándo le dura; lo vencido y lo que vence en 15
-- días sale en «Por renovar». SSOMA y Gerencia leen; nadie más.
--
-- Probado con el rol real de cada puesto y `set local role authenticated`,
-- nunca como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000493', 'PRUEBAS SSOMA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T493', 'Taller de pruebas de EPP') on conflict (codigo) do nothing;

select test.crear_usuario('Sara', 'Seguridad', 'ssoma493@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma_id \gset
select test.crear_usuario('Sixto', 'Seguridad Dos', 'ssoma2.493@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma2_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia493@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Abel', 'Almacén', 'almacen493@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas493@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Rosa', 'Recursos', 'rrhh493@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes limit 1)) as rrhh_id \gset
-- El Supervisor General lee `audit_log` (`auditoria.ver`): las entregas no pasan por ahí.
select test.crear_usuario('Gino', 'General', 'supgeneral493@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes limit 1)) as supgen_id \gset

-- El armazón lo monta el administrador; lo que se prueba, nunca.
select test.crear_usuario('Ada', 'Administradora', 'admin493@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select set_config('prueba.ssoma', :'ssoma_id', true);
select set_config('prueba.ssoma2', :'ssoma2_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.rrhh', :'rrhh_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);

-- El personal, dos equipos de protección, un material que no lo es y las salidas de
-- Almacén: como las deja Almacén, puestas aquí sin pasar por su ventana (que pide foto).
select test.como_usuario(:'admin_id');
do $$
declare
  v       uuid;
  v_alm   constant uuid := current_setting('prueba.almacen')::uuid;
  v_epp   uuid := (select id from public.categorias_material where activo and almacen = 'EPP' order by codigo limit 1);
  v_otra  uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1);
  v_und   uuid := (select id from public.unidades_medida where codigo = 'UND');
begin
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Óscar', 'Operario Epp', '49349301', 'Soldador', (select id from public.areas where codigo = 'MTZ')) returning id into v;
  perform set_config('prueba.t1', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Pía', 'Pintora Epp', '49349302', 'Pintora', (select id from public.areas where codigo = 'PRD')) returning id into v;
  perform set_config('prueba.t2', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id)
  values ('Abel', 'Almacén Epp', '49349303', 'Almacenero', (select id from public.areas where codigo = 'ALM')) returning id into v;
  perform set_config('prueba.t3', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, activo)
  values ('Iván', 'Inactivo Epp', '49349304', 'Ayudante', (select id from public.areas where codigo = 'MTZ'), false) returning id into v;
  perform set_config('prueba.t4', v::text, true);
  -- Nora entró hoy: no estaba cuando salió el equipo de hace diez días.
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, fecha_ingreso)
  values ('Nora', 'Nueva Epp', '49349305', 'Ayudante', (select id from public.areas where codigo = 'PRD'), current_setting('prueba.hoy')::date)
  returning id into v;
  perform set_config('prueba.t5', v::text, true);

  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK493-CASCO', 'Casco de seguridad del check 493', v_epp, v_und) returning id into v;
  perform set_config('prueba.casco', v::text, true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK493-GUANTE', 'Guantes de cuero del check 493', v_epp, v_und) returning id into v;
  perform set_config('prueba.guante', v::text, true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK493-DISCO', 'Disco de corte del check 493', v_otra, v_und) returning id into v;
  perform set_config('prueba.disco', v::text, true);

  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', 'SALDO_INICIAL', m, 50, 'Saldo inicial del check 493', v_alm
    from unnest(array[current_setting('prueba.casco')::uuid, current_setting('prueba.guante')::uuid, current_setting('prueba.disco')::uuid]) as m;

  -- Cascos: una salida de hace 400 días (1), una de hace diez (3) y una de hoy (2).
  v := gen_random_uuid();
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por, registrado_en)
  values (v, 'SALIDA', 'SALIDA_GENERAL', current_setting('prueba.casco')::uuid, 1, 'Vale del check 493', 'Julio Ramírez', 'CHK493', v_alm, now() - interval '400 days');
  perform set_config('prueba.s_vieja', v::text, true);
  v := gen_random_uuid();
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por, registrado_en)
  values (v, 'SALIDA', 'SALIDA_GENERAL', current_setting('prueba.casco')::uuid, 3, 'Vale del check 493', 'Julio Ramírez', 'CHK493', v_alm, now() - interval '10 days');
  perform set_config('prueba.s_casco', v::text, true);
  v := gen_random_uuid();
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por)
  values (v, 'SALIDA', 'SALIDA_GENERAL', current_setting('prueba.casco')::uuid, 2, 'Vale del check 493', 'Julio Ramírez', 'CHK493', v_alm);
  perform set_config('prueba.s_casco_hoy', v::text, true);
  -- Guantes: salieron 5 hoy y volvió 1.
  v := gen_random_uuid();
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por)
  values (v, 'SALIDA', 'SALIDA_GENERAL', current_setting('prueba.guante')::uuid, 5, 'Vale del check 493', 'Julio Ramírez', 'CHK493', v_alm);
  perform set_config('prueba.s_guante', v::text, true);
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, devolucion_de, registrado_por)
  values (gen_random_uuid(), 'INGRESO', 'DEVOLUCION', current_setting('prueba.guante')::uuid, 1, 'Devolución del check 493', v, v_alm);
  -- Un disco de corte: sale de Almacén, pero no es EPP.
  v := gen_random_uuid();
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por)
  values (v, 'SALIDA', 'SALIDA_GENERAL', current_setting('prueba.disco')::uuid, 2, 'Vale del check 493', 'Julio Ramírez', 'CHK493', v_alm);
  perform set_config('prueba.s_disco', v::text, true);
  perform set_config('prueba.ingreso', (select id::text from public.movimientos_materiales
    where tipo = 'INGRESO' and origen = 'SALDO_INICIAL' and material_id = current_setting('prueba.casco')::uuid), true);

  perform set_config('prueba.d_casco', ((select (registrado_en at time zone 'America/Lima')::date from public.movimientos_materiales
    where id = current_setting('prueba.s_casco')::uuid))::text, true);
  perform set_config('prueba.d_vieja', ((select (registrado_en at time zone 'America/Lima')::date from public.movimientos_materiales
    where id = current_setting('prueba.s_vieja')::uuid))::text, true);
  -- El kardex, tal como lo dejó Almacén: al final tiene que estar igual.
  perform set_config('prueba.kardex', (select md5(string_agg(to_jsonb(k)::text, '|' order by k.id)) from public.movimientos_materiales k), true);
end $$;
select set_config('request.jwt.claim.sub', '', true);

-- Cómo se llama a la función que anota, con la lista de personas ya armada.
create or replace function pg_temp.anotar(p_envio text, p_salida text, p_renovar text, p_personas jsonb)
returns text language sql as $$
  select format('select public.ssoma_registrar_entregas_epp(%L, %L, %L::date, %L::jsonb)', p_envio, p_salida, p_renovar, p_personas);
$$;
create or replace function pg_temp.persona(p_trabajador text, p_cantidad numeric default 1)
returns jsonb language sql as $$ select jsonb_build_object('trabajador', p_trabajador, 'cantidad', p_cantidad); $$;

-- ============================================================ 0. El catálogo
do $$
begin
  perform test.afirmar(
    (select bool_and(c.relrowsecurity) from pg_class c
      where c.oid in ('public.ssoma_epp_entregas'::regclass, 'public.ssoma_epp_sin_reparto'::regclass)),
    'las dos tablas nuevas tienen RLS');
  perform test.afirmar(
    not exists (select 1 from unnest(array['public.ssoma_epp_entregas', 'public.ssoma_epp_sin_reparto']) t
                 where has_table_privilege('authenticated', t, 'insert') or has_table_privilege('authenticated', t, 'update')
                    or has_table_privilege('authenticated', t, 'delete') or has_table_privilege('anon', t, 'select')),
    'se escriben solo por sus funciones y el anónimo no las lee');
  perform test.afirmar(
    not exists (select 1 from pg_trigger t
                 where t.tgrelid in ('public.ssoma_epp_entregas'::regclass, 'public.ssoma_epp_sin_reparto'::regclass)
                   and t.tgname ilike '%audit%'),
    'ninguna se copia a audit_log (el Supervisor General la leería sin ver SSOMA)');
  perform test.afirmar(
    not has_function_privilege('authenticated', 'public.ssoma_epp_estado(uuid, uuid, uuid, date, timestamptz, timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.fn_ssoma_epp_entrega_guardia()', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_salidas_de_epp(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_personal_para_epp()', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_registrar_entregas_epp(uuid, uuid, date, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_anular_entrega_epp(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_epp_no_se_renueva(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_epp_entregas_a_la_vista(uuid, uuid, boolean)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_epp_por_persona(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.fn_ssoma_epp_sin_reparto_guardia()', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_epp_salida_sin_reparto(uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_epp_salida_se_reparte(uuid)', 'execute'),
    'los ayudantes internos no los llama la gente y nada es del anónimo');
  perform test.afirmar(
    not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                 and p.proname in ('ssoma_salidas_de_epp', 'ssoma_epp_entregas_a_la_vista', 'ssoma_epp_por_persona', 'ssoma_personal_para_epp')
                 and pg_get_function_result(p.oid) ~* 'precio|costo|dni|moneda'),
    'ninguna lectura de EPP trae precio, costo ni DNI');
end $$;

-- ============================================================ 1. Quién entra
do $$
declare
  v_quien text;
begin
  -- Ventas, RR. HH. y Almacén: ni la tabla ni las lecturas, y no anotan.
  foreach v_quien in array array['vendedor', 'rrhh', 'almacen', 'supgen'] loop
    perform test.como_usuario(current_setting('prueba.' || v_quien)::uuid);
    set local role authenticated;
    perform test.afirmar(
      (select count(*) from public.ssoma_salidas_de_epp(null)) = 0
      and (select count(*) from public.ssoma_salidas_de_epp(current_setting('prueba.s_casco')::uuid)) = 0
      and (select count(*) from public.ssoma_epp_por_persona(null)) = 0
      and (select count(*) from public.ssoma_epp_por_persona(current_setting('prueba.t1')::uuid)) = 0,
      v_quien || ' no lee las salidas de EPP ni el personal por aquí');
    perform test.debe_fallar('select * from public.ssoma_personal_para_epp()', v_quien || ' no lee el personal para EPP', 'la anota SSOMA');
    perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, current_setting('prueba.s_casco'), (current_setting('prueba.hoy')::date + 180)::text,
        jsonb_build_array(pg_temp.persona(current_setting('prueba.t1')))),
      v_quien || ' no anota una entrega', 'la anota SSOMA');
    reset role;
  end loop;

  -- Gerencia consulta: ve las salidas de EPP (no el disco), y no anota.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_salidas_de_epp(null) where material like '%check 493') = 3
    and (select count(*) from public.ssoma_salidas_de_epp(current_setting('prueba.s_vieja')::uuid)) = 1
    and (select count(*) from public.ssoma_salidas_de_epp(current_setting('prueba.s_disco')::uuid)) = 0
    and (select count(*) from public.ssoma_salidas_de_epp(current_setting('prueba.ingreso')::uuid)) = 0,
    'Gerencia ve las salidas de EPP: las recientes en la lista y la de hace 400 días solo si se pide; ni el disco ni un ingreso');
  perform test.afirmar(
    (select numero like 'SA-%' and cantidad = 5 and devuelto = 1 and asignado = 0 and por_asignar = 4 and asignado_de_mas = 0
            and recibio = 'Julio Ramírez' and unidad = 'UND' and dias_sugeridos is null and fecha = current_setting('prueba.hoy')::date
       from public.ssoma_salidas_de_epp(current_setting('prueba.s_guante')::uuid)),
    'la salida trae su número de Almacén, lo que salió, lo que volvió y lo que queda por asignar');
  perform test.afirmar((select count(*) from public.ssoma_epp_por_persona(null) where persona like '% Epp %') = 4,
    'Gerencia ve al personal en la planta (no al inactivo)');
  perform test.debe_fallar('select * from public.ssoma_personal_para_epp()', 'Gerencia no arma entregas', 'la anota SSOMA');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, current_setting('prueba.s_casco'), (current_setting('prueba.hoy')::date + 180)::text,
      jsonb_build_array(pg_temp.persona(current_setting('prueba.t1')))),
    'Gerencia no anota una entrega', 'la anota SSOMA');
  reset role;
end $$;

-- ============================================================ 2. SSOMA anota a quién le tocó
select set_config('prueba.e1', gen_random_uuid()::text, true);
do $$
declare
  v_e1     constant text := current_setting('prueba.e1');
  v_casco  constant text := current_setting('prueba.s_casco');
  v_guante constant text := current_setting('prueba.s_guante');
  v_d      constant date := current_setting('prueba.d_casco')::date;
  v_hoy    constant date := current_setting('prueba.hoy')::date;
  v_t1     constant text := current_setting('prueba.t1');
  v_t2     constant text := current_setting('prueba.t2');
  v_t3     constant text := current_setting('prueba.t3');
  v_dos    jsonb;
begin
  v_dos := jsonb_build_array(pg_temp.persona(v_t1), pg_temp.persona(v_t2));
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_personal_para_epp() where nombre like '% Epp %') = 4
    and not exists (select 1 from public.ssoma_personal_para_epp() where id = current_setting('prueba.t4')::uuid)
    and (select nombre = 'Operario Epp Óscar' and cargo = 'Soldador' and area is not null and en_planta
           from public.ssoma_personal_para_epp() where id = v_t1::uuid),
    'SSOMA elige entre el personal en la planta, con nombre, cargo y área');

  -- Lo que no entra.
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, current_setting('prueba.s_disco'), (v_hoy + 180)::text, v_dos),
    'una salida que no es de EPP no se reparte', 'no es de EPP');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, current_setting('prueba.ingreso'), (v_hoy + 180)::text, v_dos),
    'un ingreso no se reparte', 'no es de EPP');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, gen_random_uuid()::text, (v_hoy + 180)::text, v_dos),
    'una salida que no existe no se reparte', 'no es de EPP');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, v_d::text, v_dos),
    'la renovación no es el mismo día de la entrega', 'posterior al día de la entrega');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 1827)::text, v_dos),
    'la renovación no pasa de cinco años', 'cinco años');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text, '[]'::jsonb),
    'sin personas no entra', 'Elige a quién');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text, jsonb_build_array(pg_temp.persona(v_t1), pg_temp.persona(v_t1))),
    'la misma persona dos veces no entra', 'una sola vez');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text, jsonb_build_array(pg_temp.persona(v_t1, 0))),
    'una cantidad de cero no entra', '0.001 a 999');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text, '[{"trabajador": "no-es-un-id"}]'::jsonb),
    'un id roto no pasa al motor', 'Vuelve a elegir');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text,
      jsonb_build_array(pg_temp.persona(v_t1), pg_temp.persona(current_setting('prueba.t4')))),
    'quien no trabaja ya en la planta no recibe', 'Inactivo Epp Iván no estaba en la planta');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text,
      jsonb_build_array(pg_temp.persona(current_setting('prueba.t5')))),
    'quien entró después de la salida no recibe de esa salida', 'Nueva Epp Nora no estaba en la planta');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_guante, (v_hoy + 90)::text,
      jsonb_build_array(pg_temp.persona(v_t1, 3), pg_temp.persona(v_t2, 2))),
    'no se reparte más de lo que salió y no volvió', 'quedan 4 por asignar y anotaste 5');
  perform test.afirmar((select count(*) from public.ssoma_epp_entregas) = 0, 'ningún rechazo dejó filas');

  -- Lo que entra: dos cascos de la salida de hace diez días, por seis meses.
  perform test.afirmar(public.ssoma_registrar_entregas_epp(v_e1::uuid, v_casco::uuid, v_d + 180, v_dos) = v_e1::uuid, 'SSOMA anota la entrega');
  perform test.afirmar(
    (select count(*) = 2 and bool_and(entregado_el = v_d and renovar_el = v_d + 180 and cantidad = 1
                                       and material_id = current_setting('prueba.casco')::uuid
                                       and creado_por = current_setting('prueba.ssoma')::uuid)
       from public.ssoma_epp_entregas where envio_id = v_e1::uuid),
    'una fila por persona, con el día de la salida y el equipo de la salida');
  -- El mismo envío repetido no duplica; con otro contenido, se dice.
  perform test.afirmar(public.ssoma_registrar_entregas_epp(v_e1::uuid, v_casco::uuid, v_d + 180, v_dos) = v_e1::uuid
    and (select count(*) from public.ssoma_epp_entregas) = 2, 'el mismo envío repetido devuelve lo que ya entró');
  perform test.debe_fallar(pg_temp.anotar(v_e1, v_casco, (v_d + 365)::text, v_dos),
    'el mismo envío con otra fecha no se finge guardado, y dice a quiénes quedó', 'la primera vez que la enviaste, a Operario Epp Óscar, Pintora Epp Pía:');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text, jsonb_build_array(pg_temp.persona(v_t1))),
    'la misma persona no figura dos veces en una salida', 'Operario Epp Óscar ya tiene anotada su entrega');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco, (v_d + 180)::text, jsonb_build_array(pg_temp.persona(v_t3, 2))),
    'queda uno solo de esa salida', 'queda 1 por asignar y anotaste 2');
  perform test.afirmar(
    (select asignado = 2 and por_asignar = 1 and dias_sugeridos = 180 from public.ssoma_salidas_de_epp(v_casco::uuid)),
    'la salida dice cuánto queda por asignar y propone la duración de la última vez');
  perform test.afirmar(
    (select persona = 'Operario Epp Óscar' and cargo = 'Soldador' and numero_salida like 'SA-%' and material like 'Casco%'
            and estado = 'VIGENTE' and situacion = 'AL_DIA' and dias = (v_d + 180 - v_hoy) and registro = 'Sara Seguridad' and en_planta
       from public.ssoma_epp_entregas_a_la_vista(v_t1::uuid, null, false)),
    'la entrega se lee con la persona, el número de la salida, el equipo y quién la anotó');
  reset role;

  -- Otra cuenta de SSOMA con el id de envío de la primera: no se le da por buena.
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.anotar(v_e1, v_casco, (v_d + 180)::text, v_dos),
    'el envío de otra persona no se confirma como propio', 'Vuelve a abrir la ventana');
  reset role;

  -- Lo que ven los demás ahora que hay entregas.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_epp_entregas) = 2
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, v_casco::uuid, false)) = 2
    and (select vigentes = 1 and vencidas = 0 and por_vencer = 0 and proxima = v_d + 180
           from public.ssoma_epp_por_persona(v_t1::uuid)),
    'Gerencia lee las entregas y lo que tiene cada persona');
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_epp_entregas) = 0
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, false)) = 0
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(v_t1::uuid, null, false)) = 0,
    'Ventas no lee ninguna entrega');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_epp_entregas) = 0
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, v_casco::uuid, false)) = 0,
    'Almacén registra la salida, pero no lee a quién le tocó');
  reset role;
  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_epp_entregas) = 0
    and not exists (select 1 from public.audit_log where tabla = 'ssoma_epp_entregas'),
    'el Supervisor General no la lee, ni por la auditoría');
  reset role;
end $$;

-- ============================================================ 3. Por renovar
select set_config('prueba.e2', gen_random_uuid()::text, true);
select set_config('prueba.e3', gen_random_uuid()::text, true);
select set_config('prueba.e4', gen_random_uuid()::text, true);
do $$
declare
  v_hoy    constant date := current_setting('prueba.hoy')::date;
  v_vieja  constant date := current_setting('prueba.d_vieja')::date;
  v_t2     constant uuid := current_setting('prueba.t2')::uuid;
  v_t3     constant uuid := current_setting('prueba.t3')::uuid;
  v_id     uuid;
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  -- El casco de hace 400 días, por un año: ya venció. Los guantes de hoy, por diez días: por vencer.
  perform public.ssoma_registrar_entregas_epp(current_setting('prueba.e2')::uuid, current_setting('prueba.s_vieja')::uuid, v_vieja + 365,
    jsonb_build_array(pg_temp.persona(v_t3::text)));
  perform public.ssoma_registrar_entregas_epp(current_setting('prueba.e3')::uuid, current_setting('prueba.s_guante')::uuid, v_hoy + 10,
    jsonb_build_array(pg_temp.persona(v_t2::text, 2)));
  perform test.afirmar(
    (select count(*) = 2
            and (array_agg(situacion order by renovar_el))[1] = 'VENCIDA' and (array_agg(situacion order by renovar_el))[2] = 'POR_VENCER'
            and (array_agg(trabajador_id order by renovar_el)) = array[v_t3, v_t2]
            and min(dias) = (v_vieja + 365 - v_hoy) and max(dias) = 10
       from public.ssoma_epp_entregas_a_la_vista(null, null, true)),
    'por renovar: lo vencido y lo que vence en 15 días, lo más atrasado primero; lo que está al día no');
  perform test.afirmar(
    (select vencidos = 1 and por_renovar = 2 from public.ssoma_epp_por_atender()),
    'la cuenta de SSOMA dice lo mismo sin armar la lista: 1 vencido de 2 por renovar');
  perform test.afirmar(
    (select vigentes = 1 and vencidas = 1 and por_vencer = 0 from public.ssoma_epp_por_persona(v_t3))
    and (select vigentes = 2 and vencidas = 0 and por_vencer = 1 and proxima = v_hoy + 10 from public.ssoma_epp_por_persona(v_t2)),
    'cada persona con lo que tiene vigente, vencido y por vencer');

  -- Se le entrega otro casco a Abel de la salida de hoy: reemplaza al vencido.
  perform public.ssoma_registrar_entregas_epp(current_setting('prueba.e4')::uuid, current_setting('prueba.s_casco_hoy')::uuid, v_hoy + 365,
    jsonb_build_array(pg_temp.persona(v_t3::text)));
  perform test.afirmar(
    (select estado = 'RENOVADA' and situacion is null from public.ssoma_epp_entregas_a_la_vista(v_t3, current_setting('prueba.s_vieja')::uuid, false))
    and (select estado = 'VIGENTE' and situacion = 'AL_DIA' from public.ssoma_epp_entregas_a_la_vista(v_t3, current_setting('prueba.s_casco_hoy')::uuid, false))
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true)) = 1
    and (select vigentes = 1 and vencidas = 0 from public.ssoma_epp_por_persona(v_t3)),
    'una entrega nueva del mismo equipo reemplaza a la anterior, que deja de estar por renovar');
  select id into v_id from public.ssoma_epp_entregas where envio_id = current_setting('prueba.e2')::uuid;
  perform test.debe_fallar(format('select public.ssoma_epp_no_se_renueva(%L, %L)', v_id, 'Ya tiene otro casco'),
    'lo que ya se renovó no se saca de por renovar', 'ya se le entregó otro igual');
  reset role;

  -- Pía deja la empresa (RR. HH.): lo suyo ya no está por renovar, y su hoja se sigue leyendo.
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  perform public.rrhh_dar_de_baja_trabajador(v_t2, v_hoy - 1);
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true)) = 0
    and not exists (select 1 from public.ssoma_epp_por_persona(null) where id = v_t2)
    and (select not en_planta and vigentes = 2 from public.ssoma_epp_por_persona(v_t2))
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(v_t2, null, false)) = 2,
    'quien dejó la planta no sale en por renovar ni en la lista; su hoja queda');
  reset role;
  perform test.como_usuario(current_setting('prueba.rrhh')::uuid);
  perform public.rrhh_dar_de_alta_trabajador(v_t2, v_hoy);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ============================================================ 4. «No se renueva» y anular
do $$
declare
  v_hoy     constant date := current_setting('prueba.hoy')::date;
  v_t2      constant uuid := current_setting('prueba.t2')::uuid;
  v_t3      constant uuid := current_setting('prueba.t3')::uuid;
  v_guantes uuid := (select id from public.ssoma_epp_entregas where envio_id = current_setting('prueba.e3')::uuid);
  v_nuevo   uuid := (select id from public.ssoma_epp_entregas where envio_id = current_setting('prueba.e4')::uuid);
  v_viejo   uuid := (select id from public.ssoma_epp_entregas where envio_id = current_setting('prueba.e2')::uuid);
begin
  -- Gerencia no saca de la lista ni anula.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_epp_no_se_renueva(%L, %L)', v_guantes, 'Pasó a oficina y ya no usa guantes'),
    'Gerencia no saca de por renovar', 'lo lleva SSOMA');
  perform test.debe_fallar(format('select public.ssoma_anular_entrega_epp(%L, %L)', v_guantes, 'Se anotó a la persona equivocada'),
    'Gerencia no anula', 'la anula SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_entrega_epp(%L, %L)', v_guantes, 'Se anotó a la persona equivocada'),
    'Almacén no anula', 'la anula SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true)) = 1, 'los guantes de Pía están por renovar');
  perform test.debe_fallar(format('select public.ssoma_epp_no_se_renueva(%L, %L)', v_guantes, 'no'), 'el motivo corto no entra', '5 a 300');
  perform public.ssoma_epp_no_se_renueva(v_guantes, 'Pasó a oficina y ya no usa guantes');
  perform test.afirmar(
    (select estado = 'SIN_RENOVACION' and situacion is null and saco_de_renovar = 'Sara Seguridad'
            and motivo_sin_renovacion = 'Pasó a oficina y ya no usa guantes' and sin_renovacion_en is not null
       from public.ssoma_epp_entregas_a_la_vista(v_t2, current_setting('prueba.s_guante')::uuid, false))
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true)) = 0
    and (select asignado = 2 and por_asignar = 2 from public.ssoma_salidas_de_epp(current_setting('prueba.s_guante')::uuid)),
    'sale de por renovar con su motivo y sigue contando en su salida');
  perform test.afirmar(public.ssoma_epp_no_se_renueva(v_guantes, 'Pasó a oficina y ya no usa guantes') = v_guantes,
    'el mismo pedido repetido entra sin cambiar nada');
  perform test.debe_fallar(format('select public.ssoma_epp_no_se_renueva(%L, %L)', v_guantes, 'Otro motivo distinto'),
    'el motivo no se cambia después', 'El motivo nuevo no se guardó');
  reset role;
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_epp_no_se_renueva(%L, %L)', v_guantes, 'Pasó a oficina y ya no usa guantes'),
    'a otra cuenta no se le finge que lo hizo ella', 'ya estaba fuera');
  reset role;

  -- Anular: con motivo, y lo asignado vuelve a quedar por asignar.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_entrega_epp(%L, %L)', v_nuevo, 'corto'), 'el motivo corto no anula', '10 a 500');
  perform test.debe_fallar(format('select public.ssoma_anular_entrega_epp(%L, %L)', gen_random_uuid(), 'Una entrega que no existe'), 'lo que no existe no se anula', 'no existe');
  perform public.ssoma_anular_entrega_epp(v_nuevo, 'Ese casco fue para otra persona');
  perform test.afirmar(
    (select estado = 'ANULADA' and anulo = 'Sara Seguridad' and motivo_anulacion = 'Ese casco fue para otra persona' and anulado_en is not null
       from public.ssoma_epp_entregas_a_la_vista(v_t3, current_setting('prueba.s_casco_hoy')::uuid, false))
    and (select asignado = 0 and por_asignar = 2 from public.ssoma_salidas_de_epp(current_setting('prueba.s_casco_hoy')::uuid)),
    'anulada con quién y por qué, y su cantidad vuelve a quedar por asignar');
  perform test.afirmar(
    (select estado = 'VIGENTE' and situacion = 'VENCIDA' from public.ssoma_epp_entregas_a_la_vista(v_t3, current_setting('prueba.s_vieja')::uuid, false))
    and (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true)) = 1,
    'anulada la que la reemplazaba, la anterior vuelve a estar por renovar');
  perform test.afirmar(public.ssoma_anular_entrega_epp(v_nuevo, 'Ese casco fue para otra persona') = v_nuevo, 'la misma anulación repetida entra');
  perform test.debe_fallar(format('select public.ssoma_anular_entrega_epp(%L, %L)', v_nuevo, 'Otro motivo para la misma'),
    'el motivo de la anulación no se cambia', 'El motivo nuevo no se guardó');
  perform test.debe_fallar(format('select public.ssoma_epp_no_se_renueva(%L, %L)', v_nuevo, 'Ya no usa casco'),
    'una anulada no se saca de por renovar', 'está anulada');
  -- La persona vuelve a entrar en esa salida.
  perform public.ssoma_registrar_entregas_epp(gen_random_uuid(), current_setting('prueba.s_casco_hoy')::uuid, v_hoy + 365,
    jsonb_build_array(pg_temp.persona(v_t3::text)));
  perform test.afirmar(
    (select count(*) from public.ssoma_epp_entregas_a_la_vista(v_t3, current_setting('prueba.s_casco_hoy')::uuid, false)) = 2
    and (select estado = 'RENOVADA' from public.ssoma_epp_entregas_a_la_vista(v_t3, current_setting('prueba.s_vieja')::uuid, false)),
    'después de anular se anota de nuevo, y queda la anulada como evidencia');
  reset role;
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_entrega_epp(%L, %L)', v_nuevo, 'Ese casco fue para otra persona'),
    'a otra cuenta no se le finge que anuló', 'ya estaba anulada');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  -- Por debajo de las funciones tampoco se borra ni se corrige.
  perform test.debe_fallar(format('delete from public.ssoma_epp_entregas where id = %L', v_viejo), 'una entrega no se borra', 'no se borra');
  perform test.debe_fallar(format('update public.ssoma_epp_entregas set cantidad = 9 where id = %L', v_viejo), 'una entrega no se corrige', 'no se corrige');
  perform test.debe_fallar(format('update public.ssoma_epp_entregas set renovar_el = renovar_el + 30 where id = %L', v_viejo),
    'la fecha de renovación no se mueve', 'no se corrige');
  perform test.debe_fallar(format('update public.ssoma_epp_entregas set motivo_anulacion = null, anulado_en = null, anulado_por = null where id = %L', v_nuevo),
    'una anulada no revive', 'queda como evidencia');
  perform test.debe_fallar(format('update public.ssoma_epp_entregas set motivo_sin_renovacion = %L where id = %L', 'Otro motivo, por debajo', v_guantes)
      || '; select 1 / (case when (select motivo_sin_renovacion from public.ssoma_epp_entregas where id = ''' || v_guantes || ''') = ''Pasó a oficina y ya no usa guantes'' then 0 else 1 end)',
    'el motivo de «no se renueva» no se cambia por debajo', 'division by zero');
end $$;

-- ============================================================ 4b. Lo que queda de una salida y no va por persona
do $$
declare
  v_casco constant uuid := current_setting('prueba.s_casco')::uuid;
  v_id    uuid;
begin
  -- Gerencia y Almacén no dicen qué se reparte.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', v_casco, 'Ese casco fue para una visita'),
    'Gerencia no dice que una salida no va por persona', 'lo lleva SSOMA');
  perform test.debe_fallar(format('select public.ssoma_epp_salida_se_reparte(%L)', v_casco), 'Gerencia no lo deshace', 'lo lleva SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', v_casco, 'Ese casco fue para una visita'),
    'Almacén tampoco', 'lo lleva SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', v_casco, 'no'), 'el motivo corto no entra', '5 a 300');
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', current_setting('prueba.s_disco'), 'Un disco no es EPP'),
    'lo que no es EPP no entra', 'no es de EPP');
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', current_setting('prueba.s_vieja'), 'Ya está todo repartido'),
    'una salida ya repartida entera no entra', 'ya no queda nada por asignar');
  v_id := public.ssoma_epp_salida_sin_reparto(v_casco, 'Ese casco fue para una visita');
  perform test.afirmar(
    (select sin_reparto and motivo_sin_reparto = 'Ese casco fue para una visita' and dijo_sin_reparto = 'Sara Seguridad'
            and asignado = 2 and por_asignar = 1
       from public.ssoma_salidas_de_epp(v_casco)),
    'la salida dice que lo que queda no va por persona, quién lo dijo y por qué; lo asignado sigue igual');
  perform test.afirmar(public.ssoma_epp_salida_sin_reparto(v_casco, 'Ese casco fue para una visita') = v_id
    and (select count(*) from public.ssoma_epp_sin_reparto) = 1, 'el mismo pedido repetido no agrega otro');
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', v_casco, 'Otro motivo distinto'),
    'el reenvío de la misma cuenta con otro motivo dice que ya quedó la primera vez, y con cuál', 'la primera vez que lo enviaste, con este motivo: «Ese casco fue para una visita»');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_casco::text, (current_setting('prueba.hoy')::date + 90)::text,
      jsonb_build_array(pg_temp.persona(current_setting('prueba.t3')))),
    'lo que no va por persona no se reparte sin deshacerlo', 'no va por persona');
  reset role;

  -- La otra cuenta de SSOMA lo deshace; queda quién.
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_epp_salida_sin_reparto(%L, %L)', v_casco, 'Ese casco fue para una visita'),
    'a otra cuenta no se le finge que lo dijo ella', 'ya se dijo');
  perform test.afirmar(public.ssoma_epp_salida_se_reparte(v_casco) = v_casco, 'otra cuenta de SSOMA lo deshace');
  perform test.afirmar(
    (select not sin_reparto and motivo_sin_reparto is null and por_asignar = 1 from public.ssoma_salidas_de_epp(v_casco))
    and (select deshecho_por = current_setting('prueba.ssoma2')::uuid and deshecho_en is not null from public.ssoma_epp_sin_reparto where id = v_id),
    'se deshace: la salida vuelve a esperar su reparto y queda quién lo deshizo');
  perform test.afirmar(public.ssoma_epp_salida_se_reparte(v_casco) = v_casco, 'deshacer dos veces no falla ni cambia nada');
  reset role;

  -- Se puede decir otra vez, con otro motivo; lo anterior queda.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_epp_salida_sin_reparto(v_casco, 'Se quedó de repuesto en la caseta');
  perform test.afirmar((select count(*) from public.ssoma_epp_sin_reparto where movimiento_id = v_casco) = 2
    and (select motivo_sin_reparto = 'Se quedó de repuesto en la caseta' from public.ssoma_salidas_de_epp(v_casco)),
    'después de deshacerlo se dice otra vez; lo de antes queda como evidencia');
  perform public.ssoma_epp_salida_se_reparte(v_casco);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_epp_sin_reparto) = 2, 'Gerencia lo lee');
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_epp_sin_reparto) = 0, 'Ventas no');
  reset role;
  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_epp_sin_reparto) = 0
    and not exists (select 1 from public.audit_log where tabla = 'ssoma_epp_sin_reparto'), 'el Supervisor General tampoco, ni por la auditoría');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);

  perform test.debe_fallar(format('delete from public.ssoma_epp_sin_reparto where id = %L', v_id), 'no se borra', 'no se borra');
  perform test.debe_fallar(format('update public.ssoma_epp_sin_reparto set deshecho_en = null, deshecho_por = null where id = %L', v_id),
    'lo deshecho no revive', 'ya se deshizo');
end $$;

-- ============================================================ 5. El kardex no cambió; una devolución posterior se dice
do $$
declare
  v_guante constant uuid := current_setting('prueba.s_guante')::uuid;
begin
  perform test.afirmar(
    (select md5(string_agg(to_jsonb(k)::text, '|' order by k.id)) from public.movimientos_materiales k) = current_setting('prueba.kardex'),
    'el kardex de Almacén quedó idéntico después de todo lo que anotó SSOMA');
  -- Almacén recibe de vuelta 3 guantes más: de 5 salieron, 4 volvieron y hay 2 asignados.
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, devolucion_de, registrado_por)
  values (gen_random_uuid(), 'INGRESO', 'DEVOLUCION', current_setting('prueba.guante')::uuid, 3, 'Devolución del check 493', v_guante,
          current_setting('prueba.almacen')::uuid);
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select devuelto = 4 and asignado = 2 and por_asignar = 0 and asignado_de_mas = 1 from public.ssoma_salidas_de_epp(v_guante))
    and exists (select 1 from public.ssoma_salidas_de_epp(null) where movimiento_id = v_guante and asignado_de_mas = 1),
    'si vuelve a Almacén más de lo que quedaba sin asignar, la salida dice cuánto hay asignado de más');
  perform test.debe_fallar(pg_temp.anotar(gen_random_uuid()::text, v_guante::text, (current_setting('prueba.hoy')::date + 90)::text,
      jsonb_build_array(pg_temp.persona(current_setting('prueba.t1')))),
    'de una salida sin nada por asignar no se anota', 'ya no queda nada por asignar');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ============================================================ 5b. Lo que encontraron los auditores de la 15.5
-- Una salida de hace 100 días, que todavía espera, y dos personas que ya se
-- fueron: Lía hace 70 días (estaba ese día) y Hugo hace 200.
select test.como_usuario(:'admin_id');
do $$
declare
  v     uuid;
  v_hoy constant date := current_setting('prueba.hoy')::date;
begin
  v := gen_random_uuid();
  insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por, registrado_en)
  values (v, 'SALIDA', 'SALIDA_GENERAL', current_setting('prueba.casco')::uuid, 2, 'Vale del check 493', 'Julio Ramírez', 'CHK493',
          current_setting('prueba.almacen')::uuid, now() - interval '100 days');
  perform set_config('prueba.s_cien', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, activo, fecha_ingreso, fecha_baja)
  values ('Lía', 'Lejana Epp', '49349306', 'Ayudante', (select id from public.areas where codigo = 'PRD'), false, v_hoy - 300, v_hoy - 70)
  returning id into v;
  perform set_config('prueba.t6', v::text, true);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, activo, fecha_ingreso, fecha_baja)
  values ('Hugo', 'Hace Mucho Epp', '49349307', 'Ayudante', (select id from public.areas where codigo = 'PRD'), false, v_hoy - 500, v_hoy - 200)
  returning id into v;
  perform set_config('prueba.t7', v::text, true);
end $$;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare
  v_cien  constant uuid := current_setting('prueba.s_cien')::uuid;
  v_hoy   constant date := current_setting('prueba.hoy')::date;
  v_t5    constant uuid := current_setting('prueba.t5')::uuid;
  v_t6    constant uuid := current_setting('prueba.t6')::uuid;
  v_t7    constant uuid := current_setting('prueba.t7')::uuid;
  v_antes record;
  v_ahora record;
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  -- La lista para marcar llega tan atrás como las salidas que esperan: 180 días.
  perform test.afirmar(
    (select not en_planta from public.ssoma_personal_para_epp() where id = v_t6)
    and not exists (select 1 from public.ssoma_personal_para_epp() where id = v_t7),
    'la lista trae a quien se fue hace 70 días y no a quien se fue hace 200');
  -- Cada salida dice quién de la lista no estaba ese día: la ventana no los ofrece.
  perform test.afirmar(
    (select por_asignar = 2 and v_t5 = any (no_estaban) and not v_t6 = any (no_estaban)
       from public.ssoma_salidas_de_epp(null) where movimiento_id = v_cien),
    'la salida de hace 100 días espera en la lista y dice que Nora, que entró hoy, no estaba; Lía sí');
  perform test.afirmar(
    (select v_t6 = any (no_estaban) and not v_t5 = any (no_estaban)
       from public.ssoma_salidas_de_epp(current_setting('prueba.s_casco_hoy')::uuid)),
    'la de hoy dice lo contrario: Lía ya no estaba y Nora sí');
  -- A quién le tocó viene con la salida misma, sin las anuladas.
  perform test.afirmar(
    (select bool_and((select coalesce(array_agg(x.id order by x.id), '{}') from jsonb_to_recordset(s.a_quien) as x(id uuid))
                     = (select coalesce(array_agg(e.id order by e.id), '{}') from public.ssoma_epp_entregas e
                         where e.movimiento_id = s.movimiento_id and e.anulado_en is null))
            and bool_or(jsonb_array_length(s.a_quien) > 0)
       from public.ssoma_salidas_de_epp(null) s)
    and exists (select 1 from public.ssoma_salidas_de_epp(null) s, jsonb_to_recordset(s.a_quien) as x(trabajador_id uuid, persona text, cantidad numeric)
                 where x.persona like '% Epp %' and x.cantidad > 0 and x.trabajador_id is not null),
    'cada salida trae a quién le tocó (persona y cantidad), sin las entregas anuladas');
  -- A Lía sí se le anota la de hace 100 días: estaba ese día.
  perform public.ssoma_registrar_entregas_epp(gen_random_uuid(), v_cien, v_hoy + 90, jsonb_build_array(pg_temp.persona(v_t6::text)));
  perform test.afirmar(
    (select asignado = 1 and por_asignar = 1 and a_quien -> 0 ->> 'persona' = 'Lejana Epp Lía' from public.ssoma_salidas_de_epp(v_cien)),
    'a quien se fue hace 70 días se le anota la salida de antes de irse');
  -- Marcada «no va por persona», sigue en la lista: si no, no habría dónde deshacerlo.
  perform public.ssoma_epp_salida_sin_reparto(v_cien, 'El otro casco quedó de repuesto');
  perform test.afirmar(
    (select sin_reparto and por_asignar = 1 from public.ssoma_salidas_de_epp(null) where movimiento_id = v_cien),
    'una salida de hace 100 días marcada «no va por persona» sigue en la lista, para poder deshacerlo');
  select * into v_antes from public.ssoma_epp_por_atender();
  perform public.ssoma_epp_salida_se_reparte(v_cien);
  select * into v_ahora from public.ssoma_epp_por_atender();
  perform test.afirmar(
    v_ahora.por_asignar = v_antes.por_asignar + 1
    and v_ahora.por_asignar = (select count(*) from public.ssoma_salidas_de_epp(null) where por_asignar > 0 and not sin_reparto)
    and v_ahora.vencidos = (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true) where situacion = 'VENCIDA')
    and v_ahora.por_renovar = (select count(*) from public.ssoma_epp_entregas_a_la_vista(null, null, true)),
    'los pendientes de SSOMA cuentan las salidas que esperan reparto, lo vencido y lo por renovar, como la pantalla');
  -- «Repartir» no contesta «listo» a lo que no es una salida de EPP.
  perform test.debe_fallar(format('select public.ssoma_epp_salida_se_reparte(%L)', current_setting('prueba.s_disco')),
    '«Repartir» no acepta una salida que no es de EPP', 'no es de EPP');
  perform test.debe_fallar(format('select public.ssoma_epp_salida_se_reparte(%L)', gen_random_uuid()),
    '«Repartir» no acepta una salida que no existe', 'no es de EPP');
  reset role;

  -- Quién no estaba en la planta lo dice la salida con la regla escrita en su consulta: tiene que dar
  -- lo mismo que `ssoma_estuvo_en_la_planta`, la que usa la base al anotar. Par por par, y también
  -- con quien volvió a entrar: Nora entró hoy, pero RR. HH. le guarda un periodo de hace 300 a 90 días.
  perform test.afirmar(
    (select v_t5 = any (no_estaban) from public.ssoma_salidas_de_epp(v_cien)),
    'antes del periodo anterior, Nora no estaba el día de la salida de hace 100 días');
  insert into public.trabajador_periodos (trabajador_id, ingreso, baja, registrado_por)
  values (v_t5, v_hoy - 300, v_hoy - 90, current_setting('prueba.ssoma')::uuid);
  perform test.afirmar(
    (select not v_t5 = any (no_estaban) from public.ssoma_salidas_de_epp(v_cien)),
    'con un periodo anterior que cubre ese día, la salida ya no dice que Nora no estaba');
  perform test.afirmar(
    (select count(*) >= 10 and count(*) filter (where t.id = any (s.no_estaban)) >= 2
        and bool_and((t.id = any (s.no_estaban))
                     = (not public.ssoma_estuvo_en_la_planta(t.id, t.activo, t.fecha_ingreso, t.fecha_baja, s.fecha, s.fecha + 1)))
       from public.ssoma_salidas_de_epp(null) s cross join public.trabajadores t
      where s.por_asignar > 0 and (t.activo or t.fecha_baja >= public.ssoma_hoy() - 180)),
    'quién no estaba sale igual que con la regla de RR. HH. que usa la base al anotar, par por par');

  -- Gerencia lee a quién le tocó, pero no la lista de quién no estaba: no anota.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select jsonb_array_length(a_quien) = 1 and no_estaban = '{}' from public.ssoma_salidas_de_epp(v_cien)),
    'Gerencia ve a quién le tocó y no recibe quién no estaba en la planta');
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select por_asignar = 0 and vencidos = 0 from public.ssoma_epp_por_atender()), 'a Ventas los pendientes de EPP le dan cero');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ============================================================ 6. Un lote de prueba se limpia entero
select test.crear_usuario('Lote', 'Prueba', 'lote493@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as lote_usuario \gset
insert into public.pruebas_cuentas (usuario_id, motivo) values (:'lote_usuario', 'check 493');
select public.pruebas_abrir('check 493: una entrega de EPP de prueba', array[:'lote_usuario'::uuid]) as lote \gset
select set_config('prueba.lote', :'lote', true);
select set_config('prueba.lote_e', gen_random_uuid()::text, true);
select set_config('prueba.lote_usuario', :'lote_usuario', true);
do $$
declare
  v_e uuid := current_setting('prueba.lote_e')::uuid;
  v_antes integer := (select count(*) from public.ssoma_epp_entregas);
begin
  perform test.como_usuario(current_setting('prueba.lote_usuario')::uuid);
  set local role authenticated;
  perform public.ssoma_registrar_entregas_epp(v_e, current_setting('prueba.s_casco')::uuid, current_setting('prueba.hoy')::date + 200,
    jsonb_build_array(pg_temp.persona(current_setting('prueba.t3'))));
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform test.afirmar((select count(*) from public.ssoma_epp_entregas where envio_id = v_e) = 1, 'el lote anotó su entrega');
  perform public.pruebas_limpiar(current_setting('prueba.lote')::uuid);
  perform test.afirmar(
    not exists (select 1 from public.ssoma_epp_entregas where envio_id = v_e)
    and (select count(*) from public.ssoma_epp_entregas) = v_antes
    and (select md5(string_agg(to_jsonb(k)::text, '|' order by k.id)) from public.movimientos_materiales k
          where (k.devolucion_de is distinct from current_setting('prueba.s_guante')::uuid or k.cantidad::numeric <> 3)
            -- la salida de hace 100 días la agregó la sección 5b, después de tomar la huella
            and k.id <> current_setting('prueba.s_cien')::uuid) = current_setting('prueba.kardex'),
    'el lote de prueba se lleva su entrega y deja las reales y el kardex');
end $$;

rollback;
