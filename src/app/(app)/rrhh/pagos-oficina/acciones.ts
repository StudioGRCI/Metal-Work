'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'Los pagos de la oficina los registra Recursos Humanos.'
const FECHA = /^\d{4}-\d{2}-\d{2}$/

function refrescar() {
  revalidatePath('/rrhh/pagos-oficina')
  revalidatePath('/costos/gastos-generales')
  revalidatePath('/codigos-internos/detalle')
}

/** Registra un pago a una persona de la oficina. Mismo permiso que `rrhh_registrar_pago_oficina`. */
export async function registrarPagoOficina(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const soles = (mensaje: string) => z.coerce.number(mensaje).min(0, mensaje).max(100000, 'El monto pasa de S/ 100 000.')
  const analisis = z
    .object({
      id: z.guid(),
      trabajador_id: z.guid('Elige a la persona a quien se le pagó.'),
      desde: z.string().regex(FECHA, 'Pon desde qué día paga.'),
      hasta: z.string().regex(FECHA, 'Pon hasta qué día paga.'),
      monto: soles('Escribe lo que se le pagó, en soles.').positive('Lo que se le pagó va en soles, mayor que cero.'),
      aportes: soles('Los aportes van en soles, desde cero.'),
      nota: z.string().max(200, 'La nota pasa de 200 caracteres.'),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      trabajador_id: dato(formulario, 'trabajador_id'),
      desde: dato(formulario, 'desde'),
      hasta: dato(formulario, 'hasta'),
      monto: dato(formulario, 'monto').replace(/[\s,]/g, ''),
      aportes: dato(formulario, 'aportes').replace(/[\s,]/g, '') || '0',
      nota: dato(formulario, 'nota'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pago.' }
  const d = analisis.data
  if (d.hasta < d.desde) return { ok: false, error: 'El último día no puede ir antes del primero.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_registrar_pago_oficina', {
    p_id: d.id,
    p_trabajador_id: d.trabajador_id,
    p_desde: d.desde,
    p_hasta: d.hasta,
    p_monto: d.monto,
    p_aportes: d.aportes,
    p_nota: d.nota || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El pago no quedó registrado. Recarga la pantalla.' }
  refrescar()
  return { ok: true, mensaje: 'Pago registrado: entra al costeo por los días que cubre.' }
}

/** Anula un pago mal registrado, con motivo. Mismo permiso que `rrhh_anular_pago_oficina`. */
export async function anularPagoOficina(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_anular_pago_oficina', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El pago no se anuló. Recarga la pantalla.' }
  refrescar()
  return { ok: true, mensaje: 'Pago anulado. Queda con su motivo.' }
}
