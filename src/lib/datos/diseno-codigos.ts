import 'server-only'

import { AREAS_DE_PLANOS } from '@/lib/dominio/diseno-codigos'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { createClient } from '@/lib/supabase/server'

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

/** Todos los códigos de unidad del sistema, con los que Diseño movió hace poco primero. */
export async function codigosDeDiseno(): Promise<CodigoDeDiseno[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigos_internos_de_diseno')
  if (error) throw new Error(`No se pudieron leer los códigos internos de Diseño: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.codigo
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
      : [],
  )
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
  const delPeso = supabase.from('codigo_planos').select('id, peso').not('peso', 'is', null)
  const [{ data, error }, { data: filas, error: errorPeso }] = await Promise.all([
    supabase.rpc('codigo_interno_planos', { p_codigo: codigo }),
    !conPeso ? Promise.resolve({ data: [], error: null }) : codigo ? delPeso.eq('codigo_interno', normalizarCodigo(codigo)) : delPeso,
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
}

/** Las etapas de un código en su orden, o las de todos si no se da código. */
export async function etapasDeCodigo(codigo: string | null): Promise<EtapaDeCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_etapas', { p_codigo: codigo })
  if (error) throw new Error(`No se pudieron leer las etapas: ${error.message}`)
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
  const { data, error } = await supabase
    .from('materiales')
    .select('id, codigo, descripcion, unidad:unidades_medida(codigo)')
    .eq('activo', true)
    .order('descripcion')
    .limit(5000)
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
}

/**
 * Las OT de un código interno (migración 20261016900000): Gerencia las carga al
 * aprobar la cotización y Diseño las ve dentro del código. Corre con los
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

  return filas.map((f) => ({
    id: f.id,
    numero: f.numero,
    estado: f.estado ?? '',
    descripcion: f.descripcion,
    fecha_entrega: f.fecha_entrega,
    cliente: f.cliente,
    pdf_nombre: f.pdf_ruta ? f.pdf_nombre : null,
    url: (f.pdf_ruta && enlaces.get(f.pdf_ruta)) ?? null,
  }))
}
