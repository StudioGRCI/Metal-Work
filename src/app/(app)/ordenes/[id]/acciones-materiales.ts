'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La lista de materiales de la orden la escribe Diseño y nadie más: es su hoja,
 * la misma mano que arma los planos. Por eso todas las escrituras de acá exigen
 * `diseno.planos`, que es exactamente lo que pide la política de
 * `ot_materiales` —cruzado a propósito: si acá se pidiera otro permiso, el
 * UPDATE afectaría cero filas sin error y la pantalla diría «guardado» sin
 * haber guardado—.
 */
const REGLAS: Record<string, string> = {
  uq_ot_material: 'Ese material ya está en la lista para ese plano. Corrige la cantidad en vez de agregarlo otra vez.',
  ot_materiales_cantidad_check: 'La cantidad tiene que ser mayor que cero.',
  'Este material ya forma parte de un requerimiento': 'Este material ya está solicitado y su línea de Diseño quedó protegida.',
  fk_ot_material_plano: 'Ese plano no es de esta orden.',
  fk_ot_material_etapa: 'Esa etapa no es de esta orden.',
}

function traducir(error: { message: string }) {
  for (const [regla, texto] of Object.entries(REGLAS)) {
    if (error.message.includes(regla)) return texto
  }
  return mensajeDeError(error)
}

const nulo = (v: string | undefined) => (v && v.length > 0 ? v : null)

const esquemaAlta = z.object({
  orden_id: z.string().uuid(),
  material_id: z.string().uuid('Elige el material'),
  cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
  plano_id: z.string().uuid().optional().or(z.literal('')),
  etapa_id: z.string().uuid().optional().or(z.literal('')),
  area_destino: z.enum(['MTZ', 'PRD', 'ACB']),
  observacion: z.string().trim().optional(),
})

export async function agregarMaterial(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'La lista de materiales la arma Diseño.' }
  }

  const analisis = esquemaAlta.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_materiales')
    .insert({
      orden_id: v.orden_id,
      material_id: v.material_id,
      cantidad: v.cantidad,
      plano_id: nulo(v.plano_id),
      etapa_id: nulo(v.etapa_id),
      area_destino: v.area_destino,
      observacion: nulo(v.observacion),
      creado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Material agregado a la lista.' }
}

export async function crearRequerimiento(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.crear')) {
    return { ok: false, error: 'Tu perfil no puede solicitar materiales.' }
  }

  const analisis = z.object({
    orden_id: z.string().uuid(),
    area_destino: z.enum(['MTZ', 'PRD', 'ACB']),
  }).safeParse({
    orden_id: datos.get('orden_id'),
    area_destino: datos.get('area_destino'),
  })
  const materiales = z.array(z.string().uuid()).min(1).max(100).safeParse(datos.getAll('material_id'))
  if (!analisis.success || !materiales.success) {
    return { ok: false, error: 'No se pudo identificar la orden, el área o los materiales.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('crear_requerimiento_material', {
    p_orden_id: analisis.data.orden_id,
    p_area_destino: analisis.data.area_destino,
    p_materiales: materiales.data,
  })
  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: 'No se pudo confirmar el requerimiento.' }

  revalidatePath(`/ordenes/${analisis.data.orden_id}`)
  revalidatePath('/materiales/atencion')
  return { ok: true, mensaje: `${materiales.data.length} materiales enviados a Requerimientos.` }
}

const esquemaCantidad = z.object({
  id: z.string().uuid(),
  orden_id: z.string().uuid(),
  cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
  area_destino: z.enum(['MTZ', 'PRD', 'ACB']),
})

export async function cambiarCantidadMaterial(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'La lista de materiales la arma Diseño.' }
  }

  const analisis = esquemaCantidad.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la cantidad.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_materiales')
    .update({ cantidad: v.cantidad, area_destino: v.area_destino })
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Cantidad corregida.' }
}

const esquemaQuitar = z.object({
  id: z.string().uuid(),
  orden_id: z.string().uuid(),
})

export async function quitarMaterial(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'La lista de materiales la arma Diseño.' }
  }

  const analisis = esquemaQuitar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar la línea.' }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_materiales')
    .delete()
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Material quitado de la lista.' }
}
