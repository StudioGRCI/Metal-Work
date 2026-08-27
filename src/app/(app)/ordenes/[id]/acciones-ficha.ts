'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

function numero(texto?: string) {
  const t = texto?.trim()
  if (!t) return null
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Llenar la ficha es trabajo de taller: la hace quien registra producción, no
 * solo quien administra órdenes. Marcar un V°B° tampoco es editar la orden.
 */
type Guarda =
  | { ok: true; perfil: Awaited<ReturnType<typeof exigirSesion>> }
  | { ok: false; error: string }

async function exigirTaller(): Promise<Guarda> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.editar', 'produccion.registrar', 'calidad.inspeccionar'])) {
    return { ok: false, error: 'No tienes permiso para llenar la ficha de la orden.' }
  }
  return { ok: true, perfil }
}

/**
 * Marcar la ficha y escribir la orden no son lo mismo. Un operario marca su
 * avance y calidad da su visto bueno —eso vive en tablas propias—, pero las
 * medidas, los colores y el encargado de producción se escriben sobre la orden
 * misma, y ahí manda quien puede escribir órdenes.
 *
 * Sin esta distinción la guarda dejaba pasar al operario, el UPDATE chocaba con
 * la política de la orden, afectaba cero filas y la pantalla le decía «Ficha
 * guardada» con los datos sin guardar.
 */
async function exigirEscribirOrden(): Promise<Guarda> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.editar', 'ordenes.cambiar_estado'])) {
    return {
      ok: false,
      error: 'Los datos de la unidad los llena el jefe de taller o el supervisor.',
    }
  }
  return { ok: true, perfil }
}

/**
 * Poner y quitar líneas de la ficha —un accesorio, un repuesto— es armar el
 * trabajo: lo hace el taller. Calidad marca el visto bueno sobre lo que hay,
 * que es otra cosa y tiene su propia guarda.
 */
async function exigirArmarFicha(): Promise<Guarda> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.editar', 'produccion.registrar'])) {
    return {
      ok: false,
      error: 'Las líneas de la ficha las arma el taller; calidad da el visto bueno.',
    }
  }
  return { ok: true, perfil }
}

/** Sección 4 del formato: medidas, colores y características especiales. */
export async function guardarFichaFisica(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const guarda = await exigirEscribirOrden()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({
      orden_id: z.string().uuid(),
      largo_m: z.string().trim().optional(),
      ancho_m: z.string().trim().optional(),
      alto_m: z.string().trim().optional(),
      capacidad_carga: z.string().trim().optional(),
      ruedas: z.string().trim().optional(),
      tipo_llantas: z.string().trim().optional(),
      cantidad_ejes: z.string().trim().optional(),
      tipo_suspension: z.string().trim().optional(),
      colores: z.string().trim().optional(),
      caracteristicas_especiales: z.string().trim().optional(),
      correo_contacto: z.string().trim().optional(),
      encargado_produccion_id: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const ejes = v.cantidad_ejes?.trim() ? Number(v.cantidad_ejes) : null
  if (ejes !== null && (!Number.isInteger(ejes) || ejes < 1 || ejes > 8)) {
    return { ok: false, error: 'La cantidad de ejes va de 1 a 8.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ordenes_trabajo')
    .update({
      largo_m: numero(v.largo_m),
      ancho_m: numero(v.ancho_m),
      alto_m: numero(v.alto_m),
      capacidad_carga: nulo(v.capacidad_carga),
      ruedas: nulo(v.ruedas),
      tipo_llantas: nulo(v.tipo_llantas),
      cantidad_ejes: ejes,
      tipo_suspension: nulo(v.tipo_suspension),
      colores: nulo(v.colores),
      caracteristicas_especiales: nulo(v.caracteristicas_especiales),
      correo_contacto: nulo(v.correo_contacto),
      encargado_produccion_id: nulo(v.encargado_produccion_id),
    })
    .eq('id', v.orden_id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Ficha de la unidad actualizada.' }
}

/**
 * Trae los accesorios de la cotización y los pasos de verificación de la
 * carrocería. Lo hace el disparador al aprobar, pero también a mano: una orden
 * aprobada antes de esta versión no los tiene.
 */
export async function armarFicha(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirTaller()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z.object({ orden_id: z.string().uuid() }).safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('armar_ficha_ot', { p_orden: analisis.data.orden_id })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Ficha armada con lo cotizado y los pasos de la carrocería.' }
}

/** Sección 6: agregar un accesorio que no venía de la cotización. */
export async function agregarAccesorioOT(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const guarda = await exigirArmarFicha()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({
      orden_id: z.string().uuid(),
      cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
      unidad: z.string().trim().default('unid'),
      descripcion: z.string().trim().min(3, 'Falta la descripción'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el accesorio.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data: previos } = await supabase
    .from('ot_accesorios')
    .select('orden')
    .eq('orden_id', v.orden_id)

  const { error } = await supabase.from('ot_accesorios').insert({
    orden_id: v.orden_id,
    orden: Math.max(0, ...(previos ?? []).map((a) => a.orden)) + 1,
    cantidad: v.cantidad,
    unidad: v.unidad || 'unid',
    descripcion: v.descripcion,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Accesorio agregado.' }
}

/** El V°B° del formato: se pone y se quita, con quién y cuándo. */
export async function marcarAccesorio(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirTaller()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({
      id: z.string().uuid(),
      orden_id: z.string().uuid(),
      verificado: z.enum(['si', 'no']),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const v = analisis.data
  const pone = v.verificado === 'si'
  const supabase = await createClient()

  const { error } = await supabase
    .from('ot_accesorios')
    .update({
      verificado: pone,
      verificado_en: pone ? new Date().toISOString() : null,
      verificado_por: pone ? guarda.perfil.id : null,
    })
    .eq('id', v.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true }
}

/** Quitar un accesorio de la lista. */
export async function quitarAccesorioOT(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const guarda = await exigirArmarFicha()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({ id: z.string().uuid(), orden_id: z.string().uuid() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase.from('ot_accesorios').delete().eq('id', analisis.data.id)
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true }
}

/** Sección 8: repuestos con su marca. */
export async function agregarRepuesto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirArmarFicha()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({
      orden_id: z.string().uuid(),
      cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
      descripcion: z.string().trim().min(3, 'Falta la descripción'),
      marca: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el repuesto.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data: previos } = await supabase
    .from('ot_repuestos')
    .select('orden')
    .eq('orden_id', v.orden_id)

  const { error } = await supabase.from('ot_repuestos').insert({
    orden_id: v.orden_id,
    orden: Math.max(0, ...(previos ?? []).map((r) => r.orden)) + 1,
    cantidad: v.cantidad,
    descripcion: v.descripcion,
    marca: nulo(v.marca),
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Repuesto agregado.' }
}

/** Quitar un repuesto. */
export async function quitarRepuesto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirArmarFicha()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({ id: z.string().uuid(), orden_id: z.string().uuid() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase.from('ot_repuestos').delete().eq('id', analisis.data.id)
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true }
}

/**
 * Sección 11: marcar un paso de verificación. Los dos avances son la primera
 * pasada y la revisión, y el esquema no deja marcar la segunda sin la primera.
 */
export async function marcarVerificacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const guarda = await exigirTaller()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({
      id: z.string().uuid(),
      orden_id: z.string().uuid(),
      avance: z.enum(['1', '2']),
      valor: z.enum(['si', 'no']),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const v = analisis.data
  const pone = v.valor === 'si'
  const ahora = pone ? new Date().toISOString() : null

  // Quitar la primera pasada arrastra la segunda: sin la una la otra no existe.
  const cambio =
    v.avance === '1'
      ? pone
        ? { avance_1: true, avance_1_en: ahora }
        : { avance_1: false, avance_1_en: null, avance_2: false, avance_2_en: null }
      : { avance_2: pone, avance_2_en: ahora }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ot_verificaciones')
    .update({ ...cambio, responsable_id: guarda.perfil.id })
    .eq('id', v.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true }
}

/** La columna de observaciones del formato. */
export async function anotarVerificacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const guarda = await exigirTaller()
  if (!guarda.ok) return { ok: false, error: guarda.error }

  const analisis = z
    .object({
      id: z.string().uuid(),
      orden_id: z.string().uuid(),
      observaciones: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ot_verificaciones')
    .update({ observaciones: nulo(analisis.data.observaciones) })
    .eq('id', analisis.data.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Observación guardada.' }
}
