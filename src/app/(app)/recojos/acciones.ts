'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Los dos pasos del conductor. Exigen `compras.recojo`, el mismo permiso que
 * `marcar_compra_recogida` y `marcar_compra_dejada_almacen` en la base.
 */
export async function marcarRecojo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.recojo')) return { ok: false, error: 'Marcar recojos corresponde al conductor de Logística.' }
  const analisis = z
    .object({ id: z.string().uuid(), paso: z.enum(['RECOGIDO', 'DEJADO']) })
    .safeParse({ id: datos.get('id'), paso: datos.get('paso') })
  if (!analisis.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { error } =
    analisis.data.paso === 'RECOGIDO'
      ? await supabase.rpc('marcar_compra_recogida', { p_compra: analisis.data.id })
      : await supabase.rpc('marcar_compra_dejada_almacen', { p_compra: analisis.data.id })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/recojos')
  revalidatePath('/compras/ordenes')
  revalidatePath('/almacen/kardex')
  return {
    ok: true,
    mensaje:
      analisis.data.paso === 'RECOGIDO'
        ? 'Marcada como recogida. Cuando la dejes en almacén, márcalo aquí.'
        : 'Dejada en almacén. Almacén ya tiene el ingreso para validarlo.',
  }
}
