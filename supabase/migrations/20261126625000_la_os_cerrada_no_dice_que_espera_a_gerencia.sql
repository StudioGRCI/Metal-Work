-- =============================================================================
-- LA OS CERRADA NO DICE QUE ESPERA A GERENCIA
-- =============================================================================
-- «En ejecución» sobre una orden de servicio anulada o ya conforme respondía
-- «La orden de servicio … se inicia cuando Gerencia la aprueba» (migración
-- 20261012111000). Es falso: Gerencia ya la aprobó, o no hay nada que aprobar,
-- y Logística se quedaba esperando una aprobación que no iba a llegar. Ahora
-- dice cómo está: anulada, con conformidad, rechazada o esperando a Gerencia.
--
-- Solo cambia ese mensaje. El resto de `avanzar_orden_servicio` queda igual:
-- se toma su texto vivo y se reemplaza esa línea, como en 20261026160000, para
-- no pisar lo que otras migraciones le hayan cambiado. Idempotente: si el texto
-- ya no está (porque se aplicó), no hace nada.
do $$
declare
  v_def text;
  v_viejo constant text :=
    $v$      raise exception 'La orden de servicio % se inicia cuando Gerencia la aprueba.', v_os.numero using errcode = 'check_violation';$v$;
  v_nuevo constant text :=
    $v$      if v_os.estado = 'ANULADA' then
        raise exception 'La orden de servicio % está anulada: ya no se ejecuta.', v_os.numero using errcode = 'check_violation';
      elsif v_os.estado = 'CONFORME' then
        raise exception 'La orden de servicio % ya tiene conformidad: no vuelve a ejecución.', v_os.numero using errcode = 'check_violation';
      elsif v_os.aprobacion = 'RECHAZADA' then
        raise exception 'La orden de servicio % fue rechazada por Gerencia: emite otra si todavía hace falta.', v_os.numero using errcode = 'check_violation';
      end if;
      raise exception 'La orden de servicio % se inicia cuando Gerencia la aprueba.', v_os.numero using errcode = 'check_violation';$v$;
begin
  select replace(pg_get_functiondef(p.oid), E'\r', '') into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'avanzar_orden_servicio';
  if v_def is null then
    raise exception 'No está avanzar_orden_servicio: esta migración va después de 20261012111000.';
  end if;
  if position(v_nuevo in v_def) > 0 then
    return;
  end if;
  if position(v_viejo in v_def) = 0 then
    raise exception 'avanzar_orden_servicio ya no tiene el mensaje que esta migración corrige: revísala a mano.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
