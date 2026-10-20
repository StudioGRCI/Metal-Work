'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { horaDeLima, MAXIMO_FOTOS_VEHICULO, MOTIVOS_VEHICULO, motivoExigeCodigo } from '@/lib/dominio/requerimientos'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/** Lo que viaja como JSON en un campo del formulario; si no se puede leer, `null`. */
function json(formulario: FormData, nombre: string): unknown {
  try {
    return JSON.parse(dato(formulario, nombre) || 'null')
  } catch {
    return null
  }
}

const SIN_PERMISO = 'El ingreso y la salida de vehículos los registra el área de Requerimientos.'

/** Las rutas de las fotos ya subidas a Storage: de 1 a 15, como exige la base. */
function fotos(momento: 'entrar' | 'salir') {
  return z
    .array(z.string().min(1).max(300), `Toma al menos una foto del vehículo al ${momento}.`)
    .min(1, `Toma al menos una foto del vehículo al ${momento}.`)
    .max(MAXIMO_FOTOS_VEHICULO, `Van hasta ${MAXIMO_FOTOS_VEHICULO} fotos al ${momento}.`)
}

/** Un vehículo entra a la planta, con sus fotos. Mismo permiso que `registrar_ingreso_vehiculo`. */
export async function registrarIngresoVehiculo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'vehiculos.registrar')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      operacion_id: z.guid(),
      placa: z.string().max(15, 'La placa pasa de 15 caracteres.'),
      chasis: z.string().max(40, 'El número de chasis pasa de 40 caracteres.'),
      codigo_interno: z.string().max(60, 'El código interno pasa de 60 caracteres.'),
      // Con código interno, el vehículo y la empresa salen de la unidad (la base los pone).
      unidad: z.string().max(120, 'La descripción pasa de 120 caracteres.'),
      empresa: z.string().max(160, 'La empresa pasa de 160 caracteres.'),
      motivo: z.enum(MOTIVOS_VEHICULO, { message: 'Elige el motivo del ingreso.' }),
      ingreso_en: z.string(),
      observacion: z.string().max(500, 'La observación pasa de 500 caracteres.'),
      fotos: fotos('entrar'),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      placa: dato(formulario, 'placa'),
      chasis: dato(formulario, 'chasis'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      unidad: dato(formulario, 'unidad'),
      empresa: dato(formulario, 'empresa'),
      motivo: dato(formulario, 'motivo'),
      ingreso_en: dato(formulario, 'ingreso_en'),
      observacion: dato(formulario, 'observacion'),
      fotos: json(formulario, 'fotos') ?? [],
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el ingreso.' }
  const d = analisis.data
  if (motivoExigeCodigo(d.motivo)) {
    if (!d.codigo_interno) return { ok: false, error: 'Elige el código interno: el trabajo del taller entra con su código y su OT.' }
  } else {
    if (!d.placa && !d.chasis && !d.codigo_interno) {
      return { ok: false, error: 'Anota la placa, el número de chasis o el código interno.' }
    }
    if (d.unidad.length < 2) return { ok: false, error: 'Describe el vehículo: tipo, marca o carrocería.' }
    if (d.empresa.length < 2) return { ok: false, error: 'Anota la empresa o el dueño del vehículo.' }
  }
  const cuando = d.ingreso_en ? horaDeLima(d.ingreso_en) : null
  if (d.ingreso_en && !cuando) return { ok: false, error: 'La fecha y hora de ingreso no es válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_ingreso_vehiculo', {
    p_id: d.operacion_id,
    p_placa: d.placa || null,
    p_chasis: d.chasis || null,
    p_codigo_interno: d.codigo_interno || null,
    p_unidad: d.unidad,
    p_empresa: d.empresa,
    p_motivo: d.motivo,
    p_ingreso_en: cuando,
    p_observacion: d.observacion || null,
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'El ingreso no quedó registrado. Recarga la pantalla.' }

  revalidatePath('/vehiculos', 'layout')
  return { ok: true, mensaje: `Ingreso registrado con ${d.fotos.length} ${d.fotos.length === 1 ? 'foto' : 'fotos'}: el vehículo figura en planta.` }
}

/** El vehículo sale, con sus fotos. Mismo permiso que `registrar_salida_vehiculo`. */
export async function registrarSalidaVehiculo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'vehiculos.registrar')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      salida_en: z.string(),
      observacion: z.string().max(500, 'La observación pasa de 500 caracteres.'),
      fotos: fotos('salir'),
    })
    .safeParse({
      id: formulario.get('id'),
      salida_en: dato(formulario, 'salida_en'),
      observacion: dato(formulario, 'observacion'),
      fotos: json(formulario, 'fotos') ?? [],
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const cuando = analisis.data.salida_en ? horaDeLima(analisis.data.salida_en) : null
  if (analisis.data.salida_en && !cuando) return { ok: false, error: 'La fecha y hora de salida no es válida.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_salida_vehiculo', {
    p_id: analisis.data.id,
    p_salida_en: cuando,
    p_observacion: analisis.data.observacion || null,
    p_fotos: analisis.data.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La salida no quedó registrada. Recarga la pantalla.' }

  revalidatePath('/vehiculos', 'layout')
  return { ok: true, mensaje: 'Salida registrada.' }
}

/** Un ingreso mal anotado se anula con motivo; no se borra. */
export async function anularRegistroVehiculo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'vehiculos.registrar')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: formulario.get('id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_registro_vehiculo', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El registro no se anuló. Recarga la pantalla.' }

  revalidatePath('/vehiculos', 'layout')
  return { ok: true, mensaje: 'Registro anulado. Queda con su motivo.' }
}
