-- Conserva autores e historial; deja una sola cuenta activa de Supervisión por área.
do $$
declare
  v_usuario uuid;
  v_filas integer;
begin
  select id into strict v_usuario from public.usuarios
  where lower(correo) = 'supervisor@metalworkperusac.com'
    and activo;

  if exists (select 1 from auth.users
    where lower(email) = 'supervisor.produccion@metalworkperusac.com')
    or exists (select 1 from public.usuarios
    where lower(correo) = 'supervisor.produccion@metalworkperusac.com') then
    raise exception 'Ya existe la cuenta de Supervisión de Producción.';
  end if;

  update auth.users set email = 'supervisor.produccion@metalworkperusac.com',
    updated_at = now() where id = v_usuario and lower(email) = 'supervisor@metalworkperusac.com';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'No se actualizó exactamente una cuenta de Auth.'; end if;

  update auth.identities
    set identity_data = jsonb_set(identity_data, '{email}', '"supervisor.produccion@metalworkperusac.com"'::jsonb),
        updated_at = now()
    where user_id = v_usuario and provider = 'email'
      and identity_data->>'email' = 'supervisor@metalworkperusac.com';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'No se actualizó exactamente una identidad de correo.'; end if;

  -- El disparador de usuarios exige gestión de personal incluso en una migración.
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.usuarios
      where lower(correo) = 'administracion@metalworkperusac.com' and activo), true);
  if not public.tiene_permiso('usuarios.gestionar') then
    raise exception 'Administración no puede gestionar las cuentas.';
  end if;

  update public.usuarios set correo = 'supervisor.produccion@metalworkperusac.com'
    where id = v_usuario and lower(correo) = 'supervisor@metalworkperusac.com';
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then raise exception 'No se actualizó exactamente un perfil.'; end if;

  update public.usuarios set activo = false
    where lower(correo) in (
      'jefe.produccion@metalworkperusac.com',
      'jefe.maestranza@metalworkperusac.com',
      'jefe.acabados@metalworkperusac.com') and activo;
  get diagnostics v_filas = row_count;
  if v_filas <> 3 then raise exception 'Se esperaban tres cuentas de jefatura activas; encontradas: %.', v_filas; end if;
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

create or replace function public.fn_una_supervision_por_area()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_rol text;
  v_area text;
begin
  if not new.activo then return new; end if;
  select codigo into v_rol from public.roles where id = new.rol_id;
  if v_rol in ('JEFE_PRODUCCION', 'JEFE_TALLER') then
    raise exception 'Las jefaturas de taller fueron reemplazadas por Supervisión.';
  end if;
  if v_rol = 'SUPERVISOR' then
    select codigo into v_area from public.areas where id = new.area_id;
    if v_area in ('PRD','MTZ','ACB') and exists (
      select 1 from public.usuarios u
      join public.roles r on r.id = u.rol_id
      where u.id <> new.id and u.activo and u.area_id = new.area_id
        and r.codigo = 'SUPERVISOR') then
      raise exception 'Esta área ya tiene una cuenta activa de Supervisión.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_una_supervision_por_area() from public, anon, authenticated;
drop trigger if exists trg_una_supervision_por_area on public.usuarios;
create trigger trg_una_supervision_por_area
  before insert or update of rol_id, area_id, activo on public.usuarios
  for each row execute function public.fn_una_supervision_por_area();
