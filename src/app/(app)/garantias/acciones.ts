'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { aQuienSeAvisoDelReclamo, CAUSAS_GARANTIA, MAXIMO_FOTOS_GARANTIA } from '@/lib/dominio/garantias'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * El reclamo de garantía (plan «Las demás áreas», A.2). Cada acción exige el
 * mismo permiso que la función de la base que llama: si no coinciden, la
 * pantalla diría «listo» sin haber hecho nada.
 */

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * Lo que viaja como JSON en un campo del formulario. Si el campo vino y no se
 * puede leer, `undefined`, y la validación lo rechaza: tomarlo como «sin fotos»
 * registraba el reclamo y dejaba sueltas las que ya había subido.
 */
function json(formulario: FormData, nombre: string): unknown {
  if (!formulario.has(nombre)) return []
  try {
    return JSON.parse(dato(formulario, nombre))
  } catch {
    return undefined
  }
}

const motivo = (que: string) =>
  z.string().min(10, `Cuenta ${que}, en al menos 10 caracteres.`).max(500, 'El motivo pasa de 500 caracteres.')

/**
 * Ventas registra el reclamo del cliente que vuelve con su unidad: la unidad,
 * qué reclama, quién lo trae y hasta cuatro fotos. Mismo permiso que
 * `garantias_registrar`. No lleva `redirect()`: anota fotos que el navegador ya
 * subió, y la ventana decide qué hacer con ellas según lo que conteste.
 */
export async function registrarReclamo(
  _previo: unknown,
  formulario: FormData,
): Promise<ResultadoAccion<{ id: string; numero: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'garantias.registrar')) return { ok: false, error: 'El reclamo de garantía lo registra Ventas.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      unidad_id: z.guid('Elige la unidad que vuelve.'),
      descripcion: z
        .string()
        .min(10, 'Cuenta qué reclama el cliente, en al menos 10 caracteres.')
        .max(2000, 'Lo que reclama pasa de 2000 caracteres.'),
      trae: z.string().max(120, 'Quién lo trae pasa de 120 caracteres.'),
      contacto: z.string().max(60, 'El contacto pasa de 60 caracteres.'),
      fotos: z
        .array(z.string().min(1).max(300), 'Vuelve a elegir las fotos.')
        .max(MAXIMO_FOTOS_GARANTIA, `Van hasta ${MAXIMO_FOTOS_GARANTIA} fotos por reclamo.`),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      unidad_id: dato(formulario, 'unidad_id'),
      descripcion: dato(formulario, 'descripcion'),
      trae: dato(formulario, 'trae'),
      contacto: dato(formulario, 'contacto'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reclamo.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('garantias_registrar', {
      p_id: d.operacion_id,
      p_unidad: d.unidad_id,
      p_descripcion: d.descripcion,
      p_trae: d.trae || null,
      p_contacto: d.contacto || null,
      p_fotos: d.fotos,
    })
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data?.reclamo || !data.numero_reclamo || data.reclamo !== d.operacion_id) {
    return { ok: false, error: 'El reclamo no quedó registrado. Recarga la pantalla.' }
  }

  revalidatePath('/garantias', 'layout')
  return {
    ok: true,
    mensaje: aQuienSeAvisoDelReclamo(data.numero_reclamo, {
      administracion: data.aviso_administracion === true,
      garantias: data.aviso_garantias === true,
      gerencia: data.aviso_gerencia === true,
    }),
    datos: { id: data.reclamo, numero: data.numero_reclamo },
  }
}

/**
 * «Le avisamos a quien lo registró» solo si es otra persona: la base no se
 * avisa a sí misma (`registrado_por is distinct from` quien actúa).
 */
async function avisoAQuienRegistro(supabase: Awaited<ReturnType<typeof createClient>>, reclamo: string, yo: string, texto: string) {
  const { data } = await supabase.from('garantia_reclamos').select('registrado_por').eq('id', reclamo).maybeSingle()
  return data && data.registrado_por !== yo ? ` ${texto}` : ''
}

/** Administración enlaza al reclamo la OT de garantía de su unidad. Mismo permiso que `garantias_enlazar_ot`. */
export async function enlazarOt(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'garantias.atender')) return { ok: false, error: 'La OT de garantía la enlaza Administración.' }

  const analisis = z
    .object({ id: z.guid(), orden_id: z.guid('Elige la OT de garantía.') })
    .safeParse({ id: dato(formulario, 'id'), orden_id: dato(formulario, 'orden_id') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  // Quién lo registró no cambia nunca: se lee junto con la escritura, no después.
  const [{ data, error }, aviso] = await Promise.all([
    supabase.rpc('garantias_enlazar_ot', { p_reclamo: analisis.data.id, p_orden: analisis.data.orden_id }).maybeSingle(),
    avisoAQuienRegistro(supabase, analisis.data.id, perfil.id, 'Le avisamos a quien registró el reclamo.'),
  ])
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data?.reclamo !== analisis.data.id || !data.numero_ot) return { ok: false, error: 'La OT no se enlazó. Recarga la pantalla.' }

  revalidatePath('/garantias', 'layout')
  return { ok: true, mensaje: `Enlazada la OT ${data.numero_ot}.${aviso}` }
}

/** Administración cierra sin OT el reclamo que no procede, con su motivo. Mismo permiso que `garantias_no_procede`. */
export async function noProcede(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'garantias.atender')) return { ok: false, error: 'Si un reclamo no procede lo dice Administración.' }

  const analisis = z
    .object({ id: z.guid(), motivo: motivo('por qué no procede') })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const [{ data, error }, aviso] = await Promise.all([
    supabase.rpc('garantias_no_procede', { p_reclamo: analisis.data.id, p_motivo: analisis.data.motivo }),
    avisoAQuienRegistro(supabase, analisis.data.id, perfil.id, 'Le avisamos a quien lo registró.'),
  ])
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El reclamo no se cerró. Recarga la pantalla.' }

  revalidatePath('/garantias', 'layout')
  return { ok: true, mensaje: `Cerrado como «No procede», con su motivo.${aviso}` }
}

/** Calidad anota por qué falló, cuando la garantía está terminada, y el reclamo se cierra. Mismo permiso que `garantias_anotar_causa`. */
export async function anotarCausa(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'garantias.causa')) return { ok: false, error: 'La causa del reclamo la anota Calidad.' }

  const analisis = z
    .object({
      id: z.guid(),
      causa: z.enum(CAUSAS_GARANTIA, { message: 'Elige la causa.' }),
      detalle: z.string().min(10, 'Cuenta la causa, en al menos 10 caracteres.').max(1000, 'El detalle pasa de 1000 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), causa: dato(formulario, 'causa'), detalle: dato(formulario, 'detalle') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const [{ data, error }, aviso] = await Promise.all([
    supabase.rpc('garantias_anotar_causa', { p_reclamo: analisis.data.id, p_causa: analisis.data.causa, p_detalle: analisis.data.detalle }),
    avisoAQuienRegistro(supabase, analisis.data.id, perfil.id, 'Le avisamos a quien lo registró.'),
  ])
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La causa no quedó anotada. Recarga la pantalla.' }

  revalidatePath('/garantias', 'layout')
  return { ok: true, mensaje: `Causa anotada: el reclamo quedó cerrado.${aviso}` }
}

/** Ventas o Administración anulan el reclamo que todavía no tiene OT, con su motivo; no se borra. Mismo permiso que `garantias_anular`. */
export async function anularReclamo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['garantias.registrar', 'garantias.atender'])) {
    return { ok: false, error: 'Un reclamo de garantía lo anulan Ventas o Administración.' }
  }

  const analisis = z
    .object({ id: z.guid(), motivo: motivo('por qué se anula') })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('garantias_anular', { p_reclamo: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El reclamo no se anuló. Recarga la pantalla.' }

  revalidatePath('/garantias', 'layout')
  return { ok: true, mensaje: 'Reclamo anulado. Queda con su motivo.' }
}
