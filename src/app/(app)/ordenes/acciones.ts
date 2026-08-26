'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { documentosFaltantes } from '@/lib/datos/documentos'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'

const esquemaNuevaOrden = z.object({
  cliente_id: z.string().uuid('Selecciona un cliente'),
  unidad_id: z.string().uuid().optional().or(z.literal('')),
  sede_id: z.string().uuid('Selecciona la sede o taller'),
  tipo_carroceria_id: z.string().uuid().optional().or(z.literal('')),
  tipo_trabajo: z.enum(['FABRICACION', 'REPARACION', 'REPOTENCIACION', 'MANTENIMIENTO', 'GARANTIA']),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']),
  descripcion: z.string().trim().min(5, 'Describe el trabajo a realizar'),
  especificaciones_tecnicas: z.string().trim().optional(),
  fecha_inicio_programada: z.string().optional(),
  fecha_fin_programada: z.string().optional(),
  fecha_entrega_comprometida: z.string().optional(),
  responsable_id: z.string().uuid().optional().or(z.literal('')),
  monto_presupuestado: z.coerce.number().min(0).default(0),
  observaciones: z.string().trim().optional(),
})

function opcional(valor: FormDataEntryValue | null) {
  const t = typeof valor === 'string' ? valor.trim() : ''
  return t === '' ? null : t
}

export async function crearOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.crear')) return { ok: false, error: 'No tienes permiso para crear órdenes.' }

  const analisis = esquemaNuevaOrden.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del formulario.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .insert({
      cliente_id: v.cliente_id,
      unidad_id: opcional(v.unidad_id ?? null),
      sede_id: v.sede_id,
      tipo_carroceria_id: opcional(v.tipo_carroceria_id ?? null),
      tipo_trabajo: v.tipo_trabajo,
      prioridad: v.prioridad,
      descripcion: v.descripcion,
      especificaciones_tecnicas: opcional(v.especificaciones_tecnicas ?? null),
      fecha_inicio_programada: opcional(v.fecha_inicio_programada ?? null),
      fecha_fin_programada: opcional(v.fecha_fin_programada ?? null),
      fecha_entrega_comprometida: opcional(v.fecha_entrega_comprometida ?? null),
      responsable_id: opcional(v.responsable_id ?? null),
      monto_presupuestado: v.monto_presupuestado,
      observaciones: opcional(v.observaciones ?? null),
    })
    .select('id, numero')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/ordenes')
  redirect(`/ordenes/${data.id}?creada=1`)
}

const esquemaCambioEstado = z.object({
  orden_id: z.string().uuid(),
  estado: z.enum([
    'BORRADOR', 'APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA',
    'CONTROL_CALIDAD', 'TERMINADA', 'ENTREGADA', 'FACTURADA', 'ANULADA',
  ]),
  motivo: z.string().trim().optional(),
})

export async function cambiarEstadoOrden(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()

  const analisis = esquemaCambioEstado.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }
  const { orden_id, estado, motivo } = analisis.data

  const permisoNecesario =
    estado === 'APROBADA' ? 'ordenes.aprobar'
    : estado === 'ANULADA' ? 'ordenes.anular'
    : estado === 'ENTREGADA' ? 'ordenes.entregar'
    : 'ordenes.cambiar_estado'

  if (!puede(perfil, permisoNecesario)) {
    return { ok: false, error: 'No tienes permiso para realizar este cambio de estado.' }
  }

  // Pausar y anular exigen motivo; la base también lo valida, pero avisar aquí
  // evita un viaje al servidor con un mensaje menos claro.
  if ((estado === 'PAUSADA' || estado === 'ANULADA') && !motivo) {
    return { ok: false, error: 'Indica el motivo para continuar.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ordenes_trabajo')
    .update({
      estado,
      ...(estado === 'PAUSADA' ? { motivo_pausa: motivo } : {}),
      ...(estado === 'ANULADA' ? { motivo_anulacion: motivo } : {}),
    })
    .eq('id', orden_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${orden_id}`)
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Estado actualizado.' }
}

const esquemaAvanceEtapa = z.object({
  etapa_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  avance_porcentaje: z.coerce.number().min(0).max(100),
  estado: z.enum(['PENDIENTE', 'EN_PROCESO', 'PAUSADA', 'REQUIERE_REVISION', 'TERMINADA', 'OMITIDA']),
  observaciones: z.string().trim().optional(),
})

export async function actualizarEtapa(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para registrar avance de producción.' }
  }

  const analisis = esquemaAvanceEtapa.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase
    .from('ot_etapas')
    .update({
      avance_porcentaje: v.avance_porcentaje,
      estado: v.estado,
      // Solo se toca cuando el formulario mandó algo. Antes se escribía
      // `|| null`, así que cualquiera que moviera el porcentaje borraba en
      // silencio lo que había anotado el turno anterior.
      ...(v.observaciones !== undefined ? { observaciones: v.observaciones || null } : {}),
    })
    .eq('id', v.etapa_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Avance registrado.' }
}

const esquemaEntrega = z.object({
  orden_id: z.string().uuid(),
  recibe_nombre: z.string().trim().min(3, 'Escribe quién recibe la unidad'),
  recibe_documento: z.string().trim().optional(),
  recibe_cargo: z.string().trim().optional(),
  garantia_meses: z.coerce.number().int().min(0).max(120).default(12),
  conforme: z.coerce.boolean().default(true),
  observaciones: z.string().trim().optional(),
})

/**
 * Registra el acta de conformidad, que es lo que entrega la orden.
 *
 * La orden no pasa a ENTREGADA cambiándole el estado: el disparador de la base
 * rechaza ese UPDATE con «no se puede entregar sin acta de conformidad». Se
 * entrega insertando el acta, y la base mueve el estado sola. Por eso esta
 * acción nunca toca ordenes_trabajo.
 */
export async function registrarEntrega(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.entregar')) {
    return { ok: false, error: 'No tienes permiso para entregar órdenes.' }
  }

  const analisis = esquemaEntrega.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del acta.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // Se avisa qué falta con nombres legibles antes de intentar el insert. Si no,
  // el usuario recibiría el mensaje del disparador, que nombra códigos internos
  // y no dice cuántos documentos faltan.
  const faltantes = await documentosFaltantes(v.orden_id)
  if (faltantes.length > 0) {
    const lista = faltantes.map((d) => d.nombre).join(', ')
    return {
      ok: false,
      error: `Falta documentación para entregar: ${lista}. Cárgala y consigue sus firmas antes de registrar el acta.`,
    }
  }

  // La regla del flujograma: la unidad no sale si el cliente tiene deuda.
  // Tesorería libera; recién entonces entra el acta.
  const { data: liberacion } = await supabase
    .from('liberaciones_tesoreria')
    .select('id')
    .eq('orden_id', v.orden_id)
    .maybeSingle()

  if (!liberacion) {
    return {
      ok: false,
      error:
        'Tesorería todavía no libera esta orden: falta confirmar que el cliente esté al día. Pide la liberación desde la tarjeta «Salida de la unidad».',
    }
  }

  const { error } = await supabase.from('ot_entregas').insert({
    orden_id: v.orden_id,
    recibe_nombre: v.recibe_nombre,
    recibe_documento: v.recibe_documento || null,
    recibe_cargo: v.recibe_cargo || null,
    garantia_meses: v.garantia_meses,
    conforme: v.conforme,
    observaciones: v.observaciones || null,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Acta registrada. La orden quedó entregada.' }
}

const esquemaComentario = z.object({
  orden_id: z.string().uuid(),
  descripcion: z.string().trim().min(3, 'Escribe el comentario'),
})

export async function comentarOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.ver')) return { ok: false, error: 'No tienes acceso a esta orden.' }

  const analisis = esquemaComentario.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el comentario.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('ot_registrar_evento', {
    p_orden_id: analisis.data.orden_id,
    p_tipo: 'COMENTARIO',
    p_descripcion: analisis.data.descripcion,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Comentario registrado.' }
}

/**
 * Tesorería confirma que el cliente está al día. Es la compuerta que la base
 * exige antes de aceptar el acta de entrega.
 */
export async function liberarTesoreria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.liberar')) {
    return { ok: false, error: 'Liberar la salida es de tesorería o de gerencia.' }
  }

  const analisis = z
    .object({
      orden_id: z.string().uuid(),
      observacion: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase.from('liberaciones_tesoreria').insert({
    orden_id: analisis.data.orden_id,
    liberado_por: perfil.id,
    observacion: analisis.data.observacion || null,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Salida liberada: el cliente está al día.' }
}

/** El último sello del flujo: avisar a portería que la unidad puede cruzar. */
export async function confirmarSalida(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.entregar', 'requerimientos.crear'])) {
    return { ok: false, error: 'Confirmar la salida es de quien coordina la entrega.' }
  }

  const analisis = z
    .object({ entrega_id: z.string().uuid(), orden_id: z.string().uuid() })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  // La función de la base exige el permiso, sella quién y cuándo, y rechaza
  // la segunda confirmación: acá solo se transmite el resultado.
  const supabase = await createClient()
  const { error } = await supabase.rpc('confirmar_salida_porteria', {
    p_entrega: analisis.data.entrega_id,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Portería avisada: la unidad puede salir.' }
}
