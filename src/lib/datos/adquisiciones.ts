import 'server-only'

import { z } from 'zod'

import { enlaces } from '@/lib/datos/facturacion'
import { BUCKET_NOTAS_CREDITO, BUCKET_PAGOS_COMPRAS, BUCKET_PAGOS_FACTURAS } from '@/lib/dominio/finanzas'
import { lecturaDeFila, type LecturaFactura } from '@/lib/dominio/lectura-factura'
import { rucEsValido } from '@/lib/dominio/proveedores'
import { createClient } from '@/lib/supabase/server'
import type { Database, Tablas, Vistas } from '@/types/database'

type Funciones<T extends keyof Database['public']['Functions']> = Database['public']['Functions'][T]

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
    /** Esta factura cubre solo una parte de la OC (migración 20261016701000). */
    parcial: z.boolean().default(false),
    /** Lo que ya está facturado de la OC en otras facturas registradas. */
    facturado_otras: z.coerce.number().default(0),
    otras_facturas: z.array(z.object({ numero_documento: z.string(), parcial: z.boolean() })).default([]),
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
  /** Lo que ya está facturado de ella en facturas que la cubren en parte (migración 20261016701000). */
  facturado: number
  /** Las facturas registradas que ya la cubren en parte. */
  facturas: string[]
  /** El RUC de su proveedor en el padrón: la factura se liga solo a las OC de su RUC (migración 20261022170000). */
  ruc: string | null
}

/** El RUC del proveedor de cada OC, si está en el padrón y es un RUC (como `public.ruc_de_la_compra`). */
async function rucsDeCompras(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('ordenes_compra_materiales')
    .select('id, padron:proveedores(numero_documento)')
    .in('id', ids)
  if (error) throw new Error(`No se pudo leer el RUC del proveedor de cada OC: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((c) => {
      const ruc = c.padron?.numero_documento?.trim() ?? ''
      return rucEsValido(ruc) ? [[c.id, ruc] as const] : []
    }),
  )
}

const esquemaFacturadas = z.array(z.object({ numero_documento: z.string() }))

/**
 * Las OC aprobadas que van con factura y esperan su factura: ninguna factura
 * registrada las cubre, o las que hay las cubren solo en parte.
 */
export async function comprasSinFactura(): Promise<CompraSinFactura[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compras_sin_factura')
  if (error) throw new Error(`No se pudieron leer las OC que esperan su factura: ${error.message}`)
  const ids = (data ?? []).flatMap((c) => (c.orden_compra_id ? [c.orden_compra_id] : []))
  const facturadas = ids.length ? await supabase.rpc('facturado_de_compras', { p_ids: ids }) : { data: [], error: null }
  if (facturadas.error) throw new Error(`No se pudo leer lo facturado de cada OC: ${facturadas.error.message}`)
  const rucDe = await rucsDeCompras(supabase, ids)
  const facturadoDe = new Map(
    (facturadas.data ?? []).flatMap((f) =>
      f.orden_compra_id
        ? [[f.orden_compra_id, { facturado: Number(f.facturado ?? 0), facturas: esquemaFacturadas.catch([]).parse(f.facturas).map((x) => x.numero_documento) }] as const]
        : [],
    ),
  )
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
          facturado: facturadoDe.get(c.orden_compra_id)?.facturado ?? 0,
          facturas: facturadoDe.get(c.orden_compra_id)?.facturas ?? [],
          ruc: rucDe.get(c.orden_compra_id) ?? null,
        }]
      : [],
  )
}

/**
 * La factura de una OC con boleta que se dio por pagada fuera del sistema: no se
 * paga hasta que Contabilidad diga si esa OC ya se pagó o si falta pagarla
 * (migración 20261022175000).
 */
/** `desde`: el día que se emitió la OC; lo pagado fuera no puede ser de antes. */
export type EsperaDeLaFactura = { ordenCompraId: string; compra: string; total: number; moneda: string; desde: string | null }

/** De estas facturas (o de todas, con `null`), las que esperan a Contabilidad y por qué OC. */
async function facturasEnEspera(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[] | null): Promise<Map<string, EsperaDeLaFactura>> {
  if (ids?.length === 0) return new Map()
  const { data, error } = await supabase.rpc('facturas_en_espera', { p_facturas: ids })
  if (error) throw new Error(`No se pudo ver qué facturas esperan a Contabilidad: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((f) =>
      f.adquisicion_id && f.orden_compra_id
        ? [
            [
              f.adquisicion_id,
              { ordenCompraId: f.orden_compra_id, compra: f.compra ?? 'su OC', total: Number(f.total ?? 0), moneda: f.moneda ?? 'PEN', desde: f.desde ?? null },
            ] as const,
          ]
        : [],
    ),
  )
}

/** Una factura que Logística anexó a una OC, con su número y su fecha (migración 20261016702000). */
export type FacturaDeLogistica = {
  id: string
  orden_compra_id: string
  /** El número de la OC, o su referencia si todavía no lo tiene. */
  oc: string
  proveedor: string
  nombre_archivo: string
  /** Null en las anexadas antes del 2026-10-16, que se subieron sin número. */
  numero: string | null
  fecha: string | null
  /**
   * Ya tiene su factura en Adquisiciones, registrada o en borrador: la eligió, o
   * tiene su número y el proveedor de su OC aunque se escribieran de otra forma
   * (`situacion_de_facturas_anexadas`, migración 20261020210000). No se ofrece:
   * se registraría dos veces.
   */
  registrada: boolean
  /** El proveedor de otra factura de Adquisiciones con su mismo número: que Contabilidad mire antes de registrarla. */
  mismoNumero: string | null
  /**
   * La factura completa que su OC con boleta ya tiene registrada, de otro anexo:
   * la base no deja registrar una segunda (casi siempre es la misma con el número
   * mal escrito, y se corrige esa).
   */
  facturaDeLaOc: string | null
  /**
   * Su OC con boleta ya tiene un pago directo de Tesorería vigente: registrada,
   * la factura toma ese pago y solo debe lo que le falte (migración
   * 20261020210000). Contabilidad lo sabe antes de registrarla.
   */
  pagadaDirecto: boolean
  /** La moneda de su OC: si la factura va en otra, no toma sola lo pagado por la boleta. */
  monedaOc: string
  /** El RUC del proveedor de su OC, si está en el padrón: es el de la factura. */
  ruc: string | null
}

/**
 * Las facturas que Logística anexó a sus OC, de la más nueva a la más vieja,
 * y si Contabilidad ya las registró en Adquisiciones. Las que esperan su
 * registro son las que Contabilidad elige al registrar el comprobante.
 */
export async function facturasDeLogistica(): Promise<FacturaDeLogistica[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documentos_compra_material')
    .select('id, orden_compra_id, nombre_archivo, numero_documento, fecha_emision, oc:ordenes_compra_materiales(numero, referencia, proveedor, moneda)')
    .eq('tipo', 'FACTURA')
    .is('anulado_en', null)
    .order('creado_en', { ascending: false })
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las facturas que anexó Logística: ${error.message}`)
  const documentos = data ?? []
  // La regla vive en la base: es la misma que cierra el pago directo de la OC con boleta.
  const { data: situacion, error: errorSituacion } = documentos.length
    ? await supabase.rpc('situacion_de_facturas_anexadas', { p_documentos: documentos.map((d) => d.id) })
    : { data: [], error: null }
  if (errorSituacion) throw new Error(`No se pudo ver qué facturas de Logística ya se registraron: ${errorSituacion.message}`)
  const rucDe = await rucsDeCompras(supabase, [...new Set(documentos.map((d) => d.orden_compra_id))])
  const situacionDe = new Map((situacion ?? []).flatMap((r) => (r.documento ? [[r.documento, r] as const] : [])))
  return documentos.map((d) => ({
    id: d.id,
    orden_compra_id: d.orden_compra_id,
    oc: d.oc?.numero ?? d.oc?.referencia ?? 'OC',
    proveedor: d.oc?.proveedor ?? '',
    nombre_archivo: d.nombre_archivo,
    numero: d.numero_documento,
    fecha: d.fecha_emision,
    registrada: situacionDe.get(d.id)?.registrada ?? false,
    mismoNumero: situacionDe.get(d.id)?.mismo_numero ?? null,
    facturaDeLaOc: situacionDe.get(d.id)?.factura_de_la_oc ?? null,
    pagadaDirecto: situacionDe.get(d.id)?.pagada_directo ?? false,
    monedaOc: d.oc?.moneda ?? 'PEN',
    ruc: rucDe.get(d.orden_compra_id) ?? null,
  }))
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
  /** El de la OC o, si junta insumos de varios RQ, el de cada uno. */
  codigos: string[]
  requerimientos: RqDeCompra[]
}

/** Una factura en la tabla, con su PDF, el aviso de monto, lo pagado y cada voucher vigente. */
export type FacturaEnTabla = {
  id: string
  tipo: string
  proveedor: string
  /** El RUC de quien la emitió; null en las registradas antes del 22/10/2026 (migración 20261022170000). */
  ruc_proveedor: string | null
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
  enEspera: EsperaDeLaFactura | null
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
 * Los pagos de una factura, con el pago por la boleta del que salió el que tomó
 * del pago directo. `monto_de_la_boleta` va en el que Tesorería le pasó a mano
 * (al cambio, o descontado de lo pagado de más): lo que salió de la boleta, en
 * la moneda de la OC.
 */
const COLUMNAS_PAGO_FACTURA =
  'id, adquisicion_id, fecha, monto, monto_de_la_boleta, referencia, archivo_ruta, anulado_en, motivo_anulacion, pago_orden_compra_id, creado_en, nota_credito_id, boleta:pagos_orden_compra!pagos_adquisicion_pago_orden_compra_id_fkey(orden_compra_id, archivo_ruta, moneda), nota:notas_credito_compra!pagos_adquisicion_nota_credito_id_fkey(numero, archivo_ruta, adquisicion_id)'

/**
 * El voucher de cada pago: el suyo o, si lo tomó de la boleta, el de ese pago.
 * Lo descontado de lo pagado de más lleva la nota de crédito, que la base
 * guarda en la primera fila del descuento: las demás filas del mismo descuento
 * (misma factura, mismo momento, a mano y sin archivo) muestran esa nota, no el
 * voucher de su pago.
 */
async function conVouchers(
  // Sin voucher, el pago de la boleta que Contabilidad anotó como hecho fuera del sistema (migración 20261022175000).
  // Lo que bajó una nota de crédito lleva su nota (migración 20261022190000).
  pagos: (PagoFacturaFila & {
    boleta: { orden_compra_id: string; archivo_ruta: string | null; moneda: string } | null
    nota: { numero: string; archivo_ruta: string; adquisicion_id: string } | null
  })[],
): Promise<PagoDeFactura[]> {
  const [propios, deLaBoleta, deLaNota] = await Promise.all([
    enlaces(BUCKET_PAGOS_FACTURAS, pagos.map((p) => p.archivo_ruta)),
    enlaces(BUCKET_PAGOS_COMPRAS, pagos.map((p) => p.boleta?.archivo_ruta ?? null)),
    enlaces(BUCKET_NOTAS_CREDITO, pagos.map((p) => p.nota?.archivo_ruta ?? null)),
  ])
  const notas = pagos.filter((p) => p.pago_orden_compra_id && p.monto_de_la_boleta !== null && p.archivo_ruta)
  const notaDe = (p: PagoFacturaFila) =>
    p.pago_orden_compra_id && p.monto_de_la_boleta !== null
      ? (notas.find((n) => n.adquisicion_id === p.adquisicion_id && n.creado_en === p.creado_en) ?? null)
      : null
  return pagos.map(({ boleta, nota: notaCredito, ...p }) => {
    const nota = p.archivo_ruta ? null : notaDe(p)
    const ruta = p.archivo_ruta ?? nota?.archivo_ruta ?? null
    return {
      ...p,
      url:
        (notaCredito
          ? deLaNota.get(notaCredito.archivo_ruta)
          : ruta
            ? propios.get(ruta)
            : boleta?.archivo_ruta && deLaBoleta.get(boleta.archivo_ruta)) || null,
      esNota: Boolean(p.pago_orden_compra_id && ruta),
      notaCredito: notaCredito ? { numero: notaCredito.numero, deOtraFactura: notaCredito.adquisicion_id !== p.adquisicion_id } : null,
      ordenCompraDeLaBoleta: boleta?.orden_compra_id ?? null,
      monedaDeLaBoleta: boleta?.moneda ?? null,
    }
  })
}

/**
 * La tabla de Adquisiciones: de cada factura, sus OC y de cada OC los RQ que
 * atiende, con el enlace al PDF de la factura y a cada voucher. Las OC que
 * esperan su factura van aparte, con sus RQ; si ya están en un borrador que se
 * lista, no se repiten.
 */
export async function tablaDeAdquisiciones(sinFactura: CompraSinFactura[]): Promise<TablaDeAdquisiciones> {
  const supabase = await createClient()
  const columnas =
    'id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado, registrado_por, observacion, ruta_storage, documento_compra_id, lectura_fuente, lectura_total, lectura_moneda, lectura_numero, lectura_ordenes'
  // Las que esperan a Contabilidad salen aunque queden detrás de las cien más
  // nuevas: solo ella las saca de la espera, y Tesorería no las paga mientras tanto.
  const [{ data, error }, espera] = await Promise.all([
    supabase.from('adquisiciones').select(columnas).order('creado_en', { ascending: false }).limit(100),
    facturasEnEspera(supabase, null),
  ])
  if (error) throw new Error(`No se pudieron leer adquisiciones: ${error.message}`)
  const faltan = [...espera.keys()].filter((id) => !(data ?? []).some((a) => a.id === id))
  const atrasadas = faltan.length ? await supabase.from('adquisiciones').select(columnas).in('id', faltan) : { data: [], error: null }
  if (atrasadas.error) throw new Error(`No se pudieron leer las facturas que esperan a Contabilidad: ${atrasadas.error.message}`)
  const filas = [...(data ?? []), ...(atrasadas.data ?? [])]
  const ids = filas.map((a) => a.id)
  const [controles, urls, saldos, pagos] = await Promise.all([
    controlDeFacturas(ids),
    enlacesDeComprobantes(filas),
    ids.length ? supabase.from('v_cuentas_pagar').select('id, pagado, saldo').in('id', ids) : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from('pagos_adquisicion')
          .select(COLUMNAS_PAGO_FACTURA)
          .in('adquisicion_id', ids)
          .is('anulado_en', null)
          .order('fecha')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (saldos.error) throw new Error(`No se pudo leer lo pagado de cada factura: ${saldos.error.message}`)
  if (pagos.error) throw new Error(`No se pudieron leer los pagos de las facturas: ${pagos.error.message}`)
  const saldoDe = new Map((saldos.data ?? []).map((s) => [s.id, s]))
  const pagosConVoucher = await conVouchers(pagos.data ?? [])

  // El código interno de cada OC y los RQ que atiende, de todas las OC de la tabla.
  const idsOc = [
    ...new Set([...[...controles.values()].flatMap((c) => c.ordenes.map((o) => o.id)), ...sinFactura.map((c) => c.orden_compra_id)]),
  ]
  const [codigos, insumos] = await Promise.all([
    enTandas(idsOc, async (tanda) => {
      const r = await supabase.from('ordenes_compra_materiales').select('id, codigo_interno').in('id', tanda)
      if (r.error) throw new Error(`No se pudo leer el código interno de las OC: ${r.error.message}`)
      return r.data ?? []
    }),
    // Los RQ de cada OC con su código, también para quien no lee los requerimientos.
    idsOc.length ? supabase.rpc('insumos_de_compras', { p_ids: idsOc }) : Promise.resolve({ data: [], error: null }),
  ])
  if (insumos.error) throw new Error(`No se pudo leer qué requerimiento atiende cada OC: ${insumos.error.message}`)
  const codigoDe = new Map(codigos.map((c) => [c.id, c.codigo_interno]))
  const rqDe = new Map<string, Map<string, RqDeCompra>>()
  for (const l of insumos.data ?? []) {
    if (!l.orden_compra_id || !l.requerimiento_id || !l.requerimiento) continue
    const deLaOc = rqDe.get(l.orden_compra_id) ?? new Map<string, RqDeCompra>()
    deLaOc.set(l.requerimiento_id, { id: l.requerimiento_id, numero: l.requerimiento, codigo_interno: l.codigo_interno ?? '' })
    rqDe.set(l.orden_compra_id, deLaOc)
  }
  const oc = (o: { id: string; numero: string | null; referencia: string; moneda: string; total: number; sin_precio: boolean; numero_ot: string | null }): OcEnTabla => {
    const requerimientos = [...(rqDe.get(o.id)?.values() ?? [])].sort((a, b) => a.numero.localeCompare(b.numero))
    const propio = codigoDe.get(o.id)
    return {
      id: o.id,
      numero: o.numero ?? o.referencia,
      moneda: o.moneda,
      total: o.total,
      sin_precio: o.sin_precio,
      numero_ot: o.numero_ot,
      codigos: propio ? [propio] : [...new Set(requerimientos.map((r) => r.codigo_interno).filter(Boolean))].sort(),
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
        ruc_proveedor: a.ruc_proveedor,
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
        pagos: pagosConVoucher.filter((p) => p.adquisicion_id === a.id),
        enEspera: espera.get(a.id) ?? null,
      },
      ordenes: (control?.ordenes ?? []).map(oc),
    }
  })
  // La OC que está en un borrador sale bajo él; la que una factura registrada
  // cubre solo en parte sigue también entre las que esperan su factura.
  const listadas = new Set(facturas.filter((f) => f.factura.estado === 'BORRADOR').flatMap((f) => f.ordenes.map((o) => o.id)))
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
  | 'id' | 'adquisicion_id' | 'fecha' | 'monto' | 'monto_de_la_boleta' | 'referencia' | 'archivo_ruta' | 'anulado_en' | 'motivo_anulacion'
  | 'pago_orden_compra_id' | 'creado_en' | 'nota_credito_id'
>
/**
 * Un pago de la factura con su voucher. El que la factura tomó del pago por la
 * boleta de su OC (`pago_orden_compra_id`) lo anota el sistema: su voucher es el
 * de ese pago, y no se anula en la factura sino en la OC (migración 20261020210000).
 */
export type PagoDeFactura = PagoFacturaFila & {
  url: string | null
  /** Lo tomó de la boleta a mano con su nota de crédito o documento (la suya o la de su descuento): `url` lleva a ella. */
  esNota: boolean
  ordenCompraDeLaBoleta: string | null
  monedaDeLaBoleta: string | null
  /**
   * Lo bajó una nota de crédito del proveedor: no es dinero que salió ni se anula
   * como un pago. La de su propia factura se quita anulando la nota en
   * Adquisiciones; la descontada de otra factura, en la tarjeta de las notas de
   * Cuentas por pagar. `url` lleva al PDF de la nota.
   */
  notaCredito: { numero: string; deOtraFactura: boolean } | null
}
/** Una cuenta activa del proveedor, para que Tesorería sepa a dónde transferir. */
export type CuentaDelProveedor = Pick<Tablas<'proveedor_cuentas'>, 'id' | 'banco' | 'numero_cuenta' | 'titular' | 'moneda'>
export type CuentaPorPagar = CuentaPagarFila & {
  url: string | null
  control: ControlDeFactura | null
  /** Lo que el detector leyó de la factura al registrarla; null si no la pudo leer. */
  lectura: LecturaFactura | null
  pagos: PagoDeFactura[]
  /**
   * Las cuentas del proveedor de sus OC. La factura sin OC no tiene a quién
   * buscar: solo guarda el nombre del proveedor, y por el nombre no se adivina
   * una cuenta a la que se le transfiere dinero.
   */
  cuentasProveedor: CuentaDelProveedor[]
  /** Espera que Contabilidad diga si su OC con boleta ya se pagó fuera: mientras, no se paga. */
  enEspera: EsperaDeLaFactura | null
}

/** Las cuentas activas de esos proveedores, por proveedor. Sin `proveedores.ver_cuentas` no se piden. */
async function cuentasDeProveedores(proveedores: string[], verCuentas: boolean): Promise<Map<string, CuentaDelProveedor[]>> {
  const mapa = new Map<string, CuentaDelProveedor[]>()
  const unicos = [...new Set(proveedores)]
  if (!verCuentas || unicos.length === 0) return mapa
  const supabase = await createClient()
  const filas = await enTandas(unicos, async (tanda) => {
    const r = await supabase
      .from('proveedor_cuentas')
      .select('id, proveedor_id, banco, numero_cuenta, titular, moneda')
      .in('proveedor_id', tanda)
      .eq('activo', true)
      .order('creado_en')
    if (r.error) throw new Error(`No se pudieron leer las cuentas de los proveedores: ${r.error.message}`)
    return r.data ?? []
  })
  for (const { proveedor_id, ...c } of filas) mapa.set(proveedor_id, [...(mapa.get(proveedor_id) ?? []), c])
  return mapa
}

/** Cuántas facturas ya pagadas se muestran, de la más reciente a la más vieja. */
export const PAGADAS_A_LA_VISTA = 60

/**
 * Lo que Tesorería tiene que pagar: toda factura registrada en Adquisiciones,
 * al contado o a crédito, con sus OC, el aviso de monto, el PDF y cada pago con
 * su voucher (también los anulados, que quedan como evidencia).
 */
export async function cuentasPorPagar(verCuentas = false): Promise<CuentaPorPagar[]> {
  const supabase = await createClient()
  const columnas = 'id, numero_ot, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, pagado, saldo, condicion_pago, tipo'
  // Lo que falta pagar va entero, filtrado en la base; lo ya pagado, solo lo
  // último. Antes las dos iban juntas, de la más vieja a la más nueva y con
  // tope de 300: con el tiempo las pagadas viejas llenaban la lista y las
  // facturas nuevas por pagar, y su total, desaparecían sin aviso.
  const [pendientes, pagadas] = await Promise.all([
    supabase.from('v_cuentas_pagar').select(columnas).gt('saldo', 0).order('fecha_vencimiento'),
    supabase.from('v_cuentas_pagar').select(columnas).lte('saldo', 0)
      .order('fecha_emision', { ascending: false }).limit(PAGADAS_A_LA_VISTA),
  ])
  const error = pendientes.error ?? pagadas.error
  if (error) throw new Error(`No se pudieron leer las cuentas por pagar: ${error.message}`)
  const filas = [...(pendientes.data ?? []), ...(pagadas.data ?? [])]
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const [pagos, comprobantes, controles, espera] = await Promise.all([
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('pagos_adquisicion')
        .select(COLUMNAS_PAGO_FACTURA)
        .in('adquisicion_id', tanda)
        .order('fecha')
      if (r.error) throw new Error(`No se pudieron leer los pagos de las facturas: ${r.error.message}`)
      return r.data ?? []
    }),
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('adquisiciones')
        .select('id, ruta_storage, documento_compra_id, lectura_fuente, lectura_total, lectura_moneda, lectura_numero, lectura_ordenes')
        .in('id', tanda)
      if (r.error) throw new Error(`No se pudieron leer las facturas: ${r.error.message}`)
      return r.data ?? []
    }),
    controlDeFacturas(ids),
    facturasEnEspera(supabase, ids),
  ])
  const [pagosConVoucher, pdfs] = await Promise.all([conVouchers(pagos), enlacesDeComprobantes(comprobantes)])
  const lecturas = new Map(comprobantes.map((a) => [a.id, lecturaDeFila(a)]))
  // El proveedor de la factura es el de sus OC: la factura solo guarda su nombre.
  const idsOc = [...new Set([...controles.values()].flatMap((c) => c.ordenes.map((o) => o.id)))]
  const proveedorDeOc = new Map<string, string>()
  if (verCuentas && idsOc.length > 0) {
    const ocs = await enTandas(idsOc, async (tanda) => {
      const r = await supabase.from('ordenes_compra_materiales').select('id, proveedor_id').in('id', tanda)
      if (r.error) throw new Error(`No se pudo leer el proveedor de las OC: ${r.error.message}`)
      return r.data ?? []
    })
    for (const o of ocs) if (o.proveedor_id) proveedorDeOc.set(o.id, o.proveedor_id)
  }
  const cuentas = await cuentasDeProveedores([...proveedorDeOc.values()], verCuentas)
  return filas.map((f) => {
    const control = (f.id && controles.get(f.id)) || null
    const proveedores = [...new Set((control?.ordenes ?? []).flatMap((o) => proveedorDeOc.get(o.id) ?? []))]
    return {
      ...f,
      url: (f.id && pdfs.get(f.id)) || null,
      control,
      lectura: (f.id && lecturas.get(f.id)) || null,
      pagos: pagosConVoucher.filter((p) => p.adquisicion_id === f.id),
      cuentasProveedor: proveedores.flatMap((p) => cuentas.get(p) ?? []),
      enEspera: (f.id && espera.get(f.id)) || null,
    }
  })
}

type CompraConBoletaFila = Funciones<'compras_con_boleta_por_pagar'>['Returns'][number]
type PagoCompraFila = Pick<
  Tablas<'pagos_orden_compra'>,
  | 'id' | 'orden_compra_id' | 'fecha_pago' | 'moneda' | 'monto' | 'cancela' | 'cancela_sin_completar' | 'operacion'
  | 'comprobante_proveedor' | 'archivo_ruta' | 'anulado_en' | 'motivo_anulacion' | 'pagado_fuera'
>
/**
 * La boleta, nota de venta o recibo que Logística adjuntó a la OC, o el
 * comprobante que el proveedor entregó después y que la saca del pago directo:
 * la factura que anexó Logística o el que Contabilidad tiene en borrador.
 */
export type ComprobanteDeCompra = {
  id: string
  tipo: 'COMPROBANTE' | 'FACTURA' | 'BORRADOR'
  nombre: string
  numero: string | null
  url: string | null
  /** El borrador al que Contabilidad todavía no le subió su PDF. */
  sinPdf?: boolean
}
/**
 * Una factura que tomó parte de un pago por la boleta: la de la compra, sola o
 * al cambio, o otra factura del proveedor en que se descontó lo pagado de más
 * (undécima vuelta). `monto` va en la moneda de la factura; `deLaBoleta`, en la
 * de la OC.
 */
export type TomaDelPago = {
  id: string
  facturaId: string
  factura: string
  moneda: string
  monto: number
  deLaBoleta: number
  aMano: boolean
  /** La factura es de la compra (sola o al cambio); si no, otra del proveedor en que se descontó. */
  deLaCompra: boolean
}
type DevolucionFila = Pick<
  Tablas<'devoluciones_orden_compra'>,
  'id' | 'orden_compra_id' | 'fecha' | 'moneda' | 'monto' | 'operacion' | 'deja_pagada' | 'archivo_ruta' | 'anulado_en' | 'motivo_anulacion'
>
export type CompraConBoleta = CompraConBoletaFila & {
  pagos: (PagoCompraFila & { url: string | null; tomas: TomaDelPago[] })[]
  /** Lo que el proveedor devolvió de lo pagado por la boleta, con su constancia; las anuladas también. */
  devoluciones: (DevolucionFila & { url: string | null })[]
  comprobantes: ComprobanteDeCompra[]
  cuentasProveedor: CuentaDelProveedor[]
}

/**
 * Las OC con boleta que Tesorería paga directo, como la OS (migración
 * 20261020210000): con lo pagado y cada voucher, las facturas que tomaron cada
 * pago, lo que el proveedor devolvió con su constancia, la boleta que adjuntó
 * Logística (o el comprobante que llegó después, también el borrador de
 * Contabilidad con su PDF) y las cuentas del proveedor.
 */
export async function comprasConBoletaPorPagar(verCuentas: boolean): Promise<CompraConBoleta[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compras_con_boleta_por_pagar')
  if (error) throw new Error(`No se pudieron leer las OC con boleta: ${error.message}`)
  const filas = data ?? []
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const [pagos, devoluciones, comprobantes, cuentas] = await Promise.all([
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('pagos_orden_compra')
        .select('id, orden_compra_id, fecha_pago, moneda, monto, cancela, cancela_sin_completar, operacion, comprobante_proveedor, archivo_ruta, anulado_en, motivo_anulacion, pagado_fuera')
        .in('orden_compra_id', tanda)
        .order('fecha_pago')
        .order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer los pagos de las OC: ${r.error.message}`)
      return r.data ?? []
    }),
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('devoluciones_orden_compra')
        .select('id, orden_compra_id, fecha, moneda, monto, operacion, deja_pagada, archivo_ruta, anulado_en, motivo_anulacion')
        .in('orden_compra_id', tanda)
        .order('fecha')
        .order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer las devoluciones de los proveedores: ${r.error.message}`)
      return r.data ?? []
    }),
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('documentos_compra_material')
        .select('id, orden_compra_id, tipo, nombre_archivo, numero_documento, ruta_storage')
        .in('orden_compra_id', tanda)
        .in('tipo', ['COMPROBANTE', 'FACTURA'])
        // El que Logística anuló ya no cuenta para el pago (migración 20261020210000).
        .is('anulado_en', null)
        .order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer las boletas de las OC: ${r.error.message}`)
      return r.data ?? []
    }),
    cuentasDeProveedores(filas.flatMap((f) => (f.proveedor_id ? [f.proveedor_id] : [])), verCuentas),
  ])
  // El borrador de Contabilidad: su PDF está en su bucket o es la factura que anexó Logística.
  const borrador = (f: CompraConBoletaFila, bucket: string) =>
    f.comprobante_en_camino_origen === 'BORRADOR' && f.comprobante_en_camino_bucket === bucket ? f.comprobante_en_camino_ruta : null
  // Las facturas que tomaron cada pago vigente, sola o a mano.
  const vigentes = pagos.flatMap((p) => (p.anulado_en ? [] : [p.id]))
  const tomas = await enTandas(vigentes, async (tanda) => {
    const r = await supabase
      .from('pagos_adquisicion')
      .select('id, adquisicion_id, pago_orden_compra_id, monto, monto_de_la_boleta, referencia, factura:adquisiciones!pagos_adquisicion_adquisicion_id_fkey(numero_documento, moneda)')
      .in('pago_orden_compra_id', tanda)
      .is('anulado_en', null)
      .order('creado_en')
    if (r.error) throw new Error(`No se pudo leer qué facturas tomaron los pagos de las OC: ${r.error.message}`)
    return r.data ?? []
  })
  const [vouchers, pdfs, borradores] = await Promise.all([
    enlaces(BUCKET_PAGOS_COMPRAS, [...pagos.map((p) => p.archivo_ruta), ...devoluciones.map((d) => d.archivo_ruta)]),
    enlaces('documentos-compras', [...comprobantes.map((b) => b.ruta_storage), ...filas.map((f) => borrador(f, 'documentos-compras'))]),
    enlaces('comprobantes-financieros', filas.map((f) => borrador(f, 'comprobantes-financieros'))),
  ])
  return filas.map((f) => {
    const propios = comprobantes.filter((b) => b.orden_compra_id === f.id)
    const rutaBorrador = f.comprobante_en_camino_origen === 'BORRADOR' ? f.comprobante_en_camino_ruta : null
    const enBorrador: ComprobanteDeCompra[] =
      f.comprobante_en_camino_origen === 'BORRADOR' && !propios.some((b) => b.ruta_storage === rutaBorrador)
        ? [
            {
              id: `borrador-${f.id}`,
              tipo: 'BORRADOR',
              nombre: 'Comprobante en borrador',
              numero: f.comprobante_en_camino,
              url: (rutaBorrador && (f.comprobante_en_camino_bucket === 'comprobantes-financieros' ? borradores : pdfs).get(rutaBorrador)) || null,
              sinPdf: !rutaBorrador,
            },
          ]
        : []
    return {
      ...f,
      pagos: pagos
        .filter((p) => p.orden_compra_id === f.id)
        .map((p) => ({
          ...p,
          url: (p.archivo_ruta && vouchers.get(p.archivo_ruta)) || null,
          tomas: tomas
            .filter((x) => x.pago_orden_compra_id === p.id)
            .map((x) => ({
              id: x.id,
              facturaId: x.adquisicion_id,
              factura: x.factura?.numero_documento ?? 'su factura',
              moneda: x.factura?.moneda ?? f.moneda ?? 'PEN',
              monto: Number(x.monto),
              deLaBoleta: Number(x.monto_de_la_boleta ?? x.monto),
              aMano: x.monto_de_la_boleta !== null,
              // La toma a mano lleva en la referencia si fue al cambio o descontada (`tomar_pago_de_la_boleta`).
              deLaCompra: x.monto_de_la_boleta === null || (x.referencia ?? '').startsWith('Tomado al cambio'),
            })),
        })),
      devoluciones: devoluciones.filter((d) => d.orden_compra_id === f.id).map((d) => ({ ...d, url: vouchers.get(d.archivo_ruta) ?? null })),
      comprobantes: [
        ...propios.map((b) => ({
          id: b.id,
          tipo: b.tipo === 'FACTURA' ? ('FACTURA' as const) : ('COMPROBANTE' as const),
          nombre: b.nombre_archivo,
          numero: b.numero_documento,
          url: pdfs.get(b.ruta_storage) ?? null,
        })),
        ...enBorrador,
      ],
      cuentasProveedor: (f.proveedor_id && cuentas.get(f.proveedor_id)) || [],
    }
  })
}
