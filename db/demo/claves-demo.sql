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
begin
  -- pgcrypto vive en `public` en las bases locales y en `extensions` en
  -- Supabase; se resuelve dónde está en vez de suponerlo.
  select n.nspname into v_esquema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'crypt' limit 1;

  if v_esquema is null then
    raise exception 'No está instalada la extensión pgcrypto: sin ella no se puede cifrar la contraseña';
  end if;

  -- La tabla de cuentas de Supabase tiene columnas que la copia local no.
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users'
                and column_name = 'email_confirmed_at') then
    v_columnas := ', email_confirmed_at = coalesce(u.email_confirmed_at, now())';
  end if;

  execute format(
    'update auth.users u
        set encrypted_password = %I.crypt(current_setting(''demo.clave''), %I.gen_salt(''bf''))%s
       from public.usuarios p
      where p.id = u.id and u.email like %L',
    v_esquema, v_esquema, v_columnas, '%@metalworkperusac.com');
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
