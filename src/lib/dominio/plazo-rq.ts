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

/**
 * Los estados en que el RQ todavía tiene algo por entregar. Es la misma lista de
 * `ESTADOS_RQ_ABIERTOS` (`requerimientos.ts` la toma de aquí): si se suma un
 * estado, el plazo y la cifra de «en camino» siguen contando lo mismo.
 */
export const ESTADOS_CON_ALGO_POR_ENTREGAR = ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN'] as const

/** Los días que le faltan a un RQ (negativo si ya venció), o `null` si no tiene plazo. */
export function plazoDelRq(estado: string, dias: number | null): number | null {
  return dias !== null && (ESTADOS_CON_ALGO_POR_ENTREGAR as readonly string[]).includes(estado) ? dias : null
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

// `Object.hasOwn` y no `in`: `?plazo=__proto__` pasaba por filtro y tumbaba la página.
export const esFiltroDePlazo = (v: unknown): v is FiltroDePlazo => typeof v === 'string' && Object.hasOwn(FILTROS_DE_PLAZO, v)

/**
 * Las fechas en que se necesita lo que entra en cada filtro, para pedírselo a la
 * base (YYYY-MM-DD, las dos inclusive): «vencidos», hasta ayer; «semana», de hoy
 * al domingo. Con la lista ya cargada, el filtro dejaba fuera los vencidos más
 * viejos que los 300 RQ más nuevos.
 */
export function fechasDelFiltro(filtro: FiltroDePlazo, hoy: string): { desde: string | null; hasta: string } {
  const correr = (dias: number) => {
    const d = new Date(`${hoy}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + dias)
    return d.toISOString().slice(0, 10)
  }
  return filtro === 'vencidos' ? { desde: null, hasta: correr(-1) } : { desde: hoy, hasta: correr(diasHastaElDomingo(hoy)) }
}

/** Cómo se dice el plazo en la insignia: lo vencido en rojo, lo de hoy y mañana en ámbar, lo demás sin color. */
export function textoDelPlazo(plazo: number): { etiqueta: string; tono: 'peligro' | 'aviso' | 'neutro' } {
  if (plazo < 0) return { etiqueta: `Vencido hace ${-plazo} ${plazo === -1 ? 'día' : 'días'}`, tono: 'peligro' }
  if (plazo === 0) return { etiqueta: 'Se necesita hoy', tono: 'aviso' }
  if (plazo === 1) return { etiqueta: 'Se necesita mañana', tono: 'aviso' }
  return { etiqueta: `Faltan ${plazo} días`, tono: 'neutro' }
}

/**
 * Lo que falta de un insumo, como lo parte la barra (`partesDelInsumo`); `null`
 * en el anulado. `sinCompra` es lo que la OC no compró y ya no va a llegar: ya
 * entró entera (`laCompraQuedoCorta`). `porComprar` es lo que todavía no tiene
 * OC, o cuya OC se rechazó o se anuló: no viene en camino.
 */
type Partes = { recoger: number; porLlegar: number; revisar: number; porComprar?: number; sinCompra?: number } | null

/** «2», «2 y 5», «2, 4 y 5». */
const lista = (items: number[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`)

/**
 * Qué insumos tienen vencido el RQ, agrupados por lo que les falta, primero lo
 * que ya se puede ir a recoger: «el insumo 2, para recoger en Almacén», «los
 * insumos 1 y 3, por llegar». Un insumo con dos partes sale en las dos.
 */
export function loQueLoAtrasa(lineas: readonly { item: number; partes: Partes }[]): string[] {
  const grupos: { clave: 'recoger' | 'porLlegar' | 'porComprar' | 'revisar' | 'sinCompra'; texto: string }[] = [
    { clave: 'recoger', texto: 'para recoger en Almacén' },
    { clave: 'porLlegar', texto: 'por llegar' },
    { clave: 'porComprar', texto: 'por comprar' },
    { clave: 'revisar', texto: 'por revisar en Almacén' },
    { clave: 'sinCompra', texto: 'sin comprar: pide el resto en un RQ nuevo' },
  ]
  return grupos.flatMap(({ clave, texto }) => {
    const items = lineas.filter((l) => (l.partes?.[clave] ?? 0) > 0).map((l) => l.item)
    if (items.length === 0) return []
    return [`${items.length === 1 ? 'el insumo' : 'los insumos'} ${lista(items)}, ${texto}`]
  })
}
