-- =============================================================================
-- SUPERVISIÓN, ALMACÉN Y REQUERIMIENTOS DEJAN LOS PERMISOS DE LA OT
-- -----------------------------------------------------------------------------
-- Desde la migración 20261016110000 estos cuatro puestos trabajan por código
-- interno y la aplicación ya no les abre la OT, que es un documento de Diseño
-- (decisión de Gerencia del 2026-10-15). La base todavía les dejaba leerla, y
-- al supervisor, abrir una OT desde el taller y cambiarle el estado. Gerencia
-- pidió cerrarlo también en la base el mismo día.
--
-- Qué dejan de poder, y por qué no se pierde nada de su trabajo:
--
--   * Leer la OT y todo lo que cuelga de ella (`puede_ver_orden` es
--     `ordenes.ver`): tareas con foto, verificación, ficha, bitácora. El
--     supervisor reporta por código en su reporte diario; los vistos buenos de
--     la verificación no se habían marcado nunca en producción.
--   * Abrir una OT desde el taller y cambiarle el estado
--     (`ordenes.abrir_taller`, `ordenes.cambiar_estado`): sin leerla, los dos
--     fallaban en la bitácora de la OT, y la OT ya nace del código interno.
--   * Requerimientos ya no manda solicitudes a Tesorería desde la OT: la
--     revisión para la salida va en el vehículo (`registro_vehiculo_revisiones`).
--   * Almacén deja de ver en «Atención» los pedidos de material de una OT del
--     circuito anterior al requerimiento por insumo; en producción hay uno, del
--     2026-09-29. Su atención, el kardex y la salida van por requerimiento.
--   * Supervisión general deja de ver las OT de cada cliente y de cada unidad,
--     y el informe semanal de Diseño, que se arma por OT, le sale vacío: sigue
--     cada unidad por su código en «Seguimiento por código».
--
-- Lo que trabajan por código (planos, etapas, materiales, requerimientos,
-- kardex, vehículos, reporte diario) no pasa por la OT y sigue igual: los
-- checks 330 a 363 pasan sin estos permisos.
--
-- Es un DELETE: el conector de producción no lo deja pasar, y lo pega Gerencia
-- en el SQL Editor. Volver a correrlo no borra nada más.
-- =============================================================================

delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo in ('SUPERVISOR', 'SUPERVISOR_GENERAL', 'ALMACENERO', 'REQUERIMIENTOS')
   and rp.permiso_codigo in ('ordenes.ver', 'ordenes.listar', 'ordenes.abrir_taller', 'ordenes.cambiar_estado');
