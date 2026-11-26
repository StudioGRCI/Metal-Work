import 'server-only'

import type { DetraccionDeServicio, OrigenDelCambio, TipoDetraccion } from '@/lib/dominio/detraccion'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import { BUCKET_DOCUMENTOS_SERVICIO } from '@/lib/dominio/finanzas'
import { BUCKET_FOTOS_RECOJO, validacionDeCompra, type ValidacionIngreso } from '@/lib/dominio/logistica'
import { createClient } from '@/lib/supabase/server'

/** Una orden de compra en el listado de Logística: número, para qué y en qué va. */
export type OrdenCompraListada = {
  id: string
  /** El número de la casa; vacío en la OC de antes de la serie, que se nombra por su referencia. */
  numero: string | null
  referencia: string
  /** «OC-0005-MW» u «OC sin número (ref. del proveedor …)», para los títulos y las frases. */
  nombre: string
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
  facturas: { id: string; numero: string; fecha: string | null }[]
  /** Las facturas que Contabilidad registró en Adquisiciones con esta OC y no están anexadas aquí: registradas, sin su PDF en la OC. */
  registradas: string[]
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
  const facturasDe = new Map<string, { id: string; numero: string; fecha: string | null }[]>()
  const registradasDe = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 150) {
    const [tanda, facturas, registradas] = await Promise.all([
      supabase.from('ordenes_compra_materiales').select('id, con_factura, codigo_interno').in('id', ids.slice(i, i + 150)),
      supabase
        .from('documentos_compra_material')
        .select('id, orden_compra_id, numero_documento, fecha_emision')
        .eq('tipo', 'FACTURA')
        .not('numero_documento', 'is', null)
        .is('anulado_en', null)
        .in('orden_compra_id', ids.slice(i, i + 150))
        .order('fecha_emision'),
      // La factura que Contabilidad registró en Adquisiciones: en la OC salía «Factura pendiente» (27/10/2026).
      supabase
        .from('adquisiciones_ordenes_compra')
        .select('orden_compra_id, adquisicion:adquisiciones!inner(numero_documento, estado)')
        .is('quitada_en', null)
        .eq('adquisicion.estado', 'REGISTRADA')
        .in('orden_compra_id', ids.slice(i, i + 150)),
    ])
    if (tanda.error) throw new Error(`No se pudo leer el comprobante de las compras: ${tanda.error.message}`)
    if (facturas.error) throw new Error(`No se pudieron leer las facturas anexadas a las compras: ${facturas.error.message}`)
    if (registradas.error) throw new Error(`No se pudieron leer las facturas registradas de las compras: ${registradas.error.message}`)
    for (const r of registradas.data ?? []) {
      const numero = (r.adquisicion as { numero_documento: string } | null)?.numero_documento
      if (numero) registradasDe.set(r.orden_compra_id, [...(registradasDe.get(r.orden_compra_id) ?? []), numero])
    }
    for (const fila of tanda.data ?? []) datosCompra.set(fila.id, fila)
    for (const f of facturas.data ?? []) {
      if (!f.numero_documento) continue
      facturasDe.set(f.orden_compra_id, [...(facturasDe.get(f.orden_compra_id) ?? []), { id: f.id, numero: f.numero_documento, fecha: f.fecha_emision }])
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
    numero: c.numero?.trim() || null,
    referencia: c.referencia ?? '',
    nombre: nombreDeOc({ numero: c.numero?.trim() || null, referencia: c.referencia }),
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
    registradas: (registradasDe.get(c.id ?? '') ?? []).filter((n) => !(facturasDe.get(c.id ?? '') ?? []).some((f) => f.numero === n)),
    validacion: validacionDeCompra(estadosPorCompra.get(c.id ?? '') ?? []),
  }))
}

/** Lo que el conductor necesita para ir, recoger y dejar. Sin precios. */
export type LineaRecojo = { material_codigo: string | null; material: string | null; unidad: string | null; cantidad: number; orden: string | null }

/** Una foto que el conductor tomó al recogerla, con su enlace firmado por una hora. */
export type FotoDeRecojo = { ruta: string; url: string | null }

/** La última vez que el conductor no pudo recogerla, y cuántas van. */
export type RecojoNoLogrado = { motivo: string; registrado_en: string; salio_en: string | null; quien: string | null; veces: number }

/** La guía de remisión vigente de una compra, cargada por Contabilidad. */
export type GuiaRemision = { id: string; numero: string; fecha: string; nombre_archivo: string; cargada_en: string }

export type CompraParaRecojo = {
  id: string
  /** El número de la casa; vacío en la OC de antes de la serie, que se nombra por su referencia. */
  numero: string | null
  referencia: string
  /** «OC-0005-MW» u «OC sin número (ref. del proveedor …)», para los títulos y las frases. */
  nombre: string
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
  /** Cuándo Logística la puso en la lista: cambia cada vez que la vuelve a programar. */
  programado_en: string | null
  /** 1.º, 2.º… entre las pendientes de recojo que están en la lista; vacío si no. */
  lugar: number | null
  /** El peso que puso Logística; se queda aunque la saque de la lista. */
  peso_kg: number | null
  guia: GuiaRemision | null
  guias_anuladas: number
  /** Lo que fotografió al recogerla (opcional). */
  fotos: FotoDeRecojo[]
  /** Si alguna vez no se pudo recoger: lo último que dijo el conductor. */
  no_logrado: RecojoNoLogrado | null
}

/**
 * Las compras con el conductor —pendientes, en recojo y recogidas— y las que
 * dejó en almacén esta semana, con su lugar en la lista, su peso y su guía de
 * remisión (migración 20261015140000). La misma lista la leen Logística, que la
 * programa; Contabilidad, que carga la guía; y el conductor, que la recoge.
 */
/** PostgREST no conoce la función (PGRST202), o Postgres no la tiene (42883). */
const faltaLaFuncion = (e: { code?: string }) => e.code === 'PGRST202' || e.code === '42883'

export async function cargarRecojos(): Promise<CompraParaRecojo[]> {
  const supabase = await createClient()
  // Las fotos y los intentos van en sus funciones, con el mismo permiso: no cambian las columnas de compras_en_gestion.
  const [{ data, error }, fotos, intentos] = await Promise.all([
    supabase.rpc('compras_en_gestion'),
    supabase.rpc('recojo_fotos_en_gestion'),
    supabase.rpc('recojos_no_logrados_en_gestion'),
  ])
  if (error) throw new Error(`No se pudieron leer los recojos: ${error.message}`)
  // Si el despliegue llega antes que la migración 20261125500000, la lista se
  // sigue viendo sin fotos ni intentos, en vez de caerse la pantalla entera.
  if (fotos.error && !faltaLaFuncion(fotos.error)) throw new Error(`No se pudieron leer las fotos de los recojos: ${fotos.error.message}`)
  if (intentos.error && !faltaLaFuncion(intentos.error)) throw new Error(`No se pudo leer qué recojos no se lograron: ${intentos.error.message}`)
  const [insumos, enlaces] = await Promise.all([
    insumosPorCompra(supabase, (data ?? []).flatMap((c) => (c.id && !c.codigo_interno ? [c.id] : []))),
    enlacesDeFotosDeRecojo(supabase, (fotos.data ?? []).flatMap((f) => (f.ruta ? [f.ruta] : []))),
  ])
  const fotosDe = new Map<string, FotoDeRecojo[]>()
  for (const f of fotos.data ?? []) {
    if (!f.orden_compra_id || !f.ruta) continue
    fotosDe.set(f.orden_compra_id, [...(fotosDe.get(f.orden_compra_id) ?? []), { ruta: f.ruta, url: enlaces[f.ruta] ?? null }])
  }
  // Vienen del más reciente al más viejo: el primero de cada compra es el que se muestra.
  const noLogradoDe = new Map<string, RecojoNoLogrado>()
  for (const n of intentos.data ?? []) {
    if (!n.orden_compra_id || !n.motivo || !n.registrado_en) continue
    const antes = noLogradoDe.get(n.orden_compra_id)
    if (antes) antes.veces += 1
    else
      noLogradoDe.set(n.orden_compra_id, {
        motivo: n.motivo,
        registrado_en: n.registrado_en,
        salio_en: n.salio_en,
        quien: n.registrado_por_nombre,
        veces: 1,
      })
  }
  return (data ?? []).map((c) => ({
    id: c.id ?? '',
    numero: c.numero?.trim() || null,
    referencia: c.referencia ?? '',
    nombre: nombreDeOc({ numero: c.numero?.trim() || null, referencia: c.referencia }),
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
    // La que vale hoy: la corregida, si Logística la corrigió (20261126946000).
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
    programado_en: c.programado_en ?? null,
    lugar: c.lugar,
    peso_kg: c.peso_kg === null ? null : Number(c.peso_kg),
    guia:
      c.guia_id && c.guia_numero
        ? { id: c.guia_id, numero: c.guia_numero, fecha: c.guia_fecha ?? '', nombre_archivo: c.guia_nombre_archivo ?? '', cargada_en: c.guia_cargada_en ?? '' }
        : null,
    guias_anuladas: c.guias_anuladas ?? 0,
    fotos: fotosDe.get(c.id ?? '') ?? [],
    no_logrado: noLogradoDe.get(c.id ?? '') ?? null,
  }))
}

/** Los enlaces firmados de las fotos del recojo. Sin ellos la tarjeta igual sirve: dice que hay fotos. */
async function enlacesDeFotosDeRecojo(supabase: Awaited<ReturnType<typeof createClient>>, rutas: string[]) {
  const enlaces: Record<string, string> = {}
  if (rutas.length === 0) return enlaces
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_RECOJO).createSignedUrls(rutas, 3600)
  if (error || !data) {
    // La tarjeta dice que hay fotos y que no se pudieron abrir; el porqué queda en el registro del servidor.
    console.error(`No se pudieron firmar las fotos del recojo: ${error?.message ?? 'sin respuesta'}`)
    return enlaces
  }
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
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
  documentos: DocumentoDeServicio[]
}

/** La factura, la boleta, el recibo o el contrato de una OS, con su enlace (migración 20261020210000). */
export type DocumentoDeServicio = {
  id: string
  tipo: string
  numero: string | null
  nombre: string
  creado_en: string
  /** La fecha de emisión que dice el comprobante; la de la factura decide el cambio de la OS en dólares (20261126947000). */
  fecha_emision: string | null
  /** Null si la firma falló o la política de quien mira no lo deja abrir: el documento se lista igual. */
  url: string | null
  /** Storage firmó la tanda y este archivo no estaba: hay que anularlo y adjuntarlo de nuevo. */
  faltaArchivo: boolean
}

/**
 * Los documentos vigentes de esas OS, por OS, con su enlace firmado. Quien no
 * los puede ver (el RLS de la tabla) recibe la lista vacía.
 */
export async function documentosDeServicios(ids: string[]): Promise<Map<string, DocumentoDeServicio[]>> {
  const mapa = new Map<string, DocumentoDeServicio[]>()
  if (ids.length === 0) return mapa
  const supabase = await createClient()
  // De 150 en 150 para que la URL no crezca sin límite; las tandas van a la vez.
  const tandas = Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150))
  const leidas = await Promise.all(
    tandas.map(async (tanda) => {
      const { data, error } = await supabase
        .from('documentos_orden_servicio')
        .select('id, orden_servicio_id, tipo, numero, nombre_archivo, ruta_storage, creado_en, fecha_emision')
        .in('orden_servicio_id', tanda)
        .is('anulado_en', null)
        .order('creado_en')
      if (error) throw new Error(`No se pudieron leer los documentos de las órdenes de servicio: ${error.message}`)
      return data ?? []
    }),
  )
  const filas = leidas.flat()
  const urls = new Map<string, string>()
  const faltan = new Set<string>()
  if (filas.length > 0) {
    const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTOS_SERVICIO).createSignedUrls([...new Set(filas.map((f) => f.ruta_storage))], 600)
    // Sin enlace el documento se lista igual: se ve qué hay aunque no se abra. Si
    // falló la tanda entera, no se sabe qué archivo falta y no se dice que falte.
    if (error) console.error('No se pudieron firmar los documentos de las órdenes de servicio:', error.message)
    for (const e of data ?? []) {
      if (e.path && e.signedUrl) urls.set(e.path, e.signedUrl)
      else if (e.path && e.error) faltan.add(e.path)
    }
  }
  for (const f of filas) {
    const lista = mapa.get(f.orden_servicio_id) ?? []
    lista.push({
      id: f.id,
      tipo: f.tipo,
      numero: f.numero,
      nombre: f.nombre_archivo,
      creado_en: f.creado_en,
      fecha_emision: f.fecha_emision,
      url: urls.get(f.ruta_storage) ?? null,
      faltaArchivo: faltan.has(f.ruta_storage),
    })
    mapa.set(f.orden_servicio_id, lista)
  }
  return mapa
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
  'id, codigo_interno, detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo, detraccion_motivo, total_con_igv_pen, detraccion_monto, creado_en, fecha_cambio, moneda, monto, monto_pen'

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
  creado_en: string
  fecha_cambio: string | null
  moneda: string
  monto: number | null
  monto_pen: number | null
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

/**
 * En otra moneda, de dónde sale el día del cambio de la OS. Si el día que guarda la OS no es el de
 * una factura vigente —o no guarda ninguno teniendo factura—, es que su detracción ya estaba
 * depositada, o la OS pagada, cuando la factura llegó o cambió: la base ya no la mueve.
 */
function origenDelCambio(fechaCambio: string | null, documentos?: Pick<DocumentoDeServicio, 'tipo' | 'fecha_emision'>[]): OrigenDelCambio | null {
  const facturas = documentos?.filter((d) => d.tipo === 'FACTURA' && d.fecha_emision)
  if (fechaCambio !== null) return !facturas || facturas.some((d) => d.fecha_emision === fechaCambio) ? 'FACTURA' : 'DEPOSITADA_CON_OTRA'
  if (!facturas) return null
  if (facturas.length > 0) return 'DEPOSITADA_ANTES'
  // La factura adjunta antes de que se pidiera la fecha (20261126947000) no dice de qué día es.
  return documentos?.some((d) => d.tipo === 'FACTURA') ? 'FACTURA_SIN_FECHA' : 'SIN_FACTURA'
}

/** Un tipo de cambio registrado: su día y su venta. */
export type CambioRegistrado = { fecha: string; venta: number }

const diasAntes = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10)

/**
 * Los cambios registrados que les pueden tocar a esos días: el de cada día y los de los nueve
 * anteriores, como `cambio_del_dia`. Con ellos la pantalla dice de qué día es el cambio que la OS
 * lleva de verdad: la factura de hoy llega antes que el cambio de hoy y va con el de la víspera.
 */
export async function cambiosDeLosDias(dias: (string | null)[]): Promise<CambioRegistrado[]> {
  const pedidos = dias.filter((d): d is string => Boolean(d)).sort()
  if (pedidos.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tipos_de_cambio')
    .select('fecha, venta')
    .gte('fecha', diasAntes(pedidos[0], 9))
    .lte('fecha', pedidos[pedidos.length - 1])
    .order('fecha', { ascending: false })
    .limit(1000)
  if (error) throw new Error(`No se pudieron leer los tipos de cambio: ${error.message}`)
  return (data ?? []).map((c) => ({ fecha: c.fecha, venta: Number(c.venta) }))
}

/**
 * El día del cambio que la OS con factura lleva de verdad. `undefined` si no se sabe (no se
 * leyeron los cambios, o no tiene monto en soles); `null` si su monto no sale del cambio que hoy
 * le toca a ese día: quedó fija con otro cuando se depositó su detracción.
 */
function cambioQueLleva(f: FilaDetraccion, cambios?: CambioRegistrado[]): string | null | undefined {
  if (!cambios || f.fecha_cambio === null || f.monto === null || f.monto_pen === null) return undefined
  const dia = f.fecha_cambio
  const desde = diasAntes(dia, 9)
  // Vienen del más nuevo al más viejo: el primero que no pasa del día es el que le toca.
  const toca = cambios.find((c) => c.fecha <= dia && c.fecha >= desde)
  // Un céntimo de holgura: la base redondea en decimal y aquí la cuenta va en coma flotante.
  return toca && Math.abs(Number(f.monto) * toca.venta - Number(f.monto_pen)) < 0.011 ? toca.fecha : null
}

/** El origen del día del cambio y, si es el de su factura, el día del cambio que de verdad lleva. */
function origenYCambio(
  f: FilaDetraccion,
  documentos?: Pick<DocumentoDeServicio, 'tipo' | 'fecha_emision'>[],
  cambios?: CambioRegistrado[],
): Pick<DetraccionDeServicio, 'origen_del_cambio' | 'cambio_registrado_el'> {
  const origen = origenDelCambio(f.fecha_cambio, documentos)
  if (origen !== 'FACTURA') return { origen_del_cambio: origen }
  const lleva = cambioQueLleva(f, cambios)
  if (lleva === null) return { origen_del_cambio: 'DEPOSITADA_CON_OTRO_CAMBIO' }
  return { origen_del_cambio: origen, cambio_registrado_el: lleva ?? null }
}

export function detraccionDeFila(
  f: FilaDetraccion | undefined,
  tipos: TipoDetraccion[],
  /**
   * Los documentos vigentes de la OS, donde la pantalla los lee. Aprobación no los pasa: decide
   * antes de que exista la factura, y ahí no se dice que falta.
   */
  documentos?: Pick<DocumentoDeServicio, 'tipo' | 'fecha_emision'>[],
  /** Los cambios registrados (`cambiosDeLosDias`), donde la pantalla dice con cuál va la OS. */
  cambios?: CambioRegistrado[],
): DetraccionDeServicio {
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
    // El día cuyo cambio le toca: el de su factura; sin factura, el día en que se emitió.
    dia_del_cambio: f.fecha_cambio ?? f.creado_en,
    ...(f.moneda === 'PEN' ? { origen_del_cambio: null } : origenYCambio(f, documentos, cambios)),
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
  const [documentos, cambios] = await Promise.all([
    documentosDeServicios((data ?? []).flatMap((s) => (s.id ? [s.id] : []))),
    cambiosDeLosDias((extra.data ?? []).map((f) => f.fecha_cambio)),
  ])
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
    detraccion: detraccionDeFila(porId.get(s.id ?? ''), tipos, documentos.get(s.id ?? '') ?? [], cambios),
    documentos: documentos.get(s.id ?? '') ?? [],
  }))
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
