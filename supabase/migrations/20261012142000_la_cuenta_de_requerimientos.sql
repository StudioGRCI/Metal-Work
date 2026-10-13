-- =============================================================================
-- LA CUENTA DE COSTEO PASA A SER LA DE REQUERIMIENTOS
-- -----------------------------------------------------------------------------
-- Gerencia decidió (2026-10-12) que la cuenta de Costos y Materiales sea la del
-- área de Requerimientos: registra los RQ de insumos para Logística y el
-- ingreso y salida de vehículos. Es la misma cuenta, con su misma clave; cambia
-- el correo con el que entra (requerimientos@…), su puesto y su área. Así su
-- historial sigue siendo suyo y nadie tiene que estrenar contraseña.
--
-- El puesto REQUERIMIENTOS conserva lo que la cuenta ya veía como Costos y
-- Materiales (ver la migración anterior), así que no pierde ninguna pantalla.
-- Si la cuenta ya cambió, o no existe (una base de prueba), no hace nada.
-- =============================================================================
do $$
declare
  v_antes  constant text := 'costeoymateriales@metalworkperusac.com';
  v_correo constant text := 'requerimientos@metalworkperusac.com';
  v_cuenta uuid;
  v_rol    uuid;
  v_area   uuid;
begin
  select id into v_rol  from public.roles where codigo = 'REQUERIMIENTOS';
  select id into v_area from public.areas where codigo = 'REQ';
  if v_rol is null then
    raise exception 'Falta el puesto REQUERIMIENTOS. Aplica antes la migración de requerimientos y vehículos.';
  end if;

  select id into v_cuenta from public.usuarios where lower(correo) = v_antes;
  if v_cuenta is null then
    return;
  end if;
  if exists (select 1 from auth.users where lower(email) = v_correo and id <> v_cuenta) then
    raise exception 'Ya hay otra cuenta con el correo %: revísalo antes de mover la de Costos.', v_correo;
  end if;

  update auth.users set email = v_correo where id = v_cuenta;
  -- La identidad de correo guarda su propia copia del correo.
  if to_regclass('auth.identities') is not null then
    update auth.identities
       set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_correo))
     where user_id = v_cuenta and provider = 'email';
  end if;

  -- `trg_usuario_proteger_rol` exige una sesión de administrador, y una
  -- migración no tiene sesión: se aparta solo para este cambio y vuelve.
  alter table public.usuarios disable trigger trg_usuario_proteger_rol;
  update public.usuarios
     set correo = v_correo, rol_id = v_rol, area_id = coalesce(v_area, area_id),
         nombres = 'Requerimientos', apellidos = '', cargo = 'Requerimientos'
   where id = v_cuenta;
  alter table public.usuarios enable trigger trg_usuario_proteger_rol;
end;
$$;
