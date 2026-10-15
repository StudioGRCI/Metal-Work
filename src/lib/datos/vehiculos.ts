import 'server-only'

import { BUCKET_FOTOS_VEHICULO } from '@/lib/dominio/requerimientos'
import { createClient } from '@/lib/supabase/server'

/** Una vez que un vehículo entró a la planta, con su salida si ya salió. */
export type RegistroVehiculo = {
  id: string
  placa: string | null
  chasis: string | null
  codigo_interno: string | null
  unidad: string
  empresa: string
  motivo: string
  ingreso_en: string
  observacion_ingreso: string | null
  salida_en: string | null
  observacion_salida: string | null
  anulado_en: string | null
  motivo_anulacion: string | null
  /** Cuántas fotos se tomaron al entrar y al salir (las de antes del 2026-10-15 entraron sin fotos). */
  fotos_ingreso: number
  fotos_salida: number
}

const COLUMNAS =
  'id, placa, chasis, codigo_interno, unidad, empresa, motivo, ingreso_en, observacion_ingreso, salida_en, observacion_salida, anulado_en, motivo_anulacion'

type FilaConFotos = Omit<RegistroVehiculo, 'fotos_ingreso' | 'fotos_salida'> & { fotos: { momento: string }[] | null }

function conConteo({ fotos, ...r }: FilaConFotos): RegistroVehiculo {
  const lista = fotos ?? []
  return {
    ...r,
    fotos_ingreso: lista.filter((f) => f.momento === 'INGRESO').length,
    fotos_salida: lista.filter((f) => f.momento === 'SALIDA').length,
  }
}

/** `en_planta`: lo que está adentro ahora. `historial`: los últimos 300 ingresos. */
export async function cargarVehiculos(vista: 'en_planta' | 'historial'): Promise<RegistroVehiculo[]> {
  const supabase = await createClient()
  let consulta = supabase
    .from('registro_vehiculos')
    .select(`${COLUMNAS}, fotos:registro_vehiculo_fotos!registro_vehiculo_fotos_registro_id_fkey(momento)`)
    .order('ingreso_en', { ascending: false })
    .limit(300)
  if (vista === 'en_planta') consulta = consulta.is('salida_en', null).is('anulado_en', null)
  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo leer el registro de vehículos: ${error.message}`)
  return (data ?? []).map((f) => conConteo(f as FilaConFotos))
}

/** Una foto del ingreso o de la salida, con su enlace firmado por una hora. */
export type FotoVehiculo = { id: string; momento: 'INGRESO' | 'SALIDA'; orden: number; enlace: string | null }

export type DetalleVehiculo = RegistroVehiculo & { fotos: FotoVehiculo[] }

/** Un registro con sus fotos. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarVehiculo(id: string): Promise<DetalleVehiculo | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('registro_vehiculos')
    .select(`${COLUMNAS}, fotos:registro_vehiculo_fotos!registro_vehiculo_fotos_registro_id_fkey(id, momento, orden, ruta)`)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el registro del vehículo: ${error.message}`)
  if (!data) return null

  type Foto = { id: string; momento: string; orden: number; ruta: string }
  const fila = data as Omit<FilaConFotos, 'fotos'> & { fotos: Foto[] | null }
  const fotos = [...(fila.fotos ?? [])].sort((a, b) => a.momento.localeCompare(b.momento) || a.orden - b.orden)
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return {
    ...conConteo({ ...fila, fotos }),
    fotos: fotos.map((f) => ({
      id: f.id,
      momento: f.momento === 'SALIDA' ? 'SALIDA' : 'INGRESO',
      orden: f.orden,
      enlace: enlaces[f.ruta] ?? null,
    })),
  }
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_VEHICULO).createSignedUrls(rutas, 3600)
  // Sin enlaces la pantalla igual sirve: el registro se lee sin las fotos.
  if (error || !data) return {} as Record<string, string>
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}
