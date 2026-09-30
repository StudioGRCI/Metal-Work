'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const errores: Record<string, string> = {
  'No hay suficiente material recibido': 'No hay saldo recibido suficiente para esa entrega.',
  'La entrega supera la cantidad solicitada': 'La cantidad supera lo que esta área solicitó.',
  'La persona debe estar activa': 'Elige a una persona activa del área que recibirá el material.',
  'La recepción supera lo pendiente': 'La cantidad ingresada supera lo que falta recibir de la compra.',
  'La cantidad excede lo que falta comprar': 'La cantidad supera lo que todavía falta comprar.',
  'Solo puedes solicitar materiales': 'Solo puedes solicitar materiales para tu área.',
  'Registra el precio unitario': 'Registra el precio unitario de cada insumo antes de entregar la compra.',
  'Adjunta la factura': 'Adjunta la factura PDF para Tesorería antes de entregar la compra a Almacén.',
  'Logística debe marcar la entrega': 'Logística debe confirmar la entrega antes de que Almacén registre la recepción.',
}

function errorDeMaterial(error: { message: string; code?: string }) {
  const regla = Object.entries(errores).find(([texto]) => error.message.includes(texto))
  return regla?.[1] ?? mensajeDeError(error)
}

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

export async function resolverPropuesta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) return { ok: false, error: 'Diseño aprueba las propuestas de materiales.' }
  const v = z.object({ detalle_id: z.string().uuid(), decision: z.enum(['aprobar', 'rechazar']) })
    .safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Elige una propuesta y una decisión válidas.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('resolver_propuesta_material', {
    p_detalle: v.data.detalle_id, p_aprobar: v.data.decision === 'aprobar',
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (!data) return { ok: false, error: 'La propuesta no cambió. Recarga la pantalla.' }
  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: v.data.decision === 'aprobar' ? 'Material aprobado para Almacén.' : 'Propuesta rechazada.' }
}

export async function revisarStock(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.ver')) return { ok: false, error: 'Almacén revisa el stock.' }
  const v = z.object({ detalle_id: z.string().uuid(), decision: z.enum(['STOCK', 'COMPRA']) })
    .safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Elige el material y la decisión de stock.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('revisar_stock_requerimiento', {
    p_detalle: v.data.detalle_id, p_decision: v.data.decision,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (!data) return { ok: false, error: 'La revisión no cambió. Recarga la pantalla.' }
  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: v.data.decision === 'STOCK' ? 'Stock reservado para despacho.' : 'Material derivado a Logística.' }
}

export async function registrarConteo(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.ver')) return { ok: false, error: 'Solo Almacén registra el conteo físico.' }
  const v = z.object({
    operacion_id: z.string().uuid(), material_id: z.string().uuid(),
    cantidad_fisica: z.coerce.number().min(0), motivo: z.string().trim().min(10).max(300),
  }).safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Indica el saldo físico y un motivo de 10 a 300 caracteres.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_conteo_almacen', {
    p_id: v.data.operacion_id, p_material: v.data.material_id,
    p_cantidad_fisica: v.data.cantidad_fisica, p_motivo: v.data.motivo,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (!data) return { ok: false, error: 'El conteo no quedó registrado. Recarga la pantalla.' }
  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: 'Conteo físico registrado. Revisa de nuevo la decisión de stock.' }
}

export async function registrarPrecioCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Logística registra el precio del insumo.' }
  const v = z.object({ detalle_id: z.string().uuid(), precio: z.coerce.number().min(0) })
    .safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Indica un precio unitario válido.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fijar_precio_compra_material', {
    p_detalle: v.data.detalle_id, p_precio: v.data.precio,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (!data) return { ok: false, error: 'El precio no quedó registrado. Recarga la pantalla.' }
  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: 'Precio unitario registrado.' }
}

export async function fijarCondicionCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Logística define la condición de pago.' }
  const v = z.object({
    compra_id: z.string().uuid(), condicion: z.enum(['CONTADO','CREDITO']),
    dias: z.coerce.number().int().min(0).max(365), moneda: z.enum(['PEN','USD']),
  }).safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'Indica condición, plazo y moneda válidos.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('fijar_condicion_pago_compra', {
    p_compra: v.data.compra_id, p_condicion: v.data.condicion,
    p_dias: v.data.dias, p_moneda: v.data.moneda,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (data !== v.data.compra_id) return { ok: false, error: 'La condición no cambió. Recarga la compra.' }
  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  revalidatePath('/tesoreria/cuentas')
  return { ok: true, mensaje: 'Condición de pago guardada para Tesorería.' }
}

export async function marcarEntregaCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Logística confirma la entrega al almacén.' }
  const v = z.object({ compra_id: z.string().uuid() }).safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: 'La compra no es válida.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('marcar_compra_entregada_almacen', { p_compra: v.data.compra_id })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (!data) return { ok: false, error: 'La entrega no quedó registrada. Recarga la pantalla.' }
  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: 'Entrega a Almacén confirmada.' }
}

export async function crearOrdenCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Tu perfil no puede registrar compras.' }

  const cabecera = z.object({
    operacion_id: z.string().uuid(),
    proveedor: z.string().trim().min(2).max(160),
    referencia: z.string().trim().min(2).max(100),
    fecha_estimada: z.iso.date().optional(),
    condicion: z.enum(['CONTADO','CREDITO']),
    dias: z.coerce.number().int().min(0).max(365),
    moneda: z.enum(['PEN','USD']),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    proveedor: dato(formulario, 'proveedor'),
    referencia: dato(formulario, 'referencia'),
    fecha_estimada: dato(formulario, 'fecha_estimada') || undefined,
    condicion: dato(formulario, 'condicion'),
    dias: dato(formulario, 'dias'),
    moneda: dato(formulario, 'moneda'),
  })
  const ids = formulario.getAll('detalle_id')
  const lineas = z.array(z.object({
    id: z.string().uuid(),
    cantidad: z.coerce.number().positive(),
    precio: z.coerce.number().min(0).multipleOf(0.01),
  })).min(1).max(100).safeParse(ids.map((id) => ({
    id,
    cantidad: dato(formulario, `cantidad_${String(id)}`),
    precio: dato(formulario, `precio_${String(id)}`),
  })))
  if (!cabecera.success || !lineas.success) {
    return { ok: false, error: 'Revisa proveedor, referencia, fecha, pago y cantidades a comprar.' }
  }
  if ((cabecera.data.condicion === 'CONTADO' && cabecera.data.dias !== 0) ||
      (cabecera.data.condicion === 'CREDITO' && cabecera.data.dias === 0)) {
    return { ok: false, error: 'Indica 0 días para contado o un plazo de 1 a 365 días para crédito.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('crear_compra_agrupada', {
    p_id: cabecera.data.operacion_id,
    p_proveedor: cabecera.data.proveedor,
    p_referencia: cabecera.data.referencia,
    p_fecha: cabecera.data.fecha_estimada ?? null,
    p_detalles: lineas.data,
    p_condicion: cabecera.data.condicion,
    p_dias: cabecera.data.dias,
    p_moneda: cabecera.data.moneda,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (data !== cabecera.data.operacion_id) return { ok: false, error: 'La compra no quedó registrada. Recarga la pantalla.' }

  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  revalidatePath('/tesoreria/cuentas')
  return { ok: true, mensaje: 'Compra y condición de pago registradas; Almacén ya puede esperar su recepción.' }
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
  const { data, error } = await supabase.rpc('registrar_recepcion_material', {
    p_id: datos.data.operacion_id,
    p_orden_compra_detalle_id: datos.data.compra_detalle_id,
    p_cantidad: datos.data.cantidad,
    p_documento_referencia: datos.data.documento_referencia,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (data !== datos.data.operacion_id) return {ok:false,error:NO_TOCO_NADA}

  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
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
    recibido_por_nombre: z.string().trim().min(3).max(160),
    foto_ruta: z.string().min(40).max(200),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    requerimiento_detalle_id: dato(formulario, 'requerimiento_detalle_id'),
    cantidad: dato(formulario, 'cantidad'),
    responsable_id: dato(formulario, 'responsable_id'),
    recibido_por_nombre: dato(formulario, 'recibido_por_nombre'),
    foto_ruta: dato(formulario, 'foto_ruta'),
  })
  if (!datos.success) return { ok: false, error: 'Indica una cantidad y quién recibe el material.' }

  const supabase = await createClient()
  const { data: objeto, error: lectura } = await supabase.storage.from('evidencias-almacen').download(datos.data.foto_ruta)
  if(lectura || !objeto || objeto.size>10485760) return {ok:false,error:'No se pudo verificar la foto. Vuelve a cargarla.'}
  const cabecera = new Uint8Array(await objeto.slice(0,12).arrayBuffer())
  const jpg=cabecera[0]===255&&cabecera[1]===216&&cabecera[2]===255
  const png=[137,80,78,71,13,10,26,10].every((n,i)=>cabecera[i]===n)
  const webp=new TextDecoder().decode(cabecera.slice(0,4))==='RIFF'&&new TextDecoder().decode(cabecera.slice(8,12))==='WEBP'
  if(!jpg&&!png&&!webp) return {ok:false,error:'El archivo debe ser una foto JPG, PNG o WebP válida.'}
  const { data, error } = await supabase.rpc('despachar_material_con_foto', {
    p_id: datos.data.operacion_id,
    p_detalle: datos.data.requerimiento_detalle_id,
    p_cantidad: datos.data.cantidad,
    p_responsable: datos.data.responsable_id,
    p_recibe: datos.data.recibido_por_nombre,
    p_foto: datos.data.foto_ruta,
  })
  if (error) return { ok: false, error: errorDeMaterial(error) }
  if (data !== datos.data.operacion_id) return {ok:false,error:NO_TOCO_NADA}

  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: 'Entrega registrada con la persona responsable del área.' }
}

export async function registrarIngresoGeneral(_previo:unknown,formulario:FormData):Promise<ResultadoAccion> {
  const perfil=await exigirSesion()
  if(!puede(perfil,'almacen.recibir')) return {ok:false,error:'Solo Almacén registra sus ingresos.'}
  const v=z.object({operacion_id:z.string().uuid(),material_id:z.string().uuid(),cantidad:z.coerce.number().positive().multipleOf(0.001),
    origen:z.enum(['SALDO_INICIAL','INGRESO_GENERAL','DEVOLUCION']),documento:z.string().trim().min(2).max(100),
    precio:z.coerce.number().min(0).multipleOf(0.01).optional(),moneda:z.enum(['PEN','USD']),devolucion:z.string().uuid().optional()})
    .safeParse({...Object.fromEntries(formulario),precio:dato(formulario,'precio')||undefined,devolucion:dato(formulario,'devolucion')||undefined})
  if(!v.success) return {ok:false,error:'Revisa el material, cantidad, referencia y valor del ingreso.'}
  const db=await createClient()
  const {data,error}=await db.rpc('registrar_ingreso_almacen',{p_id:v.data.operacion_id,p_material:v.data.material_id,p_cantidad:v.data.cantidad,
    p_origen:v.data.origen,p_documento:v.data.documento,p_precio:v.data.precio??null,p_moneda:v.data.moneda,p_devolucion:v.data.devolucion??null})
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(data!==v.data.operacion_id) return {ok:false,error:NO_TOCO_NADA}
  revalidatePath('/compras')
  revalidatePath('/almacen/stock');revalidatePath('/ordenes/[id]','page')
  return {ok:true,mensaje:'Ingreso registrado en el kardex de Almacén.'}
}
