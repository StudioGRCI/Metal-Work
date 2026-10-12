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

function refrescar() {
  revalidatePath('/compras/ordenes')
  revalidatePath('/compras/aprobacion')
  revalidatePath('/compras')
  revalidatePath('/recojos')
  revalidatePath('/almacen/kardex')
  // El tablero de Atención de materiales vive también en la pestaña de la OT.
  revalidatePath('/ordenes/[id]', 'page')
}

const LINEAS = z
  .array(
    z.object({
      material_id: z.string().uuid('Elige el material de cada línea.'),
      cantidad: z.coerce
        .number({ message: 'Indica la cantidad de cada línea.' })
        .positive('La cantidad de cada línea va mayor que cero.')
        .multipleOf(0.001, 'La cantidad lleva como máximo tres decimales.'),
      precio: z.coerce
        .number({ message: 'Indica el precio unitario de cada línea.' })
        .min(0, 'El precio no puede ser negativo.')
        .multipleOf(0.01, 'El precio lleva como máximo dos decimales.'),
    }),
  )
  .min(1, 'Agrega al menos un material.')
  .max(100, 'Una orden lleva hasta cien líneas.')

/**
 * La orden de compra directa: sin requerimiento ni OT. Exige `compras.crear`,
 * el mismo permiso que pide `emitir_compra_directa` en la base. La aprobación
 * de Gerencia la decide la base al cerrar la transacción: la directa siempre la
 * pide.
 */
export async function emitirCompraDirecta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede emitir órdenes de compra.' }

  const cabecera = z
    .object({
      operacion_id: z.string().uuid(),
      proveedor_id: z.string().uuid('Elige el proveedor del padrón. Si es nuevo, regístralo con «Nuevo».'),
      referencia: z.string().trim().max(100, 'La referencia del proveedor pasa de 100 caracteres.'),
      motivo: z
        .string()
        .trim()
        .min(5, 'Cuenta por qué se compra sin requerimiento: Gerencia lo lee al aprobar.')
        .max(500, 'El motivo pasa de 500 caracteres.'),
      fecha_estimada: z.iso.date().optional(),
      condicion: z.enum(['CONTADO', 'CREDITO']),
      dias: z.coerce.number().int().min(0).max(365),
      moneda: z.enum(['PEN', 'USD']),
    })
    .safeParse({
      operacion_id: dato(formulario, 'operacion_id'),
      proveedor_id: dato(formulario, 'proveedor_id'),
      referencia: dato(formulario, 'referencia'),
      motivo: dato(formulario, 'motivo'),
      fecha_estimada: dato(formulario, 'fecha_estimada') || undefined,
      condicion: dato(formulario, 'condicion'),
      dias: dato(formulario, 'dias'),
      moneda: dato(formulario, 'moneda'),
    })
  if (!cabecera.success) return { ok: false, error: cabecera.error.issues[0]?.message ?? 'Revisa la orden de compra.' }
  if (cabecera.data.referencia && cabecera.data.referencia.length < 2) {
    return { ok: false, error: 'La referencia del proveedor va de 2 a 100 caracteres, o déjala vacía.' }
  }
  if (
    (cabecera.data.condicion === 'CONTADO' && cabecera.data.dias !== 0) ||
    (cabecera.data.condicion === 'CREDITO' && cabecera.data.dias === 0)
  ) {
    return { ok: false, error: 'Indica 0 días para contado o un plazo de 1 a 365 días para crédito.' }
  }

  let crudas: unknown
  try {
    crudas = JSON.parse(dato(formulario, 'lineas') || '[]')
  } catch {
    return { ok: false, error: 'No se pudieron leer las líneas. Vuelve a cargar la pantalla.' }
  }
  const lineas = LINEAS.safeParse(crudas)
  if (!lineas.success) return { ok: false, error: lineas.error.issues[0]?.message ?? 'Revisa las líneas de la compra.' }
  if (new Set(lineas.data.map((l) => l.material_id)).size !== lineas.data.length) {
    return { ok: false, error: 'No repitas un material: suma las cantidades en una sola línea.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_compra_directa', {
    p_id: cabecera.data.operacion_id,
    p_proveedor_id: cabecera.data.proveedor_id,
    p_referencia: cabecera.data.referencia || null,
    p_motivo: cabecera.data.motivo,
    p_detalles: lineas.data,
    p_fecha: cabecera.data.fecha_estimada ?? null,
    p_condicion: cabecera.data.condicion,
    p_dias: cabecera.data.dias,
    p_moneda: cabecera.data.moneda,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== cabecera.data.operacion_id) return { ok: false, error: 'La compra no quedó registrada. Recarga la pantalla.' }

  const { data: emitida } = await supabase
    .from('ordenes_compra_materiales')
    .select('numero')
    .eq('id', cabecera.data.operacion_id)
    .maybeSingle()

  refrescar()
  return {
    ok: true,
    mensaje: `Orden ${emitida?.numero ?? ''} emitida. Espera la aprobación de Gerencia; aprobada, le llega al conductor para el recojo.`,
  }
}

/** Mandar a recojo una compra que ya se puede enviar. Mismo permiso que la base. */
export async function mandarARecojo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Mandar compras a recojo corresponde a Logística.' }
  const id = z.string().uuid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('mandar_compra_a_recojo', { p_compra: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return { ok: true, mensaje: 'Mandada a recojo: al conductor le llegó el aviso.' }
}
