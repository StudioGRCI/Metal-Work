-- Lo que Diseño le debe a cada código (plan 6, entrega 6.1; migración
-- 20261126600000): los cinco puntos y el plano de Maestranza y de Producción
-- contra el día en que el área lo necesita (el inicio de su etapa de Diseño).
-- Lo leen Diseño, Administración, el supervisor y Supervisión general con su
-- sesión (`set local role authenticated`); Logística, Almacén y Ventas no.
-- Nunca como ADMIN. Las cifras esperadas están escritas a mano, con lo que NO
-- debe contar (el plano anulado, la revisión 2, la subetapa del área, el
-- material y el DXF quitados). Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['DISENO:DIS', 'SUPERVISOR:MTZ', 'ADMINISTRACION:ADM', 'COMPRADOR:LOG', 'ALMACENERO:ALM',
                           'VENDEDOR:VEN', 'SUPERVISOR_GENERAL:PRD'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.472@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 472', lower(replace(v, ':', '.')) || '.472@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  foreach v in array array['MTZ', 'PRD'] loop
    perform set_config('prueba.' || lower(v), (select id::text from public.areas where codigo = v), true);
  end loop;
  foreach v in array array['p1', 'r1', 'r1b', 'p2', 'r2', 'p3', 'r3', 'd1', 'd2', 'env'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK472-SR-01', true);
  perform set_config('prueba.otro', 'CHK472-SR-02', true);
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
create or replace function pg_temp.hoy() returns date language sql as $$
  select current_setting('prueba.hoy')::date;
$$;
-- La fila de un área del código de la prueba, como la lee la pantalla.
create or replace function pg_temp.fila(p_area text, p_codigo text default null)
returns table (planos int, materiales int, etapas int, dxf int, tiene_etapa boolean, etapa text, comprometido date,
               entregado_en timestamptz, situacion text, dias int, por_vencer boolean)
language sql as $$
  select planos, materiales, etapas, dxf, tiene_etapa, etapa, comprometido, entregado_en, situacion, dias, por_vencer
    from public.lo_que_debe_diseno(array[coalesce(p_codigo, current_setting('prueba.codigo'))]) where area = p_area;
$$;
grant execute on all functions in schema pg_temp to authenticated;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================ 1. Sin nada cargado: los cinco puntos pendientes
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 and bool_and(not tiene_ot and ficha_en is null and planos = 0 and materiales = 0 and etapas = 0 and dxf = 0
                                    and not tiene_etapa and situacion = 'SIN_FECHA' and comprometido is null)
          and array_agg(area order by area) = array['MTZ', 'PRD']
     from public.lo_que_debe_diseno(array[' ' || lower(current_setting('prueba.codigo')) || ' '])),
  'un código sin nada de Diseño sale en dos filas (Maestranza y Producción), todo pendiente y sin fecha (y normalizado)');
select test.afirmar((select count(*) from public.lo_que_debe_diseno(null)) = 0
  and (select count(*) from public.lo_que_debe_diseno('{}')) = 0, 'sin códigos no devuelve nada');

-- ============================================ 2. Diseño arma el par de etapas y carga el plano de Maestranza
select public.par_de_etapas_codigo(current_setting('prueba.codigo'), 'Chasis');
reset role;
-- La fecha la pone Diseño en su etapa: aquí, a mano, para fijar el día.
update public.codigo_etapas set inicio_plan = pg_temp.hoy() - 3, fin_plan = pg_temp.hoy() + 4
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('mtz');
update public.codigo_etapas set inicio_plan = pg_temp.hoy() + 30, fin_plan = pg_temp.hoy() + 40
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('prd');

select pg_temp.como('diseno');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('planos-codigo', current_setting('prueba.p1') || '/' || current_setting('prueba.r1') || '.pdf', pg_temp.id('diseno'),
        current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":81234}');
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), current_setting('prueba.codigo'), 'P-01', 'Habilitado del chasis',
                                     pg_temp.id('mtz'), null, 'p01.pdf', 30);

select test.afirmar(
  (select count(*) = 2 and bool_and(planos = 1 and etapas = 2 and materiales = 0 and dxf = 0 and tiene_etapa)
     from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'con el par de etapas: las dos áreas tienen su etapa, un plano y dos etapas de Diseño');
select test.afirmar(
  (select situacion = 'TARDE' and dias = 3 and comprometido = pg_temp.hoy() - 3 and etapa = 'Habilitado: Chasis' and entregado_en is not null
     from pg_temp.fila('MTZ')),
  'el plano de Maestranza subido 3 días después de que empezó «Habilitado: Chasis» sale 3 días tarde, con el nombre de la etapa');
select test.afirmar(
  (select situacion = 'PENDIENTE' and dias = 30 and not por_vencer and entregado_en is null from pg_temp.fila('PRD')),
  'el de Producción, sin plano y con 30 días por delante, está pendiente y no por vencer');
reset role;

-- La revisión 2 del plano no mueve la fecha real: cuenta la primera subida.
-- (La revisión subida no se cambia: aquí, sin disparadores, solo para correr su hora.)
set local session_replication_role = replica;
update public.codigo_plano_revisiones set subido_en = now() - interval '10 days'
 where plano_id = pg_temp.id('p1');
set local session_replication_role = origin;
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar((select situacion = 'A_TIEMPO' and dias = 0 from pg_temp.fila('MTZ')),
  'si el plano de Maestranza llegó antes de que empezara su etapa, sale a tiempo');
reset role;

-- Por vencer: la de Producción empieza mañana y sigue sin plano.
update public.codigo_etapas set inicio_plan = pg_temp.hoy() + 1
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('prd') and not de_area;
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar((select situacion = 'PENDIENTE' and dias = 1 and por_vencer from pg_temp.fila('PRD')),
  'la de Producción, que empieza mañana sin plano, está por vencer (el margen de las etapas)');
reset role;

-- ============================================ 3. Lo que no cuenta
-- Vencido: la fecha de Producción pasa a ayer y sigue sin plano.
update public.codigo_etapas set inicio_plan = pg_temp.hoy() - 1
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('prd') and not de_area;
-- Una subetapa que agrega el área no es de Diseño: no cuenta como etapa ni como fecha.
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, de_area, creado_por)
values (current_setting('prueba.codigo'), 50, 'Pintura propia', pg_temp.id('prd'), pg_temp.hoy() - 30, true, pg_temp.id('supervisor'));

select pg_temp.como('diseno');
set local role authenticated;
-- Un plano de Producción que se anula no cuenta como entregado.
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('planos-codigo', current_setting('prueba.p2') || '/' || current_setting('prueba.r2') || '.pdf', pg_temp.id('diseno'),
        current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":81234}');
select public.registrar_plano_codigo(pg_temp.id('p2'), pg_temp.id('r2'), current_setting('prueba.codigo'), 'P-02', 'Ensamblaje equivocado',
                                     pg_temp.id('prd'), null, 'p02.pdf', 10);
select public.anular_plano_codigo(pg_temp.id('p2'), 'Era de otra unidad');
-- Materiales: dos líneas, una quitada.
select public.guardar_material_codigo(null, current_setting('prueba.codigo'), (select id from public.materiales where activo order by codigo limit 1), 10, null, null);
select public.guardar_material_codigo(null, current_setting('prueba.codigo'), (select id from public.materiales where activo order by codigo offset 1 limit 1), 4, null, null);
-- DXF: un envío de dos archivos.
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('dxf-codigo', current_setting('prueba.d1') || '.dxf', pg_temp.id('diseno'), current_setting('prueba.diseno'), '{"mimetype":"application/dxf","size":5000}'),
  ('dxf-codigo', current_setting('prueba.d2') || '.dxf', pg_temp.id('diseno'), current_setting('prueba.diseno'), '{"mimetype":"application/dxf","size":5000}');
select public.registrar_dxf_codigo(pg_temp.id('d1'), current_setting('prueba.codigo'), 'Corte', 'a.dxf', pg_temp.id('env'));
select public.registrar_dxf_codigo(pg_temp.id('d2'), current_setting('prueba.codigo'), 'Corte', 'b.dxf', pg_temp.id('env'));
reset role;
update public.codigo_materiales set quitado_en = now(), quitado_por = pg_temp.id('diseno')
 where codigo_interno = current_setting('prueba.codigo') and cantidad = 4;
update public.codigo_dxf set quitado_en = now(), quitado_por = pg_temp.id('diseno') where id = pg_temp.id('d2');

-- ============================================ 4. Supervisión, Administración y Supervisión general la ven, en lectura
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select situacion = 'VENCIDO' and dias = 1 and comprometido = pg_temp.hoy() - 1 and entregado_en is null from pg_temp.fila('PRD')),
  'el supervisor la ve: el plano de Producción venció hace 1 día (el anulado no cuenta, la etapa del área no cambia la fecha)');
select test.afirmar(
  (select bool_and(etapas = 2 and planos = 1 and materiales = 1 and dxf = 1)
     from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'cuenta 2 etapas de Diseño, 1 plano vigente, 1 material y 1 DXF: lo quitado, lo anulado y la subetapa no cuentan');
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 and bool_and(planos = 1) from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'Administración la ve igual');
reset role;
select pg_temp.como('supervisor_general');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'Supervisión general la ve, en su seguimiento por código');
reset role;

-- ============================================ 5. Etapas a medias, plano sin fecha y el límite de los juegos
-- Otro código con solo la etapa de Maestranza (sin fecha) y un plano: Producción no tiene etapa.
reset role;
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, creado_por)
values (current_setting('prueba.otro'), 1, 'Habilitado', pg_temp.id('mtz'), pg_temp.id('diseno'));
select pg_temp.como('diseno');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('planos-codigo', current_setting('prueba.p3') || '/' || current_setting('prueba.r3') || '.pdf', pg_temp.id('diseno'),
        current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":81234}');
select public.registrar_plano_codigo(pg_temp.id('p3'), pg_temp.id('r3'), current_setting('prueba.otro'), 'P-01', 'Habilitado',
                                     pg_temp.id('mtz'), null, 'p01.pdf', 30);
select test.afirmar(
  (select tiene_etapa and situacion = 'ENTREGADO_SIN_FECHA' and etapas = 1 from pg_temp.fila('MTZ', current_setting('prueba.otro')))
  and (select not tiene_etapa and situacion = 'SIN_FECHA' from pg_temp.fila('PRD', current_setting('prueba.otro'))),
  'con una sola etapa: Producción sale sin etapa (la pantalla dice que falta Ensamblaje) y el plano de Maestranza, subido sin fecha');
reset role;

-- Límite escrito en la migración: el plano no dice de qué juego es. Un segundo
-- juego que empezó ayer sin planos no sale vencido: Maestranza se mide con el primero.
update public.codigo_etapas set inicio_plan = pg_temp.hoy() - 20
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('mtz') and not de_area;
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, creado_por)
values (current_setting('prueba.codigo'), 3, 'Habilitado: Furgón', pg_temp.id('mtz'), pg_temp.hoy() - 1, pg_temp.id('diseno'));
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(
  (select etapa = 'Habilitado: Chasis' and comprometido = pg_temp.hoy() - 20 and situacion = 'TARDE' and dias = 10 from pg_temp.fila('MTZ')),
  'con dos juegos, Maestranza se mide con el que empieza primero: su plano, 10 días tarde; el Furgón sin plano no sale vencido (límite conocido)');
reset role;

-- ============================================ 6. Logística, Almacén y Ventas no
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select * from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])$q$,
  'Logística no ve lo que Diseño lleva en cada código', 'No tienes permiso');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($q$select * from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])$q$,
  'Almacén, con el mismo permiso de seguimiento que Supervisión general, no la ve', 'No tienes permiso');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar($q$select * from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])$q$,
  'Ventas no la ve', 'No tienes permiso');
reset role;

-- ============================================ 7. Nadie sin sesión
select test.afirmar(not has_function_privilege('anon', 'public.lo_que_debe_diseno(text[])', 'execute'),
  'anon no la ejecuta');

rollback;
