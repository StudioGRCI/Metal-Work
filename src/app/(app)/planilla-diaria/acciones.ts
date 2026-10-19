'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { cajaTrasAnular, cajaTrasElPago, camposDeLaCuenta, leerCuenta, montoDeLaCuenta } from '@/lib/caja-del-pago'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const MOTIVO = z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')
const NO_ARMA = 'La planilla diaria la arma Recursos Humanos.'
const NO_PAGA = 'La planilla diaria la paga Tesorería.'

function repintar(planillaId?: string) {
  revalidatePath('/planilla-diaria')
  if (planillaId) revalidatePath(`/planilla-diaria/${planillaId}`)
  revalidatePath('/tesoreria/caja-diaria')
}

/**
 * RR. HH. arma la planilla con todo lo validado que falta pagar y la manda a
 * Tesorería. Mismo permiso que `enviar_planilla_diaria`
 * (`planilla_diaria.preparar`). El id llega de la pantalla: un reintento no
 * arma otra.
 */
export async function enviarPlanillaDiaria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'planilla_diaria.preparar')) return { ok: false, error: NO_ARMA }
  const id = z.guid().safeParse(dato(formulario, 'id'))
  if (!id.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('enviar_planilla_diaria', { p_id: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id.data) return { ok: false, error: 'La planilla no se armó. Recarga la pantalla.' }

  repintar(id.data)
  revalidatePath('/rrhh/horas-extras')
  return { ok: true, mensaje: 'Planilla enviada: Tesorería recibe el aviso para pagarla.', datos: { id: id.data } }
}

/** Anular una planilla sin pagos: sus horas vuelven a esperar la siguiente. Mismo permiso que `anular_planilla_diaria`. */
export async function anularPlanillaDiaria(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'planilla_diaria.preparar')) return { ok: false, error: NO_ARMA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_planilla_diaria', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La planilla no se anuló. Recarga la pantalla.' }

  repintar(analisis.data.id)
  revalidatePath('/rrhh/horas-extras')
  return { ok: true, mensaje: 'Planilla anulada: sus horas vuelven a esperar la siguiente.' }
}

/**
 * Tesorería registra un pago con su comprobante, ya subido a Storage: de una
 * persona o de varias en lote. Mismo permiso que
 * `registrar_pago_planilla_diaria` (`planilla_diaria.pagar`).
 */
export async function registrarPagoPlanilla(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'planilla_diaria.pagar')) return { ok: false, error: NO_PAGA }
  const analisis = z
    .object({
      id: z.guid(),
      planilla_id: z.guid(),
      personas: z.array(z.guid()).min(1, 'Marca a quién le pagaste.'),
      fecha_pago: z.iso.date('Elige el día del pago.'),
      operacion: z.string().max(60, 'El número de operación pasa de 60 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el comprobante.').max(200),
      ...camposDeLaCuenta('pago'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      planilla_id: dato(formulario, 'planilla_id'),
      personas: formulario.getAll('personas').filter((v) => typeof v === 'string'),
      fecha_pago: dato(formulario, 'fecha_pago'),
      operacion: dato(formulario, 'operacion'),
      ruta: dato(formulario, 'ruta'),
      ...leerCuenta(formulario),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pago.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_pago_planilla_diaria', {
    p_id: d.id,
    p_planilla_id: d.planilla_id,
    p_personas: d.personas,
    p_fecha_pago: d.fecha_pago,
    p_operacion: d.operacion || null,
    p_ruta: d.ruta,
    p_caja: d.caja_id,
    p_monto_cuenta: montoDeLaCuenta(d.monto_cuenta),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no quedó registrado. Recarga la pantalla.' }

  const caja = await cajaTrasElPago(supabase, 'PAGO_PLANILLA_DIARIA', d.id, d.caja_id, d.fecha_pago, 'pago')
  repintar(d.planilla_id)
  const pagado = d.personas.length === 1 ? 'Pago registrado con su comprobante.' : `Pago de ${d.personas.length} personas registrado con su comprobante.`
  return { ok: true, mensaje: `${pagado} ${caja}`.trim() }
}

/** Anular un pago mal registrado: su gente vuelve a quedar por pagar. Mismo permiso que `anular_pago_planilla_diaria`. */
export async function anularPagoPlanilla(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'planilla_diaria.pagar')) return { ok: false, error: NO_PAGA }
  const analisis = z
    .object({ id: z.guid(), planilla_id: z.guid(), motivo: MOTIVO })
    .safeParse({ id: dato(formulario, 'id'), planilla_id: dato(formulario, 'planilla_id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_pago_planilla_diaria', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }

  const caja = await cajaTrasAnular(supabase, 'PAGO_PLANILLA_DIARIA', analisis.data.id, 'pago')
  repintar(analisis.data.planilla_id)
  return { ok: true, mensaje: `Pago anulado: esas personas vuelven a quedar por pagar. ${caja}`.trim() }
}

/** Tesorería adjunta la boleta de pago de una persona, ya subida a Storage. Mismo permiso que `subir_boleta_planilla_diaria`. */
export async function subirBoletaPlanilla(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'planilla_diaria.pagar')) return { ok: false, error: 'La boleta la adjunta Tesorería.' }
  const analisis = z
    .object({ persona_id: z.guid(), planilla_id: z.guid(), ruta: z.string().min(1, 'Adjunta la boleta.').max(200) })
    .safeParse({ persona_id: dato(formulario, 'persona_id'), planilla_id: dato(formulario, 'planilla_id'), ruta: dato(formulario, 'ruta') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('subir_boleta_planilla_diaria', { p_persona_id: analisis.data.persona_id, p_ruta: analisis.data.ruta })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.persona_id) return { ok: false, error: 'La boleta no quedó adjunta. Recarga la pantalla.' }

  repintar(analisis.data.planilla_id)
  return { ok: true, mensaje: 'Boleta adjunta: Recursos Humanos la entrega.' }
}

/** RR. HH. marca que entregó la boleta. Mismo permiso que `entregar_boleta_planilla_diaria`. */
export async function entregarBoletaPlanilla(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'planilla_diaria.preparar')) return { ok: false, error: 'Las boletas las entrega Recursos Humanos.' }
  const analisis = z
    .object({ persona_id: z.guid(), planilla_id: z.guid() })
    .safeParse({ persona_id: dato(formulario, 'persona_id'), planilla_id: dato(formulario, 'planilla_id') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('entregar_boleta_planilla_diaria', { p_persona_id: analisis.data.persona_id })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.persona_id) return { ok: false, error: 'No quedó marcada. Recarga la pantalla.' }

  repintar(analisis.data.planilla_id)
  return { ok: true, mensaje: 'Boleta entregada.' }
}
