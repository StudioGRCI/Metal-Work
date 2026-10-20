-- =============================================================================
-- LO DE RR. HH. LO CAMBIA RR. HH.; EL ADMINISTRADOR SOLO MIRA
-- -----------------------------------------------------------------------------
-- StudioGRCI, 2026-10-20: «quien realiza el costeo y ve el personal y hace
-- ediciones o cambios debe ser rrhh no administracion en todo caso admin solo
-- visualizaria». La migración 20261020165000 lo aplicó al DNI y al costo por
-- hora de las cuentas; esta lo lleva a todo lo que escribe Recursos Humanos: la
-- ficha del personal, su costo y su remuneración, el tareo, los permisos, las
-- observaciones, los pagos de la oficina, la regla de tardanza, las horas
-- extras, la planilla diaria, las planillas del mes y el visto de RR. HH. al
-- reporte diario del supervisor (y su anulación), que manda las horas al costeo.
--
-- Esas funciones exigen su permiso con `exigir_permiso`, que deja pasar al
-- administrador del sistema (`es_admin()`) sin mirar el permiso. Aquí cambian a
-- `exigir_permiso_del_puesto`, igual pero sin ese atajo: el administrador sigue
-- leyendo todo (las pantallas y las funciones de lectura no cambian) y ya no
-- guarda, anula ni cierra nada de RR. HH. Las políticas de las planillas del mes
-- ya pedían `rrhh.gestionar_planillas` sin el atajo; las de lectura, en cambio,
-- no lo dejaban mirar: aquí lo aceptan (apartado final).
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
  if public.tiene_permiso(p_permiso) then
    return;
  end if;
  -- Al administrador se le dice por qué no, que él sí lo ve; a los demás, lo
  -- mismo que les diría `exigir_permiso`.
  if public.es_admin() then
    raise exception 'Esto lo hace Recursos Humanos: el administrador lo ve, pero no lo cambia.'
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'No tiene el permiso % para realizar esta operación', p_permiso
    using errcode = 'insufficient_privilege';
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
    'rrhh_usar_saldo_horas', 'validar_reporte_diario', 'observar_reporte_diario', 'anular_reporte_diario'];
  -- La llamada vieja y la nueva. En el reporte diario solo cambia el lado de
  -- RR. HH. (el de Gerencia es de Gerencia), y la anulación dejaba pasar al
  -- administrador escrito a mano: `es_admin() or tiene_permiso('rrhh.personal')`.
  v_viejo constant text := 'exigir_permiso\(''(rrhh\.[a-z_]+|planilla_diaria\.preparar|reporte_diario\.validar_rrhh)''|es_admin\(\)\s+or\s+public\.tiene_permiso\(''rrhh\.';
  v_nuevo constant text := 'exigir_permiso_del_puesto|if not public\.tiene_permiso\(''rrhh\.personal''\) then';
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
    v_nueva := regexp_replace(v_def, 'exigir_permiso\(''(rrhh\.[a-z_]+|planilla_diaria\.preparar|reporte_diario\.validar_rrhh)''',
                              'exigir_permiso_del_puesto(''\1''', 'g');
    v_nueva := regexp_replace(v_nueva, '\(public\.es_admin\(\)\s+or\s+public\.tiene_permiso\(''(rrhh\.[a-z_]+)''\)\)',
                              'public.tiene_permiso(''\1'')', 'g');
    if v_nueva <> v_def then
      execute v_nueva;
    end if;
    -- Una versión vieja con otros argumentos que ya no exige nada (la regla de
    -- tardanza de soles por minuto, que solo avisa que ya no se guarda) se deja.
    if v_nueva ~ v_nuevo and v_nueva !~ v_viejo then
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

-- ------------------------------------------- el administrador mira las planillas
-- «Admin solo visualizaría»: las planillas del mes se leían solo con
-- `rrhh.ver_planillas`, sin el atajo, y el administrador veía la lista vacía
-- en /rrhh, sin aviso, y un error en Cuentas por pagar. Ahora las lee, como lee
-- el resto de RR. HH.; escribirlas sigue siendo de RR. HH.
drop policy if exists planillas_lectura on public.planillas;
create policy planillas_lectura on public.planillas for select to authenticated
  using (public.es_admin() or public.tiene_permiso('rrhh.ver_planillas'));
drop policy if exists planilla_personas_lectura on public.planilla_personas;
create policy planilla_personas_lectura on public.planilla_personas for select to authenticated
  using (public.es_admin() or public.tiene_permiso('rrhh.ver_planillas'));
drop policy if exists planilla_distribuciones_lectura on public.planilla_distribuciones;
create policy planilla_distribuciones_lectura on public.planilla_distribuciones for select to authenticated
  using (public.es_admin() or public.tiene_permiso('rrhh.ver_planillas'));

do $$
declare
  v_oid oid;
  v_def text;
begin
  for v_oid in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'resumen_planilla_por_ot'
  loop
    v_def := pg_get_functiondef(v_oid);
    if v_def ~ 'if not \(public\.tiene_permiso\(''rrhh\.ver_planillas''\)' then
      execute regexp_replace(v_def, 'if not \(public\.tiene_permiso\(''rrhh\.ver_planillas''\)',
                             'if not (public.es_admin() or public.tiene_permiso(''rrhh.ver_planillas'')');
    end if;
  end loop;
end $$;
