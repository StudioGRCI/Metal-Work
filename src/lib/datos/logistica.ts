import 'server-only'

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
  /** Lo que hizo Almacén con lo que dejó el conductor; null mientras no lo deja. */
  validacion: ValidacionIngreso
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
  for (let i = 0; i < ids.length; i += 150) {
    const tanda = await supabase.from('ordenes_compra_materiales').select('id, con_factura, codigo_interno').in('id', ids.slice(i, i + 150))
    if (tanda.error) throw new Error(`No se pudo leer el comprobante de las compras: ${tanda.error.message}`)
    for (const fila of tanda.data ?? []) datosCompra.set(fila.id, fila)
  }
  // Qué RQ atiende cada compra: también aparte, con la misma tanda.
  const rqPorCompra = new Map<string, Set<string>>()
  for (let i = 0; i < ids.length; i += 150) {
    const tanda = await supabase
      .from('requerimiento_lineas')
      .select('orden_compra_id, requerimiento:requerimientos(numero)')
      .in('orden_compra_id', ids.slice(i, i + 150))
    if (tanda.error) throw new Error(`No se pudo leer qué requerimiento atiende cada compra: ${tanda.error.message}`)
    for (const fila of tanda.data ?? []) {
      if (!fila.orden_compra_id || !fila.requerimiento?.numero) continue
      rqPorCompra.set(fila.orden_compra_id, (rqPorCompra.get(fila.orden_compra_id) ?? new Set()).add(fila.requerimiento.numero))
    }
  }
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
    requerimientos: [...(rqPorCompra.get(c.id ?? '') ?? [])].sort(),
    validacion: validacionDeCompra(estadosPorCompra.get(c.id ?? '') ?? []),
  }))
}

/** Lo que el conductor necesita para ir, recoger y dejar. Sin precios. */
export type LineaRecojo = { material_codigo: string | null; material: string | null; unidad: string | null; cantidad: number; orden: string | null }
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
  recogido_en: string | null
  dejado_en: string | null
  fecha_estimada: string | null
  ordenes: string[]
  lineas: LineaRecojo[]
  /** Con factura se pide la factura; sin factura, boleta, nota de venta o recibo. */
  con_factura: boolean
  comprobante_adjunto: boolean
  codigo_interno: string | null
}

export async function cargarRecojos(): Promise<CompraParaRecojo[]> {
  const supabase = await createClient()
  // `datos_de_recojo` trae lo que se sumó después (el comprobante y el código
  // interno) con el mismo permiso y filtro: la forma de `compras_para_recojo` no
  // cambia sin borrarla.
  const [{ data, error }, extra] = await Promise.all([supabase.rpc('compras_para_recojo'), supabase.rpc('datos_de_recojo')])
  if (error) throw new Error(`No se pudieron leer los recojos: ${error.message}`)
  if (extra.error) throw new Error(`No se pudo leer el comprobante de los recojos: ${extra.error.message}`)
  const extraPorCompra = new Map((extra.data ?? []).map((e) => [e.id, e]))
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
    recogido_en: c.recogido_en,
    dejado_en: c.dejado_en,
    fecha_estimada: c.fecha_estimada,
    ordenes: c.ordenes ?? [],
    lineas: ((c.lineas as LineaRecojo[] | null) ?? []).map((l) => ({ ...l, cantidad: Number(l.cantidad) })),
    con_factura: extraPorCompra.get(c.id)?.con_factura ?? true,
    comprobante_adjunto: extraPorCompra.get(c.id)?.comprobante_adjunto === true,
    codigo_interno: extraPorCompra.get(c.id)?.codigo_interno ?? null,
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
}

export async function cargarOrdenesServicio(): Promise<OrdenServicioListada[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ordenes_servicio_listado')
  if (error) throw new Error(`No se pudieron leer las órdenes de servicio: ${error.message}`)
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
