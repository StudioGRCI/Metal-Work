-- =============================================================================
-- LA ASISTENCIA LA CORRIGE RR. HH., Y LA REGLA DE LAS HORAS EXTRAS SE GUARDA
-- -----------------------------------------------------------------------------
-- Dos cosas que halló la revisión de lo que StudioGRCI pidió el 2026-10-20
-- («quien realiza el costeo y ve el personal y hace ediciones o cambios debe ser
-- rrhh no administracion en todo caso admin solo visualizaria»):
--
-- 1. Anular una marca de asistencia lo podían Gerencia, Administración y el
--    administrador del sistema, cualquier día, porque `anular_asistencia`
--    aceptaba a quien solo consulta (`asistencia.ver`) y a `es_admin()`. Anular
--    una marca cambia las tardanzas del mes y su descuento, que son de RR. HH.
--    Ahora la anula RR. HH. (`rrhh.personal`), cualquier día, y la portería
--    (`asistencia.marcar`) solo la de hoy, como antes. Quien consulta, mira.
--
-- 2. RR. HH. no podía cambiar la regla de las horas extras: la tabla de la
--    regla tiene una sola fila con `id boolean` (20261014202000), y la
--    auditoría genérica copia `new.id` en `audit_log.registro_id`, que es uuid.
--    Guardar la regla reventaba con un error del motor en inglés. La fila ya
--    dice quién la cambió y cuándo (`actualizado_por`, `actualizado_en`): se
--    apaga su auditoría genérica, que nunca llegó a guardar nada.
--
-- 3. Marcar la asistencia, de la portería, tampoco lo hace ya el administrador.
-- =============================================================================

create or replace function public.anular_asistencia(p_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_marca public.asistencias%rowtype;
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_rrhh  boolean := public.tiene_permiso('rrhh.personal');
begin
  if not (v_rrhh or public.tiene_permiso('asistencia.marcar')) then
    if public.es_admin() then
      raise exception 'Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo cambia.'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception 'Las marcas las anula Recursos Humanos; la portería, solo las de hoy.'
      using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_marca from public.asistencias where id = p_id for update;
  if not found then raise exception 'La marca no existe.'; end if;
  if v_marca.anulado_en is not null then return p_id; end if;
  if not v_rrhh and v_marca.fecha <> v_hoy then
    raise exception 'La portería solo anula marcas de hoy: las de otros días las anula Recursos Humanos.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_marca.tipo = 'INGRESO' and exists (
      select 1 from public.asistencias
       where trabajador_id = v_marca.trabajador_id and fecha = v_marca.fecha and tipo = 'SALIDA' and anulado_en is null) then
    raise exception 'Primero anula la salida de ese día; después el ingreso.' using errcode = 'check_violation';
  end if;
  update public.asistencias
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_asistencia(uuid, text) from public, anon;
grant execute on function public.anular_asistencia(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_trigger
              where tgrelid = 'public.rrhh_regla_horas_extras'::regclass and tgname = 'trg_auditoria' and tgenabled <> 'D') then
    alter table public.rrhh_regla_horas_extras disable trigger trg_auditoria;
  end if;
end $$;

-- 3. Marcar el ingreso y la salida es de la portería, que es parte de RR. HH.:
-- el administrador del sistema entraba por el atajo de `exigir_permiso` y
-- marcaba por cualquiera. Desde su propia definición, como en 20261020167000.
do $$
declare
  v_fn record;
  v_def text;
begin
  for v_fn in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'marcar_asistencia'
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if v_def ~ 'exigir_permiso\(''asistencia\.marcar''\)' then
      execute replace(v_def, 'exigir_permiso(''asistencia.marcar'')', 'exigir_permiso_del_puesto(''asistencia.marcar'')');
    end if;
  end loop;
end $$;
