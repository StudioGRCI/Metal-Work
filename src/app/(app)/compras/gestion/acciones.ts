'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La gestión y la lista del conductor leen lo mismo: se repintan juntas, y con
 * ellas Adquisiciones, donde Contabilidad ve qué guía le falta y con qué peso.
 */
function repintar() {
  revalidatePath('/compras/gestion')
  revalidatePath('/recojos')
  revalidatePath('/adquisiciones')
}

/** «350,5» y «350.5» son lo mismo: en el teclado del teléfono sale la coma. */
const PESO = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/\s/g, '').replace(',', '.') : v),
  z.coerce.number().positive().max(100000),
)

/**
 * Poner una compra en la lista del conductor con su peso y su lugar, o
 * cambiarle el peso o el lugar. Exige `compras.programar_recojo`, el mismo
 * permiso que `programar_recojo` en la base (migración 20261020171000). Sin
 * lugar, va al final.
 */
export async function programarRecojo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.programar_recojo')) return { ok: false, error: 'Programar el recojo corresponde a Logística.' }
  const analisis = z
    .object({
      id: z.guid(),
      peso: PESO,
      lugar: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(1).max(999).optional()),
    })
    .safeParse({ id: datos.get('id'), peso: datos.get('peso'), lugar: datos.get('lugar') })
  if (!analisis.success) {
    const malPeso = analisis.error.issues.some((i) => i.path[0] === 'peso')
    return { ok: false, error: malPeso ? 'Escribe el peso en kilos, más de cero: por ejemplo 350 o 87,5.' : 'No se reconoció la compra. Vuelve a cargar la pantalla.' }
  }

  const supabase = await createClient()
  const { data: lugar, error } = await supabase.rpc('programar_recojo', {
    p_compra: analisis.data.id,
    p_peso: analisis.data.peso,
    p_posicion: analisis.data.lugar ?? null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!lugar) return { ok: false, error: 'No se confirmó el recojo. Vuelve a cargar la pantalla.' }

  repintar()
  return { ok: true, mensaje: `Va ${lugar}.º en la lista del conductor.` }
}

/** Sacarla de la lista: el conductor deja de verla para salir. Mismo permiso que la base. */
export async function quitarDeLaLista(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.programar_recojo')) return { ok: false, error: 'Programar el recojo corresponde a Logística.' }
  const id = z.guid().safeParse(datos.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('quitar_recojo_de_la_lista', { p_compra: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }

  repintar()
  return { ok: true, mensaje: 'Salió de la lista del conductor. Se queda con su peso para cuando la vuelvas a programar.' }
}
