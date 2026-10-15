-- =============================================================================
-- LA COTIZACIÓN LA VEN ADMINISTRACIÓN, GERENCIA, TESORERÍA Y CONTABILIDAD
-- -----------------------------------------------------------------------------
-- Gerencia, el 2026-10-15: «la OT solo la visualiza Diseño, y la cotización la
-- visualizan Administración, Gerencia, Tesorería y Contabilidad», porque según
-- lo que diga la cotización Contabilidad factura y Tesorería cobra.
-- Contabilidad y Tesorería la abren desde la 20261015124000, solo la aprobada.
-- Ventas la sigue viendo porque es quien la hace.
--
-- Hasta hoy también la veían Diseño Líder y Supervisión General
-- (`cotizaciones.ver_pdf_comercial`). Con la cotización dejan de ver lo que
-- delata su precio: el margen de cada OT (venta menos costo) y el presupuesto
-- de costo, que sale del precio sin IGV ÷ 1.15. Es la misma regla que ya tenía
-- Costos y Materiales. Supervisión General sigue viendo el costo de cada OT
-- (`costos.ver`).
--
-- Es un DELETE: el conector de producción no lo deja pasar, va en el archivo
-- que se pega en el SQL Editor. Volver a correrlo no hace nada.
-- =============================================================================

delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo in ('DISENO_LIDER', 'SUPERVISOR_GENERAL')
   and rp.permiso_codigo = 'cotizaciones.ver_pdf_comercial';
