'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { TIPOS_CUENTA } from '@/lib/dominio/rrhh'
import { editaComoRrhh, exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const SIN_PERMISO = 'No tienes permiso para cambiar la ficha del personal.'
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Registra o corrige la ficha de una persona. Mismo permiso que `rrhh_guardar_trabajador`. */
export async function guardarTrabajador(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      nombres: z.string().min(2, 'Escribe los nombres.').max(80, 'Los nombres pasan de 80 caracteres.'),
      apellidos: z.string().min(2, 'Escribe los apellidos.').max(80, 'Los apellidos pasan de 80 caracteres.'),
      dni: z.string().regex(/^\d{8}$/, 'El DNI lleva 8 dígitos.'),
      cargo: z.string().max(80, 'El cargo pasa de 80 caracteres.'),
      area_id: z.union([z.literal(''), z.guid()]),
      hora_entrada: z.string().regex(HORA, 'Elige la hora de entrada.'),
      hora_salida: z.string().regex(HORA, 'Elige la hora de salida.'),
      fecha_ingreso: z.string().regex(FECHA, 'Pon la fecha de ingreso: el primer día que trabajó.'),
      planilla: z.enum(['TALLER', 'ADMINISTRATIVA'], { message: 'Elige la planilla: de taller o administrativa.' }),
      banco: z.string().min(2, 'Escribe el banco.').max(60, 'El banco pasa de 60 caracteres.'),
      tipo_cuenta: z.enum(TIPOS_CUENTA, { message: 'Elige el tipo de cuenta.' }),
      numero_cuenta: z.string().regex(/^[0-9-]{6,30}$/, 'El número de cuenta lleva solo dígitos y guiones (de 6 a 30).'),
      cci: z.union([z.literal(''), z.string().regex(/^\d{20}$/, 'El CCI lleva 20 dígitos.')]),
      costo_mensual: z.union([
        z.literal(''),
        z.coerce.number('Escribe el costo mensual en soles.').positive('El costo mensual va en soles, mayor que cero.').max(100000, 'El costo mensual pasa de S/ 100 000.'),
      ]),
      remuneracion_mensual: z.union([
        z.literal(''),
        z.coerce
          .number('Escribe la remuneración mensual en soles.')
          .positive('La remuneración mensual va en soles, mayor que cero.')
          .max(100000, 'La remuneración mensual pasa de S/ 100 000.'),
      ]),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      nombres: dato(formulario, 'nombres'),
      apellidos: dato(formulario, 'apellidos'),
      dni: dato(formulario, 'dni').replace(/\s/g, ''),
      cargo: dato(formulario, 'cargo'),
      area_id: dato(formulario, 'area_id'),
      hora_entrada: dato(formulario, 'hora_entrada'),
      hora_salida: dato(formulario, 'hora_salida'),
      fecha_ingreso: dato(formulario, 'fecha_ingreso'),
      planilla: dato(formulario, 'planilla'),
      banco: dato(formulario, 'banco'),
      tipo_cuenta: dato(formulario, 'tipo_cuenta'),
      numero_cuenta: dato(formulario, 'numero_cuenta').replace(/\s/g, ''),
      cci: dato(formulario, 'cci').replace(/\s/g, ''),
      costo_mensual: dato(formulario, 'costo_mensual').replace(/[\s,]/g, ''),
      remuneracion_mensual: dato(formulario, 'remuneracion_mensual').replace(/[\s,]/g, ''),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la ficha.' }
  const d = analisis.data
  if (d.hora_salida <= d.hora_entrada) return { ok: false, error: 'La hora de salida tiene que ser posterior a la de entrada.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_guardar_trabajador', {
    p_id: d.id,
    p_nombres: d.nombres,
    p_apellidos: d.apellidos,
    p_dni: d.dni,
    p_cargo: d.cargo || null,
    p_area_id: d.area_id || null,
    p_hora_entrada: d.hora_entrada,
    p_hora_salida: d.hora_salida,
    p_banco: d.banco,
    p_tipo_cuenta: d.tipo_cuenta,
    p_numero_cuenta: d.numero_cuenta,
    p_cci: d.cci || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La ficha no quedó guardada. Recarga la pantalla.' }
  revalidatePath('/rrhh/personal')
  revalidatePath('/rrhh/asistencia')

  // Lo que va aparte, después de la ficha que ya quedó. Cada parte se intenta aunque
  // otra falle, y el aviso nombra todo lo que no se guardó: si cortara en la primera,
  // el costo y la remuneración escritos se perderían sin que nadie lo sepa.
  const noQuedo: string[] = []
  const revisar = (que: string, r: { data: unknown; error: { message: string; code?: string } | null }) => {
    if (r.error) noQuedo.push(`${que} (${mensajeDeError(r.error)})`)
    else if (r.data !== d.id) noQuedo.push(`${que} (recarga la pantalla)`)
    return !r.error && r.data === d.id
  }
  // La fecha de ingreso: de ella cuenta el sueldo de la oficina.
  revisar('la fecha de ingreso', await supabase.rpc('rrhh_guardar_ingreso_trabajador', { p_trabajador_id: d.id, p_fecha: d.fecha_ingreso }))
  // La planilla: con la de taller, el supervisor la ve en su reporte diario.
  revisar('la planilla', await supabase.rpc('rrhh_guardar_planilla_trabajador', { p_trabajador_id: d.id, p_planilla: d.planilla }))
  // El costo: solo RR. HH. lo lee.
  if (d.costo_mensual !== '') {
    const costo = await supabase.rpc('rrhh_guardar_costo_trabajador', { p_trabajador_id: d.id, p_costo_mensual: d.costo_mensual })
    if (revisar('el costo mensual', costo)) revalidatePath('/rrhh/costeo')
  }
  // La remuneración: con ella entra a la planilla diaria.
  if (d.remuneracion_mensual !== '') {
    const remuneracion = await supabase.rpc('rrhh_guardar_remuneracion_trabajador', {
      p_trabajador_id: d.id,
      p_remuneracion_mensual: d.remuneracion_mensual,
    })
    if (revisar('la remuneración mensual', remuneracion)) revalidatePath('/planilla-diaria')
  }
  if (noQuedo.length > 0) return { ok: false, error: `La ficha quedó guardada, pero no se guardó ${noQuedo.join('; ni ')}.` }
  return { ok: true, mensaje: `${d.nombres} ${d.apellidos} queda en el personal.` }
}

/** Vuelve a dar de alta a quien regresa, con el día en que vuelve. Mismo permiso que `rrhh_dar_de_alta_trabajador`. */
export async function darDeAltaTrabajador(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({ id: z.guid(), fecha: z.string().regex(FECHA, 'Pon el día en que vuelve a trabajar.') })
    .safeParse({ id: dato(formulario, 'id'), fecha: dato(formulario, 'fecha_reingreso') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_dar_de_alta_trabajador', { p_trabajador_id: analisis.data.id, p_fecha: analisis.data.fecha })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se pudo dar de alta. Recarga la pantalla.' }

  revalidatePath('/rrhh/personal')
  revalidatePath('/rrhh/asistencia')
  revalidatePath('/rrhh/pagos-oficina')
  return { ok: true, mensaje: 'Vuelve a estar de alta.' }
}

/** Quita una baja puesta por error: la ficha vuelve como estaba. Mismo permiso que `rrhh_cambiar_estado_trabajador`. */
export async function cambiarEstadoTrabajador(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z.object({ id: z.guid() }).safeParse({ id: dato(formulario, 'id') })
  if (!analisis.success) return { ok: false, error: 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_cambiar_estado_trabajador', { p_id: analisis.data.id, p_activo: true })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No se pudo dar de alta. Recarga la pantalla.' }

  revalidatePath('/rrhh/personal')
  revalidatePath('/rrhh/asistencia')
  return { ok: true, mensaje: 'Vuelve a estar de alta.' }
}

/** Da de baja con el último día que trabajó. Mismo permiso que `rrhh_dar_de_baja_trabajador`. */
export async function darDeBajaTrabajador(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!editaComoRrhh(perfil, 'rrhh.personal')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({ id: z.guid(), fecha_baja: z.string().regex(FECHA, 'Pon la fecha de baja: el último día que trabajó.') })
    .safeParse({ id: dato(formulario, 'id'), fecha_baja: dato(formulario, 'fecha_baja') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_dar_de_baja_trabajador', {
    p_trabajador_id: analisis.data.id,
    p_fecha: analisis.data.fecha_baja,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'No quedó de baja. Recarga la pantalla.' }

  revalidatePath('/rrhh/personal')
  revalidatePath('/rrhh/asistencia')
  revalidatePath('/costos/gastos-generales')
  return { ok: true, mensaje: 'Queda de baja: el portero ya no le marca.' }
}
