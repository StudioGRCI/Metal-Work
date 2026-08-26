-- Alta de personal con acceso: quién puede darla, y que la cuenta quede
-- realmente en condiciones de entrar.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000007', 'PRUEBAS PERSONAL S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',  'Torres', 'ana@demo.pe',  'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Beto', 'Ríos',   'beto@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

-- ---------------------------------------------------------------- el permiso
-- Un operario no puede dar de alta a nadie: la guarda está dentro de la
-- función, así que no alcanza con esconder el botón en la pantalla.
do $$
declare v_error text;
begin
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'beto@demo.pe'), true);

  begin
    perform public.crear_personal('Intruso', 'Sin Permiso', 'intruso@demo.pe', 'clave-de-prueba-123',
                                  (select id from public.roles where codigo = 'OPERARIO'),
                                  (select id from public.sedes limit 1));
    raise exception 'FALLA: un operario pudo dar de alta a otra persona';
  exception when insufficient_privilege then
    null;  -- es lo que se espera
  end;
end $$;

-- ------------------------------------------------------------------- el alta
do $$
declare
  v_nuevo uuid;
  v_clave text;
begin
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'ana@demo.pe'), true);

  v_nuevo := public.crear_personal('Carla', 'Vega', 'carla@demo.pe', 'clave-de-prueba-123',
                                   (select id from public.roles where codigo = 'ALMACENERO'),
                                   (select id from public.sedes limit 1),
                                   null, 'Almacenera', '70123456', '999111222', false, 0);

  if not exists (select 1 from public.usuarios where id = v_nuevo and correo = 'carla@demo.pe') then
    raise exception 'FALLA: no quedó la ficha de la persona';
  end if;

  select encrypted_password into v_clave from auth.users where id = v_nuevo;
  if v_clave is null or v_clave not like '$2%' then
    raise exception 'FALLA: la contraseña no quedó cifrada con bcrypt';
  end if;

  -- Y la contraseña tiene que verificar, que es lo que hará Supabase al entrar.
  if not exists (
    select 1 from auth.users
     where id = v_nuevo and encrypted_password = crypt('clave-de-prueba-123', encrypted_password)
  ) then
    raise exception 'FALLA: la contraseña guardada no verifica';
  end if;
end $$;

-- ------------------------------------------------------- correo ya existente
do $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'ana@demo.pe'), true);

  begin
    perform public.crear_personal('Otra', 'Carla', 'carla@demo.pe', 'clave-de-prueba-123',
                                  (select id from public.roles where codigo = 'OPERARIO'),
                                  (select id from public.sedes limit 1));
    raise exception 'FALLA: dejó crear dos cuentas con el mismo correo';
  exception when raise_exception then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- ------------------------------------------------------------- clave mínima
do $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'ana@demo.pe'), true);

  begin
    perform public.crear_personal('Corta', 'Clave', 'corta@demo.pe', 'abc',
                                  (select id from public.roles where codigo = 'OPERARIO'),
                                  (select id from public.sedes limit 1));
    raise exception 'FALLA: aceptó una contraseña de tres caracteres';
  exception when raise_exception then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- --------------------------------------------------------------- baja lógica
do $$
declare v_carla uuid;
begin
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'ana@demo.pe'), true);
  select id into v_carla from public.usuarios where correo = 'carla@demo.pe';

  perform public.cambiar_estado_personal(v_carla, false);
  if (select activo from public.usuarios where id = v_carla) then
    raise exception 'FALLA: la baja no surtió efecto';
  end if;

  -- Y nadie puede darse de baja a sí mismo, que dejaría el sistema sin quien
  -- administre si lo hace la única cuenta de administración.
  begin
    perform public.cambiar_estado_personal(
      (select id from public.usuarios where correo = 'ana@demo.pe'), false);
    raise exception 'FALLA: se pudo dar de baja a sí misma';
  exception when raise_exception then
    if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

rollback;
