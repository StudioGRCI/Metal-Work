'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { MAXIMO_FOTOS_RECOJO, MOTIVO_NO_LOGRADO } from '@/lib/dominio/logistica'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Los tres pasos del conductor. Exigen `compras.recojo`, el mismo permiso que
 * `marcar_compra_en_recojo`, `marcar_compra_recogida` y
 * `marcar_compra_dejada_almacen` en la base.
 */
export async function marcarRecojo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.recojo')) return { ok: false, error: 'No tienes permiso para marcar recojos.' }
  const analisis = z
    .object({ id: z.guid(), paso: z.enum(['EN_RECOJO', 'RECOGIDO', 'DEJADO']) })
    .safeParse({ id: datos.get('id'), paso: datos.get('paso') })
  if (!analisis.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const p_compra = analisis.data.id
  const { error } =
    analisis.data.paso === 'EN_RECOJO'
      ? await supabase.rpc('marcar_compra_en_recojo', { p_compra })
      : analisis.data.paso === 'RECOGIDO'
        ? await supabase.rpc('marcar_compra_recogida', { p_compra })
        : await supabase.rpc('marcar_compra_dejada_almacen', { p_compra })
  if (error) return { ok: false, error: mensajeDeError(error) }

  ponerAlDia()
  return {
    ok: true,
    mensaje: {
      EN_RECOJO: 'Marcada en recojo. Cuando la tengas, marca «Ya la recogí».',
      RECOGIDO: 'Marcada como recogida. Cuando la dejes en almacén, márcalo aquí.',
      DEJADO: 'Dejada en almacén. Almacén ya tiene el ingreso para validarlo.',
    }[analisis.data.paso],
  }
}

/** Las pantallas que muestran en qué va el recojo. */
function ponerAlDia() {
  revalidatePath('/recojos')
  revalidatePath('/compras/gestion')
  revalidatePath('/compras/ordenes')
  revalidatePath('/almacen/kardex')
  // El avance de cada RQ sale del recojo de sus OC.
  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
}

function json(datos: FormData, nombre: string): unknown {
  const valor = datos.get(nombre)
  if (typeof valor !== 'string' || !valor) return undefined
  try {
    return JSON.parse(valor)
  } catch {
    return undefined
  }
}

/**
 * «Ya la recogí», con las fotos que el conductor haya tomado (opcionales, hasta
 * tres, ya subidas a `fotos-recojo`). Mismo permiso que
 * `marcar_compra_recogida_con_fotos`: `compras.recojo`. El mismo envío repetido
 * lo reconoce la base.
 */
export async function marcarRecogida(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.recojo')) return { ok: false, error: 'No tienes permiso para marcar recojos.' }
  const analisis = z
    .object({
      id: z.guid(),
      fotos: z.array(z.string().min(1).max(300)).max(MAXIMO_FOTOS_RECOJO, `Van hasta ${MAXIMO_FOTOS_RECOJO} fotos del recojo.`),
    })
    .safeParse({ id: datos.get('id'), fotos: json(datos, 'fotos') ?? [] })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('marcar_compra_recogida_con_fotos', {
    p_compra: analisis.data.id,
    p_fotos: analisis.data.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No quedó marcada como recogida. Recarga la pantalla.' }

  ponerAlDia()
  const conFotos = analisis.data.fotos.length
  return {
    ok: true,
    mensaje: `Marcada como recogida${conFotos ? `, con ${conFotos === 1 ? 'su foto' : `sus ${conFotos} fotos`}` : ''}. Cuando la dejes en almacén, márcalo aquí.`,
  }
}

/**
 * «No se pudo recoger», con su motivo: la compra vuelve a «Por programar» de
 * Logística, que recibe el aviso. `id` es el del envío: el mismo otra vez no
 * entra dos veces. Mismo permiso que `marcar_recojo_no_logrado`: `compras.recojo`.
 */
export async function avisarQueNoSePudoRecoger(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.recojo')) return { ok: false, error: 'No tienes permiso para marcar recojos.' }
  const analisis = z
    .object({
      id: z.guid(),
      compra: z.guid(),
      motivo: z
        .string()
        .transform((t) => t.trim().replace(/\s+/g, ' '))
        .pipe(
          z
            .string()
            .min(MOTIVO_NO_LOGRADO.minimo, `Escribe por qué no se pudo recoger, con al menos ${MOTIVO_NO_LOGRADO.minimo} letras: Logística lo lee para volver a programarla.`)
            .max(MOTIVO_NO_LOGRADO.maximo, `El motivo pasa de ${MOTIVO_NO_LOGRADO.maximo} letras: acórtalo.`),
        ),
    })
    .safeParse({ id: datos.get('id'), compra: datos.get('compra'), motivo: datos.get('motivo') ?? '' })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('marcar_recojo_no_logrado', {
    p_id: analisis.data.id,
    p_compra: analisis.data.compra,
    p_motivo: analisis.data.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El aviso no quedó registrado. Recarga la pantalla.' }

  ponerAlDia()
  return { ok: true, mensaje: 'Avisado: la compra volvió a Logística con tu motivo y salió de tu lista.' }
}
