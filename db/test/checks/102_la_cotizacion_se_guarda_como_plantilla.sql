-- La ficha de una cotización se guarda como plantilla de su carrocería desde la
-- misma pantalla (migración 073), y las puertas que esa migración cerró siguen
-- cerradas: funciones internas fuera del alcance de la gente, vistas que corren
-- como quien consulta y ninguna política «para todo».
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000016', 'PRUEBAS PLANTILLA DESDE COTIZACION S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana', 'Torres', 'ana@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset
select test.como_usuario(:'admin_id');
select test.crear_usuario('Dina', 'Rojas', 'dina@demo.pe', 'DISENO', (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Omar', 'Paz', 'omar@demo.pe', 'OPERARIO', (select id from public.sedes limit 1)) as operario_id \gset

-- psql no interpola :'var' dentro de $$: los IDs viajan por set_config.
select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.operario', :'operario_id', true);

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20526331762', 'MENBER INGENIERIA S.A.C.');

-- ------------------------------------------------- Diseño guarda la ficha
do $$
declare
  v_pla    uuid;
  v_cot    uuid;
  v_p      uuid;
  v_lineas int;
  v_acc    int;
begin
  select id into v_pla from public.tipos_carroceria where codigo = 'PLA';

  -- Una cotización de plataforma nace con la predeterminada; se retoca una
  -- línea para poder distinguir después lo que salió de la cotización.
  insert into public.cotizaciones (cliente_id, sede_id, tipo_carroceria_id, fecha_emision)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), v_pla, current_date)
  returning id into v_cot;
  update public.cotizacion_especificaciones
     set detalle = detalle || ' (retocado en la prueba)'
   where cotizacion_id = v_cot and orden_seccion = 1 and orden_linea = 1;
  select count(*) into v_lineas from public.cotizacion_especificaciones where cotizacion_id = v_cot;
  select count(*) into v_acc    from public.cotizacion_accesorios        where cotizacion_id = v_cot;
  perform set_config('prueba.cot', v_cot::text, true);

  -- Quien arma la ficha es Diseño (cotizaciones.costear), no el administrador.
  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  v_p := public.guardar_cotizacion_como_plantilla(v_cot, 'Plataforma de la prueba', false);

  perform test.afirmar(
    (select count(*) from public.plantilla_ficha_lineas     where plantilla_id = v_p) = v_lineas
    and (select count(*) from public.plantilla_ficha_accesorios where plantilla_id = v_p) = v_acc,
    format('la plantilla copia la ficha entera (%s líneas, %s accesorios)', v_lineas, v_acc));
  perform test.afirmar(
    exists (select 1 from public.plantilla_ficha_lineas where plantilla_id = v_p and detalle like '%(retocado en la prueba)'),
    'copia lo escrito en la cotización, no lo de la plantilla de origen');
  perform test.afirmar(
    (select fuentes from public.plantillas_ficha where id = v_p)
      = array['COT ' || (select numero from public.cotizaciones where id = v_cot)]
    and not (select predeterminada from public.plantillas_ficha where id = v_p),
    'anota de qué cotización sale y no se vuelve predeterminada si no se pide');
  raise notice '  ok · Diseño guarda la ficha de la cotización como plantilla de su carrocería';

  -- Regrabar con el mismo nombre reemplaza; pedirla predeterminada la deja sola.
  perform public.guardar_cotizacion_como_plantilla(v_cot, 'Plataforma de la prueba', true);
  perform test.afirmar(
    (select count(*) from public.plantillas_ficha where tipo_carroceria_id = v_pla and nombre = 'Plataforma de la prueba') = 1
    and (select count(*) from public.plantillas_ficha where tipo_carroceria_id = v_pla and predeterminada) = 1
    and (select predeterminada from public.plantillas_ficha where id = v_p),
    'regrabar no duplica y la predeterminada sigue siendo una sola');
  raise notice '  ok · regrabar reemplaza, y la predeterminada es una sola';

  -- La siguiente cotización de esa carrocería nace con la plantilla guardada.
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  insert into public.cotizaciones (cliente_id, sede_id, tipo_carroceria_id, fecha_emision)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), v_pla, current_date)
  returning id into v_cot;
  perform test.afirmar(
    exists (select 1 from public.cotizacion_especificaciones where cotizacion_id = v_cot and detalle like '%(retocado en la prueba)'),
    'la siguiente cotización de la carrocería nace con la plantilla guardada');
  raise notice '  ok · la siguiente cotización nace con la plantilla nueva';
end $$;

-- ------------------------------------------------- lo que no se guarda
select test.como_usuario(:'operario_id');
select test.debe_fallar(
  format('select public.guardar_cotizacion_como_plantilla(%L, %L, false)', current_setting('prueba.cot'), 'Plantilla del operario'),
  'quien no costea no guarda plantillas');
-- Una orden que no ve —una que no existe lo es por definición— no se arma.
select test.debe_fallar(
  'select public.armar_ficha_ot(gen_random_uuid())',
  'armar la ficha de una orden que no le corresponde se rechaza');

select test.como_usuario(:'admin_id');
do $$
declare
  v_cot uuid;
begin
  insert into public.cotizaciones (cliente_id, sede_id, fecha_emision)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), current_date)
  returning id into v_cot;
  perform test.debe_fallar(
    format('select public.guardar_cotizacion_como_plantilla(%L, %L, false)', v_cot, 'Sin carrocería'),
    'sin carrocería elegida no hay dónde colgar la plantilla');
  perform test.debe_fallar(
    format('select public.guardar_cotizacion_como_plantilla(%L, %L, false)', current_setting('prueba.cot'), 'ab'),
    'el nombre tiene que ser reconocible');
  raise notice '  ok · sin permiso, sin carrocería o sin nombre no se guarda nada';
end $$;

-- ------------------------------------------------- las puertas siguen cerradas
do $$
declare
  v_abiertas text;
  v_cuantas  int;
begin
  -- Las funciones que solo llama otra función de la base no atienden a nadie.
  select string_agg(p.proname, ', ' order by p.proname), count(*)
    into v_abiertas, v_cuantas
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('notificar_a_permiso', 'notificar_a_usuario', 'plantilla_de_la_carroceria',
                       'tipo_cambio_exigido', 'sembrar_verificacion', 'cotizacion_sembrar_etapas',
                       'generar_presupuesto_desde_cotizacion', 'sembrar_plantilla_ficha')
     and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_cuantas > 0 then
    raise exception 'FALLA: % funciones internas al alcance de la gente: %', v_cuantas, v_abiertas;
  end if;

  -- Ninguna vista corre como su dueño: todas respetan el RLS de sus tablas.
  select string_agg(c.relname, ', ' order by c.relname), count(*)
    into v_abiertas, v_cuantas
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
     and not (coalesce(array_to_string(c.reloptions, ','), '') ~* 'security_invoker=(true|on)');
  if v_cuantas > 0 then
    raise exception 'FALLA: % vistas corren como dueño y saltan el RLS: %', v_cuantas, v_abiertas;
  end if;

  -- Ninguna política «para todo»: leer se evalúa una sola vez.
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname), count(*)
    into v_abiertas, v_cuantas
    from pg_policies
   where schemaname = 'public' and cmd = 'ALL';
  if v_cuantas > 0 then
    raise exception 'FALLA: % políticas para todo conviven con la de lectura: %', v_cuantas, v_abiertas;
  end if;

  raise notice '  ok · internas cerradas, vistas como quien consulta, ninguna política para todo';
end $$;

rollback;
