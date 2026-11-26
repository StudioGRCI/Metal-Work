-- SSOMA, entrega 15.4 (migración 20261126997500): inspecciones con lista de
-- verificación por área; cada hallazgo crea una acción de la 15.2.
--
-- SSOMA lleva la lista, registra la inspección de un área y de cada punto no
-- conforme nace una acción correctiva. La acción es la de la 15.2: se cierra, se
-- reabre, se reasigna y se anula igual, y sus avisos nombran la inspección.
-- SSOMA y Gerencia ven todo; el responsable, solo el hallazgo que le toca.
--
-- Probado con el rol real de cada puesto y `set local role authenticated`,
-- nunca como ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000492', 'PRUEBAS SSOMA S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('T492', 'Taller de pruebas de inspecciones') on conflict (codigo) do nothing;

select test.crear_usuario('Sara', 'Seguridad', 'ssoma492@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma_id \gset
select test.crear_usuario('Sixto', 'Seguridad Dos', 'ssoma2.492@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as ssoma2_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia492@demo.pe', 'GERENTE', (select id from public.sedes limit 1)) as gerente_id \gset
select test.crear_usuario('Saúl', 'Supervisor', 'supervisor492@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as sup_id \gset
select test.crear_usuario('Abel', 'Almacén', 'almacen492@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacen_id \gset
select test.crear_usuario('Vera', 'Ventas', 'ventas492@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Iván', 'Inactivo', 'inactivo492@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as inactivo_id \gset
-- El Supervisor General lee `audit_log` (`auditoria.ver`): las inspecciones no pasan por ahí.
select test.crear_usuario('Gino', 'General', 'supgeneral492@demo.pe', 'SUPERVISOR_GENERAL', (select id from public.sedes limit 1)) as supgen_id \gset
-- El armazón lo monta el administrador; lo que se prueba, nunca.
select test.crear_usuario('Ada', 'Administradora', 'admin492@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

select set_config('prueba.ssoma', :'ssoma_id', true);
select set_config('prueba.ssoma2', :'ssoma2_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.inactivo', :'inactivo_id', true);
select set_config('prueba.supgen', :'supgen_id', true);
select set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
select set_config('prueba.alm', (select id::text from public.areas where codigo = 'ALM'), true);
select set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
select set_config('prueba.en7', ((now() at time zone 'America/Lima')::date + 7)::text, true);
-- El primer punto de la lista con que nace, y el que SSOMA agrega a Maestranza.
select set_config('prueba.p1', '5a150001-0000-4000-8000-000000000001', true);
select set_config('prueba.pm', gen_random_uuid()::text, true);
select set_config('prueba.i1', gen_random_uuid()::text, true);
select set_config('prueba.i2', gen_random_uuid()::text, true);
select set_config('prueba.c1', gen_random_uuid()::text, true);
select set_config('prueba.e1', :'sup_id' || '/' || current_setting('prueba.c1') || '/' || gen_random_uuid() || '.jpg', true);

select test.como_usuario(:'admin_id');
update public.usuarios set activo = false where id = current_setting('prueba.inactivo')::uuid;
select set_config('request.jwt.claim.sub', '', true);

-- Storage local no trae RLS: aquí se prende, como en Supabase. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- Las respuestas de un área: todo conforme, salvo lo que se pasa por punto.
create or replace function pg_temp.respuestas(p_area uuid, p_otras jsonb)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('punto', p.id) || coalesce(p_otras -> p.id::text, '{"resultado": "CONFORME"}'::jsonb))
    from public.ssoma_lista_puntos p
   where p.activo and (p.area_id is null or p.area_id = p_area);
$$;
create or replace function pg_temp.registrar(p_id text, p_area text, p_fecha text, p_tipo text, p_respuestas jsonb)
returns text language sql as $$
  select format('select public.ssoma_registrar_inspeccion(%L, %L, %L::date, %L, null, %L::jsonb)', p_id, p_area, p_fecha, p_tipo, p_respuestas);
$$;
create or replace function pg_temp.hallazgo(p_que_se_vio text, p_que_hacer text, p_responsable text, p_limite text)
returns jsonb language sql as $$
  select jsonb_build_object('resultado', 'NO_CONFORME', 'hallazgo', p_que_se_vio,
                            'accion', jsonb_build_object('que', p_que_hacer, 'responsable', p_responsable, 'fecha_limite', p_limite));
$$;

-- ============================================================ 0. El catálogo
do $$
begin
  perform test.afirmar(
    (select bool_and(c.relrowsecurity) from pg_class c
      where c.oid in ('public.ssoma_lista_puntos'::regclass, 'public.ssoma_inspecciones'::regclass,
                      'public.ssoma_inspeccion_respuestas'::regclass)),
    'las tres tablas nuevas tienen RLS');
  perform test.afirmar(
    not exists (select 1 from unnest(array['public.ssoma_lista_puntos', 'public.ssoma_inspecciones', 'public.ssoma_inspeccion_respuestas']) t
                 where has_table_privilege('authenticated', t, 'insert') or has_table_privilege('authenticated', t, 'update')
                    or has_table_privilege('authenticated', t, 'delete') or has_table_privilege('anon', t, 'select')),
    'se escriben solo por sus funciones y el anónimo no las lee');
  perform test.afirmar(
    not exists (select 1 from pg_trigger t
                 where t.tgrelid in ('public.ssoma_lista_puntos'::regclass, 'public.ssoma_inspecciones'::regclass,
                                     'public.ssoma_inspeccion_respuestas'::regclass)
                   and t.tgname ilike '%audit%'),
    'ninguna se copia a audit_log (el Supervisor General la leería sin ver SSOMA)');
  perform test.afirmar(
    not has_function_privilege('authenticated', 'public.ssoma_origen_de_accion(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.ssoma_punto_repetido(uuid, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_registrar_inspeccion(uuid, uuid, date, text, text, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_acciones_a_la_vista(uuid, uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_inspecciones_a_la_vista(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_respuestas_de_inspeccion(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.ssoma_inspecciones_por_area()', 'execute'),
    'los ayudantes internos no los llama la gente y nada es del anónimo');
  perform test.afirmar(
    (select count(*) from public.ssoma_lista_puntos where area_id is null and activo) = 10,
    'la lista nace con diez puntos para todas las áreas');
  perform test.debe_fallar(
    format('insert into public.ssoma_acciones (area_id, descripcion, responsable_id, fecha_limite, creado_por) values (%L, %L, %L, current_date, %L)',
           current_setting('prueba.mtz'), 'Una acción sin origen no entra', current_setting('prueba.sup'), current_setting('prueba.ssoma')),
    'una acción es de un reporte o de un hallazgo', 'ck_ssoma_accion_origen');
end $$;

-- ============================================================ 1. La lista la lleva SSOMA
do $$
declare
  v integer;
begin
  -- Gerencia la lee, no la cambia. Ventas ni la lee.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_lista_puntos) = 10, 'Gerencia lee la lista');
  perform test.debe_fallar(format('select public.ssoma_agregar_punto(%L, %L, %L)', current_setting('prueba.pm'), current_setting('prueba.mtz'),
    'Tornos y fresadoras con su parada de emergencia a la mano'), 'Gerencia no agrega puntos', 'la lleva SSOMA');
  perform test.debe_fallar(format('select public.ssoma_activar_punto(%L, false)', current_setting('prueba.p1')), 'Gerencia no retira puntos', 'la lleva SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_lista_puntos) = 0, 'Ventas no lee la lista');
  perform test.debe_fallar(format('select public.ssoma_agregar_punto(%L, null, %L)', gen_random_uuid(), 'Un punto que no debe entrar nunca'),
    'Ventas no agrega puntos', 'la lleva SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_agregar_punto(%L, %L, %L)', current_setting('prueba.pm'), current_setting('prueba.mtz'), 'abc'),
    'un punto de tres letras no entra', '5 a 200');
  perform test.debe_fallar(format('select public.ssoma_agregar_punto(%L, %L, %L)', current_setting('prueba.pm'), current_setting('prueba.mtz'),
    'BOTIQUÍN A LA MANO Y CON LO NECESARIO'), 'el que ya está para todas las áreas no se repite en una', 'ya está en la lista de todas las áreas');
  perform public.ssoma_agregar_punto(current_setting('prueba.pm')::uuid, current_setting('prueba.mtz')::uuid,
    '  Tornos y fresadoras   con su parada de emergencia a la mano ');
  perform test.afirmar(
    (select texto = 'Tornos y fresadoras con su parada de emergencia a la mano' and creado_por = current_setting('prueba.ssoma')::uuid and orden = 1
       from public.ssoma_lista_puntos where id = current_setting('prueba.pm')::uuid),
    'SSOMA agrega un punto a Maestranza, con el texto limpio y su nombre');
  -- El mismo pedido repetido no agrega otro; uno distinto con el mismo id se dice.
  perform public.ssoma_agregar_punto(current_setting('prueba.pm')::uuid, current_setting('prueba.mtz')::uuid,
    'Tornos y fresadoras con su parada de emergencia a la mano');
  perform test.afirmar((select count(*) from public.ssoma_lista_puntos where area_id = current_setting('prueba.mtz')::uuid) = 1, 'el reintento no agrega otro');
  perform test.debe_fallar(format('select public.ssoma_agregar_punto(%L, %L, %L)', current_setting('prueba.pm'), current_setting('prueba.mtz'),
    'Otro texto con el mismo id del punto'), 'otro texto con el mismo id se dice', 'ya quedó en la lista');
  perform test.debe_fallar(format('select public.ssoma_agregar_punto(%L, null, %L)', gen_random_uuid(),
    'tornos y fresadoras con su parada de emergencia a la mano'), 'el que ya está en un área no se repite para todas', 'ya está en la lista de');

  -- Retirar y restituir; quién y cuándo los pone la base.
  perform public.ssoma_activar_punto(current_setting('prueba.pm')::uuid, false);
  perform public.ssoma_activar_punto(current_setting('prueba.pm')::uuid, false);
  perform test.afirmar(
    (select not activo and retirado_por = current_setting('prueba.ssoma')::uuid and retirado_en is not null
       from public.ssoma_lista_puntos where id = current_setting('prueba.pm')::uuid),
    'retirado, con quién y cuándo');
  perform public.ssoma_activar_punto(current_setting('prueba.pm')::uuid, true);
  perform test.afirmar(
    (select activo and retirado_por is null and retirado_en is null from public.ssoma_lista_puntos where id = current_setting('prueba.pm')::uuid),
    'restituido');
  reset role;

  -- Ni el dueño de la base lo corrige ni lo borra.
  perform test.debe_fallar(format('update public.ssoma_lista_puntos set texto = %L where id = %L', 'Corregido por debajo', current_setting('prueba.pm')),
    'un punto no se corrige', 'no se corrige');
  perform test.debe_fallar(format('delete from public.ssoma_lista_puntos where id = %L', current_setting('prueba.pm')), 'un punto no se borra', 'no se borra');
end $$;

-- ============================================================ 2. Registrar la inspección
do $$
declare
  v_mtz   uuid := current_setting('prueba.mtz')::uuid;
  v_p1    text := current_setting('prueba.p1');
  v_pm    text := current_setting('prueba.pm');
  v_bien  jsonb;
  v_todo  jsonb;
  v_accion public.ssoma_acciones%rowtype;
  v_aviso public.notificaciones%rowtype;
begin
  -- Dos hallazgos: uno para Supervisión y otro para Almacén.
  v_bien := pg_temp.respuestas(v_mtz, jsonb_build_object(
    v_p1, pg_temp.hallazgo('Dos soldadores sin lentes en la mesa 2', 'Entregar lentes y charla de cinco minutos sobre su uso', current_setting('prueba.sup'), current_setting('prueba.en7')),
    v_pm, pg_temp.hallazgo('El torno 2 tiene la parada de emergencia tapada por una mesa', 'Mover la mesa y dejar libre la parada del torno 2', current_setting('prueba.almacen'), current_setting('prueba.hoy')),
    '5a150001-0000-4000-8000-000000000009', '{"resultado": "NO_APLICA"}'::jsonb));
  perform set_config('prueba.envio', v_bien::text, true);
  perform test.afirmar(jsonb_array_length(v_bien) = 11, 'Maestranza se inspecciona con los diez de todas más el suyo');

  -- Quien no es SSOMA no registra.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_bien),
    'Gerencia consulta, no registra', 'la registra SSOMA');
  reset role;
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_bien),
    'Supervisión no registra inspecciones', 'la registra SSOMA');
  reset role;

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  -- Lo que falta se dice.
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_bien - 0),
    'con un punto de menos no entra', 'cambió mientras llenabas');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA',
      (v_bien - 0) || jsonb_build_array(v_bien -> 1)),
    'con un punto repetido en lugar de otro no entra', 'cambió mientras llenabas');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), current_setting('prueba.alm'), current_setting('prueba.hoy'), 'PLANEADA', v_bien),
    'con la lista de otra área no entra', 'cambió mientras llenabas');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, (current_setting('prueba.hoy')::date + 1)::text, 'PLANEADA', v_bien),
    'una fecha de mañana no entra', 'posterior a hoy');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, (current_setting('prueba.hoy')::date - 61)::text, 'PLANEADA', v_bien),
    'de hace más de 60 días no entra', 'últimos 60 días');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'SORPRESA', v_bien),
    'el tipo es planeada o no planeada', 'planeada o no planeada');
  v_todo := pg_temp.respuestas(v_mtz, jsonb_build_object(v_p1, '{"resultado": "TAL_VEZ"}'::jsonb));
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_todo),
    'cada punto se marca', 'marca si está conforme');
  v_todo := pg_temp.respuestas(v_mtz, jsonb_build_object(v_p1, '{"resultado": "NO_CONFORME", "hallazgo": "corto"}'::jsonb));
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_todo),
    'el no conforme dice qué se encontró', 'cuenta qué encontraste');
  v_todo := pg_temp.respuestas(v_mtz, jsonb_build_object(v_p1, '{"resultado": "NO_CONFORME", "hallazgo": "Dos soldadores sin lentes"}'::jsonb));
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_todo),
    'el hallazgo nace con su acción', 'qué se tiene que hacer');
  v_todo := pg_temp.respuestas(v_mtz, jsonb_build_object(v_p1,
    pg_temp.hallazgo('Dos soldadores sin lentes', 'Entregar lentes a los dos soldadores', current_setting('prueba.inactivo'), current_setting('prueba.en7'))));
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_todo),
    'el responsable es una cuenta activa', 'elige al responsable');
  v_todo := pg_temp.respuestas(v_mtz, jsonb_build_object(v_p1,
    pg_temp.hallazgo('Dos soldadores sin lentes', 'Entregar lentes a los dos soldadores', 'no-es-un-id', current_setting('prueba.en7'))));
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_todo),
    'un responsable que no se lee se dice con palabras', 'elige al responsable');
  v_todo := pg_temp.respuestas(v_mtz, jsonb_build_object(v_p1,
    pg_temp.hallazgo('Dos soldadores sin lentes', 'Entregar lentes a los dos soldadores', current_setting('prueba.sup'), (current_setting('prueba.hoy')::date - 1)::text)));
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_todo),
    'la fecha límite va desde hoy', 'anterior a hoy');
  perform test.afirmar(not exists (select 1 from public.ssoma_inspecciones), 'ningún rechazo dejó una inspección a medias');

  -- La buena: entra entera.
  perform public.ssoma_registrar_inspeccion(current_setting('prueba.i1')::uuid, v_mtz, current_setting('prueba.hoy')::date, 'PLANEADA',
    '  Recorrido con el jefe del área  ', v_bien);
  perform test.afirmar(
    (select i.area_id = v_mtz and i.tipo = 'PLANEADA' and i.observacion = 'Recorrido con el jefe del área' and i.creado_por = current_setting('prueba.ssoma')::uuid
       from public.ssoma_inspecciones i where i.id = current_setting('prueba.i1')::uuid),
    'la inspección queda con su área, su tipo y quién la registró');
  perform test.afirmar(
    (select count(*) = 11 and count(*) filter (where resultado = 'NO_CONFORME') = 2 and count(*) filter (where resultado = 'NO_APLICA') = 1
            and max(orden) = 11 and min(orden) = 1
       from public.ssoma_inspeccion_respuestas where inspeccion_id = current_setting('prueba.i1')::uuid),
    'sus once respuestas, en orden, con dos no conformes y un no aplica');
  perform test.afirmar(
    (select r.orden = 11 and r.texto = 'Tornos y fresadoras con su parada de emergencia a la mano'
       from public.ssoma_inspeccion_respuestas r where r.inspeccion_id = current_setting('prueba.i1')::uuid and r.punto_id = v_pm::uuid),
    'el punto del área va después de los de todas, con su texto guardado');

  -- Cada hallazgo, su acción de la 15.2.
  select a.* into v_accion from public.ssoma_acciones a join public.ssoma_inspeccion_respuestas r on r.id = a.respuesta_id
   where r.inspeccion_id = current_setting('prueba.i1')::uuid and r.punto_id = v_p1::uuid;
  perform set_config('prueba.a1', v_accion.id::text, true);
  perform test.afirmar(
    v_accion.reporte_id is null and v_accion.area_id = v_mtz and v_accion.estado = 'ABIERTA'
    and v_accion.responsable_id = current_setting('prueba.sup')::uuid and v_accion.fecha_limite = current_setting('prueba.en7')::date
    and v_accion.descripcion = 'Entregar lentes y charla de cinco minutos sobre su uso' and v_accion.creado_por = current_setting('prueba.ssoma')::uuid,
    'el hallazgo de los lentes creó su acción, sin reporte, a cargo de Supervisión');
  perform test.afirmar(
    (select count(*) = 1 and bool_and(tipo = 'ASIGNADA') from public.ssoma_accion_eventos where accion_id = v_accion.id),
    'con su primer paso en la historia');
  perform set_config('prueba.a2', (select a.id::text from public.ssoma_acciones a join public.ssoma_inspeccion_respuestas r on r.id = a.respuesta_id
                                    where r.inspeccion_id = current_setting('prueba.i1')::uuid and r.punto_id = v_pm::uuid), true);
  perform test.afirmar(
    (select count(*) from public.ssoma_acciones a join public.ssoma_inspeccion_respuestas r on r.id = a.respuesta_id
      where r.inspeccion_id = current_setting('prueba.i1')::uuid) = 2,
    'dos hallazgos, dos acciones');
  reset role;

  select * into v_aviso from public.notificaciones where usuario_id = current_setting('prueba.sup')::uuid and origen_id = v_accion.id;
  perform test.afirmar(
    v_aviso.titulo = 'Acción correctiva a tu cargo (inspección de ' || (select nombre from public.areas where id = v_mtz) || ' del '
                     || to_char(current_setting('prueba.hoy')::date, 'DD/MM/YYYY') || '): vence el '
                     || to_char(current_setting('prueba.en7')::date, 'DD/MM/YYYY')
    and v_aviso.ruta = '/ssoma/inspecciones/' || current_setting('prueba.i1') || '#accion-' || v_accion.id,
    'al responsable le llega el aviso, con el enlace a su acción en la inspección');

  -- El mismo pedido repetido devuelve la misma; uno distinto con el mismo id se dice.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_registrar_inspeccion(current_setting('prueba.i1')::uuid, v_mtz, current_setting('prueba.hoy')::date, 'PLANEADA',
    '  Recorrido con el jefe del área  ', v_bien);
  perform test.afirmar(
    (select count(*) from public.ssoma_inspecciones) = 1 and (select count(*) from public.ssoma_acciones where respuesta_id is not null) = 2,
    'el reintento no registra otra ni encarga otras acciones');
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'NO_PLANEADA', v_bien),
    'otro contenido con el mismo id se dice', 'ya quedó registrada la primera vez');
  reset role;
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.registrar(current_setting('prueba.i1'), v_mtz::text, current_setting('prueba.hoy'), 'PLANEADA', v_bien),
    'el id de otra persona no se reutiliza', 'Vuelve a abrir');
  reset role;

  -- Lo registrado no se corrige ni se borra, tampoco por el dueño de la base.
  perform test.debe_fallar(format('update public.ssoma_inspecciones set tipo = %L where id = %L', 'NO_PLANEADA', current_setting('prueba.i1')),
    'una inspección no se corrige', 'no se corrige');
  perform test.debe_fallar(format('delete from public.ssoma_inspecciones where id = %L', current_setting('prueba.i1')), 'una inspección no se borra', 'no se borra');
  perform test.debe_fallar(format('update public.ssoma_inspeccion_respuestas set resultado = %L, hallazgo = null where inspeccion_id = %L', 'CONFORME', current_setting('prueba.i1')),
    'una respuesta no se cambia', 'no se cambia ni se borra');
  perform test.debe_fallar(format('update public.ssoma_acciones set respuesta_id = null, reporte_id = null where id = %L', v_accion.id),
    'la acción no cambia de hallazgo', 'no se corrige');
end $$;

-- ============================================================ 3. Quién ve qué
do $$
declare
  v_i1 uuid := current_setting('prueba.i1')::uuid;
  v    record;
begin
  -- SSOMA y Gerencia: todo.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  select * into v from public.ssoma_inspecciones_a_la_vista(v_i1);
  perform test.afirmar(
    v.alcance = 'TODOS' and v.puntos = 11 and v.conformes = 8 and v.no_conformes = 2 and v.no_aplica = 1 and v.sin_accion = 0
    and v.abiertas = 2 and v.vencidas = 0 and v.cerradas = 0 and v.observacion = 'Recorrido con el jefe del área' and v.registro = 'Sara Seguridad',
    'Gerencia ve la inspección entera, con su resultado y sus acciones');
  perform test.afirmar((select count(*) from public.ssoma_respuestas_de_inspeccion(v_i1)) = 11, 'y sus once puntos');
  perform test.afirmar(
    (select count(*) = 2 and bool_and(alcance = 'TODOS' and inspeccion_id = v_i1 and reporte_id is null and hallazgo is not null and inspeccion_fecha is not null)
       from public.ssoma_acciones_a_la_vista(null, v_i1, null)),
    'y las dos acciones, con su hallazgo');
  perform test.afirmar(
    (select puntos = 11 and ultima_id = v_i1 and dias = 0 and abiertas = 2 and vencidas = 0
       from public.ssoma_inspecciones_por_area() where area_id = current_setting('prueba.mtz')::uuid)
    and (select puntos = 10 and ultima is null and abiertas = 0 from public.ssoma_inspecciones_por_area() where area_id = current_setting('prueba.alm')::uuid),
    'por área: la última de Maestranza y Almacén sin inspeccionar');
  perform test.debe_fallar(format('select public.ssoma_anular_inspeccion(%L, %L)', v_i1, 'Gerencia no debe poder anular'), 'Gerencia no anula', 'la anula SSOMA');
  perform test.debe_fallar(format('select public.ssoma_accion_de_hallazgo(%L, %L, %L, %L, %L)', gen_random_uuid(),
      (select respuesta_id from public.ssoma_acciones where id = current_setting('prueba.a1')::uuid),
      'Gerencia no encarga acciones nunca', current_setting('prueba.sup'), current_setting('prueba.en7')),
    'Gerencia no encarga acciones', 'la encarga SSOMA');
  reset role;

  -- El responsable: la inspección, sin sus cifras, y solo su hallazgo.
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  select * into v from public.ssoma_inspecciones_a_la_vista(v_i1);
  perform test.afirmar(
    v.alcance = 'RESPONSABLE' and v.area is not null and v.fecha = current_setting('prueba.hoy')::date
    and v.puntos is null and v.no_conformes is null and v.observacion is null and v.registro is null and v.abiertas is null,
    'el responsable ve de qué área y de qué día es, y nada más de la inspección');
  perform test.afirmar(
    (select count(*) = 1 and bool_and(resultado = 'NO_CONFORME' and hallazgo = 'Dos soldadores sin lentes en la mesa 2')
       from public.ssoma_respuestas_de_inspeccion(v_i1)),
    'solo el hallazgo que le toca');
  perform test.afirmar(
    (select count(*) = 1 and bool_and(alcance = 'RESPONSABLE' and id = current_setting('prueba.a1')::uuid and inspeccion_id = v_i1)
       from public.ssoma_acciones_a_la_vista(null, null, null)),
    'en sus acciones sale la suya, con su inspección');
  perform test.afirmar(
    (select count(*) from public.ssoma_inspecciones) = 0 and (select count(*) from public.ssoma_inspeccion_respuestas) = 0
    and (select count(*) from public.ssoma_lista_puntos) = 0 and (select count(*) from public.ssoma_inspecciones_por_area()) = 0,
    'las tablas y el resumen por área no se le abren');
  perform test.afirmar((select count(*) from public.ssoma_acciones) = 1, 'su acción sí la lee de la tabla (la cuenta su menú)');
  reset role;

  -- Ventas, sin nada a cargo: nada.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_inspecciones_a_la_vista(null)) = 0 and (select count(*) from public.ssoma_respuestas_de_inspeccion(v_i1)) = 0
    and (select count(*) from public.ssoma_acciones_a_la_vista(null, v_i1, null)) = 0 and (select count(*) from public.ssoma_inspecciones_por_area()) = 0
    and (select count(*) from public.ssoma_inspecciones) = 0 and (select count(*) from public.ssoma_inspeccion_respuestas) = 0
    and (select count(*) from public.ssoma_acciones) = 0,
    'Ventas no ve inspecciones, hallazgos ni acciones');
  reset role;

  -- El Supervisor General lee la auditoría: ahí no hay nada de esto.
  perform test.como_usuario(current_setting('prueba.supgen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.audit_log where tabla in ('ssoma_inspecciones', 'ssoma_inspeccion_respuestas', 'ssoma_lista_puntos', 'ssoma_acciones')) = 0
    and (select count(*) from public.ssoma_inspecciones_a_la_vista(null)) = 0,
    'por la auditoría tampoco se lee');
  reset role;
end $$;

-- ============================================================ 4. La acción del hallazgo es la de la 15.2
do $$
declare
  v_i1    uuid := current_setting('prueba.i1')::uuid;
  v_a1    uuid := current_setting('prueba.a1')::uuid;
  v_a2    uuid := current_setting('prueba.a2')::uuid;
  v_donde text;
  v_ruta  text;
  v       record;
begin
  v_donde := 'inspección de ' || (select nombre from public.areas where id = current_setting('prueba.mtz')::uuid) || ' del '
             || to_char(current_setting('prueba.hoy')::date, 'DD/MM/YYYY');
  v_ruta := '/ssoma/inspecciones/' || v_i1 || '#accion-' || v_a1;

  -- Almacén no cierra la acción de Supervisión.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_cerrar_accion(%L, %L, %L, %L::jsonb)', v_a1, current_setting('prueba.c1'),
    'Se entregaron los lentes a los dos', '[]'), 'quien no es su responsable no la cierra', 'su responsable o SSOMA');
  reset role;

  -- Su responsable la cierra con evidencia: SSOMA recibe el aviso, que nombra la inspección.
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-ssoma', current_setting('prueba.e1'), current_setting('prueba.sup'), '{"mimetype": "image/jpeg", "size": 180000}');
  perform public.ssoma_cerrar_accion(v_a1, current_setting('prueba.c1')::uuid, 'Se entregaron lentes a los dos soldadores y se dio la charla',
    jsonb_build_array(current_setting('prueba.e1')));
  reset role;
  perform test.afirmar((select estado = 'CERRADA' from public.ssoma_acciones where id = v_a1), 'el responsable cierra la acción del hallazgo');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.ssoma')::uuid and n.origen_id = v_a1
               and n.titulo = 'Acción cerrada con evidencia (' || v_donde || ')' and n.ruta = v_ruta),
    'a SSOMA le llega el cierre, con el nombre de la inspección y el enlace a la acción');

  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  select * into v from public.ssoma_inspecciones_a_la_vista(v_i1);
  perform test.afirmar(v.abiertas = 1 and v.cerradas = 1, 'la inspección cuenta una abierta y una cerrada');
  perform test.afirmar((select fotos = 1 from public.ssoma_acciones_a_la_vista(null, null, v_a1)), 'la acción trae su evidencia');
  perform test.afirmar((select count(*) from public.ssoma_historia_de_accion(v_a1)) = 2, 'y su historia');

  -- Reabrir: vuelve a su responsable.
  perform public.ssoma_reabrir_accion(v_a1, 'En la foto solo se ve a uno con lentes', current_setting('prueba.en7')::date);
  reset role;
  perform test.afirmar(
    (select estado = 'ABIERTA' from public.ssoma_acciones where id = v_a1)
    and exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.sup')::uuid and n.origen_id = v_a1
                   and n.titulo like 'SSOMA reabrió tu acción correctiva (' || v_donde || ')%' and n.ruta = v_ruta),
    'SSOMA la reabre y el responsable se entera, con el enlace a la inspección');

  -- Reasignar: a Almacén. El nuevo la abre; al anterior ya no se le abre la inspección.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_reasignar_accion(v_a1, current_setting('prueba.almacen')::uuid, current_setting('prueba.en7')::date);
  reset role;
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.almacen')::uuid and n.origen_id = v_a1
               and n.titulo like 'Acción correctiva a tu cargo (' || v_donde || ')%' and n.ruta = v_ruta)
    and exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.sup')::uuid and n.origen_id = v_a1
                   and n.titulo = 'SSOMA le pasó a otra persona tu acción correctiva (' || v_donde || ')' and n.ruta = '/ssoma'),
    'reasignar avisa al nuevo con el enlace y al anterior sin él');
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_inspecciones_a_la_vista(v_i1)) = 0 and (select count(*) from public.ssoma_respuestas_de_inspeccion(v_i1)) = 0,
    'a quien ya no tiene la acción la inspección no se le abre');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_respuestas_de_inspeccion(v_i1)) = 2, 'Almacén ve ahora sus dos hallazgos');
  reset role;

  -- Con acciones vigentes la inspección no se anula.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_inspeccion(%L, %L)', v_i1, 'Se registró en el área equivocada'),
    'con acciones vigentes no se anula', 'anula primero las abiertas');

  -- Anular la acción: el hallazgo se queda sin nadie que lo corrija, y se dice.
  perform public.ssoma_anular_accion(v_a1, 'Se encargó a la persona equivocada');
  reset role;
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.almacen')::uuid and n.origen_id = v_a1
               and n.titulo = 'SSOMA anuló tu acción correctiva (' || v_donde || ')' and n.ruta = '/ssoma'),
    'anular avisa al responsable, con el nombre de la inspección');
  -- A quien se le anuló la acción ya no se le abre ese hallazgo: sigue viendo el de la que le queda.
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ssoma_respuestas_de_inspeccion(v_i1)) = 1
    and not exists (select 1 from public.ssoma_respuestas_de_inspeccion(v_i1) r
                     where r.id = (select respuesta_id from public.ssoma_acciones where id = v_a1))
    and (select count(*) from public.ssoma_inspecciones_a_la_vista(v_i1)) = 1,
    'Almacén deja de ver el hallazgo de su acción anulada y sigue viendo el de la vigente');
  perform test.afirmar(
    (select hallazgo is null and estado = 'ANULADA' from public.ssoma_acciones_a_la_vista(null, null, v_a1))
    and (select hallazgo is not null from public.ssoma_acciones_a_la_vista(null, null, v_a2)),
    'y su acción anulada ya no le trae lo que se encontró; la vigente sí');
  reset role;
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform test.afirmar((select sin_accion = 1 and abiertas = 1 from public.ssoma_inspecciones_a_la_vista(v_i1)), 'la inspección dice que un hallazgo quedó sin acción');

  -- SSOMA le encarga otra al mismo hallazgo.
  perform set_config('prueba.a3', gen_random_uuid()::text, true);
  perform test.debe_fallar(format('select public.ssoma_accion_de_hallazgo(%L, %L, %L, %L, %L)', current_setting('prueba.a3'),
      (select id from public.ssoma_inspeccion_respuestas where inspeccion_id = v_i1 and resultado = 'CONFORME' limit 1),
      'Una acción para un punto conforme', current_setting('prueba.sup'), current_setting('prueba.en7')),
    'un punto conforme no lleva acción', 'Ese hallazgo no existe');
  perform public.ssoma_accion_de_hallazgo(current_setting('prueba.a3')::uuid, (select respuesta_id from public.ssoma_acciones where id = v_a1),
    'Entregar lentes a los dos soldadores de la mesa 2', current_setting('prueba.sup')::uuid, current_setting('prueba.en7')::date);
  perform public.ssoma_accion_de_hallazgo(current_setting('prueba.a3')::uuid, (select respuesta_id from public.ssoma_acciones where id = v_a1),
    'Entregar lentes a los dos soldadores de la mesa 2', current_setting('prueba.sup')::uuid, current_setting('prueba.en7')::date);
  perform test.afirmar(
    (select sin_accion = 0 and abiertas = 2 from public.ssoma_inspecciones_a_la_vista(v_i1))
    and (select count(*) from public.ssoma_acciones where respuesta_id is not null) = 3,
    'el hallazgo vuelve a tener quién lo corrija, y el reintento no encarga dos');
  perform test.debe_fallar(format('select public.ssoma_accion_de_hallazgo(%L, %L, %L, %L, %L)', current_setting('prueba.a3'),
      (select respuesta_id from public.ssoma_acciones where id = v_a1), 'Otro texto con el mismo id de la acción', current_setting('prueba.sup'), current_setting('prueba.en7')),
    'otro contenido con el mismo id se dice', 'ya quedó registrada la primera vez');
  reset role;
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.sup')::uuid and n.origen_id = current_setting('prueba.a3')::uuid
               and n.ruta = '/ssoma/inspecciones/' || v_i1 || '#accion-' || current_setting('prueba.a3')),
    'y a su responsable le llega el aviso');
end $$;

-- ============================================================ 5. Las acciones de un reporte siguen igual
do $$
declare
  v_r  uuid := gen_random_uuid();
  v_a  uuid := gen_random_uuid();
  v    record;
begin
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform public.ssoma_reportar(v_r, 'CONDICION_INSEGURA', current_setting('prueba.alm')::uuid, 'Pasillo 3, estante alto',
    'El estante alto no tiene tope y las cajas se deslizan', null, null, null, '[]'::jsonb);
  reset role;
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_clasificar(v_r, 'CONDICION_INSEGURA', null, null, 'El estante se armó sin el tope de fábrica');
  perform public.ssoma_crear_accion(v_a, v_r, 'Poner el tope de fábrica al estante alto', current_setting('prueba.sup')::uuid, current_setting('prueba.en7')::date);
  select * into v from public.ssoma_acciones_a_la_vista(v_r, null, null);
  perform test.afirmar(
    v.id = v_a and v.reporte_id = v_r and v.reporte_numero is not null and v.inspeccion_id is null and v.hallazgo is null and v.alcance = 'TODOS',
    'la acción de un reporte sale con su número y sin inspección');
  perform test.afirmar(
    (select count(*) from public.ssoma_acciones_a_la_vista(null, current_setting('prueba.i1')::uuid, null) where reporte_id is not null) = 0
    and (select count(*) from public.ssoma_acciones_a_la_vista(v_r, null, null) where inspeccion_id is not null) = 0,
    'cada filtro trae solo lo suyo');
  perform public.ssoma_anular_accion(v_a, 'Se encargó dos veces la misma acción');
  reset role;
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.sup')::uuid and n.origen_id = v_a
               and n.titulo like 'SSOMA anuló tu acción correctiva (RI-%'),
    'y su aviso sigue nombrando el número del reporte');
  -- Quien reportó ve las vigentes de su reporte (alcance REPORTE), como en la 15.2; las de inspección, no.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_crear_accion(gen_random_uuid(), v_r, 'Revisar los demás estantes del pasillo', current_setting('prueba.sup')::uuid, current_setting('prueba.en7')::date);
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.afirmar((select count(*) from public.ssoma_acciones_a_la_vista(v_r, null, null)) = 0, 'Ventas no ve las de un reporte ajeno');
  reset role;
end $$;

-- ============================================================ 6. Anular la inspección
do $$
declare
  v_i1 uuid := current_setting('prueba.i1')::uuid;
  v_i2 uuid := current_setting('prueba.i2')::uuid;
begin
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  -- Una sin hallazgos, en Almacén, de hace tres días y no planeada.
  perform public.ssoma_registrar_inspeccion(v_i2, current_setting('prueba.alm')::uuid, current_setting('prueba.hoy')::date - 3, 'NO_PLANEADA', null,
    pg_temp.respuestas(current_setting('prueba.alm')::uuid, '{}'::jsonb));
  perform test.afirmar(
    (select puntos = 10 and conformes = 10 and no_conformes = 0 and abiertas = 0 and observacion is null from public.ssoma_inspecciones_a_la_vista(v_i2))
    and (select dias = 3 from public.ssoma_inspecciones_por_area() where area_id = current_setting('prueba.alm')::uuid),
    'una inspección sin hallazgos no crea acciones');
  perform test.debe_fallar(format('select public.ssoma_anular_inspeccion(%L, %L)', v_i2, 'corto'), 'anular pide su motivo', '10 a 500');
  perform public.ssoma_anular_inspeccion(v_i2, 'Se registró en el área equivocada');
  perform public.ssoma_anular_inspeccion(v_i2, 'Se registró en el área equivocada');
  perform test.afirmar(
    (select anulado_por = current_setting('prueba.ssoma')::uuid and anulado_en is not null from public.ssoma_inspecciones where id = v_i2)
    and (select ultima is null from public.ssoma_inspecciones_por_area() where area_id = current_setting('prueba.alm')::uuid),
    'anulada con quién y cuándo; ya no es la última de su área');
  perform test.debe_fallar(format('select public.ssoma_anular_inspeccion(%L, %L)', v_i2, 'Otro motivo distinto al primero'),
    'otro motivo de la misma persona se dice', 'ya quedó anulada la primera vez');
  reset role;
  perform test.como_usuario(current_setting('prueba.ssoma2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.ssoma_anular_inspeccion(%L, %L)', v_i2, 'Se registró en el área equivocada'),
    'el mismo motivo de otra cuenta no pasa por suyo', 'ya estaba anulada');
  -- Una anulada no lleva acciones.
  perform test.debe_fallar(format('select public.ssoma_anular_inspeccion(%L, %L)', v_i1, 'Sigue teniendo acciones vigentes'),
    'la primera sigue con acciones', 'anula primero las abiertas');
  reset role;
  perform test.debe_fallar(format('update public.ssoma_inspecciones set motivo_anulacion = %L where id = %L', 'Cambiado por debajo al final', v_i2),
    'la anulada queda congelada', 'queda como evidencia');

  -- Sin acciones vigentes, la primera sí se anula; sus acciones anuladas quedan.
  perform test.como_usuario(current_setting('prueba.ssoma')::uuid);
  set local role authenticated;
  perform public.ssoma_anular_accion(current_setting('prueba.a2')::uuid, 'La inspección se va a anular entera');
  perform public.ssoma_anular_accion(current_setting('prueba.a3')::uuid, 'La inspección se va a anular entera');
  perform public.ssoma_anular_inspeccion(v_i1, 'Se inspeccionó con la lista vieja');
  perform test.afirmar(
    (select anulado_en is not null and motivo_anulacion = 'Se inspeccionó con la lista vieja' and anulo = 'Sara Seguridad'
       from public.ssoma_inspecciones_a_la_vista(v_i1)),
    'sin acciones vigentes se anula, y se lee quién y por qué');
  perform test.debe_fallar(format('select public.ssoma_accion_de_hallazgo(%L, %L, %L, %L, %L)', gen_random_uuid(),
      (select respuesta_id from public.ssoma_acciones where id = current_setting('prueba.a2')::uuid),
      'Una acción para una inspección anulada', current_setting('prueba.sup'), current_setting('prueba.en7')),
    'una inspección anulada no lleva acciones', 'está anulada');
  reset role;
end $$;

-- ============================================================ 7. Un lote de prueba se limpia entero
select test.crear_usuario('Lote', 'Prueba', 'lote492@demo.pe', 'SSOMA', (select id from public.sedes limit 1)) as lote_usuario \gset
insert into public.pruebas_cuentas (usuario_id, motivo) values (:'lote_usuario', 'check 492');
select public.pruebas_abrir('check 492: una inspección de prueba', array[:'lote_usuario'::uuid]) as lote \gset
select set_config('prueba.lote', :'lote', true);
select set_config('prueba.lote_i', gen_random_uuid()::text, true);
select set_config('prueba.lote_usuario', :'lote_usuario', true);
do $$
declare
  v_i uuid := current_setting('prueba.lote_i')::uuid;
begin
  perform test.como_usuario(current_setting('prueba.lote_usuario')::uuid);
  set local role authenticated;
  perform public.ssoma_registrar_inspeccion(v_i, current_setting('prueba.alm')::uuid, current_setting('prueba.hoy')::date, 'PLANEADA', null,
    pg_temp.respuestas(current_setting('prueba.alm')::uuid, jsonb_build_object(current_setting('prueba.p1'),
      pg_temp.hallazgo('Hallazgo del lote de prueba', 'Acción del lote de prueba', current_setting('prueba.lote_usuario'), current_setting('prueba.en7')))));
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform test.afirmar((select count(*) from public.ssoma_acciones a join public.ssoma_inspeccion_respuestas r on r.id = a.respuesta_id where r.inspeccion_id = v_i) = 1,
    'el lote registró su inspección con un hallazgo');
  perform public.pruebas_limpiar(current_setting('prueba.lote')::uuid);
  perform test.afirmar(
    not exists (select 1 from public.ssoma_inspecciones where id = v_i)
    and not exists (select 1 from public.ssoma_inspeccion_respuestas where inspeccion_id = v_i)
    and not exists (select 1 from public.ssoma_acciones where creado_por = current_setting('prueba.lote_usuario')::uuid)
    and (select count(*) from public.ssoma_lista_puntos where area_id is null and activo) = 10
    and exists (select 1 from public.ssoma_inspecciones where id = current_setting('prueba.i1')::uuid),
    'el lote de prueba se lleva su inspección, sus respuestas y su acción, y deja la lista y lo real');
end $$;

rollback;
