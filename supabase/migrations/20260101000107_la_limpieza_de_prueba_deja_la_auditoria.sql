-- =============================================================================
-- LA LIMPIEZA DE UNA PRUEBA DEJA LA AUDITORÍA
-- -----------------------------------------------------------------------------
-- La 105 hizo que `pruebas_limpiar` se llevara, además de los datos
-- inventados, su rastro en `audit_log`. Cuando hubo que borrar a mano las
-- pruebas del piloto (2026-09-14) el usuario eligió lo contrario: la auditoría
-- se queda, porque es la constancia de que se crearon y de que se borraron a
-- propósito, con quién y cuándo; sin ella, si alguien pregunta por un dato que
-- existió, no hay forma de responder. Los dos caminos de limpiar tienen que
-- decir lo mismo, y dijo «se queda».
--
-- Se quita solo esa sentencia. El resto de la limpieza no cambia: se sigue
-- negando si una fila real cuelga de un dato de prueba, apaga los candados
-- solo dentro de su transacción y los vuelve a encender.
--
-- Se edita la definición que está viva, no se reescribe entera: así no se
-- pisa nada que otra migración le haya cambiado. Si la sentencia no está
-- exactamente una vez, no se toca y se dice.
-- =============================================================================

do $$
declare
  v_def   text;
  v_nueva text;
  v_veces int;
  v_patron constant text :=
    'delete from public\.audit_log a\s+where a\.registro_id in \(select f\.fila_id from public\.pruebas_filas f where f\.lote_id = p_lote\);';
begin
  select pg_get_functiondef('public.pruebas_limpiar(uuid)'::regprocedure) into v_def;

  -- Ya aplicada: no hay nada que quitar.
  if v_def !~ 'audit_log' then
    return;
  end if;

  select count(*) into v_veces from regexp_matches(v_def, v_patron, 'g');
  if v_veces <> 1 then
    raise exception 'pruebas_limpiar borra la auditoría de otra forma (% coincidencias): revisarla a mano', v_veces;
  end if;

  v_nueva := regexp_replace(
    v_def,
    v_patron,
    '-- La auditoría de la prueba se queda (migración 107): es la constancia de que se creó y se borró.');

  -- El comentario que anunciaba el borrado de la auditoría, si vino del archivo.
  v_nueva := replace(v_nueva, '-- 5. El rastro de auditoría de la prueba, incluido el que dejó este borrado.', '');

  execute v_nueva;
end $$;

comment on function public.pruebas_limpiar is
  'Borra todo lo que creó un lote de prueba y lo da por limpiado. Su auditoría se queda (migración 107). Se niega si alguna fila real cuelga de un dato de prueba.';

-- =============================================================================
-- COMPROBACIONES
-- =============================================================================
do $$
begin
  if pg_get_functiondef('public.pruebas_limpiar(uuid)'::regprocedure) ~ 'delete from public\.audit_log' then
    raise exception 'pruebas_limpiar sigue borrando la auditoría';
  end if;
  if has_function_privilege('authenticated', 'public.pruebas_limpiar(uuid)', 'execute')
     or has_function_privilege('anon', 'public.pruebas_limpiar(uuid)', 'execute') then
    raise exception 'pruebas_limpiar quedó al alcance de una cuenta con sesión';
  end if;
end $$;
