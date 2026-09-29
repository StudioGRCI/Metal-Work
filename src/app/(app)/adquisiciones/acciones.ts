'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const esquema = z.object({
  tipo: z.enum(['FACTURA_COMPRA', 'RECIBO_HONORARIOS', 'FACTURA_VEHICULO', 'FACTURA_TESORERIA', 'OTRO']),
  proveedor: z.string().trim().min(2).max(160),
  numero_documento: z.string().trim().min(3).max(80),
  fecha_emision: z.iso.date(),
  fecha_vencimiento: z.iso.date(),
  moneda: z.enum(['PEN', 'USD']),
  total: z.coerce.number().positive().multipleOf(0.01),
  condicion_pago: z.enum(['CONTADO', 'CREDITO']),
  orden_id: z.union([z.literal(''), z.string().uuid()]),
  orden_compra_id: z.union([z.literal(''), z.string().uuid()]),
  documento_compra_id: z.union([z.literal(''), z.string().uuid()]),
  observacion: z.string().trim().max(1000),
})

export async function registrarAdquisicion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('adquisiciones.registrar')
  const entrada = esquema.safeParse(Object.fromEntries(formulario))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa el comprobante.' }
  const archivo = formulario.get('pdf')
  const v = entrada.data
  const tieneArchivo = archivo instanceof File && archivo.size > 0
  if (!tieneArchivo && !v.documento_compra_id) return { ok: false, error: 'Adjunta el PDF o elige una factura ya subida por Logística.' }
  if (tieneArchivo && (archivo.size < 5 || archivo.size > 10 * 1024 * 1024 || archivo.type !== 'application/pdf')) {
    return { ok: false, error: 'Adjunta un PDF de hasta 10 MB.' }
  }
  const bytes = tieneArchivo ? new Uint8Array(await archivo.arrayBuffer()) : null
  if (bytes && String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return { ok: false, error: 'El archivo no es un PDF válido.' }
  if (v.fecha_vencimiento < v.fecha_emision || (v.condicion_pago === 'CONTADO' && v.fecha_vencimiento !== v.fecha_emision)) {
    return { ok: false, error: 'Revisa la fecha de vencimiento y la condición de pago.' }
  }
  const id = crypto.randomUUID()
  const supabase = await createClient()
  let compraId = v.orden_compra_id || null
  if (v.documento_compra_id) {
    const { data: documento, error: errorDocumento } = await supabase.from('documentos_compra_material')
      .select('id, orden_compra_id, tipo').eq('id', v.documento_compra_id).maybeSingle()
    if (errorDocumento) return { ok: false, error: mensajeDeError(errorDocumento) }
    if (!documento || documento.tipo !== 'FACTURA' || (compraId && compraId !== documento.orden_compra_id)) {
      return { ok: false, error: 'Elige una factura de la misma compra.' }
    }
    compraId = documento.orden_compra_id
  }
  const { data: borrador, error: errorAlta } = await supabase.from('adquisiciones').insert({
    id, tipo: v.tipo, proveedor: v.proveedor, numero_documento: v.numero_documento,
    fecha_emision: v.fecha_emision, fecha_vencimiento: v.fecha_vencimiento,
    moneda: v.moneda, total: v.total, condicion_pago: v.condicion_pago,
    orden_id: v.orden_id || null, orden_compra_id: compraId, documento_compra_id: v.documento_compra_id || null,
    observacion: v.observacion,
  }).select('id').maybeSingle()
  if (errorAlta) return { ok: false, error: mensajeDeError(errorAlta) }
  if (!borrador) return { ok: false, error: NO_TOCO_NADA }
  const ruta = bytes ? `adquisiciones/${id}/comprobante.pdf` : null
  if (ruta && bytes) {
    const { error: errorArchivo } = await supabase.storage.from('comprobantes-financieros')
      .upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
    if (errorArchivo) return { ok: false, error: `Comprobante creado en borrador, pero no se pudo subir el PDF: ${errorArchivo.message}` }
  }
  const { data: registrado, error: errorRegistro } = await supabase.from('adquisiciones')
    .update({ ruta_storage: ruta, estado: 'REGISTRADA' }).eq('id', id).select('id').maybeSingle()
  if (errorRegistro) return { ok: false, error: `Comprobante en borrador: ${mensajeDeError(errorRegistro)}` }
  if (!registrado) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/cuentas')
  return { ok: true, mensaje: `Comprobante ${v.numero_documento} registrado.` }
}

export async function completarAdquisicion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirPermiso('adquisiciones.registrar')
  const id = z.string().uuid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'El borrador no es válido.' }
  const archivo = formulario.get('pdf')
  if (!(archivo instanceof File) || archivo.size < 5 || archivo.size > 10 * 1024 * 1024 || archivo.type !== 'application/pdf') {
    return { ok: false, error: 'Adjunta un PDF de hasta 10 MB.' }
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return { ok: false, error: 'El archivo no es un PDF válido.' }
  const db = await createClient()
  const { data: borrador, error: errorLectura } = await db.from('adquisiciones')
    .select('id, registrado_por, estado').eq('id', id.data).maybeSingle()
  if (errorLectura) return { ok: false, error: mensajeDeError(errorLectura) }
  if (!borrador || borrador.registrado_por !== perfil.id || borrador.estado !== 'BORRADOR') {
    return { ok: false, error: 'Solo quien creó este borrador puede completarlo.' }
  }
  const ruta = `adquisiciones/${id.data}/comprobante.pdf`
  const { error: errorArchivo } = await db.storage.from('comprobantes-financieros')
    .upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
  if (errorArchivo) {
    const { data: existentes, error: errorLista } = await db.storage.from('comprobantes-financieros')
      .list(`adquisiciones/${id.data}`, { limit: 10 })
    if (errorLista || !existentes?.some(item => item.name === 'comprobante.pdf')) {
      return { ok: false, error: `No se pudo subir el PDF: ${errorArchivo.message}` }
    }
  }
  const { data, error } = await db.from('adquisiciones').update({ ruta_storage: ruta, estado: 'REGISTRADA' })
    .eq('id', id.data).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/cuentas')
  return { ok: true, mensaje: 'Comprobante completado y registrado.' }
}
