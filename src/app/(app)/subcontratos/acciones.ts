'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { CODIGO_INTERNO_LARGO, FALTA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * Lo que hace Administración con los subcontratos (migraciones 20261015221000
 * y 20261017100000, la del área: Producción o Acabados; 20261020160000 suma Maestranza).
 * Todas exigen `subcontratos.gestionar`, el mismo permiso que piden las
 * funciones de la base, y comprueban que la función devolvió el id: si no
 * vuelve, no se hizo, y la pantalla no dice «listo».
 */

const NO_GESTIONA = 'Los subcontratos los lleva Administración.'
const MOTIVO = z.string().trim().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')
const MONTO = z.coerce
  .number({ message: 'Escribe el monto.' })
  .positive('El monto tiene que ser mayor que cero.')
  .max(999999999, 'El monto es demasiado grande.')
  .multipleOf(0.01, 'El monto lleva como máximo dos decimales.')
const CODIGO = z.string().trim().min(2, FALTA_CODIGO_INTERNO).max(60, CODIGO_INTERNO_LARGO)
const AREA = z.enum(['MTZ', 'PRD', 'ACB'], { message: 'Elige para qué área va el subcontrato: Maestranza, Producción o Acabados.' })
const DESCRIPCION = z
  .string()
  .trim()
  .min(10, 'Describe el trabajo en al menos 10 caracteres: qué se hace y en qué parte de la unidad.')
  .max(1000, 'La descripción pasa de 1000 caracteres.')

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

function repintar(subcontratoId?: string) {
  revalidatePath('/subcontratos')
  if (subcontratoId) revalidatePath(`/subcontratos/${subcontratoId}`)
  revalidatePath('/tesoreria/recibos-por-honorarios')
  revalidatePath('/subcontratos/area')
}

async function puedeGestionar() {
  const perfil = await exigirSesion()
  return puede(perfil, 'subcontratos.gestionar')
}

/** Dar de alta o corregir un subcontratista del padrón, o darlo de baja. Mismo permiso que `guardar_subcontratista`. */
export async function guardarSubcontratista(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z
    .object({
      id: z.guid(),
      ruc: z.string().regex(/^[0-9]{11}$/, 'El RUC tiene 11 dígitos.'),
      nombre: z.string().min(2, 'Escribe el nombre completo, como sale en el recibo.').max(160, 'El nombre pasa de 160 caracteres.'),
      telefono: z.string().max(40, 'El teléfono pasa de 40 caracteres.'),
      banco: z.string().max(80, 'El nombre del banco pasa de 80 caracteres.'),
      numero_cuenta: z.string().max(40),
      cci: z.string().max(30),
      activo: z.boolean(),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      ruc: dato(formulario, 'ruc').replace(/\s/g, ''),
      nombre: dato(formulario, 'nombre'),
      telefono: dato(formulario, 'telefono'),
      banco: dato(formulario, 'banco'),
      numero_cuenta: dato(formulario, 'numero_cuenta'),
      cci: dato(formulario, 'cci'),
      activo: dato(formulario, 'activo') !== 'no',
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del subcontratista.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('guardar_subcontratista', {
    p_id: d.id,
    p_ruc: d.ruc,
    p_nombre: d.nombre,
    p_telefono: d.telefono || null,
    p_banco: d.banco || null,
    p_numero_cuenta: d.numero_cuenta || null,
    p_cci: d.cci || null,
    p_activo: d.activo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El subcontratista no quedó guardado. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: d.activo ? 'Subcontratista guardado.' : 'Subcontratista dado de baja: ya no se le registran subcontratos nuevos.', datos: { id: d.id } }
}

/** Registrar un subcontrato: el número SC-… lo pone la base. Mismo permiso que `registrar_subcontrato`. */
export async function registrarSubcontrato(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z
    .object({
      id: z.guid(),
      subcontratista_id: z.guid('Elige el subcontratista del padrón. Si es nuevo, dalo de alta primero.'),
      codigo_interno: CODIGO,
      descripcion: DESCRIPCION,
      area: AREA,
      moneda: z.enum(['PEN', 'USD'], { message: 'Elige la moneda de lo pactado.' }),
      monto: MONTO,
      fecha_inicio: z.iso.date().optional(),
      fecha_fin: z.iso.date().optional(),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      subcontratista_id: dato(formulario, 'subcontratista_id'),
      area: dato(formulario, 'area'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      descripcion: dato(formulario, 'descripcion'),
      moneda: dato(formulario, 'moneda'),
      monto: dato(formulario, 'monto'),
      fecha_inicio: dato(formulario, 'fecha_inicio') || undefined,
      fecha_fin: dato(formulario, 'fecha_fin') || undefined,
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el subcontrato.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_subcontrato', {
    p_id: d.id,
    p_subcontratista_id: d.subcontratista_id,
    p_codigo_interno: d.codigo_interno,
    p_descripcion: d.descripcion,
    p_moneda: d.moneda,
    p_monto: d.monto,
    p_fecha_inicio: d.fecha_inicio ?? null,
    p_fecha_fin: d.fecha_fin ?? null,
    p_area: d.area,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El subcontrato no quedó registrado. Recarga la pantalla.' }

  repintar(d.id)
  return { ok: true, mensaje: 'Subcontrato registrado: ya puedes subir sus recibos por honorarios.', datos: { id: d.id } }
}

/**
 * Corregir el código, el área, el trabajo, lo pactado o las fechas mientras está
 * vigente. Sin área, la que tenía se queda (un subcontrato de antes puede no
 * tenerla todavía). Mismo permiso que `corregir_subcontrato`.
 */
export async function corregirSubcontrato(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z
    .object({
      id: z.guid(),
      codigo_interno: CODIGO,
      area: AREA.optional(),
      descripcion: DESCRIPCION,
      monto: MONTO,
      fecha_inicio: z.iso.date().optional(),
      fecha_fin: z.iso.date().optional(),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      area: dato(formulario, 'area') || undefined,
      descripcion: dato(formulario, 'descripcion'),
      monto: dato(formulario, 'monto'),
      fecha_inicio: dato(formulario, 'fecha_inicio') || undefined,
      fecha_fin: dato(formulario, 'fecha_fin') || undefined,
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el subcontrato.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('corregir_subcontrato', {
    p_id: d.id,
    p_codigo_interno: d.codigo_interno,
    p_descripcion: d.descripcion,
    p_monto: d.monto,
    p_fecha_inicio: d.fecha_inicio ?? null,
    p_fecha_fin: d.fecha_fin ?? null,
    p_area: d.area ?? null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El subcontrato no se corrigió. Recarga la pantalla.' }

  repintar(d.id)
  return { ok: true, mensaje: 'Subcontrato corregido.' }
}

/** Darlo por terminado (ya no recibe recibos) o reabrirlo. Mismo permiso que `cambiar_estado_subcontrato`. */
export async function cambiarEstadoSubcontrato(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z
    .object({ id: z.guid(), estado: z.enum(['VIGENTE', 'TERMINADO']) })
    .safeParse({ id: dato(formulario, 'id'), estado: dato(formulario, 'estado') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cambiar_estado_subcontrato', { p_id: analisis.data.id, p_estado: analisis.data.estado })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No cambió. Recarga la pantalla.' }

  repintar(analisis.data.id)
  return { ok: true, mensaje: analisis.data.estado === 'TERMINADO' ? 'Subcontrato terminado: sus recibos se siguen pagando.' : 'Subcontrato reabierto.' }
}

/** Anular un subcontrato registrado por error, sin recibos vigentes. Mismo permiso que `anular_subcontrato`. */
export async function anularSubcontrato(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_subcontrato', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El subcontrato no se anuló. Recarga la pantalla.' }

  repintar(analisis.data.id)
  return { ok: true, mensaje: 'Subcontrato anulado: queda con su motivo como evidencia.' }
}

/**
 * Registrar un recibo por honorarios con su archivo, ya subido a Storage: a
 * Tesorería le llega el aviso para pagarlo. Mismo permiso que
 * `registrar_recibo_honorarios`. El id llega de la pantalla: un reintento no
 * registra otro.
 */
export async function registrarRecibo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z
    .object({
      id: z.guid(),
      subcontrato_id: z.guid(),
      numero: z.string().regex(/^[A-Z0-9]{1,4}-[0-9]{1,8}$/, 'Escribe el número del recibo como sale en él: la serie, un guion y el número, por ejemplo E001-25.'),
      fecha_emision: z.iso.date('Elige la fecha de emisión del recibo.'),
      concepto: z.string().max(300, 'El concepto pasa de 300 caracteres.'),
      monto_bruto: MONTO,
      retencion: z.boolean(),
      ruta: z.string().min(1, 'Adjunta el recibo.').max(200),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      subcontrato_id: dato(formulario, 'subcontrato_id'),
      numero: dato(formulario, 'numero').replace(/\s/g, '').toUpperCase(),
      fecha_emision: dato(formulario, 'fecha_emision'),
      concepto: dato(formulario, 'concepto'),
      monto_bruto: dato(formulario, 'monto_bruto'),
      retencion: dato(formulario, 'retencion') === 'si',
      ruta: dato(formulario, 'ruta'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el recibo.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_recibo_honorarios', {
    p_id: d.id,
    p_subcontrato_id: d.subcontrato_id,
    p_numero: d.numero,
    p_fecha_emision: d.fecha_emision,
    p_concepto: d.concepto || null,
    p_monto_bruto: d.monto_bruto,
    p_retencion: d.retencion,
    p_ruta: d.ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El recibo no quedó registrado. Recarga la pantalla.' }

  repintar(d.subcontrato_id)
  return { ok: true, mensaje: `Recibo ${d.numero} registrado: Tesorería recibe el aviso para pagarlo.` }
}

/** Anular un recibo mal registrado, mientras Tesorería no lo haya pagado. Mismo permiso que `anular_recibo_honorarios`. */
export async function anularRecibo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await puedeGestionar())) return { ok: false, error: NO_GESTIONA }
  const analisis = z
    .object({ id: z.guid(), subcontrato_id: z.guid(), motivo: MOTIVO })
    .safeParse({ id: dato(formulario, 'id'), subcontrato_id: dato(formulario, 'subcontrato_id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_recibo_honorarios', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El recibo no se anuló. Recarga la pantalla.' }

  repintar(analisis.data.subcontrato_id)
  return { ok: true, mensaje: 'Recibo anulado: queda con su motivo y su archivo como evidencia.' }
}
