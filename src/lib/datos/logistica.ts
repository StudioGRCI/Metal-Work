import 'server-only'

import type { DetraccionDeServicio, TipoDetraccion } from '@/lib/dominio/detraccion'
import { validacionDeCompra, type ValidacionIngreso } from '@/lib/dominio/logistica'
import { createClient } from '@/lib/supabase/server'

/** Una orden de compra en el listado de Logística: número, para qué y en qué va. */
export type OrdenCompraListada = {
  id: string
  numero: string
  referencia: string
  origen: string
  proveedor: string
  proveedor_documento: string | null
  moneda: string
  monto: number
  condicion_pago: string
  dias_credito: number
  fecha_estimada: string | null
  aprobacion: string
  motivo_rechazo: string | null
  recojo: string | null
  entregado_almacen_en: string | null
  creado_en: string
  emitida_por: string | null
  motivo: string | null
  ordenes: string[]
  unidades: string[]
  lineas: number
  /** Ya tiene su comprobante: la factura o, si es sin factura, la boleta, nota de venta o recibo. */
  tiene_factura: boolean
  /** Si el proveedor da factura. Sin factura igual se adjunta un comprobante. */
  con_factura: boolean
  /** El de la unidad (PLA_SR_O4_1_26/28…) o PLANTA. Vacío en las compras de antes. */
  codigo_interno: string | null
  /** Los RQ (RQ-0001-2026…) que esta compra atiende; vacío en las que no nacen de uno. */
  requerimientos: string[]
  /** Los códigos internos de esos RQ: la OC que junta varios no tiene uno propio. */
  codigos: string[]
  /** Compra insumos de RQ línea por línea: su código es el de cada insumo y se corrige en el RQ. */
  codigo_por_insumo: boolean
  /** Las facturas que Logística le anexó, con su número y su fecha; una OC puede ir en varias. */
  facturas: { numero: string; fecha: string | null }[]
  /** Lo que hizo Almacén con lo que dejó el conductor; null mientras no lo deja. */
  validacion: ValidacionIngreso
}

type InsumosDeLaCompra = { requerimientos: string[]; codigos: string[]; porInsumo: boolean }

/**
 * Los RQ y los códigos internos de cada compra, de `insumos_de_compras`: la ve
 * quien ve las compras, aunque no lea los requerimientos.
 */
export async function insumosPorCompra(supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const porCompra = new Map<string, InsumosDeLaCompra>()
  if (ids.length === 0) return porCompra
  const { data, error } = await supabase.rpc('insumos_de_compras', { p_ids: ids })
  if (error) throw new Error(`No se pudo leer qué requerimiento atiende cada compra: ${error.message}`)
  const juntos = new Map<string, { requerimientos: Set<string>; codigos: Set<string>; porInsumo: boolean }>()
  for (const fila of data ?? []) {
    if (!fila.orden_compra_id) continue
    const j = juntos.get(fila.orden_compra_id) ?? { requerimientos: new Set<string>(), codigos: new Set<string>(), porInsumo: false }
    if (fila.requerimiento) j.requerimientos.add(fila.requerimiento)
    if (fila.codigo_interno) j.codigos.add(fila.codigo_interno)
    if (fila.detalle_id) j.porInsumo = true
    juntos.set(fila.orden_compra_id, j)
  }
  for (const [id, j] of juntos) {
    porCompra.set(id, { requerimientos: [...j.requerimientos].sort(), codigos: [...j.codigos].sort(), porInsumo: j.porInsumo })
  }
  return porCompra
}

export async function cargarOrdenesCompra(): Promise<OrdenCompraListada[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ordenes_compra_listado')
  if (error) throw new Error(`No se pudieron leer las órdenes de compra: ${error.message}`)
  // Lo que el conductor dejó y si Almacén ya lo validó.
  const dejadas = (data ?? []).filter((c) => c.recojo === 'DEJADO' && c.id).map((c) => c.id as string)
  const pendientes = dejadas.length > 0
    ? await supabase.from('ingresos_pendientes_almacen').select('orden_compra_id, estado').in('orden_compra_id', dejadas)
    : { data: [], error: null }
  if (pendientes.error) throw new Error(`No se pudo leer lo que validó Almacén: ${pendientes.error.message}`)
  // El listado de la base no trae estos dos datos (su forma no cambia sin
  // borrarla); se leen aparte, de a tandas para no alargar la URL.
  const ids = (data ?? []).map((c) => c.id).filter((id): id is string => Boolean(id))
  const datosCompra = new Map<string, { con_factura: boolean; codigo_interno: string | null }>()
  const facturasDe = new Map<string, { numero: string; fecha: string | null }[]>()
  for (let i = 0; i < ids.length; i += 150) {
    const [tanda, facturas] = await Promise.all([
      supabase.from('ordenes_compra_materiales').select('id, con_factura, codigo_interno').in('id', ids.slice(i, i + 150)),
      supabase
        .from('documentos_compra_material')
        .select('orden_compra_id, numero_documento, fecha_emision')
        .eq('tipo', 'FACTURA')
        .not('numero_documento', 'is', null)
        .in('orden_compra_id', ids.slice(i, i + 150))
        .order('fecha_emision'),
    ])
    if (tanda.error) throw new Error(`No se pudo leer el comprobante de las compras: ${tanda.error.message}`)
    if (facturas.error) throw new Error(`No se pudieron leer las facturas anexadas a las compras: ${facturas.error.message}`)
    for (const fila of tanda.data ?? []) datosCompra.set(fila.id, fila)
    for (const f of facturas.data ?? []) {
      if (!f.numero_documento) continue
      facturasDe.set(f.orden_compra_id, [...(facturasDe.get(f.orden_compra_id) ?? []), { numero: f.numero_documento, fecha: f.fecha_emision }])
    }
  }
  // Qué RQ atiende cada compra y con qué código interno: la OC que junta
  // insumos de varios RQ los nombra a todos.
  const insumos = await insumosPorCompra(supabase, ids)
  const estadosPorCompra = new Map<string, string[]>()
  for (const fila of pendientes.data ?? []) {
    estadosPorCompra.set(fila.orden_compra_id, [...(estadosPorCompra.get(fila.orden_compra_id) ?? []), fila.estado])
  }
  return (data ?? []).map((c) => ({
    id: c.id ?? '',
    numero: c.numero ?? '',
    referencia: c.referencia ?? '',
    origen: c.origen ?? 'REQUERIMIENTO',
    proveedor: c.proveedor ?? '',
    proveedor_documento: c.proveedor_documento,
    moneda: c.moneda ?? 'PEN',
    monto: Number(c.monto ?? 0),
    condicion_pago: c.condicion_pago ?? 'CONTADO',
    dias_credito: c.dias_credito ?? 0,
    fecha_estimada: c.fecha_estimada,
    aprobacion: c.aprobacion ?? 'NO_REQUERIDA',
    motivo_rechazo: c.motivo_rechazo,
    recojo: c.recojo,
    entregado_almacen_en: c.entregado_almacen_en,
    creado_en: c.creado_en ?? '',
    emitida_por: c.emitida_por,
    motivo: c.motivo,
    ordenes: c.ordenes ?? [],
    unidades: c.unidades ?? [],
    lineas: c.lineas ?? 0,
    tiene_factura: c.tiene_factura === true,
    con_factura: datosCompra.get(c.id ?? '')?.con_factura ?? true,
    codigo_interno: datosCompra.get(c.id ?? '')?.codigo_interno ?? null,
    requerimientos: insumos.get(c.id ?? '')?.requerimientos ?? [],
    codigos: insumos.get(c.id ?? '')?.codigos ?? [],
    codigo_por_insumo: insumos.get(c.id ?? '')?.porInsumo ?? false,
    facturas: facturasDe.get(c.id ?? '') ?? [],
    validacion: validacionDeCompra(estadosPorCompra.get(c.id ?? '') ?? []),
  }))
}

/** Lo que el conductor necesita para ir, recoger y dejar. Sin precios. */
export type LineaRecojo = { material_codigo: string | null; material: string | null; unidad: string | null; cantidad: number; orden: string | null }

/** La guía de remisión vigente de una compra, cargada por Contabilidad. */
export type GuiaRemision = { id: string; numero: string; fecha: string; nombre_archivo: string; cargada_en: string }

export type CompraParaRecojo = {
  id: string
  numero: string
  referencia: string
  origen: string
  proveedor: string
  proveedor_documento: string | null
  proveedor_direccion: string | null
  proveedor_telefono: string | null
  proveedor_contacto: string | null
  recojo: string
  pedido_en: string | null
  /** Cuándo marcó «Salgo a recoger»; vacía si marcó directo que la recogió. */
  en_recojo_en: string | null
  recogido_en: string | null
  dejado_en: string | null
  fecha_estimada: string | null
  creado_en: string | null
  ordenes: string[]
  /** Los RQ (RQ-0001-2026…) que esta compra atiende. */
  requerimientos: string[]
  /** Los códigos internos de esos RQ: la OC que junta varios no tiene uno propio. */
  codigos: string[]
  lineas: LineaRecojo[]
  /** Con factura se pide la factura; sin factura, boleta, nota de venta o recibo. */
  con_factura: boolean
  comprobante_adjunto: boolean
  codigo_interno: string | null
  /** Si Logística la puso en la lista del conductor. */
  en_lista: boolean
  /** 1.º, 2.º… entre las pendientes de recojo que están en la lista; vacío si no. */
  lugar: number | null
  /** El peso que puso Logística; se queda aunque la saque de la lista. */
  peso_kg: number | null
  guia: GuiaRemision | null
  guias_anuladas: number
}

/**
 * Las compras con el conductor —pendientes, en recojo y recogidas— y las que
 * dejó en almacén esta semana, con su lugar en la lista, su peso y su guía de
 * remisión (migración 20261015140000). La misma lista la leen Logística, que la
 * programa; Contabilidad, que carga la guía; y el conductor, que la recoge.
 */
export async function cargarRecojos(): Promise<CompraParaRecojo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compras_en_gestion')
  if (error) throw new Error(`No se pudieron leer los recojos: ${error.message}`)
  const insumos = await insumosPorCompra(supabase, (data ?? []).flatMap((c) => (c.id && !c.codigo_interno ? [c.id] : [])))
  return (data ?? []).map((c) => ({
    id: c.id ?? '',
    numero: c.numero ?? '',
    referencia: c.referencia ?? '',
    origen: c.origen ?? 'REQUERIMIENTO',
    proveedor: c.proveedor ?? '',
    proveedor_documento: c.proveedor_documento,
    proveedor_direccion: c.proveedor_direccion,
    proveedor_telefono: c.proveedor_telefono,
    proveedor_contacto: c.proveedor_contacto,
    recojo: c.recojo ?? 'POR_RECOGER',
    pedido_en: c.pedido_en,
    en_recojo_en: c.en_recojo_en,
    recogido_en: c.recogido_en,
    dejado_en: c.dejado_en,
    fecha_estimada: c.fecha_estimada,
    creado_en: c.creado_en,
    ordenes: c.ordenes ?? [],
    requerimientos: c.requerimientos ?? [],
    codigos: insumos.get(c.id ?? '')?.codigos ?? [],
    lineas: ((c.lineas as LineaRecojo[] | null) ?? []).map((l) => ({ ...l, cantidad: Number(l.cantidad) })),
    con_factura: c.con_factura ?? true,
    comprobante_adjunto: c.comprobante_adjunto === true,
    codigo_interno: c.codigo_interno,
    en_lista: c.en_lista === true,
    lugar: c.lugar,
    peso_kg: c.peso_kg === null ? null : Number(c.peso_kg),
    guia:
      c.guia_id && c.guia_numero
        ? { id: c.guia_id, numero: c.guia_numero, fecha: c.guia_fecha ?? '', nombre_archivo: c.guia_nombre_archivo ?? '', cargada_en: c.guia_cargada_en ?? '' }
        : null,
    guias_anuladas: c.guias_anuladas ?? 0,
  }))
}

export type OrdenServicioListada = {
  id: string
  numero: string
  referencia: string | null
  proveedor: string
  proveedor_documento: string | null
  orden: string | null
  unidad: string | null
  area: string | null
  descripcion: string
  fecha_inicio: string | null
  fecha_fin: string | null
  moneda: string
  monto: number
  monto_pen: number | null
  condicion_pago: string
  dias_credito: number
  aprobacion: string
  motivo_rechazo: string | null
  estado: string
  motivo_anulacion: string | null
  observacion_conformidad: string | null
  creado_en: string
  emitida_por: string | null
  atrasada: boolean
  /** Vacío solo en las OS de antes de que se pidiera. */
  codigo_interno: string | null
  detraccion: DetraccionDeServicio
}

/** Los tipos de servicio con detracción, con el porcentaje y el mínimo de SUNAT. */
export async function cargarTiposDetraccion(): Promise<TipoDetraccion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('detracciones_servicio')
    .select('codigo, descripcion, porcentaje, monto_minimo, ejemplos, base_legal')
    .eq('activo', true)
    .order('orden')
  if (error) throw new Error(`No se pudieron leer los tipos de detracción: ${error.message}`)
  return (data ?? []).map((t) => ({ ...t, porcentaje: Number(t.porcentaje), monto_minimo: Number(t.monto_minimo) }))
}

/** La detracción tal como la guarda y la calcula la base. */
export const COLUMNAS_DETRACCION =
  'id, codigo_interno, detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo, detraccion_motivo, total_con_igv_pen, detraccion_monto'

type FilaDetraccion = {
  id: string
  codigo_interno: string | null
  detraccion_afecta: boolean | null
  detraccion_codigo: string | null
  detraccion_porcentaje: number | null
  detraccion_minimo: number | null
  detraccion_motivo: string | null
  total_con_igv_pen: number | null
  detraccion_monto: number | null
}

const SIN_DEFINIR: DetraccionDeServicio = {
  afecta: null,
  codigo: null,
  descripcion: null,
  porcentaje: null,
  minimo: null,
  motivo: null,
  total_con_igv_pen: null,
  monto: null,
}

export function detraccionDeFila(f: FilaDetraccion | undefined, tipos: TipoDetraccion[]): DetraccionDeServicio {
  if (!f) return SIN_DEFINIR
  const numeroONulo = (v: number | null) => (v === null ? null : Number(v))
  return {
    afecta: f.detraccion_afecta,
    codigo: f.detraccion_codigo,
    descripcion: tipos.find((t) => t.codigo === f.detraccion_codigo)?.descripcion ?? null,
    porcentaje: numeroONulo(f.detraccion_porcentaje),
    minimo: numeroONulo(f.detraccion_minimo),
    motivo: f.detraccion_motivo,
    total_con_igv_pen: numeroONulo(f.total_con_igv_pen),
    monto: numeroONulo(f.detraccion_monto),
  }
}

/**
 * Las OS con su código interno y su detracción. El listado de la base no los
 * trae (cambiarle las columnas exige borrarlo, y el conector de producción no
 * deja); se leen de la tabla, con las mismas 300 últimas.
 */
export async function cargarOrdenesServicio(): Promise<OrdenServicioListada[]> {
  const supabase = await createClient()
  const [{ data, error }, extra, tipos] = await Promise.all([
    supabase.rpc('ordenes_servicio_listado'),
    supabase.from('ordenes_servicio').select(COLUMNAS_DETRACCION).order('creado_en', { ascending: false }).limit(300),
    cargarTiposDetraccion(),
  ])
  if (error) throw new Error(`No se pudieron leer las órdenes de servicio: ${error.message}`)
  if (extra.error) throw new Error(`No se pudo leer la detracción de las órdenes de servicio: ${extra.error.message}`)
  const porId = new Map((extra.data ?? []).map((f) => [f.id, f]))
  return (data ?? []).map((s) => ({
    id: s.id ?? '',
    numero: s.numero ?? '',
    referencia: s.referencia,
    proveedor: s.proveedor ?? '',
    proveedor_documento: s.proveedor_documento,
    orden: s.orden,
    unidad: s.unidad,
    area: s.area,
    descripcion: s.descripcion ?? '',
    fecha_inicio: s.fecha_inicio,
    fecha_fin: s.fecha_fin,
    moneda: s.moneda ?? 'PEN',
    monto: Number(s.monto ?? 0),
    monto_pen: s.monto_pen === null ? null : Number(s.monto_pen),
    condicion_pago: s.condicion_pago ?? 'CONTADO',
    dias_credito: s.dias_credito ?? 0,
    aprobacion: s.aprobacion ?? 'POR_APROBAR',
    motivo_rechazo: s.motivo_rechazo,
    estado: s.estado ?? 'EMITIDA',
    motivo_anulacion: s.motivo_anulacion,
    observacion_conformidad: s.observacion_conformidad,
    creado_en: s.creado_en ?? '',
    emitida_por: s.emitida_por,
    atrasada: s.atrasada === true,
    codigo_interno: porId.get(s.id ?? '')?.codigo_interno ?? null,
    detraccion: detraccionDeFila(porId.get(s.id ?? ''), tipos),
  }))
}

export type OtParaLogistica = { id: string; numero: string; unidad: string | null }

/** Las OT vigentes, con su unidad, para referir un servicio. */
export async function otsParaLogistica(): Promise<OtParaLogistica[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ots_para_logistica')
  if (error) throw new Error(`No se pudieron leer las órdenes de trabajo: ${error.message}`)
  return (data ?? []).map((o) => ({ id: o.id ?? '', numero: o.numero ?? '', unidad: o.unidad }))
}

export type AreaSolicitante = { id: string; codigo: string; nombre: string }

/** Las áreas que piden servicios afuera. */
export async function areasSolicitantes(): Promise<AreaSolicitante[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('areas')
    .select('id, codigo, nombre')
    .eq('activo', true)
    .order('nombre')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}
