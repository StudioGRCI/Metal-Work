import 'server-only'

import { enlaces } from '@/lib/datos/facturacion'
import { BUCKET_NOTAS_CREDITO } from '@/lib/dominio/finanzas'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

/*
 * La nota de crédito del proveedor (decisiones de DKS del 22/10, migración
 * 20261022190000). Contabilidad la registra contra su factura, con el PDF, por
 * lo que Almacén devolvió o por un descuento; la factura baja sola. Lo que no
 * cabe en ella queda a favor, y Tesorería lo descuenta de otra factura del
 * proveedor o registra que lo devolvió.
 */

type Funcion<N extends keyof Database['public']['Functions']> = Database['public']['Functions'][N]['Returns']

/** Una nota de la factura, para Contabilidad y para quien consulta la factura. */
export type NotaDeLaFactura = {
  id: string
  numero: string
  fecha: string
  moneda: string
  monto: number
  tipo: 'DEVOLUCION' | 'DESCUENTO'
  motivo: string
  url: string | null
  anulada: { en: string; motivo: string | null } | null
}

/** Las notas de crédito de esas facturas, vigentes y anuladas, por factura. */
export async function notasDeLasFacturas(ids: string[]): Promise<Map<string, NotaDeLaFactura[]>> {
  const mapa = new Map<string, NotaDeLaFactura[]>()
  if (ids.length === 0) return mapa
  const supabase = await createClient()
  const filas = []
  // En tandas, como `correccionesDe`: la URL no se alarga sin fin.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('notas_credito_compra')
      .select('id, adquisicion_id, numero, fecha_emision, moneda, monto, tipo, motivo, archivo_ruta, anulado_en, motivo_anulacion')
      .in('adquisicion_id', ids.slice(i, i + 150))
      .order('fecha_emision')
    if (error) throw new Error(`No se pudieron leer las notas de crédito: ${error.message}`)
    filas.push(...(data ?? []))
  }
  const urls = await enlaces(BUCKET_NOTAS_CREDITO, filas.map((n) => n.archivo_ruta))
  for (const n of filas) {
    const nota: NotaDeLaFactura = {
      id: n.id,
      numero: n.numero,
      fecha: n.fecha_emision,
      moneda: n.moneda,
      monto: Number(n.monto),
      tipo: n.tipo === 'DEVOLUCION' ? 'DEVOLUCION' : 'DESCUENTO',
      motivo: n.motivo,
      url: urls.get(n.archivo_ruta) ?? null,
      anulada: n.anulado_en ? { en: n.anulado_en, motivo: n.motivo_anulacion } : null,
    }
    mapa.set(n.adquisicion_id, [...(mapa.get(n.adquisicion_id) ?? []), nota])
  }
  return mapa
}

/** Lo que Almacén devolvió sin reposición y espera su nota de crédito, con las facturas de su OC. */
export type DevolucionSinNota = Omit<Funcion<'devoluciones_sin_nota_credito'>[number], 'facturas' | 'devolucion_id' | 'compra'> & {
  devolucion_id: string
  compra: string
  facturas: { id: string; numero: string }[]
}

export async function devolucionesSinNota(): Promise<DevolucionSinNota[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('devoluciones_sin_nota_credito')
  if (error) throw new Error(`No se pudo leer lo devuelto que espera su nota de crédito: ${error.message}`)
  return (data ?? []).flatMap((d) =>
    d.devolucion_id
      ? [{ ...d, devolucion_id: d.devolucion_id, compra: d.compra ?? 'OC', facturas: Array.isArray(d.facturas) ? (d.facturas as { id: string; numero: string }[]) : [] }]
      : [],
  )
}

/** En qué se usó una nota: un descuento de otra factura o lo que el proveedor devolvió. */
export type UsoDeLaNota =
  | { id: string; que: 'DESCUENTO'; fecha: string; monto: number; factura: string }
  | { id: string; que: 'DEVOLUCION'; fecha: string; monto: number; operacion: string | null }

/** Una factura del mismo proveedor y moneda que todavía debe: de ella se puede descontar la nota. */
export type FacturaParaLaNota = { id: string; numero: string; fecha: string | null; saldo: number }

export type NotaAFavor = {
  id: string
  numero: string
  proveedor: string
  ruc: string | null
  facturaId: string
  factura: string
  fecha: string
  moneda: string
  monto: number
  aFavor: number
  url: string | null
  usado: UsoDeLaNota[]
  /** Solo para quien registra pagos y con algo a favor. */
  facturas: FacturaParaLaNota[]
}

/**
 * Las notas con algo a favor, o con algo usado que todavía se puede deshacer,
 * para Tesorería. Con `conFacturas`, de cada una con saldo, las facturas de las
 * que se puede descontar.
 */
export async function notasAFavor(conFacturas: boolean): Promise<NotaAFavor[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('notas_credito_a_favor')
  if (error) throw new Error(`No se pudieron leer las notas de crédito a favor: ${error.message}`)
  // Los campos de una función que devuelve tabla llegan como opcionales en los tipos: la base siempre los llena.
  const filas = (data ?? []).flatMap((n) =>
    n.nota_id && n.numero && n.factura_id
      ? [{ ...n, nota_id: n.nota_id, numero: n.numero, factura_id: n.factura_id, archivo_ruta: n.archivo_ruta ?? null }]
      : [],
  )
  const [urls, facturas] = await Promise.all([
    enlaces(BUCKET_NOTAS_CREDITO, filas.map((n) => n.archivo_ruta)),
    Promise.all(
      filas.map(async (n) => {
        if (!conFacturas || Number(n.a_favor) <= 0) return [] as FacturaParaLaNota[]
        const r = await supabase.rpc('facturas_para_la_nota', { p_nota: n.nota_id })
        if (r.error) throw new Error(`No se pudieron leer las facturas del proveedor: ${r.error.message}`)
        return (r.data ?? []).flatMap((f) => (f.factura_id ? [{ id: f.factura_id, numero: f.numero ?? '', fecha: f.fecha, saldo: Number(f.saldo) }] : []))
      }),
    ),
  ])
  return filas.map((n, i) => ({
    id: n.nota_id,
    numero: n.numero,
    proveedor: n.proveedor ?? '',
    ruc: n.ruc_proveedor,
    facturaId: n.factura_id,
    factura: n.factura ?? '',
    fecha: n.fecha ?? '',
    moneda: n.moneda ?? 'PEN',
    monto: Number(n.monto),
    aFavor: Number(n.a_favor),
    url: (n.archivo_ruta && urls.get(n.archivo_ruta)) || null,
    usado: (Array.isArray(n.usado) ? (n.usado as UsoDeLaNota[]) : []).map((u) => ({ ...u, monto: Number(u.monto) })),
    facturas: facturas[i],
  }))
}
