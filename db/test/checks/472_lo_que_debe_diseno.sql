-- Lo que Diseño le debe a cada código (plan 6, entrega 6.1; migración
-- 20261126600000): los cinco puntos y la fecha comprometida del plano de cada
-- área contra la real. Lo leen Diseño, Administración y el supervisor con su
-- sesión (`set local role authenticated`); Logística no. Nunca como ADMIN.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['DISENO:DIS', 'SUPERVISOR:MTZ', 'ADMINISTRACION:ADM', 'COMPRADOR:LOG'] loop
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
  foreach v in array array['p1', 'r1'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK472-SR-01', true);
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

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ============================================ 1. Sin nada cargado: los cinco puntos pendientes
select pg_temp.como('diseno');
set local role authenticated;
select test.afirmar(
  (select count(*) = 1 and bool_and(not tiene_ot and ficha_en is null and planos = 0 and materiales = 0 and etapas = 0 and dxf = 0
                                    and area is null and situacion is null)
     from public.lo_que_debe_diseno(array[' ' || lower(current_setting('prueba.codigo')) || ' '])),
  'un código sin nada de Diseño sale en una fila, con los cinco puntos pendientes y sin plano de área (y normalizado)');
select test.afirmar((select count(*) from public.lo_que_debe_diseno(null)) = 0
  and (select count(*) from public.lo_que_debe_diseno('{}')) = 0, 'sin códigos no devuelve nada');

-- ============================================ 2. Diseño arma el par de etapas y carga el plano de Maestranza
select public.par_de_etapas_codigo(current_setting('prueba.codigo'), 'Chasis');
reset role;
-- La fecha comprometida la pone Diseño en su etapa: aquí, a mano, para fijar el día.
update public.codigo_etapas set inicio_plan = pg_temp.hoy() - 3, fin_plan = pg_temp.hoy() + 4
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('mtz');
update public.codigo_etapas set inicio_plan = pg_temp.hoy() + 5, fin_plan = pg_temp.hoy() + 9
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('prd');

select pg_temp.como('diseno');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('planos-codigo', current_setting('prueba.p1') || '/' || current_setting('prueba.r1') || '.pdf', pg_temp.id('diseno'),
        current_setting('prueba.diseno'), '{"mimetype":"application/pdf","size":81234}');
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), current_setting('prueba.codigo'), 'P-01', 'Habilitado del chasis',
                                     pg_temp.id('mtz'), null, 'p01.pdf', 30);

select test.afirmar(
  (select count(*) = 2 and bool_and(planos = 1 and etapas = 2 and materiales = 0 and dxf = 0)
     from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'con el par de etapas: una fila por área (Maestranza y Producción), un plano y dos etapas de Diseño');
-- Maestranza: comprometido hace 3 días, subido hoy → 3 días tarde.
select test.afirmar(
  (select situacion = 'TARDE' and dias = 3 and comprometido = pg_temp.hoy() - 3 and entregado_en is not null
     from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')]) where area = 'MTZ'),
  'el plano de Maestranza subido 3 días después del inicio de su etapa sale 3 días tarde');
-- Producción: comprometido en 5 días, sin plano → faltan 5.
select test.afirmar(
  (select situacion = 'PENDIENTE' and dias = 5 and entregado_en is null
     from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')]) where area = 'PRD'),
  'el de Producción, sin plano y con fecha por venir, está pendiente y le faltan 5 días');
reset role;

-- Vencido: la fecha de Producción pasa a ayer y sigue sin plano.
update public.codigo_etapas set inicio_plan = pg_temp.hoy() - 1
 where codigo_interno = current_setting('prueba.codigo') and area_id = pg_temp.id('prd');
-- Una subetapa que agrega el área no es de Diseño: no cuenta como etapa ni como fecha.
insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, de_area, creado_por)
values (current_setting('prueba.codigo'), 50, 'Pintura propia', pg_temp.id('prd'), pg_temp.hoy() - 30, true, pg_temp.id('supervisor'));

-- ============================================ 3. Supervisión y Administración la ven, en lectura
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select situacion = 'VENCIDO' and dias = 1 and comprometido = pg_temp.hoy() - 1
     from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')]) where area = 'PRD'),
  'el supervisor la ve: el plano de Producción venció hace 1 día (la etapa propia del área no cambia la fecha)');
select test.afirmar(
  (select bool_and(etapas = 2) from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'la etapa que agregó el área no cuenta como etapa de Diseño');
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar(
  (select count(*) = 2 and bool_and(planos = 1) from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])),
  'Administración la ve igual');
reset role;

-- ============================================ 4. Logística no
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select * from public.lo_que_debe_diseno(array[current_setting('prueba.codigo')])$q$,
  'Logística no ve lo que Diseño lleva en cada código', 'No tienes permiso');
reset role;

-- ============================================ 5. Nadie sin sesión
select test.afirmar(not has_function_privilege('anon', 'public.lo_que_debe_diseno(text[])', 'execute'),
  'anon no la ejecuta');

rollback;
