/**
 * Los datos de Metal Work que van impresos en los documentos que salen a
 * terceros. Copiados de la orden de compra OC-5572 (agosto de 2026), que es el
 * modelo que la empresa pidió seguir: ahí están el «Facturar a», los correos
 * donde se recibe la factura y el teléfono de consultas.
 */
export const EMPRESA = {
  razonSocial: 'METAL WORK PERU S.A.C.',
  ruc: '20601538840',
  direccion: 'Carretera Huanchaco, El Trópico Mz. 4, Lt. 1, Huanchaco, Trujillo, La Libertad',
  telefonos: '940 843 031 - 980 926 670',
  /** Adonde el proveedor manda la factura de una orden de compra. */
  correosFactura: ['logistica@metalworkperu.com', 'tesoreria@metalworkperu.com'],
  /** A quién llama el proveedor si tiene un problema con la orden. */
  consultas: { area: 'Administración', telefono: '944 448 912', correo: 'administracion@metalworkperu.com' },
} as const
