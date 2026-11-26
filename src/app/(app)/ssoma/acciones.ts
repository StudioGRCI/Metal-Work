'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { horaDeLima } from '@/lib/dominio/requerimientos'
import {
  CLASIFICACIONES_SSOMA,
  esAccidente,
  MAXIMO_FOTOS_CHARLA,
  MAXIMO_FOTOS_EVIDENCIA,
  MAXIMO_FOTOS_SSOMA,
  RESULTADOS_INSPECCION,
  TIPOS_CHARLA_SSOMA,
  TIPOS_INSPECCION_SSOMA,
  TIPOS_REPORTE_SSOMA,
} from '@/lib/dominio/ssoma'
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
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_reporte', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
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

/**
 * SSOMA encarga una acción correctiva a una cuenta, para un reporte o para el
 * hallazgo de una inspección. Mismo permiso que `ssoma_crear_accion` y
 * `ssoma_accion_de_hallazgo`.
 */
export async function crearAccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una acción correctiva la encarga SSOMA.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      reporte_id: z.union([z.literal(''), z.guid()]),
      respuesta_id: z.union([z.literal(''), z.guid()]),
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
      respuesta_id: dato(formulario, 'respuesta_id'),
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
  // De un reporte o de un hallazgo: de uno solo.
  if (Boolean(d.reporte_id) === Boolean(d.respuesta_id)) return { ok: false, error: 'Vuelve a abrir el formulario de la acción.' }

  const supabase = await createClient()
  const { data, error } = d.respuesta_id
    ? await supabase.rpc('ssoma_accion_de_hallazgo', {
        p_id: d.operacion_id,
        p_respuesta: d.respuesta_id,
        p_descripcion: d.descripcion,
        p_responsable: d.responsable_id,
        p_fecha_limite: d.fecha_limite,
      })
    : await supabase.rpc('ssoma_crear_accion', {
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

/*
 * Entrega 15.3: las charlas e inducciones. Las dos acciones exigen el mismo
 * permiso que sus funciones en la base (`ssoma.gestionar`).
 */

/** SSOMA registra una charla o inducción con su tema, expositor, fotos y asistentes. Mismo permiso que `ssoma_registrar_charla`. */
export async function registrarCharlaSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una charla la registra SSOMA.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      tipo: z.enum(TIPOS_CHARLA_SSOMA, { message: 'Elige si fue una charla o una inducción.' }),
      tema: z.string().min(5, 'Escribe el tema, en al menos 5 caracteres.').max(200, 'El tema pasa de 200 caracteres.'),
      expositor: z.string().min(3, 'Escribe quién dio la charla.').max(120, 'El nombre de quien la dio pasa de 120 caracteres.'),
      fecha: z.string().regex(FECHA, 'Pon la fecha de la charla.'),
      asistentes: z
        .array(z.guid('Vuelve a abrir el formulario: la lista del personal cambió.'), 'Marca quiénes asistieron.')
        .min(1, 'Marca quiénes asistieron.')
        .max(500, 'Van hasta 500 asistentes por charla.'),
      fotos: z
        .array(z.string().min(1).max(300), 'Vuelve a elegir las fotos.')
        .min(1, 'Pon al menos una foto de la charla.')
        .max(MAXIMO_FOTOS_CHARLA, `Van hasta ${MAXIMO_FOTOS_CHARLA} fotos por charla.`),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      tipo: dato(formulario, 'tipo'),
      tema: dato(formulario, 'tema'),
      expositor: dato(formulario, 'expositor'),
      fecha: dato(formulario, 'fecha'),
      asistentes: formulario.getAll('asistentes').filter((v): v is string => typeof v === 'string'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la charla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_registrar_charla', {
    p_id: d.operacion_id,
    p_tipo: d.tipo,
    p_tema: d.tema,
    p_expositor: d.expositor,
    p_fecha: d.fecha,
    p_asistentes: d.asistentes,
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La charla no quedó registrada. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  const cuantos = new Set(d.asistentes).size
  const que = d.tipo === 'INDUCCION' ? 'Inducción registrada' : 'Charla registrada'
  return { ok: true, mensaje: `${que} con ${cuantos} ${cuantos === 1 ? 'asistente' : 'asistentes'}.`, datos: { id: d.operacion_id } }
}

/** SSOMA anula una charla mal registrada, con su motivo; no se borra. Mismo permiso que `ssoma_anular_charla`. */
export async function anularCharlaSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una charla la anula SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_charla', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La charla no se anuló. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Charla anulada: ya no cuenta como asistencia y queda con su motivo.' }
}

/*
 * Entrega 15.4: las inspecciones con lista de verificación. Las cuatro acciones
 * exigen el mismo permiso que sus funciones en la base (`ssoma.gestionar`).
 */

/** Lo que se marcó en un punto; del no conforme, lo que se encontró y su acción. */
const respuestaDeInspeccion = z.discriminatedUnion('resultado', [
  z.object({ punto: z.guid(), resultado: z.literal('CONFORME') }),
  z.object({ punto: z.guid(), resultado: z.literal('NO_APLICA') }),
  z.object({
    punto: z.guid(),
    resultado: z.literal('NO_CONFORME'),
    hallazgo: z.string().trim().min(10, 'En cada punto no conforme, cuenta qué encontraste, en al menos 10 caracteres.').max(500, 'Lo que encontraste pasa de 500 caracteres.'),
    accion: z.object({
      que: z.string().trim().min(10, 'En cada punto no conforme, escribe qué se tiene que hacer, en al menos 10 caracteres.').max(500, 'La acción pasa de 500 caracteres.'),
      responsable: z.guid('En cada punto no conforme, elige al responsable.'),
      fecha_limite: z.string().regex(FECHA, 'En cada punto no conforme, pon la fecha límite.'),
    }),
  }),
])

/**
 * SSOMA registra la inspección de un área: cada punto de su lista con su
 * resultado y, de cada no conforme, lo que encontró y la acción que lo corrige.
 * Mismo permiso que `ssoma_registrar_inspeccion`, que la guarda entera o no la guarda.
 */
export async function registrarInspeccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una inspección la registra SSOMA.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      area_id: z.guid('Elige el área que inspeccionaste.'),
      fecha: z.string().regex(FECHA, 'Pon la fecha de la inspección.'),
      tipo: z.enum(TIPOS_INSPECCION_SSOMA, { message: 'Marca si la inspección fue planeada o no planeada.' }),
      observacion: z.string().max(1000, 'La observación pasa de 1000 caracteres.'),
      respuestas: z
        .array(respuestaDeInspeccion, 'Marca cada punto de la lista: conforme, no conforme o no aplica.')
        .min(1, 'Marca cada punto de la lista: conforme, no conforme o no aplica.')
        .max(200, 'La lista pasa de 200 puntos.'),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      area_id: dato(formulario, 'area_id'),
      fecha: dato(formulario, 'fecha'),
      tipo: dato(formulario, 'tipo'),
      observacion: dato(formulario, 'observacion'),
      respuestas: json(formulario, 'respuestas'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la inspección.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_registrar_inspeccion', {
    p_id: d.operacion_id,
    p_area: d.area_id,
    p_fecha: d.fecha,
    p_tipo: d.tipo,
    p_observacion: d.observacion || null,
    p_respuestas: d.respuestas,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La inspección no quedó registrada. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  const hallazgos = d.respuestas.filter((r) => r.resultado === 'NO_CONFORME').length
  return {
    ok: true,
    mensaje:
      hallazgos === 0
        ? 'Inspección registrada, sin hallazgos.'
        : `Inspección registrada con ${hallazgos} ${hallazgos === 1 ? 'hallazgo: su acción ya está encargada' : 'hallazgos: sus acciones ya están encargadas'}.`,
    datos: { id: d.operacion_id },
  }
}

/** SSOMA anula una inspección mal registrada, con su motivo; no se borra. Mismo permiso que `ssoma_anular_inspeccion`. */
export async function anularInspeccionSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una inspección la anula SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_inspeccion', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La inspección no se anuló. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Inspección anulada. Queda con su motivo.' }
}

/** SSOMA agrega un punto a la lista de verificación de un área, o a la de todas. Mismo permiso que `ssoma_agregar_punto`. */
export async function agregarPuntoSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'La lista de verificación la lleva SSOMA.' }
  const analisis = z
    .object({
      operacion_id: z.guid(),
      area_id: z.union([z.literal(''), z.guid('Elige un área de la lista, o «Todas las áreas».')]),
      texto: z.string().min(5, 'Escribe qué se revisa, en al menos 5 caracteres.').max(200, 'El punto pasa de 200 caracteres.'),
    })
    .safeParse({ operacion_id: dato(formulario, 'operacion_id'), area_id: dato(formulario, 'area_id'), texto: dato(formulario, 'texto') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el punto.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_agregar_punto', { p_id: d.operacion_id, p_area: d.area_id || null, p_texto: d.texto })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'El punto no quedó en la lista. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Punto agregado: se pide desde la próxima inspección.' }
}

/** SSOMA retira un punto de la lista o lo restituye. Mismo permiso que `ssoma_activar_punto`. */
export async function activarPuntoSsoma(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'La lista de verificación la lleva SSOMA.' }
  const analisis = z
    .object({ id: z.guid(), activo: z.enum(['SI', 'NO']) })
    .safeParse({ id: formulario.get('id'), activo: dato(formulario, 'activo') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }
  const activo = analisis.data.activo === 'SI'

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_activar_punto', { p_id: analisis.data.id, p_activo: activo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El punto no cambió. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: activo ? 'Punto restituido a la lista.' : 'Punto retirado: ya no se pide en las inspecciones nuevas.' }
}

/*
 * Entrega 15.5: la entrega de EPP por persona. Las tres acciones exigen el mismo
 * permiso que sus funciones en la base (`ssoma.gestionar`). Ninguna toca el
 * kardex: la salida es de Almacén y aquí solo se anota a quién le tocó.
 */

const personaDeLaEntrega = z.object({
  trabajador: z.guid(),
  cantidad: z.number('Pon cuánto recibió cada persona.').positive('La cantidad de cada persona es mayor que cero.').max(999, 'La cantidad de cada persona va hasta 999.'),
})

/**
 * SSOMA anota a quién se le entregó el equipo de una salida del almacén de EPP,
 * cuánto a cada uno y hasta cuándo dura. Mismo permiso que
 * `ssoma_registrar_entregas_epp`, que las guarda todas o ninguna.
 */
export async function registrarEntregasEpp(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ movimiento: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'La entrega de EPP la anota SSOMA.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      movimiento_id: z.guid('Vuelve a abrir la ventana desde la salida de Almacén.'),
      renovar_el: z.string().regex(FECHA, 'Pon hasta cuándo dura el equipo.'),
      personas: z
        .array(personaDeLaEntrega, 'Marca a quién se le entregó.')
        .min(1, 'Marca a quién se le entregó.')
        .max(200, 'Van hasta 200 personas por entrega.'),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      movimiento_id: dato(formulario, 'movimiento_id'),
      renovar_el: dato(formulario, 'renovar_el'),
      personas: json(formulario, 'personas'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la entrega.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_registrar_entregas_epp', {
    p_envio: d.operacion_id,
    p_movimiento: d.movimiento_id,
    p_renovar_el: d.renovar_el,
    p_personas: d.personas,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La entrega no quedó anotada. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  const n = d.personas.length
  return {
    ok: true,
    mensaje: n === 1 ? 'Entrega anotada a 1 persona.' : `Entrega anotada a ${n} personas.`,
    datos: { movimiento: d.movimiento_id },
  }
}

/** SSOMA anula una entrega mal anotada, con su motivo; no se borra. Mismo permiso que `ssoma_anular_entrega_epp`. */
export async function anularEntregaEpp(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Una entrega de EPP la anula SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_anular_entrega_epp', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La entrega no se anuló. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Entrega anulada: lo que tenía asignado vuelve a quedar por asignar en su salida.' }
}

/** SSOMA saca una entrega vigente de «Por renovar», con su motivo. Mismo permiso que `ssoma_epp_no_se_renueva`. */
export async function eppNoSeRenueva(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Lo que se renueva de EPP lo lleva SSOMA.' }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(5, 'Cuenta por qué ya no se renueva, en al menos 5 caracteres.').max(300, 'El motivo pasa de 300 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_epp_no_se_renueva', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se guardó. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Listo: ese equipo ya no sale en «Por renovar».' }
}

/**
 * SSOMA dice que lo que queda por asignar de una salida no se reparte por persona
 * (un consumible del área, algo para una visita). Mismo permiso que `ssoma_epp_salida_sin_reparto`.
 */
export async function eppSalidaSinReparto(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Qué se reparte del EPP lo lleva SSOMA.' }
  const analisis = z
    .object({
      movimiento_id: z.guid(),
      motivo: z.string().min(5, 'Cuenta por qué no va por persona, en al menos 5 caracteres.').max(300, 'El motivo pasa de 300 caracteres.'),
    })
    .safeParse({ movimiento_id: formulario.get('movimiento_id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_epp_salida_sin_reparto', { p_movimiento: analisis.data.movimiento_id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se guardó. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Listo: lo que queda de esa salida ya no espera reparto.' }
}

/** SSOMA deshace «no va por persona»: la salida vuelve a esperar su reparto. Mismo permiso que `ssoma_epp_salida_se_reparte`. */
export async function eppSalidaSeReparte(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ssoma.gestionar')) return { ok: false, error: 'Qué se reparte del EPP lo lleva SSOMA.' }
  const analisis = z.object({ movimiento_id: z.guid() }).safeParse({ movimiento_id: formulario.get('movimiento_id') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_epp_salida_se_reparte', { p_movimiento: analisis.data.movimiento_id })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.movimiento_id) return { ok: false, error: 'No se guardó. Recarga la pantalla.' }

  revalidatePath('/ssoma', 'layout')
  return { ok: true, mensaje: 'Listo: esa salida vuelve a esperar que anotes a quién le tocó.' }
}
