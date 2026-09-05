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
 *
 * Mandar al almacén es otra mano y otro permiso: `requerimientos.crear`. La
 * función de la base lo vuelve a exigir, así que esconder el botón no es la
 * única defensa.
 */
const REGLAS: Record<string, string> = {
  uq_ot_material: 'Ese material ya está en la lista para ese plano. Corrige la cantidad en vez de agregarlo otra vez.',
  ot_materiales_cantidad_check: 'La cantidad tiene que ser mayor que cero.',
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

const esquemaCantidad = z.object({
  id: z.string().uuid(),
  orden_id: z.string().uuid(),
  cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
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
    .update({ cantidad: v.cantidad })
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

  // Lo ya pedido al almacén no se puede borrar de la lista: quedaría un
  // requerimiento apuntando a una línea que nadie puede explicar.
  const { data: linea } = await supabase
    .from('v_ot_materiales')
    .select('cantidad_pedida, material')
    .eq('id', v.id)
    .maybeSingle()

  if (linea && Number(linea.cantidad_pedida) > 0) {
    return {
      ok: false,
      error: `De «${linea.material}» ya se pidió material al almacén: esta línea no se puede quitar. Anula el requerimiento si fue un error.`,
    }
  }

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

/**
 * El pase al almacén. La pantalla manda cantidades —el porcentaje lo convierte
 * ella— y la base comprueba que ninguna pase del saldo pendiente.
 */
const esquemaPedido = z.object({
  orden_id: z.string().uuid(),
  lineas: z.string(),
  almacen_id: z.string().uuid().optional().or(z.literal('')),
  prioridad: z.enum(['BAJA', 'NORMAL', 'ALTA', 'URGENTE']).default('NORMAL'),
  fecha_requerida: z.string().optional(),
  observaciones: z.string().trim().optional(),
})

const esquemaLineas = z.array(
  z.object({ material: z.string().uuid(), cantidad: z.number().positive() }),
)

export async function mandarAlRequerimiento(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ requerimiento: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'requerimientos.crear')) {
    return { ok: false, error: 'No tienes permiso para solicitar material.' }
  }

  const analisis = esquemaPedido.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el pedido.' }
  }

  const v = analisis.data

  let lineas: { material: string; cantidad: number }[]
  try {
    lineas = esquemaLineas.parse(JSON.parse(v.lineas))
  } catch {
    return { ok: false, error: 'No se entendió qué material se está pidiendo.' }
  }

  if (lineas.length === 0) {
    return { ok: false, error: 'Marca al menos un material para pedir.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('mandar_material_a_requerimiento', {
    p_orden: v.orden_id,
    p_lineas: lineas,
    p_almacen: nulo(v.almacen_id),
    p_prioridad: v.prioridad,
    p_fecha_requerida: nulo(v.fecha_requerida),
    p_observaciones: nulo(v.observaciones),
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/almacen/requerimientos')
  return {
    ok: true,
    mensaje: 'Material mandado al almacén.',
    datos: { requerimiento: data as unknown as string },
  }
}
