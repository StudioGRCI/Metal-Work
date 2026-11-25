-- Recursos Humanos asigna quién lleva cada etapa (migración 20261125310000).
-- Cada paso con el puesto que lo hace —nunca ADMIN— y `set local role
-- authenticated`: RR. HH. asigna y cambia; Gerencia y el supervisor ven y no
-- asignan; Tesorería, que no ve las etapas, tampoco a quién las lleva. La persona de antes queda en el historial. Termina
-- en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['RECURSOS_HUMANOS:RRH', 'GERENTE:GGE', 'SUPERVISOR:PRD', 'TESORERIA:TES', 'DISENO:DIS'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.462@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 462', lower(split_part(v, ':', 1)) || '.462@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;

  -- Dos personas del taller y una de baja.
  insert into public.trabajadores (id, nombres, apellidos, dni, area_id, creado_por) values
    ('46200000-0000-4000-8000-000000000001', 'Ana', 'Prueba Uno', '46200001', (select id from public.areas where codigo = 'PRD'), current_setting('prueba.recursos_humanos')::uuid),
    ('46200000-0000-4000-8000-000000000002', 'Beto', 'Prueba Dos', '46200002', (select id from public.areas where codigo = 'PRD'), current_setting('prueba.recursos_humanos')::uuid),
    ('46200000-0000-4000-8000-000000000003', 'Ciro', 'Prueba Baja', '46200003', (select id from public.areas where codigo = 'PRD'), current_setting('prueba.recursos_humanos')::uuid);
  update public.trabajadores set activo = false where id = '46200000-0000-4000-8000-000000000003';

  -- Un código con una etapa vencida, una con holgura y una terminada.
  insert into public.codigo_etapas (id, codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, fin_real, creado_por) values
    ('46200000-0000-4000-8000-0000000000e1', 'CHK462_A', 1, 'Vencida', (select id from public.areas where codigo = 'PRD'), current_date - 1, current_date - 3, null, current_setting('prueba.diseno')::uuid),
    ('46200000-0000-4000-8000-0000000000e2', 'CHK462_A', 2, 'Con holgura', (select id from public.areas where codigo = 'PRD'), public.sumar_dias_habiles(current_date, 10), null, null, current_setting('prueba.diseno')::uuid),
    ('46200000-0000-4000-8000-0000000000e3', 'CHK462_A', 3, 'Terminada', (select id from public.areas where codigo = 'PRD'), current_date - 5, current_date - 9, current_date - 6, current_setting('prueba.diseno')::uuid);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

-- ============================================ 1. El permiso de asignar es solo de RR. HH.
select test.afirmar(
  (select array_agg(r.codigo order by r.codigo) = array['RECURSOS_HUMANOS']::text[]
     from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar'),
  'rrhh.tiempos_entrega_asignar lo tiene solo Recursos Humanos');

-- ============================================ 2. RR. HH. asigna
select pg_temp.como('recursos_humanos');
set local role authenticated;
select test.afirmar(
  public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e1', '46200000-0000-4000-8000-000000000001') is not null,
  'RR. HH. pone a Ana a cargo de la etapa vencida');
select test.afirmar(
  (select count(*) = 1 and bool_and(r.nombre = 'Prueba Uno, Ana')
     from public.responsables_de_etapas('chk462_a') r where r.etapa_id = '46200000-0000-4000-8000-0000000000e1'),
  'la etapa sale con Ana, buscando el código en minúsculas');
select test.afirmar(
  public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e1', '46200000-0000-4000-8000-000000000001')
    = (select id from public.etapa_responsables where etapa_id = '46200000-0000-4000-8000-0000000000e1' and quitado_en is null),
  'asignar a la misma persona otra vez no crea otra fila');
select test.afirmar(
  public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e2', '46200000-0000-4000-8000-000000000001') is not null,
  'Ana lleva también la etapa con holgura');
select test.debe_fallar(
  $q$select public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e3', '46200000-0000-4000-8000-000000000001')$q$,
  'una etapa terminada no se asigna', 'ya terminó');
select test.debe_fallar(
  $q$select public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e2', '46200000-0000-4000-8000-000000000003')$q$,
  'una persona de baja no se asigna', 'de baja');

-- Lo de cada persona: Ana tiene dos, la vencida primero.
select test.afirmar(
  (select string_agg(p.etapa || ':' || p.semaforo, ',' order by p.fin_plan) = 'Vencida:ROJO,Con holgura:VERDE'
     from public.tiempos_de_entrega_por_persona() p where p.trabajador_id = '46200000-0000-4000-8000-000000000001'),
  'la vista por persona trae las dos etapas de Ana con su semáforo');

-- Cambiar de persona deja a la anterior en el historial.
select test.afirmar(
  public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e1', '46200000-0000-4000-8000-000000000002') is not null,
  'RR. HH. cambia la etapa vencida a Beto');
select test.afirmar(
  (select count(*) = 2 and count(*) filter (where quitado_en is not null and quitado_por = current_setting('prueba.recursos_humanos')::uuid) = 1
     from public.etapa_responsables where etapa_id = '46200000-0000-4000-8000-0000000000e1'),
  'Ana queda en el historial con quién la quitó; Beto es el vigente');
select test.afirmar(
  public.quitar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e2'),
  'RR. HH. deja la etapa con holgura sin nadie');
select test.afirmar(
  not exists (select 1 from public.tiempos_de_entrega_por_persona() p where p.trabajador_id = '46200000-0000-4000-8000-000000000001'),
  'Ana ya no tiene etapas a cargo');
select test.debe_fallar(
  $q$insert into public.etapa_responsables (etapa_id, trabajador_id) values ('46200000-0000-4000-8000-0000000000e2', '46200000-0000-4000-8000-000000000002')$q$,
  'nadie escribe directo en la tabla, ni RR. HH.');
select test.debe_fallar(
  $q$select * from public.tiempos_de_entrega_por_persona_calculado()$q$,
  'el cálculo por persona, sin permiso adentro, está cerrado a la gente');
reset role;

-- ============================================ 3. Gerencia y el supervisor ven y no asignan
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) = 1 from public.tiempos_de_entrega_por_persona() p where p.trabajador_id = '46200000-0000-4000-8000-000000000002'),
  'Gerencia ve lo que lleva Beto');
select test.debe_fallar(
  $q$select public.asignar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e2', '46200000-0000-4000-8000-000000000002')$q$,
  'Gerencia no asigna');
reset role;

select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select count(*) = 1 and bool_and(r.nombre = 'Prueba Dos, Beto') from public.responsables_de_etapas('CHK462_A') r),
  'el supervisor ve quién lleva la etapa');
select test.debe_fallar(
  $q$select public.quitar_responsable_de_etapa('46200000-0000-4000-8000-0000000000e1')$q$,
  'el supervisor no quita al responsable');
reset role;

-- ============================================ 4. Quien no ve las etapas no ve a los responsables
select pg_temp.como('tesoreria');
set local role authenticated;
select test.debe_fallar(
  $q$select * from public.responsables_de_etapas('CHK462_A')$q$,
  'Tesorería, que no ve las etapas, no ve quién las lleva', 'No tienes permiso para ver quién lleva las etapas');
select test.afirmar(
  (select count(*) = 0 from public.etapa_responsables),
  'Tesorería no lee la tabla de responsables');
reset role;

select test.afirmar(
  (select quitado_en is null from public.etapa_responsables
    where etapa_id = '46200000-0000-4000-8000-0000000000e1' and trabajador_id = '46200000-0000-4000-8000-000000000002'),
  'Beto sigue a cargo después de los intentos de Gerencia y del supervisor');

rollback;
