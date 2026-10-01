'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const uuid = z.string().uuid()

/**
 * Ventas, Gerencia o Administración dicen si el monto de la cotización trae IGV.
 * Es lo que separa un margen real de uno inflado en el 18 % de la venta. Los
 * permisos son los mismos que exige `confirmar_igv_cotizacion` en la base.
 */
export async function confirmarIgv(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['cotizaciones.crear', 'cotizaciones.revisar', 'cotizaciones.liberar_tesoreria'])) {
    return { ok: false, error: 'Solo Ventas, Gerencia o Administración confirman si el precio incluye IGV.' }
  }
  const entrada = z
    .object({ cotizacion_id: uuid, orden_id: uuid, incluye_igv: z.enum(['si', 'no']) })
    .safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Indica si el precio de la cotización incluye IGV o no.' }
  const v = entrada.data

  const db = await createClient()
  const { error } = await db.rpc('confirmar_igv_cotizacion', {
    p_cotizacion: v.cotizacion_id,
    p_incluye_igv: v.incluye_igv === 'si',
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/ordenes/${v.orden_id}/expediente`)
  revalidatePath('/')
  return {
    ok: true,
    mensaje: v.incluye_igv === 'si' ? 'Anotado: el precio incluye IGV.' : 'Anotado: el precio es sin IGV.',
  }
}

/**
 * Congela el costo de una OT terminada. Las reglas —que el trabajo terminó, que
 * no haya despachos sin precio ni dólares sin cambio— las pone la base; aquí
 * solo se pide el permiso para dar un mensaje claro antes de intentarlo.
 */
export async function cerrarCosto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['costos.controlar_ot', 'ordenes.editar'])) {
    return { ok: false, error: 'El costo lo cierran Costos y Materiales o Administración.' }
  }
  const entrada = z
    .object({ orden_id: uuid, nota: z.string().trim().max(1000).optional().default('') })
    .safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'La nota del cierre no puede pasar de 1000 caracteres.' }
  const v = entrada.data

  const db = await createClient()
  const { data, error } = await db.rpc('cerrar_costo_ot', { p_orden: v.orden_id, p_nota: v.nota })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se pudo cerrar el costo: vuelve a cargar la pantalla.' }

  revalidatePath(`/ordenes/${v.orden_id}/expediente`)
  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/')
  return { ok: true, mensaje: 'Costo cerrado. Queda congelado como evidencia.' }
}
