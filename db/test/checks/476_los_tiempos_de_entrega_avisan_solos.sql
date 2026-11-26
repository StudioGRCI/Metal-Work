-- Los tiempos de entrega avisan solos (migración 20261126310000). La revisión
-- diaria la corre pg_cron, sin sesión; aquí se corre igual, sin sesión, y los
-- avisos se leen con la cuenta de cada puesto y `set local role authenticated`
-- —nunca ADMIN—: RR. HH., el supervisor del área, el de otra área, Gerencia y
-- Tesorería. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Que solo cuenten los avisos de esta prueba.
delete from public.notificaciones;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['RECURSOS_HUMANOS:RRH', 'GERENTE:GGE', 'SUPERVISOR:PRD', 'SUPERVISOR:MTZ', 'TESORERIA:TES', 'DISENO:DIS'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.476@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 476', lower(replace(v, ':', '.')) || '.476@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;

  insert into public.trabajadores (id, nombres, apellidos, dni, area_id, creado_por) values
    ('47600000-0000-4000-8000-000000000001', 'Ana', 'Aviso Uno', '47600001', (select id from public.areas where codigo = 'PRD'),
     current_setting('prueba.recursos_humanos_rrh')::uuid);

  -- Un código sin OT con una etapa de cada caso, en Producción.
  insert into public.codigo_etapas (id, codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, fin_real, creado_por) values
    ('47600000-0000-4000-8000-0000000000e1', 'CHK476_A', 1, 'Por vencer', (select id from public.areas where codigo = 'PRD'),
     public.sumar_dias_habiles(current_date, 2), null, null, current_setting('prueba.diseno_dis')::uuid),
    ('47600000-0000-4000-8000-0000000000e2', 'CHK476_A', 2, 'Vencida', (select id from public.areas where codigo = 'PRD'),
     current_date - 3, current_date - 6, null, current_setting('prueba.diseno_dis')::uuid),
    ('47600000-0000-4000-8000-0000000000e3', 'CHK476_A', 3, 'Con holgura', (select id from public.areas where codigo = 'PRD'),
     public.sumar_dias_habiles(current_date, 10), null, null, current_setting('prueba.diseno_dis')::uuid),
    ('47600000-0000-4000-8000-0000000000e4', 'CHK476_A', 4, 'Terminada tarde', (select id from public.areas where codigo = 'PRD'),
     current_date - 5, current_date - 9, current_date - 2, current_setting('prueba.diseno_dis')::uuid),
    -- Una etapa de un lote de prueba: no avisa.
    ('47600000-0000-4000-8000-0000000000e6', 'CHK476_P', 1, 'De la prueba', (select id from public.areas where codigo = 'PRD'),
     current_date - 1, current_date - 2, null, current_setting('prueba.diseno_dis')::uuid);
  -- Un mantenimiento sin unidad va por el número de su OT, con espacio. Sin
  -- disparadores: la OT de verdad no hace falta para probar la ruta.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.codigo_etapas (id, codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, fin_real, creado_por) values
    ('47600000-0000-4000-8000-0000000000e5', 'OT 9476-2026', 1, 'Del mantenimiento', (select id from public.areas where codigo = 'MTZ'),
     current_date - 1, current_date - 2, null, current_setting('prueba.diseno_dis')::uuid);
  perform set_config('session_replication_role', 'origin', true);
  -- Una subetapa vencida debajo de la con holgura: se nombra con su etapa.
  insert into public.codigo_etapas (id, codigo_interno, orden, nombre, area_id, fin_plan, padre_id, de_area, creado_por) values
    ('47600000-0000-4000-8000-0000000000e7', 'CHK476_A', 5, 'Fondo', (select id from public.areas where codigo = 'PRD'),
     current_date - 1, '47600000-0000-4000-8000-0000000000e3', true, current_setting('prueba.diseno_dis')::uuid);
  insert into public.pruebas_lotes (id, motivo) values ('47600000-0000-4000-8000-00000000a0a0', 'Check 476');
  insert into public.pruebas_filas (lote_id, tabla, fila_id)
  values ('47600000-0000-4000-8000-00000000a0a0', 'codigo_etapas', '47600000-0000-4000-8000-0000000000e6');

  insert into public.etapa_responsables (etapa_id, trabajador_id, asignado_por)
  values ('47600000-0000-4000-8000-0000000000e2', '47600000-0000-4000-8000-000000000001', current_setting('prueba.recursos_humanos_rrh')::uuid);

  -- El día de la revisión: el laborable de hoy o el siguiente, que no sea lunes
  -- (el lunes se prueba aparte).
  perform set_config('prueba.hoy', (
    select min(d)::text from generate_series(current_date::timestamp, current_date + 14, interval '1 day') d
     where public.es_laborable(d::date) and extract(isodow from d::date) <> 1), true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- Lo que una cuenta lee de sus avisos de esta prueba, con su propia sesión.
create or replace function pg_temp.avisos_de(p_clave text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.como(p_clave);
  set local role authenticated;
  select string_agg(n.titulo || ' → ' || n.ruta, ' | ' order by n.titulo) into v
    from public.notificaciones n where n.titulo like '%CHK476_A%' or n.titulo like 'Resumen%';
  reset role;
  return coalesce(v, '');
end $$;

-- ============================================ 1. Nadie la corre a mano
select pg_temp.como('recursos_humanos_rrh');
set local role authenticated;
select test.debe_fallar($q$select * from public.revisar_tiempos_de_entrega()$q$,
  'la revisión diaria está cerrada a la gente, también a RR. HH.');
select test.debe_fallar($q$insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha) values ('47600000-0000-4000-8000-0000000000e1', 'VENCIDA', current_date, current_date)$q$,
  'nadie anota avisos a mano');
reset role;

-- ============================================ 2. La primera revisión
select test.afirmar(
  (select string_agg(r.tipo || '=' || r.avisos, ',' order by r.tipo)
     from public.revisar_tiempos_de_entrega(current_setting('prueba.hoy')::date) r
    where r.tipo in ('POR_VENCER', 'VENCIDA', 'RECORDATORIO')) = 'POR_VENCER=1,RECORDATORIO=0,VENCIDA=3',
  'avisa la por vencer y las vencidas (la etapa, la de arriba de la subetapa y la del mantenimiento); ni la terminada, ni la del lote de prueba');
select test.afirmar(
  not exists (select 1 from public.notificaciones n where n.titulo like '%CHK476_P%')
  and not exists (select 1 from public.tiempos_entrega_avisos a where a.etapa_id = '47600000-0000-4000-8000-0000000000e6'),
  'la etapa del lote de prueba no avisa ni queda anotada');
select test.afirmar(
  exists (select 1 from public.notificaciones n where n.titulo = 'Vencida: CHK476_A · Con holgura'
             and n.cuerpo like '%Por la subetapa «Fondo».%'),
  'la subetapa vencida avisa por su etapa de arriba y se nombra en el aviso');
select test.afirmar(
  (select bool_and(n.ruta in ('/rrhh/tiempos-de-entrega/codigo?codigo=OT+9476-2026', '/planos?q=OT+9476-2026'))
     and count(*) > 0 from public.notificaciones n where n.titulo like '%OT 9476-2026%'),
  'el código con espacio va escapado en la ruta, para que la campana lo abra');
select test.afirmar(
  (select count(*) = 1 from public.tiempos_entrega_avisos a where a.tipo = 'REVISION' and a.fecha = current_setting('prueba.hoy')::date and a.avisados > 0),
  'la corrida queda anotada con cuántos avisos dejó');

select test.afirmar(
  pg_temp.avisos_de('recursos_humanos_rrh') =
    'Por vencer: CHK476_A · Por vencer → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A | Vencida: CHK476_A · Con holgura → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A | Vencida: CHK476_A · Vencida → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A',
  'RR. HH. recibe los dos, con el detalle del código');
select test.afirmar(
  pg_temp.avisos_de('supervisor_prd') =
    'Por vencer: CHK476_A · Por vencer → /planos?q=CHK476_A | Vencida: CHK476_A · Con holgura → /planos?q=CHK476_A | Vencida: CHK476_A · Vencida → /planos?q=CHK476_A',
  'el supervisor de Producción recibe los dos, con su pantalla de planos y etapas');
select test.afirmar(pg_temp.avisos_de('supervisor_mtz') = '', 'el supervisor de otra área no recibe nada de CHK476_A');
select test.afirmar(
  pg_temp.avisos_de('gerente_gge') = 'Vencida: CHK476_A · Con holgura → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A | Vencida: CHK476_A · Vencida → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A',
  'Gerencia recibe solo la vencida, no la por vencer');
select test.afirmar(pg_temp.avisos_de('tesoreria_tes') = '' and pg_temp.avisos_de('diseno_dis') = '',
  'Tesorería y Diseño no reciben avisos de tiempos');
select test.afirmar(
  (select bool_and(n.cuerpo like '%La lleva Aviso Uno, Ana.%') from public.notificaciones n where n.titulo = 'Vencida: CHK476_A · Vencida')
  and (select bool_and(n.cuerpo like '%Nadie la tiene a cargo todavía.%') from public.notificaciones n where n.titulo = 'Por vencer: CHK476_A · Por vencer'),
  'el aviso dice quién la lleva, o que nadie');

-- ============================================ 3. No repite, y el recordatorio va cada 2 días hábiles
select test.afirmar(
  (select sum(r.avisos) = 0 from public.revisar_tiempos_de_entrega(current_setting('prueba.hoy')::date) r),
  'correrla otra vez el mismo día no repite nada');
select test.afirmar(
  (select r.avisos = 0 from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 1)) r
    where r.tipo = 'RECORDATORIO'),
  'al día hábil siguiente todavía no toca recordar');
select test.afirmar(
  (select r.avisos = 3 from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 2)) r
    where r.tipo = 'RECORDATORIO'),
  'a los 2 días hábiles sale el recordatorio de cada una que sigue vencida');
select test.afirmar(
  (select count(*) = 1 and bool_and(n.titulo = 'Siguen vencidas: 3 etapas' and n.ruta = '/rrhh/tiempos-de-entrega?ver=vencidos'
                                     and n.cuerpo like '3 etapas siguen vencidas en 2 códigos: CHK476_A, OT 9476-2026.%')
     from public.notificaciones n where n.titulo like 'Sigue%' and n.usuario_id = current_setting('prueba.recursos_humanos_rrh')::uuid),
  'a RR. HH. le llega un solo recordatorio con todas, que abre el tablero en «Vencidos»');
select test.afirmar(
  (select count(*) = 1 and bool_and(n.titulo = 'Siguen vencidas: 2 etapas' and n.ruta = '/planos' and n.cuerpo like '2 etapas siguen vencidas, en CHK476_A.%')
     from public.notificaciones n where n.titulo like 'Sigue%' and n.usuario_id = current_setting('prueba.supervisor_prd')::uuid)
  and (select count(*) = 1 and bool_and(n.titulo = 'Sigue vencida: OT 9476-2026')
     from public.notificaciones n where n.titulo like 'Sigue%' and n.usuario_id = current_setting('prueba.supervisor_mtz')::uuid),
  'a cada supervisor, uno con las de su área');
select test.afirmar(
  not exists (select 1 from public.notificaciones n where n.titulo like 'Sigue%'
      and n.usuario_id = current_setting('prueba.gerente_gge')::uuid),
  'el recordatorio no va a Gerencia');

-- Si Diseño mueve la fecha, la etapa vuelve a avisar por la fecha nueva.
update public.codigo_etapas set fin_plan = current_date - 1 where id = '47600000-0000-4000-8000-0000000000e2';
select test.afirmar(
  (select r.avisos = 1 from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 2)) r
    where r.tipo = 'VENCIDA'),
  'con la fecha cambiada, la vencida avisa de nuevo');

-- Una etapa con dos subetapas vencidas avisa una vez; si la peor se termina, la
-- otra ya estaba avisada y no vuelve a salir «Vencida» (ni a Gerencia).
do $$ begin
  insert into public.codigo_etapas (id, codigo_interno, orden, nombre, area_id, fin_plan, creado_por) values
    ('47600000-0000-4000-8000-0000000000f0', 'CHK476_S', 1, 'Arriba', (select id from public.areas where codigo = 'PRD'),
     public.sumar_dias_habiles(current_date, 10), current_setting('prueba.diseno_dis')::uuid),
    -- Y una que vence mañana, para que el aviso lo diga así.
    ('47600000-0000-4000-8000-0000000000f3', 'CHK476_S', 2, 'Mañana', (select id from public.areas where codigo = 'PRD'),
     current_setting('prueba.hoy')::date + 1, current_setting('prueba.diseno_dis')::uuid);
  insert into public.codigo_etapas (id, codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, padre_id, de_area, creado_por) values
    ('47600000-0000-4000-8000-0000000000f1', 'CHK476_S', 3, 'Sub1', (select id from public.areas where codigo = 'PRD'),
     current_date - 4, current_date - 6, '47600000-0000-4000-8000-0000000000f0', true, current_setting('prueba.diseno_dis')::uuid),
    ('47600000-0000-4000-8000-0000000000f2', 'CHK476_S', 4, 'Sub2', (select id from public.areas where codigo = 'PRD'),
     current_date - 2, current_date - 6, '47600000-0000-4000-8000-0000000000f0', true, current_setting('prueba.diseno_dis')::uuid);
end $$;
select test.afirmar(
  (select string_agg(r.tipo || '=' || r.avisos, ',' order by r.tipo)
     from public.revisar_tiempos_de_entrega(current_setting('prueba.hoy')::date) r
    where r.tipo in ('POR_VENCER', 'VENCIDA')) = 'POR_VENCER=1,VENCIDA=1',
  'las dos subetapas vencidas de una etapa son un aviso, y la que vence mañana otro');
select test.afirmar(
  exists (select 1 from public.notificaciones n where n.titulo = 'Vencida: CHK476_S · Arriba' and n.cuerpo like '%Por la subetapa «Sub1» y 1 más.%')
  and exists (select 1 from public.notificaciones n where n.titulo = 'Por vencer: CHK476_S · Mañana' and n.cuerpo like 'Vence mañana%'),
  'el aviso nombra la peor subetapa, y el de mañana dice «Vence mañana»');
update public.codigo_etapas set fin_real = current_date - 1 where id = '47600000-0000-4000-8000-0000000000f1';
select test.afirmar(
  (select r.avisos = 0 from public.revisar_tiempos_de_entrega(current_setting('prueba.hoy')::date) r where r.tipo = 'VENCIDA')
  and (select count(*) = 1 from public.notificaciones n where n.titulo = 'Vencida: CHK476_S · Arriba'
          and n.usuario_id = current_setting('prueba.gerente_gge')::uuid),
  'terminada la peor subetapa, la otra ya estaba avisada: no sale otra «Vencida»');

-- ============================================ 4. El lunes, el resumen a Gerencia
select test.afirmar(
  (select r.avisos = 1 from public.revisar_tiempos_de_entrega(
     (select min(d)::date from generate_series((current_date + 1)::timestamp, current_date + 21, interval '1 day') d
       where extract(isodow from d::date) = 1 and public.es_laborable(d::date))) r
    where r.tipo = 'RESUMEN_SEMANAL'),
  'el lunes sale el resumen');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones n where n.titulo like 'Resumen%'
      and n.usuario_id = current_setting('prueba.gerente_gge')::uuid and n.ruta = '/rrhh/tiempos-de-entrega'
      and n.cuerpo like '%sin nadie a cargo%')
  and not exists (select 1 from public.notificaciones n where n.titulo like 'Resumen%'
      and n.usuario_id in (current_setting('prueba.recursos_humanos_rrh')::uuid, current_setting('prueba.supervisor_prd')::uuid)),
  'el resumen le llega a Gerencia, con las etapas sin nadie a cargo, y no a RR. HH. ni al supervisor');

-- Si el lunes es feriado, el resumen sale el martes, y el miércoles ya no.
do $$
declare v_lunes date := (select min(d)::date from generate_series((current_date + 22)::timestamp, current_date + 40, interval '1 day') d
                          where extract(isodow from d::date) = 1);
begin
  perform set_config('prueba.lunes_feriado', v_lunes::text, true);
  delete from public.feriados where fecha = v_lunes;
  insert into public.feriados (fecha, nombre, laborable) values (v_lunes, 'Feriado del check 476', false);
end $$;
select test.afirmar(
  not exists (select 1 from public.revisar_tiempos_de_entrega(current_setting('prueba.lunes_feriado')::date) r where r.tipo = 'RESUMEN_SEMANAL')
  and (select r.avisos = 1 from public.revisar_tiempos_de_entrega(current_setting('prueba.lunes_feriado')::date + 1) r where r.tipo = 'RESUMEN_SEMANAL')
  and (select r.avisos = 0 from public.revisar_tiempos_de_entrega(current_setting('prueba.lunes_feriado')::date + 2) r where r.tipo = 'RESUMEN_SEMANAL'),
  'con el lunes feriado, el resumen sale el martes y una sola vez');

-- ============================================ 5. El día no laborable no corre
select test.afirmar(
  not exists (select 1 from public.revisar_tiempos_de_entrega(
    (select min(d)::date from generate_series(current_date::timestamp, current_date + 14, interval '1 day') d where not public.es_laborable(d::date)))),
  'en día no laborable la revisión no hace nada');

-- Quien lee la tabla de avisos: quien lleva o consulta los tiempos.
select pg_temp.como('gerente_gge');
set local role authenticated;
select test.afirmar((select count(*) > 0 from public.tiempos_entrega_avisos), 'Gerencia lee lo que ya se avisó');
reset role;
select pg_temp.como('tesoreria_tes');
set local role authenticated;
select test.afirmar((select count(*) = 0 from public.tiempos_entrega_avisos), 'Tesorería no lee lo que se avisó');
reset role;

rollback;
