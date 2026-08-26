-- =============================================================================
-- EL COMPRADOR TIENE QUE VER LA ORDEN DE TRABAJO
-- -----------------------------------------------------------------------------
-- Hasta aquí el perfil de Compras no alcanzaba ninguna orden de trabajo, y eso
-- lo dejaba trabajando a ciegas: no podía decir para qué unidad es el material
-- que compra ni contra qué carrocería se emite un servicio de terceros. Le
-- damos la lectura de las órdenes —no los montos, que siguen en costos.ver— y
-- con eso el requerimiento, la orden de compra y la orden de servicio quedan
-- amarrados a la unidad correcta.
--
-- Si la gerencia prefiere que Compras no vea el taller, basta con borrar esta
-- fila; el resto del sistema no depende de ella.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'ordenes.ver'
  from public.roles r
 where r.codigo = 'COMPRADOR'
on conflict do nothing;
