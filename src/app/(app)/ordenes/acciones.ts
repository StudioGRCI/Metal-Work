'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'

const esquemaNuevaOrden = z.object({
  // El número lo trae el papel, como el de la OT de una cotización (migración
  // 20261021110000): 2922 o 2922-2026. La base lo normaliza y lo valida.
  numero: z.string().trim().min(1, 'Escribe el número de la OT, el que trae su papel.').max(11, 'El número de la OT es como 2922 o 2922-2026.'),
  cliente_id: z.guid('Selecciona un cliente'),
  unidad_id: z.guid().optional().or(z.literal('')),
  sede_id: z.guid('Selecciona la sede o taller'),
  tipo_carroceria_id: z.guid().optional().or(z.literal('')),
  tipo_trabajo: z.enum(['FABRICACION', 'REPARACION', 'REPOTENCIACION', 'MANTENIMIENTO', 'GARANTIA']),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']),
  descripcion: z.string().trim().min(5, 'Describe el trabajo a realizar'),
  especificaciones_tecnicas: z.string().trim().optional(),
  fecha_inicio_programada: z.string().optional(),
  fecha_fin_programada: z.string().optional(),
  fecha_entrega_comprometida: z.string().optional(),
  responsable_id: z.guid().optional().or(z.literal('')),
  observaciones: z.string().trim().optional(),
  // La orden va siempre con su PDF: el navegador lo sube a la carpeta de la
  // orden y la base registra las dos cosas juntas (migración 20261017402000).
  orden_id: z.guid('Vuelve a abrir el formulario de la orden.'),
  ruta_pdf: z.string().min(1, 'Elige el PDF de la orden de trabajo.'),
  nombre_pdf: z.string().trim().min(1).max(200),
  tamano_pdf: z.coerce.number().int().positive('El PDF de la orden llegó vacío.'),
})

function opcional(valor: FormDataEntryValue | null) {
  const t = typeof valor === 'string' ? valor.trim() : ''
  return t === '' ? null : t
}

export async function crearOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.crear')) return { ok: false, error: 'No tienes permiso para crear órdenes.' }

  const analisis = esquemaNuevaOrden.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del formulario.' }
  }
  if (analisis.data.tipo_trabajo === 'GARANTIA' && !analisis.data.unidad_id) {
    return { ok: false, error: 'La OT de garantía va con la unidad que vuelve: elige su unidad.' }
  }

  const v = analisis.data
  if (!v.ruta_pdf.startsWith(`ot/${v.orden_id}/`)) {
    return { ok: false, error: 'El PDF de la orden no llegó en su sitio: vuelve a elegirlo.' }
  }
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('registrar_orden_sin_cotizacion', {
    p_orden: v.orden_id,
    p_numero: v.numero,
    p_cliente: v.cliente_id,
    p_unidad: opcional(v.unidad_id ?? null),
    p_sede: v.sede_id,
    p_tipo_carroceria: opcional(v.tipo_carroceria_id ?? null),
    p_tipo_trabajo: v.tipo_trabajo,
    p_prioridad: v.prioridad,
    p_descripcion: v.descripcion,
    p_especificaciones: opcional(v.especificaciones_tecnicas ?? null),
    p_inicio: opcional(v.fecha_inicio_programada ?? null),
    p_fin: opcional(v.fecha_fin_programada ?? null),
    p_entrega: opcional(v.fecha_entrega_comprometida ?? null),
    p_responsable: opcional(v.responsable_id ?? null),
    p_observaciones: opcional(v.observaciones ?? null),
    p_ruta_pdf: v.ruta_pdf,
    p_nombre_pdf: v.nombre_pdf,
    p_tamano_pdf: v.tamano_pdf,
  })

  if (error) {
    // La misma orden otra vez: la primera respuesta se perdió y la pantalla
    // preguntó de nuevo (`anotarSinDejarloSuelto`); la base dice «ya quedó
    // registrada» (o, si las dos se cruzaron, «duplicado»). Si su PDF, con esta
    // ruta —un uuid de este envío—, está anotado en esta orden por quien la
    // registra, fue este mismo envío: quedó, y se abre la orden.
    if (error.code === '23514' || error.code === '23505') {
      const { data: ya } = await supabase
        .from('ot_adjuntos')
        .select('orden_id')
        .eq('ruta_storage', v.ruta_pdf)
        .eq('orden_id', v.orden_id)
        .eq('subido_por', perfil.id)
        .eq('tipo', 'ORDEN')
        .maybeSingle()
      if (ya) {
        revalidatePath('/ordenes')
        return { ok: true, datos: { id: v.orden_id } }
      }
    }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (data !== v.orden_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/ordenes')
  // Sin `redirect`: la promesa de una acción que redirige llega rechazada al
  // formulario, y el formulario quita el PDF cuando la orden no se registró.
  return { ok: true, datos: { id: data } }
}

const esquemaCambioEstado = z.object({
  orden_id: z.guid(),
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

  // El mismo mapa que fn_ot_permiso_por_estado en la base; facturada la marca
  // la oficina (`ordenes.editar`, migración 110) y el taller que ya cambiaba
  // estados sigue pudiendo.
  const permisosNecesarios =
    estado === 'APROBADA' ? ['ordenes.aprobar']
    : estado === 'ANULADA' ? ['ordenes.anular']
    : estado === 'ENTREGADA' ? ['ordenes.entregar']
    : estado === 'FACTURADA' ? ['ordenes.editar', 'ordenes.cambiar_estado']
    : ['ordenes.cambiar_estado']

  const supabase = await createClient()

  // La orden que abrió el taller y sigue por revisar la aprueba o la rechaza
  // quien tiene `ordenes.revisar_taller`: es el mismo atajo que tiene el
  // disparador fn_ot_permiso_por_estado (migración 098), y solo para esa.
  let permitido = puede(perfil, permisosNecesarios)
  if (!permitido && (estado === 'APROBADA' || estado === 'ANULADA') && puede(perfil, 'ordenes.revisar_taller')) {
    const { data: actual } = await supabase
      .from('ordenes_trabajo')
      .select('estado, abierta_en_taller')
      .eq('id', orden_id)
      .maybeSingle()
    permitido = Boolean(actual?.abierta_en_taller && actual.estado === 'BORRADOR')
  }

  if (!permitido) {
    return { ok: false, error: 'No tienes permiso para realizar este cambio de estado.' }
  }

  // Pausar y anular exigen motivo; la base también lo valida, pero avisar aquí
  // evita un viaje al servidor con un mensaje menos claro.
  if ((estado === 'PAUSADA' || estado === 'ANULADA') && !motivo) {
    return { ok: false, error: 'Indica el motivo para continuar.' }
  }

  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .update({
      estado,
      ...(estado === 'PAUSADA' ? { motivo_pausa: motivo } : {}),
      ...(estado === 'ANULADA' ? { motivo_anulacion: motivo } : {}),
    })
    .eq('id', orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${orden_id}`)
  revalidatePath('/ordenes')
  revalidatePath('/avance')
  return { ok: true, mensaje: 'Estado actualizado.' }
}

/**
 * Administración da por terminada la garantía cuando el taller avisa
 * (decisión de DKS, migración 20261021120000). La base exige el mismo permiso,
 * `ordenes.editar`, deja la OT como está y avisa a Requerimientos si el
 * vehículo está en la planta: con el visto de Tesorería, sale.
 */
export async function darPorTerminadaLaGarantia(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.editar')) {
    return { ok: false, error: 'La garantía la da por terminada Administración.' }
  }
  const analisis = z
    .object({ orden_id: z.guid(), nota: z.string().trim().max(500, 'La nota va en 500 caracteres como máximo.').optional() })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Datos incompletos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('dar_por_terminada_la_garantia', {
    p_orden: analisis.data.orden_id,
    p_nota: analisis.data.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  revalidatePath('/vehiculos')
  return { ok: true, mensaje: 'Garantía terminada.' }
}

const esquemaPonerCliente = z.object({
  orden_id: z.guid(),
  cliente_id: z.guid('Elige el cliente'),
})

/**
 * Ponerle cliente a una orden que abrió el taller sin él (migración 100). Lo
 * hace la oficina, con `ordenes.editar`, el mismo permiso que exige la función
 * de la base; ella se lo pone también a la unidad si no tenía dueño.
 */
export async function ponerClienteAOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.editar')) {
    return { ok: false, error: 'El cliente de la orden lo pone la oficina.' }
  }

  const analisis = esquemaPonerCliente.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Elige el cliente.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('poner_cliente_a_orden', {
    p_orden: analisis.data.orden_id,
    p_cliente: analisis.data.cliente_id,
  })
  if (error) {
    // Los avisos de la función vienen redactados; los del motor se traducen.
    const delMotor = /violates|duplicate key|permission denied/i.test(error.message)
    return { ok: false, error: delMotor ? mensajeDeError(error) : error.message }
  }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Cliente puesto.' }
}

const esquemaEntrega = z.object({
  orden_id: z.guid(),
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

  // La regla del flujograma: la unidad no sale si el cliente tiene deuda.
  // Tesorería libera; recién entonces entra el acta.
  const { data: liberacion, error: errorLiberacion } = await supabase
    .from('liberaciones_tesoreria')
    .select('id')
    .eq('orden_id', v.orden_id)
    .maybeSingle()

  if (errorLiberacion) return { ok: false, error: mensajeDeError(errorLiberacion) }

  if (!liberacion) {
    return {
      ok: false,
      error:
        'Tesorería todavía no libera esta orden: falta confirmar que el cliente esté al día. Pide la liberación desde la tarjeta «Salida de la unidad».',
    }
  }

  const { data: acta, error } = await supabase.from('ot_entregas').insert({
    orden_id: v.orden_id,
    recibe_nombre: v.recibe_nombre,
    recibe_documento: v.recibe_documento || null,
    recibe_cargo: v.recibe_cargo || null,
    garantia_meses: v.garantia_meses,
    conforme: v.conforme,
    observaciones: v.observaciones || null,
  }).select('id, numero').maybeSingle()

  if (error) {
    return { ok: false, error: error.code === '23505' && error.message.includes('uq_ot_entregas_orden')
      ? 'Esta orden ya tiene un acta de entrega. Recarga el resumen para consultar la entrega registrada.'
      : mensajeDeError(error) }
  }
  if (!acta) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/ordenes')
  return { ok: true, mensaje: `Acta ${acta.numero} registrada. La orden quedó entregada.` }
}

const esquemaComentario = z.object({
  orden_id: z.guid(),
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
      orden_id: z.guid(),
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

export async function registrarSalidaFisica(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.entregar')) return { ok: false, error: 'La salida física la registra el responsable de entrega.' }
  const analisis = z.object({ entrega_id: z.guid(), orden_id: z.guid(),
    constancia: z.string().trim().min(10).max(500), confirmada: z.literal('on'),
  }).safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Describe la salida (10 a 500 caracteres) y confirma que observaste salir el vehículo.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_salida_fisica', {
    p_entrega: analisis.data.entrega_id, p_constancia: analisis.data.constancia,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó la salida. Recarga antes de volver a intentar.' }
  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Salida física registrada.' }
}

/** Avisar a portería que la unidad puede cruzar. */
export async function confirmarSalida(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.entregar', 'produccion.actividades'])) {
    return { ok: false, error: 'Confirmar la salida es de quien coordina la entrega.' }
  }

  const analisis = z
    .object({ entrega_id: z.guid(), orden_id: z.guid() })
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
