\set ON_ERROR_STOP on
-- Las fechas reales de una etapa salen del día que dicen los reportes.
--
-- Diseño arma una etapa de Producción; Supervisión de Producción le pone dos
-- tareas de 50 % y reporta con fechas atrasadas, como pasa cuando el lunes se
-- carga lo del viernes:
--   · la primera tarea al 100 % con fecha de hace seis días: la etapa empezó
--     ese día, va al 50 % y no tiene fin;
--   · la segunda al 100 % con fecha de antier: la etapa terminó antier, no hoy;
--   · el supervisor corrige la fecha del primer reporte a hace ocho días: el
--     inicio se mueve con él;
--   · borra el reporte de la segunda: la etapa se reabre y pierde el fin.
-- Gerencia lee la etapa con su rol real. Las fechas son el mediodía de Lima.
begin;

select test.crear_usuario('QA','Admin','qa-317-admin@demo.pe','ADMIN',
  (select id from public.sedes order by nombre limit 1)) as admin_id \gset
select test.crear_usuario('QA','Diseño','qa-317-diseno@demo.pe','DISENO',
  (select id from public.sedes order by nombre limit 1)) as diseno_id \gset
select test.crear_usuario('QA','Producción','qa-317-produccion@demo.pe','SUPERVISOR',
  (select id from public.sedes order by nombre limit 1)) as supervisor_id \gset
select test.crear_usuario('QA','Gerencia','qa-317-gerencia@demo.pe','GERENTE',
  (select id from public.sedes order by nombre limit 1)) as gerencia_id \gset
select gen_random_uuid() as orden_id \gset
select gen_random_uuid() as etapa_id \gset

-- El área decide de quién es cada hoja; la pone ADMIN (trigger de personal).
select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD')
 where id = :'supervisor_id';

insert into public.clientes(tipo_documento,numero_documento,razon_social)
values ('RUC','20990000317','QA fechas reales de etapa');
insert into public.ordenes_trabajo(id,numero,cliente_id,sede_id,tipo_trabajo,
  prioridad,descripcion,estado)
select :'orden_id','9317-2099',c.id,s.id,'FABRICACION','NORMAL',
  'Orden QA de las fechas reales de etapa','APROBADA'
from public.clientes c cross join public.sedes s
where c.numero_documento='20990000317' order by s.nombre limit 1;

-- Las fotos de evidencia ya subidas: el reporte exige que existan.
insert into storage.objects(bucket_id, name, owner_id, metadata)
select 'fotos-avance', 'ot/' || :'orden_id' || '/taller/qa-317-' || n || '.jpg',
       :'supervisor_id', '{"mimetype":"image/jpeg","size":100}'::jsonb
  from unnest(array['a', 'b']) n;

select set_config('prueba.fr.orden', :'orden_id', true);
select set_config('prueba.fr.etapa', :'etapa_id', true);
select set_config('prueba.fr.diseno', :'diseno_id', true);
select set_config('prueba.fr.supervisor', :'supervisor_id', true);
select set_config('prueba.fr.gerencia', :'gerencia_id', true);

do $test$
declare
  v_orden uuid := current_setting('prueba.fr.orden')::uuid;
  v_etapa uuid := current_setting('prueba.fr.etapa')::uuid;
  v_prd uuid := (select id from public.areas where codigo = 'PRD');
  v_a uuid;
  v_b uuid;
  v_rep_a uuid;
  v_rep_b uuid;
  e record;
  mediodia constant text := '12:00';
begin
  -- Diseño define la etapa.
  perform test.como_usuario(current_setting('prueba.fr.diseno')::uuid);
  set local role authenticated;
  perform public.guardar_etapas_libres(v_orden, jsonb_build_array(
    jsonb_build_object('id', v_etapa, 'nombre', 'Armado y soldadura', 'area_id', v_prd, 'peso_pct', 100)), null);
  reset role;

  -- Supervisión de Producción arma sus dos tareas y reporta con fecha atrasada.
  perform test.como_usuario(current_setting('prueba.fr.supervisor')::uuid);
  set local role authenticated;
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, v_etapa, 1, 'Bastidor QA', 50) returning id into v_a;
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, v_etapa, 2, 'Compuerta QA', 50) returning id into v_b;

  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_a, v_orden, current_date - 6, 100, 'Bastidor cuadrado y soldado',
          'ot/' || v_orden || '/taller/qa-317-a.jpg') returning id into v_rep_a;

  select estado, avance_porcentaje, fecha_inicio_real, fecha_fin_real into e
    from public.ot_etapas where id = v_etapa;
  if e.avance_porcentaje <> 50 or e.estado <> 'EN_PROCESO' then
    raise exception 'FALLO: con una tarea al 100 %% la etapa debía ir al 50 %% en proceso; va al % en %', e.avance_porcentaje, e.estado;
  end if;
  if (e.fecha_inicio_real at time zone 'America/Lima') <> (current_date - 6) + mediodia::time then
    raise exception 'FALLO: el inicio real debía ser el día del reporte (%), es %', current_date - 6, e.fecha_inicio_real;
  end if;
  if e.fecha_fin_real is not null then
    raise exception 'FALLO: una etapa al 50 %% no tiene fin real, tiene %', e.fecha_fin_real;
  end if;

  -- Hoy se carga lo de antier y la etapa llega al 100 %.
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_b, v_orden, current_date - 2, 100, 'Compuerta montada',
          'ot/' || v_orden || '/taller/qa-317-b.jpg') returning id into v_rep_b;
  select estado, avance_porcentaje, fecha_inicio_real, fecha_fin_real into e
    from public.ot_etapas where id = v_etapa;
  if e.estado <> 'TERMINADA' then
    raise exception 'FALLO: con las dos tareas al 100 %% la etapa debía terminar; está en %', e.estado;
  end if;
  if (e.fecha_fin_real at time zone 'America/Lima') <> (current_date - 2) + mediodia::time then
    raise exception 'FALLO: el fin real debía ser el día del último reporte (%), no el de la carga: es %', current_date - 2, e.fecha_fin_real;
  end if;

  -- El supervisor corrige el día de su primer reporte: el inicio lo sigue.
  update public.ot_actividad_avances set fecha = current_date - 8 where id = v_rep_a;
  select fecha_inicio_real into e from public.ot_etapas where id = v_etapa;
  if (e.fecha_inicio_real at time zone 'America/Lima') <> (current_date - 8) + mediodia::time then
    raise exception 'FALLO: corregida la fecha del reporte, el inicio debía pasar a %; es %', current_date - 8, e.fecha_inicio_real;
  end if;

  -- Borra el reporte de la compuerta: la etapa se reabre y pierde el fin.
  delete from public.ot_actividad_avances where id = v_rep_b;
  select estado, avance_porcentaje, fecha_fin_real into e from public.ot_etapas where id = v_etapa;
  if e.estado <> 'EN_PROCESO' or e.avance_porcentaje <> 50 then
    raise exception 'FALLO: sin el reporte de la compuerta la etapa debía volver al 50 %% en proceso; está en % al %', e.estado, e.avance_porcentaje;
  end if;
  if e.fecha_fin_real is not null then
    raise exception 'FALLO: una etapa reabierta no conserva su fecha de fin: tiene %', e.fecha_fin_real;
  end if;

  -- Vuelve a terminar con un reporte de ayer: el fin es el nuevo, no el viejo.
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_b, v_orden, current_date - 1, 100, 'Compuerta rehecha',
          'ot/' || v_orden || '/taller/qa-317-b.jpg');
  reset role;

  -- Gerencia lee la etapa con su rol real.
  perform test.como_usuario(current_setting('prueba.fr.gerencia')::uuid);
  set local role authenticated;
  select estado, fecha_inicio_real, fecha_fin_real into e from public.ot_etapas where id = v_etapa;
  if e.estado is null then
    raise exception 'FALLO: Gerencia no ve la etapa';
  end if;
  if e.estado <> 'TERMINADA'
     or (e.fecha_inicio_real at time zone 'America/Lima')::date <> current_date - 8
     or (e.fecha_fin_real at time zone 'America/Lima')::date <> current_date - 1 then
    raise exception 'FALLO: Gerencia ve la etapa % del % al %; debía ser TERMINADA del % al %',
      e.estado, e.fecha_inicio_real, e.fecha_fin_real, current_date - 8, current_date - 1;
  end if;
  reset role;

  raise notice '  ok · la etapa empieza y termina el día de sus reportes, y al reabrirse pierde el fin';
end;
$test$;

rollback;
