'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { AMBITOS_TRAMITE, diasDeAvisoDesdeTexto, ESTADOS_QUE_SE_LLEVAN } from '@/lib/dominio/tramites'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * Los trámites (plan «El puesto de Tramitador», entrega 1). Cada acción exige
 * el mismo permiso que la función de la base que llama: si no coinciden, la
 * pantalla diría «listo» sin haber hecho nada.
 */

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Una fecha `AAAA-MM-DD` o vacía. */
const fechaOpcional = (que: string) => z.string().refine((v) => v === '' || FECHA.test(v), `Revisa ${que}.`)

const motivo = (que: string) =>
  z.string().min(10, `Cuenta ${que}, en al menos 10 caracteres.`).max(500, 'El motivo pasa de 500 caracteres.')

/** Lo que el registro y la ficha comparten: qué se tramita, ante quién, su expediente, sus fechas y su nota. */
const CUERPO = {
  asunto: z.string().min(5, 'Escribe qué se tramita, en al menos 5 caracteres.').max(300, 'Lo que se tramita pasa de 300 caracteres.'),
  expediente: z.string().max(60, 'El número de expediente pasa de 60 caracteres.'),
  fecha_inicio: fechaOpcional('la fecha en que se presentó'),
  fecha_limite: fechaOpcional('la fecha límite'),
  nota: z.string().max(1000, 'La nota pasa de 1000 caracteres.'),
}

/**
 * El Tramitador registra un trámite, de una unidad (con su OT, si la tiene) o
 * de la empresa. Mismo permiso que `tramites_registrar`. Sale con su número TR.
 */
export async function registrarTramite(
  _previo: unknown,
  formulario: FormData,
): Promise<ResultadoAccion<{ id: string; numero: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tramites.gestionar')) return { ok: false, error: 'No tienes permiso para registrar trámites.' }

  const analisis = z
    .object({
      id: z.guid(),
      tipo_id: z.guid('Elige el tipo de trámite.'),
      unidad_id: z.union([z.literal(''), z.guid('Elige la unidad de la lista.')]),
      orden_id: z.union([z.literal(''), z.guid('Elige la OT de la lista.')]),
      entidad: z.string().max(80, 'La entidad pasa de 80 caracteres.'),
      ...CUERPO,
    })
    .safeParse({
      id: dato(formulario, 'id'),
      tipo_id: dato(formulario, 'tipo_id'),
      unidad_id: dato(formulario, 'unidad_id'),
      orden_id: dato(formulario, 'orden_id'),
      entidad: dato(formulario, 'entidad'),
      asunto: dato(formulario, 'asunto'),
      expediente: dato(formulario, 'expediente'),
      fecha_inicio: dato(formulario, 'fecha_inicio'),
      fecha_limite: dato(formulario, 'fecha_limite'),
      nota: dato(formulario, 'nota'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el trámite.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('tramites_registrar', {
      p_id: d.id,
      p_tipo: d.tipo_id,
      p_unidad: d.unidad_id || null,
      p_orden: d.orden_id || null,
      p_asunto: d.asunto,
      p_entidad: d.entidad || null,
      p_expediente: d.expediente || null,
      p_fecha_inicio: d.fecha_inicio || null,
      p_fecha_limite: d.fecha_limite || null,
      p_nota: d.nota || null,
    })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data?.tramite || !data.numero_tramite || data.tramite !== d.id) {
    return { ok: false, error: 'El trámite no quedó registrado. Recarga la pantalla.' }
  }

  revalidatePath('/tramites', 'layout')
  return { ok: true, mensaje: `Trámite ${data.numero_tramite} registrado.`, datos: { id: data.tramite, numero: data.numero_tramite } }
}

/**
 * El Tramitador anota en qué va el trámite: por iniciar, en trámite u
 * observado, con su expediente, sus fechas y su nota. Mismo permiso que
 * `tramites_actualizar`.
 */
export async function actualizarTramite(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tramites.gestionar')) return { ok: false, error: 'No tienes permiso para llevar los trámites.' }

  const analisis = z
    .object({
      id: z.guid(),
      estado: z.enum(ESTADOS_QUE_SE_LLEVAN, { message: 'Elige en qué va el trámite.' }),
      entidad: z.string().min(2, 'Escribe ante qué entidad se hace.').max(80, 'La entidad pasa de 80 caracteres.'),
      ...CUERPO,
    })
    .safeParse({
      id: dato(formulario, 'id'),
      estado: dato(formulario, 'estado'),
      entidad: dato(formulario, 'entidad'),
      asunto: dato(formulario, 'asunto'),
      expediente: dato(formulario, 'expediente'),
      fecha_inicio: dato(formulario, 'fecha_inicio'),
      fecha_limite: dato(formulario, 'fecha_limite'),
      nota: dato(formulario, 'nota'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el trámite.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('tramites_actualizar', {
    p_id: d.id,
    p_estado: d.estado,
    p_asunto: d.asunto,
    p_entidad: d.entidad,
    p_expediente: d.expediente || null,
    // «Por iniciar» no lleva la fecha en que se presentó: el campo se esconde y no viaja.
    p_fecha_inicio: d.estado === 'POR_INICIAR' ? null : d.fecha_inicio || null,
    p_fecha_limite: d.fecha_limite || null,
    p_nota: d.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El trámite no se guardó. Recarga la pantalla.' }

  revalidatePath('/tramites', 'layout')
  return { ok: true, mensaje: 'Trámite actualizado.' }
}

/**
 * El Tramitador pide anular el trámite, con su motivo; lo aprueba Gerencia.
 * Mismo permiso que `tramites_pedir_anulacion`.
 */
export async function pedirAnulacion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tramites.gestionar')) return { ok: false, error: 'No tienes permiso para pedir la anulación de un trámite.' }

  const analisis = z
    .object({ id: z.guid(), motivo: motivo('por qué se anula') })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('tramites_pedir_anulacion', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pedido no quedó anotado. Recarga la pantalla.' }

  revalidatePath('/tramites', 'layout')
  return { ok: true, mensaje: 'Pedido enviado: el trámite espera el visto de Gerencia para anularse.' }
}

/**
 * Gerencia responde al pedido de anular un trámite: lo anula, o dice por qué no
 * y el trámite sigue. Mismo permiso que `tramites_resolver_anulacion`. Manda
 * el pedido que la ficha tenía a la vista (`pedido`, su hora): si entre tanto
 * se volvió a pedir con otro motivo, la base no responde por ella.
 */
export async function resolverAnulacion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tramites.aprobar_anulacion')) return { ok: false, error: 'No tienes permiso para aprobar la anulación de un trámite.' }

  const aprobar = dato(formulario, 'respuesta') === 'aprobar'
  const analisis = z
    .object({
      id: z.guid(),
      motivo: aprobar ? z.string().max(500) : motivo('por qué no se anula'),
      // La hora del pedido, como la entregó la base: se devuelve tal cual.
      pedido: z.string().regex(/^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)$/, 'Recarga la ficha del trámite y lee el pedido antes de responder.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo'), pedido: dato(formulario, 'pedido') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('tramites_resolver_anulacion', {
      p_id: analisis.data.id,
      p_aprobar: aprobar,
      p_motivo: analisis.data.motivo || null,
      p_pedido: analisis.data.pedido,
    })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.tramite !== analisis.data.id || data.anulado !== aprobar) return { ok: false, error: 'La respuesta no quedó anotada. Recarga la pantalla.' }

  revalidatePath('/tramites', 'layout')
  return {
    ok: true,
    mensaje: aprobar
      ? 'Trámite anulado. Queda con su motivo, y le avisamos a quien lo pidió.'
      : 'Anulación no aprobada: el trámite sigue como estaba, y le avisamos a quien lo pidió.',
  }
}

/**
 * El Tramitador da de alta un tipo de trámite o lo corrige: nombre, entidad, si
 * es de una unidad o de la empresa, si se renueva, con cuántos días se avisa su
 * vencimiento y si sigue en uso. Mismo permiso que `tramites_guardar_tipo`.
 */
export async function guardarTipo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tramites.gestionar')) return { ok: false, error: 'No tienes permiso para cambiar los tipos de trámite.' }

  const analisis = z
    .object({
      id: z.guid(),
      nombre: z.string().min(3, 'Escribe el nombre del tipo, en al menos 3 caracteres.').max(80, 'El nombre pasa de 80 caracteres.'),
      entidad: z.string().min(2, 'Escribe ante qué entidad se hace.').max(80, 'La entidad pasa de 80 caracteres.'),
      ambito: z.enum(AMBITOS_TRAMITE, { message: 'Elige si es de una unidad o de la empresa.' }),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      nombre: dato(formulario, 'nombre'),
      entidad: dato(formulario, 'entidad'),
      ambito: dato(formulario, 'ambito'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el tipo.' }
  const dias = diasDeAvisoDesdeTexto(dato(formulario, 'dias_aviso'))
  if (!dias) return { ok: false, error: 'Los días de aviso van en números de 0 a 120, de uno a cinco, separados por comas: 30, 15, 7.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('tramites_guardar_tipo', {
      p_id: d.id,
      p_nombre: d.nombre,
      p_entidad: d.entidad,
      p_ambito: d.ambito,
      p_se_renueva: formulario.get('se_renueva') === 'on',
      p_dias_aviso: dias,
      p_activo: formulario.get('activo') === 'on',
      // El tipo nuevo lo dice: su alta repetida no corrige a escondidas.
      p_alta: dato(formulario, 'alta') === '1',
    })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.tipo !== d.id) return { ok: false, error: 'El tipo no se guardó. Recarga la pantalla.' }

  revalidatePath('/tramites', 'layout')
  return { ok: true, mensaje: data.creado ? `Tipo «${d.nombre}» agregado.` : `Tipo «${d.nombre}» guardado.` }
}
