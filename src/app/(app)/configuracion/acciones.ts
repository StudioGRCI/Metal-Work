'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

async function exigirEdicion() {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'configuracion.editar')) {
    return 'Cambiar la configuración es de administración.'
  }
  return null
}

/** Qué días de la semana hay taller. */
export async function guardarDiasLaborables(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const dias = datos
    .getAll('dia')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)

  if (dias.length === 0) {
    return { ok: false, error: 'Algún día tiene que haber taller.' }
  }

  const supabase = await createClient()
  const { data: empresa } = await supabase.from('empresa').select('id').limit(1).maybeSingle()
  if (!empresa) return { ok: false, error: 'No se encontró la empresa.' }

  const { error } = await supabase
    .from('empresa')
    .update({ dias_laborables: dias })
    .eq('id', empresa.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Calendario guardado. Los plazos en días hábiles ya lo usan.' }
}

/** Trae los feriados nacionales del año: la base no pisa lo ya cargado. */
export async function sembrarFeriados(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({ anio: z.coerce.number().int().min(2020).max(2100) })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Revisa el año.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sembrar_feriados', { p_anio: analisis.data.anio })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return {
    ok: true,
    mensaje:
      Number(data) > 0
        ? `${data} feriados nacionales cargados para ${analisis.data.anio}.`
        : `Los feriados de ${analisis.data.anio} ya estaban cargados.`,
  }
}

/** Un feriado propio de la empresa: aniversario, paro, lo que sea. */
export async function agregarFeriado(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha'),
      nombre: z.string().trim().min(3, 'Ponle nombre al feriado'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el feriado.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('feriados').insert({
    fecha: analisis.data.fecha,
    nombre: analisis.data.nombre,
    ambito: 'EMPRESA',
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Feriado agregado.' }
}

/**
 * En un feriado marcado como laborable el taller sí trabaja: es como la
 * empresa decide «este feriado lo recuperamos».
 */
export async function alternarFeriadoLaborable(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      laborable: z.enum(['si', 'no']),
    })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('feriados')
    .update({ laborable: analisis.data.laborable === 'si' })
    .eq('fecha', analisis.data.fecha)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true }
}
