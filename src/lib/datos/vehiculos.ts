import 'server-only'

import { BUCKET_FICHAS_VEHICULO } from '@/lib/dominio/ficha-vehiculo'
import { BUCKET_FOTOS_VEHICULO } from '@/lib/dominio/requerimientos'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

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

/** Un código interno que puede entrar a la planta: su unidad tiene una OT que no está anulada. */
export type CodigoParaIngreso = {
  codigo_interno: string
  orden_numero: string
  cliente: string
  unidad: string
  placa: string | null
  chasis: string | null
  /** Ya entró y no ha salido: no entra otra vez. */
  en_planta: boolean
}

/** Los códigos que ofrece la ventana del ingreso, con todo lo que se carga solo (`vehiculos_codigos_para_ingreso`). */
export async function codigosParaIngreso(): Promise<CodigoParaIngreso[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('vehiculos_codigos_para_ingreso')
  if (error) throw new Error(`No se pudo leer los códigos internos con OT: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.codigo_interno && f.orden_numero
      ? [
          {
            codigo_interno: f.codigo_interno,
            orden_numero: f.orden_numero,
            cliente: f.cliente ?? '',
            unidad: f.unidad ?? '',
            placa: f.placa,
            chasis: f.chasis,
            en_planta: Boolean(f.en_planta),
          },
        ]
      : [],
  )
}

/**
 * Lo que espera la salida de un vehículo de trabajo: el 100 % del avance de su
 * código y la revisión de Tesorería atendida (migración 20261020166000). Los
 * mensajes los escribe la base; `null` es que no falta nada.
 */
export type EstadoDeSalida = {
  exige: boolean
  avance: number | null
  tesoreria: string | null
  falta_para_pedir: string | null
  falta_para_salir: string | null
}

/** El estado de la salida de cada ingreso que sigue en la planta, por id. */
export async function estadosDeSalida(ids: string[]): Promise<Map<string, EstadoDeSalida>> {
  const estados = new Map<string, EstadoDeSalida>()
  if (ids.length === 0) return estados
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('vehiculos_estado_de_salida', { p_registros: ids })
  if (error) throw new Error(`No se pudo leer qué le falta a cada vehículo para salir: ${error.message}`)
  for (const f of data ?? []) {
    if (!f.registro_id) continue
    estados.set(f.registro_id, {
      exige: Boolean(f.exige),
      avance: f.avance,
      tesoreria: f.tesoreria,
      falta_para_pedir: f.falta_para_pedir,
      falta_para_salir: f.falta_para_salir,
    })
  }
  return estados
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

// ------------------------------------------------- La ficha y la revisión de salida

/** Un punto del formato de inspección vehicular de Metal Work. */
export type PuntoDeFicha = { codigo: string; categoria: string; nombre: string; orden: number }

/** La ficha única de ingreso y salida de un ingreso a la planta (migración 20261016110000). */
export type FichaDeVehiculo = {
  id: string
  marca: string
  conductor_ingreso: string
  dni_ingreso: string
  fecha_ingreso: string | null
  combustible_ingreso: string
  conductor_salida: string
  dni_salida: string
  fecha_salida: string | null
  combustible_salida: string
  adicionales: string
  trabajos: string
  observacion_ingreso: string
  observacion_salida: string
  items: Json
  ingreso_cerrado_en: string | null
  salida_cerrada_en: string | null
  escaneo_ruta: string | null
  escaneo_nombre: string | null
}

const COLUMNAS_FICHA =
  'id, marca, conductor_ingreso, dni_ingreso, fecha_ingreso, combustible_ingreso, conductor_salida, dni_salida, fecha_salida, combustible_salida, adicionales, trabajos, observacion_ingreso, observacion_salida, items, ingreso_cerrado_en, salida_cerrada_en, escaneo_ruta, escaneo_nombre'

/** Los puntos del formato, en el orden del impreso. */
export async function puntosDeFicha(): Promise<PuntoDeFicha[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('control_vehicular_items').select('codigo, categoria, nombre, orden').order('orden')
  if (error) throw new Error(`No se pudieron leer los puntos de la ficha: ${error.message}`)
  return data ?? []
}

/** La ficha del ingreso, si ya se empezó, con el enlace del escaneo firmado. */
export async function cargarFichaDeVehiculo(registro: string): Promise<{ ficha: FichaDeVehiculo | null; escaneo: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('registro_vehiculo_fichas').select(COLUMNAS_FICHA).eq('registro_id', registro).maybeSingle()
  if (error) throw new Error(`No se pudo leer la ficha del vehículo: ${error.message}`)
  if (!data?.escaneo_ruta) return { ficha: data, escaneo: null }
  const { data: enlace } = await supabase.storage
    .from(BUCKET_FICHAS_VEHICULO)
    .createSignedUrl(data.escaneo_ruta, 3600, { download: data.escaneo_nombre ?? 'ficha-firmada.pdf' })
  return { ficha: data, escaneo: enlace?.signedUrl ?? null }
}

/** Un pedido de revisión de la salida a Tesorería, con su respuesta. */
export type RevisionDeSalida = {
  id: string
  concepto: string
  estado: string
  respuesta: string | null
  creado_en: string
  atendido_en: string | null
  solicitante: string | null
  atendio: string | null
}

const nombre = (u: { nombres: string; apellidos: string } | null) => (u ? `${u.nombres} ${u.apellidos}`.trim() : null)

/** Los pedidos del ingreso, del último al primero. */
export async function revisionesDeSalida(registro: string): Promise<RevisionDeSalida[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('registro_vehiculo_revisiones')
    .select(
      'id, concepto, estado, respuesta, creado_en, atendido_en, solicitante:usuarios!registro_vehiculo_revisiones_solicitado_por_fkey(nombres, apellidos), atendio:usuarios!registro_vehiculo_revisiones_atendido_por_fkey(nombres, apellidos)',
    )
    .eq('registro_id', registro)
    .order('creado_en', { ascending: false })
  if (error) throw new Error(`No se pudieron leer las revisiones de salida: ${error.message}`)
  return (data ?? []).map((r) => ({ ...r, solicitante: nombre(r.solicitante), atendio: nombre(r.atendio) }))
}

/** Lo que espera a Tesorería: cada vehículo con su código, quién lo pidió y el escaneo firmado. */
export type RevisionPendiente = {
  id: string
  registro_id: string
  vehiculo: string
  codigo_interno: string | null
  unidad: string
  empresa: string
  ingreso_en: string
  concepto: string
  solicitante: string | null
  creado_en: string
  escaneo: string | null
}

export async function revisionesDeSalidaPendientes(): Promise<RevisionPendiente[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('revisiones_de_salida_pendientes')
  if (error) throw new Error(`No se pudieron leer las salidas por revisar: ${error.message}`)
  const filas = data ?? []
  const rutas = filas.flatMap((f) => (f.escaneo_ruta ? [f.escaneo_ruta] : []))
  const enlaces: Record<string, string> = {}
  if (rutas.length > 0) {
    const { data: firmados } = await supabase.storage.from(BUCKET_FICHAS_VEHICULO).createSignedUrls(rutas, 3600)
    for (const f of firmados ?? []) if (f.path && f.signedUrl) enlaces[f.path] = f.signedUrl
  }
  return filas.flatMap((f) =>
    f.id && f.registro_id
      ? [
          {
            id: f.id,
            registro_id: f.registro_id,
            vehiculo: f.placa ?? (f.chasis ? `Chasis ${f.chasis}` : (f.codigo_interno ?? 'Vehículo')),
            codigo_interno: f.codigo_interno,
            unidad: f.unidad ?? '',
            empresa: f.empresa ?? '',
            ingreso_en: f.ingreso_en ?? '',
            concepto: f.concepto ?? '',
            solicitante: f.solicitante,
            creado_en: f.creado_en ?? '',
            escaneo: f.escaneo_ruta ? (enlaces[f.escaneo_ruta] ?? null) : null,
          },
        ]
      : [],
  )
}
