-- =============================================================================
-- LA CUENTA DEL TRAMITADOR
-- -----------------------------------------------------------------------------
-- StudioGRCI, 2026-11-26, plan «El puesto de Tramitador», entrega 1. El puesto
-- nació con sus permisos en la 20261126997100; sin una cuenta, la pantalla de
-- «Trámites» no la podría abrir nadie con el puesto que la usa, ni para
-- revisarla como la verá esa persona. Probar como Administrador no prueba
-- nada: entra por es_admin() y nunca toca el permiso.
--
-- Va en el área de Administración del organigrama (ADM), como StudioGRCI
-- decidió. Nace con una clave al azar que nadie conoce: la clave que se entrega
-- se pone después, fuera de este repositorio, que es público, y la cambia el
-- administrador en Personal › «Cambiar clave».
--
-- Idempotente: si la cuenta ya existe, no se toca.
-- =============================================================================
do $$
declare
  v_correo constant text := 'tramitador@metalworkperusac.com';
  v_sede   uuid;
  v_id     uuid;
begin
  if exists (select 1 from auth.users where lower(email) = v_correo) then
    return;
  end if;
  select id into v_sede from public.sedes order by creado_en limit 1;
  if v_sede is null then
    raise exception 'No hay ninguna sede registrada: la ficha de una persona necesita su taller.';
  end if;
  if not exists (select 1 from public.roles where codigo = 'TRAMITADOR') then
    raise exception 'Falta el puesto TRAMITADOR en el sistema: la cuenta % lo necesita.', v_correo;
  end if;
  if not exists (select 1 from public.areas where codigo = 'ADM') then
    raise exception 'Falta el área ADM en el organigrama: la cuenta % la necesita.', v_correo;
  end if;

  v_id := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
  values (v_id, v_correo,
          public.cifrar_clave(gen_random_uuid()::text || gen_random_uuid()::text),
          jsonb_build_object('nombres', 'Encargado', 'apellidos', 'de Trámites'));
  perform public.completar_cuenta_acceso(v_id);

  insert into public.usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
  values (v_id, 'Encargado', 'de Trámites', v_correo, 'Tramitador',
          (select id from public.roles where codigo = 'TRAMITADOR'),
          v_sede,
          (select id from public.areas where codigo = 'ADM'));
end;
$$;
