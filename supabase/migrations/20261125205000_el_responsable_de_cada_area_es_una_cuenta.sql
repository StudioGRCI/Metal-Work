-- =============================================================================
-- EL RESPONSABLE DE CADA ÁREA ES UNA CUENTA
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-25, «Plan aparte. Las demás áreas», entrega A.0: «que cada área
-- tenga un responsable enlazado a una cuenta». Es la base de lo que sigue en
-- ese plan (Calidad, Garantías, Mantenimiento, Ingeniería, Marketing) y de
-- SSOMA y Mantenimiento de equipos: «avisar al responsable del área» necesita
-- una cuenta a la que avisarle.
--
-- Cómo estaba. El organigrama («CODIFICACION DE AREAS.xlsx», sección 3 de
-- docs/ANALISIS-ONEDRIVE.md) nombra al encargado de cada área, y así se guardó:
-- `areas.encargado`, un texto. La migración 067 le puso al lado la cuenta
-- (`areas.jefe_id`), pero ninguna pantalla la llenó nunca: el 2026-11-25, en
-- producción, las 22 áreas la tenían vacía, y 9 no tenían ni el nombre
-- (Gerencia General, Gerencia Comercial, Gerencia de Operaciones,
-- Administración, Marketing, Calidad, SSOMA, TI / Soporte y Servicios de apoyo).
--
-- Desde aquí:
--
--   * el responsable de un área es su cuenta, `areas.jefe_id`. No se crea otra
--     columna: la 067 ya la había creado para eso, y hoy nada la lee
--     (`asignar_responsables_ot` quedó sin quien la llame), así que asignarla
--     no cambia nada de lo que ya funciona;
--   * el texto del organigrama se conserva tal cual hasta que todas las áreas
--     tengan cuenta (DKS lo pidió así). La pantalla lo muestra al lado, para
--     saber a quién buscarle la cuenta; no se borra ni se pisa aquí;
--   * la cuenta responsable tiene que estar activa al asignarla. Una cuenta
--     dada de baja no recibe avisos ni puede entrar a contestar;
--   * `responsable_del_area('CAL')` da la cuenta responsable y activa de un
--     área, o nada. Hoy ninguna función avisa todavía por aquí: la van a usar
--     los avisos «al área» de las entregas que siguen (Calidad, Garantías,
--     Mantenimiento) y de SSOMA y Mantenimiento de equipos, que la esperan con
--     este nombre. Si la cuenta se dio de baja después de asignarla, no la
--     devuelve, y la pantalla de Configuración lo dice en la fila de esa área;
--   * lo asigna el administrador del sistema, en Configuración. La política de
--     `areas` ya lo pide así (`es_admin()` o `configuracion.editar`, que desde
--     la 20261017400000 solo tiene el puesto ADMIN): no cambia.
--
-- Esta migración no asigna a nadie ni toca una sola fila de `areas`: las
-- personas las pone DKS desde la pantalla.
-- =============================================================================

comment on column public.areas.jefe_id is
  'La cuenta responsable del área. Se asigna en Configuración (solo el administrador) y tiene que estar activa al asignarla. Para avisarle al área se lee con responsable_del_area(codigo), que no devuelve una cuenta dada de baja.';

comment on column public.areas.encargado is
  'El nombre del encargado tal como figura en el organigrama. Se conserva hasta que todas las áreas tengan su cuenta responsable (jefe_id): dice a quién hay que darle cuenta.';

-- ------------------------------------------- 1. la cuenta tiene que estar activa
-- Sin lista de columnas: decide adentro, con el valor nuevo o el que cambió.
-- Lo de antes no se juzga: un área cuyo responsable se dio de baja después se
-- puede seguir corrigiendo (el nombre, el orden) sin tocar su responsable.
create or replace function public.fn_area_responsable_activo()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.jefe_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.jefe_id is not distinct from old.jefe_id then
    return new;
  end if;
  if not exists (select 1 from public.usuarios u where u.id = new.jefe_id and u.activo) then
    raise exception 'La cuenta elegida para % está dada de baja o ya no existe: el responsable de un área tiene que ser una cuenta activa.',
      new.nombre using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.fn_area_responsable_activo() is
  'La cuenta responsable de un área tiene que estar activa al asignarla. Migración 20261125205000.';

revoke all on function public.fn_area_responsable_activo() from public, anon, authenticated;

create or replace trigger trg_area_responsable_activo
  before insert or update on public.areas
  for each row execute function public.fn_area_responsable_activo();

-- ------------------------------------------------ 2. a quién se le avisa del área
-- Una fila o ninguna. Corre con el permiso de quien la llama: las áreas y las
-- cuentas las lee toda cuenta activa (`ver_areas`, `ver_usuarios`); dentro de
-- una función `security definer` que avisa, lee como su dueño.
create or replace function public.responsable_del_area(p_codigo text)
returns uuid
language sql
stable
set search_path to 'public'
as $$
  select a.jefe_id
    from public.areas a
    join public.usuarios u on u.id = a.jefe_id and u.activo
   where a.codigo = upper(btrim(coalesce(p_codigo, '')))
     and a.activo;
$$;

comment on function public.responsable_del_area(text) is
  'La cuenta responsable y activa del área con ese código («CAL», «MNT»), o null si el área no tiene responsable o su cuenta se dio de baja. Es a quien se le avisa lo que va «al área». Migración 20261125205000.';

revoke all on function public.responsable_del_area(text) from public, anon;
grant execute on function public.responsable_del_area(text) to authenticated;
