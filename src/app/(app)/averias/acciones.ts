'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { aQuienSeAviso, MAXIMO_FOTOS_AVERIA, TIPOS_AVERIA } from '@/lib/dominio/averias'
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

/**
 * Cualquier cuenta reporta la avería o la posible avería de un equipo. No pide
 * permiso, igual que `averias_reportar`: basta la sesión.
 *
 * No lleva `redirect()`: anota fotos que el navegador ya subió, y la ventana
 * decide qué hacer con ellas según lo que conteste.
 */
export async function reportarAveria(
  _previo: unknown,
  formulario: FormData,
): Promise<ResultadoAccion<{ id: string; numero: string; equipo: string }>> {
  const perfil = await exigirSesion()

  const analisis = z
    .object({
      operacion_id: z.guid(),
      equipo_id: z.guid('Elige el equipo que falla.'),
      tipo: z.enum(TIPOS_AVERIA, { message: 'Elige si es una avería o una posible avería.' }),
      detiene: z.enum(['', 'SI', 'NO']),
      riesgo: z.enum(['SI', 'NO'], { message: 'Marca si es un riesgo para las personas.' }),
      descripcion: z
        .string()
        .min(10, 'Cuenta qué le pasa al equipo, en al menos 10 caracteres.')
        .max(2000, 'La descripción pasa de 2000 caracteres.'),
      fotos: z
        .array(z.string().min(1).max(300), 'Vuelve a elegir las fotos.')
        .max(MAXIMO_FOTOS_AVERIA, `Van hasta ${MAXIMO_FOTOS_AVERIA} fotos por reporte.`),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      equipo_id: dato(formulario, 'equipo_id'),
      tipo: dato(formulario, 'tipo'),
      detiene: dato(formulario, 'detiene'),
      riesgo: dato(formulario, 'riesgo'),
      descripcion: dato(formulario, 'descripcion'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  const d = analisis.data
  if (d.tipo === 'AVERIA' && !d.detiene) return { ok: false, error: 'Marca si la avería detiene el trabajo.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_reportar', {
      p_id: d.operacion_id,
      p_equipo: d.equipo_id,
      p_tipo: d.tipo,
      // La posible avería no detiene el trabajo: si ya lo detiene, es una avería.
      p_detiene: d.tipo === 'AVERIA' ? d.detiene === 'SI' : false,
      p_riesgo: d.riesgo === 'SI',
      p_descripcion: d.descripcion,
      p_fotos: d.fotos,
    })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data?.averia || !data.numero_averia || data.averia !== d.operacion_id) {
    return { ok: false, error: 'El reporte no quedó registrado. Recarga la pantalla.' }
  }

  // El código del equipo, para decir cuál quedó parado: lo lee la misma función que la lista.
  const { data: fila } = await supabase.rpc('averias_visibles', { p_id: data.averia }).maybeSingle()
  const codigo = fila?.equipo_codigo ?? 'elegido'

  revalidatePath('/averias', 'layout')
  return {
    ok: true,
    mensaje: aQuienSeAviso(
      data.numero_averia,
      {
        mantenimiento: data.aviso_mantenimiento === true,
        responsable: data.aviso_responsable === true,
        ssoma: data.aviso_ssoma === true,
        gerencia: data.aviso_gerencia === true,
      },
      { atiende: puede(perfil, 'averias.atender'), riesgo: d.riesgo === 'SI', parado: data.equipo_parado === true, codigo },
    ),
    datos: { id: data.averia, numero: data.numero_averia, equipo: codigo },
  }
}

/** Mantenimiento anula un reporte mal hecho, con su motivo; no se borra. Mismo permiso que `averias_anular`. */
export async function anularAveria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'averias.atender')) return { ok: false, error: 'Un reporte de avería lo anula Mantenimiento.' }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_anular', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.averia !== analisis.data.id) return { ok: false, error: 'El reporte no se anuló. Recarga la pantalla.' }

  revalidatePath('/averias', 'layout')
  revalidatePath('/equipos')
  const vuelve =
    data.equipo_vuelve_a === 'OPERATIVO'
      ? ' El equipo vuelve a operativo.'
      : data.equipo_vuelve_a === 'CON_OBSERVACION'
        ? ' El equipo vuelve a «con observación».'
        : ''
  return { ok: true, mensaje: `Reporte anulado. Queda con su motivo.${vuelve}` }
}
