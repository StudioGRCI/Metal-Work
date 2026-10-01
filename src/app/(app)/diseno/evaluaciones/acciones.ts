'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ResultadoAccion, mensajeDeError, NO_TOCO_NADA } from '@/lib/acciones'
import { CRITERIOS_DISENO, puntajeDiseno } from '@/lib/dominio/evaluacion-diseno'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const RUTA = '/diseno/evaluaciones'

/**
 * Las reglas viven en la base (migración 20261001190000): quién escribe, en qué
 * estado y qué transición le toca a cada uno. Aquí se valida la entrada y se
 * pide el mismo permiso que acepta la política de `diseno_evaluaciones`:
 * `diseno.evaluar` para escribir, enviar y borrar el borrador;
 * `administracion.recibir_evaluacion` para recibir o devolver.
 */
const DatosEvaluacion = z.object({
  id: z.string().uuid(),
  nueva: z.enum(['si', 'no']),
  evaluado_nombre: z.string().trim().min(2).max(120),
  puesto: z.string().trim().min(2).max(100),
  area_servicio: z.string().trim().min(2).max(60),
  evaluador_cargo: z.string().trim().max(100),
  fecha_ingreso: z.union([z.string().regex(/^\d{4}-\d{2}$/), z.literal('')]),
  fecha_evaluacion: z.iso.date(),
  comentarios: z.string().trim().max(3000),
})

export async function guardarEvaluacionDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.evaluar')) {
    return { ok: false, error: 'Solo la jefatura de Diseño e Ingeniería registra evaluaciones.' }
  }
  const entrada = DatosEvaluacion.safeParse(Object.fromEntries(datos))
  if (!entrada.success) {
    return { ok: false, error: 'Completa el nombre de la persona, su puesto, el área y la fecha de la evaluación.' }
  }
  const respuestas = CRITERIOS_DISENO.map((_, i) => Number(datos.get(`puntaje_${i}`)))
  const faltan = respuestas.flatMap((valor, i) => (Number.isInteger(valor) && valor >= 1 && valor <= 5 ? [] : [i + 1]))
  if (faltan.length) {
    return {
      ok: false,
      error: faltan.length === 1 ? `Falta calificar el criterio ${faltan[0]}.` : `Faltan calificar los criterios ${faltan.join(', ')}.`,
    }
  }

  const v = entrada.data
  const fila = {
    evaluado_nombre: v.evaluado_nombre.replace(/\s+/g, ' '),
    puesto: v.puesto,
    area_servicio: v.area_servicio,
    evaluador_cargo: v.evaluador_cargo || null,
    fecha_ingreso: v.fecha_ingreso ? `${v.fecha_ingreso}-01` : null,
    fecha_evaluacion: v.fecha_evaluacion,
    respuestas,
    comentarios: v.comentarios,
  }
  const db = await createClient()
  const { data, error } = v.nueva === 'si'
    ? await db.from('diseno_evaluaciones').insert({ id: v.id, ...fila, evaluador_id: perfil.id }).select('id').maybeSingle()
    : await db.from('diseno_evaluaciones').update(fila).eq('id', v.id).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(RUTA)
  revalidatePath(`${RUTA}/${data.id}`)
  return { ok: true, mensaje: `Evaluación guardada: ${puntajeDiseno(respuestas)} de 100.`, datos: { id: data.id } }
}

const ESTADO_DE_LA_ACCION = { enviar: 'ENVIADA', recibir: 'RECIBIDA', devolver: 'OBSERVADA' } as const

export async function cambiarEstadoEvaluacion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const entrada = z.object({
    id: z.string().uuid(),
    accion: z.enum(['enviar', 'recibir', 'devolver']),
    observacion: z.string().trim().max(1000).optional(),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'No se entendió qué hacer con la evaluación. Vuelve a cargar la pantalla.' }

  const { id, accion, observacion = '' } = entrada.data
  if (accion === 'enviar' && !puede(perfil, 'diseno.evaluar')) {
    return { ok: false, error: 'Solo quien hizo la evaluación la envía a Administración.' }
  }
  if (accion !== 'enviar' && !puede(perfil, 'administracion.recibir_evaluacion')) {
    return { ok: false, error: 'Solo Administración recibe o devuelve las evaluaciones.' }
  }
  if (accion === 'devolver' && observacion.length < 10) {
    return { ok: false, error: 'Explica en al menos 10 caracteres qué hay que corregir.' }
  }

  const estado = ESTADO_DE_LA_ACCION[accion]
  const db = await createClient()
  const { data, error } = await db
    .from('diseno_evaluaciones')
    .update(accion === 'devolver' ? { estado, observacion } : { estado })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(RUTA)
  revalidatePath(`${RUTA}/${id}`)
  const mensaje = {
    enviar: 'Enviada a Administración. Ya no se puede corregir salvo que Administración la devuelva.',
    recibir: 'Evaluación recibida.',
    devolver: 'Devuelta a Diseño con tu observación.',
  }[accion]
  return { ok: true, mensaje }
}

export async function borrarEvaluacionDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.evaluar')) return { ok: false, error: 'Solo quien hizo la evaluación borra su borrador.' }
  const id = z.string().uuid().safeParse(datos.get('id'))
  if (!id.success) return { ok: false, error: 'No se entendió qué evaluación borrar. Vuelve a cargar la pantalla.' }

  const db = await createClient()
  const { data, error } = await db.from('diseno_evaluaciones').delete().eq('id', id.data).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(RUTA)
  return { ok: true, mensaje: 'Borrador eliminado.' }
}
