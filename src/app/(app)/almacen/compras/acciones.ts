'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const DOCUMENTOS_RECIBIDOS = z.object({
  tipo: z.enum(['OC', 'OS'], { message: 'Elige la orden de compra o de servicio.' }),
  orden_id: z.guid({ message: 'Elige la orden de compra o de servicio.' }),
  factura: z.string().max(40, 'El comprobante va con su serie y su número, hasta 40 caracteres.'),
  guia: z.string().max(40, 'La guía va con su serie y su número, hasta 40 caracteres.'),
  observacion: z.string().max(500, 'La observación va hasta 500 caracteres.'),
  // Cuándo cambió la fila que mostró la pantalla, tal como la dio la base (con
  // sus microsegundos: pasarla por `Date` la cortaría y no calzaría nunca).
  mostrado: z.string().max(40),
})

/**
 * Lo que Almacén recibió de una OC u OS: la factura y la guía del proveedor, con
 * su número, y la nota de la fila. El mismo permiso que exige la base
 * (`anotar_documentos_recibidos` → `almacen.recibir`); la tabla no se escribe
 * directo. Vaciar un número quita su marca. Si otra pantalla anotó algo
 * después de que esta mostró la fila, la base lo rechaza en vez de pisarlo.
 */
export async function anotarDocumentosRecibidos(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'Lo que llega de cada compra lo anota Almacén.' }
  const v = DOCUMENTOS_RECIBIDOS.safeParse({
    tipo: dato(formulario, 'tipo'),
    orden_id: dato(formulario, 'orden_id'),
    factura: dato(formulario, 'factura'),
    guia: dato(formulario, 'guia'),
    observacion: dato(formulario, 'observacion'),
    mostrado: dato(formulario, 'mostrado'),
  })
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa la factura, la guía y la observación.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anotar_documentos_recibidos', {
    p_orden_compra: v.data.tipo === 'OC' ? v.data.orden_id : null,
    p_orden_servicio: v.data.tipo === 'OS' ? v.data.orden_id : null,
    p_factura: v.data.factura,
    p_guia: v.data.guia,
    p_observacion: v.data.observacion,
    p_mostrado: v.data.mostrado || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/compras')
  const partes = [v.data.factura && 'la factura', v.data.guia && 'la guía'].filter(Boolean)
  return {
    ok: true,
    mensaje: partes.length > 0 ? `Anotado: llegó ${partes.join(' y ')}.` : 'Guardado: sin factura ni guía recibidas.',
  }
}

export type RecepcionDeAhora = {
  factura: string | null
  guia: string | null
  observacion: string | null
  /** Cuándo cambió, tal como lo da la base, para volver a anotar sobre esto. */
  mostrado: string | null
}

/**
 * Lo que Almacén tiene anotado ahora de una OC u OS, para la ventana que chocó
 * con otra pantalla: se lee sin refrescar la lista, que en «Pendientes» podía
 * sacar la fila y llevarse la ventana con lo escrito.
 */
export async function leerRecepcionDeAhora(tipo: 'OC' | 'OS', ordenId: string): Promise<ResultadoAccion<RecepcionDeAhora>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'Lo que llega de cada compra lo anota Almacén.' }
  const id = z.guid().safeParse(ordenId)
  if (!id.success || (tipo !== 'OC' && tipo !== 'OS')) return { ok: false, error: 'Elige la orden de compra o de servicio.' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('recepcion_documentos_compra')
    .select('factura_numero, guia_numero, observacion, actualizado_en')
    .eq(tipo === 'OC' ? 'orden_compra_id' : 'orden_servicio_id', id.data)
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  return {
    ok: true,
    datos: {
      factura: data?.factura_numero ?? null,
      guia: data?.guia_numero ?? null,
      observacion: data?.observacion ?? null,
      mostrado: data?.actualizado_en ?? null,
    },
  }
}
