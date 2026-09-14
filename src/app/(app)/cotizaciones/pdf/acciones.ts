'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La cotización en PDF, de punta a punta (migración 101):
 *
 *   · El vendedor la sube (`cotizaciones.crear`). El archivo ya viajó del
 *     navegador a Storage; acá se anota con lo poco que el sistema necesita.
 *   · Gerencia la aprueba o la rechaza (`cotizaciones.revisar`), que es el
 *     mismo permiso con que da el visto a las de siempre.
 *   · Administración emite la orden (`ordenes.crear`): la base la crea
 *     aprobada, con sus etapas y con su PDF pegado, de una vez.
 *
 * Cada permiso es exactamente el que pide la política o la función de la base.
 */
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

// PDF o Word (migración 103), y la extensión de la ruta tiene que decir lo mismo.
const EXTENSION_DE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
}
const mimeCotizacion = z.enum(Object.keys(EXTENSION_DE) as [string, ...string[]], {
  message: 'La cotización se sube en PDF o en Word.',
})

const esquemaSubir = z.object({
  id: z.string().uuid(),
  numero: z.string().trim().min(3, 'Escribe el número que dice la cotización').max(40),
  cliente_id: z.string().uuid('Elige el cliente'),
  tipo_carroceria_id: z.string().uuid('Elige qué se fabrica'),
  nombre_archivo: z.string().trim().min(1).max(200),
  ruta_storage: z.string().min(1),
  mime_type: mimeCotizacion.default('application/pdf'),
  tamano_bytes: z.coerce.number().int().min(0).optional(),
})

export async function registrarCotizacionPdf(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.crear')) {
    return { ok: false, error: 'La cotización la sube el vendedor.' }
  }

  const analisis = esquemaSubir.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }
  const v = analisis.data

  if (!v.ruta_storage.startsWith(`cot/${v.id}/`) || !v.ruta_storage.endsWith(`.${EXTENSION_DE[v.mime_type]}`)) {
    return { ok: false, error: 'El archivo no llegó en su sitio: vuelve a elegirlo.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizaciones_pdf')
    .insert({
      id: v.id,
      numero: v.numero,
      cliente_id: v.cliente_id,
      tipo_carroceria_id: v.tipo_carroceria_id,
      nombre_archivo: v.nombre_archivo,
      ruta_storage: v.ruta_storage,
      mime_type: v.mime_type,
      tamano_bytes: v.tamano_bytes ?? null,
      registrado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      error: error.message.includes('uq_cotizacion_pdf_numero')
        ? `Ya hay una cotización con el número ${v.numero}. Si Gerencia la rechazó, súbela con «Subir corrección» en esa misma cotización.`
        : mensajeDeError(error),
    }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/cotizaciones/pdf')
  return { ok: true, mensaje: 'Cotización subida. Gerencia ya la tiene para revisar.' }
}

const esquemaRevisar = z.object({
  id: z.string().uuid(),
  decision: z.enum(['APROBADA', 'RECHAZADA']),
  observacion: z.string().trim().max(500).optional(),
})

export async function revisarCotizacionPdf(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.revisar')) {
    return { ok: false, error: 'La cotización la aprueba o la rechaza Gerencia.' }
  }

  const analisis = esquemaRevisar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar la cotización.' }
  const v = analisis.data

  const observacion = v.observacion ?? ''
  if (v.decision === 'RECHAZADA' && observacion.length < 3) {
    return { ok: false, error: 'Escribe por qué se rechaza: es lo que le llega al vendedor.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizaciones_pdf')
    .update(
      v.decision === 'RECHAZADA'
        ? { estado: 'RECHAZADA' as const, observacion }
        : { estado: 'APROBADA' as const },
    )
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/cotizaciones/pdf')
  return {
    ok: true,
    mensaje: v.decision === 'APROBADA' ? 'Aprobada. Administración ya puede emitir la orden.' : 'Rechazada.',
  }
}

const esquemaCorregir = z.object({
  id: z.string().uuid(),
  nombre_archivo: z.string().trim().min(1).max(200),
  ruta_storage: z.string().min(1),
  mime_type: mimeCotizacion,
  tamano_bytes: z.coerce.number().int().min(0).optional(),
})

/**
 * Subir la corrección de una cotización rechazada (migración 103). La sube
 * quien la subió —lo exigen la política y el disparador— con el archivo nuevo,
 * que ya viajó a Storage. Vuelve a «Por revisar» con una versión más, y el
 * archivo rechazado queda guardado con la observación de Gerencia.
 */
export async function corregirCotizacionPdf(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirSesion()

  const analisis = esquemaCorregir.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'No se pudo identificar la cotización.' }
  }
  const v = analisis.data

  if (!v.ruta_storage.startsWith(`cot/${v.id}/`) || !v.ruta_storage.endsWith(`.${EXTENSION_DE[v.mime_type]}`)) {
    return { ok: false, error: 'El archivo no llegó en su sitio: vuelve a elegirlo.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizaciones_pdf')
    .update({
      estado: 'POR_REVISAR' as const,
      nombre_archivo: v.nombre_archivo,
      ruta_storage: v.ruta_storage,
      mime_type: v.mime_type,
      tamano_bytes: v.tamano_bytes ?? null,
    })
    .eq('id', v.id)
    .eq('estado', 'RECHAZADA')
    .select('numero, version')
    .maybeSingle()

  if (error) {
    const delMotor = /violates|duplicate key|permission denied/i.test(error.message)
    return { ok: false, error: delMotor ? mensajeDeError(error) : error.message }
  }
  if (!data) {
    return { ok: false, error: 'No se pudo subir la corrección: la sube quien subió la cotización, y solo si Gerencia la rechazó.' }
  }

  revalidatePath('/cotizaciones/pdf')
  return { ok: true, mensaje: `Corrección subida: la ${data.numero} vuelve a Gerencia (versión ${data.version}).` }
}

const esquemaQuitar = z.object({ id: z.string().uuid() })

/**
 * Quitar una cotización (migraciones 102 y 103): quien la subió o Gerencia,
 * mientras esté por revisar o rechazada, y nunca si de ella salió una orden
 * —eso lo dice un disparador, con palabras—. Se va con sus versiones. Primero
 * las filas y después los archivos: el almacenamiento solo deja borrar el que
 * ya no nombra ninguna cotización ni versión, y así no queda ni una cotización
 * sin papel ni un papel suelto.
 */
export async function quitarCotizacionPdf(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirSesion()

  const analisis = esquemaQuitar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar la cotización.' }

  const supabase = await createClient()
  // Los archivos de las versiones se leen antes: al borrar la cotización, sus
  // versiones se van en cascada y ya no habría de dónde sacar las rutas.
  const { data: versiones } = await supabase
    .from('cotizaciones_pdf_versiones')
    .select('ruta_storage')
    .eq('cotizacion_id', analisis.data.id)

  const { data, error } = await supabase
    .from('cotizaciones_pdf')
    .delete()
    .eq('id', analisis.data.id)
    .select('ruta_storage')
    .maybeSingle()

  if (error) {
    const delMotor = /violates|duplicate key|permission denied/i.test(error.message)
    return { ok: false, error: delMotor ? mensajeDeError(error) : error.message }
  }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo quitar: la quita quien la subió o Gerencia, y solo mientras esté por revisar o rechazada.',
    }
  }

  revalidatePath('/cotizaciones/pdf')

  // Un archivo que la política no deja borrar vuelve sin error y sin nada
  // borrado: por eso se cuenta qué volvió, no solo si hubo error.
  const rutas = [data.ruta_storage, ...(versiones ?? []).map((v) => v.ruta_storage)]
  const { data: borrados, error: falla } = await supabase.storage.from('cotizaciones-pdf').remove(rutas)
  if (falla || (borrados?.length ?? 0) < rutas.length) {
    return { ok: true, mensaje: 'Cotización quitada, pero algún archivo no se pudo borrar. Avisa al administrador.' }
  }
  return { ok: true, mensaje: rutas.length > 1 ? 'Cotización quitada, con todas sus versiones.' : 'Cotización quitada, con su archivo.' }
}

const esquemaEmitir = z.object({
  cotizacion_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  placa: z.string().trim().max(20).optional(),
  tipo_vehiculo: z
    .enum(['VOLQUETE', 'TRACTO', 'SEMIRREMOLQUE', 'CAMION', 'REMOLQUE', 'FURGON', 'OTRO'])
    .default('SEMIRREMOLQUE'),
  marca: z.string().trim().max(80).optional(),
  modelo: z.string().trim().max(80).optional(),
  fecha_entrega: z.string().regex(ES_FECHA, 'Falta la fecha de entrega'),
  ruta_pdf: z.string().min(1),
  nombre_pdf: z.string().trim().min(1).max(200),
  tamano_pdf: z.coerce.number().int().min(0).optional(),
})

/**
 * Administración emite la orden desde la cotización aprobada. La base la crea
 * aprobada —Gerencia ya dijo que sí—, con sus etapas, sus plazos y su PDF; si
 * algo falla no queda ni orden ni papel.
 */
export async function emitirOrdenDeCotizacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.crear')) {
    return { ok: false, error: 'La orden de trabajo la emite Administración.' }
  }

  const analisis = esquemaEmitir.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos de la orden.' }
  }
  const v = analisis.data

  if (!v.placa && !v.marca && !v.modelo) {
    return { ok: false, error: 'Escribe la placa, o la marca y el modelo si todavía no tiene.' }
  }
  if (!v.ruta_pdf.startsWith(`ot/${v.orden_id}/`)) {
    return { ok: false, error: 'El PDF de la orden no llegó en su sitio: vuelve a elegirlo.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_orden_de_cotizacion', {
    p_cotizacion: v.cotizacion_id,
    p_orden: v.orden_id,
    p_placa: v.placa ?? '',
    p_tipo_vehiculo: v.tipo_vehiculo,
    p_marca: v.marca ?? '',
    p_modelo: v.modelo ?? '',
    p_fecha_entrega: v.fecha_entrega,
    p_ruta_pdf: v.ruta_pdf,
    p_nombre_pdf: v.nombre_pdf,
    p_tamano_pdf: v.tamano_pdf ?? 0,
  })

  if (error) {
    const delMotor = /violates|duplicate key|permission denied/i.test(error.message)
    return { ok: false, error: delMotor ? mensajeDeError(error) : error.message }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/ordenes')
  revalidatePath('/avance')
  return { ok: true, mensaje: 'Orden emitida.', datos: { id: data as string } }
}
