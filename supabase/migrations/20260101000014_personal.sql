-- =============================================================================
-- ALTA DE PERSONAL CON ACCESO
-- -----------------------------------------------------------------------------
-- Hasta ahora las personas se daban de alta por base de datos. Esto lo mueve al
-- sistema: administración crea la ficha y el acceso en un solo paso.
--
-- Crear un acceso significa escribir en `auth.users`, que la aplicación no
-- alcanza con la sesión de una persona. Por eso van como funciones con permisos
-- elevados, cada una con su guarda: solo quien tiene `usuarios.gestionar`.
--
-- Las funciones se escriben para servir igual sobre Supabase y sobre la copia
-- local del esquema, que tiene menos columnas: cada columna se toca solo si
-- existe. Sin esto, las pruebas locales dejarían de correr.
-- =============================================================================

-- ------------------------------------------------------------------- cifrado
-- pgcrypto vive en `public` en las bases locales y en `extensions` en Supabase.
create or replace function public.cifrar_clave(p_clave text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_esquema text;
  v_hash    text;
begin
  if p_clave is null or length(p_clave) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;

  select n.nspname into v_esquema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'crypt' limit 1;

  if v_esquema is null then
    raise exception 'No está instalada la extensión pgcrypto';
  end if;

  execute format('select %I.crypt($1, %I.gen_salt(''bf''))', v_esquema, v_esquema)
     into v_hash using p_clave;

  return v_hash;
end;
$$;

comment on function public.cifrar_clave(text) is
  'Cifra una contraseña con bcrypt, sin importar en qué esquema esté pgcrypto.';

-- --------------------------------------------------------- completar la cuenta
-- Una cuenta creada por SQL queda a medias: sin instancia, sin metadatos de
-- proveedor y con las columnas de token en nulo. Supabase busca al usuario por
-- los primeros y revienta al leer las segundas, así que responde «credenciales
-- inválidas» o error del servidor aunque la contraseña sea la correcta.
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
  'Rellena lo que Supabase necesita para poder iniciar sesión con una cuenta creada por SQL.';

-- -------------------------------------------------------------- alta completa
create or replace function public.crear_personal(
  p_nombres      text,
  p_apellidos    text,
  p_correo       text,
  p_clave        text,
  p_rol_id       uuid,
  p_sede_id      uuid,
  p_area_id      uuid    default null,
  p_cargo        text    default null,
  p_documento    text    default null,
  p_telefono     text    default null,
  p_es_operario  boolean default false,
  p_costo_hora   numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cuenta uuid := gen_random_uuid();
  v_correo text := lower(trim(p_correo));
begin
  perform public.exigir_permiso('usuarios.gestionar');

  if v_correo is null or v_correo !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'El correo no tiene un formato válido';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_correo) then
    raise exception 'Ya existe una cuenta con el correo %', v_correo;
  end if;

  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (v_cuenta, v_correo, public.cifrar_clave(p_clave),
          jsonb_build_object('nombres', p_nombres, 'apellidos', p_apellidos));

  perform public.completar_cuenta_acceso(v_cuenta);

  insert into public.usuarios
    (id, nombres, apellidos, correo, cargo, documento, telefono,
     rol_id, sede_id, area_id, es_operario, costo_hora)
  values (v_cuenta, trim(p_nombres), trim(p_apellidos), v_correo,
          nullif(trim(coalesce(p_cargo, '')), ''),
          nullif(trim(coalesce(p_documento, '')), ''),
          nullif(trim(coalesce(p_telefono, '')), ''),
          p_rol_id, p_sede_id, p_area_id,
          coalesce(p_es_operario, false), coalesce(p_costo_hora, 0));

  return v_cuenta;
end;
$$;

comment on function public.crear_personal is
  'Da de alta a una persona con su ficha y su acceso, en un solo paso.';

-- ----------------------------------------------------------- cambiar la clave
create or replace function public.cambiar_clave_personal(p_usuario uuid, p_clave text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('usuarios.gestionar');

  if not exists (select 1 from public.usuarios where id = p_usuario) then
    raise exception 'No existe esa persona en el sistema';
  end if;

  update auth.users
     set encrypted_password = public.cifrar_clave(p_clave)
   where id = p_usuario;

  perform public.completar_cuenta_acceso(p_usuario);
end;
$$;

comment on function public.cambiar_clave_personal(uuid, text) is
  'Asigna una contraseña nueva a una persona. Solo administración.';

-- --------------------------------------------------------- alta y baja lógica
create or replace function public.cambiar_estado_personal(p_usuario uuid, p_activo boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.exigir_permiso('usuarios.gestionar');

  if p_usuario = public.usuario_actual() and not p_activo then
    raise exception 'No puedes darte de baja a ti mismo';
  end if;

  update public.usuarios set activo = p_activo where id = p_usuario;

  if not found then
    raise exception 'No existe esa persona en el sistema';
  end if;
end;
$$;

comment on function public.cambiar_estado_personal(uuid, boolean) is
  'Da de baja o reactiva a una persona sin borrar su historial.';

-- ------------------------------------------------------------------ permisos
-- Solo quien tiene sesión puede llamarlas, y adentro cada una comprueba el
-- permiso. `anon` no las alcanza.
revoke all on function public.cifrar_clave(text) from public, anon, authenticated;
revoke all on function public.completar_cuenta_acceso(uuid) from public, anon, authenticated;
revoke all on function public.crear_personal from public, anon;
revoke all on function public.cambiar_clave_personal(uuid, text) from public, anon;
revoke all on function public.cambiar_estado_personal(uuid, boolean) from public, anon;

grant execute on function public.crear_personal to authenticated;
grant execute on function public.cambiar_clave_personal(uuid, text) to authenticated;
grant execute on function public.cambiar_estado_personal(uuid, boolean) to authenticated;
