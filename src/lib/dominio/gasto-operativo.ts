/**
 * El gasto operativo de cada área (plan del gasto operativo, entrega 2): lo que
 * se gastó para trabajar y no se cargó a ninguna unidad. Qué suma y cuánto pesa
 * en soles lo decide la base (`gasto_operativo`, migración 20261127190000);
 * aquí solo se agrupa para mostrarlo.
 */

/** Los grupos de `gasto_operativo.grupo`, en el orden en que se muestran. */
export const GRUPOS_GASTO_OPERATIVO = [
  // Sin nombres de área («Almacén», «Servicios»): en la tabla por área se leían
  // como si un área le pagara a otra (auditoría de diseño, 27/11).
  { clave: 'MATERIALES', etiqueta: 'Herramientas e insumos' },
  { clave: 'MANO_OBRA', etiqueta: 'Mano de obra' },
  { clave: 'SERVICIOS', etiqueta: 'Órdenes de servicio' },
  { clave: 'SUBCONTRATOS', etiqueta: 'Subcontratos' },
  { clave: 'CAJA', etiqueta: 'Caja' },
  { clave: 'OTROS', etiqueta: 'Otros' },
] as const

export const etiquetaDelGrupo = (clave: string) => GRUPOS_GASTO_OPERATIVO.find((g) => g.clave === clave)?.etiqueta ?? clave

/** Cómo se llama en la URL lo que no tiene área. */
export const SIN_AREA = 'sin-area'

/** Un mes `YYYY-MM` desde el 2000: el año 0 lo rechaza Postgres. */
export const MES = /^(2\d{3})-(0[1-9]|1[0-2])$/

/** El mes de al lado, como `YYYY-MM`, sin pasar por Date ni por husos. */
export function otroMes(mes: string, delta: number) {
  const [a, m] = mes.split('-').map(Number)
  const total = a * 12 + (m - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** El último día del mes `YYYY-MM`, como `YYYY-MM-DD`. */
export function ultimoDia(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  // El día 0 del mes siguiente es el último de este; en UTC no se corre por el huso.
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`
}

type Linea = { area_id: string | null; area: string; grupo: string; suma: boolean; soles: number | null; moneda: string | null; monto: number | null; fuente: string }

export type ResumenDeArea = {
  /** `SIN_AREA` para «Planta, sin área». */
  clave: string
  area: string
  total: number
  porGrupo: Map<string, number>
  /** Lo que todavía no suma: sin precio, en dólares sin cambio o por aprobar. */
  pendientes: number
}

/** Lo que suma en soles una lista de líneas. */
export const solesDe = (lineas: Linea[]) => redondear(lineas.reduce((n, l) => n + (l.suma && l.soles !== null ? l.soles : 0), 0))

/** Lo que todavía no suma, y por qué: la base lo deja fuera y aquí se dice. */
export function pendientesDe(lineas: Linea[]) {
  return {
    sinPrecio: lineas.filter((l) => l.fuente === 'MATERIALES_SIN_PRECIO').length,
    sinCosto: lineas.filter((l) => l.fuente === 'MANO_OBRA_SIN_COSTO').length,
    porAprobar: lineas.filter((l) => l.fuente === 'SERVICIOS_POR_APROBAR').length,
    sinCambio: lineas.filter((l) => l.suma && l.monto !== null && l.soles === null).length,
  }
}

const redondear = (n: number) => Math.round(n * 100) / 100

/** Una fila por área, de la que más gastó a la que menos; «Planta, sin área» al final. */
export function resumenPorArea(lineas: Linea[]): ResumenDeArea[] {
  const porArea = new Map<string, ResumenDeArea>()
  for (const l of lineas) {
    const clave = l.area_id ?? SIN_AREA
    const fila = porArea.get(clave) ?? { clave, area: l.area, total: 0, porGrupo: new Map(), pendientes: 0 }
    if (l.suma && l.soles !== null) {
      fila.total = redondear(fila.total + l.soles)
      fila.porGrupo.set(l.grupo, redondear((fila.porGrupo.get(l.grupo) ?? 0) + l.soles))
    } else {
      fila.pendientes += 1
    }
    porArea.set(clave, fila)
  }
  return [...porArea.values()].sort(
    (a, b) => Number(a.clave === SIN_AREA) - Number(b.clave === SIN_AREA) || b.total - a.total || a.area.localeCompare(b.area),
  )
}
