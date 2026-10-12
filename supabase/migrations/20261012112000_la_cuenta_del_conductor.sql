-- =============================================================================
-- LA CUENTA DEL CONDUCTOR DE LOGÍSTICA
-- -----------------------------------------------------------------------------
-- Logística tiene un conductor que recoge las compras donde el proveedor y las
-- deja en el almacén. Su cuenta es del puesto, como las de las demás áreas
-- (logistica@, almacen@…), para que no se pierda cuando cambia quien maneja.
-- Nace sin clave usable: la clave temporal se le da por fuera del repositorio y
-- se cambia al entrar.
-- =============================================================================
do $$
declare
  v_cuenta uuid := gen_random_uuid();
  v_correo text := 'conductor@metalworkperusac.com';
  v_rol    uuid;
  v_sede   uuid;
  v_area   uuid;
begin
  select id into v_rol  from public.roles where codigo = 'CONDUCTOR';
  select id into v_sede from public.sedes order by creado_en limit 1;
  select id into v_area from public.areas where codigo = 'LOG';

  if v_rol is null then
    raise exception 'Falta el rol CONDUCTOR. Aplica antes la migración de la orden de compra directa.';
  end if;
  if v_sede is null then
    raise exception 'No hay ninguna sede registrada: la ficha de una persona necesita su taller.';
  end if;

  if exists (select 1 from auth.users where lower(email) = v_correo) then
    return;
  end if;

  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (v_cuenta, v_correo,
          public.cifrar_clave(gen_random_uuid()::text || gen_random_uuid()::text),
          jsonb_build_object('nombres', 'Conductor', 'apellidos', 'Logística'));
  perform public.completar_cuenta_acceso(v_cuenta);

  insert into public.usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
  values (v_cuenta, 'Conductor', 'Logística', v_correo, 'Conductor de Logística', v_rol, v_sede, v_area);
end;
$$;
