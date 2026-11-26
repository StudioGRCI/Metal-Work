'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { horaDeLima } from '@/lib/dominio/requerimientos'
import { CLASIFICACIONES_SSOMA, esAccidente, MAXIMO_FOTOS_EVIDENCIA, MAXIMO_FOTOS_SSOMA, TIPOS_REPORTE_SSOMA } from '@/lib/dominio/ssoma'
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
function aQuienSeAviso(numero: string, avisado: string | null, esDeGerencia: boolean) {
  switch (avisado) {
    case 'SSOMA':
      return `Reporte ${numero} registrado: ya le avisamos a SSOMA.`
    case 'GERENCIA':
      return `Reporte ${numero} registrado. No hay una cuenta activa de SSOMA: le avisamos a Gerencia.`
    case 'TU':
      return `Reporte ${numero} registrado.`
    default:
      // Quien reporta es de Gerencia y no hay SSOMA: el aviso no tenía a quién más ir.
      if (esDeGerencia) return `Reporte ${numero} registrado. No hay una cuenta activa de SSOMA que reciba el aviso.`
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
      tipo: z.enum(TIPOS_REPORTE_SSOMA, {
        message: 'Elige qué reportas: un accidente, un incidente o una condición insegura.',
      }),
      area_id: z.guid('Elige el área donde pasó.'),
      lugar: z.string().min(3, 'Escribe el lugar exacto: la nave, la máquina o la zona.').max(120, 'El lugar pasa de 120 caracteres.'),
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
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.',
    }
  const d = analisis.data

  const cuando = d.ocurrido_en ? horaDeLima(d.ocurrido_en) : null
  if (d.ocurrido_en && !cuando) return { ok: false, error: 'La fecha y la hora del hecho no son válidas.' }
  if (d.tipo === 'ACCIDENTE' && !d.hubo_atencion) return { ok: false, error: 'Marca si hubo atención médica.' }
  // El mismo permiso que pide la base para reportar a nombre de otra persona.
  if (d.trabajador_id && !puede(perfil, 'ssoma.reportar_por_otro')) {
    return {
      ok: false,
      error: 'No tienes permiso para reportar a nombre de otra persona.',
    }
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
    return {
      ok: false,
      error: 'El reporte no quedó registrado. Recarga la pantalla.',
    }
  }

  revalidatePath('/ssoma', 'layout')
  return {
    ok: true,
    mensaje: aQuienSeAviso(fila.numero_reporte, fila.avisado, puede(perfil, 'ssoma.ver')),
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
    .safeParse({
      id: formulario.get('id'),
      motivo: dato(formulario, 'motivo'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.',
    }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_reporte', {
    p_id: analisis.data.id,
    p_motivo: analisis.data.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El reporte no se anuló. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Reporte anulado. Queda con su motivo.' }
}

/*
 * Entrega 15.2: la clasificación y las acciones correctivas. Cada acción exige
 * el mismo permiso que su función en la base (`ssoma.gestionar`); cerrar la
 * acción no lo exige aquí, porque también la cierra su responsable, y eso lo
 * decide la base con la fila a la vista.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const fechaLimite = z.string().regex(FECHA, 'Pon la fecha límite.')

/** SSOMA clasifica el reporte y anota la causa. Mismo permiso que `ssoma_clasificar`. */
export async function clasificarReporteSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Un reporte de seguridad lo clasifica SSOMA.' }

  const analisis = z
    .object({
      id: z.guid(),
      clasificacion: z.enum(CLASIFICACIONES_SSOMA, {
        message: 'Elige la clasificación.',
      }),
      hubo_atencion: z.enum(['', 'SI', 'NO']),
      dias_perdidos: z.string(),
      causa: z.string().min(10, 'Anota la causa, en al menos 10 caracteres.').max(2000, 'La causa pasa de 2000 caracteres.'),
    })
    .safeParse({
      id: formulario.get('id'),
      clasificacion: dato(formulario, 'clasificacion'),
      hubo_atencion: dato(formulario, 'hubo_atencion'),
      dias_perdidos: dato(formulario, 'dias_perdidos'),
      causa: dato(formulario, 'causa'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Revisa la clasificación.',
    }
  const d = analisis.data
  const accidente = esAccidente(d.clasificacion)
  if (accidente && !d.hubo_atencion)
    return {
      ok: false,
      error: 'De un accidente marca si hubo atención médica.',
    }
  const incapacitante = d.clasificacion === 'ACCIDENTE_INCAPACITANTE'
  const dias = incapacitante ? Number(d.dias_perdidos) : null
  if (incapacitante && (!Number.isInteger(dias) || (dias ?? 0) < 1 || (dias ?? 0) > 3650)) {
    return {
      ok: false,
      error: 'Del accidente incapacitante escribe los días de descanso médico (de 1 a 3650).',
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_clasificar', {
    p_reporte: d.id,
    p_clasificacion: d.clasificacion,
    // Solo de un accidente; de lo demás no se anota.
    p_hubo_atencion: accidente ? d.hubo_atencion === 'SI' : null,
    p_dias_perdidos: dias,
    p_causa: d.causa,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id)
    return {
      ok: false,
      error: 'La clasificación no se guardó. Recarga la pantalla.',
    }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Clasificación guardada.' }
}

/** SSOMA encarga una acción correctiva a una cuenta. Mismo permiso que `ssoma_crear_accion`. */
export async function crearAccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una acción correctiva la encarga SSOMA.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      reporte_id: z.guid(),
      descripcion: z
        .string()
        .min(10, 'Escribe qué se tiene que hacer, en al menos 10 caracteres.')
        .max(500, 'La acción pasa de 500 caracteres.'),
      responsable_id: z.guid('Elige al responsable.'),
      fecha_limite: fechaLimite,
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      reporte_id: dato(formulario, 'reporte_id'),
      descripcion: dato(formulario, 'descripcion'),
      responsable_id: dato(formulario, 'responsable_id'),
      fecha_limite: dato(formulario, 'fecha_limite'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Revisa la acción.',
    }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_crear_accion', {
    p_id: d.operacion_id,
    p_reporte: d.reporte_id,
    p_descripcion: d.descripcion,
    p_responsable: d.responsable_id,
    p_fecha_limite: d.fecha_limite,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id)
    return {
      ok: false,
      error: 'La acción no quedó registrada. Recarga la pantalla.',
    }

  revalidatePath('/ssoma', 'layout')
  const propia = d.responsable_id === perfil.id
  return {
    ok: true,
    mensaje: propia ? 'Acción registrada, a tu cargo.' : 'Acción registrada: ya le avisamos al responsable.',
    datos: { id: d.operacion_id },
  }
}

/**
 * El responsable (o SSOMA) cierra la acción con qué se hizo y sus fotos, ya
 * subidas. Quién puede lo decide `ssoma_cerrar_accion` con la fila a la vista.
 * No lleva `redirect()`: la ventana decide qué hacer con las fotos según lo que conteste.
 */
export async function cerrarAccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirSesion()
  const analisis = z
    .object({
      accion_id: z.guid(),
      operacion_id: z.guid(),
      nota: z.string().min(10, 'Cuenta qué se hizo, en al menos 10 caracteres.').max(1000, 'Lo que se hizo pasa de 1000 caracteres.'),
      fotos: z
        .array(z.string().min(1).max(300), 'Vuelve a elegir las fotos.')
        .min(1, 'Pon al menos una foto de lo que se hizo: es la evidencia del cierre.')
        .max(MAXIMO_FOTOS_EVIDENCIA, `Van hasta ${MAXIMO_FOTOS_EVIDENCIA} fotos por cierre.`),
    })
    .safeParse({
      accion_id: dato(formulario, 'accion_id'),
      operacion_id: dato(formulario, 'operacion_id'),
      nota: dato(formulario, 'nota'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Revisa el cierre.',
    }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_cerrar_accion', {
    p_accion: d.accion_id,
    p_evento: d.operacion_id,
    p_nota: d.nota,
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.accion_id) return { ok: false, error: 'La acción no se cerró. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  // «Ya le avisamos» solo si alguien de SSOMA, que no sea quien cierra, lo recibe.
  const { data: avisado } = await supabase.rpc('ssoma_hay_quien_reciba_el_cierre')
  return {
    ok: true,
    mensaje: avisado ? 'Acción cerrada con su evidencia: ya le avisamos a SSOMA.' : 'Acción cerrada con su evidencia.',
  }
}

/** SSOMA reabre una acción cuya evidencia no basta. Mismo permiso que `ssoma_reabrir_accion`. */
export async function reabrirAccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una acción correctiva la reabre SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se reabre, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
      fecha_limite: fechaLimite,
    })
    .safeParse({
      id: formulario.get('id'),
      motivo: dato(formulario, 'motivo'),
      fecha_limite: dato(formulario, 'fecha_limite'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.',
    }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_reabrir_accion', {
    p_accion: analisis.data.id,
    p_motivo: analisis.data.motivo,
    p_fecha_limite: analisis.data.fecha_limite,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id)
    return {
      ok: false,
      error: 'La acción no se reabrió. Recarga la pantalla.',
    }

  revalidatePath('/ssoma', 'layout')
  return {
    ok: true,
    mensaje: 'Acción reabierta: vuelve a su responsable, con tu motivo.',
  }
}

/** SSOMA le pasa la acción a otra cuenta o le cambia la fecha. Mismo permiso que `ssoma_reasignar_accion`. */
export async function reasignarAccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una acción correctiva la reasigna SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      responsable_id: z.guid('Elige al responsable.'),
      fecha_limite: fechaLimite,
    })
    .safeParse({
      id: formulario.get('id'),
      responsable_id: dato(formulario, 'responsable_id'),
      fecha_limite: dato(formulario, 'fecha_limite'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.',
    }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_reasignar_accion', {
    p_accion: analisis.data.id,
    p_responsable: analisis.data.responsable_id,
    p_fecha_limite: analisis.data.fecha_limite,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id)
    return {
      ok: false,
      error: 'La acción no se reasignó. Recarga la pantalla.',
    }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Acción reasignada.' }
}

/** SSOMA anula una acción abierta con su motivo; no se borra. Mismo permiso que `ssoma_anular_accion`. */
export async function anularAccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una acción correctiva la anula SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({
      id: formulario.get('id'),
      motivo: dato(formulario, 'motivo'),
    })
  if (!analisis.success)
    return {
      ok: false,
      error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.',
    }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_accion', {
    p_accion: analisis.data.id,
    p_motivo: analisis.data.motivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La acción no se anuló. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Acción anulada. Queda con su motivo.' }
}
