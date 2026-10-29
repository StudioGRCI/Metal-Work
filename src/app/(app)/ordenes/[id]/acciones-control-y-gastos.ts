'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion, mensajeDeArchivo } from '@/lib/acciones'
import { moneda } from '@/lib/format'
import { ocupada, quitarEnElActo, subirARutaNueva } from '@/lib/ruta-nueva'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

const uuid = z.guid()
const pdfMaximo = 15 * 1024 * 1024

/**
 * Quita el PDF que ninguna fila nombra. Dice que sí solo si Storage lo quitó:
 * un borrado que la política no deja ver afecta cero archivos sin error, y la
 * pantalla decía «el PDF subido se retiró» sin haberlo hecho (duodécima pasada).
 */
async function quitarSuelto(db: Awaited<ReturnType<typeof createClient>>, cubeta: 'gastos-ot' | 'control-ot', ruta: string) {
  const { data, error } = await db.storage.from(cubeta).remove([ruta])
  return !error && (data?.length ?? 0) > 0
}

/** El PDF guardado es este mismo, byte a byte. Si no se puede leer, no se da por el mismo. */
async function mismoContenido(db: Awaited<ReturnType<typeof createClient>>, ruta: string | null, bytes: Uint8Array) {
  if (!ruta) return false
  const { data } = await db.storage.from('gastos-ot').download(ruta)
  if (!data) return false
  const guardado = new Uint8Array(await data.arrayBuffer())
  return guardado.length === bytes.length && guardado.every((b, i) => b === bytes[i])
}

async function leerPdf(datos: FormData) {
  const archivo = datos.get('pdf')
  if (!(archivo instanceof File) || archivo.size < 5 || archivo.size > pdfMaximo || archivo.type !== 'application/pdf') return null
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return null
  return { archivo, bytes }
}

export async function registrarGastoArea(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.registrar_gasto') || !perfil.area_id) return { ok: false, error: 'Tu cuenta no tiene área habilitada para registrar gastos.' }
  const entrada = z.object({
    id: uuid, orden_id: uuid,
    tipo: z.enum(['SERVICIO','TRANSPORTE','VIATICO','SUBCONTRATO','OTRO','TRAMITE','COMISION']),
    descripcion: z.string().trim().min(10).max(500),
    fecha: z.iso.date(),
    monto: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
    moneda: z.enum(['PEN','USD']),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Revisa la fecha, descripción, importe y moneda del gasto.' }
  const pdf = await leerPdf(datos)
  if (!pdf) return { ok: false, error: 'Adjunta un comprobante PDF válido de hasta 15 MB.' }
  const v = entrada.data
  if (Number(v.monto) <= 0) return { ok: false, error: 'El importe debe ser mayor que cero.' }
  const db = await createClient()
  const { data: previo, error: previoError } = await db.from('ot_gastos_areas')
    .select('id, registrado_por, orden_id, tipo, descripcion, fecha, monto, moneda, comprobante_nombre, comprobante_ruta').eq('id', v.id).maybeSingle()
  if (previoError) return { ok: false, error: mensajeDeError(previoError) }
  if (previo) {
    if (previo.registrado_por !== perfil.id) return { ok: false, error: 'El identificador del gasto ya está en uso.' }
    // El mismo envío repetido trae todo igual, también el PDF: otro con el
    // mismo nombre no es el mismo. Con otro importe, otra descripción u otro
    // PDF ya no es el mismo envío: antes se daba por registrado y la pantalla
    // se vaciaba con lo de la primera vez guardado (duodécima y decimotercera pasadas).
    const mismo = previo.orden_id === v.orden_id && previo.tipo === v.tipo && previo.descripcion === v.descripcion
      && previo.fecha === v.fecha && Number(previo.monto) === Number(v.monto) && previo.moneda === v.moneda
      && previo.comprobante_nombre === pdf.archivo.name.slice(0, 200)
      && await mismoContenido(db, previo.comprobante_ruta, pdf.bytes)
    // Lo que entró y cómo se corrige: «recarga la pantalla» solo dejaba el
    // formulario vacío, que se leía como que el cambio había entrado.
    return mismo
      ? { ok: true, mensaje: `El gasto ${previo.id} ya estaba registrado.` }
      : { ok: false, error: `Este gasto ya quedó registrado la primera vez que lo enviaste, por ${moneda(previo.monto, previo.moneda === 'USD' ? 'USD' : 'PEN')}, y lo que cambiaste después no se guardó. Está en la lista de abajo; si algo está mal, pide a Administración que lo observe.` }
  }
  const ruta = `ot/${v.orden_id}/gastos/${v.id}.pdf`
  const cubeta = db.storage.from('gastos-ot')
  let { error: errorArchivo } = await subirARutaNueva(cubeta, ruta, pdf.bytes, 'application/pdf', quitarEnElActo)
  // Ninguna fila nombra todavía la ruta de este gasto: lo que ocupa la ruta lo
  // dejó un intento anterior del mismo formulario (la subida llegó y la
  // respuesta no), `subirARutaNueva` ya lo quitó, y se sube otra vez. Antes
  // cada reintento chocaba con ese archivo para siempre. Quitarlo pide que su
  // dueño lo vea mientras ninguna fila lo nombra (migración 20261022193000).
  if (ocupada(errorArchivo)) ({ error: errorArchivo } = await subirARutaNueva(cubeta, ruta, pdf.bytes, 'application/pdf', quitarEnElActo))
  if (errorArchivo) return { ok: false, error: `No se pudo subir el comprobante: ${mensajeDeArchivo(errorArchivo)}` }
  try {
    const { data, error } = await db.from('ot_gastos_areas').insert({
      id: v.id, orden_id: v.orden_id, area_id: perfil.area_id, tipo: v.tipo,
      descripcion: v.descripcion, fecha: v.fecha, monto: Number(v.monto),
      moneda: v.moneda, comprobante_ruta: ruta, comprobante_nombre: pdf.archivo.name.slice(0, 200),
    }).select('id').maybeSingle()
    if (error || !data) {
      const retirado = await quitarSuelto(db, 'gastos-ot', ruta)
      return { ok: false, error: retirado
        ? mensajeDeError(error ?? { message: NO_TOCO_NADA })
        : `No se registró el gasto y no se pudo retirar el PDF huérfano: ${mensajeDeError(error ?? { message: NO_TOCO_NADA })}` }
    }
    revalidatePath(`/ordenes/${v.orden_id}`)
    return { ok: true, mensaje: `Gasto ${data.id} enviado a Administración para revisión.` }
  } catch {
    return { ok: false, error: (await quitarSuelto(db, 'gastos-ot', ruta))
      ? 'No se pudo registrar el gasto; el PDF subido se retiró.'
      : 'No se pudo registrar el gasto y el PDF subido requiere revisión de Administración.' }
  }
}

export async function revisarGastoArea(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.revisar_gasto')) return { ok: false, error: 'No tienes permiso para revisar estos gastos.' }
  const entrada = z.object({
    id: uuid, orden_id: uuid, estado: z.enum(['APROBADO','OBSERVADO']),
    observacion_revision: z.string().trim().max(1000),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Revisa la decisión.' }
  const v = entrada.data
  if (v.estado === 'OBSERVADO' && v.observacion_revision.length < 5) return { ok: false, error: 'Describe por qué se observa el gasto.' }
  const db = await createClient()
  const { data, error } = await db.from('ot_gastos_areas')
    .update({ estado: v.estado, observacion_revision: v.estado === 'OBSERVADO' ? v.observacion_revision : null,
      revisado_por: perfil.id, revisado_en: new Date().toISOString() })
    .eq('id', v.id).eq('orden_id', v.orden_id).eq('estado', 'PENDIENTE')
    .select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: `Gasto ${data.id} ${v.estado === 'APROBADO' ? 'aprobado' : 'observado'}.` }
}

const controlEntrada = z.object({
  orden_id: uuid,
  accion: z.enum(['GUARDAR','CERRAR_INGRESO','CERRAR_SALIDA']),
  placa: z.string().trim().max(30),
  marca: z.string().trim().max(80),
  conductor_ingreso: z.string().trim().max(120),
  dni_ingreso: z.string().trim().max(20),
  fecha_ingreso: z.union([z.iso.date(), z.literal('')]),
  combustible_ingreso: z.string().trim().max(40),
  conductor_salida: z.string().trim().max(120),
  dni_salida: z.string().trim().max(20),
  fecha_salida: z.union([z.iso.date(), z.literal('')]),
  combustible_salida: z.string().trim().max(40),
  adicionales: z.string().trim().max(2000),
  trabajos: z.string().trim().max(2000),
  observacion_ingreso: z.string().trim().max(2000),
  observacion_salida: z.string().trim().max(2000),
})

export async function guardarControlVehicular(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.controlar_ot')) return { ok: false, error: 'No tienes permiso para registrar el control vehicular.' }
  const entrada = controlEntrada.safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Revisa los datos de la ficha vehicular.' }
  const v = entrada.data
  const db = await createClient()
  const [existente, catalogo] = await Promise.all([
    db.from('ot_control_vehicular').select('id, items, ingreso_cerrado_en, salida_cerrada_en, placa, marca, conductor_ingreso, dni_ingreso, fecha_ingreso, combustible_ingreso, observacion_ingreso').eq('orden_id', v.orden_id).maybeSingle(),
    db.from('control_vehicular_items').select('codigo'),
  ])
  if (existente.error) return { ok: false, error: mensajeDeError(existente.error) }
  if (catalogo.error) return { ok: false, error: mensajeDeError(catalogo.error) }
  if (!catalogo.data?.length) return { ok: false, error: 'No se cargaron los puntos del formato vehicular.' }
  if (existente.data?.salida_cerrada_en) return { ok: false, error: 'La ficha ya está cerrada; solo puedes adjuntar el escaneo firmado.' }
  const anteriores = z.record(z.string(), z.object({ ingreso: z.string().optional(), salida: z.string().optional() })).safeParse(existente.data?.items)
  const items: Record<string, { ingreso?: string; salida?: string }> = anteriores.success ? anteriores.data : {}
  const estados = ['CONFORME','NO_TIENE','OBSERVADO']
  for (const punto of catalogo.data) {
    const anterior = items[punto.codigo] ?? {}
    const ingreso = datos.get(`ingreso_${punto.codigo}`)
    const salida = datos.get(`salida_${punto.codigo}`)
    items[punto.codigo] = {
      ingreso: existente.data?.ingreso_cerrado_en ? anterior.ingreso : (typeof ingreso === 'string' && estados.includes(ingreso) ? ingreso : undefined),
      salida: typeof salida === 'string' && estados.includes(salida) ? salida : anterior.salida,
    }
  }
  const base = {
    placa: existente.data?.ingreso_cerrado_en ? existente.data.placa : v.placa,
    marca: existente.data?.ingreso_cerrado_en ? existente.data.marca : v.marca,
    conductor_ingreso: existente.data?.ingreso_cerrado_en ? existente.data.conductor_ingreso : v.conductor_ingreso,
    dni_ingreso: existente.data?.ingreso_cerrado_en ? existente.data.dni_ingreso : v.dni_ingreso,
    fecha_ingreso: existente.data?.ingreso_cerrado_en ? existente.data.fecha_ingreso : v.fecha_ingreso || null,
    combustible_ingreso: existente.data?.ingreso_cerrado_en ? existente.data.combustible_ingreso : v.combustible_ingreso,
    conductor_salida: v.conductor_salida,
    dni_salida: v.dni_salida, fecha_salida: v.fecha_salida || null,
    combustible_salida: v.combustible_salida, adicionales: v.adicionales,
    trabajos: v.trabajos, observacion_ingreso: existente.data?.ingreso_cerrado_en ? existente.data.observacion_ingreso : v.observacion_ingreso,
    observacion_salida: v.observacion_salida, items: items as Json,
    ...(v.accion === 'CERRAR_INGRESO' ? { ingreso_cerrado_en: new Date().toISOString() } : {}),
    ...(v.accion === 'CERRAR_SALIDA' ? { salida_cerrada_en: new Date().toISOString() } : {}),
  }
  const resultado = existente.data
    ? await db.from('ot_control_vehicular').update(base).eq('id', existente.data.id).eq('orden_id', v.orden_id).select('id, ingreso_cerrado_en, salida_cerrada_en').maybeSingle()
    : await db.from('ot_control_vehicular').insert({ orden_id: v.orden_id, ...base }).select('id, ingreso_cerrado_en, salida_cerrada_en').maybeSingle()
  if (resultado.error) return { ok: false, error: mensajeDeError(resultado.error) }
  if (!resultado.data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: `Ficha ${resultado.data.id} ${v.accion === 'GUARDAR' ? 'guardada' : v.accion === 'CERRAR_INGRESO' ? 'con ingreso cerrado' : 'con salida cerrada'}.` }
}

export async function adjuntarControlFirmado(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.controlar_ot')) return { ok: false, error: 'No tienes permiso para adjuntar el escaneo del control vehicular.' }
  const ordenId = uuid.safeParse(datos.get('orden_id'))
  if (!ordenId.success) return { ok: false, error: 'La OT no es válida.' }
  const pdf = await leerPdf(datos)
  if (!pdf) return { ok: false, error: 'Adjunta el escaneo firmado en PDF, hasta 15 MB.' }
  const db = await createClient()
  const { data: control, error: lectura } = await db.from('ot_control_vehicular')
    .select('id, salida_cerrada_en, escaneo_ruta').eq('orden_id', ordenId.data).maybeSingle()
  if (lectura) return { ok: false, error: mensajeDeError(lectura) }
  // Ya con su escaneo: también es el reintento de un envío que entró y cuya
  // respuesta se perdió, y decirle que cierre la salida lo confundía.
  if (control?.escaneo_ruta) return { ok: false, error: 'La ficha ya tiene su escaneo firmado: recarga la pantalla para verlo. Solo se admite uno.' }
  if (!control?.salida_cerrada_en) return { ok: false, error: 'Cierra la salida antes de adjuntar el escaneo.' }
  const ruta = `ot/${ordenId.data}/control/${crypto.randomUUID()}.pdf`
  const { error: subida } = await subirARutaNueva(db.storage.from('control-ot'), ruta, pdf.bytes, 'application/pdf', quitarEnElActo)
  if (subida) return { ok: false, error: `No se pudo subir el escaneo: ${mensajeDeArchivo(subida)}` }
  try {
    const { data, error } = await db.from('ot_control_vehicular').update({
      escaneo_ruta: ruta, escaneo_nombre: pdf.archivo.name.slice(0, 200),
    }).eq('id', control.id).is('escaneo_ruta', null).select('id').maybeSingle()
    if (error || !data) {
      await quitarSuelto(db, 'control-ot', ruta)
      return { ok: false, error: mensajeDeError(error ?? { message: NO_TOCO_NADA }) }
    }
    revalidatePath(`/ordenes/${ordenId.data}`)
    return { ok: true, mensaje: `Escaneo firmado agregado a la ficha ${data.id}.` }
  } catch {
    return { ok: false, error: (await quitarSuelto(db, 'control-ot', ruta))
      ? 'No se pudo asociar el escaneo; el PDF subido se retiró.'
      : 'No se pudo asociar el escaneo y el PDF subido requiere revisión de Administración.' }
  }
}
