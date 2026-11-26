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
     current_date - 5, current_date - 9, current_date - 2, current_setting('prueba.diseno_dis')::uuid);

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
    where r.tipo in ('POR_VENCER', 'VENCIDA', 'RECORDATORIO')) = 'POR_VENCER=1,RECORDATORIO=0,VENCIDA=1',
  'avisa una etapa por vencer y una vencida; ni la con holgura ni la terminada');

select test.afirmar(
  pg_temp.avisos_de('recursos_humanos_rrh') =
    'Por vencer: CHK476_A · Por vencer → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A | Vencida: CHK476_A · Vencida → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A',
  'RR. HH. recibe los dos, con el detalle del código');
select test.afirmar(
  pg_temp.avisos_de('supervisor_prd') =
    'Por vencer: CHK476_A · Por vencer → /planos?q=CHK476_A | Vencida: CHK476_A · Vencida → /planos?q=CHK476_A',
  'el supervisor de Producción recibe los dos, con su pantalla de planos y etapas');
select test.afirmar(pg_temp.avisos_de('supervisor_mtz') = '', 'el supervisor de otra área no recibe nada');
select test.afirmar(
  pg_temp.avisos_de('gerente_gge') = 'Vencida: CHK476_A · Vencida → /rrhh/tiempos-de-entrega/codigo?codigo=CHK476_A',
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
  (select r.avisos = 1 from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 2)) r
    where r.tipo = 'RECORDATORIO'),
  'a los 2 días hábiles sale el recordatorio de la que sigue vencida');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones n where n.titulo = 'Sigue vencida: CHK476_A · Vencida'
      and n.usuario_id = current_setting('prueba.recursos_humanos_rrh')::uuid)
  and not exists (select 1 from public.notificaciones n where n.titulo like 'Sigue vencida%'
      and n.usuario_id = current_setting('prueba.gerente_gge')::uuid),
  'el recordatorio va a RR. HH. y no a Gerencia');

-- Si Diseño mueve la fecha, la etapa vuelve a avisar por la fecha nueva.
update public.codigo_etapas set fin_plan = current_date - 1 where id = '47600000-0000-4000-8000-0000000000e2';
select test.afirmar(
  (select r.avisos = 1 from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_setting('prueba.hoy')::date, 2)) r
    where r.tipo = 'VENCIDA'),
  'con la fecha cambiada, la vencida avisa de nuevo');

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
