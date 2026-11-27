'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { cambiosDelFormulario, datosDeCorreccion } from '@/lib/correccion-accion'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { CODIGO_DEL_GASTO_OPERATIVO } from '@/lib/dominio/requerimientos'
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
 * El permiso de cada requerimiento, el mismo que exige `rq_exigir_del_area`
 * en la base para registrarlo y anularlo: el de operación, `requerimientos.emitir`
 * para cualquier área o `requerimientos.area` para la propia; el de
 * Administración, `requerimientos.administracion`.
 */
const PERMISO_DEL_TIPO = {
  // El supervisor (`requerimientos.area`) registra el de su propia área: la base
  // (`rq_exigir_del_area`) le niega el área que no es la suya.
  OPERACION: {
    permiso: ['requerimientos.emitir', 'requerimientos.area'],
    quien: 'No tienes permiso para registrar requerimientos de operación.',
  },
  ADMINISTRACION: { permiso: ['requerimientos.administracion'], quien: 'No tienes permiso para registrar requerimientos de Administración.' },
} as const satisfies Record<string, { permiso: readonly string[]; quien: string }>

/**
 * El requerimiento (RQ o RQA) que se registra y le llega primero a Almacén.
 * Exige el permiso de su tipo, el mismo que `emitir_requerimiento`.
 */
export async function emitirRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const tipo = z.enum(['OPERACION', 'ADMINISTRACION']).safeParse(dato(formulario, 'tipo'))
  if (!tipo.success) return { ok: false, error: 'Elige si el requerimiento es de operación o de Administración.' }
  const delTipo = PERMISO_DEL_TIPO[tipo.data]
  if (!puede(perfil, [...delTipo.permiso])) return { ok: false, error: delTipo.quien }

  const cabecera = z
    .object({
      operacion_id: z.guid(),
      area_id: z.guid('Elige el área que necesita los insumos.'),
      codigo_interno: z
        .string()
        .trim()
        .min(2, 'Elige el código interno de la unidad. Si es para el área, elige «Para el área (gasto operativo)»; si es para la oficina, OFICINA.')
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

  // El del área (gasto operativo) va con PLANTA y la base lo marca: lo que sale
  // del almacén para él va a PLANTA, no a una unidad ni a una OT.
  const paraElArea = tipo.data === 'OPERACION' && dato(formulario, 'para') === 'AREA'
  if (paraElArea && cabecera.data.codigo_interno !== CODIGO_DEL_GASTO_OPERATIVO) {
    return { ok: false, error: 'Lo que es para el área va con PLANTA: vuelve a abrir el formulario.' }
  }
  const supabase = await createClient()
  const comun = {
    p_id: cabecera.data.operacion_id,
    p_area_id: cabecera.data.area_id,
    p_justificacion: cabecera.data.justificacion,
    p_fecha_requerida: cabecera.data.fecha_requerida ?? null,
    p_lineas: lineas.data,
  }
  const { data, error } = paraElArea
    ? await supabase.rpc('emitir_requerimiento_del_area', comun)
    : await supabase.rpc('emitir_requerimiento', { ...comun, p_tipo: tipo.data, p_codigo_interno: cabecera.data.codigo_interno })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== cabecera.data.operacion_id) return { ok: false, error: 'El requerimiento no quedó registrado. Recarga la pantalla.' }

  const [{ data: emitido }, { data: metrado, error: sinMetrado }] = await Promise.all([
    supabase.from('requerimientos').select('numero').eq('id', cabecera.data.operacion_id).maybeSingle(),
    // Lo que se pasa del metrado de Diseño espera su sustento antes de que Almacén lo revise.
    supabase.rpc('metrado_de_requerimientos', { p_requerimientos: [cabecera.data.operacion_id] }),
  ])
  const sePasan = (metrado ?? []).filter((m) => m.estado === 'SIN_SUSTENTO').map((m) => m.item)

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/unidades')
  revalidatePath('/requerimientos/atencion')
  const numero = emitido?.numero ?? ''
  // Ya quedó registrado: sin el metrado no se sabe si Almacén lo revisa ya o espera el sustento.
  if (sinMetrado) {
    return {
      ok: true,
      mensaje: `Requerimiento ${numero} registrado. Mira su tarjeta: si algún insumo se pasa del metrado de Diseño, ahí te pide el sustento.`,
    }
  }
  if (sePasan.length > 0) {
    const cuales = sePasan.length === 1 ? `El insumo ${sePasan[0]} se pasa` : `Los insumos ${sePasan.slice(0, -1).join(', ')} y ${sePasan.at(-1)} se pasan`
    return {
      ok: true,
      mensaje: `Requerimiento ${numero} registrado. ${cuales} del metrado de Diseño: escribe por qué en su tarjeta, con «Escribir el sustento». Almacén lo revisa cuando Diseño lo autorice.`,
    }
  }
  return { ok: true, mensaje: `Requerimiento ${numero} registrado. Ya le llegó a Almacén para revisar el stock.` }
}

/**
 * Anular mientras nadie lo compra. Lo anula quien lleva su tipo, o el
 * supervisor el que registró él: la base (`anular_requerimiento` →
 * `rq_exigir_del_area`) mira el tipo, el área y quién lo registró.
 */
export async function anularRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.area'])) {
    return { ok: false, error: 'No tienes permiso para anular requerimientos.' }
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
  revalidatePath('/requerimientos/unidades')
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
 * justificante. Lo corrige quien lleva su tipo, o el supervisor el que
 * registró él, igual que en la base (`corregir_requerimiento` →
 * `rq_exigir_del_area`). El aviso le llega a Almacén si el
 * RQ sigue por revisar y, si no, a quien hace su compra: el mensaje lo dice
 * igual que la base (`corregir_requerimiento` → `fn_rq_avisar`).
 */
export async function corregirRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.area'])) {
    return { ok: false, error: 'No tienes permiso para corregir requerimientos.' }
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
  revalidatePath('/requerimientos/unidades')
  revalidatePath('/requerimientos/atencion')
  // Corregir no cambia el estado: el de ahora es el que eligió a quién avisar
  // (corregir_requerimiento: por revisar o listo, Almacén; si no, quien compra).
  // El RQA en compra avisa a la administradora, que es quien lo corrige: no se dice.
  const [{ data: rq }, { data: metrado }] = await Promise.all([
    supabase.from('requerimientos').select('estado, tipo, codigo_interno').eq('id', id.data).maybeSingle(),
    // Si pasó a otro código, el visto de Diseño era para el de antes
    // (migración 20261126920000): lo que se pasa del metrado nuevo se sustenta otra vez.
    supabase.rpc('metrado_de_requerimientos', { p_requerimientos: [id.data] }),
  ])
  const aviso =
    rq?.estado === 'POR_ATENDER' || rq?.estado === 'LISTO_EN_ALMACEN' ? ' A Almacén le llegó el aviso.' : rq && rq.tipo !== 'ADMINISTRACION' ? ' A Logística le llegó el aviso.' : ''
  const sePasan = (metrado ?? []).filter((m) => m.estado === 'SIN_SUSTENTO').map((m) => m.item)
  if (sePasan.length > 0) {
    const cuales = sePasan.length === 1 ? `El insumo ${sePasan[0]} se pasa` : `Los insumos ${sePasan.slice(0, -1).join(', ')} y ${sePasan.at(-1)} se pasan`
    return {
      ok: true,
      mensaje: `Requerimiento corregido, con su justificante.${aviso} ${cuales} del metrado de Diseño para ${rq?.codigo_interno ?? 'su código'} y no ${sePasan.length === 1 ? 'tiene' : 'tienen'} su visto: escribe por qué en su tarjeta, con «Escribir el sustento». No sale del almacén hasta que Diseño lo autorice.`,
    }
  }
  return { ok: true, mensaje: `Requerimiento corregido, con su justificante.${aviso}` }
}

const CONFORMIDAD = z
  .object({
    id: z.guid('Vuelve a cargar la pantalla.'),
    movimiento: z.guid('Vuelve a cargar la pantalla.'),
    tipo: z.enum(['NO_LLEGO', 'LLEGO_INCOMPLETO'], { message: 'Elige si no llegó o si llegó incompleto.' }),
    recibido: z.union([z.literal(''), z.coerce.number({ message: 'Indica cuánto llegó.' }).positive('Indica cuánto llegó: más que cero.')]),
    nota: z.string().trim().min(10, 'Cuenta qué pasó en al menos 10 caracteres.').max(500, 'La nota pasa de 500 caracteres.'),
  })
  .refine((d) => d.tipo === 'NO_LLEGO' || d.recibido !== '', { message: 'Indica cuánto llegó.', path: ['recibido'] })

/**
 * Quien pidió el RQ anota que una salida no le llegó, o llegó incompleta
 * (plan 2, entrega 2.2). La salida del kardex no se toca: la nota es una fila
 * aparte. Quién puede, lo decide la base (`anotar_conformidad_salida`): quien
 * registró el RQ, Requerimientos, el supervisor del área o Administración en lo
 * suyo, nunca Almacén.
 */
export async function anotarConformidad(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['requerimientos.emitir', 'requerimientos.administracion', 'requerimientos.area'])) {
    return { ok: false, error: 'La conformidad de una salida la anota quien pidió el requerimiento.' }
  }
  const analisis = CONFORMIDAD.safeParse({
    id: formulario.get('id'),
    movimiento: formulario.get('movimiento'),
    tipo: formulario.get('tipo'),
    recibido: dato(formulario, 'recibido').trim(),
    nota: dato(formulario, 'nota'),
  })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anotar_conformidad_salida', {
    p_id: d.id,
    p_movimiento: d.movimiento,
    p_tipo: d.tipo,
    p_cantidad_recibida: d.tipo === 'LLEGO_INCOMPLETO' && d.recibido !== '' ? d.recibido : null,
    p_nota: d.nota,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La nota no quedó anotada. Recarga la pantalla.' }

  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  return { ok: true, mensaje: 'Anotado. Almacén recibió el aviso.' }
}
