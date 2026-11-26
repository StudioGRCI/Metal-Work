import type { Tono } from '@/components/ui/etiqueta-estado'
import { fecha } from '@/lib/format'

/**
 * Lo que Diseño entrega por código interno (plan 6, entrega 6.1; migración
 * 20261126600000): cinco puntos con hecho o pendiente, y la fecha comprometida
 * del plano de cada área contra la real. Puro: lo usan Diseño, Códigos
 * internos (Administración y Gerencia) y Planos y etapas (Supervisión).
 */

export type SituacionDelPlano = 'A_TIEMPO' | 'TARDE' | 'PENDIENTE' | 'VENCIDO' | 'SIN_FECHA' | 'ENTREGADO_SIN_FECHA'

/** El plano de un área (Maestranza o Producción): para cuándo se comprometió y cuándo llegó. */
export type CompromisoDelPlano = {
  area: string
  areaNombre: string
  /** El primer inicio de la etapa de Diseño en esa área (YYYY-MM-DD). */
  comprometido: string | null
  /** Cuando subió el primer plano de esa área. */
  entregadoEn: string | null
  situacion: SituacionDelPlano
  /** Días de atraso (tarde o vencido) o los que faltan (pendiente). */
  dias: number | null
}

export type LoQueDebeDiseno = {
  codigo: string
  tieneOt: boolean
  fichaEn: string | null
  planos: number
  planosEn: string | null
  materiales: number
  materialesEn: string | null
  etapas: number
  etapasEn: string | null
  dxf: number
  dxfEn: string | null
  compromisos: CompromisoDelPlano[]
}

export type PuntoDeDiseno = {
  clave: 'ficha' | 'planos' | 'materiales' | 'etapas' | 'dxf'
  etiqueta: string
  hecho: boolean
  /** Lo que se dice al lado: cuántos y desde cuándo, o qué falta. */
  detalle: string
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Los cinco puntos, en el orden en que Diseño los entrega. */
export function puntosDeDiseno(d: LoQueDebeDiseno | undefined): PuntoDeDiseno[] {
  const desde = (en: string | null) => (en ? ` desde el ${fecha(en)}` : '')
  return [
    {
      clave: 'ficha',
      etiqueta: 'Ficha técnica',
      hecho: Boolean(d?.fichaEn),
      detalle: d?.fichaEn
        ? `Adjunta a la OT el ${fecha(d.fichaEn)}`
        : d?.tieneOt
          ? 'Falta adjuntarla a la OT'
          : 'Se adjunta cuando la unidad tenga su OT',
    },
    {
      clave: 'planos',
      etiqueta: 'Planos',
      hecho: (d?.planos ?? 0) > 0,
      detalle: d && d.planos > 0 ? `${plural(d.planos, 'vigente', 'vigentes')}${desde(d.planosEn)}` : 'Ninguno cargado',
    },
    {
      clave: 'materiales',
      etiqueta: 'Materiales',
      hecho: (d?.materiales ?? 0) > 0,
      detalle: d && d.materiales > 0 ? `${plural(d.materiales, 'línea', 'líneas')} en la lista${desde(d.materialesEn)}` : 'Falta la lista',
    },
    {
      clave: 'etapas',
      etiqueta: 'Etapas',
      hecho: (d?.etapas ?? 0) > 0,
      detalle: d && d.etapas > 0 ? `${plural(d.etapas, 'etapa', 'etapas')} de Diseño${desde(d.etapasEn)}` : 'Faltan Habilitado y Ensamblaje',
    },
    {
      clave: 'dxf',
      etiqueta: 'DXF',
      hecho: (d?.dxf ?? 0) > 0,
      detalle: d && d.dxf > 0 ? `${plural(d.dxf, 'archivo', 'archivos')}${desde(d.dxfEn)}` : 'Ninguno para el corte',
    },
  ]
}

/** «Falta la ficha técnica y los DXF», o «Diseño entregó los cinco puntos». */
export function resumenDeLoQueFalta(puntos: readonly PuntoDeDiseno[]): string {
  // «DXF» es sigla: se queda en mayúsculas.
  const faltan = puntos.filter((p) => !p.hecho).map((p) => (p.etiqueta === p.etiqueta.toUpperCase() ? p.etiqueta : p.etiqueta.toLowerCase()))
  if (faltan.length === 0) return 'Diseño entregó los cinco puntos'
  if (faltan.length === puntos.length) return 'Diseño todavía no entregó ninguno de los cinco puntos'
  const lista = faltan.length === 1 ? faltan[0] : `${faltan.slice(0, -1).join(', ')} y ${faltan.at(-1)}`
  return `Falta: ${lista}`
}

/** La fecha comprometida del plano contra la real, en palabras, con su tono. */
export function compromisoEnPalabras(c: CompromisoDelPlano): { texto: string; insignia: string | null; tono: Tono } {
  const dias = (n: number | null) => (n === 1 ? '1 día' : `${n ?? 0} días`)
  const para = c.comprometido ? `comprometido para el ${fecha(c.comprometido)}` : 'sin fecha comprometida'
  switch (c.situacion) {
    case 'A_TIEMPO':
      return { texto: `${para}, subido el ${fecha(c.entregadoEn)}`, insignia: 'A tiempo', tono: 'exito' }
    case 'TARDE':
      return { texto: `${para}, subido el ${fecha(c.entregadoEn)}`, insignia: `${dias(c.dias)} tarde`, tono: 'peligro' }
    case 'VENCIDO':
      return { texto: `${para}, todavía sin subir`, insignia: `Vencido hace ${dias(c.dias)}`, tono: 'peligro' }
    case 'PENDIENTE':
      return {
        texto: `${para}, todavía sin subir`,
        insignia: c.dias === 0 ? 'Vence hoy' : `Faltan ${dias(c.dias)}`,
        tono: c.dias === 0 ? 'aviso' : 'neutro',
      }
    case 'ENTREGADO_SIN_FECHA':
      return { texto: `${para}; subido el ${fecha(c.entregadoEn)}`, insignia: null, tono: 'neutro' }
    default:
      return { texto: `${para}: se pone en la etapa de Diseño de esta área`, insignia: null, tono: 'neutro' }
  }
}
