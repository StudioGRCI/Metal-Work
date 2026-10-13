'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { CODIGO_INTERNO_LARGO, FALTA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
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
      material_id: z.guid('Elige el material de cada línea.'),
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

type FormularioDeCompra = {
  operacion_id: string
  proveedor_id: string
  referencia: string
  motivo: string
  fecha_estimada?: string
  condicion: 'CONTADO' | 'CREDITO'
  dias: number
  moneda: 'PEN' | 'USD'
  con_factura: boolean
  codigo_interno: string
  lineas: z.infer<typeof LINEAS>
}

/**
 * Lo que traen los dos formularios de compra (la directa y la que nace del
 * requerimiento), leído una sola vez. En la del requerimiento el motivo y el
 * código interno salen del RQ en la base, así que no se exigen aquí.
 */
function leerFormularioDeCompra(formulario: FormData, delRequerimiento: boolean): { ok: true; datos: FormularioDeCompra } | { ok: false; error: string } {
  const cabecera = z
    .object({
      operacion_id: z.guid(),
      proveedor_id: z.guid('Elige el proveedor del padrón. Si es nuevo, regístralo con «Nuevo».'),
      referencia: z.string().trim().max(100, 'La referencia del proveedor pasa de 100 caracteres.'),
      motivo: delRequerimiento
        ? z.string().trim().max(500).default('')
        : z
            .string()
            .trim()
            .min(5, 'Cuenta por qué se compra sin requerimiento: Gerencia lo lee al aprobar.')
            .max(500, 'El motivo pasa de 500 caracteres.'),
      fecha_estimada: z.iso.date().optional(),
      condicion: z.enum(['CONTADO', 'CREDITO']),
      dias: z.coerce.number().int().min(0).max(365),
      moneda: z.enum(['PEN', 'USD']),
      con_factura: z.enum(['true', 'false'], { message: 'Indica si la compra viene con factura o sin factura.' }),
      codigo_interno: delRequerimiento
        ? z.string().trim().max(60).default('')
        : z.string().trim().min(2, FALTA_CODIGO_INTERNO).max(60, CODIGO_INTERNO_LARGO),
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
      con_factura: dato(formulario, 'con_factura'),
      codigo_interno: dato(formulario, 'codigo_interno'),
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
  return { ok: true, datos: { ...cabecera.data, con_factura: cabecera.data.con_factura === 'true', lineas: lineas.data } }
}

async function numeroEmitido(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase.from('ordenes_compra_materiales').select('numero').eq('id', id).maybeSingle()
  return data?.numero ?? ''
}

/**
 * La orden de compra directa: sin requerimiento ni OT. Exige `compras.crear`,
 * el mismo permiso que pide `emitir_compra_directa` en la base. La aprobación
 * de Gerencia la decide la base al cerrar la transacción: la directa siempre la
 * pide.
 */
export async function emitirCompraDirecta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede emitir órdenes de compra.' }
  const leido = leerFormularioDeCompra(formulario, false)
  if (!leido.ok) return leido
  const d = leido.datos

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_compra_directa', {
    p_id: d.operacion_id,
    p_proveedor_id: d.proveedor_id,
    p_referencia: d.referencia || null,
    p_motivo: d.motivo,
    p_detalles: d.lineas,
    p_fecha: d.fecha_estimada ?? null,
    p_condicion: d.condicion,
    p_dias: d.dias,
    p_moneda: d.moneda,
    p_con_factura: d.con_factura,
    p_codigo_interno: d.codigo_interno,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La compra no quedó registrada. Recarga la pantalla.' }

  const numero = await numeroEmitido(supabase, d.operacion_id)
  refrescar()
  return {
    ok: true,
    mensaje: `Orden ${numero} emitida. Espera la aprobación de Gerencia; aprobada, le llega al conductor para el recojo.`,
  }
}

/**
 * La orden de compra que nace del requerimiento que Almacén dejó sin stock:
 * los mismos datos que la directa más el RQ y qué insumos cubre. El motivo y
 * el código interno los toma la base del RQ (`emitir_compra_del_requerimiento`,
 * permiso `compras.crear`), y el RQ pasa a «En compra» con la misma función.
 */
export async function emitirCompraDelRequerimiento(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Generar la orden de compra del requerimiento corresponde a Logística.' }
  const rq = z.guid().safeParse(dato(formulario, 'requerimiento_id'))
  if (!rq.success) return { ok: false, error: 'No se reconoció el requerimiento. Vuelve a cargar la pantalla.' }
  const items = z
    .array(z.coerce.number().int().min(1).max(100))
    .min(1, 'Marca al menos un insumo del requerimiento que cubre esta orden.')
    .safeParse(formulario.getAll('item').filter((v): v is string => typeof v === 'string'))
  if (!items.success) return { ok: false, error: items.error.issues[0]?.message ?? 'Revisa los insumos marcados.' }
  const leido = leerFormularioDeCompra(formulario, true)
  if (!leido.ok) return leido
  const d = leido.datos

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_compra_del_requerimiento', {
    p_id: d.operacion_id,
    p_requerimiento_id: rq.data,
    p_items: items.data,
    p_proveedor_id: d.proveedor_id,
    p_referencia: d.referencia || null,
    p_detalles: d.lineas,
    p_fecha: d.fecha_estimada ?? null,
    p_condicion: d.condicion,
    p_dias: d.dias,
    p_moneda: d.moneda,
    p_con_factura: d.con_factura,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.operacion_id) return { ok: false, error: 'La compra no quedó registrada. Recarga la pantalla.' }

  const numero = await numeroEmitido(supabase, d.operacion_id)
  refrescar()
  revalidatePath('/requerimientos')
  revalidatePath('/requerimientos/atencion')
  return {
    ok: true,
    mensaje: `Orden ${numero} emitida para el requerimiento. Espera la aprobación de Gerencia; aprobada, el conductor la recoge y la deja en almacén.`,
  }
}

/** Mandar a recojo una compra que ya se puede enviar. Mismo permiso que la base. */
export async function mandarARecojo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Mandar compras a recojo corresponde a Logística.' }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('mandar_compra_a_recojo', { p_compra: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return { ok: true, mensaje: 'Mandada a recojo: al conductor le llegó el aviso.' }
}

/**
 * Corrige si la compra viene con factura y su código interno. Mismo permiso que
 * `fijar_datos_compra` en la base, que además no deja cambiar lo de la factura
 * cuando el comprobante ya está adjunto.
 */
export async function corregirDatosCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Corregir una compra corresponde a Logística.' }
  const v = z
    .object({
      id: z.guid(),
      con_factura: z.enum(['true', 'false'], { message: 'Indica si la compra viene con factura o sin factura.' }),
      codigo_interno: z.string().trim().min(2, FALTA_CODIGO_INTERNO).max(60, CODIGO_INTERNO_LARGO),
    })
    .safeParse({ id: dato(formulario, 'id'), con_factura: dato(formulario, 'con_factura'), codigo_interno: dato(formulario, 'codigo_interno') })
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa los datos de la compra.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fijar_datos_compra', {
    p_compra: v.data.id,
    p_con_factura: v.data.con_factura === 'true',
    p_codigo_interno: v.data.codigo_interno,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.id) return { ok: false, error: 'La compra no cambió. Vuelve a cargar la pantalla.' }

  refrescar()
  return { ok: true, mensaje: 'Compra corregida.' }
}
