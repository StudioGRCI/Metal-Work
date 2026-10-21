import 'server-only'

import { z } from 'zod'

import { enlaces } from '@/lib/datos/facturacion'
import { BUCKET_PAGOS_COMPRAS, BUCKET_PAGOS_FACTURAS } from '@/lib/dominio/finanzas'
import { lecturaDeFila, type LecturaFactura } from '@/lib/dominio/lectura-factura'
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
        }]
      : [],
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
  /** Contabilidad ya la registró: la eligió, o registró una factura con su número para el mismo proveedor. */
  registrada: boolean
}

const mismoProveedor = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase()

/**
 * Las facturas que Logística anexó a sus OC, de la más nueva a la más vieja,
 * y si Contabilidad ya las registró en Adquisiciones. Las que esperan su
 * registro son las que Contabilidad elige al registrar el comprobante.
 */
export async function facturasDeLogistica(): Promise<FacturaDeLogistica[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('documentos_compra_material')
    .select('id, orden_compra_id, nombre_archivo, numero_documento, fecha_emision, oc:ordenes_compra_materiales(numero, referencia, proveedor)')
    .eq('tipo', 'FACTURA')
    .order('creado_en', { ascending: false })
    .limit(300)
  if (error) throw new Error(`No se pudieron leer las facturas que anexó Logística: ${error.message}`)
  const documentos = data ?? []
  const ids = documentos.map((d) => d.id)
  const numeros = [...new Set(documentos.flatMap((d) => (d.numero_documento ? [d.numero_documento] : [])))]
  const [porDocumento, porNumero] = await Promise.all([
    enTandas(ids, async (tanda) => {
      const r = await supabase.from('adquisiciones').select('documento_compra_id').in('documento_compra_id', tanda)
      if (r.error) throw new Error(`No se pudo ver qué facturas de Logística ya se registraron: ${r.error.message}`)
      return r.data ?? []
    }),
    enTandas(numeros, async (tanda) => {
      const r = await supabase.from('adquisiciones').select('numero_documento, proveedor').in('numero_documento', tanda)
      if (r.error) throw new Error(`No se pudo ver qué facturas de Logística ya se registraron: ${r.error.message}`)
      return r.data ?? []
    }),
  ])
  const usadas = new Set(porDocumento.map((a) => a.documento_compra_id))
  return documentos.map((d) => ({
    id: d.id,
    orden_compra_id: d.orden_compra_id,
    oc: d.oc?.numero ?? d.oc?.referencia ?? 'OC',
    proveedor: d.oc?.proveedor ?? '',
    nombre_archivo: d.nombre_archivo,
    numero: d.numero_documento,
    fecha: d.fecha_emision,
    registrada:
      usadas.has(d.id) ||
      (d.numero_documento !== null && porNumero.some((a) => a.numero_documento === d.numero_documento && mismoProveedor(a.proveedor, d.oc?.proveedor))),
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
  'id' | 'adquisicion_id' | 'fecha' | 'monto' | 'referencia' | 'archivo_ruta' | 'anulado_en' | 'motivo_anulacion'
>
export type PagoDeFactura = PagoFacturaFila & { url: string | null }
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
  const [pagos, comprobantes, controles] = await Promise.all([
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('pagos_adquisicion')
        .select('id, adquisicion_id, fecha, monto, referencia, archivo_ruta, anulado_en, motivo_anulacion')
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
  ])
  const [vouchers, pdfs] = await Promise.all([
    enlaces(BUCKET_PAGOS_FACTURAS, pagos.map((p) => p.archivo_ruta)),
    enlacesDeComprobantes(comprobantes),
  ])
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
      pagos: pagos
        .filter((p) => p.adquisicion_id === f.id)
        .map((p) => ({ ...p, url: (p.archivo_ruta && vouchers.get(p.archivo_ruta)) || null })),
      cuentasProveedor: proveedores.flatMap((p) => cuentas.get(p) ?? []),
    }
  })
}

type CompraConBoletaFila = Funciones<'compras_con_boleta_por_pagar'>['Returns'][number]
type PagoCompraFila = Pick<
  Tablas<'pagos_orden_compra'>,
  | 'id' | 'orden_compra_id' | 'fecha_pago' | 'moneda' | 'monto' | 'cancela' | 'operacion' | 'comprobante_proveedor'
  | 'archivo_ruta' | 'anulado_en' | 'motivo_anulacion'
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
}
export type CompraConBoleta = CompraConBoletaFila & {
  pagos: (PagoCompraFila & { url: string | null })[]
  comprobantes: ComprobanteDeCompra[]
  cuentasProveedor: CuentaDelProveedor[]
}

/**
 * Las OC con boleta que Tesorería paga directo, como la OS (migración
 * 20261020210000): con lo pagado y cada voucher, la boleta que adjuntó
 * Logística (o el comprobante que llegó después, también el borrador de
 * Contabilidad con su PDF) y las cuentas del proveedor.
 */
export async function comprasConBoletaPorPagar(verCuentas: boolean): Promise<CompraConBoleta[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compras_con_boleta_por_pagar')
  if (error) throw new Error(`No se pudieron leer las OC con boleta: ${error.message}`)
  const filas = data ?? []
  const ids = filas.flatMap((f) => (f.id ? [f.id] : []))
  const [pagos, comprobantes, cuentas] = await Promise.all([
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('pagos_orden_compra')
        .select('id, orden_compra_id, fecha_pago, moneda, monto, cancela, operacion, comprobante_proveedor, archivo_ruta, anulado_en, motivo_anulacion')
        .in('orden_compra_id', tanda)
        .order('fecha_pago')
        .order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer los pagos de las OC: ${r.error.message}`)
      return r.data ?? []
    }),
    enTandas(ids, async (tanda) => {
      const r = await supabase
        .from('documentos_compra_material')
        .select('id, orden_compra_id, tipo, nombre_archivo, numero_documento, ruta_storage')
        .in('orden_compra_id', tanda)
        .in('tipo', ['COMPROBANTE', 'FACTURA'])
        .order('creado_en')
      if (r.error) throw new Error(`No se pudieron leer las boletas de las OC: ${r.error.message}`)
      return r.data ?? []
    }),
    cuentasDeProveedores(filas.flatMap((f) => (f.proveedor_id ? [f.proveedor_id] : [])), verCuentas),
  ])
  // El borrador de Contabilidad: su PDF está en su bucket o es la factura que anexó Logística.
  const borrador = (f: CompraConBoletaFila, bucket: string) =>
    f.comprobante_en_camino_origen === 'BORRADOR' && f.comprobante_en_camino_bucket === bucket ? f.comprobante_en_camino_ruta : null
  const [vouchers, pdfs, borradores] = await Promise.all([
    enlaces(BUCKET_PAGOS_COMPRAS, pagos.map((p) => p.archivo_ruta)),
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
            },
          ]
        : []
    return {
      ...f,
      pagos: pagos.filter((p) => p.orden_compra_id === f.id).map((p) => ({ ...p, url: vouchers.get(p.archivo_ruta) ?? null })),
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
