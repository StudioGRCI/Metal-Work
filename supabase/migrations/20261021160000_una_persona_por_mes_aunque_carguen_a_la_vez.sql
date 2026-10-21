-- =============================================================================
-- UNA PERSONA POR MES, AUNQUE SE CARGUEN DOS PLANILLAS A LA VEZ
-- -----------------------------------------------------------------------------
-- Una persona se cuenta una sola vez en el mes: si ya está en la planilla de
-- taller, no entra en la administrativa (`importar_planilla_excel`, migración
-- 20261001203000). Pero esa comprobación solo bloqueaba la planilla de destino:
-- si Recursos Humanos importaba el mismo Excel en la de taller y en la
-- administrativa al mismo tiempo —dos pestañas, dos personas de la oficina—,
-- cada carga miraba antes de que la otra terminara y la persona quedaba en las
-- dos, con su costo dos veces en el costeo del mes. Lo encontró la auditoría
-- del arreglo del Excel corregido (#144), con dos cargas reales a la vez.
--
-- Ahora la carga, después de bloquear su planilla, toma también un bloqueo del
-- mes: la segunda espera a que la primera termine y entonces ve a la persona.
-- Siempre en el mismo orden (planilla, después mes), así dos cargas no se
-- esperan una a la otra para siempre.
--
-- Se cambia sobre la definición viva, como en la 20261020167000, para no
-- deshacer lo que esa migración le cambió al permiso; si ya tiene el bloqueo,
-- no se toca.
-- =============================================================================

do $$
declare
  v_def   text := pg_get_functiondef('public.importar_planilla_excel(uuid, uuid, jsonb)'::regprocedure);
  v_ancla constant text := 'if not found then raise exception ''La planilla no existe.''; end if;';
  v_nueva text;
begin
  if v_def ~ 'planilla-periodo:' then
    return;
  end if;
  if position(v_ancla in v_def) = 0 then
    raise exception 'importar_planilla_excel cambió: no se encontró dónde poner el bloqueo del mes.';
  end if;
  v_nueva := replace(v_def, v_ancla, v_ancla || E'\n'
    || '  -- El mes entero, para que dos cargas a la vez en planillas distintas no' || E'\n'
    || '  -- dejen a la misma persona en las dos (migración 20261021160000).' || E'\n'
    || '  perform pg_advisory_xact_lock(hashtextextended(''planilla-periodo:'' || v_periodo::text, 0));');
  execute v_nueva;
end;
$$;
