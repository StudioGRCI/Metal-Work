'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

function todos(formulario: FormData, nombre: string) {
  return formulario.getAll(nombre).map((v) => (typeof v === 'string' ? v : ''))
}

const LINEA = z.object({
  descripcion: z
    .string()
    .trim()
    .min(3, 'Describe cada insumo en al menos 3 caracteres.')
    .max(300, 'La descripción de un insumo pasa de 300 caracteres.'),
  cantidad: z.coerce
    .number({ message: 'Indica la cantidad de cada insumo.' })
    .positive('La cantidad de cada insumo debe ser mayor que cero.')
    .max(999999999, 'Una cantidad es demasiado grande.'),
  unidad_medida_id: z.string().uuid('Elige la unidad de cada insumo.'),
  categoria_id: z.string().uuid('Elige la categoría de cada insumo.'),
})

/**
 * El requerimiento (RQ) que registra Requerimientos y le llega a Logística.
 * Exige `requerimientos.emitir`, el mismo permiso que `emitir_requerimiento`.
 */
export async function emitirRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.emitir')) return { ok: false, error: 'Los requerimientos los registra el área de Requerimientos.' }

  const cabecera = z
    .object({
      operacion_id: z.string().uuid(),
      area_id: z.string().uuid('Elige el área que necesita los insumos.'),
      codigo_interno: z
        .string()
        .trim()
        .min(2, 'Escribe el código interno de la unidad. Si no es para una unidad, escribe PLANTA.')
        .max(60, 'El código interno pasa de 60 caracteres.'),
      justificacion: z
        .string()
        .trim()
        .min(10, 'Explica para qué se necesita, en al menos 10 caracteres.')
        .max(1000, 'La justificación pasa de 1000 caracteres.'),
      fecha_requerida: z.iso.date().optional(),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      area_id: dato(formulario, 'area_id'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      justificacion: dato(formulario, 'justificacion'),
      fecha_requerida: dato(formulario, 'fecha_requerida') || undefined,
    })
  if (!cabecera.success) return { ok: false, error: cabecera.error.issues[0]?.message ?? 'Revisa el requerimiento.' }

  const descripciones = todos(formulario, 'descripcion')
  const cantidades = todos(formulario, 'cantidad')
  const unidades = todos(formulario, 'unidad_medida_id')
  const categorias = todos(formulario, 'categoria_id')
  const lineas = z
    .array(LINEA)
    .min(1, 'Agrega al menos un insumo.')
    .max(100, 'Un requerimiento lleva hasta 100 insumos. Divídelo en dos.')
    .safeParse(
      descripciones.map((descripcion, i) => ({
        descripcion,
        cantidad: cantidades[i] ?? '',
        unidad_medida_id: unidades[i] ?? '',
        categoria_id: categorias[i] ?? '',
      })),
    )
  if (!lineas.success) return { ok: false, error: lineas.error.issues[0]?.message ?? 'Revisa los insumos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_requerimiento', {
    p_id: cabecera.data.operacion_id,
    p_area_id: cabecera.data.area_id,
    p_codigo_interno: cabecera.data.codigo_interno,
    p_justificacion: cabecera.data.justificacion,
    p_fecha_requerida: cabecera.data.fecha_requerida ?? null,
    p_lineas: lineas.data,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== cabecera.data.operacion_id) return { ok: false, error: 'El requerimiento no quedó registrado. Recarga la pantalla.' }

  const { data: emitido } = await supabase.from('requerimientos').select('numero').eq('id', cabecera.data.operacion_id).maybeSingle()

  revalidatePath('/requerimientos')
  return { ok: true, mensaje: `Requerimiento ${emitido?.numero ?? ''} registrado. Ya le llegó a Logística.` }
}

/** Anular mientras Logística no lo empieza. Mismo permiso que `anular_requerimiento`. */
export async function anularRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.emitir')) return { ok: false, error: 'Los requerimientos los anula el área de Requerimientos.' }

  const analisis = z
    .object({
      id: z.string().uuid(),
      motivo: z
        .string()
        .trim()
        .min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.')
        .max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_requerimiento', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El requerimiento no se anuló. Recarga la pantalla.' }

  revalidatePath('/requerimientos')
  return { ok: true, mensaje: 'Requerimiento anulado. Queda con su número y su motivo.' }
}
