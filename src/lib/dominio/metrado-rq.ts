import type { Tono } from '@/components/ui/etiqueta-estado'
import { cantidad as cifra } from '@/lib/format'

/**
 * Cómo está un insumo de RQ frente al metrado de Diseño (migración
 * 20261120400000, `metrado_de_requerimientos`). En regla: NO_APLICA,
 * EN_METRADO y AUTORIZADO. Los otros frenan la revisión de Almacén, la OC y la
 * salida hasta que quien pidió lo sustente y Diseño lo autorice.
 */
export type EstadoMetrado = 'NO_APLICA' | 'EN_METRADO' | 'SIN_SUSTENTO' | 'POR_AUTORIZAR' | 'AUTORIZADO' | 'RECHAZADO'

export const ESTADO_METRADO: Record<EstadoMetrado, { etiqueta: string; tono: Tono; descripcion: string }> = {
  NO_APLICA: { etiqueta: 'Sin metrado', tono: 'neutro', descripcion: 'No se mide contra el metrado: no es de una unidad, es consumible o EPP, o el RQ es de antes de la regla.' },
  EN_METRADO: { etiqueta: 'En el metrado', tono: 'exito', descripcion: 'Lo pedido, con lo que ya pidieron otros RQ del código, entra en el metrado de Diseño.' },
  SIN_SUSTENTO: { etiqueta: 'Se pasa del metrado', tono: 'peligro', descripcion: 'Pide más de lo que dice el metrado de Diseño, o algo que no está en él: falta el sustento de quien lo pidió.' },
  POR_AUTORIZAR: { etiqueta: 'Espera a Diseño', tono: 'aviso', descripcion: 'Ya tiene su sustento: Diseño lo autoriza o no.' },
  AUTORIZADO: { etiqueta: 'Autorizado por Diseño', tono: 'exito', descripcion: 'Se pasa del metrado, pero Diseño lo autorizó con su sustento.' },
  RECHAZADO: { etiqueta: 'Diseño no lo autorizó', tono: 'peligro', descripcion: 'Diseño no lo autorizó: corrige la cantidad o sustenta otra vez.' },
}

/** El insumo frena el RQ: Almacén no lo revisa, Logística no lo compra y no sale del almacén. */
export const frenaElRq = (estado: EstadoMetrado | undefined) =>
  estado === 'SIN_SUSTENTO' || estado === 'POR_AUTORIZAR' || estado === 'RECHAZADO'

/** Quien pidió puede escribir (o reescribir) su sustento. */
export const pideSustento = (estado: EstadoMetrado | undefined) => estado === 'SIN_SUSTENTO' || estado === 'POR_AUTORIZAR' || estado === 'RECHAZADO'

/** Lo que hace falta del metrado para explicar un insumo; lo trae `metrado_de_requerimientos`. */
type MetradoParaExplicar = { metrado: number | null; pedido_antes: number; exceso: number; planos: string | null }

/**
 * La cuenta del insumo contra el metrado, en una frase: cuánto metró Diseño
 * para el código, cuánto ya pidieron los RQ anteriores y cuánto se pasa.
 */
export function cuentaDelMetrado(m: MetradoParaExplicar, unidad: string): string {
  const u = unidad ? ` ${unidad}` : ''
  if (m.metrado === null) return 'No está en el metrado de Diseño de este código.'
  const antes = m.pedido_antes > 0 ? `; los RQ anteriores ya pidieron ${cifra(m.pedido_antes)}${u}` : ''
  const planos = m.planos ? ` (${m.planos})` : ''
  const pasa = m.exceso > 0 ? `: se pasa ${cifra(m.exceso)}${u}` : ''
  return `Diseño metró ${cifra(m.metrado)}${u}${planos}${antes}${pasa}.`
}

/** «1», «1 y 2», «1, 2 y 3». */
export const listaDeItems = (items: number[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`)

/**
 * Por qué un RQ por atender todavía no le toca a Almacén: le falta el sustento
 * a algún insumo que se pasa del metrado (o Diseño no lo autorizó), o ya está
 * sustentado y espera a Diseño.
 */
export type FrenoDelRq = 'SUSTENTO' | 'DISENO'

export const FRENO_DEL_RQ: Record<FrenoDelRq, { etiqueta: string; tono: Tono; etapa: string }> = {
  SUSTENTO: { etiqueta: 'Falta el sustento', tono: 'peligro', etapa: 'Quien pidió sustenta lo que se pasa del metrado' },
  DISENO: { etiqueta: 'Espera a Diseño', tono: 'aviso', etapa: 'Diseño revisa lo que se pasa del metrado' },
}

/** Los insumos del RQ que frenan su revisión, y por qué; `null` si no frena nada. */
export function frenoDelRq(
  rq: { estado: string; lineas: { id: string; item: number }[] },
  metrado: Map<string, { estado: EstadoMetrado }>,
): { freno: FrenoDelRq; items: number[] } | null {
  if (rq.estado !== 'POR_ATENDER') return null
  const frenados = rq.lineas.filter((l) => frenaElRq(metrado.get(l.id)?.estado))
  if (frenados.length === 0) return null
  const freno = frenados.every((l) => metrado.get(l.id)?.estado === 'POR_AUTORIZAR') ? 'DISENO' : 'SUSTENTO'
  return { freno, items: frenados.map((l) => l.item) }
}

/**
 * El RQ todavía abierto con algún insumo que se pasa del metrado sin sustento,
 * o que Diseño no autorizó: espera que quien lo registró escriba por qué.
 */
export function esperaSuSustento(
  rq: { estado: string; lineas: { id: string }[] },
  metrado: Map<string, { estado: EstadoMetrado }>,
): boolean {
  if (rq.estado === 'ENTREGADO' || rq.estado === 'ANULADO') return false
  return rq.lineas.some((l) => {
    const e = metrado.get(l.id)?.estado
    return e === 'SIN_SUSTENTO' || e === 'RECHAZADO'
  })
}
