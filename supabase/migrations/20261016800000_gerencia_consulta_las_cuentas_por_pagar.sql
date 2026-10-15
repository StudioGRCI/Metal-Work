-- =============================================================================
-- GERENCIA CONSULTA LAS CUENTAS POR COBRAR Y POR PAGAR
-- -----------------------------------------------------------------------------
-- Gerencia pidió el 2026-10-15 ver en su menú las Cuentas por cobrar y las
-- Cuentas por pagar de Tesorería, para consultarlas. Las dos pantallas piden
-- `tesoreria.ver_documentos`, que Gerencia ya tiene, y la de cobrar ya le
-- mostraba todo: las facturas de venta y sus cobros los lee con ese permiso.
--
-- La de pagar no: cada factura de compra, sus OC, sus pagos con su voucher y
-- su PDF se leen con `adquisiciones.ver` (políticas de `adquisiciones`,
-- `adquisiciones_ordenes_compra`, `pagos_adquisicion`, el bucket
-- `comprobantes-financieros` y `adquisiciones_control`), que Gerencia no tenía.
-- La pantalla la dejaba entrar y le decía «No hay facturas por pagar» aunque
-- las hubiera: el RLS escondía las filas sin ningún error.
--
-- `adquisiciones.ver` es solo lectura: registrar una factura pide
-- `adquisiciones.registrar` (Contabilidad) y pagarla
-- `tesoreria.registrar_pagos` (Tesorería). Gerencia no recibe ninguno de los
-- dos: consulta, no registra ni paga. Con el mismo permiso abre también
-- Adquisiciones (`/adquisiciones`) por su dirección, en lectura.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'adquisiciones.ver'
  from public.roles r
 where r.codigo = 'GERENTE'
on conflict do nothing;
