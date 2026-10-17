'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { MONTO, normalizarMonto, SALDO } from '@/lib/dominio/caja'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * La caja diaria de Tesorería (migración 20261017200000). Todas exigen
 * `tesoreria.caja`, el mismo permiso que piden las funciones de la base, y
 * comprueban que la base devolvió el id que se le mandó: un cero filas no
 * pasa por «listo».
 */

const NO_LLEVA = 'La caja diaria la lleva Tesorería.'
const RUTA = '/tesoreria/caja-diaria'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/** El monto como lo escribió la persona, con su coma o su punto (`normalizarMonto`). */
function montoEscrito(formulario: FormData, nombre: string) {
  return normalizarMonto(dato(formulario, nombre))
}

function primerError(e: z.ZodError, porDefecto: string) {
  return e.issues[0]?.message ?? porDefecto
}

async function permitido() {
  const perfil = await exigirSesion()
  return puede(perfil, 'tesoreria.caja')
}

/** Da de alta o corrige una cuenta. Mismo permiso que `guardar_caja`. */
export async function guardarCuenta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_LLEVA }
  const analisis = z
    .object({
      id: z.guid(),
      nombre: z.string().min(2, 'Ponle un nombre a la cuenta: «BCP soles», «Caja chica».').max(60, 'El nombre pasa de 60 caracteres.'),
      tipo: z.enum(['BANCO', 'EFECTIVO'], 'Elige si la cuenta es de un banco o en efectivo.'),
      banco: z.string().max(40, 'El nombre del banco pasa de 40 caracteres.'),
      moneda: z.enum(['PEN', 'USD'], 'Elige la moneda de la cuenta.'),
      saldo_inicial: z.string().regex(SALDO, 'Escribe el saldo inicial con números, como 25000.00.'),
      fecha_inicio: z.iso.date('Elige el día de ese saldo inicial.'),
      activa: z.boolean(),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      nombre: dato(formulario, 'nombre'),
      tipo: dato(formulario, 'tipo'),
      banco: dato(formulario, 'banco'),
      moneda: dato(formulario, 'moneda'),
      saldo_inicial: montoEscrito(formulario, 'saldo_inicial'),
      fecha_inicio: dato(formulario, 'fecha_inicio'),
      activa: formulario.get('activa') !== 'no',
    })
  if (!analisis.success) return { ok: false, error: primerError(analisis.error, 'Revisa los datos de la cuenta.') }
  const d = analisis.data
  if (d.tipo === 'BANCO' && d.banco.length < 2) return { ok: false, error: 'Escribe el banco de la cuenta: BCP, BBVA…' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('guardar_caja', {
    p_id: d.id,
    p_nombre: d.nombre,
    p_tipo: d.tipo,
    p_banco: d.tipo === 'BANCO' ? d.banco : null,
    p_moneda: d.moneda,
    p_saldo_inicial: Number(d.saldo_inicial),
    p_fecha_inicio: d.fecha_inicio,
    p_activa: d.activa,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La cuenta no quedó guardada. Recarga la pantalla.' }

  revalidatePath(RUTA)
  return { ok: true, mensaje: 'Cuenta guardada.' }
}

/** Registra un ingreso o un egreso del día. Mismo permiso que `registrar_movimiento_caja`. */
export async function registrarMovimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_LLEVA }
  const analisis = z
    .object({
      id: z.guid(),
      caja_id: z.guid('Elige la cuenta.'),
      fecha: z.iso.date('Vuelve a cargar el día.'),
      tipo: z.enum(['INGRESO', 'EGRESO'], 'Elige si es un ingreso o un egreso.'),
      monto: z.string().regex(MONTO, 'Escribe el monto con números, como 1250.50.'),
      descripcion: z.string().min(3, 'Describe el movimiento como en el estado de cuenta.').max(300, 'La descripción pasa de 300 caracteres.'),
      codigo_interno: z.string().max(60, 'El código interno pasa de 60 caracteres.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      tipo_cambio: z.string().regex(/^(\d{1,2}(\.\d{1,4})?)?$/, 'El tipo de cambio va en soles por dólar, como 3.750.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      caja_id: dato(formulario, 'caja_id'),
      fecha: dato(formulario, 'fecha'),
      tipo: dato(formulario, 'tipo'),
      monto: montoEscrito(formulario, 'monto'),
      descripcion: dato(formulario, 'descripcion'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      operacion: dato(formulario, 'operacion'),
      tipo_cambio: montoEscrito(formulario, 'tipo_cambio'),
    })
  if (!analisis.success) return { ok: false, error: primerError(analisis.error, 'Revisa el movimiento.') }
  const d = analisis.data
  if (Number(d.monto) <= 0) return { ok: false, error: 'El monto va mayor que cero.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_movimiento_caja', {
    p_id: d.id,
    p_caja_id: d.caja_id,
    p_fecha: d.fecha,
    p_tipo: d.tipo,
    p_monto: Number(d.monto),
    p_descripcion: d.descripcion,
    p_codigo_interno: d.codigo_interno || null,
    p_operacion: d.operacion || null,
    p_tipo_cambio: d.tipo_cambio ? Number(d.tipo_cambio) : null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El movimiento no quedó registrado. Recarga la pantalla.' }

  revalidatePath(RUTA)
  return { ok: true, mensaje: d.tipo === 'INGRESO' ? 'Ingreso registrado.' : 'Egreso registrado.' }
}

/** Pasa dinero de una cuenta a otra el mismo día. Mismo permiso que `registrar_transferencia_caja`. */
export async function registrarTransferencia(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_LLEVA }
  const analisis = z
    .object({
      id: z.guid(),
      origen: z.guid('Elige la cuenta de la que sale.'),
      destino: z.guid('Elige la cuenta a la que entra.'),
      fecha: z.iso.date('Vuelve a cargar el día.'),
      monto: z.string().regex(MONTO, 'Escribe lo que sale con números, como 1000.'),
      monto_destino: z.string().regex(/^(\d{1,9}(\.\d{1,2})?)?$/, 'Escribe lo que entra con números, como 266.67.'),
      descripcion: z.string().max(300, 'La descripción pasa de 300 caracteres.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      origen: dato(formulario, 'origen'),
      destino: dato(formulario, 'destino'),
      fecha: dato(formulario, 'fecha'),
      monto: montoEscrito(formulario, 'monto'),
      monto_destino: montoEscrito(formulario, 'monto_destino'),
      descripcion: dato(formulario, 'descripcion'),
      operacion: dato(formulario, 'operacion'),
    })
  if (!analisis.success) return { ok: false, error: primerError(analisis.error, 'Revisa la transferencia.') }
  const d = analisis.data
  if (d.origen === d.destino) return { ok: false, error: 'La cuenta a la que entra tiene que ser otra.' }
  if (Number(d.monto) <= 0) return { ok: false, error: 'El monto va mayor que cero.' }
  if (d.descripcion && d.descripcion.length < 3) return { ok: false, error: 'La descripción va de 3 a 300 caracteres, o déjala vacía.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_transferencia_caja', {
    p_id: d.id,
    p_origen: d.origen,
    p_destino: d.destino,
    p_fecha: d.fecha,
    p_monto: Number(d.monto),
    p_monto_destino: d.monto_destino ? Number(d.monto_destino) : null,
    p_descripcion: d.descripcion || null,
    p_operacion: d.operacion || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La transferencia no quedó registrada. Recarga la pantalla.' }

  revalidatePath(RUTA)
  return { ok: true, mensaje: 'Transferencia registrada en las dos cuentas.' }
}

const conMotivo = (accion: string) =>
  z.object({
    id: z.guid(),
    motivo: z.string().min(10, `Cuenta por qué se ${accion}, en al menos 10 caracteres.`).max(500, 'El motivo pasa de 500 caracteres.'),
  })

/** Anula un movimiento, o una transferencia entera. Mismo permiso que `anular_movimiento_caja`. */
export async function anularMovimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_LLEVA }
  const analisis = conMotivo('anula').safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: primerError(analisis.error, 'Vuelve a cargar la pantalla.') }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_movimiento_caja', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El movimiento no se anuló. Recarga la pantalla.' }

  revalidatePath(RUTA)
  return { ok: true, mensaje: 'Movimiento anulado: queda con su motivo.' }
}

/** Cierra el día de una cuenta contra su estado de cuenta. Mismo permiso que `cerrar_dia_caja`. */
export async function cerrarDia(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_LLEVA }
  const analisis = z
    .object({
      id: z.guid(),
      caja_id: z.guid(),
      fecha: z.iso.date('Vuelve a cargar el día.'),
      saldo_banco: z.string().regex(SALDO, 'Escribe el saldo del estado de cuenta con números, como 18500.00.'),
      observaciones: z.string().max(500, 'Las observaciones pasan de 500 caracteres.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      caja_id: dato(formulario, 'caja_id'),
      fecha: dato(formulario, 'fecha'),
      saldo_banco: montoEscrito(formulario, 'saldo_banco'),
      observaciones: dato(formulario, 'observaciones'),
    })
  if (!analisis.success) return { ok: false, error: primerError(analisis.error, 'Revisa el cierre.') }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cerrar_dia_caja', {
    p_id: d.id,
    p_caja_id: d.caja_id,
    p_fecha: d.fecha,
    p_saldo_banco: Number(d.saldo_banco),
    p_observaciones: d.observaciones || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El día no quedó cerrado. Recarga la pantalla.' }

  revalidatePath(RUTA)
  return { ok: true, mensaje: 'Día cerrado.' }
}

/** Reabre el último cierre de una cuenta. Mismo permiso que `reabrir_dia_caja`. */
export async function reabrirDia(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  if (!(await permitido())) return { ok: false, error: NO_LLEVA }
  const analisis = conMotivo('reabre').safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: primerError(analisis.error, 'Vuelve a cargar la pantalla.') }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reabrir_dia_caja', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El día no se reabrió. Recarga la pantalla.' }

  revalidatePath(RUTA)
  return { ok: true, mensaje: 'Día reabierto: el cierre queda anulado con su motivo.' }
}
