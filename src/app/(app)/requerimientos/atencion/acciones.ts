'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Cada paso del RQ después de emitido, con el mismo permiso que exige su
 * función en la base: Almacén revisa stock y entrega (`almacen.recibir`,
 * `almacen.despachar`); Logística marca que compra (`compras.crear`).
 */
const PASOS = {
  sin_stock: { funcion: 'rq_marcar_sin_stock', permiso: 'almacen.recibir', hecho: 'Marcado sin stock. Le llegó a Logística para comprarlo.' },
  listo: { funcion: 'rq_marcar_listo_en_almacen', permiso: 'almacen.recibir', hecho: 'Listo en almacén. Le avisamos al área para que lo recoja.' },
  en_atencion: { funcion: 'rq_marcar_en_atencion', permiso: 'compras.crear', hecho: 'En compra. Almacén lo recepciona cuando llegue.' },
  entregado: { funcion: 'rq_marcar_entregado', permiso: 'almacen.despachar', hecho: 'Entregado. El requerimiento queda cerrado.' },
} as const

const QUIEN: Record<keyof typeof PASOS, string> = {
  sin_stock: 'El stock lo revisa Almacén.',
  listo: 'Lo deja listo Almacén.',
  en_atencion: 'La compra la marca Logística.',
  entregado: 'La entrega la registra Almacén.',
}

export async function marcarPasoRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const analisis = z
    .object({
      id: z.string().uuid(),
      paso: z.enum(['sin_stock', 'listo', 'en_atencion', 'entregado']),
      nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), paso: formulario.get('paso'), nota: formulario.get('nota') ?? '' })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const paso = PASOS[analisis.data.paso]
  const perfil = await exigirSesion()
  if (!puede(perfil, paso.permiso)) return { ok: false, error: QUIEN[analisis.data.paso] }
  if (analisis.data.paso === 'entregado' && analisis.data.nota.length < 3) return { ok: false, error: 'Anota quién del área lo recogió.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc(paso.funcion, { p_id: analisis.data.id, p_nota: analisis.data.nota || null })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El requerimiento no cambió. Recarga la pantalla.' }

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  return { ok: true, mensaje: paso.hecho }
}
