'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'

const esquemaMovimiento = z.object({
  tipo: z.enum(['INGRESO', 'SALIDA_OT', 'DEVOLUCION_OT', 'TRANSFERENCIA', 'AJUSTE', 'SALIDA_MERMA']),
  almacen_id: z.string().uuid('Selecciona el almacén'),
  almacen_destino_id: z.string().uuid().optional().or(z.literal('')),
  orden_id: z.string().uuid().optional().or(z.literal('')),
  proveedor_id: z.string().uuid().optional().or(z.literal('')),
  fecha: z.string().optional(),
  documento_referencia: z.string().trim().optional(),
  motivo: z.string().trim().optional(),
  observaciones: z.string().trim().optional(),
})

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

export async function crearMovimiento(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.movimientos')) {
    return { ok: false, error: 'No tienes permiso para registrar movimientos de almacén.' }
  }

  const analisis = esquemaMovimiento.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data

  // Estas dos reglas también viven en la base; avisarlas aquí ahorra un viaje
  // y da un mensaje más claro que el del CHECK.
  if ((v.tipo === 'SALIDA_OT' || v.tipo === 'DEVOLUCION_OT') && !nulo(v.orden_id)) {
    return { ok: false, error: 'Indica a qué orden de trabajo corresponde el movimiento.' }
  }
  if (v.tipo === 'TRANSFERENCIA' && !nulo(v.almacen_destino_id)) {
    return { ok: false, error: 'Indica el almacén de destino de la transferencia.' }
  }
  if (v.tipo === 'AJUSTE' && !nulo(v.motivo)) {
    return { ok: false, error: 'Un ajuste de inventario exige explicar el motivo.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('movimientos_almacen')
    .insert({
      tipo: v.tipo,
      almacen_id: v.almacen_id,
      almacen_destino_id: v.tipo === 'TRANSFERENCIA' ? nulo(v.almacen_destino_id) : null,
      orden_id: nulo(v.orden_id),
      proveedor_id: nulo(v.proveedor_id),
      fecha: v.fecha || undefined,
      documento_referencia: nulo(v.documento_referencia),
      motivo: nulo(v.motivo),
      observaciones: nulo(v.observaciones),
      responsable_id: perfil.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/almacen/movimientos')
  redirect(`/almacen/movimientos/${data.id}`)
}

const esquemaLineaMovimiento = z.object({
  movimiento_id: z.string().uuid(),
  material_id: z.string().uuid('Selecciona el material'),
  cantidad: z.coerce.number().refine((n) => n !== 0, 'La cantidad no puede ser cero'),
  costo_unitario: z.coerce.number().min(0).default(0),
  observaciones: z.string().trim().optional(),
})

export async function agregarLineaMovimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.movimientos')) {
    return { ok: false, error: 'No tienes permiso para modificar movimientos.' }
  }

  const analisis = esquemaLineaMovimiento.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la línea.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase.from('movimiento_detalle').insert({
    movimiento_id: v.movimiento_id,
    material_id: v.material_id,
    cantidad: v.cantidad,
    costo_unitario: v.costo_unitario,
    observaciones: v.observaciones?.trim() || null,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Ese material ya está en el documento; edita la línea existente.' }
    }
    return { ok: false, error: mensajeDeError(error) }
  }

  revalidatePath(`/almacen/movimientos/${v.movimiento_id}`)
  return { ok: true, mensaje: 'Material agregado.' }
}

export async function eliminarLineaMovimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.movimientos')) {
    return { ok: false, error: 'No tienes permiso para modificar movimientos.' }
  }

  const id = String(datos.get('linea_id') ?? '')
  const movimientoId = String(datos.get('movimiento_id') ?? '')
  if (!id || !movimientoId) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()
  // Acotado también por el movimiento del formulario: el id de la línea llega
  // del navegador y sin esto podría apuntar a la de otro documento.
  const { data, error } = await supabase
    .from('movimiento_detalle')
    .delete()
    .eq('id', id)
    .eq('movimiento_id', movimientoId)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/almacen/movimientos/${movimientoId}`)
  return { ok: true, mensaje: 'Línea eliminada.' }
}

/**
 * Confirma el movimiento: escribe el kardex, recalcula el costo promedio y
 * actualiza las existencias. A partir de aquí el documento es inmutable.
 */
export async function confirmarMovimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.confirmar')) {
    return { ok: false, error: 'No tienes permiso para confirmar movimientos de almacén.' }
  }

  const id = String(datos.get('movimiento_id') ?? '')
  if (!id) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('confirmar_movimiento_almacen', { p_movimiento: id })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/almacen/movimientos/${id}`)
  revalidatePath('/almacen')
  revalidatePath('/costos')
  return { ok: true, mensaje: 'Movimiento confirmado y kardex actualizado.' }
}

export async function anularMovimiento(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.movimientos')) {
    return { ok: false, error: 'No tienes permiso para anular movimientos.' }
  }

  const id = String(datos.get('movimiento_id') ?? '')
  const motivo = String(datos.get('motivo') ?? '').trim()
  if (!id) return { ok: false, error: 'Solicitud inválida.' }
  if (!motivo) return { ok: false, error: 'Indica el motivo de la anulación.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_movimiento_almacen', {
    p_movimiento: id,
    p_motivo: motivo,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/almacen/movimientos/${id}`)
  revalidatePath('/almacen/movimientos')
  return { ok: true, mensaje: 'Movimiento anulado.' }
}

// -------------------------------------------------------------- requerimientos

const esquemaRequerimiento = z.object({
  orden_id: z.string().uuid('Selecciona la orden de trabajo'),
  almacen_id: z.string().uuid().optional().or(z.literal('')),
  fecha_requerida: z.string().optional(),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
  observaciones: z.string().trim().optional(),
})

export async function crearRequerimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.crear')) {
    return { ok: false, error: 'No tienes permiso para solicitar material.' }
  }

  const analisis = esquemaRequerimiento.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // El requerimiento pertenece al taller donde se ejecuta la orden; se toma de
  // ella en lugar de pedírselo otra vez a quien lo solicita.
  const { data: orden } = await supabase
    .from('ordenes_trabajo')
    .select('sede_id')
    .eq('id', v.orden_id)
    .maybeSingle()

  if (!orden) return { ok: false, error: 'La orden de trabajo no existe.' }

  const { data, error } = await supabase
    .from('requerimientos')
    .insert({
      orden_id: v.orden_id,
      sede_id: orden.sede_id,
      almacen_id: nulo(v.almacen_id),
      fecha_requerida: nulo(v.fecha_requerida),
      prioridad: v.prioridad,
      observaciones: nulo(v.observaciones),
      solicitante_id: perfil.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/almacen/requerimientos')
  redirect(`/almacen/requerimientos/${data.id}`)
}

const esquemaLineaRequerimiento = z.object({
  requerimiento_id: z.string().uuid(),
  material_id: z.string().uuid('Selecciona el material'),
  cantidad_solicitada: z.coerce.number().positive('La cantidad debe ser mayor que cero'),
  especificacion: z.string().trim().optional(),
})

export async function agregarLineaRequerimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.crear')) {
    return { ok: false, error: 'No tienes permiso para modificar requerimientos.' }
  }

  const analisis = esquemaLineaRequerimiento.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la línea.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { error } = await supabase.from('requerimiento_detalle').insert({
    requerimiento_id: v.requerimiento_id,
    material_id: v.material_id,
    cantidad_solicitada: v.cantidad_solicitada,
    especificacion: v.especificacion?.trim() || null,
  })

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: 'Ese material ya está en el requerimiento.' }
    }
    return { ok: false, error: mensajeDeError(error) }
  }

  revalidatePath(`/almacen/requerimientos/${v.requerimiento_id}`)
  return { ok: true, mensaje: 'Material agregado.' }
}

export async function aprobarRequerimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.aprobar')) {
    return { ok: false, error: 'No tienes permiso para aprobar requerimientos.' }
  }

  const id = String(datos.get('requerimiento_id') ?? '')
  if (!id) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('aprobar_requerimiento', {
    p_requerimiento: id,
    p_aprobador: perfil.id,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/almacen/requerimientos/${id}`)
  revalidatePath('/almacen')
  return { ok: true, mensaje: 'Requerimiento aprobado y stock reservado.' }
}

export async function rechazarRequerimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.aprobar')) {
    return { ok: false, error: 'No tienes permiso para rechazar requerimientos.' }
  }

  const id = String(datos.get('requerimiento_id') ?? '')
  const motivo = String(datos.get('motivo') ?? '').trim()
  if (!id) return { ok: false, error: 'Solicitud inválida.' }
  if (!motivo) return { ok: false, error: 'Indica el motivo del rechazo.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('requerimientos')
    .update({ estado: 'RECHAZADO', motivo_rechazo: motivo, aprobador_id: perfil.id })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/almacen/requerimientos/${id}`)
  return { ok: true, mensaje: 'Requerimiento rechazado.' }
}
