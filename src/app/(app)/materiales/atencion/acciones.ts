'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const errores: Record<string, string> = {
  'No hay suficiente material recibido': 'No hay saldo recibido suficiente para esa entrega.',
  'La entrega supera la cantidad solicitada': 'La cantidad supera lo que esta área solicitó.',
  'La persona debe estar activa': 'Elige a una persona activa del área que recibirá el material.',
  'La recepción supera lo pendiente': 'La cantidad ingresada supera lo que falta recibir de la compra.',
  'La cantidad excede lo que falta comprar': 'La cantidad supera lo que todavía falta comprar.',
  'Solo puedes solicitar materiales': 'Solo puedes solicitar materiales para tu área.',
}

function errorDeMaterial(error: { message: string; code?: string }) {
  const regla = Object.entries(errores).find(([texto]) => error.message.includes(texto))
  return regla?.[1] ?? mensajeDeError(error)
}

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

export async function crearOrdenCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede registrar compras.' }

  const cabecera = z.object({
    operacion_id: z.string().uuid(),
    requerimiento_id: z.string().uuid(),
    proveedor: z.string().trim().min(2).max(160),
    referencia: z.string().trim().min(2).max(100),
    fecha_estimada: z.iso.date().optional(),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    requerimiento_id: dato(formulario, 'requerimiento_id'),
    proveedor: dato(formulario, 'proveedor'),
    referencia: dato(formulario, 'referencia'),
    fecha_estimada: dato(formulario, 'fecha_estimada') || undefined,
  })
  const ids = formulario.getAll('detalle_id')
  const lineas = z.array(z.object({
    id: z.string().uuid(),
    cantidad: z.coerce.number().positive(),
  })).min(1).max(100).safeParse(ids.map((id) => ({
    id,
    cantidad: dato(formulario, `cantidad_${String(id)}`),
  })))
  if (!cabecera.success || !lineas.success) {
    return { ok: false, error: 'Revisa proveedor, referencia, fecha y cantidades a comprar.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('crear_orden_compra_material', {
    p_id: cabecera.data.operacion_id,
    p_requerimiento_id: cabecera.data.requerimiento_id,
    p_proveedor: cabecera.data.proveedor,
    p_referencia: cabecera.data.referencia,
    p_fecha_estimada: cabecera.data.fecha_estimada,
    p_detalles: lineas.data,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }

  revalidatePath('/materiales/atencion')
  return { ok: true, mensaje: 'Compra registrada; Almacén ya puede esperar su recepción.' }
}

export async function registrarRecepcion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'Tu perfil no puede registrar ingresos a almacén.' }
  const datos = z.object({
    operacion_id: z.string().uuid(),
    compra_detalle_id: z.string().uuid(),
    cantidad: z.coerce.number().positive(),
    documento_referencia: z.string().trim().min(2).max(100),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    compra_detalle_id: dato(formulario, 'compra_detalle_id'),
    cantidad: dato(formulario, 'cantidad'),
    documento_referencia: dato(formulario, 'documento_referencia'),
  })
  if (!datos.success) return { ok: false, error: 'Indica cuánto llegó y la guía o documento del proveedor.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_recepcion_material', {
    p_id: datos.data.operacion_id,
    p_orden_compra_detalle_id: datos.data.compra_detalle_id,
    p_cantidad: datos.data.cantidad,
    p_documento_referencia: datos.data.documento_referencia,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }

  revalidatePath('/materiales/atencion')
  return { ok: true, mensaje: 'Recepción registrada y saldo de almacén actualizado.' }
}

export async function despacharMaterial(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.despachar')) return { ok: false, error: 'Tu perfil no puede despachar materiales.' }
  const datos = z.object({
    operacion_id: z.string().uuid(),
    requerimiento_detalle_id: z.string().uuid(),
    cantidad: z.coerce.number().positive(),
    responsable_id: z.string().uuid(),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    requerimiento_detalle_id: dato(formulario, 'requerimiento_detalle_id'),
    cantidad: dato(formulario, 'cantidad'),
    responsable_id: dato(formulario, 'responsable_id'),
  })
  if (!datos.success) return { ok: false, error: 'Indica una cantidad y quién recibe el material.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('despachar_material', {
    p_id: datos.data.operacion_id,
    p_requerimiento_detalle_id: datos.data.requerimiento_detalle_id,
    p_cantidad: datos.data.cantidad,
    p_responsable_id: datos.data.responsable_id,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }

  revalidatePath('/materiales/atencion')
  return { ok: true, mensaje: 'Entrega registrada con la persona responsable del área.' }
}
