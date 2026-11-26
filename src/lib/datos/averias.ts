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
    alcance: f.alcance === 'TODAS' || f.alcance === 'PROPIA' ? f.alcance : 'AREA',
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
  }
}

/** Cuántos reportes trae la lista como mucho: los más recientes. */
export const MAXIMO_AVERIAS = 200

/** Los reportes que ve quien pregunta, del más reciente al más viejo. */
export async function listarAverias(): Promise<Averia[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_visibles', { p_id: null })
    .order('creado_en', { ascending: false })
    .order('numero', { ascending: false })
    .range(0, MAXIMO_AVERIAS - 1)
  if (error) throw new Error(`No se pudieron leer los reportes de avería: ${error.message}`)
  return ((data ?? []) as Fila[]).flatMap((f) => aAveria(f) ?? [])
}

/** Una foto del reporte, con su enlace firmado por una hora. */
export type FotoAveria = { id: string; orden: number; enlace: string | null }

export type DetalleAveria = Averia & { fotosDelReporte: FotoAveria[] }

/** Un reporte con sus fotos. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarAveria(id: string): Promise<DetalleAveria | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('averias_visibles', { p_id: id })
  if (error) throw new Error(`No se pudo leer el reporte de avería: ${error.message}`)
  const averia = ((data ?? []) as Fila[]).flatMap((f) => aAveria(f) ?? [])[0]
  if (!averia) return null
  if (averia.fotos === 0) return { ...averia, fotosDelReporte: [] }

  const { data: filas, error: errorFotos } = await supabase
    .from('averia_fotos')
    .select('id, orden, ruta')
    .eq('averia_id', id)
    .order('orden')
  if (errorFotos) throw new Error(`No se pudieron leer las fotos del reporte: ${errorFotos.message}`)
  const fotos = filas ?? []
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return { ...averia, fotosDelReporte: fotos.map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null })) }
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
