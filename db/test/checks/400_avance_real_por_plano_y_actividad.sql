-- El avance de la unidad, lo más real posible (migración 20261020100000).
-- Diseño pone a cada plano el porcentaje de la unidad que representa; cada
-- supervisor reporta sobre un plano de su área, un subcontrato de su área, una
-- actividad que ya abrió o una propia nueva, y el avance de cada una solo sube
-- (el jueves 9 %, el viernes 10 % o más). Gerencia ve el porcentaje de la
-- unidad: lo repartido en planos, plano por plano, y el resto por etapas. Cada
-- paso con el rol que lo da —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_clave text; v_id uuid;
begin
  -- Una sola Supervisión activa por área (20260929110100): si la base ya tiene la del área, se usa esa.
  foreach v in array array['diseno:DISENO:DIS', 'sup_mtz:SUPERVISOR:MTZ', 'sup_prd:SUPERVISOR:PRD', 'sup_acb:SUPERVISOR:ACB',
                           'administracion:ADMINISTRACION:ADM', 'gerente:GERENTE:GGE', 'rrhh:RECURSOS_HUMANOS:RRH',
                           'logistica:COMPRADOR:LOG'] loop
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
    insert into auth.users (id, email) values (v_id, v_clave || '.400@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 2), 'Check 400', v_clave || '.400@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3))
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || v_clave, v_id::text, true);
  end loop;
  foreach v in array array['MTZ', 'PRD', 'ACB'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  foreach v in array array['p1', 'r1', 'p2', 'r2', 'p3', 'r3', 'p4', 'r4', 'sub', 'sc', 'sc_acb', 't1', 't2',
                           'rep_jue', 'rep_vie', 'rep_vie2', 'rep_mie', 'rep_prd', 'rep_sab', 'rep_obs'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.ruc', (select '1071234500' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234500' || d) limit 1), true);
  perform set_config('prueba.codigo', 'CHK400_SR_O4_1_26/40', true);
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
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
-- El día del reporte: hoy menos n.
create or replace function pg_temp.dia(n integer) returns date language sql as $$
  select current_setting('prueba.hoy')::date - n;
$$;
-- Un trabajo del reporte: sobre qué (plano_id, subcontrato_id, actividad_id o
-- descripcion), su avance, y Juan una hora si lleva gente.
create or replace function pg_temp.trabajo(p_sobre text, p_valor text, p_avance integer, p_gente boolean default true)
returns jsonb language sql as $$
  select jsonb_build_object(p_sobre, p_valor, 'avance', p_avance, 'personal',
           case when p_gente then jsonb_build_array(jsonb_build_object('trabajador_id', current_setting('prueba.t1'), 'horas', 1))
                else '[]'::jsonb end);
$$;
-- La sentencia que sube un reporte, para usarla igual en lo que pasa y en lo que debe fallar.
create or replace function pg_temp.reporte_sql(p_id text, p_dias integer, p_trabajos jsonb) returns text language sql as $$
  select format('select public.registrar_reporte_diario(%L, %L, %L, ''Avance de la tolva'', ''Lo que se avanzó en el día'', %L)',
                p_id, pg_temp.dia(p_dias), lower(current_setting('prueba.codigo')), p_trabajos);
$$;
create or replace function pg_temp.subir(p_id text, p_dias integer, p_trabajos jsonb) returns void language plpgsql as $$
begin
  execute pg_temp.reporte_sql(p_id, p_dias, p_trabajos);
end $$;
-- La actividad propia de un código, por su nombre.
create or replace function pg_temp.actividad(p_nombre text) returns text language sql as $$
  select id::text from public.codigo_actividades
   where codigo_interno = current_setting('prueba.codigo') and lower(descripcion) = lower(p_nombre);
$$;
-- El avance de la unidad, como lo ve quien llama: avance, fuente, trabajos…
create or replace function pg_temp.avance(p_campo text) returns text language sql as $$
  select to_jsonb(a) ->> p_campo from public.codigos_internos_avance(current_setting('prueba.codigo')) a;
$$;

-- ======================================================= 0. El armazón
-- RR. HH. registra a Juan, a S/ 2400 al mes (S/ 10 la hora).
select pg_temp.como('rrhh');
set local role authenticated;
select public.rrhh_guardar_trabajador(pg_temp.id('t1'), 'Juan', 'Habilitador', '70000401', 'Habilitador',
  null, '08:00', '18:00', 'Banco de Pruebas', 'AHORROS', '191-0000000-0-01', null);
select public.rrhh_guardar_costo_trabajador(pg_temp.id('t1'), 2400);
reset role;

-- Administración contrata a un pintor para Producción y otro para Acabados.
select pg_temp.como('administracion');
set local role authenticated;
select public.guardar_subcontratista(pg_temp.id('sub'), pg_temp.txt('ruc'), 'Soldador de prueba 400', null, null, null, null, true);
select public.registrar_subcontrato(pg_temp.id('sc'), pg_temp.id('sub'), pg_temp.txt('codigo'),
  'Soldadura de refuerzos del piso', 'PEN', 3000, null, null, 'PRD');
select public.registrar_subcontrato(pg_temp.id('sc_acb'), pg_temp.id('sub'), pg_temp.txt('codigo'),
  'Pintura de la tolva', 'PEN', 1500, null, null, 'ACB');
reset role;

-- ======================================================= 1. Diseño reparte la unidad en planos
select pg_temp.como('diseno');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
select 'planos-codigo', pg_temp.txt('p' || n) || '/' || pg_temp.txt('r' || n) || '.pdf', pg_temp.id('diseno'), pg_temp.txt('diseno'),
       '{"mimetype": "application/pdf", "size": 80000}'
  from generate_series(1, 4) n;
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), pg_temp.txt('codigo'), '001', 'Estructura del cajón',
  pg_temp.id('mtz'), null, 'cajon.pdf', 40);
select public.registrar_plano_codigo(pg_temp.id('p2'), pg_temp.id('r2'), pg_temp.txt('codigo'), '002', 'Bastidor',
  pg_temp.id('prd'), null, 'bastidor.pdf', 30);
select test.debe_fallar(format('select public.registrar_plano_codigo(%L, %L, %L, ''003'', ''Compuerta'', %L, null, ''compuerta.pdf'', 40)',
    pg_temp.txt('p3'), pg_temp.txt('r3'), pg_temp.txt('codigo'), pg_temp.txt('acb')),
  'los planos no pasan del 100 % de la unidad', 'ya suman 70 % de la unidad: a este le queda como mucho 30 %');
select test.debe_fallar(format('select public.registrar_plano_codigo(%L, %L, %L, ''003'', ''Compuerta'', %L, null, ''compuerta.pdf'')',
    pg_temp.txt('p3'), pg_temp.txt('r3'), pg_temp.txt('codigo'), pg_temp.txt('acb')),
  'la pantalla de antes, sin el porcentaje, ya no carga planos', 'Pon el porcentaje de la unidad');
select test.debe_fallar(format('select public.registrar_plano_codigo(%L, %L, %L, ''003'', ''Compuerta'', %L, null, ''compuerta.pdf'', 12.345)',
    pg_temp.txt('p3'), pg_temp.txt('r3'), pg_temp.txt('codigo'), pg_temp.txt('acb')),
  'el porcentaje lleva hasta dos decimales', 'hasta dos decimales');
select test.debe_fallar(format('select public.registrar_plano_codigo(%L, %L, %L, ''003'', ''Compuerta'', %L, null, ''compuerta.pdf'', null)',
    pg_temp.txt('p3'), pg_temp.txt('r3'), pg_temp.txt('codigo'), pg_temp.txt('acb')),
  'ni se carga vacío', 'Pon el porcentaje de la unidad');
select public.registrar_plano_codigo(pg_temp.id('p3'), pg_temp.id('r3'), pg_temp.txt('codigo'), '003', 'Compuerta',
  pg_temp.id('acb'), null, 'compuerta.pdf', 30);
select test.afirmar((select sum(peso) from public.codigo_planos where codigo_interno = pg_temp.txt('codigo')) = 100,
  'los tres planos suman justo el 100 %');
-- Diseño corrige: la compuerta todavía no se reparte.
select test.debe_fallar(format('select public.fijar_peso_plano(%L, 31)', pg_temp.txt('p3')),
  'corregir el peso tampoco pasa del tope', 'le queda como mucho 30 %');
select test.debe_fallar(format('select public.fijar_peso_plano(%L, -1)', pg_temp.txt('p3')),
  'ni baja de cero', 'de 0 a 100');
select public.fijar_peso_plano(pg_temp.id('p3'), 0);
select public.fijar_peso_plano(pg_temp.id('p3'), 0);
select test.afirmar((select peso from public.codigo_planos where id = pg_temp.id('p3')) = 0,
  'la compuerta queda en 0 % (corregir dos veces da lo mismo)');
select test.debe_fallar(format('update public.codigo_planos set nombre = ''Otra'' where id = %L', pg_temp.txt('p1')),
  'el resto del plano sigue sin corregirse por debajo', 'permission denied');
select test.afirmar(public.etapas_de_siempre_codigo(pg_temp.txt('codigo')) = 6, 'Diseño arma las seis etapas del código');
reset role;

-- Un supervisor no reparte la unidad.
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.debe_fallar(format('select public.fijar_peso_plano(%L, 50)', pg_temp.txt('p1')),
  'el supervisor no cambia el peso de un plano', 'diseno.codigos');
reset role;

-- ======================================================= 2. Sobre qué puede reportar cada supervisor
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'))) = 1
  and (select tipo = 'PLANO' and id = pg_temp.id('p1') and peso = 40 and avance is null
         from public.reporte_diario_opciones(lower(pg_temp.txt('codigo')))),
  'Maestranza ve solo su plano, con su peso y sin avance todavía (aunque escriba el código en minúsculas)');
reset role;
select pg_temp.como('sup_prd');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'))) = 2
  and (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo')) where tipo = 'SUBCONTRATO' and id = pg_temp.id('sc')) = 1,
  'Producción ve su plano y su subcontrato, no el de Acabados');
reset role;
select pg_temp.como('logistica');
set local role authenticated;
select test.debe_fallar(format('select * from public.reporte_diario_opciones(%L)', pg_temp.txt('codigo')),
  'Logística no reporta avance', 'reporte_diario.registrar');
reset role;

-- ======================================================= 3. Maestranza reporta su avance, solo hacia arriba
select pg_temp.como('sup_mtz');
set local role authenticated;
-- El jueves (hace 3 días): el plano del cajón en 20 % y el corte de materia prima, sin plano todavía, en 9 %.
select pg_temp.subir(pg_temp.txt('rep_jue'), 3, jsonb_build_array(
  pg_temp.trabajo('plano_id', pg_temp.txt('p1'), 20),
  pg_temp.trabajo('descripcion', '  Corte de   materia prima ', 9, false)));
select test.afirmar(
  (select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 2
  and pg_temp.actividad('Corte de materia prima') is not null
  and (select area_id from public.codigo_actividades where plano_id = pg_temp.id('p1')) = pg_temp.id('mtz')
  and (select descripcion from public.reporte_diario_trabajos where reporte_id = pg_temp.id('rep_jue') and orden = 1)
        = 'Plano 001 · Estructura del cajón',
  'el reporte abre dos actividades: la del plano, con su nombre, y la propia, con el texto limpio');
select test.afirmar(
  (select avance = 9 and ultima_fecha = pg_temp.dia(3) from public.reporte_diario_opciones(pg_temp.txt('codigo'))
    where tipo = 'ACTIVIDAD' and id = pg_temp.actividad('Corte de materia prima')::uuid),
  'al día siguiente el corte aparece para continuarlo, con su 9 % del jueves');

-- El viernes: el corte otra vez en 9 % no entra; en 10 %, sí.
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 9))),
  'el corte no repite el 9 % del jueves', 'ya iba en 9 % (reporte del ' || to_char(pg_temp.dia(3), 'DD/MM/YYYY') || '): pon en cuánto va ahora, 10 % o más');
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    pg_temp.trabajo('descripcion', 'corte de MATERIA prima', 12))),
  'ni se vuelve a abrir con otro nombre igual', 'Ya hay una actividad abierta «Corte de materia prima»');
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 12),
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 13))),
  'la misma actividad va una vez en el reporte', 'repite');
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    pg_temp.trabajo('plano_id', pg_temp.txt('p2'), 12))),
  'Maestranza no reporta el plano de Producción', 'es de Producción');
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc'), 12))),
  'ni el subcontrato de Producción', 'no es de tu área');
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 12, false))),
  'una actividad propia sin gente no entra: de ahí sale el costeo', 'Pon al menos a una persona');
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
    jsonb_build_object('plano_id', pg_temp.txt('p1'), 'actividad_id', pg_temp.actividad('Corte de materia prima'), 'avance', 30))),
  'un trabajo va sobre una sola cosa', 'una sola cosa');
select pg_temp.subir(pg_temp.txt('rep_vie'), 2, jsonb_build_array(
  pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 10),
  pg_temp.trabajo('plano_id', pg_temp.txt('p1'), 50, false)));

-- Un reporte atrasado del miércoles no pasa por encima del jueves.
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_mie'), 4, jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 9))),
  'el miércoles no llega al 9 % del jueves', 'tiene que quedar por debajo');
select pg_temp.subir(pg_temp.txt('rep_mie'), 4, jsonb_build_array(
  pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 5)));
select test.afirmar(
  (select avance = 10 and ultima_fecha = pg_temp.dia(2) from public.reporte_diario_opciones(pg_temp.txt('codigo'))
    where tipo = 'ACTIVIDAD' and id = pg_temp.actividad('Corte de materia prima')::uuid),
  'el corte va en 10 %: lo del último día, no lo del reporte que se subió al último');
select test.debe_fallar(format('select * from public.codigo_interno_actividades_estado(%L)', pg_temp.txt('codigo')),
  'el cálculo interno no se llama desde fuera', 'permission denied');
reset role;
select test.afirmar(
  (select avance = 10 and ultima_fecha = pg_temp.dia(2) and primera_fecha = pg_temp.dia(4) and reportes = 3
     from public.codigo_interno_actividades_estado(pg_temp.txt('codigo'))
    where actividad_id = pg_temp.actividad('Corte de materia prima')::uuid),
  'el corte lleva tres reportes, del miércoles al viernes');
select set_config('prueba.corte', pg_temp.actividad('Corte de materia prima'), true);

-- Producción no toca lo de Maestranza.
select pg_temp.como('sup_prd');
set local role authenticated;
select test.debe_fallar(pg_temp.reporte_sql(pg_temp.txt('rep_prd'), 1, jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.txt('corte'), 20))),
  'Producción no continúa una actividad de Maestranza', 'es de otra área');
select test.afirmar((select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 0,
  'ni la ve');
-- El subcontrato de Producción se reporta sin gente propia: lo hace el subcontratista.
select pg_temp.subir(pg_temp.txt('rep_prd'), 1, jsonb_build_array(pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc'), 26, false)));
select test.afirmar(
  (select count(*) from public.reporte_diario_personal where reporte_id = pg_temp.id('rep_prd')) = 0
  and (select descripcion from public.reporte_diario_trabajos where reporte_id = pg_temp.id('rep_prd'))
        like 'Subcontrato % · Soldadura de refuerzos del piso',
  'el reporte del subcontrato entra sin horas, con el nombre del subcontrato');
select test.debe_fallar(format('insert into public.codigo_actividades (codigo_interno, area_id, descripcion) values (%L, %L, ''Por debajo'')',
    pg_temp.txt('codigo'), pg_temp.txt('prd')),
  'nadie abre actividades por fuera del reporte', 'permission denied');
reset role;

-- ======================================================= 4. Gerencia observa y el supervisor corrige
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('rep_vie'), 'GERENCIA', 'Falta la gente que trabajó en el cajón');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
-- Al corregir, el formulario muestra el avance sin el reporte observado: el corte vuelve a su 9 % del jueves.
select test.afirmar(
  (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo')) where tipo = 'ACTIVIDAD') = 10
  and (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('rep_vie')) where tipo = 'ACTIVIDAD') = 9
  and (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('rep_vie')) where tipo = 'PLANO') = 20,
  'al corregir el viernes, el corte y el cajón se ofrecen con lo del jueves (9 % y 20 %)');
reset role;
select pg_temp.como('sup_prd');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('rep_vie'))) = 2,
  'el reporte observado de otro no cambia lo que se le ofrece a Producción');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
-- Sin el observado, el corte se compara con el jueves: 9 no entra, 10 sí.
select test.debe_fallar(format('select public.registrar_reporte_corregido(%L, %L, %L, %L, ''Avance de la tolva'', ''Corregido'', %L)',
    pg_temp.txt('rep_vie'), pg_temp.txt('rep_vie2'), pg_temp.dia(2), pg_temp.txt('codigo'),
    jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 9))),
  'la corrección tampoco baja del jueves', '10 % o más');
select public.registrar_reporte_corregido(pg_temp.id('rep_vie'), pg_temp.id('rep_vie2'), pg_temp.dia(2), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Corregido con la gente del cajón', jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 10),
    pg_temp.trabajo('plano_id', pg_temp.txt('p1'), 50)));
select test.afirmar(
  (select anulado_en is not null from public.reportes_diarios where id = pg_temp.id('rep_vie'))
  and (select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 2,
  'el observado queda anulado y la corrección sigue las mismas dos actividades, sin abrir otras');
reset role;

-- ======================================================= 5. El porcentaje de la unidad
-- Planos: el cajón (40 %) en 50 % aporta 20; el bastidor (30 %) sin reporte, 0; la compuerta, 0 %.
-- El 30 % que Diseño no repartió va por las seis etapas, sin volver a contar el
-- cajón, que ya aportó lo suyo: Diseño 0, Habilitado (Maestranza) el corte en 10,
-- Armado (Producción) el subcontrato en 26, Acabados 0, Trámites 0, Entrega 0:
-- 36 / 6 = 6, por 30 % = 1,8. La unidad va en 20 + 1,8 = 22 % (con el cajón
-- también en la etapa habría salido 23: contado dos veces).
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.avance('avance')::int = 22 and pg_temp.avance('fuente') = 'PLANOS'
  and pg_temp.avance('trabajos')::int = 3 and pg_temp.avance('trabajos_terminados')::int = 0
  and pg_temp.avance('ultimo_reporte')::date = pg_temp.dia(1),
  format('la unidad va en 22 %% por planos, con tres actividades (salió %s, %s, %s)',
         pg_temp.avance('avance'), pg_temp.avance('fuente'), pg_temp.avance('trabajos')));
select test.afirmar(
  (select count(*) from public.codigo_interno_avance_planos(pg_temp.txt('codigo'))) = 3
  and (select avance = 50 and aporte = 20 and not por_etapa and reportes = 2
         from public.codigo_interno_avance_planos(pg_temp.txt('codigo')) where plano_id = pg_temp.id('p1'))
  and (select avance = 0 and aporte = 0 and reportes = 0
         from public.codigo_interno_avance_planos(pg_temp.txt('codigo')) where plano_id = pg_temp.id('p2')),
  'Gerencia ve lo que aporta cada plano: el cajón 20, el bastidor 0');
select test.afirmar(
  (select avance_reportado from public.codigo_interno_etapas(pg_temp.txt('codigo')) where nombre = 'Habilitado') = 10
  and (select avance_reportado from public.codigo_interno_etapas(pg_temp.txt('codigo')) where nombre = 'Armado') = 26,
  'cada etapa dice el promedio de las actividades de su área sin el cajón, que ya contó por su plano');
select test.afirmar(
  (select peso = 70 and de_planos = 20 and resto = 6 and resto_por = 'ETAPAS'
     from public.codigo_interno_avance_partes(pg_temp.txt('codigo'))),
  format('las dos partes: 20 de los planos y las etapas en 6 %% (salió %s)',
         (select to_jsonb(k) from public.codigo_interno_avance_partes(pg_temp.txt('codigo')) k)));
select test.afirmar((select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 3,
  'Gerencia ve las tres actividades');
-- El costo sale de las horas: Juan, 1 h el miércoles, 1 h el jueves y 2 h el viernes corregido, a S/ 10.
select test.afirmar((select sum(monto) from public.codigo_interno_costeo(pg_temp.txt('codigo')) where fuente = 'MANO_OBRA') = 40,
  format('la mano de obra del código son 4 h a S/ 10; las del reporte observado no cuentan (salió %s)',
         (select sum(monto) from public.codigo_interno_costeo(pg_temp.txt('codigo')) where fuente = 'MANO_OBRA')));
reset role;

select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.codigo_interno_avance_planos(pg_temp.txt('codigo'))) = 1
  and (select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 2,
  'el supervisor de Maestranza ve solo su plano y sus dos actividades');
select test.debe_fallar(format('select * from public.codigos_internos_avance(%L)', pg_temp.txt('codigo')),
  'el porcentaje de la unidad es de Gerencia', 'codigos_internos.ver');
select test.debe_fallar(format('select * from public.codigo_interno_avance_partes(%L)', pg_temp.txt('codigo')),
  'cómo sale el porcentaje, también', 'codigos_internos.ver');
select test.debe_fallar(format('select * from public.codigo_interno_resto_por_area_calculado(%L)', pg_temp.txt('codigo')),
  'el cálculo interno del resto no se llama directo', 'permission denied');
reset role;
select pg_temp.como('sup_acb');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 0,
  'Acabados no ve las actividades de las otras áreas');
reset role;
select pg_temp.como('logistica');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo')) = 0,
  'Logística tampoco');
select test.debe_fallar(format('select * from public.codigo_interno_avance_planos(%L)', pg_temp.txt('codigo')),
  'ni el aporte de los planos', 'No tienes permiso');
reset role;

-- Maestranza termina el Habilitado: su plano vale 100 % aunque el reporte dijera 50.
-- 40 + 0 + 30 % de (0 + 100 + 26 + 0 + 0 + 0) / 6 = 40 + 6,3 = 46 %.
select pg_temp.como('sup_mtz');
set local role authenticated;
select public.marcar_etapa_codigo((select id from public.codigo_etapas where codigo_interno = pg_temp.txt('codigo') and nombre = 'Habilitado'),
  'FIN', pg_temp.dia(0), null);
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.avance('avance')::int = 46,
  format('con el Habilitado terminado la unidad va en 46 %% (salió %s)', pg_temp.avance('avance')));
select test.afirmar((select avance = 100 and aporte = 40 and por_etapa
                       from public.codigo_interno_avance_planos(pg_temp.txt('codigo')) where plano_id = pg_temp.id('p1')),
  'el cajón cuenta 100 % por su etapa');
reset role;

-- Administración da por terminado el subcontrato: cuenta 100 % y ya no se ofrece.
-- 40 + 30 % de (0 + 100 + 100 + 0 + 0 + 0) / 6 = 40 + 10 = 50 %.
select pg_temp.como('administracion');
set local role authenticated;
select public.cambiar_estado_subcontrato(pg_temp.id('sc'), 'TERMINADO');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.avance('avance')::int = 50 and pg_temp.avance('trabajos_terminados')::int = 1,
  format('el subcontrato terminado cuenta 100 %%: la unidad va en 50 %% (salió %s)', pg_temp.avance('avance')));
reset role;
select pg_temp.como('sup_prd');
set local role authenticated;
select test.afirmar((select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'))) = 1,
  'a Producción ya no se le ofrece el subcontrato terminado, solo su plano');
select test.debe_fallar(pg_temp.reporte_sql(gen_random_uuid()::text, 0, jsonb_build_array(
    pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc'), 90, false))),
  'ni se reporta por fuera del formulario', 'ya está terminado');
reset role;
-- Pero si Gerencia observa el reporte que lo llevaba, la corrección sí puede ir sobre él,
-- con lo que de verdad se había reportado y no con el 100 del terminado.
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('rep_prd'), 'GERENCIA', 'Revisa la descripción del subcontrato');
reset role;
select pg_temp.como('sup_prd');
set local role authenticated;
select test.afirmar(
  (select avance is null from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('rep_prd'), pg_temp.dia(1))
    where tipo = 'SUBCONTRATO' and id = pg_temp.id('sc')),
  'al corregir, el subcontrato terminado se ofrece, sin el avance del observado');
select public.registrar_reporte_corregido(pg_temp.id('rep_prd'), gen_random_uuid(), pg_temp.dia(1), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Corregido: soldadura de los refuerzos', jsonb_build_array(pg_temp.trabajo('subcontrato_id', pg_temp.txt('sc'), 26, false)));
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.avance('avance')::int = 50,
  format('y la corrección no mueve el 50 %% de la unidad (salió %s)', pg_temp.avance('avance')));
reset role;

-- Una actividad que se abrió en el reporte observado sigue ofreciéndose al corregirlo.
select pg_temp.como('sup_mtz');
set local role authenticated;
select pg_temp.subir(pg_temp.txt('rep_obs'), 0, jsonb_build_array(pg_temp.trabajo('descripcion', 'Biselado de planchas', 15)));
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('rep_obs'), 'GERENCIA', 'El biselado no se hizo hoy, revisa el día');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('rep_obs'))
    where tipo = 'ACTIVIDAD' and etiqueta = 'Biselado de planchas' and avance is null) = 1,
  'al corregir, el biselado que se abrió en el observado se ofrece sin avance previo');
select public.registrar_reporte_corregido(pg_temp.id('rep_obs'), gen_random_uuid(), pg_temp.dia(0), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Corregido', jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Biselado de planchas'), 12)));
select test.afirmar(
  (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo')) where etiqueta = 'Biselado de planchas') = 12,
  'y la corrección lo deja en 12 %, por debajo de lo observado: el observado ya no cuenta');
reset role;

-- ======================================================= 6. Lo que llega al 100 % ya no se reporta
select pg_temp.como('sup_mtz');
set local role authenticated;
select pg_temp.subir(pg_temp.txt('rep_sab'), 1, jsonb_build_array(
  pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 100)));
select test.debe_fallar(pg_temp.reporte_sql(gen_random_uuid()::text, 0, jsonb_build_array(
    pg_temp.trabajo('actividad_id', pg_temp.actividad('Corte de materia prima'), 100))),
  'el corte terminado ya no se reporta', 'ya llegó al 100 %');
select test.afirmar(
  (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'))
    where tipo = 'ACTIVIDAD' and etiqueta = 'Corte de materia prima') = 0,
  'y ya no aparece para continuarlo');
-- Pero a un día anterior sí: lo que lleva se mira a ese día, con el tope del día siguiente.
select test.afirmar(
  (select avance = 5 and tope = 9 and tope_fecha = pg_temp.dia(3)
     from public.reporte_diario_opciones(pg_temp.txt('codigo'), null, pg_temp.dia(4))
    where tipo = 'ACTIVIDAD' and etiqueta = 'Corte de materia prima'),
  'el miércoles todavía ofrece el corte: iba en 5 y el jueves fue 9');
select test.afirmar(
  (select count(*) from public.reporte_diario_opciones(pg_temp.txt('codigo'), null, pg_temp.dia(3))
    where tipo = 'ACTIVIDAD' and etiqueta = 'Corte de materia prima') = 0,
  'el jueves no se ofrece: entre el 9 de ese día y el 10 del viernes no cabe otro avance');
-- Terminado, el nombre queda libre para una actividad nueva.
select pg_temp.subir(gen_random_uuid()::text, 0, jsonb_build_array(
  pg_temp.trabajo('descripcion', 'Corte de materia prima', 5)));
select test.afirmar(
  (select count(*) from public.codigo_actividades where codigo_interno = pg_temp.txt('codigo') and lower(descripcion) = 'corte de materia prima') = 2,
  'un corte nuevo, aparte del terminado');
reset role;

-- ======================================================= 7. Lo que ya no está vigente, y PLANTA
-- La actividad de un plano no se reporta por su id: se elige el plano, que es donde se mira si sigue vigente.
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.debe_fallar(pg_temp.reporte_sql(gen_random_uuid()::text, 0, jsonb_build_array(
    pg_temp.trabajo('actividad_id', (select id::text from public.codigo_actividades where plano_id = pg_temp.id('p1')), 90))),
  'la actividad de un plano no entra por su id', 'elígelo como tal');
-- Dos actividades nuevas con el mismo nombre en un reporte son una sola, aunque la primera vaya en 100.
select test.debe_fallar(pg_temp.reporte_sql(gen_random_uuid()::text, 0, jsonb_build_array(
    pg_temp.trabajo('descripcion', 'Pulido de soldaduras', 100), pg_temp.trabajo('descripcion', 'pulido de soldaduras', 20, false))),
  'la misma actividad nueva dos veces en el reporte', 'repite');
reset role;
-- Diseño anula el cajón: su actividad deja de contar, porque ya nadie la puede reportar ni cerrar.
select pg_temp.como('gerente');
set local role authenticated;
select set_config('prueba.trabajos_antes', pg_temp.avance('trabajos'), true);
reset role;
select pg_temp.como('diseno');
set local role authenticated;
select public.anular_plano_codigo(pg_temp.id('p1'), 'Se rehízo el cajón con otra medida');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(pg_temp.avance('trabajos')::int = current_setting('prueba.trabajos_antes')::int - 1,
  format('la actividad del plano anulado ya no cuenta (%s → %s trabajos)', current_setting('prueba.trabajos_antes'), pg_temp.avance('trabajos')));
select test.afirmar(
  (select count(*) from public.codigo_interno_actividades(pg_temp.txt('codigo')) where lower(descripcion) = 'corte de materia prima') = 2
  and (select historial->-1->>'avance' from public.codigo_interno_actividades(pg_temp.txt('codigo')) where tipo = 'SUBCONTRATO') = '26'
  and (select count(*) from public.codigo_interno_actividades(pg_temp.txt('codigo')) where descripcion like 'Plano 001%') = 0
  and (select avance from public.codigo_interno_actividades(pg_temp.txt('codigo')) where tipo = 'SUBCONTRATO' and area = (select nombre from public.areas where codigo = 'PRD')) = 100,
  'Gerencia ve cada actividad aparte: los dos cortes, sin el plano anulado, y el subcontrato terminado en 100 aunque se reportó 26');
reset role;
-- PLANTA no lleva avance: el mismo trabajo de cada día va suelto, sin «ya hay una abierta» ni «solo hacia arriba».
select pg_temp.como('sup_mtz');
set local role authenticated;
select public.registrar_reporte_diario(gen_random_uuid(), pg_temp.dia(2), 'PLANTA', 'Orden de la planta', 'Limpieza del área',
  jsonb_build_array(pg_temp.trabajo('descripcion', 'Limpieza del área de soldadura', 50)), null, null);
select public.registrar_reporte_diario(gen_random_uuid(), pg_temp.dia(1), 'PLANTA', 'Orden de la planta', 'Limpieza del área',
  jsonb_build_array(pg_temp.trabajo('descripcion', 'Limpieza del área de soldadura', 50)), null, null);
select test.afirmar((select count(*) from public.reporte_diario_opciones('PLANTA') where tipo = 'ACTIVIDAD') = 0,
  'en PLANTA la limpieza de cada día va suelta, y no se ofrece para continuarla');
reset role;

-- Dos cuadrillas en lo mismo, el mismo día, en PLANTA: dos trabajos con el mismo texto.
select pg_temp.como('sup_mtz');
set local role authenticated;
select public.registrar_reporte_diario(gen_random_uuid(), pg_temp.dia(0), 'PLANTA', 'Orden de la planta', 'Dos cuadrillas',
  jsonb_build_array(pg_temp.trabajo('descripcion', 'Mantenimiento', 0), pg_temp.trabajo('descripcion', 'mantenimiento', 0)), null, null);
reset role;

-- ======================================================= 8. Dos reportes el mismo día
-- La corrección del de la mañana va donde estaba, antes del de la tarde: su tope
-- es lo de la tarde, y el avance del día sigue siendo el más alto.
select set_config('prueba.manana', gen_random_uuid()::text, true);
select set_config('prueba.tarde', gen_random_uuid()::text, true);
select pg_temp.como('sup_mtz');
set local role authenticated;
select pg_temp.subir(pg_temp.txt('manana'), 0, jsonb_build_array(pg_temp.trabajo('descripcion', 'Rolado de planchas', 20)));
reset role;
-- En una transacción todo lleva la misma hora: la mañana se sube una hora antes a
-- mano, sin el disparador que congela el reporte (solo para armar la prueba).
set local session_replication_role = replica;
update public.reportes_diarios set creado_en = creado_en - interval '1 hour' where id = pg_temp.id('manana');
set local session_replication_role = origin;
select pg_temp.como('sup_mtz');
set local role authenticated;
select pg_temp.subir(pg_temp.txt('tarde'), 0, jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Rolado de planchas'), 30)));
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('manana'), 'GERENCIA', 'Faltan las horas de la mañana');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select avance is null and tope = 30 from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('manana'), pg_temp.dia(0))
    where etiqueta = 'Rolado de planchas'),
  'al corregir la mañana, el rolado se ofrece sin avance previo y con el 30 de la tarde como tope');
select test.debe_fallar(format('select public.registrar_reporte_corregido(%L, %L, %L, %L, ''Avance de la tolva'', ''Corregido'', %L)',
    pg_temp.txt('manana'), gen_random_uuid(), pg_temp.dia(0), pg_temp.txt('codigo'),
    jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Rolado de planchas'), 30))),
  'la mañana no alcanza a la tarde', 'reporte posterior');
select set_config('prueba.manana2', gen_random_uuid()::text, true);
select public.registrar_reporte_corregido(pg_temp.id('manana'), pg_temp.id('manana2'), pg_temp.dia(0), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Corregido con las horas', jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Rolado de planchas'), 20)));
select test.afirmar(
  (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo')) where etiqueta = 'Rolado de planchas') = 30,
  'el rolado sigue en 30: la mañana corregida se subió después, pero el día vale lo más alto');
reset role;
-- La mañana corregida guarda su lugar: si después se observa la tarde, la tarde
-- sigue yendo después de ella, con su 30.
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('tarde'), 'GERENCIA', 'Faltan las horas de la tarde');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select avance = 20 and tope is null from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('tarde'), pg_temp.dia(0))
    where etiqueta = 'Rolado de planchas'),
  'al corregir la tarde, el rolado viene de la mañana corregida (20) y sin tope');
select set_config('prueba.tarde2', gen_random_uuid()::text, true);
select public.registrar_reporte_corregido(pg_temp.id('tarde'), pg_temp.id('tarde2'), pg_temp.dia(0), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Corregido con las horas', jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Rolado de planchas'), 30)));
reset role;
-- Y la mañana se puede corregir otra vez sin tener que pasar a la tarde.
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('manana2'), 'GERENCIA', 'Revisa otra vez la mañana');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select public.registrar_reporte_corregido(pg_temp.id('manana2'), gen_random_uuid(), pg_temp.dia(0), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Segunda corrección', jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Rolado de planchas'), 25)));
select test.afirmar(
  (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo')) where etiqueta = 'Rolado de planchas') = 30,
  'la mañana corregida dos veces no baja el rolado del 30 de la tarde');
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select string_agg(h->>'avance', '→' order by n)
         from public.codigo_interno_actividades(pg_temp.txt('codigo')) a,
              jsonb_array_elements(a.historial) with ordinality as x(h, n)
        where a.descripcion = 'Rolado de planchas') = '25→30',
  'Gerencia ve la historia del rolado en orden: la mañana en 25, la tarde en 30');
reset role;

-- Una corrección que cambia de día va al final del día nuevo, no al lugar que tenía
-- el observado en su día.
select set_config('prueba.tal1', gen_random_uuid()::text, true);
select set_config('prueba.tal2', gen_random_uuid()::text, true);
select pg_temp.como('sup_mtz');
set local role authenticated;
select pg_temp.subir(pg_temp.txt('tal2'), 1, jsonb_build_array(pg_temp.trabajo('descripcion', 'Taladrado de bridas', 10)));
select pg_temp.subir(pg_temp.txt('tal1'), 0, jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Taladrado de bridas'), 30)));
reset role;
-- El observado se subió antes que el de hoy (a mano: en la transacción todo lleva la misma hora).
set local session_replication_role = replica;
update public.reportes_diarios set creado_en = creado_en - interval '2 hours' where id = pg_temp.id('tal2');
update public.reportes_diarios set creado_en = creado_en - interval '1 hour' where id = pg_temp.id('tal1');
set local session_replication_role = origin;
select pg_temp.como('gerente');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('tal2'), 'GERENCIA', 'El taladrado fue hoy, no ayer');
reset role;
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(
  (select avance = 30 and tope is null from public.reporte_diario_opciones(pg_temp.txt('codigo'), pg_temp.id('tal2'), pg_temp.dia(0))
    where etiqueta = 'Taladrado de bridas'),
  'al pasar la corrección a hoy, el taladrado viene del 30 de hoy y sin tope');
select public.registrar_reporte_corregido(pg_temp.id('tal2'), gen_random_uuid(), pg_temp.dia(0), pg_temp.txt('codigo'),
  'Avance de la tolva', 'Era de hoy', jsonb_build_array(pg_temp.trabajo('actividad_id', pg_temp.actividad('Taladrado de bridas'), 35)));
select test.afirmar(
  (select avance from public.reporte_diario_opciones(pg_temp.txt('codigo')) where etiqueta = 'Taladrado de bridas') = 35,
  'y entra con 35, después del 30 de hoy');
reset role;

-- La actividad no se corrige ni se borra por debajo, ni siquiera como dueño.
select test.debe_fallar(format('update public.codigo_actividades set descripcion = ''Otra'' where plano_id = %L', pg_temp.txt('p1')),
  'una actividad no se corrige', 'no se corrige');
select test.debe_fallar(format('delete from public.codigo_actividades where plano_id = %L', pg_temp.txt('p1')),
  'ni se borra', 'no se borra');

select 'CHECK 400 OK' as resultado;
rollback;
