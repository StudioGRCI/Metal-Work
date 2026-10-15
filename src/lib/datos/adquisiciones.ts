import 'server-only'

import { z } from 'zod'

import { enlaces } from '@/lib/datos/facturacion'
import { BUCKET_PAGOS_FACTURAS } from '@/lib/dominio/finanzas'
import { lecturaDeFila, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { createClient } from '@/lib/supabase/server'
import type { Tablas, Vistas } from '@/types/database'

/**
 * La factura de compra cubre una o varias OC del mismo proveedor, Adquisiciones
 * avisa si su total no calza con el de sus OC, y Tesorería la paga con su
 * voucher (migración 20261015122000).
 */

const esquemaOrdenes = z.array(
  z.object({
    id: z.guid(),
    numero: z.string().nullable(),
    referencia: z.string(),
    moneda: z.string(),
    total: z.coerce.number(),
    sin_precio: z.boolean(),
    con_factura: z.boolean(),
    numero_ot: z.string().nullable(),
  }),
)
export type OrdenDeFactura = z.infer<typeof esquemaOrdenes>[number]
export type ControlDeFactura = { ordenes: OrdenDeFactura[]; total_oc: number | null; diferencia: number | null; control: string }

/** Las OC de cada factura y si su total calza con el de ellas. */
export async function controlDeFacturas(ids: string[]): Promise<Map<string, ControlDeFactura>> {
  const mapa = new Map<string, ControlDeFactura>()
  if (ids.length === 0) return mapa
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('adquisiciones_control', { p_ids: ids })
  if (error) throw new Error(`No se pudo comparar las facturas con sus OC: ${error.message}`)
  for (const f of data ?? []) {
    if (!f.adquisicion_id) continue
    mapa.set(f.adquisicion_id, {
      ordenes: esquemaOrdenes.parse(f.ordenes ?? []),
      total_oc: f.total_oc === null ? null : Number(f.total_oc),
      diferencia: f.diferencia === null ? null : Number(f.diferencia),
      control: f.control ?? 'SIN_OC',
    })
  }
  return mapa
}

/** Una OC que espera su factura, como la trae `compras_sin_factura`. */
export type CompraSinFactura = {
  orden_compra_id: string
  numero: string | null
  proveedor: string
  referencia: string
  moneda: string
  total: number
  sin_precio: boolean
  condicion_pago: string
  numero_ot: string | null
  orden_id: string | null
  creado_en: string
  en_borrador: boolean
}

/** Las OC aprobadas que van con factura y todavía no están en ninguna factura registrada. */
export async function comprasSinFactura(): Promise<CompraSinFactura[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compras_sin_factura')
  if (error) throw new Error(`No se pudieron leer las OC que esperan su factura: ${error.message}`)
  return (data ?? []).flatMap((c) =>
    c.orden_compra_id
      ? [{
          orden_compra_id: c.orden_compra_id,
          numero: c.numero,
          proveedor: c.proveedor ?? '',
          referencia: c.referencia ?? '',
          moneda: c.moneda ?? 'PEN',
          total: Number(c.total ?? 0),
          sin_precio: Boolean(c.sin_precio),
          condicion_pago: c.condicion_pago ?? 'CONTADO',
          numero_ot: c.numero_ot,
          orden_id: c.orden_id,
          creado_en: c.creado_en ?? '',
          en_borrador: Boolean(c.en_borrador),
        }]
      : [],
  )
}

/** El PDF de cada comprobante: el que subió Contabilidad o la factura que adjuntó Logística a la compra. */
export async function enlacesDeComprobantes(
  filas: { id: string; ruta_storage: string | null; documento_compra_id: string | null }[],
): Promise<Map<string, string>> {
  const supabase = await createClient()
  const idsDocumentos = filas.flatMap((f) => (f.documento_compra_id ? [f.documento_compra_id] : []))
  const documentos = idsDocumentos.length
    ? await supabase.from('documentos_compra_material').select('id, ruta_storage').in('id', idsDocumentos)
    : { data: [], error: null }
  if (documentos.error) throw new Error('No se pudieron leer las facturas que adjuntó Logística.')
  const rutaDocumento = new Map((documentos.data ?? []).map((d) => [d.id, d.ruta_storage]))
  const [propios, deLogistica] = await Promise.all([
    enlaces('comprobantes-financieros', filas.map((f) => f.ruta_storage)),
    enlaces('documentos-compras', [...rutaDocumento.values()]),
  ])
  const mapa = new Map<string, string>()
  for (const f of filas) {
    const url = f.ruta_storage
      ? propios.get(f.ruta_storage)
      : f.documento_compra_id
        ? deLogistica.get(rutaDocumento.get(f.documento_compra_id) ?? '')
        : undefined
    if (url) mapa.set(f.id, url)
  }
  return mapa
}

type CuentaPagarFila = Pick<
  Vistas<'v_cuentas_pagar'>,
  | 'id' | 'numero_ot' | 'proveedor' | 'numero_documento' | 'fecha_emision' | 'fecha_vencimiento' | 'moneda' | 'total'
  | 'pagado' | 'saldo' | 'condicion_pago' | 'tipo'
>
type PagoFacturaFila = Pick<
  Tablas<'pagos_adquisicion'>,
  'id' | 'adquisicion_id' | 'fecha' | 'monto' | 'referencia' | 'archivo_ruta' | 'anulado_en' | 'motivo_anulacion'
>
export type PagoDeFactura = PagoFacturaFila & { url: string | null }
export type CuentaPorPagar = CuentaPagarFila & {
  url: string | null
  control: ControlDeFactura | null
  /** Lo que el detector leyó de la factura al registrarla; null si no la pudo leer. */
  lectura: LecturaFactura | null
  pagos: PagoDeFactura[]
}

/**
 * Lo que Tesorería tiene que pagar: toda factura registrada en Adquisiciones,
 * al contado o a crédito, con sus OC, el aviso de monto, el PDF y cada pago con
 * su voucher (también los anulados, que quedan como evidencia).
 */
export async function cuentasPorPagar(): Promise<CuentaPorPagar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_cuentas_pagar')
    .select('id, numero_ot, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, pagado, saldo, condicion_pago, tipo')
    .order('fecha_vencimiento')
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las cuentas por pagar: ${error.message}`)
  const filas = data ?? []
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const [pagos, comprobantes, controles] = await Promise.all([
    ids.length
      ? supabase
          .from('pagos_adquisicion')
          .select('id, adquisicion_id, fecha, monto, referencia, archivo_ruta, anulado_en, motivo_anulacion')
          .in('adquisicion_id', ids)
          .order('fecha')
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from('adquisiciones')
          .select('id, ruta_storage, documento_compra_id, lectura_fuente, lectura_total, lectura_moneda, lectura_numero, lectura_ordenes')
          .in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    controlDeFacturas(ids),
  ])
  if (pagos.error) throw new Error(`No se pudieron leer los pagos de las facturas: ${pagos.error.message}`)
  if (comprobantes.error) throw new Error(`No se pudieron leer las facturas: ${comprobantes.error.message}`)
  const [vouchers, pdfs] = await Promise.all([
    enlaces(BUCKET_PAGOS_FACTURAS, (pagos.data ?? []).map((p) => p.archivo_ruta)),
    enlacesDeComprobantes(comprobantes.data ?? []),
  ])
  const lecturas = new Map((comprobantes.data ?? []).map((a) => [a.id, lecturaDeFila(a)]))
  return filas.map((f) => ({
    ...f,
    url: (f.id && pdfs.get(f.id)) || null,
    control: (f.id && controles.get(f.id)) || null,
    lectura: (f.id && lecturas.get(f.id)) || null,
    pagos: (pagos.data ?? [])
      .filter((p) => p.adquisicion_id === f.id)
      .map((p) => ({ ...p, url: (p.archivo_ruta && vouchers.get(p.archivo_ruta)) || null })),
  }))
}
