'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Cada paso del RQ después de que Almacén revisó el stock, con el mismo
 * permiso que exige su función en la base: Almacén lo deja listo cuando llega
 * lo que faltaba y lo entrega (`almacen.recibir`, `almacen.despachar`); quien
 * compra marca que está comprando (`compras.crear`; la base mira además de
 * quién es el RQ: Logística o la administradora).
 */
const PASOS = {
  listo: { funcion: 'rq_marcar_listo_en_almacen', permiso: 'almacen.recibir', hecho: 'Listo en almacén. Le avisamos al área para que lo recoja.' },
  en_atencion: { funcion: 'rq_marcar_en_atencion', permiso: 'compras.crear', hecho: 'En compra. Almacén lo recepciona cuando llegue.' },
  entregado: { funcion: 'rq_marcar_entregado', permiso: 'almacen.despachar', hecho: 'Entregado. El requerimiento queda cerrado.' },
} as const

const QUIEN: Record<keyof typeof PASOS, string> = {
  listo: 'Lo deja listo Almacén.',
  en_atencion: 'La compra la marca quien compra: Logística o, si es de Administración, la administradora.',
  entregado: 'La entrega la registra Almacén.',
}

export async function marcarPasoRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const analisis = z
    .object({
      id: z.guid(),
      paso: z.enum(['listo', 'en_atencion', 'entregado']),
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

const CANTIDAD_EN_STOCK = /^\d{1,9}(\.\d{1,3})?$/

/**
 * Almacén revisa el RQ insumo por insumo: cuánto tiene de cada uno, de 0 a lo
 * pedido. Si tiene todo, el RQ queda listo; si no, a quien compra le llega
 * solo lo que falta (`rq_revisar_stock`, migración 20261015162000).
 */
export async function revisarStockRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  let lineas: unknown
  try {
    lineas = JSON.parse(typeof formulario.get('lineas') === 'string' ? (formulario.get('lineas') as string) : '')
  } catch {
    return { ok: false, error: 'Vuelve a cargar la pantalla.' }
  }
  const analisis = z
    .object({
      id: z.guid(),
      nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
      lineas: z
        .array(
          z.object({
            item: z.number().int().min(1).max(999),
            en_stock: z
              .string()
              .trim()
              .regex(CANTIDAD_EN_STOCK, 'Anota cuánto hay de cada insumo: de 0 a lo pedido, con hasta tres decimales.'),
            // El material del catálogo que Almacén eligió para un material nuevo.
            // Sin declararlo, zod lo quitaba en silencio y la base daba de alta
            // uno provisional en vez del elegido (visto en el banco, 2026-10-20).
            material_id: z.guid('Vuelve a cargar la pantalla.').nullable().optional(),
          }),
        )
        .min(1, 'Anota cuánto hay de cada insumo.')
        .max(100, 'Vuelve a cargar la pantalla.'),
    })
    .safeParse({ id: formulario.get('id'), nota: formulario.get('nota') ?? '', lineas })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'El stock lo revisa Almacén.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rq_revisar_stock', {
    p_id: analisis.data.id,
    p_lineas: analisis.data.lineas,
    p_nota: analisis.data.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El requerimiento no cambió. Recarga la pantalla.' }

  const { data: rq } = await supabase.from('requerimientos').select('estado, tipo').eq('id', analisis.data.id).maybeSingle()

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  if (rq?.estado === 'LISTO_EN_ALMACEN') return { ok: true, mensaje: 'Tienes todo: queda listo en almacén y le avisamos al área para que lo recoja.' }
  const quien = rq?.tipo === 'ADMINISTRACION' ? 'a la administradora' : 'a Logística'
  return { ok: true, mensaje: `Revisado. Le llegó ${quien} solo lo que falta comprar.` }
}
