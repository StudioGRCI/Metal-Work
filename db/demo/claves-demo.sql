-- =============================================================================
-- CONTRASEÑAS PARA LAS CUENTAS DE DEMOSTRACIÓN
-- -----------------------------------------------------------------------------
-- El personal de demostración se crea sin contraseña a propósito: son fichas,
-- no accesos. Este archivo le pone una contraseña temporal a esas cuentas para
-- poder recorrer el sistema con cada rol y ver qué muestra y qué esconde.
--
--   psql "$DATABASE_URL" -v clave='LA-QUE-ELIJAS' -f db/demo/claves-demo.sql
--
-- La contraseña se pasa al ejecutar y no se escribe acá: este archivo vive en
-- el repositorio, y lo que se escribe en el repositorio deja de ser secreto.
--
-- SOLO PARA DEMOSTRACIÓN. Antes de que el sistema entre en uso real hay que
-- dar de baja estas cuentas o cambiarles la contraseña: comparten una sola.
--
-- Alcance: únicamente los correos @metalworkperusac.com que tienen ficha de
-- personal. No toca la cuenta de administración ni ninguna otra.
-- =============================================================================

-- El parámetro viaja por configuración porque psql no lo sustituye dentro de
-- un bloque $$, y acá hace falta armar la instrucción a mano.
select set_config('demo.clave', :'clave', false);

do $$
declare
  v_esquema  text;
  v_columnas text := '';
  v_columna  text;
  v_valor    text;
begin
  -- pgcrypto vive en `public` en las bases locales y en `extensions` en
  -- Supabase; se resuelve dónde está en vez de suponerlo.
  select n.nspname into v_esquema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'crypt' limit 1;

  if v_esquema is null then
    raise exception 'No está instalada la extensión pgcrypto: sin ella no se puede cifrar la contraseña';
  end if;

  -- La tabla de cuentas de Supabase tiene columnas que la copia local no, y
  -- no basta con poner la contraseña: Supabase busca al usuario por su
  -- instancia y por los metadatos del proveedor. Sin ellos no lo encuentra y
  -- responde «credenciales inválidas» aunque la contraseña sea la correcta.
  for v_columna, v_valor in
    select * from (values
      ('email_confirmed_at', 'coalesce(u.email_confirmed_at, now())'),
      ('instance_id',        '''00000000-0000-0000-0000-000000000000''::uuid'),
      ('raw_app_meta_data',  'jsonb_build_object(''provider'', ''email'', ''providers'', jsonb_build_array(''email''))'),
      ('aud',                'coalesce(u.aud, ''authenticated'')'),
      ('role',               'coalesce(u.role, ''authenticated'')'),
      ('updated_at',         'now()')
    ) as c(columna, valor)
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = v_columna) then
      v_columnas := v_columnas || format(', %I = %s', v_columna, v_valor);
    end if;
  end loop;

  execute format(
    'update auth.users u
        set encrypted_password = %I.crypt(current_setting(''demo.clave''), %I.gen_salt(''bf''))%s
       from public.usuarios p
      where p.id = u.id and u.email like %L',
    v_esquema, v_esquema, v_columnas, '%@metalworkperusac.com');

  -- Y cada cuenta necesita su identidad de correo; sin ella tampoco entra.
  if to_regclass('auth.identities') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'identities'
                    and column_name = 'provider_id') then
    execute $consulta$
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
      select gen_random_uuid(), u.id,
             jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
             'email', u.id::text, now(), now()
        from auth.users u
        join public.usuarios p on p.id = u.id
       where u.email like '%@metalworkperusac.com'
         and not exists (select 1 from auth.identities i
                          where i.user_id = u.id and i.provider = 'email')
    $consulta$;
  end if;
end $$;

select p.correo,
       r.nombre as rol,
       coalesce(a.nombre, '—') as area,
       p.cargo
  from public.usuarios p
  join public.roles r on r.id = p.rol_id
  left join public.areas a on a.id = p.area_id
 where p.correo like '%@metalworkperusac.com'
 order by r.nombre;
