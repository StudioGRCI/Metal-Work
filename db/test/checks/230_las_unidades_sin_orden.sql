-- Las unidades que llegan sin orden de trabajo. Este check aprieta las cinco
-- cosas que pueden mentir:
--
--   1. Que registrar la unidad sea «armar» (produccion.actividades) y reportar
--      sea «reportar» (produccion.registrar): el operario reporta en su área
--      pero no da de alta unidades ni las marca listas.
--   2. Que el área vaya en el reporte y cada uno escriba en la suya: Acabados
--      no reporta como Maestranza, y el jefe de producción reporta en las tres.
--   3. Que la misma placa no entre dos veces mientras sigue adentro —«abc 123»
--      y «ABC-123» son la misma— y que después de salir pueda volver.
--   4. Que «lista» y «salió» se sellen con fecha y firma, que de «salió» no se
--      vuelva y que sobre una unidad que salió no se reporte.
--   5. Que una foto solo cuelgue de su unidad: la ruta flota/{otra}/… la
--      rechaza la base.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000020', 'PRUEBAS FLOTA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Aldo', 'Quiroz', 'aldo@demo.pe', 'ADMIN',           (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Sam',  'Rojas',  'sam@demo.pe',  'SUPERVISOR',      (select id from public.sedes limit 1)) as acabados_id \gset
select test.crear_usuario('Luis', 'Ochoa',  'luis@demo.pe', 'OPERARIO',        (select id from public.sedes limit 1)) as operario_id \gset
select test.crear_usuario('Jefa', 'Prado',  'jefa@demo.pe', 'JEFE_PRODUCCION', (select id from public.sedes limit 1)) as jefe_id \gset

-- El área decide de quién es cada reporte; test.crear_usuario no la pide.
update public.usuarios set area_id = (select id from public.areas where codigo = 'ACB')
 where id = :'acabados_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD')
 where id in (:'operario_id', :'jefe_id');

select set_config('prueba.acb', (select id::text from public.areas where codigo = 'ACB'), false);
select set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), false);
select set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), false);

-- ------------------------------------- el operario reporta, pero no registra
select test.como_usuario(:'operario_id');
set local role authenticated;

select test.debe_fallar(
  $sql$insert into public.flota_unidades (placa, trabajo) values ('XYZ-999', 'La que el operario no debe crear')$sql$,
  'un operario no da de alta unidades sin orden');

reset role;

-- ----------------------------------------- Acabados registra y reporta lo suyo
select test.como_usuario(:'acabados_id');
set local role authenticated;

do $$
declare
  v_unidad uuid;
  v_avance uuid;
begin
  insert into public.flota_unidades (placa, descripcion, cliente, trabajo)
  values ('abc-123', 'Volquete de prueba', 'Transportes de prueba', 'Cambio de compuerta posterior')
  returning id into v_unidad;

  perform test.afirmar(
    (select placa_clave from public.flota_unidades where id = v_unidad) = 'ABC123',
    'la placa se normaliza sin guiones ni espacios');

  insert into public.flota_avances (flota_id, area_id, descripcion, avance_porcentaje)
  values (v_unidad, current_setting('prueba.acb')::uuid, 'Se desmontó la compuerta', 20)
  returning id into v_avance;

  perform set_config('prueba.unidad', v_unidad::text, false);
  perform set_config('prueba.avance', v_avance::text, false);

  -- Lo que ve el taller.
  perform test.afirmar(
    (select area_actual from public.v_flota_unidades where id = v_unidad) = 'Acabados',
    'el área actual de la unidad es la del último reporte');
  perform test.afirmar(
    (select dias_en_taller from public.v_flota_unidades where id = v_unidad) = 0,
    'recién entró: lleva cero días');
  perform test.afirmar(
    (select count(*) from public.v_flota_avance_diario where fecha = current_date and flota_id = v_unidad) = 1,
    'el reporte de hoy sale en el diario');
end $$;

-- La misma placa, escrita distinto, no entra dos veces.
select test.debe_fallar(
  $sql$insert into public.flota_unidades (placa, trabajo) values ('ABC 123', 'La misma unidad otra vez')$sql$,
  'una placa no entra dos veces mientras sigue adentro',
  'uq_flota_placa_en_taller');

-- Acabados no reporta como Maestranza.
select test.debe_fallar(
  format($sql$insert into public.flota_avances (flota_id, area_id, descripcion)
              values (%L, %L, 'Lo que Acabados no debe firmar por Maestranza')$sql$,
         current_setting('prueba.unidad'), current_setting('prueba.mtz')),
  'el supervisor de Acabados no reporta en nombre de Maestranza');

-- Una foto de otra unidad no se cuelga de este reporte.
select test.debe_fallar(
  format($sql$insert into public.flota_avance_fotos (avance_id, flota_id, ruta_storage, nombre_archivo)
              values (%L, %L, 'flota/00000000-0000-0000-0000-000000000000/x.jpg', 'x.jpg')$sql$,
         current_setting('prueba.avance'), current_setting('prueba.unidad')),
  'una foto solo cuelga de su unidad',
  'ck_flota_foto_ruta');

do $$
declare v_unidad uuid := current_setting('prueba.unidad')::uuid;
begin
  insert into public.flota_avance_fotos (avance_id, flota_id, ruta_storage, nombre_archivo)
  values (current_setting('prueba.avance')::uuid, v_unidad, 'flota/' || v_unidad || '/como-llego.jpg', 'como-llego.jpg');

  perform test.afirmar(
    (select fotos from public.v_flota_unidades where id = v_unidad) = 1,
    'la foto de la unidad se cuenta');

  -- Lista, y vuelta a trabajo.
  update public.flota_unidades set estado = 'LISTA' where id = v_unidad;
  perform test.afirmar(
    (select lista_en is not null from public.flota_unidades where id = v_unidad),
    '«lista» se sella con fecha');

  update public.flota_unidades set estado = 'EN_TALLER' where id = v_unidad;
  perform test.afirmar(
    (select lista_en is null from public.flota_unidades where id = v_unidad),
    'volver a trabajo le quita el «lista»');
end $$;

reset role;

-- ----------------------------- el operario reporta en la suya; el jefe, en todas
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
begin
  insert into public.flota_avances (flota_id, area_id, descripcion)
  values (current_setting('prueba.unidad')::uuid, current_setting('prueba.prd')::uuid, 'Se soldó el refuerzo del piso');
end $$;

select test.debe_fallar(
  format($sql$update public.flota_unidades set estado = 'LISTA' where id = %L$sql$,
         current_setting('prueba.unidad')),
  'el operario no marca la unidad como lista');

reset role;

select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare v_n integer;
begin
  insert into public.flota_avances (flota_id, area_id, descripcion)
  values (current_setting('prueba.unidad')::uuid, current_setting('prueba.mtz')::uuid, 'Maestranza habilitó la bisagra');

  -- Y corrige el reporte de Acabados, que no es el suyo.
  update public.flota_avances set impedimento = 'Falta la plancha'
   where id = current_setting('prueba.avance')::uuid;
  get diagnostics v_n = row_count;
  perform test.afirmar(v_n = 1, 'el jefe de producción corrige el reporte de cualquier área');
end $$;

reset role;

-- -------------------------------------------- salió, y de ahí no se vuelve
select test.como_usuario(:'acabados_id');
set local role authenticated;

do $$
declare v_unidad uuid := current_setting('prueba.unidad')::uuid;
begin
  update public.flota_unidades set estado = 'SALIO', retiro = 'Chofer de prueba' where id = v_unidad;

  perform test.afirmar(
    (select salio_en is not null and salio_por = current_setting('request.jwt.claim.sub')::uuid
       from public.flota_unidades where id = v_unidad),
    '«salió» se sella con fecha y con quién lo marcó');
end $$;

select test.debe_fallar(
  format($sql$update public.flota_unidades set estado = 'EN_TALLER' where id = %L$sql$,
         current_setting('prueba.unidad')),
  'de «salió» no se vuelve',
  'regístrala de nuevo');

select test.debe_fallar(
  format($sql$insert into public.flota_avances (flota_id, area_id, descripcion)
              values (%L, %L, 'Sobre una unidad que ya salió')$sql$,
         current_setting('prueba.unidad'), current_setting('prueba.acb')),
  'sobre una unidad que salió no se reporta');

-- Pero la placa puede volver a entrar: es otra estancia.
do $$
begin
  insert into public.flota_unidades (placa, trabajo) values ('ABC-123', 'Volvió por la pintura');
  perform test.afirmar(
    (select count(*) from public.v_flota_unidades where placa_clave = 'ABC123') = 2,
    'la misma placa vuelve como otra estancia y la anterior queda de historial');
end $$;

reset role;

rollback;
