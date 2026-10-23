'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { ACCIONES_FICHA, BUCKET_FICHAS_VEHICULO, MAXIMO_MB_FICHA, esEstadoPunto, rutaFichaVehiculo } from '@/lib/dominio/ficha-vehiculo'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La ficha única de ingreso y salida del vehículo y la revisión de Tesorería
 * para su salida, por ingreso a la planta (migración 20261016110000). Cada
 * acción pide el mismo permiso que la función de la base que llama: la ficha y
 * el pedido, `vehiculos.registrar` (Requerimientos); la respuesta,
 * `tesoreria.liberar`.
 */

const SOLO_REQUERIMIENTOS = 'La ficha del vehículo y el pedido a Tesorería los lleva el área de Requerimientos.'

function texto(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const FECHA = z.union([z.iso.date(), z.literal('')])

const FICHA = z.object({
  registro: z.guid(),
  accion: z.enum(ACCIONES_FICHA),
  marca: z.string().max(80, 'La marca pasa de 80 caracteres.'),
  conductor_ingreso: z.string().max(120, 'El conductor pasa de 120 caracteres.'),
  dni_ingreso: z.string().max(20, 'El DNI pasa de 20 caracteres.'),
  fecha_ingreso: FECHA,
  combustible_ingreso: z.string().max(40, 'El combustible pasa de 40 caracteres.'),
  conductor_salida: z.string().max(120, 'El conductor pasa de 120 caracteres.'),
  dni_salida: z.string().max(20, 'El DNI pasa de 20 caracteres.'),
  fecha_salida: FECHA,
  combustible_salida: z.string().max(40, 'El combustible pasa de 40 caracteres.'),
  adicionales: z.string().max(2000, 'Los accesorios adicionales pasan de 2000 caracteres.'),
  trabajos: z.string().max(2000, 'Los trabajos realizados pasan de 2000 caracteres.'),
  observacion_ingreso: z.string().max(2000, 'La observación de ingreso pasa de 2000 caracteres.'),
  observacion_salida: z.string().max(2000, 'La observación de salida pasa de 2000 caracteres.'),
})

const CAMPOS = [
  'marca',
  'conductor_ingreso',
  'dni_ingreso',
  'fecha_ingreso',
  'combustible_ingreso',
  'conductor_salida',
  'dni_salida',
  'fecha_salida',
  'combustible_salida',
  'adicionales',
  'trabajos',
  'observacion_ingreso',
  'observacion_salida',
] as const

/**
 * Guardar avance, cerrar el ingreso o cerrar la salida. Los puntos llegan como
 * `ingreso_{codigo}` y `salida_{codigo}`; la base conserva lo del ingreso
 * cerrado aunque llegue otra cosa y rechaza un punto que no es del formato.
 */
export async function guardarFichaVehiculo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'vehiculos.registrar')) return { ok: false, error: SOLO_REQUERIMIENTOS }

  const analisis = FICHA.safeParse({
    registro: texto(formulario, 'registro'),
    accion: texto(formulario, 'accion'),
    ...Object.fromEntries(CAMPOS.map((c) => [c, texto(formulario, c)])),
  })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos de la ficha.' }
  const { registro, accion, ...campos } = analisis.data

  const items: Record<string, { ingreso?: string; salida?: string }> = {}
  for (const [clave, valor] of formulario.entries()) {
    const punto = /^(ingreso|salida)_([A-Z0-9_]{1,40})$/.exec(clave)
    if (!punto || !esEstadoPunto(valor)) continue
    const fase = punto[1] as 'ingreso' | 'salida'
    items[punto[2]] = { ...items[punto[2]], [fase]: valor }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('guardar_ficha_vehiculo', {
    p_registro: registro,
    p_accion: accion,
    p_datos: { ...campos, items },
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'La ficha no quedó guardada. Vuelve a cargar la pantalla.' }

  revalidatePath(`/vehiculos/${registro}`)
  return {
    ok: true,
    mensaje:
      accion === 'CERRAR_INGRESO'
        ? 'Ingreso cerrado: sus datos quedan fijos. Completa la salida cuando el vehículo esté por salir.'
        : accion === 'CERRAR_SALIDA'
          ? 'Salida cerrada. Descarga la ficha, hazla firmar y adjunta el escaneo.'
          : 'Ficha guardada.',
  }
}

/** El PDF que el navegador ya subió: suyo, PDF de verdad y de hasta 15 MB. */
async function escaneoSubido(ruta: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: archivo, error } = await supabase.storage.from(BUCKET_FICHAS_VEHICULO).download(ruta)
  if (error || !archivo) return 'No se pudo comprobar el escaneo cargado. Revisa la conexión y vuelve a intentar.'
  if (archivo.size < 1 || archivo.size > MAXIMO_MB_FICHA * 1024 * 1024 || (await archivo.slice(0, 5).text()) !== '%PDF-') {
    return `El escaneo tiene que ser un PDF de hasta ${MAXIMO_MB_FICHA} MB.`
  }
  return null
}

/** Anota el escaneo firmado, ya subido a `{registro}/{archivo}.pdf`, en la ficha con la salida cerrada. */
export async function adjuntarFichaFirmada(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'vehiculos.registrar')) return { ok: false, error: SOLO_REQUERIMIENTOS }
  const analisis = z
    .object({ registro: z.guid(), archivo: z.guid(), nombre_archivo: z.string().min(1).max(200) })
    .safeParse({ registro: texto(formulario, 'registro'), archivo: texto(formulario, 'archivo'), nombre_archivo: texto(formulario, 'nombre_archivo') })
  if (!analisis.success) return { ok: false, error: 'Elige el escaneo firmado en PDF.' }
  const { registro, archivo, nombre_archivo } = analisis.data
  const ruta = rutaFichaVehiculo(registro, archivo)
  const malo = await escaneoSubido(ruta)
  if (malo) return { ok: false, error: malo }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('adjuntar_ficha_vehiculo_firmada', { p_registro: registro, p_ruta: ruta, p_nombre: nombre_archivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'El escaneo no quedó anotado. Vuelve a cargar la pantalla.' }
  revalidatePath(`/vehiculos/${registro}`)
  return { ok: true, mensaje: 'Escaneo firmado adjunto. Ya puedes pedirle a Tesorería la revisión para la salida.' }
}

/** Requerimientos le pide a Tesorería revisar la salida. Con el mismo id, un reintento no duplica. */
export async function pedirRevisionSalida(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'vehiculos.registrar')) return { ok: false, error: SOLO_REQUERIMIENTOS }
  const analisis = z
    .object({
      id: z.guid(),
      registro: z.guid(),
      concepto: z.string().min(3, 'Escribe qué tiene que revisar Tesorería.').max(2000, 'El pedido pasa de 2000 caracteres.'),
    })
    .safeParse({ id: texto(formulario, 'id'), registro: texto(formulario, 'registro'), concepto: texto(formulario, 'concepto') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const { id, registro, concepto } = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('solicitar_revision_salida', { p_id: id, p_registro: registro, p_concepto: concepto })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id) return { ok: false, error: 'El pedido no quedó registrado. Vuelve a cargar la pantalla.' }
  revalidatePath(`/vehiculos/${registro}`)
  revalidatePath('/tesoreria/por-cobrar')
  return { ok: true, mensaje: 'Pedido enviado: Tesorería recibe el aviso.' }
}

/** Tesorería da por revisada la salida o la observa, siempre con su respuesta. */
export async function responderRevisionSalida(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.liberar')) return { ok: false, error: 'No tienes permiso para responder la revisión de la salida.' }
  const analisis = z
    .object({
      id: z.guid(),
      estado: z.enum(['ATENDIDA', 'OBSERVADA'], { message: 'Elige si la salida queda revisada u observada.' }),
      respuesta: z.string().min(3, 'Escribe la respuesta para Requerimientos.').max(2000, 'La respuesta pasa de 2000 caracteres.'),
    })
    .safeParse({ id: texto(formulario, 'id'), estado: texto(formulario, 'estado'), respuesta: texto(formulario, 'respuesta') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const { id, estado, respuesta } = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('responder_revision_salida', { p_id: id, p_estado: estado, p_respuesta: respuesta })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id) return { ok: false, error: 'La respuesta no quedó registrada. Vuelve a cargar la pantalla.' }
  revalidatePath('/tesoreria/por-cobrar')
  revalidatePath('/vehiculos', 'layout')
  return { ok: true, mensaje: estado === 'ATENDIDA' ? 'Salida revisada: Requerimientos recibe el aviso.' : 'Salida observada: Requerimientos recibe tu respuesta.' }
}
