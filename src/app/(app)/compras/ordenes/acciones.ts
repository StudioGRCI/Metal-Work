'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { cambiosDelFormulario, datosDeCorreccion } from '@/lib/correccion-accion'
import { CODIGO_INTERNO_LARGO, FALTA_CODIGO_INTERNO } from '@/lib/dominio/codigo-interno'
import { compraComoLogistica, exigirSesion, puede } from '@/lib/sesion'
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
  revalidatePath('/compras/gestion')
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
 * Lo que traen los dos formularios de compra (la directa y la que junta los
 * insumos de los RQ), leído una sola vez. En la de los RQ el motivo y el
 * código interno salen de los RQ en la base, así que no se exigen aquí.
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
  if (!compraComoLogistica(perfil)) {
    return { ok: false, error: puede(perfil, 'compras.crear') ? 'No tienes permiso para emitir una OC directa: tu puesto hace la de su RQA desde Atención de requerimiento.' : 'Tu perfil no puede emitir órdenes de compra.' }
  }
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
    mensaje: `Orden ${numero} emitida. Espera la aprobación de Gerencia; aprobada, prográmala en Gestión de compras con su peso para que le llegue al conductor.`,
  }
}

const INSUMOS_DE_LINEAS = z
  .array(
    z.object({
      insumos: z
        .array(z.guid('No se reconocieron los insumos marcados. Vuelve a cargar la pantalla.'))
        .min(1, 'Cada material de la orden cubre al menos un insumo de un requerimiento.')
        .max(300, 'Una orden cubre hasta 300 insumos.'),
    }),
  )
  .min(1)

/**
 * La orden de compra con los insumos que faltan de uno o varios RQ del mismo
 * tipo: una línea por material, y cada línea con los insumos que cubre. El
 * motivo y el código interno los pone la base desde los RQ
 * (`emitir_compra_de_requerimientos`, permiso `compras.crear`); cada RQ que
 * esperaba su compra pasa a «En compra».
 */
export async function emitirCompraDeInsumos(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'No tienes permiso para generar la orden de compra de los requerimientos.' }
  const leido = leerFormularioDeCompra(formulario, true)
  if (!leido.ok) return leido
  const d = leido.datos
  const insumos = INSUMOS_DE_LINEAS.safeParse(JSON.parse(dato(formulario, 'lineas') || '[]'))
  if (!insumos.success || insumos.data.length !== d.lineas.length) {
    return { ok: false, error: insumos.success ? 'Vuelve a cargar la pantalla.' : (insumos.error.issues[0]?.message ?? 'Revisa los insumos marcados.') }
  }
  const todos = insumos.data.flatMap((l) => l.insumos)
  if (new Set(todos).size !== todos.length) return { ok: false, error: 'Un insumo va en una sola línea de la orden.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('emitir_compra_de_requerimientos', {
    p_id: d.operacion_id,
    p_lineas: d.lineas.map((l, i) => ({ ...l, insumos: insumos.data[i].insumos })),
    p_proveedor_id: d.proveedor_id,
    p_referencia: d.referencia || null,
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
    mensaje: `Orden ${numero} emitida con ${todos.length} ${todos.length === 1 ? 'insumo' : 'insumos'}. Espera la aprobación de Gerencia; aprobada, prográmala en Gestión de compras con su peso y el conductor la recoge y la deja en almacén.`,
  }
}

/** Mandar a recojo una compra que ya se puede enviar. Mismo permiso que la base. */
export async function mandarARecojo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'No tienes permiso para mandar compras a recojo.' }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('mandar_compra_a_recojo', { p_compra: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return { ok: true, mensaje: 'Mandada a recojo. Prográmala en Gestión de compras con su peso para que le llegue al conductor.' }
}

/** Una línea de la OC como la muestra la corrección. */
export type LineaParaCorregir = {
  detalle_id: string
  material: string
  codigo: string | null
  unidad: string | null
  cantidad: number
  precio_unitario: number | null
}

/** Las líneas de la OC, para corregir su cantidad o su precio. Las lee quien ve compras. */
export async function lineasDeLaCompra(id: string): Promise<ResultadoAccion<LineaParaCorregir[]>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'No tienes permiso para corregir una compra.' }
  const v = z.guid().safeParse(id)
  if (!v.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('orden_compra_material_detalles')
    .select('id, cantidad, precio_unitario, creado_en, material:materiales(codigo, descripcion, unidad:unidades_medida(codigo))')
    .eq('orden_compra_id', v.data)
    .order('creado_en')
    .order('id')
  if (error) return { ok: false, error: mensajeDeError(error) }
  return {
    ok: true,
    datos: (data ?? []).map((d) => ({
      detalle_id: d.id,
      material: d.material?.descripcion ?? 'Material',
      codigo: d.material?.codigo ?? null,
      unidad: d.material?.unidad?.codigo ?? null,
      cantidad: Number(d.cantidad),
      precio_unitario: d.precio_unitario === null ? null : Number(d.precio_unitario),
    })),
  }
}

const CAMBIOS_OC = z.object({
  con_factura: z.boolean().optional(),
  codigo_interno: z.string().trim().min(2, FALTA_CODIGO_INTERNO).max(60, CODIGO_INTERNO_LARGO).optional(),
  lineas: z
    .array(
      z.object({
        detalle_id: z.guid(),
        cantidad: z
          .number({ message: 'Indica la cantidad de cada línea.' })
          .positive('La cantidad de cada línea va mayor que cero.')
          .multipleOf(0.001, 'La cantidad lleva como máximo tres decimales.')
          .optional(),
        precio_unitario: z
          .number({ message: 'Indica el precio unitario de cada línea.' })
          .min(0, 'El precio no puede ser negativo.')
          .multipleOf(0.01, 'El precio lleva como máximo dos decimales.')
          .optional(),
      }),
    )
    .max(200)
    .optional(),
})

/**
 * Corrige la OC con su motivo y su justificante: si viene con factura, su código
 * interno, y la cantidad o el precio de las líneas que todavía no entraron al
 * almacén. Mismo permiso que `corregir_orden_compra` en la base; si el precio
 * sube, la aprobación de Gerencia se vuelve a pedir sola.
 */
export async function corregirCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'No tienes permiso para corregir una compra.' }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció la compra. Vuelve a cargar la pantalla.' }
  const correccion = datosDeCorreccion(formulario)
  if (!correccion.ok) return correccion
  const cambios = CAMBIOS_OC.safeParse(cambiosDelFormulario(formulario))
  if (!cambios.success) return { ok: false, error: cambios.error.issues[0]?.message ?? 'Revisa lo que corriges.' }

  const supabase = await createClient()
  const c = correccion.datos
  const { data, error } = await supabase.rpc('corregir_orden_compra', {
    p_correccion: c.correccion_id,
    p_id: id.data,
    p_motivo: c.motivo,
    p_justificante: c.justificante_ruta,
    p_nombre: c.justificante_nombre,
    p_cambios: cambios.data,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id.data) return { ok: false, error: 'La compra no se corrigió. Vuelve a cargar la pantalla.' }

  refrescar()
  revalidatePath('/adquisiciones')
  return { ok: true, mensaje: 'Compra corregida, con su justificante.' }
}
