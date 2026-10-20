-- Cada área arma su lista y reporta lo suyo. Este check aprieta las cinco
-- cosas que pueden mentir:
--
--   1. Que el avance de un área salga ponderado por el peso de sus actividades
--      y NO se mezcle con el de la otra: cada una tiene su propio 100 %.
--   2. Que el reporte diario sume —es incremental, «hoy avancé 15 %»— y que dos
--      días distintos se acumulen.
--   3. Que quien no es Supervisión del área no pueda armar la lista. Es la
--      separación de manos de siempre.
--   4. Que los topes del 100 % los ponga la base y no la pantalla: ni los pesos
--      de un área ni lo reportado de una actividad pueden pasarse.
--   5. Que la hoja de un área sea de esa área: el supervisor de Acabados no
--      arma, no pesa y no reporta lo de Maestranza.
--
-- Lo que cambió desde que se escribió, y por qué:
--   · La jefatura de taller que respondía por las tres áreas
--     (`produccion.cualquier_area`) ya no existe (migración 20260929110100), y
--     en las OT de hoy —con plan de Diseño— solo Supervisión del área escribe
--     sus tareas (migración 20260929229000): ni quien lleva
--     `produccion.cualquier_area` (Gerencia) arma la hoja ajena. El check lo
--     comprueba en vez de esperar lo contrario.
--   · Cada tarea cuelga de una etapa que define Diseño (migraciones
--     20260928133000 y 20260928135000) y se reporta con foto.
--   · Desde la 20261016120000 el supervisor ya no lee la OT; como el check 317,
--     la prueba le devuelve `ordenes.ver` solo mientras dure, para seguir
--     cuidando el circuito de las tareas, que sigue en la base.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS ACTIVIDADES S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Aldo', 'Quiroz', 'aldo@demo.pe', 'ADMIN',      (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Dina', 'Paz',    'dina@demo.pe', 'DISENO',     (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Teo',  'Alva',   'teo@demo.pe',  'SUPERVISOR', (select id from public.sedes limit 1)) as supervisor_id \gset
select test.crear_usuario('Gina', 'Ramirez','gina@demo.pe', 'GERENTE',    (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Luis', 'Ochoa',  'luis@demo.pe', 'OPERARIO',   (select id from public.sedes limit 1)) as operario_id \gset
select test.crear_usuario('Sam',  'Rojas',  'sam@demo.pe',  'SUPERVISOR', (select id from public.sedes limit 1)) as acabados_id \gset
select test.crear_usuario('Mia',  'Soto',   'mia@demo.pe',  'SUPERVISOR', (select id from public.sedes limit 1)) as maestranza_id \gset

-- El área no es un adorno del organigrama: desde la migración 091 es lo que
-- decide de quién es cada hoja. `test.crear_usuario` no la pide, así que se
-- pone acá con la identidad de ADMIN, que exige el trigger de personal.
select test.como_usuario(:'admin_id');
select set_config('prueba.admin', :'admin_id', false);
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD')
 where id in (:'supervisor_id', :'operario_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'ACB')
 where id = :'acabados_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ')
 where id = :'maestranza_id';
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'ordenes.ver' from public.roles where codigo = 'SUPERVISOR'
on conflict do nothing;

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
  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_orden;

  perform set_config('prueba.orden', v_orden::text, false);
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), false);
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), false);
  perform set_config('prueba.acb', (select id::text from public.areas where codigo = 'ACB'), false);
  perform set_config('prueba.etapa_prd', gen_random_uuid()::text, false);
  perform set_config('prueba.etapa_mtz', gen_random_uuid()::text, false);
  perform set_config('prueba.etapa_acb', gen_random_uuid()::text, false);
end $$;

reset role;

-- Diseño define una etapa por área, con su rol.
select test.como_usuario(:'diseno_id');
set local role authenticated;
select public.guardar_etapas_libres(current_setting('prueba.orden')::uuid, jsonb_build_array(
  jsonb_build_object('id', current_setting('prueba.etapa_mtz'), 'nombre', 'Habilitado',
    'area_id', current_setting('prueba.mtz'), 'peso_pct', 30),
  jsonb_build_object('id', current_setting('prueba.etapa_prd'), 'nombre', 'Armado',
    'area_id', current_setting('prueba.prd'), 'peso_pct', 40),
  jsonb_build_object('id', current_setting('prueba.etapa_acb'), 'nombre', 'Acabados',
    'area_id', current_setting('prueba.acb'), 'peso_pct', 30)), null);
reset role;

-- Las fotos de evidencia ya subidas: cada reporte exige la suya.
insert into storage.objects (bucket_id, name, metadata)
select 'fotos-avance', 'ot/' || current_setting('prueba.orden') || '/taller/qa-220-' || n || '.jpg',
       '{"mimetype":"image/jpeg","size":100}'::jsonb
  from generate_series(1, 9) n;

create or replace function pg_temp.foto(n int) returns text language sql as $$
  select 'ot/' || current_setting('prueba.orden') || '/taller/qa-220-' || n || '.jpg';
$$;

-- ------------------------------- el operario no arma la lista
select test.como_usuario(:'operario_id');
set local role authenticated;

select test.debe_fallar(
  format($sql$insert into public.ot_actividades (orden_id, area_id, etapa_id, nombre, peso_pct)
              values (%L, %L, %L, 'La que el operario no debe crear', 10)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.prd'), current_setting('prueba.etapa_prd')),
  'un operario no arma la lista de actividades del área');

reset role;

-- ------------------------------------ Producción arma lo suyo y reporta
select test.como_usuario(:'supervisor_id');
set local role authenticated;

do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_prd   uuid := current_setting('prueba.prd')::uuid;
  v_etapa uuid := current_setting('prueba.etapa_prd')::uuid;
  v_act   uuid;
begin
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, v_etapa, 1, 'Armado de estructura del cajón', 60)
  returning id into v_act;

  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, v_etapa, 2, 'Montaje de compuerta', 40);

  perform set_config('prueba.actividad', v_act::text, false);

  -- Dos días: el reporte es lo del día y se acumula.
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_act, v_orden, current_date - 1, 15, 'Se cuadró el bastidor', pg_temp.foto(1));
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_act, v_orden, current_date, 25, 'Laterales soldados', pg_temp.foto(2));

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
  format($sql$insert into public.ot_actividades (orden_id, area_id, etapa_id, nombre, peso_pct)
              values (%L, %L, %L, 'La que hace pasar de 100', 20)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.prd'), current_setting('prueba.etapa_prd')),
  'los pesos de un área no pasan de 100',
  'no pueden pasar de 100');

-- Ni lo reportado del 100 % de una actividad.
select test.debe_fallar(
  format($sql$insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, foto_ruta)
              values (%L, %L, current_date - 2, 70, %L)$sql$,
         current_setting('prueba.actividad'), current_setting('prueba.orden'), pg_temp.foto(3)),
  'lo reportado no pasa del 100 % de la actividad',
  'no puede pasar del 100');

-- Y no se reporta dos veces el mismo día: se corrige el del día.
select test.debe_fallar(
  format($sql$insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, foto_ruta)
              values (%L, %L, current_date, 5, %L)$sql$,
         current_setting('prueba.actividad'), current_setting('prueba.orden'), pg_temp.foto(3)),
  'un solo reporte por actividad y día',
  'uq_avance_del_dia');

reset role;

-- ---------------------------- Maestranza arma la suya, por pieza solicitada
select test.como_usuario(:'maestranza_id');
set local role authenticated;

do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_mtz   uuid := current_setting('prueba.mtz')::uuid;
  v_act   uuid;
begin
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, referencia, peso_pct)
  values (v_orden, v_mtz, current_setting('prueba.etapa_mtz')::uuid, 1, 'Habilitado de laterales', 'PZ-14', 100)
  returning id into v_act;

  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, foto_ruta)
  values (v_act, v_orden, current_date, 50, pg_temp.foto(4));

  perform set_config('prueba.actividad_mtz', v_act::text, false);

  perform test.afirmar(
    (select avance_pct from public.v_ot_avance_areas
      where orden_id = v_orden and area_id = v_mtz) = 50,
    'Maestranza lleva el 50 % de lo suyo');
end $$;
reset role;

-- Y lo que importa: no se mezclan. Maestranza no lee la hoja de Producción, así
-- que se mira con los ojos de Diseño, que ve todas.
select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.afirmar(
  (select avance_pct from public.v_ot_avance_areas
    where orden_id = current_setting('prueba.orden')::uuid and area_id = current_setting('prueba.prd')::uuid) = 24,
  'sin que eso cambie el avance de Producción: cada área tiene su propio 100 %');
reset role;

select test.como_usuario(:'maestranza_id');
set local role authenticated;

-- En la de Producción, que no es la suya, Maestranza no arma nada.
select test.debe_fallar(
  format($sql$insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
              values (%L, %L, %L, 3, 'Retoque que pide Maestranza', 0)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.prd'), current_setting('prueba.etapa_prd')),
  'el supervisor de Maestranza no arma la lista de Producción');

-- El supervisor de Maestranza reporta otro día de su propia hoja.
do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_act   uuid := current_setting('prueba.actividad_mtz')::uuid;
begin
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_act, v_orden, current_date - 1, 10, 'Supervisor de Maestranza reporta su avance', pg_temp.foto(5));

  perform test.afirmar(
    (select avance_pct from public.v_ot_avance_areas
      where orden_id = v_orden and area_id = current_setting('prueba.mtz')::uuid) = 60,
    'el supervisor de Maestranza reporta el avance de su propia área');
end $$;

select test.debe_fallar(
  format($sql$insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, foto_ruta)
              values (%L, %L, current_date - 2, 1, %L)$sql$,
         current_setting('prueba.actividad'), current_setting('prueba.orden'), pg_temp.foto(6)),
  'el supervisor de Maestranza no reporta avances de Producción',
  'otra área');

reset role;

-- ------------- ni quien lleva `produccion.cualquier_area` arma la hoja ajena
-- Hoy ese permiso solo lo tiene Gerencia; en una OT con plan de Diseño la hoja
-- es de Supervisión del área (migración 20260929229000).
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.debe_fallar(
  format($sql$insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
              values (%L, %L, %L, 3, 'Retoque que pide Gerencia', 0)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.prd'), current_setting('prueba.etapa_prd')),
  'en una OT con plan de Diseño, ni produccion.cualquier_area arma la hoja de Producción',
  'Solo Supervisión del área');
reset role;

-- --------------- Acabados arma la suya y no se mete en la de Maestranza
-- Tiene el mismo rol y el mismo permiso que el supervisor de Producción: lo
-- único que los separa es el área, que es justo lo que se está probando.
select test.como_usuario(:'acabados_id');
set local role authenticated;

do $$
declare
  v_orden uuid := current_setting('prueba.orden')::uuid;
  v_acb   uuid := current_setting('prueba.acb')::uuid;
  v_act   uuid;
begin
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_acb, current_setting('prueba.etapa_acb')::uuid, 1, 'Pintura de cabina', 100)
  returning id into v_act;

  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, foto_ruta)
  values (v_act, v_orden, current_date, 30, pg_temp.foto(7));

  perform test.afirmar(
    (select avance_pct from public.v_ot_avance_areas
      where orden_id = v_orden and area_id = v_acb) = 30,
    'Acabados lleva el 30 % de lo suyo');
end $$;

select test.debe_fallar(
  format($sql$insert into public.ot_actividades (orden_id, area_id, etapa_id, nombre, peso_pct)
              values (%L, %L, %L, 'La que Acabados no debe crear', 0)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.mtz'), current_setting('prueba.etapa_mtz')),
  'el supervisor de Acabados no arma la lista de Maestranza');

select test.debe_fallar(
  format($sql$insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, foto_ruta)
              values (%L, %L, current_date - 3, 10, %L)$sql$,
         current_setting('prueba.actividad_mtz'), current_setting('prueba.orden'), pg_temp.foto(8)),
  'ni reporta el avance de una actividad de Maestranza');

-- El peso de la hoja ajena tampoco se le mueve, y esto no revienta: afecta cero
-- filas y devuelve éxito. Es el fallo mudo del proyecto, así que se cuenta en
-- vez de confiar en que salte solo.
do $$
declare v_n integer;
begin
  update public.ot_actividades set peso_pct = 10
   where id = current_setting('prueba.actividad_mtz')::uuid;
  get diagnostics v_n = row_count;

  perform test.afirmar(v_n = 0,
    'cambiarle el peso a la hoja de otra área no toca ninguna fila');

  -- La supervisora de Acabados tampoco puede leer la hoja de Maestranza;
  -- usa ADMIN para verificar que la fila original siga intacta.
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  perform test.afirmar(
    (select peso_pct from public.ot_actividades
      where id = current_setting('prueba.actividad_mtz')::uuid) = 100,
    'y la actividad de Maestranza se queda como estaba');
end $$;

reset role;

rollback;
