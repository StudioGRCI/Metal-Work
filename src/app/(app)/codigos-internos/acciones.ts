'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * El cierre del costeo de un código interno (migración 20261017300000). Las dos
 * exigen `codigos_internos.cerrar`, el mismo permiso que piden las funciones de
 * la base, y comprueban que la base devolvió un cierre: un cero filas no pasa
 * por «listo».
 */

const NO_CIERRA = 'El costeo del código lo cierra Gerencia.'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

async function permitido() {
  const perfil = await exigirSesion()
  return puede(perfil, 'codigos_internos.cerrar')
}

const codigo = z.string().min(2, 'Vuelve a cargar el código.').max(60, 'Vuelve a cargar el código.').transform(normalizarCodigo)

function revalidar() {
  revalidatePath('/codigos-internos')
  revalidatePath('/codigos-internos/detalle')
}

/** Congela el costo y el margen del código al entregar la unidad. Mismo permiso que `cerrar_costeo_codigo`. */
export async function cerrarCosteo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_CIERRA }
  const analisis = z
    .object({ codigo, observacion: z.string().max(500, 'La observación pasa de 500 caracteres.') })
    .safeParse({ codigo: dato(formulario, 'codigo'), observacion: dato(formulario, 'observacion') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar el código.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cerrar_costeo_codigo', {
    p_codigo: analisis.data.codigo,
    p_observacion: analisis.data.observacion || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'El costeo no quedó cerrado. Recarga la pantalla.' }

  revalidar()
  return { ok: true, mensaje: 'Costeo cerrado: el costo y el margen quedan congelados.' }
}

/** Reabre el costeo cerrado, con su motivo. Mismo permiso que `reabrir_costeo_codigo`. */
export async function reabrirCosteo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_CIERRA }
  const analisis = z
    .object({
      codigo,
      motivo: z.string().min(10, 'Escribe por qué se reabre, en 10 caracteres o más.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ codigo: dato(formulario, 'codigo'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar el código.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reabrir_costeo_codigo', { p_codigo: analisis.data.codigo, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'El costeo no se reabrió. Recarga la pantalla.' }

  revalidar()
  return { ok: true, mensaje: 'Costeo reabierto: el cierre anterior queda con su motivo.' }
}
