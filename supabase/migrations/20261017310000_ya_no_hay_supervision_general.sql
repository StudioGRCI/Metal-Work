-- =============================================================================
-- YA NO HAY SUPERVISIÓN GENERAL: SU CUENTA ES LA DEL ADMINISTRADOR DEL SISTEMA
-- -----------------------------------------------------------------------------
-- Gerencia lo dijo el 2026-10-19: en la planta ya no hay Supervisión general,
-- solo la Supervisión de cada área (Producción, Maestranza y Acabados), y la
-- cuenta que tenía ese puesto es la del administrador del sistema.
--
-- Esa cuenta pasa al puesto ADMIN y entra por `es_admin()`. Es la misma cuenta,
-- con su clave y su historial; cambia su puesto y el nombre con que aparece.
-- El puesto SUPERVISOR_GENERAL queda sin cuentas y deja de ofrecerse al dar de
-- alta personal. No se borra, porque el historial de la auditoría lo nombra.
--
-- Solo actúa una vez: si la base ya tiene una cuenta activa de administración,
-- o no tiene ninguna de Supervisión general, no hace nada. Así, aplicarla de
-- nuevo nunca le da el puesto de administración a otra cuenta. Con más de una
-- cuenta de Supervisión general se detiene: cuál administra lo decide una
-- persona.
-- =============================================================================
do $$
declare
  v_admin  uuid;
  v_puesto uuid;
  v_cuenta uuid;
  v_cuentas integer;
begin
  select id into v_admin  from public.roles where codigo = 'ADMIN';
  select id into v_puesto from public.roles where codigo = 'SUPERVISOR_GENERAL';
  if v_admin is null then
    raise exception 'Falta el puesto ADMIN en la tabla de roles.';
  end if;
  if v_puesto is null
     or exists (select 1 from public.usuarios where rol_id = v_admin and activo) then
    return;
  end if;

  select count(*), min(id::text)::uuid into v_cuentas, v_cuenta
    from public.usuarios where rol_id = v_puesto and activo;
  if v_cuentas = 0 then
    return;
  end if;
  if v_cuentas > 1 then
    raise exception 'Hay % cuentas activas de Supervisión general y ninguna de administración: decide a mano cuál pasa a administrar el sistema.', v_cuentas;
  end if;

  -- `trg_usuario_proteger_rol` exige una sesión de administrador, y una
  -- migración no tiene sesión: se aparta solo para este cambio y vuelve.
  alter table public.usuarios disable trigger trg_usuario_proteger_rol;
  update public.usuarios
     set rol_id = v_admin,
         cargo = 'Administrador del sistema',
         -- El nombre solo se corrige si todavía es el del puesto que se va.
         nombres = case when nombres = 'Supervisor' and apellidos = 'General Metal Work'
                        then 'Administrador' else nombres end,
         apellidos = case when nombres = 'Supervisor' and apellidos = 'General Metal Work'
                          then 'del sistema' else apellidos end
   where id = v_cuenta;
  alter table public.usuarios enable trigger trg_usuario_proteger_rol;
end;
$$;
