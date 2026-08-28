-- =============================================================================
-- LA CUENTA DEL ÁREA DE ADMINISTRACIÓN
-- -----------------------------------------------------------------------------
-- La migración anterior creó el rol ADMINISTRACION —el área que arma la
-- cotización de trabajo y emite la orden— pero no había nadie con él, y un rol
-- sin ninguna persona es una etapa del circuito que no se puede recorrer: la
-- cotización llegaría a costeo y se quedaría ahí, esperando a alguien que no
-- existe.
--
-- El sistema ya tiene una cuenta por área —ventas, gerencia, jefe de taller,
-- almacén, calidad, compras, costos, supervisor y los operarios— y le faltaba
-- esta. Se crea igual que las otras, con su ficha y su acceso.
--
-- La contraseña se sortea y no la conoce nadie, a propósito: este repositorio es
-- público y ya hubo que rotar claves una vez por haberlas escrito donde no
-- correspondía. Quien administre le pone la suya desde Personal → Cambiar clave,
-- que es la pantalla que existe justamente para eso.
-- =============================================================================

do $$
declare
  v_cuenta uuid := gen_random_uuid();
  v_correo text := 'administracion@metalworkperusac.com';
  v_rol    uuid;
  v_sede   uuid;
  v_area   uuid;
begin
  select id into v_rol  from public.roles  where codigo = 'ADMINISTRACION';
  select id into v_sede from public.sedes  order by creado_en limit 1;
  select id into v_area from public.areas  where codigo = 'ADM';

  if v_rol is null then
    raise exception
      'Falta el rol ADMINISTRACION. Aplica antes la migración del circuito de la cotización.';
  end if;

  if v_sede is null then
    raise exception 'No hay ninguna sede registrada: la ficha de una persona necesita su taller.';
  end if;

  -- Idempotente: volver a correr la migración no duplica la cuenta.
  if exists (select 1 from auth.users where lower(email) = v_correo) then
    return;
  end if;

  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (v_cuenta, v_correo,
          -- Dos identificadores sorteados: setenta y dos caracteres que nadie
          -- escribió y que nadie va a adivinar. La cuenta nace sin clave usable.
          public.cifrar_clave(gen_random_uuid()::text || gen_random_uuid()::text),
          jsonb_build_object('nombres', 'Administración', 'apellidos', 'Metal Work'));

  -- Rellena lo que Supabase necesita para que la cuenta pueda iniciar sesión:
  -- creada por SQL, le faltan la identidad y las columnas de token, que no
  -- admiten nulos y ya costaron una migración de arreglo.
  perform public.completar_cuenta_acceso(v_cuenta);

  insert into public.usuarios
    (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
  values (v_cuenta, 'Administración', 'Metal Work', v_correo,
          'Cotización de trabajo y órdenes', v_rol, v_sede, v_area);
end;
$$;
