-- =============================================================================
-- EL EXCEL CORREGIDO DE LA PLANILLA SE VUELVE A CARGAR
-- -----------------------------------------------------------------------------
-- Recursos Humanos importa la planilla del mes desde su Excel y, cuando corrige
-- el libro —agrega a alguien que faltaba, quita una fila—, las filas se corren.
-- Al volver a cargarlo en la misma planilla para sumar a quien faltaba, la
-- persona nueva cae en la hoja y fila que ya tenía otra de la primera carga, y
-- la importación caía con «Ya existe un registro con esos datos.», sin decir
-- qué hacer. No había nada que hacer: el choque no era de personas.
--
-- La hoja y la fila dicen de dónde salió la boleta en ESE libro; en otro libro
-- del mismo mes la misma fila es otra persona. Lo que no se repite en una
-- planilla es la persona, y eso ya lo cuida `importar_planilla_excel` por el
-- nombre (`clave_nombre_planilla`), dentro de la planilla y en todo el mes.
-- La hoja y la fila siguen sin repetirse dentro de una misma carga.
--
-- El índice nuevo empieza por planilla e importación, que es lo que filtra la
-- comprobación del mismo envío otra vez; el de solo importación queda.
-- =============================================================================

create unique index if not exists idx_planilla_fila_origen_por_carga
  on public.planilla_personas (planilla_id, importacion_id, origen_hoja, fila_origen)
  where fila_origen is not null;

drop index if exists public.idx_planilla_fila_origen;
