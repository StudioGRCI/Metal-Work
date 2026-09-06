-- =============================================================================
-- TESORERÍA VE A QUIÉN LE COBRA
-- -----------------------------------------------------------------------------
-- Con los pagos ya en su sitio, Tesorería (perfil COSTOS) entraba a la
-- cotización para anotar el adelanto y le salía **404, página no encontrada**.
-- La cotización existe, tiene permiso para verla y hasta para aprobarla: lo que
-- no tenía era `clientes.ver`.
--
-- La consulta de la cotización trae al cliente con `!inner` —razón social y RUC
-- salen en la cabecera y en el papel—, así que sin permiso sobre `clientes` la
-- fila entera desaparece y la pantalla concluye que el documento no existe. Es
-- la falla de siempre con otro disfraz: no da error, miente con un 404.
--
-- Y de fondo es de cajón: quien cobra tiene que ver a quién le cobra.
--
-- Se le da también a CALIDAD y ALMACENERO no: solo a quien lo necesita para
-- este trabajo. Aquí, Tesorería.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'clientes.ver'
  from public.roles r
 where r.codigo = 'COSTOS'
on conflict do nothing;
