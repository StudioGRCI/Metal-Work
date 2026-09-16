-- =============================================================================
-- ADMINISTRACIÓN LIBERA LA SALIDA
-- -----------------------------------------------------------------------------
-- `tesoreria.liberar` —confirmar que el cliente está al día para que la unidad
-- salga— lo tenían Costos y Gerencia. En la casa también lo hace
-- Administración, que es quien factura y cobra: sin el permiso, una orden
-- terminada esperaba a que Gerencia entrara a liberarla. Decidido por el
-- usuario el 2026-09-16.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'tesoreria.liberar'
  from public.roles r
 where r.codigo = 'ADMINISTRACION'
on conflict do nothing;
