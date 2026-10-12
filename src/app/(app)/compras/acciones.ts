'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

/**
 * Compra para almacén: reponer stock sin que ninguna OT lo haya pedido. Va por
 * la misma regla de aprobación que cualquier compra y, lista, le llega al
 * conductor para recogerla.
 */
export async function emitirCompraParaAlmacen(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede registrar compras.' }

  const cabecera = z.object({
    operacion_id: z.string().uuid(),
    proveedor_id: z.string().uuid(),
    referencia: z.string().trim().min(2).max(100),
    fecha_estimada: z.iso.date().optional(),
    condicion: z.enum(['CONTADO', 'CREDITO']),
    dias: z.coerce.number().int().min(0).max(365),
    moneda: z.enum(['PEN', 'USD']),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    proveedor_id: dato(formulario, 'proveedor_id'),
    referencia: dato(formulario, 'referencia'),
    fecha_estimada: dato(formulario, 'fecha_estimada') || undefined,
    condicion: dato(formulario, 'condicion'),
    dias: dato(formulario, 'dias'),
    moneda: dato(formulario, 'moneda'),
  })
  if (!cabecera.success && cabecera.error.issues.some((i) => i.path[0] === 'proveedor_id')) {
    return { ok: false, error: 'Elige el proveedor del padrón. Si es nuevo, regístralo con «Nuevo».' }
  }
  if (!cabecera.success) return { ok: false, error: 'Revisa el número de la orden, la fecha y el pago.' }
  if ((cabecera.data.condicion === 'CONTADO' && cabecera.data.dias !== 0) ||
      (cabecera.data.condicion === 'CREDITO' && cabecera.data.dias === 0)) {
    return { ok: false, error: 'Indica 0 días para contado o un plazo de 1 a 365 días para crédito.' }
  }

  const ids = formulario.getAll('material_id').map(String)
  if (ids.length === 0) return { ok: false, error: 'Agrega al menos un material.' }
  const lineas = z.array(z.object({
    material_id: z.string().uuid(),
    cantidad: z.coerce.number().positive().multipleOf(0.001),
    precio: z.coerce.number().min(0).multipleOf(0.01),
  })).min(1).max(100).safeParse(ids.map((id) => ({
    material_id: id,
    cantidad: dato(formulario, `cantidad_${id}`).replace(',', '.'),
    precio: dato(formulario, `precio_${id}`).replace(',', '.'),
  })))
  if (!lineas.success) {
    return { ok: false, error: 'Cada material necesita su cantidad (hasta 3 decimales) y su precio unitario sin IGV (hasta 2 decimales).' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_compra_para_almacen', {
    p_id: cabecera.data.operacion_id,
    p_proveedor_id: cabecera.data.proveedor_id,
    p_referencia: cabecera.data.referencia,
    p_detalles: lineas.data,
    p_fecha: cabecera.data.fecha_estimada ?? null,
    p_condicion: cabecera.data.condicion,
    p_dias: cabecera.data.dias,
    p_moneda: cabecera.data.moneda,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== cabecera.data.operacion_id) return { ok: false, error: 'La compra no quedó registrada. Recarga la pantalla.' }

  // La aprobación la decide la base al cerrar la compra; aquí solo se lee.
  const { data: emitida } = await supabase
    .from('ordenes_compra_materiales')
    .select('aprobacion')
    .eq('id', cabecera.data.operacion_id)
    .maybeSingle()

  revalidatePath('/compras')
  revalidatePath('/compras/aprobacion')
  revalidatePath('/recojos')
  revalidatePath('/tesoreria/cuentas')
  return {
    ok: true,
    mensaje: emitida?.aprobacion === 'POR_APROBAR'
      ? `Compra ${cabecera.data.referencia} emitida. Espera la aprobación de Gerencia; aprobada, le llega al conductor para recogerla.`
      : `Compra ${cabecera.data.referencia} emitida. Ya le llegó al conductor para recogerla.`,
  }
}
