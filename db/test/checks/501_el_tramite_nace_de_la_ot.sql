-- El trámite nace de la OT (migración 20261127170000; plan «El puesto de
-- Tramitador», entrega 4). Al terminar la OT, la base abre los trámites que el
-- catálogo pide (la tarjeta siempre; las placas si la unidad no tiene placa),
-- con su fecha límite en días hábiles; la OT lee en qué van; el Tramitador
-- renueva a mano lo que se renueva; y la lista dice qué está por vencer. Las
-- personas, con su cuenta y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA501', 'Taller prueba 501') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA501' \gset
select test.crear_usuario('Ada', 'Admin', 'admin501@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Tita', 'Trámites', 'tra501@demo.pe', 'TRAMITADOR', :'sede_id') as tra_id \gset
select test.crear_usuario('Toño', 'Trámites', 'trb501@demo.pe', 'TRAMITADOR', :'sede_id') as trb_id \gset
select test.crear_usuario('Gera', 'Gerencia', 'ger501@demo.pe', 'GERENTE', :'sede_id') as ger_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ven501@demo.pe', 'VENDEDOR', :'sede_id') as ven_id \gset
select test.crear_usuario('Cali', 'Calidad', 'cal501@demo.pe', 'CALIDAD', :'sede_id') as cal_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tes501@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000501', 'qa cliente 501') returning id as cliente_id \gset
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK501_A_26/70', 'QA7-501', 'CAMION') returning id as unidad_a \gset
-- Sin placa: es la que todavía la tramita.
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK501_B_26/71', null, 'CAMION') returning id as unidad_b \gset
select id as tipo_tarjeta from public.tramite_tipos where nombre = 'Tarjeta de propiedad' \gset
select id as tipo_placas from public.tramite_tipos where nombre = 'Placas' \gset
select id as tipo_soat from public.tramite_tipos where nombre = 'SOAT' \gset

-- Cuatro OT aprobadas: A (unidad con placa), B (sin placa), C (sin placa, con
-- su tarjeta ya registrada a mano) y D (sin placa, con las placas desactivadas).
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
select :'cliente_id', x.unidad, :'sede_id', 'Check 501 · ' || x.clave, 'FABRICACION', 'APROBADA'
  from (values ('A', :'unidad_a'::uuid), ('B', :'unidad_b'::uuid), ('C', :'unidad_b'::uuid), ('D', :'unidad_b'::uuid)) x(clave, unidad);

select set_config('prueba.tra', :'tra_id', true), set_config('prueba.trb', :'trb_id', true), set_config('prueba.ger', :'ger_id', true),
       set_config('prueba.ven', :'ven_id', true), set_config('prueba.cal', :'cal_id', true), set_config('prueba.tes', :'tes_id', true),
       set_config('prueba.admin', :'admin_id', true),
       set_config('prueba.unidad_a', :'unidad_a', true), set_config('prueba.unidad_b', :'unidad_b', true),
       set_config('prueba.tipo_tarjeta', :'tipo_tarjeta', true), set_config('prueba.tipo_placas', :'tipo_placas', true),
       set_config('prueba.tipo_soat', :'tipo_soat', true),
       set_config('prueba.ot_a', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · A'), true),
       set_config('prueba.ot_b', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · B'), true),
       set_config('prueba.ot_c', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · C'), true),
       set_config('prueba.ot_d', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · D'), true),
       set_config('prueba.manual_c', gen_random_uuid()::text, true),
       set_config('prueba.soat', gen_random_uuid()::text, true), set_config('prueba.final_soat', gen_random_uuid()::text, true),
       set_config('prueba.nuevo', gen_random_uuid()::text, true), set_config('prueba.nuevo2', gen_random_uuid()::text, true),
       set_config('prueba.cerca', gen_random_uuid()::text, true), set_config('prueba.lejos', gen_random_uuid()::text, true),
       set_config('prueba.final_a', gen_random_uuid()::text, true);
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.hoy() returns date language sql as $$
  select (now() at time zone 'America/Lima')::date;
$$;
-- La OT, hasta terminada, por el camino de siempre (check 120).
create or replace function pg_temp.terminar(p_ot uuid) returns void language plpgsql as $$
begin
  insert into public.ot_etapas (orden_id, nombre, orden_secuencia, area_id, peso_pct, fecha_inicio_programada, fecha_fin_programada)
  values (p_ot, 'Fabricación de la tolva', 1, (select id from public.areas where codigo = 'PRD'), 100, current_date - 10, current_date);
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = p_ot;
  update public.ot_etapas set avance_porcentaje = 100, estado = 'TERMINADA' where orden_id = p_ot and estado <> 'OMITIDA';
  update public.ordenes_trabajo set estado = 'TERMINADA' where id = p_ot;
end;
$$;
create or replace function pg_temp.de_la_ot(p_ot text, p_tipo text) returns setof public.tramites language sql volatile as $$
  select * from public.tramites where orden_id = pg_temp.id(p_ot) and tipo_id = pg_temp.id(p_tipo);
$$;
create or replace function pg_temp.avisos(p_usuario text, p_tramite uuid, p_titulo text) returns integer language sql volatile as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_usuario) and origen_tabla = 'tramites' and origen_id = p_tramite and titulo like p_titulo || '%';
$$;
create or replace function pg_temp.subir(p_tramite text) returns text language plpgsql as $$
declare v_ruta text := pg_temp.id(p_tramite)::text || '/' || gen_random_uuid()::text || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('tramites', v_ruta, public.usuario_actual()::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
  return v_ruta;
end;
$$;
-- El primer día laborable desde `d`.
create or replace function pg_temp.laborable(d date) returns date language sql as $$
  select min(x)::date from generate_series(d, d + 20, interval '1 day') x where public.es_laborable(x::date);
$$;
reset role;

-- 0. Lo que la migración dejó ----------------------------------------------------------
select test.afirmar(
  (select dias_desde_termino_ot = 15 and not solo_sin_placa from public.tramite_tipos where id = pg_temp.id('tipo_tarjeta'))
  and (select dias_desde_termino_ot = 15 and solo_sin_placa from public.tramite_tipos where id = pg_temp.id('tipo_placas'))
  and not exists (select 1 from public.tramite_tipos where dias_desde_termino_ot is not null and ambito <> 'UNIDAD'),
  'el catálogo abre la tarjeta siempre y las placas solo sin placa, a 15 días hábiles del término');
select test.afirmar(
  not has_function_privilege('authenticated', 'public.fn_ot_abre_sus_tramites()', 'execute')
  and not has_function_privilege('authenticated', 'public.tramite_abrir_renovacion(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.tramites_renovar(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.tramites_de_la_orden(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.tramites_renovar(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.tramites_de_la_orden(uuid)', 'execute'),
  'los ayudantes los corre el sistema; renovar y leer los de la OT, la gente');

-- 1. Al terminar la OT ---------------------------------------------------------------------
-- La C ya tiene su tarjeta, registrada a mano por el Tramitador antes de terminar.
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('manual_c'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_b'), pg_temp.id('ot_c'),
    'Tarjeta de la unidad B, adelantada', 'SUNARP', null, null, null, null);
end $$;
reset role;

select test.como_usuario(:'admin_id');
select test.afirmar((select count(*) from public.tramites where orden_id = pg_temp.id('ot_a')) = 0,
  'la OT aprobada no tiene trámites: nacen al terminar');
select pg_temp.terminar(pg_temp.id('ot_a'));
select test.afirmar(
  (select count(*) from public.tramites where orden_id = pg_temp.id('ot_a')) = 1
  and (select count(*) from pg_temp.de_la_ot('ot_a', 'tipo_placas')) = 0,
  'al terminar la OT de una unidad con placa nace solo su tarjeta de propiedad');
select test.afirmar(
  (select t.origen = 'OT' and t.registrado_por is null and t.estado = 'POR_INICIAR' and t.ambito = 'UNIDAD'
          and t.unidad_id = pg_temp.id('unidad_a') and t.numero like 'TR-%' and t.entidad = 'SUNARP'
          and t.asunto = 'Tarjeta de propiedad por la OT ' || o.numero
          and t.cliente_id = o.cliente_id
          and t.fecha_limite = public.sumar_dias_habiles((o.fecha_fin_real at time zone 'America/Lima')::date, 15)
     from pg_temp.de_la_ot('ot_a', 'tipo_tarjeta') t join public.ordenes_trabajo o on o.id = t.orden_id),
  'nace «Por iniciar», a nombre del sistema, con su OT, su cliente y la fecha límite a 15 días hábiles del término');
select set_config('prueba.tarjeta_a', (select id::text from pg_temp.de_la_ot('ot_a', 'tipo_tarjeta')), true);
select test.afirmar(
  pg_temp.avisos('tra', pg_temp.id('tarjeta_a'), 'Trámite nuevo: TR-') = 1 and pg_temp.avisos('trb', pg_temp.id('tarjeta_a'), 'Trámite nuevo: TR-') = 1
  and pg_temp.avisos('ger', pg_temp.id('tarjeta_a'), '') = 0 and pg_temp.avisos('admin', pg_temp.id('tarjeta_a'), '') = 0
  and (select cuerpo = 'Tarjeta de propiedad · QA7-501 · QA CLIENTE 501: Tarjeta de propiedad por la OT ' || o.numero
                       || '. Lo abrió el sistema al terminar la OT ' || o.numero || '. Fecha límite: ' || to_char(t.fecha_limite, 'DD/MM/YYYY') || '.'
         from public.notificaciones n join public.tramites t on t.id = n.origen_id join public.ordenes_trabajo o on o.id = t.orden_id
        where n.usuario_id = pg_temp.id('tra') and n.origen_id = pg_temp.id('tarjeta_a')),
  'avisa a los dos Tramitadores que lo abrió el sistema al terminar la OT, con su fecha límite; a nadie más');

select pg_temp.terminar(pg_temp.id('ot_b'));
select test.afirmar((select count(*) from pg_temp.de_la_ot('ot_b', 'tipo_tarjeta')) = 1
                    and (select count(*) from pg_temp.de_la_ot('ot_b', 'tipo_placas')) = 1
                    and (select asunto from pg_temp.de_la_ot('ot_b', 'tipo_placas')) like 'Placas por la OT %',
  'la unidad sin placa abre también sus placas');
select pg_temp.terminar(pg_temp.id('ot_c'));
select test.afirmar((select count(*) from pg_temp.de_la_ot('ot_c', 'tipo_tarjeta')) = 1
                    and (select origen from pg_temp.de_la_ot('ot_c', 'tipo_tarjeta')) = 'MANUAL'
                    and (select count(*) from pg_temp.de_la_ot('ot_c', 'tipo_placas')) = 1,
  'si el Tramitador ya registró la tarjeta con esa OT, no se abre otra: solo las placas');
update public.tramite_tipos set activo = false where id = pg_temp.id('tipo_placas');
select pg_temp.terminar(pg_temp.id('ot_d'));
select test.afirmar((select count(*) from public.tramites where orden_id = pg_temp.id('ot_d')) = 1
                    and (select count(*) from pg_temp.de_la_ot('ot_d', 'tipo_placas')) = 0,
  'un tipo desactivado en el catálogo ya no se abre');
update public.tramite_tipos set activo = true where id = pg_temp.id('tipo_placas');
-- Solo la de fabricación (decisión de StudioGRCI, 2026-11-27): una reparación de la unidad sin placa no abre nada.
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
select o.cliente_id, o.unidad_id, o.sede_id, 'Check 501 · reparación', 'REPARACION', 'APROBADA'
  from public.ordenes_trabajo o where o.id = pg_temp.id('ot_b');
select set_config('prueba.ot_rep', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · reparación'), true);
select pg_temp.terminar(pg_temp.id('ot_rep'));
select test.afirmar((select estado from public.ordenes_trabajo where id = pg_temp.id('ot_rep')) = 'TERMINADA'
                    and not exists (select 1 from public.tramites where orden_id = pg_temp.id('ot_rep')),
  'la OT de reparación termina y no abre trámites: solo la de fabricación');
-- Que la OT siga su camino no abre otra vez.
set local session_replication_role = replica;
update public.ordenes_trabajo set estado = 'CONTROL_CALIDAD' where id = pg_temp.id('ot_a');
set local session_replication_role = origin;
update public.ordenes_trabajo set estado = 'TERMINADA' where id = pg_temp.id('ot_a');
select test.afirmar((select count(*) from public.tramites where orden_id = pg_temp.id('ot_a')) = 1,
  'si la OT vuelve a terminar, no se abre otra tarjeta');
select test.afirmar(
  (select string_agg(numero, ',' order by numero) from public.tramites) ~ '^(TR-[0-9]{4}-[0-9]{4},?)+$'
  and (select count(distinct numero) = count(*) from public.tramites)
  and (select max(split_part(numero, '-', 2)::integer) - min(split_part(numero, '-', 2)::integer) + 1 = count(*) from public.tramites),
  'la serie TR sigue sin huecos ni repetidos');
select test.debe_fallar($q$update public.tramites set origen = 'MANUAL' where id = current_setting('prueba.tarjeta_a')::uuid$q$,
  'de dónde viene el trámite no se corrige', 'no se corrigen');

-- 2. La OT lee sus trámites -------------------------------------------------------------------
select test.como_usuario(:'cal_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramites_de_la_orden(pg_temp.id('ot_b'))) = 2
                       and not exists (select 1 from public.tramites_de_la_orden(pg_temp.id('ot_b')) where ve),
    'quien ve la OT (Calidad) ve en qué van sus trámites, sin poder abrir su ficha');
  perform test.afirmar((select count(*) from public.tramites where orden_id = pg_temp.id('ot_b')) = 0,
    'ni lee la tabla de trámites');
end $$;
reset role;
select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select bool_and(ve) and count(*) = 2 from public.tramites_de_la_orden(pg_temp.id('ot_b'))),
    'Ventas, que ve los trámites de las unidades, puede abrirlos');
end $$;
reset role;
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select bool_and(ve) and count(*) = 1 from public.tramites_de_la_orden(pg_temp.id('ot_a'))),
    'el Tramitador, que no ve las OT, ve los trámites de cada una');
  -- Lo lleva y lo concluye: la OT lo ve concluido.
  perform public.tramites_actualizar(pg_temp.id('tarjeta_a'), 'EN_TRAMITE',
    (select asunto from public.tramites where id = pg_temp.id('tarjeta_a')), 'SUNARP', 'T-501', pg_temp.hoy(),
    (select fecha_limite from public.tramites where id = pg_temp.id('tarjeta_a')), null, now());
  perform public.tramites_concluir(pg_temp.id('final_a'), pg_temp.id('tarjeta_a'), pg_temp.subir('tarjeta_a'), 'tarjeta.pdf', pg_temp.hoy(), null);
  perform test.afirmar((select estado = 'CONCLUIDO' and fecha_conclusion = pg_temp.hoy() and not vencido
                          from public.tramites_de_la_orden(pg_temp.id('ot_a'))),
    'la OT ve su tarjeta concluida y cuándo');
end $$;
reset role;
select test.como_usuario(:'tes_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select count(*) from public.tramites_de_la_orden(gen_random_uuid())) = 0,
    'de una OT que no existe no sale nada');
end $$;
reset role;

-- 3. Renovar ahora ------------------------------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('soat'), pg_temp.id('tipo_soat'), null, null,
    'SOAT de la camioneta del taller', 'Aseguradora', null, pg_temp.hoy() - 1, null, null);
  perform test.debe_fallar(format($q$select * from public.tramites_renovar(%L, %L)$q$, pg_temp.id('soat'), pg_temp.id('nuevo')),
    'el que todavía no concluye no se renueva', 'todavía no está concluido');
  perform public.tramites_concluir(pg_temp.id('final_soat'), pg_temp.id('soat'), pg_temp.subir('soat'), 'soat.pdf', pg_temp.hoy(), pg_temp.hoy() + 200);
  perform test.afirmar((select puede_renovar and renovado_con is null from public.tramites_visibles(pg_temp.id('soat'))),
    'el concluido que se renueva ofrece «Renovar ahora»');
  perform * from public.tramites_renovar(pg_temp.id('soat'), pg_temp.id('nuevo'));
  perform test.afirmar(
    (select origen = 'RENOVACION' and renueva_a = pg_temp.id('soat') and registrado_por = pg_temp.id('tra')
            and estado = 'POR_INICIAR' and fecha_limite = pg_temp.hoy() + 200
       from public.tramites where id = pg_temp.id('nuevo')),
    'abre la renovación a su nombre, con fecha límite el día en que vence el documento');
  perform test.afirmar((select count(*) from public.tramites_renovar(pg_temp.id('soat'), pg_temp.id('nuevo'))) = 1
                       and (select count(*) from public.tramites where renueva_a = pg_temp.id('soat')) = 1,
    'el mismo envío otra vez devuelve la misma renovación');
  perform test.debe_fallar(format($q$select * from public.tramites_renovar(%L, %L)$q$, pg_temp.id('soat'), pg_temp.id('nuevo2')),
    'no se abre una segunda renovación', 'ya se renueva con el TR-');
  perform test.afirmar(
    (select not puede_renovar and renovado_con = pg_temp.id('nuevo') and renovado_numero like 'TR-%' and renovado_estado = 'POR_INICIAR'
       from public.tramites_visibles(pg_temp.id('soat')))
    and (select renueva_a = pg_temp.id('soat') and renueva_numero = (select numero from public.tramites where id = pg_temp.id('soat'))
               and origen = 'RENOVACION' and registro is not null
           from public.tramites_visibles(pg_temp.id('nuevo'))),
    'la ficha de cada uno nombra al otro');
end $$;
reset role;
select test.afirmar(pg_temp.avisos('trb', pg_temp.id('nuevo'), 'Renovación abierta: TR-') = 1
                    and pg_temp.avisos('tra', pg_temp.id('nuevo'), '') = 0
                    and (select cuerpo like '%. La abrió Tita Trámites (%'
                           from public.notificaciones where usuario_id = pg_temp.id('trb') and origen_id = pg_temp.id('nuevo')),
  'avisa al otro Tramitador quién la abrió; a quien la abrió, no');
select test.como_usuario(:'ven_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select * from public.tramites_renovar(%L, %L)$q$, pg_temp.id('soat'), gen_random_uuid()),
    'Ventas no renueva', 'No tienes permiso');
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select * from public.tramites_renovar(%L, %L)$q$, pg_temp.id('soat'), gen_random_uuid()),
    'Gerencia tampoco: consulta y aprueba', 'No tienes permiso');
end $$;
reset role;
-- La revisión no abre otra: ya tiene la suya.
select test.como_usuario(:'admin_id');
select test.afirmar(
  (select r.avisos from public.revisar_tramites(pg_temp.laborable(pg_temp.hoy() + 175)) r where r.tipo = 'RENOVACION') = 0
  and (select count(*) from public.tramites where renueva_a = pg_temp.id('soat')) = 1,
  'con su renovación abierta a mano, la revisión no abre otra');

-- Se anula la renovación: la revisión ya no abre otra sola, pero a mano sí se puede.
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform public.tramites_pedir_anulacion(pg_temp.id('nuevo'), 'La camioneta se vendió: no se renueva su SOAT.');
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform public.tramites_resolver_anulacion(pg_temp.id('nuevo'), true, null,
    (select anulacion_pedida_en from public.tramites where id = pg_temp.id('nuevo')));
end $$;
reset role;
select test.como_usuario(:'admin_id');
select test.afirmar(
  (select r.avisos from public.revisar_tramites(pg_temp.laborable(pg_temp.hoy() + 180)) r where r.tipo = 'RENOVACION') = 0,
  'con la renovación anulada, la revisión no abre otra');
-- Pero cuando su documento vence, lo avisa una vez, al Tramitador y a Gerencia: no pasa callado.
-- (La revisión va en su propia sentencia: lo que escribe no lo ve otra
-- subconsulta de la misma sentencia.)
select set_config('prueba.r', (select r.avisos::text from public.revisar_tramites(pg_temp.laborable(pg_temp.hoy() + 205)) r where r.tipo = 'VENCIDO'), true);
select test.afirmar(
  current_setting('prueba.r')::integer >= 1
  and pg_temp.avisos('ger', pg_temp.id('soat'), 'Venció el documento del ' || (select numero from public.tramites where id = pg_temp.id('soat'))) = 1
  and pg_temp.avisos('tra', pg_temp.id('soat'), 'Venció el documento del ') = 1
  and (select cuerpo from public.notificaciones where usuario_id = pg_temp.id('tra') and origen_id = pg_temp.id('soat')
         and titulo like 'Venció el documento del %') like '%Su renovación se anuló: si hace falta, ábrela con «Renovar ahora».',
  'con la renovación anulada, el vencimiento del documento se avisa al Tramitador y a Gerencia');
select public.revisar_tramites(pg_temp.laborable(pg_temp.hoy() + 206));
select test.afirmar(pg_temp.avisos('ger', pg_temp.id('soat'), 'Venció el documento del ') = 1,
  'una sola vez');
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.afirmar((select puede_renovar and renovado_estado = 'ANULADO' from public.tramites_visibles(pg_temp.id('soat'))),
    'y el Tramitador la puede abrir de nuevo a mano');
  perform * from public.tramites_renovar(pg_temp.id('soat'), pg_temp.id('nuevo2'));
  perform test.afirmar((select renovado_con = pg_temp.id('nuevo2') from public.tramites_visibles(pg_temp.id('soat'))),
    'la ficha nombra la renovación que está en pie');
end $$;
reset role;

-- 4. Por vencer, para Gerencia --------------------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('cerca'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta que vence en tres días', 'SUNARP', null, null, pg_temp.hoy() + 3, null);
  perform * from public.tramites_registrar(pg_temp.id('lejos'), pg_temp.id('tipo_tarjeta'), pg_temp.id('unidad_a'), null,
    'Tarjeta que vence en diez días', 'SUNARP', null, null, pg_temp.hoy() + 10, null);
end $$;
reset role;
select test.como_usuario(:'ger_id');
set local role authenticated;
do $$ begin
  perform test.afirmar(
    (select por_vencer from public.tramites_visibles(pg_temp.id('cerca')))
    and not (select por_vencer from public.tramites_visibles(pg_temp.id('lejos')))
    and not (select por_vencer from public.tramites_visibles(pg_temp.id('tarjeta_a'))),
    'Gerencia ve por vencer lo que entró en los días de aviso de su tipo (5 en la tarjeta), no lo de más allá ni lo concluido');
  perform test.afirmar((select registro is null and origen = 'OT' from public.tramites_visibles(pg_temp.id('tarjeta_a'))),
    'el que abrió la base sale sin quién lo registró, con su origen');
end $$;
reset role;

-- 5. El catálogo -------------------------------------------------------------------------------------
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'SOAT', 'Aseguradora', 'EMPRESA', true, '[30,15,7]'::jsonb, true, false, 10, false)$q$,
    pg_temp.id('tipo_soat')), 'el de la empresa no se abre al terminar la OT', 'Solo el trámite de una unidad');
  perform test.debe_fallar(format($q$select * from public.tramites_guardar_tipo(%L, 'Placas', 'Asociación Automotriz del Perú', 'UNIDAD', false, '[5]'::jsonb, true, false, 61, true)$q$,
    pg_temp.id('tipo_placas')), 'los días desde el término van de 1 a 60', 'van de 1 a 60');
  -- La pantalla de antes del despliegue no manda lo de la OT: no lo toca.
  perform * from public.tramites_guardar_tipo(pg_temp.id('tipo_placas'), 'Placas', 'Asociación Automotriz del Perú', 'UNIDAD', false,
    '[7]'::jsonb, true, false);
  perform test.afirmar((select dias_aviso = '{7}' and dias_desde_termino_ot = 15 and solo_sin_placa
                          from public.tramite_tipos where id = pg_temp.id('tipo_placas')),
    'guardar desde la pantalla de antes no borra lo de la OT');
  perform * from public.tramites_guardar_tipo(pg_temp.id('tipo_placas'), 'Placas', 'Asociación Automotriz del Perú', 'UNIDAD', false,
    '[5]'::jsonb, true, false, null, true);
  perform test.afirmar((select dias_desde_termino_ot is null and not solo_sin_placa
                          from public.tramite_tipos where id = pg_temp.id('tipo_placas')),
    'la pantalla nueva lo quita: sin días, ni «solo sin placa»');
  perform * from public.tramites_guardar_tipo(pg_temp.id('tipo_placas'), 'Placas', 'Asociación Automotriz del Perú', 'UNIDAD', false,
    '[5]'::jsonb, true, false, 15, true);
  perform test.afirmar((select dias_desde_termino_ot = 15 and solo_sin_placa from public.tramite_tipos where id = pg_temp.id('tipo_placas')),
    'y lo vuelve a poner');
end $$;
reset role;

-- 6. La OT de un lote de prueba ------------------------------------------------------------------------
-- La que se termina dentro del lote: sus trámites entran al lote y la limpieza se los lleva.
select test.como_usuario(:'admin_id');
insert into public.pruebas_lotes (id, motivo) values ('50100000-0000-4000-8000-00000000a0a1', 'Check 501, dentro del lote'),
                                                     ('50100000-0000-4000-8000-00000000a0a2', 'Check 501, terminada fuera');
create or replace function pg_temp.ot_del_lote(p_lote text, p_desc text) returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('pruebas.lote', p_lote, true);
  insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
  values ((select cliente_id from public.unidades where id = pg_temp.id('unidad_b')), pg_temp.id('unidad_b'),
          (select id from public.sedes where codigo = 'QA501'), p_desc, 'FABRICACION', 'APROBADA')
  returning id into v_id;
  return v_id;
end;
$$;
select set_config('prueba.ot_lote', pg_temp.ot_del_lote('50100000-0000-4000-8000-00000000a0a1', 'Check 501 · lote')::text, true);
select pg_temp.terminar(pg_temp.id('ot_lote'));
select set_config('pruebas.lote', '', true);
select test.afirmar(
  (select count(*) from public.tramites t
     join public.pruebas_filas f on f.tabla = 'tramites' and f.fila_id = t.id and f.lote_id = '50100000-0000-4000-8000-00000000a0a1'
    where t.orden_id = pg_temp.id('ot_lote')) = 2,
  'los trámites de la OT que se termina dentro de un lote de prueba entran al lote');
select public.pruebas_limpiar('50100000-0000-4000-8000-00000000a0a1');
select test.afirmar(not exists (select 1 from public.tramites where orden_id = pg_temp.id('ot_lote'))
                    and not exists (select 1 from public.ordenes_trabajo where id = pg_temp.id('ot_lote')),
  'y la limpieza del lote se los lleva con la OT');
-- La OT de un lote que alguien termina fuera del lote: sus trámites van igual al lote de la OT.
select set_config('prueba.ot_fuera', pg_temp.ot_del_lote('50100000-0000-4000-8000-00000000a0a2', 'Check 501 · fuera')::text, true);
select set_config('pruebas.lote', '', true);
select pg_temp.terminar(pg_temp.id('ot_fuera'));
select test.afirmar(
  (select count(*) from public.tramites t
     join public.pruebas_filas f on f.tabla = 'tramites' and f.fila_id = t.id and f.lote_id = '50100000-0000-4000-8000-00000000a0a2'
    where t.orden_id = pg_temp.id('ot_fuera')) = 2,
  'si la OT de un lote se termina fuera de él, sus trámites van igual al lote de la OT');

-- 4b. La renovación que se registró a mano no se repite ----------------------------------------------
-- De una unidad: el Tramitador ya registró con «Registrar» el que renueva al
-- concluido; la revisión no abre otra. (En lo de la empresa no se adivina.)
reset role;
select set_config('prueba.tipo_rev', gen_random_uuid()::text, true), set_config('prueba.rev_viejo', gen_random_uuid()::text, true),
       set_config('prueba.rev_final', gen_random_uuid()::text, true), set_config('prueba.rev_mano', gen_random_uuid()::text, true);
select test.como_usuario(:'tra_id');
set local role authenticated;
do $$ begin
  perform * from public.tramites_guardar_tipo(pg_temp.id('tipo_rev'), 'Revisión anual de la unidad', 'Municipalidad', 'UNIDAD', true,
    '[30]'::jsonb, true, true, null, null);
  perform * from public.tramites_registrar(pg_temp.id('rev_viejo'), pg_temp.id('tipo_rev'), pg_temp.id('unidad_a'), null,
    'Revisión anual de la unidad A', 'Municipalidad', null, pg_temp.hoy() - 1, null, null);
  perform public.tramites_concluir(pg_temp.id('rev_final'), pg_temp.id('rev_viejo'), pg_temp.subir('rev_viejo'), 'rev.pdf', pg_temp.hoy(), pg_temp.hoy() + 100);
  perform * from public.tramites_registrar(pg_temp.id('rev_mano'), pg_temp.id('tipo_rev'), pg_temp.id('unidad_a'), null,
    'Revisión anual de la unidad A, la del próximo año', 'Municipalidad', null, null, pg_temp.hoy() + 100, null);
end $$;
reset role;
select test.como_usuario(:'admin_id');
select public.revisar_tramites(pg_temp.laborable(pg_temp.hoy() + 75));
select test.afirmar(not exists (select 1 from public.tramites where renueva_a = pg_temp.id('rev_viejo')),
  'si el Tramitador ya registró a mano la siguiente de la misma unidad, la revisión no abre otra renovación');

-- 4c. La OT que llega al 100 % --------------------------------------------------------------------
-- En producción la OT no pasa de «Aprobada»: el término es el 100 % del avance de
-- su código interno (decisión de StudioGRCI, 2026-11-27), que ve la revisión
-- diaria. El avance se finge aquí (check 405 prueba el de verdad): 100 % para el
-- código de esta unidad, 0 para los demás.
reset role;
select test.como_usuario(:'admin_id');
insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
values (:'cliente_id', 'CHK501_C_26/72', null, 'CAMION') returning id as unidad_c \gset
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
values (:'cliente_id', :'unidad_c', :'sede_id', 'Check 501 · al 100 %', 'FABRICACION', 'APROBADA');
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
values (:'cliente_id', :'unidad_c', :'sede_id', 'Check 501 · reparación al 100 %', 'MANTENIMIENTO', 'APROBADA');
select set_config('prueba.ot_cien', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · al 100 %'), true),
       set_config('prueba.ot_cien_rep', (select id::text from public.ordenes_trabajo where descripcion = 'Check 501 · reparación al 100 %'), true);
create or replace function public.vehiculo_avance_del_codigo(p_codigo text)
returns integer language sql stable set search_path to 'public' as $$
  select case when public.normalizar_codigo_interno(p_codigo) = public.normalizar_codigo_interno('CHK501_C_26/72') then 100 else 0 end;
$$;
select set_config('prueba.dia_cien', pg_temp.laborable(pg_temp.hoy() + 1)::text, true);
select set_config('prueba.r', (select r.avisos::text from public.revisar_tramites(current_setting('prueba.dia_cien')::date) r where r.tipo = 'DE_LA_OT'), true);
select test.afirmar(
  current_setting('prueba.r')::integer = 1
  and (select count(*) from public.tramites where orden_id = pg_temp.id('ot_cien') and origen = 'OT') = 2
  and (select bool_and(fecha_limite = public.sumar_dias_habiles(current_setting('prueba.dia_cien')::date, 15) and estado = 'POR_INICIAR')
         from public.tramites where orden_id = pg_temp.id('ot_cien'))
  and (select estado::text from public.ordenes_trabajo where id = pg_temp.id('ot_cien')) = 'APROBADA',
  'la OT aprobada cuyo código llega al 100 % abre su tarjeta y sus placas en la revisión, con 15 días hábiles desde ese día');
select test.afirmar(not exists (select 1 from public.tramites where orden_id = pg_temp.id('ot_cien_rep')),
  'la de mantenimiento de la misma unidad, no');
select test.afirmar(
  pg_temp.avisos('tra', (select id from public.tramites where orden_id = pg_temp.id('ot_cien') order by numero limit 1), 'Trámite nuevo: ') = 1,
  'y avisa a los Tramitadores');
select set_config('prueba.r', (select r.avisos::text from public.revisar_tramites(pg_temp.laborable(current_setting('prueba.dia_cien')::date + 1)) r where r.tipo = 'DE_LA_OT'), true);
select test.afirmar(
  current_setting('prueba.r')::integer = 0
  and (select count(*) from public.tramites where orden_id = pg_temp.id('ot_cien')) = 2,
  'la revisión del día siguiente no abre otros');

-- 5. Lo que dice la OT y lo que ofrece la ficha -------------------------------------------------
-- La tarjeta registrada a mano con la OT también es de la regla: la OT no se da por cumplida sin ella.
select test.como_usuario(:'tra_id');
set local role authenticated;
select test.afirmar(
  (select bool_and(de_la_regla) and count(*) = 2 from public.tramites_de_la_orden(pg_temp.id('ot_c'))),
  'en la OT, la tarjeta registrada a mano y las placas abiertas por la OT cuentan las dos para la regla');
-- Con el tipo fuera de uso, la ficha no ofrece «Renovar ahora» (la función lo rechazaría).
select set_config('prueba.soat2', gen_random_uuid()::text, true), set_config('prueba.final_soat2', gen_random_uuid()::text, true);
do $$ begin
  perform * from public.tramites_registrar(pg_temp.id('soat2'), pg_temp.id('tipo_soat'), null, null,
    'SOAT de la segunda camioneta del taller', 'Aseguradora', null, pg_temp.hoy() - 1, null, null);
  perform public.tramites_concluir(pg_temp.id('final_soat2'), pg_temp.id('soat2'), pg_temp.subir('soat2'), 'soat2.pdf', pg_temp.hoy(), pg_temp.hoy() + 200);
  perform test.afirmar((select puede_renovar from public.tramites_visibles(pg_temp.id('soat2'))), 'el SOAT concluido ofrece «Renovar ahora»');
end $$;
reset role;
update public.tramite_tipos set activo = false where id = pg_temp.id('tipo_soat');
set local role authenticated;
select test.afirmar(not (select puede_renovar from public.tramites_visibles(pg_temp.id('soat2'))),
  'con su tipo fuera de uso, ya no lo ofrece');
reset role;

rollback;
