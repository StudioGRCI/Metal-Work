'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Abrir una orden desde el taller (migración 098). Exige `ordenes.abrir_taller`,
 * el mismo permiso que pide la función de la base, que es quien hace el
 * trabajo: busca la unidad por su placa entre las del cliente o la registra,
 * abre la orden por revisar y le avisa al jefe de producción. Todo junto o
 * nada: no queda una unidad suelta si la orden no entra.
 */
const esquema = z.object({
  cliente_id: z.string().uuid('Elige de quién es la unidad'),
  placa: z.string().trim().max(20).optional(),
  tipo_vehiculo: z
    .enum(['VOLQUETE', 'TRACTO', 'SEMIRREMOLQUE', 'CAMION', 'REMOLQUE', 'FURGON', 'OTRO'])
    .default('VOLQUETE'),
  marca: z.string().trim().max(80).optional(),
  modelo: z.string().trim().max(80).optional(),
  trabajo: z.string().trim().min(5, 'Cuenta qué se va a hacer'),
  tipo_trabajo: z
    .enum(['REPARACION', 'MANTENIMIENTO', 'REPOTENCIACION', 'FABRICACION', 'GARANTIA'])
    .default('REPARACION'),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
})

export async function abrirOrdenDelTaller(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.abrir_taller')) {
    return { ok: false, error: 'Las órdenes del taller las abre el supervisor o el jefe de producción.' }
  }

  const analisis = esquema.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  if (!v.placa && !v.marca && !v.modelo) {
    return { ok: false, error: 'Escribe la placa, o la marca y el modelo si todavía no tiene.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('abrir_orden_del_taller', {
    p_cliente: v.cliente_id,
    p_placa: v.placa ?? '',
    p_tipo_vehiculo: v.tipo_vehiculo,
    p_marca: v.marca ?? '',
    p_modelo: v.modelo ?? '',
    p_trabajo: v.trabajo,
    p_tipo_trabajo: v.tipo_trabajo,
    p_prioridad: v.prioridad,
  })

  if (error) {
    // Los avisos de la función ya vienen redactados para quien los lee —«la
    // unidad ABC-123 ya tiene la orden 0005-2026 abierta»—, y sus códigos
    // (unique_violation, foreign_key_violation) harían que mensajeDeError los
    // cambiara por uno genérico. Lo que dice el motor sí se traduce.
    const delMotor = /violates|duplicate key|permission denied/i.test(error.message)
    return { ok: false, error: delMotor ? mensajeDeError(error) : error.message }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/avance')
  revalidatePath('/ordenes')
  return { ok: true, mensaje: 'Orden abierta. Queda por revisar.', datos: { id: data } }
}
