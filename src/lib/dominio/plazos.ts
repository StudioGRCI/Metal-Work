import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * Cada compra contra la fecha que prometió el proveedor (migración
 * 20261126200000). La base da las fechas y los días; las frases viven aquí.
 */

/** Lo que falta de un material de la OC que llegó a medias. */
export type LoQueFalta = { material: string; unidad: string | null; pedido: number; falta: number }

export type PlazoDeCompra = {
  /** La fecha que prometió el proveedor (YYYY-MM-DD); vacía si no la puso. */
  esperada: string | null
  /** Cuándo llegó al almacén, entera o no. En la OS no hay llegada aparte: vuelve conforme. */
  llego_en: string | null
  /** Cuándo quedó completa: el último ingreso que la completó, o la conformidad de la OS. */
  completa_en: string | null
  /** Por fecha de Lima: de la completa, cuánto pasó de lo prometido; de la abierta, hasta hoy. */
  dias_atraso: number | null
  /** Vigente, con la fecha ya pasada y sin llegar completa. */
  atrasada: boolean
  /** De la que llegó a medias, lo que falta; vacío antes de llegar y una vez completa. */
  por_llegar: LoQueFalta[] | null
  /** Lo que el conductor dejó y Almacén todavía no valida: no falta, está por validar. */
  por_validar: boolean
  /**
   * Pasó la fecha que salió en el documento: acepta el motivo del atraso aunque no pase la corregida,
   * para enmendarlo (20261126945000). Solo para quien anota; a los demás, siempre falso.
   */
  acepta_motivo: boolean
}

export type PlazoDeServicio = PlazoDeCompra

/** «1 día», «5 días». */
export function dias(n: number): string {
  return n === 1 ? '1 día' : `${n} días`
}

/**
 * El plazo en una insignia: atrasada, llegó tarde o a tiempo. `null` cuando no
 * hay nada que decir de él (sin fecha prometida, o todavía en plazo: eso lo
 * dice la fecha).
 */
export function estadoDelPlazo(p: PlazoDeCompra | undefined, { servicio = false } = {}): { etiqueta: string; tono: Tono } | null {
  if (!p || !p.esperada || p.dias_atraso == null) return null
  if (p.atrasada) return { etiqueta: `Atrasada ${dias(p.dias_atraso)}`, tono: 'peligro' }
  // Llegó todo: completa, o entero y solo falta que Almacén lo valide (esa espera no es del proveedor).
  if (p.completa_en || (p.por_validar && !p.por_llegar?.length)) {
    const llego = servicio ? 'Volvió' : 'Llegó'
    return p.dias_atraso > 0
      ? { etiqueta: `${llego} con ${dias(p.dias_atraso)} de atraso`, tono: 'aviso' }
      : { etiqueta: `${llego} a tiempo`, tono: 'exito' }
  }
  return null
}

/** Para el filtro «Atrasadas»: lo que se puede filtrar por dirección. */
export const FILTRO_ATRASADAS = 'atrasadas'

/** «faltan 4 de 10 UND»: lo que falta de lo pedido, con su unidad. */
export function faltaDe(l: LoQueFalta, formato: (n: number) => string): string {
  return `faltan ${formato(l.falta)} de ${formato(l.pedido)}${l.unidad ? ` ${l.unidad}` : ''}`
}

// Los motivos del atraso viven en `recorrido.ts`, que no puede importar nada para
// que `node --test` lo cargue sin el alias `@/`; aquí se siguen ofreciendo.
export { MOTIVOS_DE_ATRASO, MOTIVO_DE_ATRASO, motivoDeAtraso, type MotivoDeAtraso } from './recorrido'
