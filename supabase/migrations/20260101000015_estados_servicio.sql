-- =============================================================================
-- VALORES NUEVOS PARA LAS ÓRDENES DE SERVICIO
-- -----------------------------------------------------------------------------
-- Postgres no deja usar un valor de enumeración recién agregado dentro de la
-- misma transacción que lo agrega, así que estos valores van solos, en su
-- propio archivo. La migración siguiente ya los puede usar.
-- =============================================================================

-- El subcontrato tiene su propio documento, con su propio correlativo.
alter type public.tipo_correlativo add value if not exists 'ORDEN_SERVICIO';

-- Entre pedir el servicio y pagarlo hay dos momentos que hoy no se distinguen:
-- cuando el proveedor lo está haciendo, y cuando el trabajo volvió y se le dio
-- la conformidad. Sin ese segundo momento no hay forma de saber si lo que se
-- va a pagar llegó bien.
alter type public.estado_servicio_tercero add value if not exists 'EN_EJECUCION' after 'SOLICITADO';
alter type public.estado_servicio_tercero add value if not exists 'CONFORME'     after 'EJECUTADO';
