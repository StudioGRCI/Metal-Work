'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { horaDeLima } from '@/lib/dominio/requerimientos'
import { MAXIMO_FOTOS_SSOMA, TIPOS_REPORTE_SSOMA } from '@/lib/dominio/ssoma'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * Lo que viaja como JSON en un campo del formulario. Si el campo vino y no se
 * puede leer, `undefined`, y la validación lo rechaza: tomarlo como «sin fotos»
 * registraba el reporte y dejaba sueltas las que ya había subido.
 */
function json(formulario: FormData, nombre: string): unknown {
  if (!formulario.has(nombre)) return []
  try {
    return JSON.parse(dato(formulario, nombre))
  } catch {
    return undefined
  }
}

/** Lo que dice el verde según a quién le llegó el aviso (`ssoma_a_quien_se_aviso`): nunca «ya le avisamos» si no llegó. */
function aQuienSeAviso(numero: string, avisado: string | null) {
  switch (avisado) {
    case 'SSOMA':
      return `Reporte ${numero} registrado: ya le avisamos a SSOMA.`
    case 'GERENCIA':
      return `Reporte ${numero} registrado. SSOMA todavía no tiene cuenta en el sistema: le avisamos a Gerencia.`
    case 'TU':
      return `Reporte ${numero} registrado.`
    default:
      return `Reporte ${numero} registrado, pero no hay nadie de SSOMA ni de Gerencia con cuenta para recibir el aviso: cuéntaselo a tu jefe.`
  }
}

/**
 * Cualquier cuenta reporta un accidente, un incidente o una condición insegura.
 * No pide permiso, igual que `ssoma_reportar`: basta la sesión. A nombre de un
 * trabajador sin cuenta, las dos piden `ssoma.reportar_por_otro`.
 *
 * No lleva `redirect()`: anota fotos que el navegador ya subió, y la ventana
 * decide qué hacer con ellas según lo que conteste.
 */
export async function reportarIncidente(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string; numero: string }>> {
  const perfil = await exigirSesion()

  const analisis = z
    .object({
      operacion_id: z.guid(),
      tipo: z.enum(TIPOS_REPORTE_SSOMA, { message: 'Elige qué reportas: un accidente, un incidente o una condición insegura.' }),
      area_id: z.guid('Elige el área donde pasó.'),
      lugar: z
        .string()
        .min(3, 'Escribe el lugar exacto: la nave, la máquina o la zona.')
        .max(120, 'El lugar pasa de 120 caracteres.'),
      descripcion: z
        .string()
        .min(10, 'Cuenta qué pasó o qué viste, en al menos 10 caracteres.')
        .max(2000, 'La descripción pasa de 2000 caracteres.'),
      ocurrido_en: z.string(),
      hubo_atencion: z.enum(['', 'SI', 'NO']),
      trabajador_id: z.union([z.literal(''), z.guid('Elige a la persona de la lista: recarga la pantalla si no aparece.')]),
      fotos: z
        .array(z.string().min(1).max(300), 'Vuelve a elegir las fotos.')
        .max(MAXIMO_FOTOS_SSOMA, `Van hasta ${MAXIMO_FOTOS_SSOMA} fotos por reporte.`),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      tipo: dato(formulario, 'tipo'),
      area_id: dato(formulario, 'area_id'),
      lugar: dato(formulario, 'lugar'),
      descripcion: dato(formulario, 'descripcion'),
      ocurrido_en: dato(formulario, 'ocurrido_en'),
      hubo_atencion: dato(formulario, 'hubo_atencion'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  const d = analisis.data

  const cuando = d.ocurrido_en ? horaDeLima(d.ocurrido_en) : null
  if (d.ocurrido_en && !cuando) return { ok: false, error: 'La fecha y la hora del hecho no son válidas.' }
  if (d.tipo === 'ACCIDENTE' && !d.hubo_atencion) return { ok: false, error: 'Marca si hubo atención médica.' }
  // El mismo permiso que pide la base para reportar a nombre de otra persona.
  if (d.trabajador_id && !puede(perfil, 'ssoma.reportar_por_otro')) {
    return { ok: false, error: 'No tienes permiso para reportar a nombre de otra persona.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_reportar', {
    p_id: d.operacion_id,
    p_tipo: d.tipo,
    p_area: d.area_id,
    p_lugar: d.lugar,
    p_descripcion: d.descripcion,
    p_ocurrido_en: cuando,
    // Solo de un accidente; de lo demás no se anota.
    p_hubo_atencion: d.tipo === 'ACCIDENTE' ? d.hubo_atencion === 'SI' : null,
    p_trabajador: d.trabajador_id || null,
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  const fila = data?.[0]
  if (!fila?.reporte || !fila.numero_reporte || fila.reporte !== d.operacion_id) {
    return { ok: false, error: 'El reporte no quedó registrado. Recarga la pantalla.' }
  }

  revalidatePath('/ssoma', 'layout')
  return {
    ok: true,
    mensaje: aQuienSeAviso(fila.numero_reporte, fila.avisado),
    datos: { id: fila.reporte, numero: fila.numero_reporte },
  }
}

/** SSOMA anula un reporte mal hecho, con su motivo; no se borra. Mismo permiso que `ssoma_anular_reporte`. */
export async function anularReporteSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Un reporte de seguridad lo anula SSOMA.' }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_reporte', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El reporte no se anuló. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Reporte anulado. Queda con su motivo.' }
}
