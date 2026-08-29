-- =============================================================================
-- LA CUENTA VUELVE A CERO TRAS LAS PRUEBAS
-- -----------------------------------------------------------------------------
-- Comprobar una pantalla de cotización obliga a crear cotizaciones, y cada una
-- se lleva un número de la serie. Las de prueba se borran desde la aplicación
-- —son borradores, y un borrador sí se borra— pero el correlativo no vuelve
-- solo: la primera cotización real habría salido con el número 3 o el 4.
--
-- Es el mismo UPDATE con guarda de la migración 049, y la guarda es lo que
-- importa: solo vuelve a cero si no queda ningún documento con la numeración
-- nueva. Volver a cero con documentos vivos repetiría números, que es peor que
-- el hueco que se está arreglando.
-- =============================================================================

update public.series_documentarias
   set correlativo_actual = 0
 where tipo::text in ('COTIZACION', 'ORDEN_TRABAJO')
   and correlativo_actual > 0
   -- Los de la numeración nueva empiezan en cero (0001-2026); los del talonario
   -- viejo, en 2 y en 3. Alcanza con el primer dígito para distinguirlos.
   and not exists (select 1 from public.cotizaciones c where c.numero like '0%')
   and not exists (select 1 from public.ordenes_trabajo o where o.numero like '0%');
