'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { MAXIMO_FOTOS_REPORTE, MAXIMO_TRABAJOS_REPORTE } from '@/lib/dominio/reporte-diario'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/** Lo que viaja como JSON en un campo del formulario; si no se puede leer, `null`. */
function json(formulario: FormData, nombre: string): unknown {
  try {
    return JSON.parse(dato(formulario, nombre) || 'null')
  } catch {
    return null
  }
}

const PERSONA = z.object({
  trabajador_id: z.guid('Elige a cada persona de la lista.'),
  horas: z.coerce
    .number('Escribe las horas de cada persona.')
    .min(0.25, 'Las horas de cada persona van de 0,25 a 16.')
    .max(16, 'Las horas de cada persona van de 0,25 a 16.'),
})

const TRABAJO = z.object({
  descripcion: z
    .string()
    .trim()
    .min(3, 'Describe cada trabajo realizado, en al menos 3 caracteres.')
    .max(500, 'La descripción de un trabajo pasa de 500 caracteres.'),
  avance: z.coerce
    .number('Pon el porcentaje de avance de cada trabajo.')
    .int('El avance va en números enteros.')
    .min(0, 'El avance va de 0 a 100 %.')
    .max(100, 'El avance va de 0 a 100 %.'),
  personal: z.array(PERSONA).max(60, 'Un trabajo lleva hasta 60 personas.'),
})

/**
 * El supervisor sube su reporte del día. Mismo permiso que
 * `registrar_reporte_diario` (`reporte_diario.registrar`); la base vuelve a
 * revisar todo y es la que pasa las horas al costeo.
 */
export async function registrarReporteDiario(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'reporte_diario.registrar')) return { ok: false, error: 'El reporte diario lo suben los supervisores.' }

  const analisis = z
    .object({
      id: z.guid(),
      fecha: z.iso.date('Elige el día del reporte.'),
      codigo_interno: z
        .string()
        .min(2, 'Escribe el código interno. Si no es para una unidad, escribe PLANTA.')
        .max(60, 'El código interno pasa de 60 caracteres.'),
      asunto: z.string().min(3, 'Escribe el asunto del reporte.').max(120, 'El asunto pasa de 120 caracteres.'),
      descripcion: z.string().min(3, 'Escribe una breve descripción del reporte.').max(1000, 'La descripción pasa de 1000 caracteres.'),
      trabajos: z
        .array(TRABAJO, 'Anota al menos un trabajo realizado.')
        .min(1, 'Anota al menos un trabajo realizado.')
        .max(MAXIMO_TRABAJOS_REPORTE, `Un reporte lleva hasta ${MAXIMO_TRABAJOS_REPORTE} trabajos.`),
      general: z.boolean(),
      personal_general: z.array(PERSONA).max(60, 'El personal general lleva hasta 60 personas.'),
      fotos: z.array(z.string().min(1).max(300)).max(MAXIMO_FOTOS_REPORTE, `Un reporte lleva hasta ${MAXIMO_FOTOS_REPORTE} fotos.`),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      fecha: dato(formulario, 'fecha'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      asunto: dato(formulario, 'asunto'),
      descripcion: dato(formulario, 'descripcion'),
      trabajos: json(formulario, 'trabajos'),
      general: dato(formulario, 'personal_general') === 'si',
      personal_general: json(formulario, 'personal') ?? [],
      fotos: json(formulario, 'fotos') ?? [],
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  const d = analisis.data

  // Con personal general, la gente va una vez para todo el reporte y los
  // trabajos sin la suya; si no, cada trabajo con la suya.
  const personas = d.general ? d.personal_general.length : d.trabajos.reduce((n, t) => n + t.personal.length, 0)
  if (personas === 0) return { ok: false, error: 'Pon al menos a una persona con sus horas: de ahí sale el costeo.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_reporte_diario', {
    p_id: d.id,
    p_fecha: d.fecha,
    p_codigo_interno: d.codigo_interno,
    p_asunto: d.asunto,
    p_descripcion: d.descripcion,
    p_trabajos: d.trabajos.map((t) => ({ ...t, personal: d.general ? [] : t.personal })),
    p_personal_general: d.general ? d.personal_general : [],
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El reporte no quedó subido. Recarga la pantalla.' }

  revalidatePath('/reportes-diarios')
  revalidatePath('/rrhh/costeo')
  return { ok: true, mensaje: 'Reporte subido: sus horas van al costeo de Recursos Humanos.', datos: { id: d.id } }
}

/**
 * Anular un reporte con su motivo: sus horas salen del costeo. Lo puede quien
 * lo subió (dentro de 7 días) y RR. HH.; la base lo vuelve a exigir.
 */
export async function anularReporteDiario(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['reporte_diario.registrar', 'rrhh.personal'])) {
    return { ok: false, error: 'Solo quien subió el reporte o Recursos Humanos lo pueden anular.' }
  }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_reporte_diario', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El reporte no se anuló. Recarga la pantalla.' }

  revalidatePath('/reportes-diarios')
  revalidatePath(`/reportes-diarios/${analisis.data.id}`)
  revalidatePath('/rrhh/costeo')
  return { ok: true, mensaje: 'Reporte anulado. Sus horas salieron del costeo.' }
}
