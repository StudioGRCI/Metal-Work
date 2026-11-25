-- Los días en espera de cada fila (migración 20261125140000).
--
--   1. Cuenta por fecha de Lima: lo de ayer a las 11:59 p. m. lleva un día; lo de
--      hoy a las 12:01 a. m., cero. Lo de hace tres fechas, tres. Sin hora, vacío.
--   2. Devuelve una fila por hora, en el mismo orden, aunque se repitan o vengan
--      vacías: la pantalla las empareja por su posición.
--   3. Más de mil a la vez lo dice, no devuelve vacío.
--   4. La ejecuta cualquier puesto con sesión (no lee tablas), y nadie sin sesión.
--
-- Con la cuenta de un puesto —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;
-- Como Supabase, en UTC: una cuenta hecha con la fecha de la sesión fallaría aquí.
set local timezone = 'UTC';

do $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, 'almacenero.459@prueba.local');
  insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
  select v_id, 'Almacenero', 'Check 459', 'almacenero.459@prueba.local', r.id from public.roles r where r.codigo = 'ALMACENERO';
  perform set_config('prueba.almacenero', v_id::text, true);
end $$;

select test.como_usuario(current_setting('prueba.almacenero')::uuid);
set local role authenticated;

do $$
declare
  -- Medianoche de hoy en Lima, como hora absoluta.
  v_hoy constant timestamptz := ((now() at time zone 'America/Lima')::date)::timestamp at time zone 'America/Lima';
  v record;
  v_filas integer;
begin
  select array_agg(dias order by posicion) as dias, array_agg(posicion order by posicion) as pos, count(*) as n
    into v
    from public.dias_en_espera_de(array[
      v_hoy - interval '1 minute',            -- ayer 11:59 p. m.
      v_hoy + interval '1 minute',            -- hoy 12:01 a. m.
      null,
      v_hoy - interval '3 days' + interval '9 hours',
      v_hoy - interval '1 minute',            -- repetida
      now()
    ]);
  perform test.afirmar(v.n = 6 and v.pos = array[1, 2, 3, 4, 5, 6], 'una fila por hora, en el mismo orden (' || v.n || ')');
  perform test.afirmar(v.dias[1] = 1, 'lo de ayer a las 11:59 p. m. lleva un día (dice ' || coalesce(v.dias[1]::text, 'nada') || ')');
  perform test.afirmar(v.dias[2] = 0, 'lo de hoy a las 12:01 a. m., cero');
  perform test.afirmar(v.dias[3] is null, 'sin hora, vacío y no cero');
  perform test.afirmar(v.dias[4] = 3, 'lo de hace tres fechas, tres');
  perform test.afirmar(v.dias[5] = 1 and v.dias[6] = 0, 'la repetida cuenta igual, y lo de ahora es hoy');

  select count(*) into v_filas from public.dias_en_espera_de(array[]::timestamptz[]);
  perform test.afirmar(v_filas = 0, 'una lista vacía no devuelve nada');
  select count(*) into v_filas from public.dias_en_espera_de(null);
  perform test.afirmar(v_filas = 0, 'sin lista, tampoco');
end $$;

select test.debe_fallar(
  'select * from public.dias_en_espera_de(array(select now() from generate_series(1, 1001)))',
  'más de mil a la vez lo dice, no devuelve vacío', 'hasta 1000 filas');
reset role;

do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.dias_en_espera_de(timestamptz[])', 'execute'),
    'sin sesión no se ejecuta');
  perform test.afirmar(has_function_privilege('authenticated', 'public.dias_en_espera_de(timestamptz[])', 'execute'),
    'con sesión, cualquier puesto');
  perform test.afirmar((select not prosecdef from pg_proc where oid = 'public.dias_en_espera_de(timestamptz[])'::regprocedure),
    'corre con el permiso de quien llama: no salta ninguna política');
end $$;

rollback;
