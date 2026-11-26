import 'server-only'

import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { BUCKET_FOTOS_CALIDAD, ESTADOS_ABIERTOS } from '@/lib/dominio/calidad'
import { createClient } from '@/lib/supabase/server'

/*
 * Las inspecciones de calidad (migración 20261126520000). Todo se lee por
 * `calidad_inspecciones_visibles`, que decide qué ve quien pregunta: Calidad y
 * Gerencia todas; cada área las suyas, la anulada en lectura. La pantalla no arma ese
 * filtro, y tampoco decide qué botón le toca a quien mira: lo dicen
 * `puede_corregir` y `puede_revisar`, con las mismas reglas que las funciones
 * que escriben.
 */

export type InspeccionCalidad = {
  id: string
  codigo_interno: string
  /** La etapa que Diseño armó; `null` si el código no tenía etapas y Calidad eligió el área. */
  etapa: string | null
  area: string
  resultado: string
  observacion: string | null
  estado: string
  creado_en: string
  /** El puesto de quien inspeccionó: las pantallas nombran el puesto, no la persona. */
  registro_puesto: string | null
  /** Los días que lleva abierta, contados en la base con la fecha de Lima; `null` si ya no espera. */
  dias_abierta: number | null
  ultimo_paso: string | null
  ultimo_paso_en: string | null
  fotos: number
  pasos: number
  alcance: 'TODOS' | 'AREA'
  puede_corregir: boolean
  puede_revisar: boolean
  anulado_en: string | null
  anulo_puesto: string | null
  motivo_anulacion: string | null
}

type Fila = { [K in keyof InspeccionCalidad]: InspeccionCalidad[K] | null } & {
  area_id: string | null
  area_codigo: string | null
  etapa_orden: number | null
}

function aInspeccion(f: Fila): InspeccionCalidad | null {
  if (!f.id || !f.codigo_interno || !f.resultado || !f.estado || !f.creado_en) return null
  return {
    id: f.id,
    codigo_interno: f.codigo_interno,
    etapa: f.etapa,
    area: f.area ?? '',
    resultado: f.resultado,
    observacion: f.observacion,
    estado: f.estado,
    creado_en: f.creado_en,
    registro_puesto: f.registro_puesto,
    dias_abierta: f.dias_abierta,
    ultimo_paso: f.ultimo_paso,
    ultimo_paso_en: f.ultimo_paso_en,
    fotos: f.fotos ?? 0,
    pasos: f.pasos ?? 0,
    alcance: f.alcance === 'TODOS' ? 'TODOS' : 'AREA',
    puede_corregir: f.puede_corregir === true,
    puede_revisar: f.puede_revisar === true,
    anulado_en: f.anulado_en,
    anulo_puesto: f.anulo_puesto,
    motivo_anulacion: f.motivo_anulacion,
  }
}

/** Cuántas inspecciones ya cerradas trae la lista como mucho: las más recientes. Las abiertas van todas. */
export const MAXIMO_INSPECCIONES = 300

/**
 * Las inspecciones que ve quien pregunta, de la más reciente a la más vieja.
 * Con `busqueda`, solo las que la llevan en el código, la etapa, el área o la
 * observación: el filtro va en la base, así que encuentra también las que pasan
 * del tope de la lista.
 */
export async function listarInspecciones(busqueda?: string | null): Promise<InspeccionCalidad[]> {
  const supabase = await createClient()
  const filtros = filtrosDeBusqueda(['codigo_interno', 'etapa', 'area', 'observacion'], busqueda)
  const consulta = () => {
    let c = supabase.rpc('calidad_inspecciones_visibles', { p_id: null })
    for (const filtro of filtros) c = c.or(filtro)
    return c
  }
  // Lo que espera a alguien se lee entero: con el tope, una observación vieja
  // sin corregir salía de la lista y de la cifra sin que nadie la cerrara. El
  // tope es solo para lo que ya quedó.
  const [abiertas, cerradas] = await Promise.all([
    consulta().in('estado', [...ESTADOS_ABIERTOS]).order('creado_en', { ascending: false }),
    consulta()
      .not('estado', 'in', `(${ESTADOS_ABIERTOS.join(',')})`)
      .order('creado_en', { ascending: false })
      .range(0, MAXIMO_INSPECCIONES - 1),
  ])
  const error = abiertas.error ?? cerradas.error
  if (error) throw new Error(`No se pudieron leer las inspecciones de calidad: ${error.message}`)
  return ([...(abiertas.data ?? []), ...(cerradas.data ?? [])] as Fila[])
    .flatMap((f) => aInspeccion(f) ?? [])
    .sort((x, y) => y.creado_en.localeCompare(x.creado_en))
}

/** Una foto, con su enlace firmado por una hora. */
export type FotoCalidad = { id: string; orden: number; enlace: string | null }

export type PasoCalidad = {
  id: string
  tipo: string
  nota: string | null
  puesto: string | null
  creado_en: string
  fotos: FotoCalidad[]
}

export type DetalleInspeccion = InspeccionCalidad & { fotosDeLaInspeccion: FotoCalidad[]; recorrido: PasoCalidad[] }

/** Una inspección con su recorrido y sus fotos. `null` si no existe o si quien mira no la puede ver. */
export async function cargarInspeccion(id: string): Promise<DetalleInspeccion | null> {
  const supabase = await createClient()
  const [inspeccion, pasos, fotos] = await Promise.all([
    supabase.rpc('calidad_inspecciones_visibles', { p_id: id }),
    supabase.rpc('calidad_pasos_de_la_inspeccion', { p_inspeccion: id }),
    // La tabla deja ver las fotos de lo que quien mira puede ver: la misma regla que la función.
    supabase.from('calidad_fotos').select('id, paso_id, orden, ruta').eq('inspeccion_id', id).order('orden'),
  ])
  if (inspeccion.error) throw new Error(`No se pudo leer la inspección: ${inspeccion.error.message}`)
  const fila = ((inspeccion.data ?? []) as Fila[])[0]
  const base = fila ? aInspeccion(fila) : null
  if (!base) return null
  if (pasos.error) throw new Error(`No se pudo leer el recorrido de la inspección: ${pasos.error.message}`)
  if (fotos.error) throw new Error(`No se pudieron leer las fotos de la inspección: ${fotos.error.message}`)

  const filasFotos = fotos.data ?? []
  const enlaces = await enlacesDeFotos(filasFotos.map((f) => f.ruta))
  const fotosDe = (paso: string | null) =>
    filasFotos.filter((f) => f.paso_id === paso).map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null }))

  return {
    ...base,
    fotosDeLaInspeccion: fotosDe(null),
    recorrido: (pasos.data ?? []).flatMap((p) =>
      p.id && p.tipo && p.creado_en ? [{ id: p.id, tipo: p.tipo, nota: p.nota, puesto: p.puesto, creado_en: p.creado_en, fotos: fotosDe(p.id) }] : [],
    ),
  }
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_CALIDAD).createSignedUrls(rutas, 3600)
  // Sin enlaces la pantalla igual sirve y lo dice en cada foto; el motivo queda en el registro del servidor.
  if (error || !data) {
    console.error('No se pudieron firmar las fotos de la inspección de calidad:', error?.message ?? 'sin respuesta')
    return {} as Record<string, string>
  }
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

export type CodigoParaInspeccionar = { codigo: string; ot: string | null; cliente: string | null; unidad: string | null; etapas: number }
export type EtapaParaInspeccionar = {
  id: string
  codigo: string
  orden: number
  nombre: string
  /** La etapa de arriba, si es una subetapa. */
  padre_id: string | null
  area_id: string | null
  area: string | null
  terminada: boolean
}
export type AreaParaInspeccionar = { id: string; nombre: string }

/**
 * Lo que Calidad necesita para registrar: los códigos que siguen en la planta,
 * todas sus etapas y las áreas de la planta (para el código sin etapas). Pide
 * `calidad.inspeccionar`; quien no lo tiene no la llama.
 */
export async function loQueSeInspecciona(): Promise<{
  codigos: CodigoParaInspeccionar[]
  etapas: EtapaParaInspeccionar[]
  areas: AreaParaInspeccionar[]
}> {
  const supabase = await createClient()
  const [codigos, etapas, areas] = await Promise.all([
    supabase.rpc('calidad_codigos_para_inspeccionar'),
    supabase.rpc('calidad_etapas_del_codigo', { p_codigo: null }),
    // Para el código sin etapas, solo las áreas de la planta, sin Calidad: la
    // misma regla que `calidad_inspeccionar`.
    supabase.from('areas').select('id, nombre').eq('activo', true).eq('es_oficina', false).neq('codigo', 'CAL').order('orden_secuencia'),
  ])
  if (codigos.error) throw new Error(`No se pudieron leer los códigos internos: ${codigos.error.message}`)
  if (etapas.error) throw new Error(`No se pudieron leer las etapas: ${etapas.error.message}`)
  if (areas.error) throw new Error(`No se pudieron leer las áreas: ${areas.error.message}`)
  return {
    codigos: (codigos.data ?? []).flatMap((c) =>
      c.codigo ? [{ codigo: c.codigo, ot: c.ot_numero, cliente: c.cliente, unidad: c.unidad, etapas: c.etapas ?? 0 }] : [],
    ),
    etapas: (etapas.data ?? []).flatMap((e) =>
      e.id && e.codigo && e.nombre && e.orden !== null
        ? [{ id: e.id, codigo: e.codigo, orden: e.orden, nombre: e.nombre, padre_id: e.padre_id, area_id: e.area_id, area: e.area, terminada: e.terminada === true }]
        : [],
    ),
    areas: areas.data ?? [],
  }
}
