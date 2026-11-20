'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const cifra = (texto: string) => (texto === '' ? null : Number(texto.replace(',', '.')))

const STOCK_DE_SEGURIDAD = z.object({
  material_id: z.guid(),
  minimo: z
    .number({ message: 'El mínimo es un número, como 12 o 2.5.' })
    .min(0, 'El mínimo va de 0 en adelante.')
    .max(99999999999)
    .multipleOf(0.001, 'El mínimo admite hasta 3 decimales.')
    .nullable(),
  por_mayor: z
    .number({ message: 'La compra por mayor es un número, como 50 o 100.' })
    .positive('La compra por mayor es mayor que cero; vacía si se repone hasta el mínimo.')
    .max(99999999999)
    .multipleOf(0.001, 'La compra por mayor admite hasta 3 decimales.')
    .nullable(),
})

/**
 * El stock de seguridad de un material: el mínimo que dispara el aviso y cuánto
 * se compra de una vez al reponer. Lo fija Almacén, el mismo permiso que exige
 * la base (`fijar_stock_de_seguridad` → `almacen.recibir`).
 */
export async function fijarStockDeSeguridad(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'El stock de seguridad lo fija Almacén.' }
  const v = STOCK_DE_SEGURIDAD.safeParse({
    material_id: dato(formulario, 'material_id'),
    minimo: cifra(dato(formulario, 'minimo')),
    por_mayor: cifra(dato(formulario, 'por_mayor')),
  })
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa el mínimo y la compra por mayor.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fijar_stock_de_seguridad', {
    p_material: v.data.material_id,
    p_minimo: v.data.minimo,
    p_por_mayor: v.data.por_mayor,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.material_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/reposicion')
  revalidatePath('/almacen/kardex')
  return {
    ok: true,
    mensaje:
      v.data.minimo === null
        ? 'Sin mínimo: este material ya no avisa cuando baja.'
        : 'Stock de seguridad guardado. Cuando baje del mínimo, avisa a Almacén y a Logística.',
  }
}
