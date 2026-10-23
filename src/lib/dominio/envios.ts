/**
 * Lo que una ventana puede preguntar a la base al volver a abrirse tras «No
 * llegó la respuesta»: si aquel envío entró (`useIdDelEnvio`, `consultarEnvio`).
 * Cada clave es una tabla donde el id del envío queda como id de la fila; la
 * transferencia, como `origen_id` de sus dos movimientos.
 */
export const CLAVES_DEL_ENVIO = [
  'requerimiento',
  'orden_compra',
  'orden_servicio',
  'subcontrato',
  'contrato_subcontrato',
  'recibo_honorarios',
  'pago_recibo',
  'documento_compra',
  'documento_servicio',
  'factura_venta',
  'cobro_factura',
  'pago_factura',
  'toma_de_la_boleta',
  'pago_compra',
  'devolucion_compra',
  'pago_servicio',
  'pago_parte_boleta',
  'nota_credito',
  'reembolso_nota_credito',
  'movimiento_almacen',
  'movimiento_caja',
  'transferencia_caja',
] as const

export type ClaveDelEnvio = (typeof CLAVES_DEL_ENVIO)[number]
