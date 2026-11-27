-- Marketing no va (migración 20261127001000): el área se da de baja, no se
-- borra, y deja de salir en las listas de áreas que leen las pantallas. Si algo
-- ya apuntara a ella, la migración no la da de baja. Termina en rollback.
\set ON_ERROR_STOP on
begin;

select test.afirmar(exists (select 1 from public.areas where codigo = 'MKT'),
  'La fila de Marketing sigue en la base: se da de baja, no se borra');
select test.afirmar(not (select activo from public.areas where codigo = 'MKT'),
  'Marketing está dada de baja');

-- Lo que lee una pantalla (Personal, de RR. HH.): solo las activas, con la cuenta del puesto.
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'rrhh.499@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
  select v_id, 'RRHH', 'Check 499', 'rrhh.499@prueba.local', r.id from public.roles r where r.codigo = 'RECURSOS_HUMANOS';
  perform set_config('prueba.rrhh', v_id::text, true);
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;
select test.afirmar((select count(*) from public.areas where activo) > 0,
  'RR. HH. lee las áreas activas');
select test.afirmar(not exists (select 1 from public.areas where activo and codigo = 'MKT'),
  'y Marketing no está entre ellas');
reset role;

-- Volver a correr la migración no cambia nada.
\ir ../../../supabase/migrations/20261127001000_marketing_no_va.sql
select test.afirmar(not (select activo from public.areas where codigo = 'MKT'), 'Volver a correrla la deja igual');

-- Si una cuenta ya fuera del área, la migración se detiene sin darla de baja.
update public.areas set activo = true where codigo = 'MKT';
do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'mkt.499@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
  select v_id, 'MKT', 'Check 499', 'mkt.499@prueba.local', r.id, (select id from public.areas where codigo = 'MKT')
    from public.roles r where r.codigo = 'RECURSOS_HUMANOS';
end $$;
savepoint antes_de_la_guarda;
\set ON_ERROR_STOP off
\ir ../../../supabase/migrations/20261127001000_marketing_no_va.sql
\set fallo :ERROR
rollback to savepoint antes_de_la_guarda;
\set ON_ERROR_STOP on
select test.afirmar(:'fallo' = 'true', 'Con una cuenta en Marketing, la migración se detiene');
select test.afirmar((select activo from public.areas where codigo = 'MKT'), 'y el área sigue de alta');

rollback;
