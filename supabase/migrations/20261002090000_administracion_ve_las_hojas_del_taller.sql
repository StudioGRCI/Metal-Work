-- Administración revisa los reportes del taller desde el 2026-09-29 (migración
-- `20260929110000`): tiene `produccion.aprobar_reportes`, el aviso «reportes por
-- aprobar» le llega y la política de UPDATE de `ot_actividad_avances` la acepta.
-- Pero no los veía. La lectura de las tareas del taller pasa por una política
-- restrictiva, `alcance_lectura_hojas`, que pregunta `puede_ver_hoja_de_area`, y
-- esa función no contaba a quien aprueba: en producción, Administración veía 0 de
-- las 2 tareas y 0 del único reporte. Y la revisión, sin la fila a la vista,
-- afectaba cero filas sin error: el botón decía «listo» y no aprobaba nada.
--
-- Quien aprueba un reporte tiene que poder leerlo. Se suma
-- `produccion.aprobar_reportes` a la función. Los otros dos roles con ese permiso,
-- Jefatura de Producción y Jefatura de Taller, ya entraban por
-- `produccion.cualquier_area`: el cambio solo alcanza a Administración, y solo
-- para leer. Escribir en la hoja sigue pidiendo lo mismo que antes.

create or replace function public.puede_ver_hoja_de_area(p_area uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select public.es_admin() or public.tiene_permiso('diseno.planos')
    or public.tiene_permiso('produccion.cualquier_area')
    or public.tiene_permiso('supervision.general')
    or public.tiene_permiso('produccion.aprobar_reportes')
    or (public.tiene_permiso('produccion.ver') and public.puede_hoja_de_area(p_area));
$$;
