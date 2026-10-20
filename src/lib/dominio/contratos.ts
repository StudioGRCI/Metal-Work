/**
 * El contrato que se adjunta a un subcontrato (migración 20261020192000). Puro, sin consultas: lo usan el servidor y el
 * navegador. Las mismas cifras las exige la base.
 */

/** Lo que puede pesar un contrato. */
export const MAXIMO_MB_CONTRATO = 10

/** Lo que acepta el bucket, con la extensión que lleva la ruta. */
export const TIPOS_CONTRATO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export const ACEPTA_CONTRATO = Object.keys(TIPOS_CONTRATO).join(',')

/** Por qué no se puede subir ese archivo como contrato, o null si se puede. */
export function problemaDeContrato(archivo: { type: string; size: number }): string | null {
  if (!TIPOS_CONTRATO[archivo.type]) return 'El contrato va en PDF o en foto (JPG, PNG o WEBP).'
  if (archivo.size > MAXIMO_MB_CONTRATO * 1024 * 1024) return `El contrato pesa más de ${MAXIMO_MB_CONTRATO} MB.`
  return null
}

/** Un contrato adjunto, con su enlace temporal para abrirlo. El vigente es el último. */
export type ContratoAdjunto = {
  id: string
  archivo_ruta: string
  archivo_nombre: string | null
  creado_en: string
  /** Quién lo adjuntó; null si su ficha no se puede leer. */
  subido_por: string | null
  enlace: string | null
}
