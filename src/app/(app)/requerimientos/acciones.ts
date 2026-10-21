'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { cambiosDelFormulario, datosDeCorreccion } from '@/lib/correccion-accion'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

const CANTIDAD = z.coerce
  .number({ message: 'Indica la cantidad de cada insumo.' })
  .positive('La cantidad de cada insumo debe ser mayor que cero.')
  .max(999999999, 'Una cantidad es demasiado grande.')

/**
 * Cada insumo sale del catálogo de Almacén con su material; el que no está se
 * pide como material nuevo, con su nombre, unidad y categoría, y Almacén lo da
 * de alta al revisarlo. El nombre de un material del catálogo lo pone la base.
 */
const DEL_CATALOGO = z.object({
  material_id: z.guid('Elige cada insumo del catálogo de Almacén.'),
  cantidad: CANTIDAD,
  unidad_medida_id: z.guid('Elige la unidad de cada insumo.').nullish(),
})

const MATERIAL_NUEVO = z.object({
  nuevo: z.literal(true),
  descripcion: z
    .string()
    .trim()
    .min(3, 'Escribe el nombre de cada material nuevo en al menos 3 caracteres.')
    .max(300, 'El nombre de un material nuevo pasa de 300 caracteres.'),
  cantidad: CANTIDAD,
  unidad_medida_id: z.guid('Elige la unidad de cada material nuevo.'),
  categoria_id: z.guid('Elige la categoría de cada material nuevo.'),
})

/** Una unión de zod responde «Invalid input» en inglés: cada insumo se mira con su forma. */
const LINEA = z.custom<unknown>().transform((linea, ctx) => {
  const esNuevo = typeof linea === 'object' && linea !== null && (linea as { nuevo?: unknown }).nuevo === true
  const r = (esNuevo ? MATERIAL_NUEVO : DEL_CATALOGO).safeParse(linea)
  if (!r.success) {
    ctx.addIssue({ code: 'custom', message: r.error.issues[0]?.message ?? 'Revisa los insumos.' })
    return z.NEVER
  }
  return r.data
})

function lineasDelFormulario(formulario: FormData): unknown {
  try {
    return JSON.parse(dato(formulario, 'lineas') || '[]')
  } catch {
    return null
  }
}

/**
 * El permiso de cada requerimiento, el mismo que exige `rq_exigir` en la base
 * para registrarlo y anularlo: el de operación es del área de Requerimientos;
 * el de Administración, de la administradora.
 */
const PERMISO_DEL_TIPO = {
  OPERACION: { permiso: 'requerimientos.emitir', quien: 'El requerimiento de operación lo lleva el área de Requerimientos.' },
  ADMINISTRACION: { permiso: 'requerimientos.administracion', quien: 'El requerimiento de Administración lo lleva la administradora.' },
} as const

/**
 * El requerimiento (RQ o RQA) que se registra y le llega primero a Almacén.
 * Exige el permiso de su tipo, el mismo que `emitir_requerimiento`.
 */
export async function emitirRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const tipo = z.enum(['OPERACION', 'ADMINISTRACION']).safeParse(dato(formulario, 'tipo'))
  if (!tipo.success) return { ok: false, error: 'Elige si el requerimiento es de operación o de Administración.' }
  const delTipo = PERMISO_DEL_TIPO[tipo.data]
  if (!puede(perfil, delTipo.permiso)) return { ok: false, error: delTipo.quien }

  const cabecera = z
    .object({
      operacion_id: z.guid(),
      area_id: z.guid('Elige el área que necesita los insumos.'),
      codigo_interno: z
        .string()
        .trim()
        .min(2, 'Elige el código interno de la unidad. Si no es para una unidad, PLANTA u OFICINA.')
        .max(60, 'El código interno pasa de 60 caracteres.')
        // Como lo guarda el costeo (`normalizar_codigo_interno`): «pla_sr_04» escrito a mano es PLA_SR_04.
        .transform(normalizarCodigo),
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

  const lineas = z
    .array(LINEA, { message: 'Revisa los insumos y vuelve a intentarlo.' })
    .min(1, 'Agrega al menos un insumo.')
    .max(100, 'Un requerimiento lleva hasta 100 insumos. Divídelo en dos.')
    .safeParse(lineasDelFormulario(formulario))
  if (!lineas.success) return { ok: false, error: lineas.error.issues[0]?.message ?? 'Revisa los insumos.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_requerimiento', {
    p_id: cabecera.data.operacion_id,
    p_tipo: tipo.data,
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
  revalidatePath('/requerimientos/atencion')
  return { ok: true, mensaje: `Requerimiento ${emitido?.numero ?? ''} registrado. Ya le llegó a Almacén para revisar el stock.` }
}

/**
 * Anular mientras nadie lo compra. Lo anula quien lleva su tipo: la base
 * (`anular_requerimiento`) mira el tipo del RQ y exige el permiso de ese tipo.
 */
export async function anularRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion'])) {
    return { ok: false, error: 'Los requerimientos los anula quien los registra: Requerimientos o la administradora.' }
  }

  const analisis = z
    .object({
      id: z.guid(),
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
  revalidatePath('/requerimientos/atencion')
  return { ok: true, mensaje: 'Requerimiento anulado. Queda con su número y su motivo.' }
}

const CAMBIOS_RQ = z.object({
  codigo_interno: z
    .string()
    .trim()
    .min(2, 'El código interno va de 2 a 60 caracteres.')
    .max(60, 'El código interno va de 2 a 60 caracteres.')
    .transform(normalizarCodigo)
    .optional(),
  justificacion: z.string().trim().min(10, 'La justificación va de 10 a 1000 caracteres.').max(1000, 'La justificación va de 10 a 1000 caracteres.').optional(),
  fecha_requerida: z.union([z.iso.date({ message: 'Revisa la fecha en que se necesita.' }), z.literal('')]).optional(),
  lineas: z
    .array(
      z.object({
        item: z.number().int().positive(),
        cantidad: CANTIDAD.optional(),
        material_id: z.guid('Elige cada insumo del catálogo de Almacén.').optional(),
      }),
    )
    .max(100)
    .optional(),
})

/**
 * Corregir un requerimiento registrado: el código, la justificación, la fecha y
 * la cantidad o el material de cada insumo, siempre con su motivo y su
 * justificante. Lo corrige quien lleva su tipo, igual que en la base
 * (`corregir_requerimiento` → `rq_exigir`), y a Almacén le llega el aviso.
 */
export async function corregirRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion'])) {
    return { ok: false, error: 'Los requerimientos los corrige quien los registra: Requerimientos o la administradora.' }
  }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció el requerimiento. Vuelve a cargar la pantalla.' }
  const correccion = datosDeCorreccion(formulario)
  if (!correccion.ok) return correccion
  const cambios = CAMBIOS_RQ.safeParse(cambiosDelFormulario(formulario))
  if (!cambios.success) return { ok: false, error: cambios.error.issues[0]?.message ?? 'Revisa lo que corriges.' }

  const supabase = await createClient()
  const c = correccion.datos
  const { data, error } = await supabase.rpc('corregir_requerimiento', {
    p_correccion: c.correccion_id,
    p_id: id.data,
    p_motivo: c.motivo,
    p_justificante: c.justificante_ruta,
    p_nombre: c.justificante_nombre,
    p_cambios: cambios.data,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id.data) return { ok: false, error: 'El requerimiento no se corrigió. Recarga la pantalla.' }

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  return { ok: true, mensaje: 'Requerimiento corregido, con su justificante. A Almacén le llegó el aviso.' }
}
