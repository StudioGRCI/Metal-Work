import type { Tono } from '@/components/ui/etiqueta-estado'
import { fecha } from '@/lib/format'

/**
 * Lo que Diseño entrega por código interno (plan 6, entrega 6.1; migración
 * 20261126600000): cinco puntos con hecho o pendiente, y el plano de cada área
 * contra la fecha en que el área lo necesita. Puro: lo usan Diseño, Códigos
 * internos (Administración y Gerencia) y Planos y etapas (el supervisor de
 * cada área).
 */

export type SituacionDelPlano = 'A_TIEMPO' | 'TARDE' | 'PENDIENTE' | 'VENCIDO' | 'SIN_FECHA' | 'ENTREGADO_SIN_FECHA'

/** El plano de un área (Maestranza o Producción): para cuándo lo necesita el área y cuándo llegó. */
export type CompromisoDelPlano = {
  area: string
  areaNombre: string
  /** Si Diseño ya le puso su etapa a esa área (Habilitado o Ensamblaje). */
  tieneEtapa: boolean
  /** La etapa de Diseño que da la fecha: la que empieza primero («Habilitado: Chasis»). */
  etapa: string | null
  /**
   * El primer inicio de esa etapa (YYYY-MM-DD): el día en que el área necesita
   * el plano. No es la «Comprometida» del formulario de etapas, que es el fin.
   */
  comprometido: string | null
  /** Cuando subió el primer plano de esa área. */
  entregadoEn: string | null
  situacion: SituacionDelPlano
  /** Días de atraso (tarde o vencido) o los que faltan (pendiente). */
  dias: number | null
  /** Pendiente y dentro del margen de «por vencer» de las etapas (tres días hábiles). */
  porVencer: boolean
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

/** La etapa que Diseño pone en cada área. */
const ETAPA_DEL_AREA: Record<string, string> = { MTZ: 'Habilitado', PRD: 'Ensamblaje' }

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
    etapas(d, desde),
    {
      clave: 'dxf',
      etiqueta: 'DXF',
      hecho: (d?.dxf ?? 0) > 0,
      detalle: d && d.dxf > 0 ? `${plural(d.dxf, 'archivo', 'archivos')}${desde(d.dxfEn)}` : 'Ninguno para el corte',
    },
  ]
}

/** Las etapas están solo con las dos: Habilitado en Maestranza y Ensamblaje en Producción. */
function etapas(d: LoQueDebeDiseno | undefined, desde: (en: string | null) => string): PuntoDeDiseno {
  const faltan = (d?.compromisos ?? []).filter((c) => !c.tieneEtapa)
  const hecho = Boolean(d) && d!.compromisos.length > 0 && faltan.length === 0
  const detalle = hecho
    ? `${plural(d!.etapas, 'etapa', 'etapas')} de Diseño${desde(d!.etapasEn)}`
    : faltan.length === 1 && d!.etapas > 0
      ? `Falta ${ETAPA_DEL_AREA[faltan[0].area] ?? 'la etapa'}, de ${faltan[0].areaNombre}`
      : 'Faltan Habilitado y Ensamblaje'
  return { clave: 'etapas', etiqueta: 'Etapas', hecho, detalle }
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

/**
 * El plano de un área contra el día en que la necesita, en palabras, con su
 * tono. Lo tarde ya está subido: va en aviso; en peligro solo lo vencido, que
 * es lo que falta.
 */
export function compromisoEnPalabras(c: CompromisoDelPlano): { texto: string; insignia: string | null; tono: Tono } {
  const dias = (n: number | null) => (n === 1 ? '1 día' : `${n ?? 0} días`)
  const cuando = c.etapa ? `, cuando empieza ${c.etapa}` : ''
  const necesita = c.comprometido ? `lo necesita el ${fecha(c.comprometido)}${cuando}` : null
  switch (c.situacion) {
    case 'A_TIEMPO':
      return { texto: `${necesita}; se subió el ${fecha(c.entregadoEn)}`, insignia: 'A tiempo', tono: 'exito' }
    case 'TARDE':
      return { texto: `${necesita}; se subió el ${fecha(c.entregadoEn)}`, insignia: `Subido ${dias(c.dias)} tarde`, tono: 'aviso' }
    case 'VENCIDO':
      return { texto: `${necesita}; todavía no se sube`, insignia: `Vencido hace ${dias(c.dias)}`, tono: 'peligro' }
    case 'PENDIENTE':
      return {
        texto: `${necesita}; todavía no se sube`,
        insignia: c.dias === 0 ? 'Vence hoy' : `Faltan ${dias(c.dias)}`,
        tono: c.porVencer ? 'aviso' : 'neutro',
      }
    case 'ENTREGADO_SIN_FECHA':
      return {
        texto: c.tieneEtapa
          ? `se subió el ${fecha(c.entregadoEn)}; su etapa todavía no tiene fecha de inicio`
          : `se subió el ${fecha(c.entregadoEn)}; falta la etapa ${ETAPA_DEL_AREA[c.area] ?? 'de Diseño'} de esta área`,
        insignia: null,
        tono: 'neutro',
      }
    default:
      return {
        texto: c.tieneEtapa
          ? `todavía sin fecha, se toma del inicio de ${c.etapa ?? 'su etapa'}`
          : `todavía sin fecha, falta la etapa ${ETAPA_DEL_AREA[c.area] ?? 'de Diseño'} de esta área`,
        insignia: null,
        tono: 'neutro',
      }
  }
}

/**
 * Lo único del plano que va en una lista: lo vencido o lo que está por vencer,
 * el más urgente. Lo demás (a tiempo, tarde, sin fecha) se lee en el código.
 */
export function planoMasUrgente(compromisos: readonly CompromisoDelPlano[]): { compromiso: CompromisoDelPlano; insignia: string; tono: Tono } | null {
  const rango = (c: CompromisoDelPlano) => (c.situacion === 'VENCIDO' ? 0 : c.situacion === 'PENDIENTE' && c.porVencer ? 1 : 9)
  const [c] = [...compromisos].filter((x) => rango(x) < 9).sort((a, b) => rango(a) - rango(b) || (rango(a) === 0 ? (b.dias ?? 0) - (a.dias ?? 0) : (a.dias ?? 0) - (b.dias ?? 0)))
  if (!c) return null
  const dias = (n: number | null) => (n === 1 ? '1 día' : `${n ?? 0} días`)
  return c.situacion === 'VENCIDO'
    ? { compromiso: c, insignia: `Plano de ${c.areaNombre} vencido hace ${dias(c.dias)}`, tono: 'peligro' }
    : { compromiso: c, insignia: c.dias === 0 ? `Plano de ${c.areaNombre}: vence hoy` : `Plano de ${c.areaNombre}: faltan ${dias(c.dias)}`, tono: 'aviso' }
}
