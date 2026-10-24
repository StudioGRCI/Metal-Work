-- El aviso a Almacén de lo que dejó el conductor se lee bien.
--
-- Cuando el conductor deja una compra en el almacén, quien recibe en Almacén
-- recibe «Ingreso por validar: …» con el proveedor y cuántas líneas quedan por
-- validar. Con un proveedor que termina en punto (casi todos: «… S.A.C.») salía
-- «S.A.C.. 1 línea dejadas en el almacén por el conductor.»: dos puntos
-- seguidos y «línea dejadas». Lo vio el auditor de funcionalidad del #159.
--
-- Pasa a «… S.A.C. 1 línea dejada en el almacén por el conductor.»: el punto
-- del proveedor no se repite y «dejada» concuerda con la cantidad. Los avisos
-- ya enviados no se reescriben: son lo que se le dijo a cada uno en su día.
--
-- Igual que en la 20261023140000, la función no se copia entera: se reemplaza
-- solo el fragmento exacto sobre pg_get_functiondef, que conserva security
-- definer, su search_path y sus permisos. Si no está ni el viejo ni el nuevo,
-- la función cambió por otro lado y la migración se detiene sin tocar nada.

do $$
declare
  v_def   text;
  v_viejo text := $v$v_compra.proveedor || '. ' || v_lineas || case when v_lineas = 1 then ' línea' else ' líneas' end
           || ' dejadas en el almacén por el conductor.',$v$;
  v_nuevo text := $v$rtrim(v_compra.proveedor, '.') || '. ' || v_lineas
           || case when v_lineas = 1 then ' línea dejada' else ' líneas dejadas' end
           || ' en el almacén por el conductor.',$v$;
begin
  v_def := replace(pg_get_functiondef('public.marcar_compra_dejada_almacen(uuid)'::regprocedure), E'\r', '');
  if position(v_viejo in v_def) > 0 then
    execute replace(v_def, v_viejo, v_nuevo);
  elsif position(v_nuevo in v_def) = 0 then
    raise exception 'marcar_compra_dejada_almacen cambió: no tiene el aviso a Almacén como lo conoce el repositorio. Revisarla a mano antes de seguir.';
  end if;
end $$;
