'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

/**
 * Logística fija el precio de un material del almacén. No corrige el anterior:
 * agrega uno nuevo, vigente desde ahora, y lo que ya salió conserva el suyo.
 * `valorizar_material` exige `almacen.valorizar`, el mismo permiso que se pide
 * aquí. Es solo de Logística: Gerencia mira el costo, no fija precios.
 */
export async function valorizarMaterial(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.valorizar')) return { ok: false, error: 'Solo Logística fija el precio de los materiales del almacén.' }

  const v = z.object({
    operacion_id: z.string().uuid(),
    material_id: z.string().uuid(),
    precio: z.coerce.number().min(0).max(9999999999).multipleOf(0.0001),
    moneda: z.enum(['PEN', 'USD']),
    observacion: z.string().trim().max(300),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    material_id: dato(formulario, 'material_id'),
    precio: dato(formulario, 'precio'),
    moneda: dato(formulario, 'moneda'),
    observacion: dato(formulario, 'observacion'),
  })
  if (!v.success) return { ok: false, error: 'Indica el precio unitario (hasta 4 decimales) y la moneda.' }

  const db = await createClient()
  const { data, error } = await db.rpc('valorizar_material', {
    p_id: v.data.operacion_id,
    p_material: v.data.material_id,
    p_precio: v.data.precio,
    p_moneda: v.data.moneda,
    p_observacion: v.data.observacion,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.operacion_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/compras/valorizacion')
  return { ok: true, mensaje: 'Precio fijado. El costeo lo usa para las salidas de este material que no tienen precio de compra.' }
}
