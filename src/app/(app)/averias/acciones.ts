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

  const codigo = data.codigo_equipo ?? 'elegido'

  revalidatePath('/averias', 'layout')
  // La que detiene el trabajo cambió el estado del equipo en el padrón.
  if (data.equipo_parado) revalidatePath('/equipos', 'layout')
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
        : data.sigue_parado_por
          ? ` El equipo sigue parado: el reporte ${data.sigue_parado_por} dice que detiene el trabajo.`
          : ''
  return { ok: true, mensaje: `Reporte anulado. Queda con su motivo.${vuelve}` }
}

/** El mismo permiso que piden `averias_atender`, `averias_enlazar_rq`, `averias_quitar_rq` y `averias_cerrar`. */
const SOLO_MANTENIMIENTO = 'Una avería la atiende Mantenimiento.'

/**
 * Mantenimiento la toma con su diagnóstico, o lo corrige mientras la atiende.
 * El mismo texto otra vez no cambia nada.
 */
export async function atenderAveria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'averias.atender')) return { ok: false, error: SOLO_MANTENIMIENTO }

  const analisis = z
    .object({
      id: z.guid(),
      diagnostico: z
        .string()
        .min(10, 'Escribe el diagnóstico: qué tiene el equipo, en al menos 10 caracteres.')
        .max(2000, 'El diagnóstico pasa de 2000 caracteres.'),
      primera: z.enum(['SI', 'NO']),
    })
    .safeParse({ id: formulario.get('id'), diagnostico: dato(formulario, 'diagnostico'), primera: dato(formulario, 'primera') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_atender', { p_id: analisis.data.id, p_diagnostico: analisis.data.diagnostico })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.averia !== analisis.data.id) return { ok: false, error: 'El diagnóstico no quedó. Recarga la pantalla.' }

  revalidatePath('/averias', 'layout')
  return {
    ok: true,
    mensaje: analisis.data.primera === 'SI' ? 'Diagnóstico anotado: la avería queda en atención.' : 'Diagnóstico corregido.',
  }
}

/** Mantenimiento enlaza el RQ con que se pidieron los repuestos. El id del enlace lo pone la pantalla: el reintento no lo duplica. */
export async function enlazarRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ numero: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'averias.atender')) return { ok: false, error: SOLO_MANTENIMIENTO }

  const analisis = z
    .object({
      enlace: z.guid(),
      averia: z.guid(),
      requerimiento: z.guid('Elige el RQ de la lista.'),
      nota: z.string().min(3, 'Di qué repuesto se pidió con ese RQ.').max(300, 'La nota pasa de 300 caracteres.'),
    })
    .safeParse({
      enlace: formulario.get('enlace'),
      averia: formulario.get('averia'),
      requerimiento: dato(formulario, 'requerimiento'),
      nota: dato(formulario, 'nota'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_enlazar_rq', { p_enlace: d.enlace, p_averia: d.averia, p_requerimiento: d.requerimiento, p_nota: d.nota })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.enlace !== d.enlace || !data.numero_rq) return { ok: false, error: 'El RQ no quedó enlazado. Recarga la pantalla.' }

  revalidatePath('/averias', 'layout')
  return { ok: true, mensaje: `RQ ${data.numero_rq} enlazado.`, datos: { numero: data.numero_rq } }
}

/** Mantenimiento quita un RQ enlazado por error. No se borra: queda quién y cuándo. */
export async function quitarRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'averias.atender')) return { ok: false, error: SOLO_MANTENIMIENTO }

  const analisis = z.object({ enlace: z.guid() }).safeParse({ enlace: formulario.get('enlace') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('averias_quitar_rq', { p_enlace: analisis.data.enlace }).maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.enlace !== analisis.data.enlace) return { ok: false, error: 'El RQ no se quitó. Recarga la pantalla.' }

  revalidatePath('/averias', 'layout')
  return { ok: true, mensaje: `RQ ${data.numero_rq ?? ''} quitado de este reporte.`.replace('  ', ' ') }
}

/** Mantenimiento la cierra con el trabajo hecho y las horas parado; el equipo vuelve a operativo si estaba parado por ella. */
export async function cerrarAveria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'averias.atender')) return { ok: false, error: SOLO_MANTENIMIENTO }

  const analisis = z
    .object({
      id: z.guid(),
      trabajo: z.string().min(10, 'Cuenta el trabajo hecho, en al menos 10 caracteres.').max(2000, 'El trabajo hecho pasa de 2000 caracteres.'),
      horas: z.coerce
        .number({ message: 'Anota las horas que el equipo estuvo parado (0 si no se paró).' })
        .min(0, 'Las horas parado no pueden ser negativas.')
        .max(9999, 'Revisa las horas parado: pasan de 9999.'),
    })
    .safeParse({
      id: formulario.get('id'),
      trabajo: dato(formulario, 'trabajo'),
      // «2,5» se lee como 2.5; un campo vacío no es «0».
      horas: dato(formulario, 'horas').replace(',', '.') || undefined,
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_cerrar', { p_id: analisis.data.id, p_trabajo: analisis.data.trabajo, p_horas: analisis.data.horas })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.averia !== analisis.data.id) return { ok: false, error: 'La avería no se cerró. Recarga la pantalla.' }

  revalidatePath('/averias', 'layout')
  revalidatePath('/equipos')
  const equipo = data.equipo_vuelve_a
    ? ' El equipo vuelve a operativo.'
    : data.sigue_parado_por
      ? ` El equipo sigue parado: el reporte ${data.sigue_parado_por} dice que detiene el trabajo.`
      : ''
  const aviso = data.avisada ? ' Le avisamos a quien la reportó para que confirme si quedó bien.' : ''
  return { ok: true, mensaje: `Avería cerrada.${equipo}${aviso}` }
}

/**
 * Quien la reportó confirma que quedó bien, o dice qué sigue fallando y vuelve
 * a Mantenimiento. No pide permiso: la base deja confirmar solo a quien la reportó.
 */
export async function confirmarAveria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirSesion()

  const analisis = z
    .object({
      id: z.guid(),
      quedo: z.enum(['SI', 'NO'], { message: 'Elige si el equipo quedó bien.' }),
      nota: z.string().max(500, 'La nota pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), quedo: dato(formulario, 'quedo'), nota: dato(formulario, 'nota') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data
  if (d.quedo === 'NO' && d.nota.length < 10) {
    return { ok: false, error: 'Cuenta qué sigue fallando, en al menos 10 caracteres: vuelve a Mantenimiento con eso.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('averias_confirmar', { p_id: d.id, p_quedo_bien: d.quedo === 'SI', p_nota: d.nota })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.averia !== d.id) return { ok: false, error: 'No quedó tu respuesta. Recarga la pantalla.' }

  revalidatePath('/averias', 'layout')
  if (data.estado === 'CONFIRMADA') return { ok: true, mensaje: 'Gracias: la avería queda cerrada.' }
  revalidatePath('/equipos')
  return {
    ok: true,
    mensaje: `Vuelve a Mantenimiento con lo que contaste; ya le avisamos.${data.equipo_parado ? ' El equipo quedó parado otra vez.' : ''}`,
  }
}
