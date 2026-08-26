'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

async function exigirMaestros() {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.maestros')) {
    return 'Codificar materiales es de quien administra los maestros de almacén.'
  }
  return null
}

/**
 * Arma el código de cinco segmentos. El correlativo lo entrega la base con la
 * familia bloqueada: dos altas a la vez no se llevan el mismo número.
 */
export async function codificarMaterial(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirMaestros()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      material_id: z.string().uuid(),
      familia: z.string().regex(/^[A-Z]{2}$/, 'Elige la familia'),
      subfamilia: z.string().trim().optional(),
      material: z.string().regex(/^[A-Z]{2}$/, 'Elige de qué está hecho'),
      tipo: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los segmentos.' }
  }

  const v = analisis.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('asignar_codigo_almacen', {
    p_material: v.material_id,
    p_familia: v.familia,
    p_subfamilia: v.subfamilia || undefined,
    p_material_cod: v.material,
    p_tipo: v.tipo || undefined,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/almacen/materiales')
  return { ok: true, mensaje: `Código asignado: ${data}` }
}

/** La criticidad y la ubicación se corrigen de a una, desde la fila. */
export async function guardarFichaAlmacen(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirMaestros()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      material_id: z.string().uuid(),
      criticidad: z.enum(['A', 'B', 'C', '']).optional(),
      ubicacion: z.string().trim().max(40).optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Revisa los datos.' }

  const v = analisis.data
  const supabase = await createClient()
  const { error } = await supabase
    .from('materiales')
    .update({
      criticidad: v.criticidad || null,
      ubicacion: v.ubicacion?.trim() || null,
    })
    .eq('id', v.material_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/almacen/materiales')
  return { ok: true }
}
