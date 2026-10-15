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

/** Un RQ que la OC atiende con alguno de sus insumos (RQ-0001-2026, RQA-…). */
export type RqDeCompra = { id: string; numero: string; codigo_interno: string }

/** Una OC en la tabla de Adquisiciones: su número, su total, su código y los RQ que atiende. */
export type OcEnTabla = {
  id: string
  numero: string
  moneda: string
  total: number
  sin_precio: boolean
  numero_ot: string | null
  codigo_interno: string | null
  requerimientos: RqDeCompra[]
}

/** Una factura en la tabla, con su PDF, el aviso de monto, lo pagado y cada voucher vigente. */
export type FacturaEnTabla = {
  id: string
  tipo: string
  proveedor: string
  numero_documento: string
  fecha_emision: string
  fecha_vencimiento: string
  moneda: string
  total: number
  condicion_pago: string
  estado: string
  registrado_por: string | null
  observacion: string | null
  url: string | null
  control: ControlDeFactura | null
  /** Lo que el detector leyó de la factura al registrarla; null si no la pudo leer. */
  lectura: LecturaFactura | null
  pagado: number | null
  saldo: number | null
  pagos: PagoDeFactura[]
}

/** Lo que muestra la tabla: cada factura con sus OC, y las OC que todavía esperan la suya. */
export type TablaDeAdquisiciones = {
  facturas: { factura: FacturaEnTabla; ordenes: OcEnTabla[] }[]
  sinFactura: { compra: CompraSinFactura; orden: OcEnTabla }[]
}

/** De a tandas, para no alargar la URL con cientos de identificadores. */
async function enTandas<T>(ids: string[], leer: (tanda: string[]) => Promise<T[]>): Promise<T[]> {
  const filas: T[] = []
  for (let i = 0; i < ids.length; i += 150) filas.push(...(await leer(ids.slice(i, i + 150))))
  return filas
}

/**
 * La tabla de Adquisiciones: de cada factura, sus OC y de cada OC los RQ que
 * atiende, con el enlace al PDF de la factura y a cada voucher. Las OC que
 * esperan su factura van aparte, con sus RQ; si ya están en un borrador que se
 * lista, no se repiten.
 */
export async function tablaDeAdquisiciones(sinFactura: CompraSinFactura[]): Promise<TablaDeAdquisiciones> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('adquisiciones')
    .select(
      'id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado, registrado_por, observacion, ruta_storage, documento_compra_id, lectura_fuente, lectura_total, lectura_moneda, lectura_numero, lectura_ordenes',
    )
    .order('creado_en', { ascending: false })
    .limit(100)
  if (error) throw new Error(`No se pudieron leer adquisiciones: ${error.message}`)
  const filas = data ?? []
  const ids = filas.map((a) => a.id)
  const [controles, urls, saldos, pagos] = await Promise.all([
    controlDeFacturas(ids),
    enlacesDeComprobantes(filas),
    ids.length ? supabase.from('v_cuentas_pagar').select('id, pagado, saldo').in('id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from('pagos_adquisicion')
          .select('id, adquisicion_id, fecha, monto, referencia, archivo_ruta, anulado_en, motivo_anulacion')
          .in('adquisicion_id', ids)
          .is('anulado_en', null)
          .order('fecha')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (saldos.error) throw new Error(`No se pudo leer lo pagado de cada factura: ${saldos.error.message}`)
  if (pagos.error) throw new Error(`No se pudieron leer los pagos de las facturas: ${pagos.error.message}`)
  const saldoDe = new Map((saldos.data ?? []).map((s) => [s.id, s]))
  const vouchers = await enlaces(BUCKET_PAGOS_FACTURAS, (pagos.data ?? []).map((p) => p.archivo_ruta))

  // El código interno de cada OC y los RQ que atiende, de todas las OC de la tabla.
  const idsOc = [
    ...new Set([...[...controles.values()].flatMap((c) => c.ordenes.map((o) => o.id)), ...sinFactura.map((c) => c.orden_compra_id)]),
  ]
  const [codigos, lineas] = await Promise.all([
    enTandas(idsOc, async (tanda) => {
      const r = await supabase.from('ordenes_compra_materiales').select('id, codigo_interno').in('id', tanda)
      if (r.error) throw new Error(`No se pudo leer el código interno de las OC: ${r.error.message}`)
      return r.data ?? []
    }),
    enTandas(idsOc, async (tanda) => {
      const r = await supabase
        .from('requerimiento_lineas')
        .select('orden_compra_id, requerimiento:requerimientos(id, numero, codigo_interno)')
        .in('orden_compra_id', tanda)
      if (r.error) throw new Error(`No se pudo leer qué requerimiento atiende cada OC: ${r.error.message}`)
      return r.data ?? []
    }),
  ])
  const codigoDe = new Map(codigos.map((c) => [c.id, c.codigo_interno]))
  const rqDe = new Map<string, Map<string, RqDeCompra>>()
  for (const l of lineas) {
    if (!l.orden_compra_id || !l.requerimiento) continue
    const deLaOc = rqDe.get(l.orden_compra_id) ?? new Map<string, RqDeCompra>()
    deLaOc.set(l.requerimiento.id, l.requerimiento)
    rqDe.set(l.orden_compra_id, deLaOc)
  }
  const oc = (o: { id: string; numero: string | null; referencia: string; moneda: string; total: number; sin_precio: boolean; numero_ot: string | null }): OcEnTabla => {
    const requerimientos = [...(rqDe.get(o.id)?.values() ?? [])].sort((a, b) => a.numero.localeCompare(b.numero))
    return {
      id: o.id,
      numero: o.numero ?? o.referencia,
      moneda: o.moneda,
      total: o.total,
      sin_precio: o.sin_precio,
      numero_ot: o.numero_ot,
      codigo_interno: codigoDe.get(o.id) ?? requerimientos[0]?.codigo_interno ?? null,
      requerimientos,
    }
  }

  const facturas = filas.map((a) => {
    const control = controles.get(a.id) ?? null
    const cuenta = saldoDe.get(a.id)
    return {
      factura: {
        id: a.id,
        tipo: a.tipo,
        proveedor: a.proveedor,
        numero_documento: a.numero_documento,
        fecha_emision: a.fecha_emision,
        fecha_vencimiento: a.fecha_vencimiento,
        moneda: a.moneda,
        total: Number(a.total),
        condicion_pago: a.condicion_pago,
        estado: a.estado,
        registrado_por: a.registrado_por,
        observacion: a.observacion,
        url: urls.get(a.id) ?? null,
        control,
        lectura: lecturaDeFila(a),
        pagado: cuenta?.pagado == null ? null : Number(cuenta.pagado),
        saldo: cuenta?.saldo == null ? null : Number(cuenta.saldo),
        pagos: (pagos.data ?? [])
          .filter((p) => p.adquisicion_id === a.id)
          .map((p) => ({ ...p, url: (p.archivo_ruta && vouchers.get(p.archivo_ruta)) || null })),
      },
      ordenes: (control?.ordenes ?? []).map(oc),
    }
  })
  const listadas = new Set(facturas.flatMap((f) => f.ordenes.map((o) => o.id)))
  return {
    facturas,
    sinFactura: sinFactura
      .filter((c) => !listadas.has(c.orden_compra_id))
      .map((c) => ({ compra: c, orden: oc({ ...c, id: c.orden_compra_id }) })),
  }
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
