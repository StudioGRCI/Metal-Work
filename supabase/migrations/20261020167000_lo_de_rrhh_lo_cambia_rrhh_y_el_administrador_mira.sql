-- =============================================================================
-- LO DE RR. HH. LO CAMBIA RR. HH.; EL ADMINISTRADOR SOLO MIRA
-- -----------------------------------------------------------------------------
-- StudioGRCI, 2026-10-20: «quien realiza el costeo y ve el personal y hace
-- ediciones o cambios debe ser rrhh no administracion en todo caso admin solo
-- visualizaria». La migración 20261020165000 lo aplicó al DNI y al costo por
-- hora de las cuentas; esta lo lleva a todo lo que escribe Recursos Humanos: la
-- ficha del personal, su costo y su remuneración, el tareo, los permisos, las
-- observaciones, los pagos de la oficina, la regla de tardanza, las horas
-- extras, la planilla diaria y las planillas del mes.
--
-- Esas funciones exigen su permiso con `exigir_permiso`, que deja pasar al
-- administrador del sistema (`es_admin()`) sin mirar el permiso. Aquí cambian a
-- `exigir_permiso_del_puesto`, igual pero sin ese atajo: el administrador sigue
-- leyendo todo (las pantallas y las funciones de lectura no cambian) y ya no
-- guarda, anula ni cierra nada de RR. HH. Las políticas de las planillas del mes
-- ya pedían `rrhh.gestionar_planillas` sin el atajo.
--
-- Las funciones se reescriben desde su propia definición vigente, cambiando solo
-- la llamada del permiso, para no copiar treinta cuerpos que otras migraciones
-- ya fijaron (el blindaje reescribe funciones: copiar un texto viejo reabriría
-- lo que cerró). La lista es explícita: solo las que escriben (volátiles); las
-- de lectura (`rrhh_horas_esperando_costo`, `rrhh_inicio_registro_pagos_oficina`,
-- `planilla_diaria_por_enviar`) quedan con el atajo, porque el administrador mira.
-- Volver a correrla no cambia nada: si una ya no tiene la llamada vieja, sigue.
-- =============================================================================

create or replace function public.exigir_permiso_del_puesto(p_permiso text)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  -- Sin sesión (migraciones, la clave de servicio, una conexión directa) manda el
  -- acceso a la base, como en `exigir_permiso`.
  if public.usuario_actual() is null then
    return;
  end if;
  if not public.tiene_permiso(p_permiso) then
    raise exception 'Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo cambia.'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;
comment on function public.exigir_permiso_del_puesto(text) is
  'Como exigir_permiso, pero sin el atajo del administrador del sistema: lo que escribe Recursos Humanos lo escribe solo quien tiene el permiso (migración 20261020167000).';
revoke all on function public.exigir_permiso_del_puesto(text) from public, anon;
grant execute on function public.exigir_permiso_del_puesto(text) to authenticated;

do $$
declare
  v_nombres constant text[] := array[
    'anular_planilla_diaria', 'cerrar_planilla', 'entregar_boleta_planilla_diaria', 'enviar_planilla_diaria',
    'fn_planilla_abierta', 'importar_planilla_excel', 'repartir_planilla_en_partes_iguales',
    'rrhh_anular_decision_horas_extras', 'rrhh_anular_observacion', 'rrhh_anular_pago_oficina', 'rrhh_anular_permiso',
    'rrhh_anular_tareo', 'rrhh_anular_uso_saldo', 'rrhh_cambiar_estado_trabajador', 'rrhh_dar_de_alta_trabajador',
    'rrhh_dar_de_baja_trabajador', 'rrhh_decidir_horas_extras', 'rrhh_guardar_costo_trabajador',
    'rrhh_guardar_ingreso_trabajador', 'rrhh_guardar_regla_horas_extras', 'rrhh_guardar_regla_tardanza',
    'rrhh_guardar_remuneracion_trabajador', 'rrhh_guardar_trabajador', 'rrhh_justificar_permiso',
    'rrhh_registrar_observacion', 'rrhh_registrar_pago_oficina', 'rrhh_registrar_permiso', 'rrhh_registrar_tareo',
    'rrhh_usar_saldo_horas'];
  v_fn      record;
  v_def     text;
  v_nueva   text;
  v_cerradas text[] := '{}';
begin
  for v_fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_nombres)
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    v_nueva := regexp_replace(v_def, 'exigir_permiso\(''(rrhh\.[a-z_]+|planilla_diaria\.preparar)''',
                              'exigir_permiso_del_puesto(''\1''', 'g');
    if v_nueva <> v_def then
      execute v_nueva;
    end if;
    -- Una versión vieja con otros argumentos que ya no exige nada (la regla de
    -- tardanza de soles por minuto, que solo avisa que ya no se guarda) se deja.
    if v_nueva ~ 'exigir_permiso_del_puesto' then
      v_cerradas := v_cerradas || v_fn.proname::text;
    end if;
  end loop;
  -- Cada nombre de la lista tiene que quedar cerrado: uno que falte es una
  -- puerta que siguió con el atajo sin que nadie lo note.
  if exists (select 1 from unnest(v_nombres) n where n <> all (v_cerradas)) then
    raise exception 'Quedaron con el atajo del administrador: %',
      (select string_agg(n, ', ') from unnest(v_nombres) n where n <> all (v_cerradas));
  end if;
end $$;
