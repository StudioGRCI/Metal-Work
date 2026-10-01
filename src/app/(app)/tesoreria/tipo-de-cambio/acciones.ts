'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const tasa = z.string().regex(/^\d{1,2}(?:\.\d{1,4})?$/)

/**
 * Registra el cambio de un día, o lo corrige si ese día ya tenía uno. El permiso
 * es el mismo que piden las políticas de `tipos_de_cambio` para insertar y para
 * corregir: `tesoreria.tipo_cambio`.
 */
export async function registrarTipoDeCambio(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'tesoreria.tipo_cambio')) {
    return { ok: false, error: 'El tipo de cambio lo registran Tesorería, Administración y Contabilidad.' }
  }
  const entrada = z
    .object({ fecha: z.iso.date(), compra: tasa, venta: tasa, fuente: z.enum(['SUNAT', 'SBS', 'BANCO', 'OTRO']) })
    .safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Revisa la fecha y los dos cambios: números como 3.745.' }
  const v = entrada.data
  const compra = Number(v.compra)
  const venta = Number(v.venta)
  if (compra <= 0 || venta <= 0) return { ok: false, error: 'El cambio debe ser mayor que cero.' }
  if (venta < compra) return { ok: false, error: 'El cambio de venta no puede ser menor que el de compra.' }

  const db = await createClient()
  const { data: previo, error: errorPrevio } = await db.from('tipos_de_cambio').select('id').eq('fecha', v.fecha).maybeSingle()
  if (errorPrevio) return { ok: false, error: mensajeDeError(errorPrevio) }

  const { data, error } = previo
    ? await db.from('tipos_de_cambio').update({ compra, venta, fuente: v.fuente }).eq('id', previo.id).select('id').maybeSingle()
    : await db
        .from('tipos_de_cambio')
        .insert({ fecha: v.fecha, compra, venta, fuente: v.fuente, registrado_por: perfil.id })
        .select('id')
        .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/tesoreria/tipo-de-cambio')
  return { ok: true, mensaje: previo ? 'Cambio del día corregido.' : 'Cambio del día registrado.' }
}
