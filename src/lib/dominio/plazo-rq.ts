/**
 * El RQ contra la fecha en que se necesita (plan 3, entrega 3.1). Quien lo
 * registra lo sigue por esa fecha: cuántos días le faltan o cuántos lleva
 * vencido, y qué insumos lo tienen así.
 *
 * Vencido es la fecha pasada con algo por entregar (decisión del plan): un RQ
 * abierto —por atender, en compra o listo en almacén— cuya fecha ya pasó. El
 * entregado y el anulado no tienen plazo.
 *
 * Los días se cuentan por fecha de Lima (`diasHasta` de `format.ts`): 0 es hoy.
 * Sin alias de importación, para que la prueba lo corra con `node --test`.
 */

/** Los estados en que el RQ todavía tiene algo por entregar. */
const CON_ALGO_POR_ENTREGAR = ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN']

/** Los días que le faltan a un RQ (negativo si ya venció), o `null` si no tiene plazo. */
export function plazoDelRq(estado: string, dias: number | null): number | null {
  return dias !== null && CON_ALGO_POR_ENTREGAR.includes(estado) ? dias : null
}

/** «Vencido sin atender»: la fecha pasó y todavía falta entregar algo. */
export const estaVencido = (plazo: number | null) => plazo !== null && plazo < 0

/**
 * Los días que van de hoy al domingo, con la semana de lunes a domingo:
 * 6 un lunes, 0 un domingo. `hoy` es la fecha de Lima, YYYY-MM-DD.
 */
export function diasHastaElDomingo(hoy: string): number {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay() // 0 domingo … 6 sábado
  return (7 - dia) % 7
}

/**
 * «Se necesita esta semana»: de hoy al domingo. Los vencidos no entran: tienen
 * su propio filtro, y juntos no se sabría cuál se pasó y cuál todavía llega.
 */
export function seNecesitaEstaSemana(plazo: number | null, hoy: string): boolean {
  return plazo !== null && plazo >= 0 && plazo <= diasHastaElDomingo(hoy)
}

/** Los filtros de la lista por la fecha en que se necesita (`?plazo=`). */
export const FILTROS_DE_PLAZO = {
  semana: 'Se necesita esta semana',
  vencidos: 'Vencido sin atender',
} as const
export type FiltroDePlazo = keyof typeof FILTROS_DE_PLAZO

export const esFiltroDePlazo = (v: unknown): v is FiltroDePlazo => typeof v === 'string' && v in FILTROS_DE_PLAZO

/** Cómo se dice el plazo en la insignia: lo vencido en rojo, lo de hoy y mañana en ámbar, lo demás sin color. */
export function textoDelPlazo(plazo: number): { etiqueta: string; tono: 'peligro' | 'aviso' | 'neutro' } {
  if (plazo < 0) return { etiqueta: `Vencido hace ${-plazo} ${plazo === -1 ? 'día' : 'días'}`, tono: 'peligro' }
  if (plazo === 0) return { etiqueta: 'Se necesita hoy', tono: 'aviso' }
  if (plazo === 1) return { etiqueta: 'Se necesita mañana', tono: 'aviso' }
  return { etiqueta: `Faltan ${plazo} días`, tono: 'neutro' }
}

/** Lo que falta de un insumo, como lo parte la barra (`partesDelInsumo`); `null` en el anulado. */
type Partes = { recoger: number; porLlegar: number; revisar: number } | null

/** «2», «2 y 5», «2, 4 y 5». */
const lista = (items: number[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`)

/**
 * Qué insumos tienen vencido el RQ, agrupados por lo que les falta, primero lo
 * que ya se puede ir a recoger: «el insumo 2, para recoger en Almacén», «los
 * insumos 1 y 3, por llegar». Un insumo con dos partes sale en las dos.
 */
export function loQueLoAtrasa(lineas: readonly { item: number; partes: Partes }[]): string[] {
  const grupos: { clave: 'recoger' | 'porLlegar' | 'revisar'; texto: string }[] = [
    { clave: 'recoger', texto: 'para recoger en Almacén' },
    { clave: 'porLlegar', texto: 'por llegar' },
    { clave: 'revisar', texto: 'por revisar en Almacén' },
  ]
  return grupos.flatMap(({ clave, texto }) => {
    const items = lineas.filter((l) => (l.partes?.[clave] ?? 0) > 0).map((l) => l.item)
    if (items.length === 0) return []
    return [`${items.length === 1 ? 'el insumo' : 'los insumos'} ${lista(items)}, ${texto}`]
  })
}
