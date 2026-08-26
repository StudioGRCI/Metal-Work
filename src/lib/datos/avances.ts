import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type FilaTablero = {
  orden_id: string
  orden_numero: string
  orden_estado: string
  prioridad: string
  unidad_id: string | null
  placa: string | null
  tipo_vehiculo: string | null
  marca: string | null
  modelo: string | null
  cliente: string
  tipo_carroceria: string | null
  descripcion: string
  avance_porcentaje: number
  fecha_entrega_comprometida: string | null
  dias_habiles_restantes: number | null
  responsable: string | null
  etapa_actual: string | null
  estado_etapa: string | null
  avance_etapa: number | null
  ultimo_avance_fecha: string | null
  ultimo_avance: string | null
  dias_sin_avance: number | null
  impedimento: string | null
  fotos: number
}

export type Avance = {
  id: string
  orden_id: string
  orden_numero: string
  cliente: string
  placa: string | null
  etapa_id: string | null
  etapa: string | null
  fecha: string
  descripcion: string
  avance_porcentaje: number | null
  impedimento: string | null
  registrado_por_nombre: string | null
  creado_en: string
  fotos: number
}

export type FotoDeAvance = {
  id: string
  avance_id: string
  bucket: string
  ruta_storage: string
  nombre_archivo: string
  pie: string | null
}

/** Las unidades vivas en el taller, la que más se demoró primero. */
export async function listarTablero(filtros: { sede?: string; trabadas?: boolean } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('unidad_tablero')
    .select('*')
    .order('dias_sin_avance', { ascending: false, nullsFirst: true })
    .order('orden_numero', { ascending: false })
    .limit(200)

  if (filtros.sede) consulta = consulta.eq('sede_id', filtros.sede)
  if (filtros.trabadas) consulta = consulta.not('impedimento', 'is', null)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo armar el tablero del taller: ${error.message}`)

  return (data ?? []) as unknown as FilaTablero[]
}

/** El avance registrado en una orden, del más reciente al más viejo. */
export async function listarAvances(ordenId: string, limite = 60) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_avance_resumen')
    .select('*')
    .eq('orden_id', ordenId)
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudo leer el avance de la orden: ${error.message}`)
  return (data ?? []) as unknown as Avance[]
}

/** Las fotos de un puñado de avances, agrupadas por avance. */
export async function fotosDeAvances(avanceIds: string[]) {
  if (avanceIds.length === 0) return {} as Record<string, FotoDeAvance[]>

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_avance_fotos')
    .select('id, avance_id, bucket, ruta_storage, nombre_archivo, pie')
    .in('avance_id', avanceIds)
    .order('orden_visual')

  if (error) throw new Error(`No se pudieron leer las fotos: ${error.message}`)

  const porAvance: Record<string, FotoDeAvance[]> = {}
  for (const foto of (data ?? []) as unknown as FotoDeAvance[]) {
    ;(porAvance[foto.avance_id] ??= []).push(foto)
  }
  return porAvance
}

/**
 * Enlaces temporales para mostrar las fotos. El bucket es privado, así que cada
 * imagen necesita su enlace firmado; se piden todas de una vez.
 */
export async function enlacesDeFotos(rutas: string[], segundos = 600) {
  if (rutas.length === 0) return {} as Record<string, string>

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('fotos-avance')
    .createSignedUrls(rutas, segundos)

  // Sin enlaces la pantalla igual sirve: se ve el texto del avance sin la foto.
  if (error || !data) return {} as Record<string, string>

  const enlaces: Record<string, string> = {}
  for (const item of data) {
    if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  }
  return enlaces
}

/** Las etapas de una orden, para elegir a cuál se le está cargando el avance. */
export async function etapasDeLaOrden(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_etapas')
    .select('id, estado, avance_porcentaje, orden_secuencia, etapa:etapas_catalogo!inner(nombre)')
    .eq('orden_id', ordenId)
    .order('orden_secuencia')

  if (error) throw new Error(`No se pudieron leer las etapas: ${error.message}`)

  return (data ?? []).map((e) => ({
    id: e.id,
    estado: e.estado as string,
    avance: Number(e.avance_porcentaje ?? 0),
    nombre: (e.etapa as unknown as { nombre: string }).nombre,
  }))
}

/** La cabecera de la unidad, para el título de la pantalla de avance. */
export async function cabeceraDeAvance(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_resumen')
    .select('id, numero, estado, cliente, placa, descripcion, avance_porcentaje, fecha_entrega_comprometida, dias_habiles_restantes')
    .eq('id', ordenId)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer la orden: ${error.message}`)
  return data
}

/** Cuántas unidades hay, cuántas trabadas y cuántas sin noticias. */
export function resumirTablero(filas: FilaTablero[]) {
  return {
    total: filas.length,
    trabadas: filas.filter((f) => f.impedimento).length,
    sinNoticias: filas.filter((f) => f.dias_sin_avance === null || f.dias_sin_avance >= 3).length,
    atrasadas: filas.filter(
      (f) => f.dias_habiles_restantes !== null && Number(f.dias_habiles_restantes) < 0,
    ).length,
  }
}
