-- Cada área arma su lista y reporta lo suyo. Este check aprieta las cuatro
-- cosas que pueden mentir:
--
--   1. Que el avance de un área salga ponderado por el peso de sus actividades
--      y NO se mezcle con el de la otra: cada una tiene su propio 100 %.
--   2. Que el reporte diario sume —es incremental, «hoy avancé 15 %»— y que dos
--      días distintos se acumulen.
--   3. Que quien no es jefe de área no pueda armar la lista, aunque sí pueda
--      reportar. Es la separación de manos de siempre.
--   4. Que los topes del 100 % los ponga la base y no la pantalla: ni los pesos
--      de un área ni lo reportado de una actividad pueden pasarse.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS ACTIVIDADES S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Aldo', 'Quiroz', 'aldo@demo.pe', 'ADMIN',      (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Teo',  'Alva',   'teo@demo.pe',  'SUPERVISOR', (select id from public.sedes limit 1)) as supervisor_id \gset
select test.crear_usuario('Aure', 'Ramirez','aure@demo.pe', 'JEFE_TALLER',(select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Luis', 'Ochoa',  'luis@demo.pe', 'OPERARIO',   (select id from public.sedes limit 1)) as operario_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

select test.como_usuario(:'admin_id');
set local role authenticated;

do $$
declare v_orden uuid;
begin
  insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  values ((select id from public.clientes limit 1),
          (select id from public.sedes limit 1),
          'Tolva de prueba del avance por área')
  returning id into v_orden;

  perform set_config('prueba.orden', v_orden::text, false);
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), false);
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), false);
end $$;

reset role;

-- ------------------------------- el operario reporta, pero no arma la lista
select test.como_usuario(:'operario_id');
set local role authenticated;

select test.debe_fallar(
  format($sql$insert into public.ot_actividades (orden_id, area_id, nombre, peso_pct)
              values (%L, %L, 'La que el operario no debe crear', 10)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.prd')),
  'un operario no arma la lista de actividades del área');

reset role;

-- ------------------------------------ Producción arma lo suyo y reporta
select test.como_usuario(:'supervisor_id');
set local role authenticated;

do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_prd   uuid := current_setting('prueba.prd')::uuid;
  v_act   uuid;
begin
  insert into public.ot_actividades (orden_id, area_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, 1, 'Armado de estructura del cajón', 60)
  returning id into v_act;

  insert into public.ot_actividades (orden_id, area_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, 2, 'Montaje de compuerta', 40);

  perform set_config('prueba.actividad', v_act::text, false);

  -- Dos días: el reporte es lo del día y se acumula.
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota)
  values (v_act, v_orden, current_date - 1, 15, 'Se cuadró el bastidor');
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota)
  values (v_act, v_orden, current_date, 25, 'Laterales soldados');

  perform test.afirmar(
    (select avance_pct from public.v_ot_actividades where id = v_act) = 40,
    'el reporte diario se acumula: 15 + 25 son 40');

  -- 60 % de la actividad al 40 %, 40 % de la otra al 0: el área va al 24 %.
  perform test.afirmar(
    (select avance_pct from public.v_ot_avance_areas
      where orden_id = v_orden and area_id = v_prd) = 24,
    'el área avanza ponderado por el peso de cada actividad');
end $$;

-- Entre todas las actividades de un área no se pasa de 100 % de peso.
select test.debe_fallar(
  format($sql$insert into public.ot_actividades (orden_id, area_id, nombre, peso_pct)
              values (%L, %L, 'La que hace pasar de 100', 20)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.prd')),
  'los pesos de un área no pasan de 100',
  'no pueden pasar de 100');

-- Ni lo reportado del 100 % de una actividad.
select test.debe_fallar(
  format($sql$insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct)
              values (%L, %L, current_date + 1, 70)$sql$,
         current_setting('prueba.actividad'), current_setting('prueba.orden')),
  'lo reportado no pasa del 100 % de la actividad',
  'no puede pasar del 100');

-- Y no se reporta dos veces el mismo día: se corrige el del día.
select test.debe_fallar(
  format($sql$insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct)
              values (%L, %L, current_date, 5)$sql$,
         current_setting('prueba.actividad'), current_setting('prueba.orden')),
  'un solo reporte por actividad y día',
  'uq_avance_del_dia');

reset role;

-- ---------------------------- Maestranza arma la suya, por pieza solicitada
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_mtz   uuid := current_setting('prueba.mtz')::uuid;
  v_act   uuid;
begin
  insert into public.ot_actividades (orden_id, area_id, orden_secuencia, nombre, referencia, peso_pct)
  values (v_orden, v_mtz, 1, 'Habilitado de laterales', 'PZ-14', 100)
  returning id into v_act;

  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct)
  values (v_act, v_orden, current_date, 50);

  perform test.afirmar(
    (select avance_pct from public.v_ot_avance_areas
      where orden_id = v_orden and area_id = v_mtz) = 50,
    'Maestranza lleva el 50 % de lo suyo');

  -- Y lo que importa: no se mezclan.
  perform test.afirmar(
    (select avance_pct from public.v_ot_avance_areas
      where orden_id = v_orden and area_id = current_setting('prueba.prd')::uuid) = 24,
    'sin que eso cambie el avance de Producción: cada área tiene su propio 100 %');
end $$;

reset role;

rollback;
