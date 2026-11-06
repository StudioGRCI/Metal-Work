import 'server-only'

import { ESTADOS_ABIERTOS } from '@/lib/datos/ordenes'
import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { AREAS_DE_PLANOS, BUCKET_DXF } from '@/lib/dominio/diseno-codigos'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

/**
 * Lo que Diseño carga por código interno: planos, materiales y etapas. Todo
 * sale de las funciones de la migración 20261015200000, que dejan leer a
 * Diseño (`diseno.codigos`), a Gerencia (`codigos_internos.ver`) y al
 * supervisor (`codigos_internos.area`, solo los planos de su área). De quién
 * recibió un plano se muestra el área, no la persona.
 */

const n = (v: number | null | undefined) => Number(v ?? 0)

/** Un código con lo que Diseño lleva en él. */
export type CodigoDeDiseno = {
  codigo: string
  unidad: string | null
  planos: number
  planos_por_recibir: number
  materiales: number
  etapas: number
  etapas_terminadas: number
  etapas_vencidas: number
  etapa_actual: string | null
  etapa_actual_area: string | null
  etapa_actual_fin: string | null
  ultimo_cambio: string | null
}

/** Una fila de `codigos_internos_de_diseno`, como la lleva la pantalla. */
type FilaDeDiseno = Database['public']['Functions']['codigos_internos_de_diseno']['Returns'][number]

/** La fila de la base, con sus números como números; sin código no hay fila. */
export function codigoDeDiseno(f: FilaDeDiseno): CodigoDeDiseno[] {
  return f.codigo
    ? [
        {
          codigo: f.codigo,
          unidad: f.unidad,
          planos: n(f.planos),
          planos_por_recibir: n(f.planos_por_recibir),
          materiales: n(f.materiales),
          etapas: n(f.etapas),
          etapas_terminadas: n(f.etapas_terminadas),
          etapas_vencidas: n(f.etapas_vencidas),
          etapa_actual: f.etapa_actual,
          etapa_actual_area: f.etapa_actual_area,
          etapa_actual_fin: f.etapa_actual_fin,
          ultimo_cambio: f.ultimo_cambio,
        },
      ]
    : []
}

/** Todos los códigos de unidad del sistema, con los que Diseño movió hace poco primero. */
export async function codigosDeDiseno(): Promise<CodigoDeDiseno[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('codigos_internos_de_diseno'), ['ultimo_cambio.desc.nullslast', 'codigo'])
  if (error) throw new Error(`No se pudieron leer los códigos internos de Diseño: ${error.message}`)
  return (data ?? []).flatMap(codigoDeDiseno)
}

/** Un plano con su revisión vigente. */
export type PlanoDeCodigo = {
  id: string
  codigo: string
  numero: string
  nombre: string
  area_id: string
  area: string
  area_codigo: string
  observacion: string | null
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  revisiones: number
  revision_id: string | null
  revision: number
  nombre_archivo: string | null
  tamano_bytes: number | null
  cambios: string | null
  subido_en: string | null
  recibido_en: string | null
  recibido_por_area: string | null
  /** El porcentaje de la unidad que representa; vacío en los planos de antes del 2026-10-20. */
  peso: number | null
}

/** Los planos de un código, o todos los que la persona ve si no se da código. Sin `conPeso` no se lee su % (donde solo se cuentan). */
export async function planosDeCodigo(codigo: string | null, { conPeso = true }: { conPeso?: boolean } = {}): Promise<PlanoDeCodigo[]> {
  const supabase = await createClient()
  // El peso no está en la función (su firma no se puede cambiar en producción):
  // se lee de la tabla, con el mismo RLS que deja ver el plano, a la vez y por
  // código (no por la lista de ids, que alarga la URL hasta romperla).
  // Sin código son los planos de todos: se leen enteros, que pasan de mil.
  const delPeso = () => {
    const q = supabase.from('codigo_planos').select('id, peso').not('peso', 'is', null)
    return codigo ? q.eq('codigo_interno', normalizarCodigo(codigo)) : q
  }
  const [{ data, error }, { data: filas, error: errorPeso }] = await Promise.all([
    todasLasFilas(() => supabase.rpc('codigo_interno_planos', { p_codigo: codigo }), ['codigo', 'anulado_en.asc.nullsfirst', 'area', 'numero', 'id']),
    !conPeso ? Promise.resolve({ data: [], error: null }) : todasLasFilas(delPeso, ['id']),
  ])
  if (error) throw new Error(`No se pudieron leer los planos: ${error.message}`)
  if (errorPeso) throw new Error(`No se pudo leer el porcentaje de los planos: ${errorPeso.message}`)
  const pesos = new Map((filas ?? []).map((f) => [f.id, Number(f.peso)]))
  return (data ?? []).flatMap((p) =>
    p.id && p.codigo && p.area_id
      ? [
          {
            id: p.id,
            codigo: p.codigo,
            numero: p.numero ?? '',
            nombre: p.nombre ?? '',
            area_id: p.area_id,
            area: p.area ?? '',
            area_codigo: p.area_codigo ?? '',
            observacion: p.observacion,
            creado_en: p.creado_en ?? '',
            anulado_en: p.anulado_en,
            motivo_anulacion: p.motivo_anulacion,
            revisiones: n(p.revisiones),
            revision_id: p.revision_id,
            revision: n(p.revision),
            nombre_archivo: p.nombre_archivo,
            tamano_bytes: p.tamano_bytes,
            cambios: p.cambios,
            subido_en: p.subido_en,
            recibido_en: p.recibido_en,
            recibido_por_area: p.recibido_por_area,
            peso: pesos.get(p.id) ?? null,
          },
        ]
      : [],
  )
}

/** Una revisión de un plano. */
export type RevisionDePlano = {
  id: string
  revision: number
  nombre_archivo: string
  tamano_bytes: number
  cambios: string | null
  subido_en: string
  recibido_en: string | null
  recibido_por_area: string | null
}

/** Todas las revisiones de un plano, de la más nueva a la primera. */
export async function historialDePlano(plano: string): Promise<RevisionDePlano[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_plano_historial', { p_plano: plano })
  if (error) throw new Error(`No se pudo leer la historia del plano: ${error.message}`)
  return (data ?? []).flatMap((r) =>
    r.id
      ? [
          {
            id: r.id,
            revision: n(r.revision),
            nombre_archivo: r.nombre_archivo ?? '',
            tamano_bytes: n(r.tamano_bytes),
            cambios: r.cambios,
            subido_en: r.subido_en ?? '',
            recibido_en: r.recibido_en,
            recibido_por_area: r.recibido_por_area,
          },
        ]
      : [],
  )
}

/** Una línea de la lista de materiales de Diseño. */
export type LineaDeMaterial = {
  id: string
  material_id: string
  material_codigo: string
  material: string
  unidad: string | null
  cantidad: number
  plano_id: string | null
  plano: string | null
  plano_anulado: boolean
  observacion: string | null
}

export async function listaDeMateriales(codigo: string): Promise<LineaDeMaterial[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_materiales', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer la lista de materiales: ${error.message}`)
  return (data ?? []).flatMap((m) =>
    m.id && m.material_id
      ? [
          {
            id: m.id,
            material_id: m.material_id,
            material_codigo: m.material_codigo ?? '',
            material: m.material ?? '',
            unidad: m.unidad,
            cantidad: n(m.cantidad),
            plano_id: m.plano_id,
            plano: m.plano,
            plano_anulado: m.plano_anulado === true,
            observacion: m.observacion,
          },
        ]
      : [],
  )
}

/** Material por material: lo que puso Diseño, lo comprado y lo salido del almacén para el código. */
export type MaterialComparado = {
  material_id: string
  material_codigo: string
  material: string
  unidad: string | null
  disenado: number | null
  comprado: number
  salido: number
  en_la_lista: boolean
}

export async function materialesComparados(codigo: string): Promise<MaterialComparado[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_materiales_comparados', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo comparar los materiales: ${error.message}`)
  return (data ?? []).flatMap((m) =>
    m.material_id
      ? [
          {
            material_id: m.material_id,
            material_codigo: m.material_codigo ?? '',
            material: m.material ?? '',
            unidad: m.unidad,
            disenado: m.disenado === null ? null : Number(m.disenado),
            comprado: n(m.comprado),
            salido: n(m.salido),
            en_la_lista: m.en_la_lista === true,
          },
        ]
      : [],
  )
}

/** Una línea de un requerimiento para el código: el insumo como lo escribió el área. */
export type LineaPedida = {
  requerimiento_id: string
  numero: string
  estado: string
  area: string | null
  fecha: string
  item: number
  descripcion: string
  cantidad: number
  unidad: string | null
}

export async function loPedidoDelCodigo(codigo: string): Promise<LineaPedida[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_lo_pedido', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer lo pedido para el código: ${error.message}`)
  return (data ?? []).flatMap((l) =>
    l.requerimiento_id
      ? [
          {
            requerimiento_id: l.requerimiento_id,
            numero: l.numero ?? '',
            estado: l.estado ?? '',
            area: l.area,
            fecha: l.fecha ?? '',
            item: n(l.item),
            descripcion: l.descripcion ?? '',
            cantidad: n(l.cantidad),
            unidad: l.unidad,
          },
        ]
      : [],
  )
}

/** Una etapa con lo que dice el reporte diario de su área para el código. */
export type EtapaDeCodigo = {
  id: string
  codigo: string
  orden: number
  nombre: string
  area_id: string | null
  area: string | null
  area_codigo: string | null
  inicio_plan: string | null
  fin_plan: string | null
  inicio_real: string | null
  fin_real: string | null
  nota: string | null
  reportes: number
  primer_reporte: string | null
  ultimo_reporte: string | null
  avance_reportado: number | null
  /** La etapa de arriba de la que es subetapa (la agrega el supervisor del área). */
  padre_id: string | null
  /** La agregó el supervisor de su área, no Diseño: la corrige y la quita él. */
  de_area: boolean
}

/** Las etapas de un código en su orden, o las de todos si no se da código. */
export async function etapasDeCodigo(codigo: string | null): Promise<EtapaDeCodigo[]> {
  const supabase = await createClient()
  // Sin código son las etapas de todos: con seis por unidad, unos 170 códigos ya pasan de mil.
  // De quién es la etapa y de cuál cuelga no está en la función (su firma no se
  // cambia en producción): se lee de la tabla, con el mismo RLS, solo las que
  // tienen algo distinto de lo de siempre (subetapas y etapas de un área).
  const deArea = () => {
    const q = supabase.from('codigo_etapas').select('id, padre_id, de_area').is('quitada_en', null).or('padre_id.not.is.null,de_area.is.true')
    return codigo ? q.eq('codigo_interno', normalizarCodigo(codigo)) : q
  }
  const [{ data, error }, { data: marcas, error: errorMarcas }] = await Promise.all([
    todasLasFilas(() => supabase.rpc('codigo_interno_etapas', { p_codigo: codigo }), ['codigo', 'orden', 'id']),
    todasLasFilas(deArea, ['id']),
  ])
  if (error) throw new Error(`No se pudieron leer las etapas: ${error.message}`)
  if (errorMarcas) throw new Error(`No se pudo leer de qué área es cada etapa: ${errorMarcas.message}`)
  const marca = new Map((marcas ?? []).map((m) => [m.id, m]))
  return (data ?? []).flatMap((e) =>
    e.id && e.codigo
      ? [
          {
            id: e.id,
            codigo: e.codigo,
            orden: n(e.orden),
            nombre: e.nombre ?? '',
            area_id: e.area_id,
            area: e.area,
            area_codigo: e.area_codigo,
            inicio_plan: e.inicio_plan,
            fin_plan: e.fin_plan,
            inicio_real: e.inicio_real,
            fin_real: e.fin_real,
            nota: e.nota,
            reportes: n(e.reportes),
            primer_reporte: e.primer_reporte,
            ultimo_reporte: e.ultimo_reporte,
            avance_reportado: e.avance_reportado === null ? null : Number(e.avance_reportado),
            padre_id: marca.get(e.id)?.padre_id ?? null,
            de_area: marca.get(e.id)?.de_area ?? false,
          },
        ]
      : [],
  )
}

export type AreaSimple = { id: string; codigo: string; nombre: string }

/** Maestranza, Producción y Acabados: las áreas a las que va un plano. */
export async function areasDePlanos(): Promise<AreaSimple[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('areas')
    .select('id, codigo, nombre')
    .in('codigo', [...AREAS_DE_PLANOS])
    .eq('activo', true)
    .order('orden_secuencia')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

/** Todas las áreas activas: una etapa puede ser de cualquiera (Diseño, Calidad…). */
export async function areasParaEtapas(): Promise<AreaSimple[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id, codigo, nombre').eq('activo', true).order('orden_secuencia')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

export type MaterialParaElegir = { id: string; codigo: string; descripcion: string; unidad: string | null }

/** El catálogo activo, para elegir el material de una línea. */
export async function materialesParaElegir(): Promise<MaterialParaElegir[]> {
  const supabase = await createClient()
  // El catálogo pasa de quinientos: pasado el mil, lo que venía después en orden
  // alfabético no se podía elegir.
  const { data, error } = await todasLasFilas(
    () => supabase.from('materiales').select('id, codigo, descripcion, unidad:unidades_medida(codigo)').eq('activo', true),
    ['descripcion', 'id'],
  )
  if (error) throw new Error(`No se pudo leer el catálogo de materiales: ${error.message}`)
  return (data ?? []).map((m) => ({
    id: m.id,
    codigo: m.codigo,
    descripcion: m.descripcion,
    unidad: (m.unidad as { codigo: string } | null)?.codigo ?? null,
  }))
}

/** Una OT vigente del código, con su PDF si quien mira puede abrirlo. */
export type OrdenDelCodigo = {
  id: string
  numero: string
  estado: string
  descripcion: string | null
  fecha_entrega: string | null
  cliente: string | null
  pdf_nombre: string | null
  url: string | null
  /** Las fichas técnicas del camión o tracto que Diseño adjuntó a la OT. */
  fichas: FichaDeOrden[]
}

export type FichaDeOrden = { id: string; nombre: string; subido_por: string | null; subido_en: string; url: string | null }

/**
 * Las OT de un código interno (migración 20261016900000): Administración las
 * carga con el código interno, sobre la cotización que Gerencia aprobó (migración
 * 20261027200000), y Diseño las ve dentro del código. Corre con los
 * permisos de quien mira: el PDF solo le llega a Diseño (`puede_ver_pdf_ot`).
 */
export async function ordenesDelCodigo(codigo: string): Promise<OrdenDelCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ordenes_de_codigo_interno', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer la OT del código: ${error.message}`)
  const filas = (data ?? []).flatMap((f) => (f.id && f.numero ? [{ ...f, id: f.id, numero: f.numero }] : []))

  const rutas = filas.flatMap((f) => (f.pdf_ruta ? [f.pdf_ruta] : []))
  const enlaces = new Map<string, string>()
  if (rutas.length > 0) {
    // Sin enlace la OT igual se ve: se sabe que está aunque no se pueda abrir.
    const { data: firmados } = await supabase.storage.from('adjuntos-ot').createSignedUrls(rutas, 600)
    for (const f of firmados ?? []) if (f.path && f.signedUrl) enlaces.set(f.path, f.signedUrl)
  }

  const fichas = await fichasDeOrdenes(filas.map((f) => f.id))
  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    estado: f.estado ?? '',
    descripcion: f.descripcion,
    fecha_entrega: f.fecha_entrega,
    cliente: f.cliente,
    pdf_nombre: f.pdf_ruta ? f.pdf_nombre : null,
    url: (f.pdf_ruta && enlaces.get(f.pdf_ruta)) ?? null,
    fichas: fichas.get(f.id) ?? [],
  }))
}

/**
 * Las fichas técnicas del vehículo de cada OT (`ot_adjuntos` tipo
 * FICHA_VEHICULO, migración 20261106100000), con su enlace para abrirlas.
 */
async function fichasDeOrdenes(ids: string[]): Promise<Map<string, FichaDeOrden[]>> {
  const porOrden = new Map<string, FichaDeOrden[]>()
  if (ids.length === 0) return porOrden
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_adjuntos')
    .select('id, orden_id, nombre_archivo, ruta_storage, subido_por, creado_en')
    .eq('tipo', 'FICHA_VEHICULO')
    .in('orden_id', ids)
    .order('creado_en', { ascending: false })
  if (error) throw new Error(`No se pudo leer la ficha técnica de la OT: ${error.message}`)
  const filas = data ?? []
  const enlaces = new Map<string, string>()
  if (filas.length > 0) {
    const { data: firmados } = await supabase.storage.from('adjuntos-ot').createSignedUrls(filas.map((f) => f.ruta_storage), 600)
    for (const f of firmados ?? []) if (f.path && f.signedUrl) enlaces.set(f.path, f.signedUrl)
  }
  for (const f of filas) {
    const lista = porOrden.get(f.orden_id) ?? []
    lista.push({ id: f.id, nombre: f.nombre_archivo, subido_por: f.subido_por, subido_en: f.creado_en, url: enlaces.get(f.ruta_storage) ?? null })
    porOrden.set(f.orden_id, lista)
  }
  return porOrden
}

/** La OT con que se nombra un código en las listas de Diseño. */
export type OtDeCodigo = {
  numero: string
  estado: string
  abierta: boolean
  fecha_registro: string | null
  cliente: string | null
  cliente_id: string | null
  unidad: { placa: string | null; codigo_interno: string | null; numero_chasis: string | null; marca: string | null; modelo: string | null } | null
}

/**
 * La OT de cada código, como la nombra «Unidades en taller»: la abierta que
 * entró primero; si no tiene abierta, la última que tuvo. Las listas de Diseño
 * van en el orden en que entraron las OT (observaciones de Diseño, 2026-11-06).
 */
export async function otPorCodigo(): Promise<Map<string, OtDeCodigo>> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () =>
      supabase
        .from('ot_resumen')
        .select('id, numero, estado, cliente_id, cliente, unidad_id, placa, codigo_interno, numero_chasis, marca, modelo, fecha_registro')
        .neq('estado', 'ANULADA')
        .not('codigo_interno', 'is', null),
    ['fecha_registro.asc.nullslast', 'numero', 'id'],
  )
  if (error) throw new Error(`No se pudo leer la OT de cada código: ${error.message}`)
  const abiertos: readonly string[] = ESTADOS_ABIERTOS
  const porCodigo = new Map<string, OtDeCodigo>()
  for (const o of data ?? []) {
    if (!o.numero || !o.codigo_interno || !o.estado) continue
    const codigo = normalizarCodigo(o.codigo_interno)
    const ot: OtDeCodigo = {
      numero: o.numero,
      estado: o.estado,
      abierta: abiertos.includes(o.estado),
      fecha_registro: o.fecha_registro,
      cliente: o.cliente,
      cliente_id: o.cliente_id,
      unidad: o.unidad_id
        ? { placa: o.placa, codigo_interno: o.codigo_interno, numero_chasis: o.numero_chasis, marca: o.marca, modelo: o.modelo }
        : null,
    }
    const antes = porCodigo.get(codigo)
    // Vienen de la más antigua a la más nueva: la primera abierta se queda; sin
    // abierta, la última cerrada.
    if (!antes?.abierta) porCodigo.set(codigo, ot)
  }
  return porCodigo
}

/** Un comprimido de DXF de un código, con su enlace de descarga. */
export type DxfDeCodigo = {
  id: string
  codigo: string
  descripcion: string
  nombre_archivo: string
  ruta: string
  tamano_bytes: number
  subido_en: string
  url: string | null
}

/**
 * Los DXF comprimidos de un código, o de todos los que la persona ve. Los ven
 * Diseño y el supervisor de Maestranza (`puede_ver_dxf`); el enlace descarga el
 * archivo con el nombre que tenía.
 */
export async function dxfDeCodigo(codigo: string | null, { conEnlace = true }: { conEnlace?: boolean } = {}): Promise<DxfDeCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => {
    const q = supabase
      .from('codigo_dxf')
      .select('id, codigo_interno, descripcion, nombre_archivo, ruta, tamano_bytes, subido_en')
      .is('quitado_en', null)
    return codigo ? q.eq('codigo_interno', normalizarCodigo(codigo)) : q
  }, ['codigo_interno', 'subido_en.desc', 'id'])
  if (error) throw new Error(`No se pudieron leer los DXF: ${error.message}`)
  const archivos = (data ?? []).map((f) => ({
    id: f.id,
    codigo: f.codigo_interno,
    descripcion: f.descripcion,
    nombre_archivo: f.nombre_archivo,
    ruta: f.ruta,
    tamano_bytes: Number(f.tamano_bytes),
    subido_en: f.subido_en,
    url: null,
  }))
  return conEnlace ? conEnlaceDeDescarga(archivos) : archivos
}

/**
 * El enlace de descarga de cada DXF, uno por uno: cada enlace descarga con el
 * nombre de su archivo, no con el id. Para firmar solo los que se muestran.
 */
export async function conEnlaceDeDescarga(archivos: DxfDeCodigo[]): Promise<DxfDeCodigo[]> {
  if (archivos.length === 0) return archivos
  const supabase = await createClient()
  return Promise.all(
    archivos.map(async (f) => {
      const { data } = await supabase.storage.from(BUCKET_DXF).createSignedUrl(f.ruta, 600, { download: f.nombre_archivo })
      return { ...f, url: data?.signedUrl ?? null }
    }),
  )
}
