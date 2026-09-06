-- =============================================================================
-- UNA CUENTA NUEVA NACE CON FECHA, O NO ENTRA NUNCA
-- -----------------------------------------------------------------------------
-- `completar_cuenta_acceso` deja lista la fila de Auth de cada persona que se da
-- de alta: la confirma, le pone `aud` y `role`, vacía los tokens que Supabase
-- lee como texto obligatorio y le crea la identidad de correo. Todo eso está
-- bien y se escribió con cuidado. Le faltaba una sola columna: `created_at`.
--
-- `auth.users.created_at` no tiene valor por defecto, así que quedaba en nulo, y
-- el servidor de Auth no sabe leer esa fila: al intentar entrar devuelve 500
-- «Database error querying schema» —en el log, `Scan error on column index 5,
-- name "created_at"`—. Con la contraseña correcta y todo lo demás en orden.
--
-- O sea: **toda cuenta creada desde la pantalla de Personal nacía sin poder
-- iniciar sesión**, y el error no dice nada de la fecha, así que la sospecha
-- caía siempre en la contraseña. Le pasó a `administracion@metalworkperusac.com`
-- —nunca pudo entrar desde que se creó— y a la cuenta de Diseño, recién dada de
-- alta, que fue donde se cazó.
--
-- Acá se arregla la función y se reparan las filas que ya nacieron así.
-- =============================================================================

create or replace function public.completar_cuenta_acceso(p_cuenta uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_columna  text;
  v_asigna   text := '';
begin
  for v_columna, v_asigna in
    select * from (values
      ('instance_id',       '''00000000-0000-0000-0000-000000000000''::uuid'),
      ('aud',               '''authenticated'''),
      ('role',              '''authenticated'''),
      ('raw_app_meta_data', 'jsonb_build_object(''provider'', ''email'', ''providers'', jsonb_build_array(''email''))'),
      ('email_confirmed_at','coalesce(email_confirmed_at, now())'),
      -- La que faltaba. Sin ella la cuenta existe, tiene su clave, está
      -- confirmada… y el servidor de Auth se cae al leerla.
      ('created_at',        'coalesce(created_at, now())'),
      ('updated_at',        'now()')
    ) as c(columna, valor)
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and column_name = v_columna) then
      execute format('update auth.users set %I = %s where id = $1', v_columna, v_asigna) using p_cuenta;
    end if;
  end loop;

  -- Supabase lee estas columnas como texto obligatorio, nunca nulo.
  for v_columna in
    select unnest(array['confirmation_token', 'recovery_token', 'email_change',
                        'email_change_token_new', 'email_change_token_current',
                        'phone_change', 'phone_change_token', 'reauthentication_token'])
  loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users' and column_name = v_columna) then
      execute format('update auth.users set %I = coalesce(%I, '''') where id = $1', v_columna, v_columna)
        using p_cuenta;
    end if;
  end loop;

  -- Y la identidad de correo, sin la cual tampoco entra.
  if to_regclass('auth.identities') is not null
     and exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
    execute $consulta$
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
      select gen_random_uuid(), u.id,
             jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
             'email', u.id::text, now(), now()
        from auth.users u
       where u.id = $1
         and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email')
    $consulta$ using p_cuenta;
  end if;
end;
$$;

comment on function public.completar_cuenta_acceso(uuid) is
  'Deja la fila de auth.users lista para iniciar sesión: confirmada, con created_at, aud y role, los tokens en cadena vacía y su identidad de correo. Sin created_at el servidor de Auth devuelve 500 al leerla.';

-- Estaba cerrada y se queda cerrada: la llama `crear_personal`, que ya exige el
-- permiso. Se repite acá para que se lea junto a la función y no haya que ir a
-- buscarlo a otra migración.
revoke all on function public.completar_cuenta_acceso(uuid) from public, anon, authenticated;

-- ------------------------------------------------- las que ya nacieron así
-- Se les pone la fecha de su ficha de personal, que es cuándo se dieron de alta
-- de verdad; si no la hubiera, la de su última modificación.
update auth.users au
   set created_at = coalesce(u.creado_en, au.updated_at, now())
  from public.usuarios u
 where u.id = au.id
   and au.created_at is null;
