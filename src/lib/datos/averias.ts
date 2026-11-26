import 'server-only'

import { BUCKET_FOTOS_AVERIAS, type AlcanceAveria } from '@/lib/dominio/averias'
import { createClient } from '@/lib/supabase/server'

/*
 * Los reportes de avería (Plan 16.2, migración 20261126100100). Todo se lee por
 * `averias_visibles`, que decide qué ve quien pregunta: Mantenimiento y Gerencia
 * todo, cada quien lo suyo y lo del área donde trabaja. Trae el equipo, porque
 * el padrón no se lee sin los permisos de equipos y quien reporta no los tiene.
 */

export type Averia = {
  id: string
  numero: string
  tipo: string
  detiene_trabajo: boolean
  riesgo_personas: boolean
  descripcion: string
  estado: string
  creado_en: string
  /** Los días que lleva en Mantenimiento, contados en la base con la fecha de Lima; `null` si ya no espera. */
  dias_en_espera: number | null
  alcance: AlcanceAveria
  equipo_id: string
  equipo_codigo: string
  equipo_descripcion: string
  equipo_ubicacion: string | null
  equipo_estado: string
  /** El área del equipo cuando se reportó. */
  area: string | null
  paro_el_equipo: boolean
  reporto: string
  reporto_puesto: string | null
  fotos: number
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
  /** 1 detiene y es un riesgo, 2 detiene, 3 es un riesgo, 4 avería, 5 posible avería. */
  gravedad: number
  /** Quién la tiene ahora; `null` si ya no espera a nadie. */
  espera_de: 'MANTENIMIENTO' | 'QUIEN_REPORTO' | null
  espera_desde: string | null
  /** Si la reportó quien mira: solo esa persona confirma. */
  es_mia: boolean
  diagnostico: string | null
  atendida_en: string | null
  atendio: string | null
  /** Quién escribió el diagnóstico que se ve, y cuándo: otra persona de Mantenimiento puede corregirlo. */
  diagnostico_de: string | null
  diagnostico_en: string | null
  trabajo_hecho: string | null
  horas_parado: number | null
  cerrada_en: string | null
  cerro: string | null
  confirmada_en: string | null
  /** Lo que dijo quien la reportó al confirmar o al decir que no quedó bien. */
  nota_de_quien_reporto: string | null
  veces_reabierta: number
  /** Si la avería dejó el equipo parado cuando se reportó. */
  paro_al_reportar: boolean
  /** Desde cuándo está parado el equipo por este reporte, si lo sigue: para proponer las horas al cerrar. */
  equipo_parado_desde: string | null
  rq_enlazados: number
  /**
   * Si quien mira dice si quedó bien (`averias_puede_confirmar`): quien la
   * reportó; si ya no tiene cuenta activa, el responsable del área o Mantenimiento.
   */
  puede_confirmar: boolean
  /** Si la cuenta de quien la reportó sigue activa. */
  reporto_activo: boolean
  /** Quién la confirmó, si no fue quien la reportó (ya no tenía cuenta). */
  confirmo_en_lugar: string | null
  /** Quién dijo la última vez que no quedó bien, si no fue quien la reportó. */
  devolvio_en_lugar: string | null
  /** El número de la avería del mismo equipo cerrada en los 30 días antes de esta: esta la repite. */
  repite_a: string | null
}

type Fila = { [K in keyof Averia]: Averia[K] | null } & { area_id: string | null }

function aAveria(f: Fila): Averia | null {
  if (!f.id || !f.numero || !f.tipo || !f.estado || !f.creado_en || !f.equipo_id || !f.equipo_codigo) return null
  return {
    id: f.id,
    numero: f.numero,
    tipo: f.tipo,
    detiene_trabajo: f.detiene_trabajo === true,
    riesgo_personas: f.riesgo_personas === true,
    descripcion: f.descripcion ?? '',
    estado: f.estado,
    creado_en: f.creado_en,
    dias_en_espera: f.dias_en_espera,
    alcance: f.alcance === 'TODAS' || f.alcance === 'PROPIA' || f.alcance === 'RIESGO' ? f.alcance : 'AREA',
    equipo_id: f.equipo_id,
    equipo_codigo: f.equipo_codigo,
    equipo_descripcion: f.equipo_descripcion ?? '',
    equipo_ubicacion: f.equipo_ubicacion,
    equipo_estado: f.equipo_estado ?? '',
    area: f.area,
    paro_el_equipo: f.paro_el_equipo === true,
    reporto: f.reporto ?? '',
    reporto_puesto: f.reporto_puesto,
    fotos: f.fotos ?? 0,
    anulado_en: f.anulado_en,
    anulo: f.anulo,
    motivo_anulacion: f.motivo_anulacion,
    gravedad: f.gravedad ?? 5,
    espera_de: f.espera_de === 'MANTENIMIENTO' || f.espera_de === 'QUIEN_REPORTO' ? f.espera_de : null,
    espera_desde: f.espera_desde,
    es_mia: f.es_mia === true,
    diagnostico: f.diagnostico,
    atendida_en: f.atendida_en,
    atendio: f.atendio,
    diagnostico_de: f.diagnostico_de ?? f.atendio,
    diagnostico_en: f.diagnostico_en ?? f.atendida_en,
    trabajo_hecho: f.trabajo_hecho,
    horas_parado: f.horas_parado == null ? null : Number(f.horas_parado),
    cerrada_en: f.cerrada_en,
    cerro: f.cerro,
    confirmada_en: f.confirmada_en,
    nota_de_quien_reporto: f.nota_de_quien_reporto,
    veces_reabierta: f.veces_reabierta ?? 0,
    paro_al_reportar: f.paro_al_reportar === true,
    equipo_parado_desde: f.equipo_parado_desde,
    rq_enlazados: f.rq_enlazados ?? 0,
    puede_confirmar: f.puede_confirmar === true,
    // Sin el dato (una base de antes de la 16.4), se da por activa: es lo que pasaba antes.
    reporto_activo: f.reporto_activo !== false,
    confirmo_en_lugar: f.confirmo_en_lugar,
    devolvio_en_lugar: f.devolvio_en_lugar,
    repite_a: f.repite_a,
  }
}

/** Cuántos reportes ya terminados (quedaron bien o anulados) trae la lista como mucho: los más recientes. */
export const MAXIMO_AVERIAS = 200

/**
 * Los reportes que ve quien pregunta, del más reciente al más viejo: todos los
 * que esperan a alguien (por atender, en atención, por confirmar) y, de los ya
 * terminados, los más recientes. Con un solo tope para todo, la avería que más
 * días llevaba esperando era la primera en salirse de la bandeja.
 */
export async function listarAverias(): Promise<{ averias: Averia[]; alTope: boolean }> {
  const supabase = await createClient()
  const leer = (estados: string[], tope?: number) => {
    const q = supabase
      .rpc('averias_visibles', { p_id: null })
      .in('estado', estados)
      .order('creado_en', { ascending: false })
      .order('numero', { ascending: false })
    return tope ? q.range(0, tope - 1) : q
  }
  const [vivas, terminadas] = await Promise.all([leer(['REPORTADA', 'EN_ATENCION', 'CERRADA']), leer(['CONFIRMADA', 'ANULADA'], MAXIMO_AVERIAS)])
  for (const r of [vivas, terminadas]) if (r.error) throw new Error(`No se pudieron leer los reportes de avería: ${r.error.message}`)
  const filas = [...((vivas.data ?? []) as Fila[]), ...((terminadas.data ?? []) as Fila[])]
    .flatMap((f) => aAveria(f) ?? [])
    .sort((a, b) => b.creado_en.localeCompare(a.creado_en) || b.numero.localeCompare(a.numero))
  return { averias: filas, alTope: (terminadas.data ?? []).length >= MAXIMO_AVERIAS }
}

/**
 * Los reportes de un equipo que ve quien pregunta, del más reciente al más
 * viejo, para su historia (Plan 16.4). Cada quien ve los que ya veía: las cifras
 * del equipo las da `equipos_historia`, que los cuenta todos.
 */
export async function averiasDelEquipo(equipo: string): Promise<Averia[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_visibles', { p_id: null })
    .eq('equipo_id', equipo)
    .order('creado_en', { ascending: false })
    .order('numero', { ascending: false })
  if (error) throw new Error(`No se pudieron leer los reportes del equipo: ${error.message}`)
  return ((data ?? []) as Fila[]).flatMap((f) => aAveria(f) ?? [])
}

/** Una foto del reporte, con su enlace firmado por una hora. */
export type FotoAveria = { id: string; orden: number; enlace: string | null }

export type DetalleAveria = Averia & { fotosDelReporte: FotoAveria[]; requerimientos: RqEnlazado[] }

/** Un reporte con sus fotos. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarAveria(id: string): Promise<DetalleAveria | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('averias_visibles', { p_id: id })
  if (error) throw new Error(`No se pudo leer el reporte de avería: ${error.message}`)
  const leida = ((data ?? []) as Fila[]).flatMap((f) => aAveria(f) ?? [])[0]
  if (!leida) return null
  // Los RQ y las fotos, a la vez.
  const [requerimientos, fotosDelReporte] = await Promise.all([
    leida.rq_enlazados > 0 ? rqEnlazados(id) : Promise.resolve([]),
    leida.fotos > 0 ? fotosDe(id) : Promise.resolve([]),
  ])
  return { ...leida, requerimientos, fotosDelReporte }
}

async function fotosDe(id: string): Promise<FotoAveria[]> {
  const supabase = await createClient()
  const { data: filas, error: errorFotos } = await supabase
    .from('averia_fotos')
    .select('id, orden, ruta')
    .eq('averia_id', id)
    .order('orden')
  if (errorFotos) throw new Error(`No se pudieron leer las fotos del reporte: ${errorFotos.message}`)
  const fotos = filas ?? []
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return fotos.map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null }))
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_AVERIAS).createSignedUrls(rutas, 3600)
  // Sin enlaces la pantalla igual sirve y lo dice en cada foto («no se pudo abrir
  // ahora»); el motivo queda en el registro del servidor, no se traga.
  if (error || !data) {
    console.error('No se pudieron firmar las fotos del reporte de avería:', error?.message ?? 'sin respuesta')
    return {} as Record<string, string>
  }
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

export type EquipoParaReportar = {
  id: string
  codigo: string
  descripcion: string
  categoria: string
  marca: string | null
  area_id: string | null
  area: string | null
  ubicacion: string | null
  estado: string
}

/** Los equipos en uso, para elegir cuál falla. Los lee cualquier cuenta activa: reportar no pide permiso. */
export async function equiposParaReportar(): Promise<EquipoParaReportar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('averias_equipos_para_elegir')
  if (error) throw new Error(`No se pudo leer la lista de equipos: ${error.message}`)
  return (data ?? []).flatMap((e) =>
    e.id && e.codigo
      ? [
          {
            id: e.id,
            codigo: e.codigo,
            descripcion: e.descripcion ?? '',
            categoria: e.categoria ?? '',
            marca: e.marca,
            area_id: e.area_id,
            area: e.area,
            ubicacion: e.ubicacion,
            estado: e.estado ?? '',
          },
        ]
      : [],
  )
}

/** Un RQ enlazado a la avería: el número y cómo va, sin precios. */
export type RqEnlazado = {
  enlace: string
  requerimiento: string
  numero: string
  estado: string
  nota: string
  enlazado_en: string
  /** Si quien mira lee los RQ: entonces el número lleva a la pantalla del RQ. */
  puede_abrir: boolean
}

/** Los RQ de los repuestos de un reporte (`averias_rq_enlazados`): los ve quien ve el reporte. */
export async function rqEnlazados(averia: string): Promise<RqEnlazado[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('averias_rq_enlazados', { p_averias: [averia] })
  if (error) throw new Error(`No se pudieron leer los RQ de los repuestos: ${error.message}`)
  return (data ?? []).flatMap((r) =>
    r.enlace && r.requerimiento && r.numero
      ? [
          {
            enlace: r.enlace,
            requerimiento: r.requerimiento,
            numero: r.numero,
            estado: r.estado ?? '',
            nota: r.nota ?? '',
            enlazado_en: r.enlazado_en ?? '',
            puede_abrir: r.puede_abrir === true,
          },
        ]
      : [],
  )
}

export type RqParaEnlazar = {
  id: string
  numero: string
  tipo: string
  area: string | null
  codigo_interno: string | null
  estado: string
  justificacion: string | null
  creado_en: string
}

/** Los RQ vivos de los últimos seis meses, para que Mantenimiento enlace el de los repuestos (`averias_rq_para_enlazar`). */
export async function rqParaEnlazar(): Promise<RqParaEnlazar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('averias_rq_para_enlazar')
  if (error) throw new Error(`No se pudo leer la lista de RQ: ${error.message}`)
  return (data ?? []).flatMap((r) =>
    r.id && r.numero
      ? [
          {
            id: r.id,
            numero: r.numero,
            tipo: r.tipo ?? '',
            area: r.area,
            codigo_interno: r.codigo_interno,
            estado: r.estado ?? '',
            justificacion: r.justificacion,
            creado_en: r.creado_en ?? '',
          },
        ]
      : [],
  )
}
