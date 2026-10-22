import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** De dónde nace la orden de compra. */
export const ORIGEN_COMPRA: Record<string, Def> = {
  REQUERIMIENTO: { etiqueta: 'Requerimiento', tono: 'neutro', descripcion: 'Nace de la solicitud de materiales de una OT.' },
  DIRECTA: { etiqueta: 'Directa', tono: 'info', descripcion: 'Logística compra para el almacén, sin requerimiento.' },
  // En la base va como directa (sin la solicitud de una OT), pero compra insumos de uno o varios RQ.
  RQ: { etiqueta: 'De RQ', tono: 'neutro', descripcion: 'Compra insumos de uno o varios requerimientos, cada uno con su código interno.' },
}

/**
 * En qué va el recojo del conductor. Sin recojo, la entrega la marca Logística.
 * «En recojo» lo marca él con «Salgo a recoger» (migración 20261013121000).
 */
export const RECOJO_COMPRA: Record<string, Def> = {
  POR_RECOGER: { etiqueta: 'Pendiente de recojo', tono: 'aviso', descripcion: 'El conductor tiene que ir al proveedor.' },
  EN_RECOJO: { etiqueta: 'En recojo', tono: 'info', descripcion: 'El conductor salió a recogerla al proveedor.' },
  RECOGIDO: { etiqueta: 'Recogida', tono: 'info', descripcion: 'El conductor la tiene y va hacia el almacén.' },
  DEJADO: { etiqueta: 'En almacén', tono: 'exito', descripcion: 'El conductor la dejó; Almacén valida el ingreso.' },
}

/** El estado del servicio. La aprobación de Gerencia va aparte, en `APROBACION_COMPRA`. */
export const ESTADO_SERVICIO: Record<string, Def> = {
  EMITIDA: { etiqueta: 'Emitida', tono: 'neutro', descripcion: 'Emitida; se inicia cuando Gerencia la aprueba.' },
  EN_EJECUCION: { etiqueta: 'En ejecución', tono: 'info', descripcion: 'El proveedor está haciendo el trabajo.' },
  CONFORME: { etiqueta: 'Conforme', tono: 'exito', descripcion: 'El trabajo volvió bien: Tesorería puede pagar.' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro', descripcion: 'Anulada con su motivo.' },
}

export type ValidacionIngreso = 'PENDIENTE' | 'OBSERVADO' | 'VALIDADO' | null

/**
 * Una compra deja una fila por línea en el almacén: PENDIENTE si alguna espera
 * a Almacén; si no, OBSERVADO si alguna se observó; VALIDADO si todas entraron.
 */
export function validacionDeCompra(estados: string[]): ValidacionIngreso {
  if (estados.length === 0) return null
  if (estados.includes('PENDIENTE')) return 'PENDIENTE'
  if (estados.includes('OBSERVADO')) return 'OBSERVADO'
  return 'VALIDADO'
}

/** Lo que hizo Almacén con lo que dejó el conductor, una vez dejado. */
export const VALIDACION_INGRESO: Record<string, Def> = {
  PENDIENTE: { etiqueta: 'Por validar en almacén', tono: 'aviso', descripcion: 'El conductor la dejó; Almacén tiene que validar el ingreso en su kardex.' },
  OBSERVADO: { etiqueta: 'Observada por Almacén', tono: 'peligro', descripcion: 'Almacén no la recibió completa: lee su observación en el kardex.' },
  VALIDADO: { etiqueta: 'Validada por Almacén', tono: 'exito', descripcion: 'Entró al kardex y ya se puede despachar.' },
}

/** Qué le toca hacer ahora a quien mira una compra, en una frase. */
export function situacionCompra(c: {
  aprobacion: string
  recojo: string | null
  entregado_almacen_en: string | null
  /** Solo cuando se sabe: PENDIENTE, OBSERVADO o VALIDADO. */
  validacion?: string | null
}): { etiqueta: string; tono: Tono } {
  if (c.aprobacion === 'POR_APROBAR') return { etiqueta: 'Espera a Gerencia', tono: 'aviso' }
  if (c.aprobacion === 'RECHAZADA') return { etiqueta: 'Rechazada', tono: 'peligro' }
  if (c.aprobacion === 'ANULADA') return { etiqueta: 'Anulada', tono: 'peligro' }
  if (c.recojo === 'DEJADO' && c.validacion && VALIDACION_INGRESO[c.validacion]) {
    const v = VALIDACION_INGRESO[c.validacion]
    return { etiqueta: v.etiqueta, tono: v.tono }
  }
  if (c.recojo) {
    const r = RECOJO_COMPRA[c.recojo]
    return { etiqueta: r?.etiqueta ?? c.recojo, tono: r?.tono ?? 'neutro' }
  }
  if (c.entregado_almacen_en) return { etiqueta: 'Entregada a Almacén', tono: 'exito' }
  return { etiqueta: 'Por mandar a recojo', tono: 'neutro' }
}

/** Una compra se puede mandar a recojo si ya se puede enviar y nadie la llevó todavía. */
export function puedeIrARecojo(c: { aprobacion: string; recojo: string | null; entregado_almacen_en: string | null }) {
  return (c.aprobacion === 'APROBADA' || c.aprobacion === 'NO_REQUERIDA') && !c.recojo && !c.entregado_almacen_en
}

/**
 * La guía de remisión que Contabilidad carga en la gestión de compras
 * (migración 20261015140000): un PDF en este bucket, con la ruta
 * compra/{oc}/{guía}.pdf que la base comprueba.
 */
export const BUCKET_GUIAS_REMISION = 'guias-remision'
export const MAXIMO_MB_GUIA = 10

export function rutaGuiaRemision(compraId: string, guiaId: string) {
  return `compra/${compraId}/${guiaId}.pdf`
}

/** Serie y número como figuran en la guía: T001-00000123. La base exige lo mismo. */
export const NUMERO_GUIA = /^[A-Z0-9]{1,4}-[0-9]{1,10}$/

export function normalizarNumeroGuia(texto: string) {
  return texto.trim().replace(/\s+/g, '').toUpperCase()
}
