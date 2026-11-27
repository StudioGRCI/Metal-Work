-- Los trámites avisan solos (migración 20261127004000; plan «El puesto de
-- Tramitador», entrega 3; la renovación, entrega 4, migración 20261127160000). El trámite nuevo avisa a quien lleva los trámites,
-- salvo a quien lo registró. La revisión diaria avisa una vez por cada día de
-- aviso del tipo por la fecha límite, y lo vencido también a Gerencia; el
-- concluido que se renueva abre su renovación, y avisa ella. Los trámites los registra el Tramitador con
-- su cuenta y `set local role authenticated`; la revisión la corre el sistema,
-- como pg_cron. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA500', 'Taller prueba 500') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA500' \gset
select test.crear_usuario('Ada', 'Admin', 'admin500@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Tita', 'Trámites', 'tra500@demo.pe', 'TRAMITADOR', :'sede_id') as tra_id \gset
select test.crear_usuario('Toño', 'Trámites', 'trb500@demo.pe', 'TRAMITADOR', :'sede_id') as trb_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger500@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm500@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ven500@demo.pe', 'VENDEDOR', :'sede_id') as ven_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tes500@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000500', 'qa cliente 500') returning id as cliente_id \gset
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK500_A_26/70', 'QA7-500', 'CAMION') returning id as unidad_a \gset
select id as tipo_tarjeta from public.tramite_tipos where nombre = 'Tarjeta de propiedad' \gset
select id as tipo_soat from public.tramite_tipos where nombre = 'SOAT' \gset

select set_config('prueba.tra', :'tra_id', true), set_config('prueba.trb', :'trb_id', true), set_config('prueba.ger', :'ger_id', true),
       set_config('prueba.adm', :'adm_id', true), set_config('prueba.ven', :'ven_id', true), set_config('prueba.tes', :'tes_id', true),
       set_config('prueba.admin', :'admin_id', true),
       set_config('prueba.unidad_a', :'unidad_a', true),
       set_config('prueba.tipo_tarjeta', :'tipo_tarjeta', true), set_config('prueba.tipo_soat', :'tipo_soat', true),
       set_config('prueba.tarjeta', gen_random_uuid()::text, true), set_config('prueba.soat', gen_random_uuid()::text, true),
       set_config('prueba.viejo', gen_random_uuid()::text, true), set_config('prueba.final_soat', gen_random_uuid()::text, true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.hoy() returns date language sql as $$
  select (now() at time zone 'America/Lima')::date;
$$;
-- El primer día laborable desde `d`, y el primero que no lo es.
create or replace function pg_temp.laborable(d date) returns date language sql as $$
  select min(x)::date from generate_series(d, d + 20, interval '1 day') x where public.es_laborable(x::date);
$$;
create or replace function pg_temp.no_laborable(d date) returns date language sql as $$
  select min(x)::date from generate_series(d, d + 20, interval '1 day') x where not public.es_laborable(x::date);
$$;
-- Cuántos avisos de un trámite le llegaron a alguien, por el comienzo del título.
create or replace function pg_temp.avisos(p_usuario text, p_tramite text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_usuario) and origen_tabla = 'tramites' and origen_id = pg_temp.id(p_tramite)
     and titulo like p_titulo || '%';
$$;
create or replace function pg_temp.subir(p_tramite text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_tramite)::text || '/' || gen_random_uuid()::text || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('tramites', v_ruta, public.usuario_actual()::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  return v_ruta;
end;
$$;
-- La revisión, como la corre pg_cron, un día dado: cuántos avisos de un tipo.
create or replace function pg_temp.revisar(p_dia date, p_tipo text) returns integer language sql as $$
  select r.avisos from public.revisar_tramites(p_dia) r where r.tipo = p_tipo;
$$;
-- Lo anotado, en una función volátil: una subconsulta suelta en la misma
-- sentencia que la revisión no ve lo que la revisión insertó.
create or replace function pg_temp.dias_anotados(p_tramite text, p_tipo text) returns integer[] language sql volatile as $$
  select array_agg(dias order by dias) from public.tramite_avisos where tramite_id = pg_temp.id(p_tramite) and tipo = p_tipo;
$$;
create or replace function pg_temp.revisiones(p_dia date) returns integer language sql volatile as $$
  select count(*)::integer from public.tramite_avisos where tipo = 'REVISION' and dia_revision = p_dia;
$$;
-- Las fechas de la prueba, en días laborables para que la revisión corra.
select set_config('prueba.d1', pg_temp.laborable(pg_temp.hoy() + 3)::text, true);
select set_config('prueba.limite', (current_setting('prueba.d1')::date + 10)::text, true);
select set_config('prueba.d2', pg_temp.laborable(current_setting('prueba.limite')::date - 5)::text, true);
select set_config('prueba.d3', pg_temp.laborable(current_setting('prueba.limite')::date + 1)::text, true);
select set_config('prueba.vigencia', (pg_temp.hoy() + 90)::text, true);
select set_config('prueba.v1', pg_temp.laborable(current_setting('prueba.vigencia')::date - 25)::text, true);
select set_config('prueba.v2', pg_temp.laborable(current_setting('prueba.vigencia')::date - 6)::text, true);
select set_config('prueba.v3', pg_temp.laborable(current_setting('prueba.vigencia')::date + 1)::text, true);
select set_config('prueba.libre', pg_temp.no_laborable(pg_temp.hoy())::text, true);
create or replace function pg_temp.dia(p_clave text) returns date language sql as $$
  select current_setting('prueba.' || p_clave)::date;
$$;
reset role;

-- 0. Lo que la migración dejó ------------------------------------------------------
select test.afirmar(
  (select relrowsecurity from pg_class where oid = 'public.tramite_avisos'::regclass)
  and not has_table_privilege('authenticated', 'public.tramite_avisos', 'insert')
  and not has_table_privilege('authenticated', 'public.tramite_avisos', 'update')
  and not has_table_privilege('authenticated', 'public.tramite_avisos', 'delete')
  and not has_table_privilege('anon', 'public.tramite_avisos', 'select'),
  'la anotación de los avisos tiene RLS y nadie la escribe por la API');
select test.afirmar(
  not has_function_privilege('authenticated', 'public.revisar_tramites(date)', 'execute')
  and not has_function_privilege('anon', 'public.revisar_tramites(date)', 'execute')
  and not has_function_privilege('authenticated', 'public.avisar_tramite(uuid, text, text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.tramite_en_texto(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.fn_tramite_avisa_al_registrarse()', 'execute'),
  'la revisión y sus ayudantes están cerrados a la gente: los corre el sistema');
select test.afirmar(pg_temp.dia('d2') between pg_temp.dia('limite') - 5 and pg_temp.dia('limite')
                    and pg_temp.dia('d3') > pg_temp.dia('limite') and pg_temp.dia('v2') <= pg_temp.dia('vigencia') - 1,
  'las fechas de la prueba caen donde se quiere');

-- 1. El trámite nuevo -------------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('tarjeta'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta de propiedad de la unidad QA7-500', 'SUNARP', 'T-500', pg_temp.hoy() - 1, pg_temp.dia('limite'), null);
  perform * from public.tramites_registrar(pg_temp.id('soat'), pg_temp.id('tipo_soat'), null, null,
    'SOAT de la camioneta de reparto', 'Aseguradora', null, pg_temp.hoy() - 1, null, null);
  perform * from public.tramites_registrar(pg_temp.id('viejo'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta registrada dos veces por error', 'SUNARP', null, pg_temp.hoy() - 1, pg_temp.dia('limite'), null);
  perform test.afirmar(pg_temp.avisos('tra', 'tarjeta', 'Trámite nuevo') = 0
                       and (select count(*) from public.notificaciones where usuario_id = pg_temp.id('tra')) = 0,
    'quien registra el trámite no se avisa a sí mismo');
end $$;
reset role;
select test.como_usuario(:'trb_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(pg_temp.avisos('trb', 'tarjeta', 'Trámite nuevo: TR-') = 1
                       and pg_temp.avisos('trb', 'soat', 'Trámite nuevo: TR-') = 1,
    'el otro Tramitador recibe un aviso por cada trámite nuevo');
  perform test.afirmar(
    (select cuerpo like 'Tarjeta de propiedad · QA7-500 · QA CLIENTE 500: Tarjeta de propiedad de la unidad QA7-500. Lo registró Tita Trámites (%'
            and cuerpo like '%. Fecha límite: ' || to_char(pg_temp.dia('limite'), 'DD/MM/YYYY') || '.'
            and ruta = '/tramites/' || pg_temp.id('tarjeta')
       from public.notificaciones where usuario_id = pg_temp.id('trb') and origen_id = pg_temp.id('tarjeta')),
    'el aviso dice el tipo, la placa, el cliente en mayúsculas, quién lo registró y su fecha límite, y abre la ficha');
  perform test.afirmar((select cuerpo like 'SOAT · de la empresa: SOAT de la camioneta de reparto. Lo registró %'
                          from public.notificaciones where usuario_id = pg_temp.id('trb') and origen_id = pg_temp.id('soat')),
    'el de la empresa lo dice');
  perform test.afirmar((select count(*) from public.notificaciones where origen_tabla = 'tramites') = 3,
    'y solo ve los suyos');
end $$;
reset role;
select test.afirmar(
  (select count(*) from public.notificaciones where origen_tabla = 'tramites'
      and usuario_id in (pg_temp.id('ger'), pg_temp.id('adm'), pg_temp.id('ven'), pg_temp.id('tes'), pg_temp.id('admin'))) = 0,
  'el trámite nuevo no avisa a Gerencia, Administración, Ventas, Tesorería ni al administrador');

-- El tercero espera el visto de Gerencia: no avisa de su plazo.
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform public.tramites_pedir_anulacion(pg_temp.id('viejo'), 'Es el mismo trámite que la tarjeta de arriba.');
end $$;
reset role;

-- 2. La revisión diaria: la fecha límite -------------------------------------------
select test.afirmar(pg_temp.revisar(pg_temp.dia('libre'), 'POR_VENCER') = 0
                    and pg_temp.revisar(pg_temp.dia('libre'), 'VENCIDO') = 0
                    and pg_temp.revisiones(pg_temp.dia('libre')) = 1,
  'el día no laborable no avisa, y la corrida queda anotada');
select test.afirmar(pg_temp.revisar(pg_temp.dia('d1'), 'POR_VENCER') = 0,
  'a diez días de la fecha límite, con aviso a los 5, no avisa');
select test.afirmar(pg_temp.revisar(pg_temp.dia('d2'), 'POR_VENCER') = 1,
  'a cinco días o menos sale un aviso de por vencer (el del visto pendiente no)');
select test.afirmar(pg_temp.avisos('tra', 'tarjeta', 'Por vencer: TR-') = 1 and pg_temp.avisos('trb', 'tarjeta', 'Por vencer: TR-') = 1
                    and pg_temp.avisos('ger', 'tarjeta', 'Por vencer') = 0 and pg_temp.avisos('adm', 'tarjeta', 'Por vencer') = 0
                    and pg_temp.avisos('admin', 'tarjeta', 'Por vencer') = 0
                    and pg_temp.avisos('tra', 'viejo', 'Por vencer') = 0,
  'el por vencer le llega a los dos Tramitadores y a nadie más');
select test.afirmar(
  (select titulo like '%· vence en ' || (pg_temp.dia('limite') - pg_temp.dia('d2')) || ' días'
          or titulo like '%· vence mañana' or titulo like '%· vence hoy'
     from public.notificaciones where usuario_id = pg_temp.id('tra') and origen_id = pg_temp.id('tarjeta') and titulo like 'Por vencer%')
  and (select cuerpo like '%. Su fecha límite es el ' || to_char(pg_temp.dia('limite'), 'DD/MM/YYYY') || '.'
         from public.notificaciones where usuario_id = pg_temp.id('tra') and origen_id = pg_temp.id('tarjeta') and titulo like 'Por vencer%'),
  'dice cuántos días faltan y la fecha límite');
select test.afirmar(pg_temp.revisar(pg_temp.dia('d2'), 'POR_VENCER') = 0
                    and pg_temp.revisar(pg_temp.dia('d2') + 1, 'POR_VENCER') = 0
                    and pg_temp.avisos('tra', 'tarjeta', 'Por vencer') = 1,
  'correrla otra vez, o al día siguiente, no repite el aviso');
select test.afirmar(
  (select avisados = (select count(*) from public.usuarios u where u.activo
                         and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'tramites.gestionar'))
          and avisados >= 2 and dias = 5 and fecha = pg_temp.dia('limite') and dia_revision = pg_temp.dia('d2')
     from public.tramite_avisos where tramite_id = pg_temp.id('tarjeta') and tipo = 'POR_VENCER'),
  'el aviso queda anotado con su día de aviso, su fecha y a cuántas cuentas llegó');
select test.afirmar(pg_temp.revisar(pg_temp.dia('d3'), 'VENCIDO') = 1,
  'pasada la fecha límite sale un aviso de vencido');
select test.afirmar(pg_temp.avisos('tra', 'tarjeta', 'Venció el trámite TR-') = 1 and pg_temp.avisos('trb', 'tarjeta', 'Venció') = 1
                    and pg_temp.avisos('ger', 'tarjeta', 'Venció el trámite TR-') = 1
                    and pg_temp.avisos('adm', 'tarjeta', 'Venció') = 0 and pg_temp.avisos('ven', 'tarjeta', 'Venció') = 0
                    and pg_temp.avisos('tes', 'tarjeta', 'Venció') = 0 and pg_temp.avisos('admin', 'tarjeta', 'Venció') = 0,
  'lo vencido le llega a los Tramitadores y a Gerencia, y a nadie más');
select test.afirmar(pg_temp.revisar(pg_temp.dia('d3'), 'VENCIDO') = 0 and pg_temp.revisar(pg_temp.dia('d3') + 7, 'VENCIDO') = 0,
  'el vencido avisa una sola vez');

-- La fecha límite se corre: se avisa por la fecha nueva.
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform public.tramites_actualizar(pg_temp.id('tarjeta'), 'EN_TRAMITE', 'Tarjeta de propiedad de la unidad QA7-500', 'SUNARP', 'T-500',
    pg_temp.hoy() - 1, pg_temp.dia('d3') + 2, null, now());
end $$;
reset role;
select test.afirmar(pg_temp.revisar(pg_temp.dia('d3'), 'POR_VENCER') = 1 and pg_temp.avisos('tra', 'tarjeta', 'Por vencer') = 2,
  'con la fecha límite nueva vuelve a avisar, por la fecha nueva');

-- 3. La vigencia de lo que se renueva ---------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform public.tramites_concluir(pg_temp.id('final_soat'), pg_temp.id('soat'), pg_temp.subir('soat'), 'soat.pdf',
    pg_temp.hoy(), pg_temp.dia('vigencia'));
end $$;
reset role;
-- Desde la entrega 4 (migración 20261127160000), al llegar el primer día de
-- aviso de su tipo el concluido abre su renovación, y la renovación es la que avisa.
create or replace function pg_temp.renovacion(p_tramite text) returns uuid language sql volatile as $$
  select id from public.tramites where renueva_a = pg_temp.id(p_tramite) order by creado_en limit 1;
$$;
-- La revisión la corre pg_cron, sin la sesión de ningún Tramitador.
select test.como_usuario(:'admin_id');
select test.afirmar(pg_temp.revisar(pg_temp.dia('v1'), 'RENOVACION') = 1
                    and pg_temp.dias_anotados('soat', 'RENOVACION') = '{30}',
  'a los 30 días de su vigencia el SOAT concluido abre su renovación');
select set_config('prueba.renovacion', pg_temp.renovacion('soat')::text, true);
select test.afirmar(
  (select origen = 'RENOVACION' and estado = 'POR_INICIAR' and fecha_limite = pg_temp.dia('vigencia') and registrado_por is null
          and tipo_id = pg_temp.id('tipo_soat') and ambito = 'EMPRESA' and asunto like 'Renovación de TR-%: SOAT de la camioneta de reparto'
     from public.tramites where id = pg_temp.id('renovacion')),
  'la renovación es otro TR del mismo tipo, «Por iniciar», con fecha límite el día en que vence el documento');
select test.afirmar(pg_temp.avisos('tra', 'renovacion', 'Renovación abierta: TR-') = 1
                    and pg_temp.avisos('trb', 'renovacion', 'Renovación abierta: TR-') = 1
                    and pg_temp.avisos('ger', 'renovacion', 'Renovación') = 0
                    and (select cuerpo like 'SOAT · de la empresa: Renovación de TR-%: SOAT de la camioneta de reparto. El documento del TR-% vale hasta el '
                                           || to_char(pg_temp.dia('vigencia'), 'DD/MM/YYYY') || '. La abrió el sistema al acercarse el vencimiento.'
                           from public.notificaciones where usuario_id = pg_temp.id('tra') and origen_id = pg_temp.id('renovacion')),
  'su apertura avisa a los dos Tramitadores, dice qué renueva y hasta cuándo vale, y no le llega a Gerencia');
select test.afirmar(pg_temp.dias_anotados('renovacion', 'POR_VENCER') = '{30}' and pg_temp.avisos('tra', 'renovacion', 'Por vencer') = 0,
  'el aviso de apertura cuenta como el de 30 días: la renovación no lo repite');
select test.afirmar(pg_temp.revisar(pg_temp.dia('v1'), 'RENOVACION') = 0 and pg_temp.revisar(pg_temp.dia('v2'), 'RENOVACION') = 0
                    and (select count(*) from public.tramites where renueva_a = pg_temp.id('soat')) = 1,
  'no abre otra renovación');
select test.afirmar(pg_temp.dias_anotados('renovacion', 'POR_VENCER') = '{7,30}'
                    and pg_temp.avisos('tra', 'renovacion', 'Por vencer: TR-') = 1
                    and pg_temp.avisos('tra', 'soat', 'Por') = 0,
  'si la revisión no corrió a los 15, a los 7 la renovación da solo el de 7, y el viejo calla');
select test.afirmar(pg_temp.revisar(pg_temp.dia('v3'), 'VENCIDO') >= 1
                    and pg_temp.avisos('tra', 'renovacion', 'Venció el trámite TR-') = 1
                    and pg_temp.avisos('ger', 'renovacion', 'Venció el trámite TR-') = 1
                    and pg_temp.avisos('tra', 'soat', 'Venció') = 0 and pg_temp.avisos('ger', 'soat', 'Venció') = 0,
  'vencida sin renovar, la renovación avisa a los Tramitadores y a Gerencia; el viejo no');
select test.afirmar(pg_temp.revisar(pg_temp.dia('v3'), 'POR_VENCER') = 0
                    and pg_temp.avisos('tra', 'soat', 'Por vencer') = 0,
  'el concluido ya no avisa por su fecha límite');

-- 4. Quién lee la anotación ---------------------------------------------------------
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramite_avisos where tramite_id = pg_temp.id('tarjeta')) = 4,
    'Gerencia, que ve todos los trámites, lee lo que se avisó (por vencer y vencido, por cada fecha límite)');
  perform test.debe_fallar($q$select * from public.revisar_tramites(null)$q$, 'nadie corre la revisión a mano', 'permission denied');
  perform test.debe_fallar(format($q$insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision) values (%L, 'VENCIDO', current_date, null, current_date)$q$,
    current_setting('prueba.tarjeta')), 'ni anota un aviso a mano', 'permission denied');
end $$;
reset role;
select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramite_avisos) = 0,
    'Ventas no lee la anotación de los avisos');
  perform test.afirmar((select count(*) from public.notificaciones where origen_tabla = 'tramites') = 0,
    'ni le llegó ningún aviso de trámites');
end $$;
reset role;
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramite_avisos) = 0, 'Tesorería tampoco');
  perform test.debe_fallar($q$select public.tramite_en_texto(gen_random_uuid())$q$, 'ni lee un trámite por el ayudante del aviso', 'permission denied');
end $$;
reset role;

-- 4b. El documento de antes, cargado ya vencido, no avisa --------------------------
select set_config('prueba.historico', gen_random_uuid()::text, true), set_config('prueba.final_hist', gen_random_uuid()::text, true);
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('historico'), pg_temp.id('tipo_soat'), null, null,
    'SOAT del año pasado, para el archivo', 'Aseguradora', null, pg_temp.hoy() - 400, null, null);
  perform public.tramites_concluir(pg_temp.id('final_hist'), pg_temp.id('historico'), pg_temp.subir('historico'), 'soat-viejo.pdf',
    pg_temp.hoy() - 380, pg_temp.hoy() - 15);
end $$;
reset role;
select pg_temp.revisar(pg_temp.laborable(pg_temp.hoy()), 'RENOVACION');
select test.afirmar((select count(*) from public.tramite_avisos where tramite_id = pg_temp.id('historico')) = 0
                    and (select count(*) from public.tramites where renueva_a = pg_temp.id('historico')) = 0
                    and pg_temp.avisos('tra', 'historico', 'Venció') = 0,
  'el documento de antes que se carga ya vencido no abre renovación ni avisa');

-- 4c. Los días del tipo cambian a medio camino --------------------------------------
select test.como_usuario(:'admin_id');
select set_config('prueba.cambio', gen_random_uuid()::text, true);
-- Dos días laborables seguidos, c1 y c1 + 1, y la fecha límite 5 días después de c1:
-- el primero toca el aviso de 5; el segundo, con 4 por delante, tocaría el de 10.
select set_config('prueba.c1', (select min(x)::date from generate_series(pg_temp.hoy() + 30, pg_temp.hoy() + 60, interval '1 day') x
                                 where public.es_laborable(x::date) and public.es_laborable(x::date + 1))::text, true);
select set_config('prueba.d5_base', (pg_temp.dia('c1') + 5)::text, true);
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('cambio'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta cuyo tipo cambia sus días de aviso', 'SUNARP', null, pg_temp.hoy() - 1, pg_temp.dia('d5_base'), null);
end $$;
reset role;
select pg_temp.revisar(pg_temp.dia('c1'), 'POR_VENCER');
update public.tramite_tipos set dias_aviso = '{10,3}' where id = pg_temp.id('tipo_tarjeta');
select pg_temp.revisar(pg_temp.dia('c1') + 1, 'POR_VENCER');
select test.afirmar(pg_temp.dias_anotados('cambio', 'POR_VENCER') = '{5}' and pg_temp.avisos('tra', 'cambio', 'Por vencer') = 1,
  'si el tipo pasa de 5 a 10 y 3 días, no sale el de 10 tarde, casi repetido del de 5');
update public.tramite_tipos set dias_aviso = '{5}' where id = pg_temp.id('tipo_tarjeta');

-- 5. Lo de un lote de prueba, y el día sin Tramitador -------------------------------
select set_config('prueba.lote', gen_random_uuid()::text, true), set_config('prueba.sin', gen_random_uuid()::text, true);
select set_config('prueba.d5', pg_temp.laborable(pg_temp.dia('d3') + 10)::text, true);
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('lote'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta de un lote de prueba', 'SUNARP', null, pg_temp.hoy() - 1, pg_temp.dia('limite'), null);
  perform * from public.tramites_registrar(pg_temp.id('sin'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta que vence sin Tramitador', 'SUNARP', null, pg_temp.hoy() - 1, pg_temp.dia('limite'), null);
end $$;
reset role;
insert into public.pruebas_lotes (id, motivo) values ('50000000-0000-4000-8000-00000000a0a0', 'Check 500');
insert into public.pruebas_filas (lote_id, tabla, fila_id)
values ('50000000-0000-4000-8000-00000000a0a0', 'tramites', pg_temp.id('lote')) on conflict do nothing;
-- Las cuentas se apagan con la sesión del administrador, que es quien puede.
select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where rol_id in (select rp.rol_id from public.roles_permisos rp where rp.permiso_codigo = 'tramites.gestionar');
update public.usuarios set activo = false where rol_id in (select rp.rol_id from public.roles_permisos rp where rp.permiso_codigo = 'tramites.aprobar_anulacion');
select test.afirmar(pg_temp.revisar(pg_temp.dia('d5'), 'VENCIDO') = 0
                    and (select count(*) from public.tramite_avisos where tramite_id = pg_temp.id('sin')) = 0,
  'el día sin ninguna cuenta a quién avisar no anota el vencido: si lo anotara, no saldría nunca');
update public.usuarios set activo = true where id in (pg_temp.id('tra'), pg_temp.id('ger'));
select test.afirmar(pg_temp.revisar(pg_temp.laborable(pg_temp.dia('d5') + 1), 'VENCIDO') >= 1
                    and pg_temp.avisos('tra', 'sin', 'Venció el trámite TR-') = 1 and pg_temp.avisos('ger', 'sin', 'Venció el trámite TR-') = 1,
  'y sale en la primera revisión en que hay a quién');
select test.afirmar(
  (select count(*) from public.tramite_avisos where tramite_id = pg_temp.id('lote')) = 0
  and (select count(*) from public.notificaciones where origen_tabla = 'tramites' and origen_id = pg_temp.id('lote') and titulo not like 'Trámite nuevo%') = 0,
  'el trámite de un lote de prueba no avisa ni deja anotación que impida limpiar el lote');

rollback;
