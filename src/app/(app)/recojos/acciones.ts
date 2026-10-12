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

function refrescar() {
  revalidatePath('/recojos')
  revalidatePath('/compras')
  revalidatePath('/almacen/kardex')
}

/** Primer paso del conductor: ya la tiene, donde el proveedor. */
export async function marcarRecogida(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.recoger')) return { ok: false, error: 'Solo el conductor de Logística marca los recojos.' }
  const v = z.string().uuid().safeParse(dato(formulario, 'compra_id'))
  if (!v.success) return { ok: false, error: 'No se reconoce la compra. Recarga la pantalla.' }

  const db = await createClient()
  const { data, error } = await db.rpc('marcar_compra_recogida', { p_compra: v.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data) return { ok: false, error: NO_TOCO_NADA }
  refrescar()
  return { ok: true, mensaje: 'Marcada como recogida. Cuando la dejes en almacén, márcalo con la guía o la factura.' }
}

/** Segundo paso: la dejó en almacén, con la guía o factura del proveedor. */
export async function marcarDejadaEnAlmacen(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.recoger')) return { ok: false, error: 'Solo el conductor de Logística marca los recojos.' }
  const v = z.object({
    compra_id: z.string().uuid(),
    documento: z.string().trim().min(2, 'Anota el número de la guía o la factura (al menos 2 caracteres).').max(100, 'El número de la guía o factura es muy largo.'),
  }).safeParse({ compra_id: dato(formulario, 'compra_id'), documento: dato(formulario, 'documento') })
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa la guía o la factura.' }

  const db = await createClient()
  const { data, error } = await db.rpc('marcar_compra_dejada_en_almacen', { p_compra: v.data.compra_id, p_documento: v.data.documento })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.compra_id) return { ok: false, error: NO_TOCO_NADA }
  refrescar()
  return { ok: true, mensaje: 'Dejada en almacén. Almacén ya recibió el aviso para validar el ingreso.' }
}
