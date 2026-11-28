/**
 * Los resultados de Metal Work (plan del gasto operativo, entrega 3): el periodo
 * que se pide en la URL y el total de la empresa. Qué suma cada fila lo decide la
 * base (`resultados_metal_work`, migración 20261128100000); aquí solo se suma lo
 * que ella da.
 */

export type Escala = 'dia' | 'mes' | 'ano'

/** El periodo pedido: un día `YYYY-MM-DD`, un mes `YYYY-MM` o un año `YYYY`. */
export type Periodo = { escala: Escala; valor: string; desde: string; hasta: string }

const DIA = /^(2\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MES = /^(2\d{3})-(0[1-9]|1[0-2])$/
const ANO = /^2\d{3}$/

const dosCifras = (n: number) => String(n).padStart(2, '0')

/** El último día del mes `YYYY-MM`, como `YYYY-MM-DD`; en UTC no se corre por el huso. */
function ultimoDia(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return `${mes}-${dosCifras(new Date(Date.UTC(a, m, 0)).getUTCDate())}`
}

/** Si el día existe de verdad: «2026-02-30» no. */
function diaValido(dia: string) {
  if (!DIA.test(dia)) return false
  return dia <= ultimoDia(dia.slice(0, 7))
}

/**
 * Lo que dice la URL, o el mes de hoy. Nada después de hoy: lo que viene todavía
 * no se facturó, y la flecha no lleva ahí.
 */
export function leerPeriodo(pedido: string | undefined, hoy: string): Periodo {
  const p = (pedido ?? '').trim()
  if (diaValido(p) && p <= hoy) return { escala: 'dia', valor: p, desde: p, hasta: p }
  if (ANO.test(p) && p <= hoy.slice(0, 4)) return { escala: 'ano', valor: p, desde: `${p}-01-01`, hasta: `${p}-12-31` }
  const mes = MES.test(p) && p <= hoy.slice(0, 7) ? p : hoy.slice(0, 7)
  return { escala: 'mes', valor: mes, desde: `${mes}-01`, hasta: ultimoDia(mes) }
}

/** El periodo de al lado, de la misma escala, o null si sería después de hoy. */
export function periodoDeAlLado(p: Periodo, delta: -1 | 1, hoy: string): string | null {
  let valor: string
  if (p.escala === 'ano') valor = String(Number(p.valor) + delta)
  else if (p.escala === 'mes') {
    const [a, m] = p.valor.split('-').map(Number)
    const total = a * 12 + (m - 1) + delta
    valor = `${Math.floor(total / 12)}-${dosCifras((total % 12) + 1)}`
  } else {
    const d = new Date(`${p.valor}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + delta)
    valor = d.toISOString().slice(0, 10)
  }
  const tope = p.escala === 'ano' ? hoy.slice(0, 4) : p.escala === 'mes' ? hoy.slice(0, 7) : hoy
  if (valor > tope || valor < '2000') return null
  return valor
}

/**
 * Al cambiar de escala se queda en el mismo tiempo: del mes de hoy al día, hoy;
 * de un mes pasado al día, su primer día; del día al mes, su mes.
 */
export function enOtraEscala(p: Periodo, escala: Escala, hoy: string): string {
  if (escala === 'ano') return p.desde.slice(0, 4)
  if (escala === 'mes') return p.desde.slice(0, 7)
  return hoy >= p.desde && hoy <= p.hasta ? hoy : p.desde
}

const redondear = (n: number) => Math.round(n * 100) / 100

type ConSoles = { soles: number }
type Codigo = { ingreso: number; costo: number; costoDelCodigo: number; ganancia: number | null; usdSinCambio: number }

/**
 * El total de Metal Work: la suma de los códigos que se pueden decir en soles,
 * menos el gasto operativo, el de oficina y lo que no se repartió. El código con
 * una factura sin cambio no entra (ni su ingreso ni su costo) y se cuenta aparte.
 */
export function totalDeMetalWork(r: { codigos: Codigo[]; operativo: ConSoles[]; oficina: ConSoles[]; sinRepartir: ConSoles[] }) {
  const completos = r.codigos.filter((c) => c.ganancia !== null)
  const ingreso = redondear(completos.reduce((s, c) => s + c.ingreso, 0))
  const costo = redondear(completos.reduce((s, c) => s + c.costo, 0))
  const margen = redondear(ingreso - costo)
  const operativo = redondear(r.operativo.reduce((s, g) => s + g.soles, 0))
  const oficina = redondear(r.oficina.reduce((s, g) => s + g.soles, 0))
  const sinRepartir = redondear(r.sinRepartir.reduce((s, g) => s + g.soles, 0))
  const fuera = r.codigos.filter((c) => c.ganancia === null)
  return {
    ingreso,
    costo,
    margen,
    operativo,
    oficina,
    sinRepartir,
    ganancia: redondear(margen - operativo - oficina - sinRepartir),
    codigosFuera: fuera.length,
    usdFuera: redondear(fuera.reduce((s, c) => s + c.usdSinCambio, 0)),
    /** Las que entran al total sin ningún costo cargado: su ganancia es todo lo facturado. */
    sinCosto: completos.filter((c) => c.costoDelCodigo === 0).length,
  }
}

/** Los grupos de lo cargado a OFICINA, como los del gasto operativo. */
const GRUPOS_OFICINA: Record<string, string> = {
  MATERIALES: 'Lo que salió del almacén',
  MANO_OBRA: 'Horas cargadas a OFICINA',
  SERVICIOS: 'Órdenes de servicio',
  SUBCONTRATOS: 'Subcontratos',
  CAJA: 'Caja',
  GASTOS_DEL_MES: 'Gastos del mes cargados a OFICINA',
  OTROS: 'Otros',
}
export const etiquetaDeOficina = (clave: string | null) => (clave && GRUPOS_OFICINA[clave]) || 'Otros'

/** Lo que no se repartió a ninguna unidad, con por qué. */
const SIN_REPARTIR: Record<string, { etiqueta: string; porque: string }> = {
  TODOS_LOS_ACTIVOS: {
    etiqueta: 'Cargado a TODOS LOS ACTIVOS',
    porque: 'Salió para todos los activos en un mes en que ninguna carrocería trabajó, o se cargó a todos sin ser una salida del almacén.',
  },
  GASTOS_DEL_MES: {
    etiqueta: 'Gastos del mes sin horas',
    porque: 'Luz, agua y los demás gastos por horas de un mes en que ninguna carrocería tiene horas: se reparten solos cuando alguien las reporte.',
  },
  SUELDOS_OFICINA: {
    etiqueta: 'Sueldos de la oficina sin horas',
    porque: 'El sueldo de la oficina de un mes en que ninguna carrocería tiene horas: se reparte solo cuando alguien las reporte.',
  },
}
export const sinRepartirDe = (clave: string | null) => (clave && SIN_REPARTIR[clave]) || { etiqueta: 'Otros', porque: '' }
