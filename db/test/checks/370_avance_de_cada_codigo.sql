-- Cada código interno con su porcentaje de avance (migración 20261016300000).
-- Con etapas de Diseño, el promedio de las etapas: la terminada vale 100 y la
-- que no, lo que su área reporta (0 sin reporte); la etapa quitada no cuenta.
-- Sin etapas, el promedio del último avance de cada trabajo, ÁREA POR ÁREA:
-- «Soldadura» de Maestranza y de Producción son dos trabajos, y el reporte
-- anulado no cuenta. PLANTA no tiene avance. Solo Gerencia lo lee; Diseño, el
-- supervisor, Requerimientos y Contabilidad no, y anon tampoco puede llamarla.
-- Lo leen las cuentas con su rol —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- Cada área tiene una sola Supervisión activa: si la base ya trae la de
  -- Maestranza o la de Producción, el check usa esa.
  foreach v in array array['GERENTE:GGE', 'DISENO:DIS', 'SUPERVISOR:MTZ', 'SUPERVISOR:PRD', 'REQUERIMIENTOS:REQ', 'CONTABILIDAD:CON'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.370@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 370', lower(replace(v, ':', '.')) || '.370@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
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
-- Un reporte diario vigente con sus trabajos (armazón como dueño: aquí se prueba la lectura).
create or replace function pg_temp.reporte(p_codigo text, p_area text, p_dias integer, p_trabajos jsonb) returns uuid
language plpgsql as $$
declare v_r uuid := gen_random_uuid(); v jsonb; v_orden integer := 0;
begin
  insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
  values (v_r, (now() at time zone 'America/Lima')::date - p_dias, p_codigo, 'Avance del día', 'Trabajo del día',
          pg_temp.id(p_area), pg_temp.id('supervisor_' || p_area));
  for v in select * from jsonb_array_elements(p_trabajos) loop
    v_orden := v_orden + 1;
    insert into public.reporte_diario_trabajos (reporte_id, orden, descripcion, avance)
    values (v_r, v_orden, v->>0, (v->>1)::smallint);
  end loop;
  return v_r;
end $$;
create or replace function pg_temp.etapa(p_codigo text, p_orden integer, p_nombre text, p_area text, p_fin_dias integer)
returns uuid language sql as $$
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_real, fin_real, creado_por)
  values (p_codigo, p_orden, p_nombre, case when p_area is null then null else pg_temp.id(p_area) end,
          case when p_fin_dias is null then null else (now() at time zone 'America/Lima')::date - p_fin_dias - 3 end,
          case when p_fin_dias is null then null else (now() at time zone 'America/Lima')::date - p_fin_dias end,
          pg_temp.id('diseno_dis'))
  returning id;
$$;
create or replace function pg_temp.avance(p_codigo text) returns jsonb language sql as $$
  select to_jsonb(a) from public.codigos_internos_avance(p_codigo) a;
$$;

-- ============================================ Armazón
do $$
declare v_anulado uuid; v_quitada uuid;
begin
  -- A: tres etapas (Maestranza terminada, Producción en curso, la entrega sin
  -- área) y una cuarta quitada que no cuenta, aunque estaba terminada.
  perform pg_temp.etapa('CHK370_A_26/01', 1, 'Habilitado', 'mtz', 1);
  perform pg_temp.etapa('CHK370_A_26/01', 2, 'Armado y soldadura', 'prd', null);
  perform pg_temp.etapa('CHK370_A_26/01', 3, 'Entrega', null, null);
  v_quitada := pg_temp.etapa('CHK370_A_26/01', 4, 'Etapa que se quitó', 'mtz', 2);
  update public.codigo_etapas set quitada_en = now(), quitada_por = pg_temp.id('diseno_dis') where id = v_quitada;
  perform pg_temp.reporte('CHK370_A_26/01', 'mtz', 1, '[["Corte de planchas", 100], ["Soldadura", 50]]');
  perform pg_temp.reporte('CHK370_A_26/01', 'prd', 0, '[["Soldadura", 40], ["Armado del chasis", 20]]');

  -- B: sin etapas. Maestranza reporta Soldadura dos días (30 y luego 100) y
  -- Producción, «soldadura» con otra letra, 20: son dos trabajos, no uno. El
  -- reporte anulado de Producción (Pintura al 0 %) no cuenta.
  perform pg_temp.reporte('CHK370_B_26/02', 'mtz', 2, '[["Soldadura", 30]]');
  perform pg_temp.reporte('CHK370_B_26/02', 'mtz', 1, '[["Soldadura", 100]]');
  perform pg_temp.reporte('CHK370_B_26/02', 'prd', 0, '[["  soldadura ", 20]]');
  v_anulado := pg_temp.reporte('CHK370_B_26/02', 'prd', 0, '[["Pintura", 0]]');
  update public.reportes_diarios
     set anulado_en = now(), anulado_por = pg_temp.id('gerente_gge'), motivo_anulacion = 'Se subió a otro código por error'
   where id = v_anulado;

  -- C: solo etapas de Diseño, una de dos terminada, sin ningún reporte.
  perform pg_temp.etapa('CHK370_C_26/03', 1, 'Habilitado', 'mtz', 0);
  perform pg_temp.etapa('CHK370_C_26/03', 2, 'Pintura', null, null);

  -- PLANTA: el trabajo de la planta no es una unidad.
  perform pg_temp.reporte('PLANTA', 'mtz', 0, '[["Orden y limpieza", 100]]');
end $$;

-- ============================================ 1. Gerencia ve el porcentaje de cada código
select pg_temp.como('gerente_gge');
set local role authenticated;
select test.afirmar((pg_temp.avance('CHK370_A_26/01')->>'avance')::integer = 43,
  'con etapas: (100 de la terminada + 30 que reporta Producción + 0 de la entrega) / 3 = 43 %');
select test.afirmar(pg_temp.avance('CHK370_A_26/01')->>'fuente' = 'ETAPAS', 'el de A sale de las etapas');
select test.afirmar((pg_temp.avance('CHK370_A_26/01')->>'etapas')::integer = 3 and (pg_temp.avance('CHK370_A_26/01')->>'etapas_terminadas')::integer = 1,
  'la etapa quitada no cuenta: 1 de 3 terminadas');
select test.afirmar((pg_temp.avance('CHK370_A_26/01')->>'trabajos')::integer = 4 and (pg_temp.avance('CHK370_A_26/01')->>'trabajos_terminados')::integer = 1,
  'Soldadura de Maestranza y Soldadura de Producción son dos trabajos: 4, uno terminado');
select test.afirmar((pg_temp.avance('CHK370_A_26/01')->>'ultimo_reporte')::date = (now() at time zone 'America/Lima')::date,
  'el último reporte de A es el de hoy');
select test.afirmar((pg_temp.avance('CHK370_B_26/02')->>'avance')::integer = 60 and pg_temp.avance('CHK370_B_26/02')->>'fuente' = 'REPORTES',
  'sin etapas: (100 de Maestranza + 20 de Producción) / 2 = 60 %, del reporte diario');
select test.afirmar((pg_temp.avance('CHK370_B_26/02')->>'trabajos')::integer = 2 and (pg_temp.avance('CHK370_B_26/02')->>'trabajos_terminados')::integer = 1,
  'el anulado no cuenta y la Soldadura de cada área va aparte');
select test.afirmar(
  (select avance_medio from public.codigos_internos_resumen() where codigo = 'CHK370_B_26/02') = 20,
  'el resumen viejo juntaba las dos Soldaduras y decía 20 %: por eso la pantalla ya no lo lee');
select test.afirmar((pg_temp.avance('CHK370_C_26/03')->>'avance')::integer = 50 and pg_temp.avance('CHK370_C_26/03')->>'fuente' = 'ETAPAS',
  'solo etapas: una de dos terminada y sin reporte = 50 %');
select test.afirmar((pg_temp.avance('CHK370_C_26/03')->>'trabajos')::integer = 0 and (pg_temp.avance('CHK370_C_26/03')->>'ultimo_reporte')::date is null,
  'sin reportes, C no tiene trabajos ni último reporte');
select test.afirmar(exists (select 1 from public.codigos_internos_de_diseno() where codigo = 'CHK370_C_26/03' and etapas = 2),
  'C, que solo tiene Diseño, llega a la lista de Gerencia por Diseño');
select test.afirmar(not exists (select 1 from public.codigos_internos_avance() where codigo = 'PLANTA'), 'PLANTA no tiene avance');
select test.afirmar(not exists (select 1 from public.codigos_internos_avance('PLANTA')), 'ni pidiéndolo solo');
select test.afirmar(not exists (select 1 from public.codigos_internos_avance('CHK370_D_26/04')),
  'un código sin etapas ni reportes no viene: la pantalla lo pone en 0 %');
select test.afirmar(
  (select to_jsonb(a) from public.codigos_internos_avance() a where a.codigo = 'CHK370_A_26/01')
    = (select to_jsonb(a) from public.codigos_internos_avance('  chk370_a_26/01 ') a),
  'la lista y el detalle dan lo mismo, aunque el código se pida en minúsculas y con espacios');
reset role;

-- ============================================ 2. Nadie más lo lee
select pg_temp.como('diseno_dis');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigos_internos_avance()$q$, 'Diseño no lee el avance de Gerencia', 'codigos_internos.ver');
reset role;
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigos_internos_avance('CHK370_A_26/01')$q$, 'el supervisor tampoco', 'codigos_internos.ver');
reset role;
select pg_temp.como('requerimientos_req');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigos_internos_avance()$q$, 'Requerimientos tampoco', 'codigos_internos.ver');
reset role;
select pg_temp.como('contabilidad_con');
set local role authenticated;
select test.debe_fallar($q$select * from public.codigos_internos_avance()$q$, 'Contabilidad tampoco', 'codigos_internos.ver');
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.codigos_internos_avance(text)', 'execute'), 'anon no puede llamarla');
select test.afirmar(has_function_privilege('authenticated', 'public.codigos_internos_avance(text)', 'execute'),
  'las cuentas sí: el permiso lo exige la función');

rollback;
