'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { aQuienLlego, MAXIMO_FOTOS_CALIDAD, RESULTADOS_INSPECCION, TIPOS_PASO_CALIDAD } from '@/lib/dominio/calidad'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * Lo que viaja como JSON en un campo del formulario. Si el campo vino y no se
 * puede leer, `undefined`, y la validación lo rechaza: tomarlo como «sin fotos»
 * registraba y dejaba sueltas las que ya había subido.
 */
function json(formulario: FormData, nombre: string): unknown {
  if (!formulario.has(nombre)) return []
  try {
    return JSON.parse(dato(formulario, nombre))
  } catch {
    return undefined
  }
}

const FOTOS = z
  .array(z.string().min(1).max(300), 'Vuelve a elegir las fotos.')
  .max(MAXIMO_FOTOS_CALIDAD, `Van hasta ${MAXIMO_FOTOS_CALIDAD} fotos.`)

/**
 * Calidad registra la inspección de una etapa de un código interno. Pide
 * `calidad.inspeccionar`, el mismo permiso que exige `calidad_inspeccionar`.
 *
 * No lleva `redirect()`: anota fotos que el navegador ya subió, y la ventana
 * decide qué hacer con ellas según lo que conteste.
 */
export async function registrarInspeccion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'calidad.inspeccionar')) return { ok: false, error: 'Las inspecciones las registra Calidad.' }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      codigo: z.string().min(2, 'Elige el código interno.').max(60, 'Elige el código interno de la lista.'),
      etapa_id: z.union([z.literal(''), z.guid('Vuelve a elegir la etapa.')]),
      area_id: z.union([z.literal(''), z.guid('Vuelve a elegir el área.')]),
      resultado: z.enum(RESULTADOS_INSPECCION, { message: 'Marca si está conforme o no conforme.' }),
      observacion: z.string().max(2000, 'La observación pasa de 2000 caracteres: acórtala.'),
      fotos: FOTOS,
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      codigo: dato(formulario, 'codigo'),
      etapa_id: dato(formulario, 'etapa_id'),
      area_id: dato(formulario, 'area_id'),
      resultado: dato(formulario, 'resultado'),
      observacion: dato(formulario, 'observacion'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la inspección.' }
  const d = analisis.data
  if (d.resultado === 'NO_CONFORME' && d.observacion.length < 10) {
    return { ok: false, error: 'Escribe qué está no conforme, en al menos 10 caracteres: es lo que el área va a corregir.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('calidad_inspeccionar', {
    p_id: d.operacion_id,
    p_codigo: d.codigo,
    p_etapa: d.etapa_id || null,
    p_area: d.area_id || null,
    p_resultado: d.resultado,
    p_observacion: d.observacion || null,
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  const fila = data?.[0]
  if (!fila?.inspeccion || fila.inspeccion !== d.operacion_id) {
    return { ok: false, error: 'La inspección no quedó registrada. Recarga la pantalla.' }
  }

  revalidatePath('/calidad', 'layout')
  const area = await nombreDelArea(d.operacion_id)
  return {
    ok: true,
    mensaje:
      d.resultado === 'CONFORME'
        ? `Inspección de ${d.codigo.toUpperCase()} registrada: conforme.`
        : `Observación de ${d.codigo.toUpperCase()} registrada. ${aQuienLlego(fila.avisado, area)}`,
    datos: { id: fila.inspeccion },
  }
}

async function nombreDelArea(inspeccion: string) {
  const supabase = await createClient()
  const { data } = await supabase.rpc('calidad_inspecciones_visibles', { p_id: inspeccion })
  return data?.[0]?.area ?? 'el área'
}

/**
 * Un paso de la observación: el área la marca corregida; Calidad la levanta o la
 * vuelve a observar. Quién puede qué lo decide `calidad_registrar_paso` (el
 * área por ser del área, no por un permiso); aquí se pide lo mismo para
 * levantar o volver a observar: `calidad.inspeccionar`.
 */
export async function registrarPasoDeCalidad(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ estado: string }>> {
  const perfil = await exigirSesion()

  const analisis = z
    .object({
      operacion_id: z.guid(),
      inspeccion_id: z.guid('Vuelve a cargar la pantalla.'),
      tipo: z.enum(TIPOS_PASO_CALIDAD, { message: 'Vuelve a cargar la pantalla.' }),
      nota: z.string().max(1000, 'La nota pasa de 1000 caracteres: acórtala.'),
      fotos: FOTOS,
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      inspeccion_id: dato(formulario, 'inspeccion_id'),
      tipo: dato(formulario, 'tipo'),
      nota: dato(formulario, 'nota'),
      fotos: json(formulario, 'fotos'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa lo que escribiste.' }
  const d = analisis.data
  if (d.tipo !== 'CORREGIDA' && !puede(perfil, 'calidad.inspeccionar')) {
    return { ok: false, error: 'Solo Calidad levanta o vuelve a observar.' }
  }
  if (d.tipo === 'CORREGIDA' && !d.nota && d.fotos.length === 0) {
    return { ok: false, error: 'Cuenta qué se corrigió o pon una foto: Calidad la revisa con eso.' }
  }
  if (d.tipo === 'OBSERVADA_DE_NUEVO' && d.nota.length < 10) {
    return { ok: false, error: 'Escribe qué sigue mal, en al menos 10 caracteres.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('calidad_registrar_paso', {
    p_id: d.operacion_id,
    p_inspeccion: d.inspeccion_id,
    p_tipo: d.tipo,
    p_nota: d.nota || null,
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  const fila = data?.[0]
  if (!fila?.paso || fila.paso !== d.operacion_id || !fila.estado) {
    return { ok: false, error: 'No quedó registrado. Recarga la pantalla.' }
  }

  revalidatePath('/calidad', 'layout')
  const area = d.tipo === 'CORREGIDA' ? '' : await nombreDelArea(d.inspeccion_id)
  const hecho =
    d.tipo === 'CORREGIDA' ? 'Corrección registrada.' : d.tipo === 'LEVANTADA' ? 'Observación levantada.' : 'Observación devuelta al área.'
  return { ok: true, mensaje: `${hecho} ${aQuienLlego(fila.avisado, area)}`, datos: { estado: fila.estado } }
}

/** Calidad anula una inspección con su motivo; no se borra. Mismo permiso que `calidad_anular_inspeccion`. */
export async function anularInspeccion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'calidad.inspeccionar')) return { ok: false, error: 'Una inspección la anula Calidad.' }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('calidad_anular_inspeccion', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La inspección no se anuló. Recarga la pantalla.' }

  revalidatePath('/calidad', 'layout')
  return { ok: true, mensaje: 'Inspección anulada. Queda con su motivo.' }
}
