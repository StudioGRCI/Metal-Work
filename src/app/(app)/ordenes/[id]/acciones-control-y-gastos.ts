'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

const uuid = z.string().uuid()
const pdfMaximo = 15 * 1024 * 1024

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
    tipo: z.enum(['SERVICIO','TRANSPORTE','VIATICO','SUBCONTRATO','OTRO']),
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
    .select('id, registrado_por').eq('id', v.id).maybeSingle()
  if (previoError) return { ok: false, error: mensajeDeError(previoError) }
  if (previo) return previo.registrado_por === perfil.id
    ? { ok: true, mensaje: `El gasto ${previo.id} ya estaba registrado.` }
    : { ok: false, error: 'El identificador del gasto ya está en uso.' }
  const ruta = `ot/${v.orden_id}/gastos/${v.id}.pdf`
  const { error: errorArchivo } = await db.storage.from('gastos-ot').upload(ruta, pdf.bytes, { contentType: 'application/pdf', upsert: false })
  if (errorArchivo) return { ok: false, error: `No se pudo subir el comprobante: ${errorArchivo.message}` }
  try {
    const { data, error } = await db.from('ot_gastos_areas').insert({
      id: v.id, orden_id: v.orden_id, area_id: perfil.area_id, tipo: v.tipo,
      descripcion: v.descripcion, fecha: v.fecha, monto: Number(v.monto),
      moneda: v.moneda, comprobante_ruta: ruta, comprobante_nombre: pdf.archivo.name.slice(0, 200),
    }).select('id').maybeSingle()
    if (error || !data) {
      const { error: limpieza } = await db.storage.from('gastos-ot').remove([ruta])
      return { ok: false, error: limpieza
        ? `No se registró el gasto y no se pudo retirar el PDF huérfano: ${mensajeDeError(error ?? { message: NO_TOCO_NADA })}`
        : mensajeDeError(error ?? { message: NO_TOCO_NADA }) }
    }
    revalidatePath(`/ordenes/${v.orden_id}`)
    return { ok: true, mensaje: `Gasto ${data.id} enviado a Administración para revisión.` }
  } catch {
    const { error: limpieza } = await db.storage.from('gastos-ot').remove([ruta])
    return { ok: false, error: limpieza
      ? 'No se pudo registrar el gasto y el PDF subido requiere revisión de Administración.'
      : 'No se pudo registrar el gasto; el PDF subido se retiró.' }
  }
}

export async function revisarGastoArea(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'costos.revisar_gasto')) return { ok: false, error: 'Solo Administración revisa estos gastos.' }
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
  if (!puede(perfil, 'costos.controlar_ot')) return { ok: false, error: 'Solo Costos y Materiales registra la ficha vehicular.' }
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
  if (!puede(perfil, 'costos.controlar_ot')) return { ok: false, error: 'Solo Costos y Materiales adjunta el escaneo.' }
  const ordenId = uuid.safeParse(datos.get('orden_id'))
  if (!ordenId.success) return { ok: false, error: 'La OT no es válida.' }
  const pdf = await leerPdf(datos)
  if (!pdf) return { ok: false, error: 'Adjunta el escaneo firmado en PDF, hasta 15 MB.' }
  const db = await createClient()
  const { data: control, error: lectura } = await db.from('ot_control_vehicular')
    .select('id, salida_cerrada_en, escaneo_ruta').eq('orden_id', ordenId.data).maybeSingle()
  if (lectura) return { ok: false, error: mensajeDeError(lectura) }
  if (!control?.salida_cerrada_en || control.escaneo_ruta) return { ok: false, error: 'Cierra la salida antes de adjuntar el escaneo; solo se admite un archivo.' }
  const ruta = `ot/${ordenId.data}/control/${crypto.randomUUID()}.pdf`
  const { error: subida } = await db.storage.from('control-ot').upload(ruta, pdf.bytes, { contentType: 'application/pdf', upsert: false })
  if (subida) return { ok: false, error: `No se pudo subir el escaneo: ${subida.message}` }
  try {
    const { data, error } = await db.from('ot_control_vehicular').update({
      escaneo_ruta: ruta, escaneo_nombre: pdf.archivo.name.slice(0, 200),
    }).eq('id', control.id).is('escaneo_ruta', null).select('id').maybeSingle()
    if (error || !data) {
      await db.storage.from('control-ot').remove([ruta])
      return { ok: false, error: mensajeDeError(error ?? { message: NO_TOCO_NADA }) }
    }
    revalidatePath(`/ordenes/${ordenId.data}`)
    return { ok: true, mensaje: `Escaneo firmado agregado a la ficha ${data.id}.` }
  } catch {
    const { error: limpieza } = await db.storage.from('control-ot').remove([ruta])
    return { ok: false, error: limpieza
      ? 'No se pudo asociar el escaneo y el PDF subido requiere revisión de Administración.'
      : 'No se pudo asociar el escaneo; el PDF subido se retiró.' }
  }
}
