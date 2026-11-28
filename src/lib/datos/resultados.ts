import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Los resultados de Metal Work (migración 20261128130000): `resultados_metal_work`
 * exige `resultados.ver` (Gerencia y Contabilidad) y da, para un periodo, cada
 * código interno facturado con su ingreso sin IGV en soles, la parte de su costo
 * que le toca por lo facturado y su ganancia; y lo que el total resta al final.
 * Qué suma y cuánto pesa lo decide la base; aquí solo se separa por tipo.
 */

export type CodigoDelPeriodo = {
  codigo: string
  cliente: string | null
  /** De qué cotización y unidad: «9578-2026», o «3568-2026 · unidad 1 de 2». */
  unidad: string | null
  facturas: number
  /** Sin IGV, en soles: solo lo que ya se puede pasar a soles. */
  ingreso: number
  /** Sin IGV, en dólares, de las facturas sin tipo de cambio de su día. */
  usdSinCambio: number
  facturasSinCambio: number
  /** De 0 a 1: qué parte del costo del código se lleva lo facturado en el periodo. */
  parteDelCosto: number
  costoDelCodigo: number
  costoCerrado: boolean
  sinPrecioDeVenta: boolean
  /** Cuántas cosas dejan el costo de hoy incompleto (salidas sin precio, horas sin costo, líneas sin cambio). */
  costoIncompleto: number
  /** Lo que se resta en el periodo. */
  costo: number
  /** Null si alguna factura no tiene cambio: no se adivina. */
  ganancia: number | null
}

/**
 * Una fila de lo que el total resta: un área, un grupo de la oficina o algo sin
 * repartir. En lo sin repartir por mes, `nombre` lleva sus meses (`2026-10,2026-11`).
 */
export type GastoDelPeriodo = {
  clave: string | null
  nombre: string | null
  soles: number
  lineas: number
  lineasSinCambio: number
  /** Lo que todavía no suma: salidas sin precio, horas sin costo, OS por aprobar. */
  pendientes: number
}

export type Resultados = {
  codigos: CodigoDelPeriodo[]
  operativo: GastoDelPeriodo[]
  oficina: GastoDelPeriodo[]
  sinRepartir: GastoDelPeriodo[]
}

const n = (v: number | string | null | undefined) => Number(v ?? 0)

/** El periodo entre dos fechas `YYYY-MM-DD`, las dos incluidas (hasta un año). */
export async function resultadosDeMetalWork(desde: string, hasta: string): Promise<Resultados> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('resultados_metal_work', { p_desde: desde, p_hasta: hasta })
  if (error) throw new Error(`No se pudieron leer los resultados de Metal Work: ${error.message}`)
  const filas = data ?? []
  const gasto = (tipo: string): GastoDelPeriodo[] =>
    filas
      .filter((f) => f.tipo === tipo)
      .map((f) => ({ clave: f.clave, nombre: f.nombre, soles: n(f.soles), lineas: n(f.lineas), lineasSinCambio: n(f.lineas_sin_cambio), pendientes: n(f.pendientes) }))
  return {
    codigos: filas
      .filter((f) => f.tipo === 'CODIGO' && f.clave)
      .map((f) => ({
        codigo: f.clave ?? '',
        cliente: f.cliente,
        unidad: f.nombre,
        facturas: n(f.facturas),
        ingreso: n(f.facturado_soles),
        usdSinCambio: n(f.facturado_usd_sin_cambio),
        facturasSinCambio: n(f.facturas_sin_cambio),
        parteDelCosto: n(f.parte_del_costo),
        costoDelCodigo: n(f.costo_del_codigo),
        costoCerrado: Boolean(f.costo_cerrado),
        sinPrecioDeVenta: Boolean(f.sin_precio_de_venta),
        costoIncompleto: n(f.costo_incompleto),
        costo: n(f.soles),
        ganancia: f.ganancia === null ? null : n(f.ganancia),
      })),
    operativo: gasto('GASTO_OPERATIVO'),
    oficina: gasto('OFICINA'),
    sinRepartir: gasto('SIN_REPARTIR'),
  }
}
