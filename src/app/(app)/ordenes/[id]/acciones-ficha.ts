'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'
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
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'La ficha de taller la completa Diseño.' }
  }
  return { ok: true, perfil }
}

/**
 * Marcar la ficha y escribir la orden no son lo mismo. El taller marca lo que
 * verifica —eso vive en tablas propias—, pero las
 * medidas, los colores y el encargado de producción se escriben sobre la orden
 * misma, y ahí manda quien puede escribir órdenes.
 *
 * Sin esta distinción la guarda dejaba pasar al operario, el UPDATE chocaba con
 * la política de la orden, afectaba cero filas y la pantalla le decía «Ficha
 * guardada» con los datos sin guardar.
 */
async function exigirEscribirOrden(): Promise<Guarda> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return {
      ok: false,
      error: 'Los datos de la ficha los completa Diseño.',
    }
  }
  return { ok: true, perfil }
}

/**
 * Poner y quitar líneas de la ficha —un accesorio, un repuesto— es armar el
 * trabajo: lo hace el taller, y el visto bueno sobre lo que hay tiene su
 * propia guarda.
 */
async function exigirArmarFicha(): Promise<Guarda> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return {
      ok: false,
      error: 'Los accesorios y repuestos los completa Diseño.',
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
  const { data, error } = await supabase.rpc('guardar_ficha_diseno', {
    p_orden: v.orden_id,
    p_datos: {
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
    },
  })

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Ficha de la unidad actualizada.' }
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

  const { data, error } = await supabase
    .from('ot_accesorios')
    .update({
      verificado: pone,
      verificado_en: pone ? new Date().toISOString() : null,
      verificado_por: pone ? guarda.perfil.id : null,
    })
    .eq('id', v.id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

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
  const { data, error } = await supabase
    .from('ot_accesorios')
    .delete()
    .eq('id', analisis.data.id)
    .eq('orden_id', analisis.data.orden_id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

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
  const { data, error } = await supabase
    .from('ot_repuestos')
    .delete()
    .eq('id', analisis.data.id)
    .eq('orden_id', analisis.data.orden_id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true }
}

/** Diseño escribe la lista de pasos de esta OT, sin traer una plantilla automática. */
export async function agregarVerificacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (perfil.rol.codigo !== 'DISENO' || !puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'Solo Diseño puede crear pasos.' }
  }
  const analisis = z.object({
    orden_id: z.string().uuid(),
    descripcion: z.string().trim().min(3).max(300),
  }).safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Describe el paso en 3 a 300 caracteres.' }

  const supabase = await createClient()
  const { data: ultimo, error: errorLista } = await supabase
    .from('ot_verificaciones').select('numero')
    .eq('orden_id', analisis.data.orden_id).order('numero', { ascending: false }).limit(1)
  if (errorLista) return { ok: false, error: mensajeDeError(errorLista) }
  const numeroPaso = (ultimo?.[0]?.numero ?? 0) + 1
  if (numeroPaso > 40) return { ok: false, error: 'La OT admite hasta 40 pasos.' }
  const { data, error } = await supabase.from('ot_verificaciones')
    .insert({ orden_id: analisis.data.orden_id, numero: numeroPaso, descripcion: analisis.data.descripcion })
    .select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: `Paso ${numeroPaso} agregado.` }
}

/** Cada supervisor marca el visto bueno de su área. */
export async function marcarVerificacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()

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
  if (perfil.rol.codigo !== 'SUPERVISOR') {
    return { ok: false, error: 'Solo Supervisión del área correspondiente puede marcar este visto bueno.' }
  }
  const areaEsperada = v.avance === '1' ? 'PRD' : 'MTZ'
  const supabase = await createClient()
  const { data: area, error: errorArea } = await supabase
    .from('areas').select('codigo').eq('id', perfil.area_id ?? '').maybeSingle()
  if (errorArea) return { ok: false, error: mensajeDeError(errorArea) }
  if (area?.codigo !== areaEsperada) {
    return { ok: false, error: 'Solo Supervisión del área correspondiente puede marcar este visto bueno.' }
  }
  const pone = v.valor === 'si'
  const cambio = v.avance === '1' ? { avance_1: pone } : { avance_2: pone }

  const { data, error } = await supabase
    .from('ot_verificaciones')
    .update(cambio)
    .eq('id', v.id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true }
}

/** La columna de observaciones del formato. */
export async function anotarVerificacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'Solo Diseño puede anotar observaciones en los pasos.' }
  }

  const analisis = z
    .object({
      id: z.string().uuid(),
      orden_id: z.string().uuid(),
      observaciones: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ot_verificaciones')
    .update({ observaciones: nulo(analisis.data.observaciones) })
    .eq('id', analisis.data.id)
    .eq('orden_id', analisis.data.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  return { ok: true, mensaje: 'Observación guardada.' }
}
