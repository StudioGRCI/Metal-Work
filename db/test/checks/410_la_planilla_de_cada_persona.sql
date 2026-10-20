-- La planilla de cada persona y quién sale en el reporte diario (migración
-- 20261020181000). RR. HH. elige si la persona es de planilla de taller o
-- administrativa; el supervisor ve en su reporte solo a la gente de taller de
-- Maestranza, Producción o Acabados. Cada paso con el rol que lo da —nunca
-- ADMIN— y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_clave text; v_id uuid;
begin
  foreach v in array array['sup_mtz:SUPERVISOR:MTZ', 'rrhh:RECURSOS_HUMANOS:RRH'] loop
    v_clave := split_part(v, ':', 1);
    if split_part(v, ':', 2) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 3)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || v_clave, v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, v_clave || '.410@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 2), 'Check 410', v_clave || '.410@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3))
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || v_clave, v_id::text, true);
  end loop;
  -- Cuatro personas: soldador de Maestranza, pintora de Acabados, asistente de
  -- RR. HH. y almacenero de Almacén.
  foreach v in array array['soldador:MTZ:70004101', 'pintora:ACB:70004102', 'asistente:RRH:70004103', 'almacenero:ALM:70004104'] loop
    perform set_config('prueba.' || split_part(v, ':', 1), gen_random_uuid()::text, true);
    perform set_config('prueba.' || split_part(v, ':', 1) || '_area', (select id::text from public.areas where codigo = split_part(v, ':', 2)), true);
    perform set_config('prueba.' || split_part(v, ':', 1) || '_dni', split_part(v, ':', 3), true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
-- Lo que el supervisor ve en la lista del reporte: si sale esa persona.
create or replace function pg_temp.sale(p_clave text) returns boolean language sql as $$
  select exists (select 1 from public.reporte_diario_personal_disponible() d where d.id = current_setting('prueba.' || p_clave)::uuid);
$$;

-- ======================================================= 1. RR. HH. registra a las cuatro
select pg_temp.como('rrhh');
set local role authenticated;
select public.rrhh_guardar_trabajador(pg_temp.id(p), initcap(p), 'Check 410', pg_temp.txt(p || '_dni'), initcap(p),
  pg_temp.id(p || '_area'), '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-41', null)
  from unnest(array['soldador', 'pintora', 'asistente', 'almacenero']) p;
select test.afirmar(
  (select bool_and(planilla = 'TALLER') from public.trabajadores
    where id in (pg_temp.id('soldador'), pg_temp.id('pintora'), pg_temp.id('asistente'), pg_temp.id('almacenero'))),
  'quien se registra sin elegir queda en la planilla de taller');
select public.rrhh_guardar_planilla_trabajador(pg_temp.id('asistente'), 'administrativa');
select test.afirmar((select planilla from public.trabajadores where id = pg_temp.id('asistente')) = 'ADMINISTRATIVA',
  'RR. HH. pone a la asistente en la planilla administrativa');
select test.debe_fallar(format('select public.rrhh_guardar_planilla_trabajador(%L, ''OFICINA'')', pg_temp.txt('pintora')),
  'solo hay dos planillas', 'de taller o administrativa');
select test.debe_fallar(format('select public.rrhh_guardar_planilla_trabajador(%L, ''TALLER'')', gen_random_uuid()),
  'a quien no está registrado no se le pone planilla', 'no está registrada');
reset role;

-- ======================================================= 2. El supervisor ve solo al taller
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.sale('soldador') and pg_temp.sale('pintora'),
  'en el reporte diario salen el soldador de Maestranza y la pintora de Acabados');
select test.afirmar(not pg_temp.sale('asistente'), 'no sale la asistente de la planilla administrativa');
select test.afirmar(not pg_temp.sale('almacenero'), 'ni el almacenero, que es de taller pero de Almacén');
select test.debe_fallar(format('select public.rrhh_guardar_planilla_trabajador(%L, ''ADMINISTRATIVA'')', pg_temp.txt('soldador')),
  'el supervisor no cambia la planilla', 'rrhh.personal');
reset role;

-- RR. HH. pasa a la pintora a la oficina: deja de salir en el reporte.
select pg_temp.como('rrhh');
set local role authenticated;
select public.rrhh_guardar_planilla_trabajador(pg_temp.id('pintora'), 'ADMINISTRATIVA');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(not pg_temp.sale('pintora'), 'con la planilla administrativa, la pintora ya no sale en el reporte');
reset role;

select test.afirmar(not has_function_privilege('anon', 'public.rrhh_guardar_planilla_trabajador(uuid, text)', 'execute'),
  'anon no cambia la planilla');

select 'CHECK 410 OK' as resultado;
rollback;
