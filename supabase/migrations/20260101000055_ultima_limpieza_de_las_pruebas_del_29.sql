-- =============================================================================
-- ÚLTIMA LIMPIEZA DE LAS PRUEBAS DEL 29
-- -----------------------------------------------------------------------------
-- Comprobar la pantalla de cotización de venta obligó a crear cotizaciones y a
-- pasar alguna a costeo para ver qué se muestra en cada estado. Los borradores
-- se borraron desde la aplicación —un borrador sí se borra—, pero la que quedó
-- en EN_COSTEO ya no: el guardián solo deja borrar borradores, y así tiene que
-- seguir para los documentos de verdad.
--
-- Se va esa, acotada por número, estado y fecha, y el correlativo vuelve a cero
-- con la misma guarda de siempre: solo si no queda ningún documento con la
-- numeración nueva.
-- =============================================================================

alter table public.cotizaciones disable trigger trg_cotizacion_bloquear_borrado;

delete from public.cotizaciones
 where numero = '0001-2026'
   and estado = 'EN_COSTEO'
   and creado_en::date = date '2026-08-29'
   and not exists (select 1 from public.ordenes_trabajo o where o.cotizacion_id = cotizaciones.id);

alter table public.cotizaciones enable trigger trg_cotizacion_bloquear_borrado;

update public.series_documentarias
   set correlativo_actual = 0
 where tipo::text in ('COTIZACION', 'ORDEN_TRABAJO')
   and correlativo_actual > 0
   and not exists (select 1 from public.cotizaciones c where c.numero like '0%')
   and not exists (select 1 from public.ordenes_trabajo o where o.numero like '0%');
