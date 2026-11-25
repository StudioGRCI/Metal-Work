import 'server-only'

import { BUCKET_FOTOS_SSOMA, type AlcanceSsoma } from '@/lib/dominio/ssoma'
import { createClient } from '@/lib/supabase/server'

/*
 * Los reportes de seguridad (migración 20261125150100). Todo se lee por
 * `ssoma_reportes_visibles`, que decide qué ve quien pregunta: SSOMA y Gerencia
 * todo, cada quien lo suyo, y el área donde pasó el hecho sin quién lo reportó,
 * sin a nombre de quién y sin fotos. La pantalla no arma ese filtro: lo que la
 * función no devuelve, no existe para ella.
 */

export type ReporteSsoma = {
  id: string
  numero: string
  tipo: string
  area: string
  lugar: string
  descripcion: string
  ocurrido_en: string
  /** Solo de un accidente: si hubo atención médica. Nunca el diagnóstico. */
  hubo_atencion: boolean | null
  estado: string
  creado_en: string
  /** Los días que lleva en SSOMA, contados en la base con la fecha de Lima; `null` si ya no espera. */
  dias_en_espera: number | null
  alcance: AlcanceSsoma
  /** Quién lo reportó y su puesto: `null` para quien lo ve por ser del área. */
  reporto: string | null
  reporto_puesto: string | null
  /** A nombre de qué trabajador sin cuenta se reportó, y su cargo. */
  a_nombre_de: string | null
  a_nombre_de_cargo: string | null
  fotos: number
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
}

type Fila = { [K in keyof ReporteSsoma]: ReporteSsoma[K] | null } & { area_id: string | null; area_codigo: string | null }

function aReporte(f: Fila): ReporteSsoma | null {
  if (!f.id || !f.numero || !f.tipo || !f.estado || !f.creado_en || !f.ocurrido_en) return null
  return {
    id: f.id,
    numero: f.numero,
    tipo: f.tipo,
    area: f.area ?? '',
    lugar: f.lugar ?? '',
    descripcion: f.descripcion ?? '',
    ocurrido_en: f.ocurrido_en,
    hubo_atencion: f.hubo_atencion,
    estado: f.estado,
    creado_en: f.creado_en,
    dias_en_espera: f.dias_en_espera,
    alcance: f.alcance === 'TODOS' || f.alcance === 'PROPIO' ? f.alcance : 'AREA',
    reporto: f.reporto,
    reporto_puesto: f.reporto_puesto,
    a_nombre_de: f.a_nombre_de,
    a_nombre_de_cargo: f.a_nombre_de_cargo,
    fotos: f.fotos ?? 0,
    anulado_en: f.anulado_en,
    anulo: f.anulo,
    motivo_anulacion: f.motivo_anulacion,
  }
}

/** Cuántos reportes trae la lista como mucho: los más recientes. */
export const MAXIMO_REPORTES_SSOMA = 200

/** Los reportes que ve quien pregunta, del más reciente al más viejo. */
export async function listarReportesSsoma(): Promise<ReporteSsoma[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('ssoma_reportes_visibles', { p_id: null })
    .order('creado_en', { ascending: false })
    .order('numero', { ascending: false })
    .range(0, MAXIMO_REPORTES_SSOMA - 1)
  if (error) throw new Error(`No se pudieron leer los reportes de seguridad: ${error.message}`)
  return ((data ?? []) as Fila[]).flatMap((f) => aReporte(f) ?? [])
}

/** Una foto del reporte, con su enlace firmado por una hora. */
export type FotoSsoma = { id: string; orden: number; enlace: string | null }

export type DetalleReporteSsoma = ReporteSsoma & { fotosDelReporte: FotoSsoma[] }

/** Un reporte con sus fotos. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarReporteSsoma(id: string): Promise<DetalleReporteSsoma | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_reportes_visibles', { p_id: id })
  if (error) throw new Error(`No se pudo leer el reporte de seguridad: ${error.message}`)
  const reporte = ((data ?? []) as Fila[]).flatMap((f) => aReporte(f) ?? [])[0]
  if (!reporte) return null
  // El área no ve las fotos: la función le dice cero y la tabla no le deja leerlas.
  if (reporte.fotos === 0) return { ...reporte, fotosDelReporte: [] }

  const { data: filas, error: errorFotos } = await supabase
    .from('ssoma_reporte_fotos')
    .select('id, orden, ruta')
    .eq('reporte_id', id)
    .order('orden')
  if (errorFotos) throw new Error(`No se pudieron leer las fotos del reporte: ${errorFotos.message}`)
  const fotos = filas ?? []
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return { ...reporte, fotosDelReporte: fotos.map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null })) }
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_SSOMA).createSignedUrls(rutas, 3600)
  // Sin enlaces la pantalla igual sirve y lo dice en cada foto («no se pudo abrir
  // ahora»); el motivo queda en el registro del servidor, no se traga.
  if (error || !data) {
    console.error('No se pudieron firmar las fotos del reporte de seguridad:', error?.message ?? 'sin respuesta')
    return {} as Record<string, string>
  }
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

export type AreaParaReportar = { id: string; nombre: string }

/** Las áreas de la empresa, en el orden del proceso: dónde pasó. */
export async function areasParaReportar(): Promise<AreaParaReportar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id, nombre').eq('activo', true).order('orden_secuencia')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

export type PersonaParaReportar = { id: string; nombre: string; cargo: string | null; area: string | null }

/**
 * La lista de RR. HH. para reportar a nombre de un trabajador sin cuenta: solo
 * nombre, cargo y área. Pide `ssoma.reportar_por_otro`; quien no lo tiene no la llama.
 */
export async function personalParaReportar(): Promise<PersonaParaReportar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_personal_para_elegir')
  if (error) throw new Error(`No se pudo leer la lista del personal: ${error.message}`)
  return (data ?? []).flatMap((p) => (p.id && p.nombre ? [{ id: p.id, nombre: p.nombre, cargo: p.cargo, area: p.area }] : []))
}
