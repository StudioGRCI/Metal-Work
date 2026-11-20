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

function revalidar() {
  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  revalidatePath('/requerimientos/metrado')
}

const SUSTENTOS = z
  .array(
    z.object({
      item: z.number().int().positive(),
      sustento: z
        .string()
        .trim()
        .min(10, 'Cuenta en cada insumo por qué hace falta más de lo que dice el metrado, en al menos 10 caracteres.')
        .max(500, 'Un sustento pasa de 500 caracteres.'),
    }),
  )
  .min(1, 'Escribe el sustento de cada insumo que se pasa del metrado.')
  .max(100)

/**
 * El sustento de quien pidió: por qué cada insumo necesita más de lo que dice
 * el metrado de Diseño. Lo escribe quien puede corregir el RQ, el mismo permiso
 * que exige la base (`sustentar_insumos` → `rq_exigir_del_area`).
 * Llega a Diseño.
 */
export async function sustentarInsumos(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  // Con `requerimientos.area`, el supervisor que lo registró; la base lo acota a los suyos.
  if (!puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.area'])) {
    return { ok: false, error: 'El sustento lo escribe quien registró el requerimiento: tu puesto no registra requerimientos.' }
  }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció el requerimiento. Vuelve a cargar la pantalla.' }
  const items = formulario.getAll('item').map((v) => Number(v))
  const lineas = SUSTENTOS.safeParse(items.map((item) => ({ item, sustento: dato(formulario, `sustento-${item}`) })))
  if (!lineas.success) return { ok: false, error: lineas.error.issues[0]?.message ?? 'Revisa el sustento de cada insumo.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sustentar_insumos', { p_requerimiento: id.data, p_lineas: lineas.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id.data) return { ok: false, error: 'El sustento no se guardó. Recarga la pantalla.' }

  revalidar()
  const n = lineas.data.length
  return {
    ok: true,
    mensaje: `${n === 1 ? 'Sustento enviado' : `Sustento de ${n} insumos enviado`} a Diseño. Almacén revisa el requerimiento cuando Diseño lo autorice; te llega el aviso.`,
  }
}

const VISTO = z
  .object({
    id: z.guid(),
    items: z.array(z.number().int().positive()).min(1, 'Elige qué insumos autorizas o no.').max(100),
    autoriza: z.enum(['si', 'no']),
    nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
  })
  .refine((v) => v.autoriza === 'si' || v.nota.length >= 10, {
    message: 'Cuenta por qué no lo autorizas, en al menos 10 caracteres: quien pidió tiene que saber qué corregir.',
    path: ['nota'],
  })

/**
 * El visto de Diseño a lo que se pasa del metrado. Exige el mismo permiso que la
 * base (`autorizar_insumos` → `requerimientos.autorizar_metrado`). Al que pidió
 * le llega el aviso; si con esto el RQ queda en regla, también a Almacén.
 */
export async function autorizarInsumos(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.autorizar_metrado')) {
    return { ok: false, error: 'No tienes permiso para autorizar lo que se pasa del metrado: lo autoriza Diseño.' }
  }
  const visto = VISTO.safeParse({
    id: formulario.get('id'),
    items: formulario.getAll('item').map((v) => Number(v)),
    autoriza: dato(formulario, 'autoriza'),
    nota: dato(formulario, 'nota'),
  })
  if (!visto.success) return { ok: false, error: visto.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const v = visto.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('autorizar_insumos', {
    p_requerimiento: v.id,
    p_items: v.items,
    p_autoriza: v.autoriza === 'si',
    p_nota: v.nota,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.id) return { ok: false, error: 'El visto no se guardó. Recarga la pantalla.' }

  revalidar()
  const insumos = v.items.length === 1 ? 'Insumo' : `${v.items.length} insumos`
  return {
    ok: true,
    mensaje:
      v.autoriza === 'si'
        ? `${insumos} ${v.items.length === 1 ? 'autorizado' : 'autorizados'}. A quien pidió le llegó el aviso, y a Almacén si ya puede revisar el stock.`
        : `${insumos} sin autorizar. A quien pidió le llegó tu nota para que corrija el requerimiento.`,
  }
}
