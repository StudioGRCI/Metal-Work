'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const esquema = z.object({
  orden_id: z.string().uuid(),
  version: z.string().datetime({ offset: true }),
  unidad_version: z.string().optional(),
  descripcion: z.string().trim().min(5).max(5000),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']),
  fecha_entrega_comprometida: z.iso.date(),
  codigo_interno: z.string().trim().max(40),
  marca: z.string().trim().max(80),
  modelo: z.string().trim().max(80),
  cotizacion_nueva_id: z.union([z.string().uuid(), z.literal('')]),
  motivo: z.string().trim().min(5, 'Explica el motivo del cambio').max(1000),
  confirmar_cambio: z.string().optional(),
})

export async function editarOrdenConHistorial(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.editar')) return { ok: false, error: 'La oficina edita los datos de la OT.' }
  const entrada = esquema.safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa los datos.' }
  const { orden_id, version, motivo, confirmar_cambio, ...cambios } = entrada.data
  if (cambios.cotizacion_nueva_id && confirmar_cambio !== 'on') {
    return { ok: false, error: 'Confirma que la nueva cotización aprobada corresponde al nuevo cliente.' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('editar_ot_con_historial', {
    p_orden: orden_id, p_version: version, p_motivo: motivo, p_datos: cambios,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  for (const ruta of ['/ordenes', '/avance', '/cotizaciones/pdf', `/ordenes/${orden_id}`]) revalidatePath(ruta)
  return { ok: true, mensaje: 'OT actualizada. El cambio quedó en su historial.' }
}
