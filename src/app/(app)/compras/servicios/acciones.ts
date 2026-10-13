'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

function refrescar() {
  revalidatePath('/compras/servicios')
  revalidatePath('/compras/aprobacion')
}

/**
 * La orden de servicio: un trabajo que hace un tercero (un torno, una pintura,
 * un doblez). Exige `compras.crear`, el mismo permiso que `emitir_orden_servicio`.
 * Siempre espera la aprobación de Gerencia.
 */
export async function emitirOrdenServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede emitir órdenes de servicio.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      proveedor_id: z.guid('Elige el proveedor del padrón. Si es nuevo, regístralo con «Nuevo».'),
      orden_id: z.guid().optional(),
      area_id: z.guid().optional(),
      descripcion: z
        .string()
        .trim()
        .min(10, 'Describe el servicio en al menos 10 caracteres: qué se hace, a qué pieza o unidad.')
        .max(1000, 'La descripción pasa de 1000 caracteres.'),
      referencia: z.string().trim().max(100, 'La referencia del proveedor pasa de 100 caracteres.'),
      fecha_inicio: z.iso.date().optional(),
      fecha_fin: z.iso.date().optional(),
      moneda: z.enum(['PEN', 'USD']),
      monto: z.coerce
        .number({ message: 'Indica el monto sin IGV.' })
        .min(0, 'El monto no puede ser negativo.')
        .max(999999999, 'El monto es demasiado grande.')
        .multipleOf(0.01, 'El monto lleva como máximo dos decimales.'),
      condicion: z.enum(['CONTADO', 'CREDITO']),
      dias: z.coerce.number().int().min(0).max(365),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      proveedor_id: dato(formulario, 'proveedor_id'),
      orden_id: dato(formulario, 'orden_id') || undefined,
      area_id: dato(formulario, 'area_id') || undefined,
      descripcion: dato(formulario, 'descripcion'),
      referencia: dato(formulario, 'referencia'),
      fecha_inicio: dato(formulario, 'fecha_inicio') || undefined,
      fecha_fin: dato(formulario, 'fecha_fin') || undefined,
      moneda: dato(formulario, 'moneda'),
      monto: dato(formulario, 'monto'),
      condicion: dato(formulario, 'condicion'),
      dias: dato(formulario, 'dias'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la orden de servicio.' }
  const d = analisis.data
  if (d.referencia && d.referencia.length < 2) {
    return { ok: false, error: 'La referencia del proveedor va de 2 a 100 caracteres, o déjala vacía.' }
  }
  if ((d.condicion === 'CONTADO' && d.dias !== 0) || (d.condicion === 'CREDITO' && d.dias === 0)) {
    return { ok: false, error: 'Indica 0 días para contado o un plazo de 1 a 365 días para crédito.' }
  }
  if (d.fecha_inicio && d.fecha_fin && d.fecha_fin < d.fecha_inicio) {
    return { ok: false, error: 'La fecha de término no puede ser anterior a la de inicio.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_orden_servicio', {
    p_id: d.operacion_id,
    p_proveedor_id: d.proveedor_id,
    p_orden_id: d.orden_id ?? null,
    p_area_id: d.area_id ?? null,
    p_descripcion: d.descripcion,
    p_referencia: d.referencia || null,
    p_fecha_inicio: d.fecha_inicio ?? null,
    p_fecha_fin: d.fecha_fin ?? null,
    p_moneda: d.moneda,
    p_monto: d.monto,
    p_condicion: d.condicion,
    p_dias: d.dias,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La orden de servicio no quedó registrada. Recarga la pantalla.' }

  const { data: emitida } = await supabase.from('ordenes_servicio').select('numero').eq('id', d.operacion_id).maybeSingle()

  refrescar()
  return { ok: true, mensaje: `Orden de servicio ${emitida?.numero ?? ''} emitida. Gerencia la aprueba antes de que el proveedor empiece.` }
}

const PASOS = {
  EN_EJECUCION: 'Marcada en ejecución.',
  CONFORME: 'Conformidad registrada: Tesorería ya puede pagarla.',
  ANULADA: 'Orden de servicio anulada. Queda con su número y su motivo.',
} as const

/** En ejecución, conforme o anulada. Mismo permiso que `avanzar_orden_servicio`. */
export async function avanzarOrdenServicio(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Llevar las órdenes de servicio corresponde a Logística.' }

  const analisis = z
    .object({
      id: z.guid(),
      paso: z.enum(['EN_EJECUCION', 'CONFORME', 'ANULADA']),
      nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), paso: formulario.get('paso'), nota: dato(formulario, 'nota') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  if (analisis.data.paso === 'ANULADA' && analisis.data.nota.length < 10) {
    return { ok: false, error: 'Cuenta por qué se anula, en al menos 10 caracteres.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('avanzar_orden_servicio', {
    p_id: analisis.data.id,
    p_paso: analisis.data.paso,
    p_nota: analisis.data.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return { ok: true, mensaje: PASOS[analisis.data.paso] }
}
