'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { TIPO_DOCUMENTO_COMPRA } from '@/lib/dominio/adquisiciones'
import { normalizarNumeroFactura } from '@/lib/dominio/finanzas'
import { fecha, hoyLima, moneda } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const FORMATO = z.object({
  id: z.guid(),
  orden_compra_id: z.guid(),
  // La cotización del proveedor tiene su tipo desde la migración 20261020170000.
  tipo: z.enum(['COTIZACION', 'ORDEN_COMPRA', 'ORDEN_PAGO', 'ORDEN_SERVICIO', 'FACTURA', 'COMPROBANTE', 'OTRO']),
  nombre_archivo: z.string().trim().min(1).max(200),
  // La factura anexada lleva su número y su fecha (migración 20261016702000):
  // Contabilidad la registra con ellos.
  factura_numero: z.string().trim().max(40).optional(),
  factura_fecha: z.union([z.literal(''), z.iso.date()]).optional(),
})

const campo = (formulario: FormData, nombre: string) => {
  const v = formulario.get(nombre)
  return typeof v === 'string' ? v : undefined
}

/** `revisar`: la factura que se anexó no alcanza para la OC y el anexo queda por revisar en Adquisiciones; `avisaTesoreria`: la OC se pagó por su boleta y esa factura la dejó pagada de más o va en otra moneda. */
export async function registrarDocumentoCompra(
  _previo: unknown,
  formulario: FormData,
): Promise<ResultadoAccion<{ revisar: boolean; avisaTesoreria: boolean }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Adjuntar documentos de compra corresponde a Logística.' }

  const datos = FORMATO.safeParse({
    id: formulario.get('id'),
    orden_compra_id: formulario.get('orden_compra_id'),
    tipo: formulario.get('tipo'),
    nombre_archivo: formulario.get('nombre_archivo'),
    factura_numero: campo(formulario, 'factura_numero'),
    factura_fecha: campo(formulario, 'factura_fecha'),
  })
  if (!datos.success) {
    return {
      ok: false,
      error: datos.error.issues[0]?.path[0] === 'factura_fecha' ? 'Revisa la fecha de la factura.' : 'Selecciona el tipo de documento y un PDF.',
    }
  }
  const esFactura = datos.data.tipo === 'FACTURA'
  const numeroFactura = esFactura ? normalizarNumeroFactura(datos.data.factura_numero ?? '') : null
  const fechaFactura = esFactura ? datos.data.factura_fecha || null : null
  if (esFactura && !numeroFactura) return { ok: false, error: 'Escribe el número de la factura con su serie y su número, como F001-123.' }
  if (esFactura && !fechaFactura) return { ok: false, error: 'Escribe la fecha de la factura.' }
  if (fechaFactura && fechaFactura > hoyLima()) return { ok: false, error: 'La fecha de la factura no puede ser posterior a hoy.' }

  const supabase = await createClient()
  const ruta = `compra/${datos.data.orden_compra_id}/${datos.data.id}.pdf`
  // Lo que se responde al anexarlo. La OC con boleta que Tesorería ya pagó
  // directo cambia el paso siguiente, y eso lo dice la base en el momento.
  const respuesta = async (): Promise<ResultadoAccion<{ revisar: boolean; avisaTesoreria: boolean }>> => {
    if (!numeroFactura) return { ok: true, mensaje: 'Documento adjuntado a la compra y disponible para Tesorería.' }
    // La OC con boleta que Tesorería ya pagó directo: registrada, su factura toma
    // ese pago (migración 20261020210000); si ya estaba pagada o es por menos, se
    // pagó de más, y si va en otra moneda no lo toma sola: a Tesorería le llega
    // el aviso. Cuenta lo neto: un pago que el proveedor devolvió entero no es
    // pago. Lo dice la base con la misma regla; si no se pudo leer, no se afirma
    // el paso siguiente.
    const { data: situacion, error: errorSituacion } = await supabase.rpc('situacion_de_pago_de_compra', { p_compra: datos.data.orden_compra_id })
    if (errorSituacion) console.error('No se pudo leer el pago de la OC después de anexar su factura', errorSituacion)
    const s = situacion?.[0]
    const pagado = Number(s?.neto ?? 0) > 0
    const revisar = Boolean(s && s.en_camino_origen === 'REGISTRADA' && s.en_camino_alcanza === false)
    const deMas = Number(s?.de_mas ?? 0)
    const m = s?.moneda === 'USD' ? 'USD' : 'PEN'
    const avisaTesoreria = Boolean(s && !revisar && pagado && s.factura && (deMas > 0 || s.otra_moneda))
    // Administración también anexa, pero no entra a Adquisiciones: el anexo lo anula Logística.
    const anulaQuien = puede(perfil, 'adquisiciones.ver') ? 'anula el anexo en Adquisiciones › OC y OS, en la fila de la OC' : 'pide a Logística que anule el anexo en Adquisiciones'
    const falta = Number(s?.factura_saldo ?? 0)
    return {
      ok: true,
      datos: { revisar, avisaTesoreria },
      mensaje: errorSituacion || !s
        ? `Factura ${numeroFactura} adjuntada a la compra.`
        : revisar
          ? `Factura ${numeroFactura} adjuntada a la compra, pero Contabilidad la registró para otras OC y no alcanza también para esta: revisa el número. Si no es de esta OC, ${anulaQuien}${pagado ? '; el pago por su boleta no se toca' : ', y la OC se paga por su boleta'}.`
        : pagado && s.factura && s.otra_moneda
          ? `Factura ${numeroFactura} adjuntada a la compra. Ojo: Tesorería ya pagó esta OC por su boleta y la factura va en otra moneda: no toma ese pago sola. Tesorería recibió el aviso para pasarlo al cambio o registrar la devolución.`
        : pagado && s.factura && deMas > 0
          ? `Factura ${numeroFactura} adjuntada a la compra. Ojo: Tesorería ya pagó esta OC por su boleta y la factura ya estaba pagada o es por menos: se pagaron ${moneda(deMas, m)} de más. Tesorería recibió el aviso para pedir la devolución.`
        : pagado && s.factura
          ? `Factura ${numeroFactura} adjuntada a la compra. Contabilidad ya la tenía registrada: toma lo que Tesorería pagó por la boleta${falta > 0 ? `, y lo que falta (${moneda(falta, m)}) se paga por ella` : ''}.`
        : pagado
          ? `Factura ${numeroFactura} adjuntada a la compra. Tesorería ya pagó esta OC por su boleta: cuando Contabilidad registre la factura, toma ese pago y solo se paga lo que falte.`
        : s.factura
          ? `Factura ${numeroFactura} adjuntada a la compra: Contabilidad ya la tenía registrada, y la OC se paga por ella en Cuentas por pagar.`
          : `Factura ${numeroFactura} adjuntada a la compra: Contabilidad la registra con su número y su fecha.`,
    }
  }
  // El mismo envío repetido (no le llegó la respuesta) recibe la misma respuesta
  // que la primera vez; con otro número, otra fecha u otra persona ya no es el
  // mismo, y la pantalla no puede decir que quedó lo que no se guardó.
  type Anotado = { orden_compra_id: string; subido_por: string; tipo: string; nombre_archivo: string; numero_documento: string | null; fecha_emision: string | null }
  const esElMismo = (d: Anotado) =>
    d.orden_compra_id === datos.data.orden_compra_id && d.subido_por === perfil.id && d.tipo === datos.data.tipo
    && d.nombre_archivo === datos.data.nombre_archivo && d.numero_documento === numeroFactura && d.fecha_emision === fechaFactura
  const { data: existente, error: errorExistente } = await supabase
    .from('documentos_compra_material')
    .select('orden_compra_id, subido_por, tipo, nombre_archivo, numero_documento, fecha_emision')
    .eq('id', datos.data.id)
    .maybeSingle()
  if (errorExistente) return { ok: false, error: mensajeDeError(errorExistente) }
  if (existente) {
    if (!esElMismo(existente)) {
      return { ok: false, error: 'Ese documento ya quedó adjuntado con otros datos. Recarga la compra para verlo antes de volver a intentar.' }
    }
    return respuesta()
  }
  const { data: archivo, error: errorSubida } = await supabase.storage
    .from('documentos-compras')
    .download(ruta)
  if (errorSubida || !archivo) {
    return { ok: false, error: 'No se pudo comprobar el PDF cargado. Revisa la conexión y vuelve a intentar.' }
  }
  if (archivo.size < 1 || archivo.size > 20 * 1024 * 1024 || await archivo.slice(0, 5).text() !== '%PDF-') {
    return { ok: false, error: 'El archivo debe ser un PDF válido de hasta 20 MB.' }
  }
  // El mismo PDF dos veces en la misma compra y con el mismo tipo (mismo nombre
  // y mismo tamaño) es un toque de más: en Adquisiciones salía la misma
  // cotización dos veces (2026-10-20). Con otro tipo sí entra: es la forma de
  // corregir uno mal elegido, porque un documento adjunto no se edita ni se borra.
  const { data: igual, error: errorIgual } = await supabase
    .from('documentos_compra_material')
    .select('tipo, creado_en')
    .eq('orden_compra_id', datos.data.orden_compra_id)
    .eq('nombre_archivo', datos.data.nombre_archivo)
    .eq('tamano_bytes', archivo.size)
    .eq('tipo', datos.data.tipo)
    // El que Logística anuló por un número mal escrito se vuelve a anexar bien.
    .is('anulado_en', null)
    .limit(1)
    .maybeSingle()
  if (errorIgual) return { ok: false, error: mensajeDeError(errorIgual) }
  if (igual) {
    return {
      ok: false,
      error: `Ese PDF ya está adjunto a esta compra como «${TIPO_DOCUMENTO_COMPRA[igual.tipo] ?? igual.tipo}» desde el ${fecha(igual.creado_en)}: no hace falta subirlo otra vez. Si es otro documento, revisa que elegiste el archivo correcto.`,
    }
  }

  const { data: guardado, error } = await supabase.from('documentos_compra_material').insert({
    id: datos.data.id,
    orden_compra_id: datos.data.orden_compra_id,
    tipo: datos.data.tipo,
    nombre_archivo: datos.data.nombre_archivo,
    ruta_storage: ruta,
    mime_type: 'application/pdf',
    tamano_bytes: archivo.size,
    subido_por: perfil.id,
    numero_documento: numeroFactura,
    fecha_emision: fechaFactura,
  }).select('id').maybeSingle()
  if (error) {
    if (error.code === '23505') {
      const repetido = await supabase.from('documentos_compra_material')
        .select('orden_compra_id, subido_por, tipo, nombre_archivo, numero_documento, fecha_emision').eq('id', datos.data.id).maybeSingle()
      if (!repetido.error && repetido.data && esElMismo(repetido.data)) return respuesta()
    }
    const { error: errorLimpieza } = await supabase.storage.from('documentos-compras').remove([ruta])
    if (errorLimpieza) {
      return { ok: false, error: `${mensajeDeError(error)} El PDF quedó sin registrar; avisa a Administración para retirarlo con seguridad.` }
    }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (!guardado) return { ok: false, error: 'No se confirmó el documento. Recarga la compra antes de volver a intentar.' }

  revalidatePath('/ordenes/[id]', 'page')
  revalidatePath('/compras')
  revalidatePath('/almacen/kardex')
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  return respuesta()
}

const ANULACION = z.object({
  id: z.guid(),
  motivo: z.string().trim().min(10, 'Cuenta por qué se anula, en 10 a 500 caracteres.').max(500, 'El motivo va en 10 a 500 caracteres.'),
})

/**
 * Logística anula la factura o la boleta que anexó por error a una OC, con su
 * motivo (migración 20261020210000): queda tachada como evidencia y deja de
 * contar para el pago. Mismo permiso que la anexa (`compras.crear`); la base
 * avisa a Tesorería y a Contabilidad si les cambia algo.
 */
export async function anularDocumentoCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: 'Anular un documento de compra corresponde a Logística.' }
  const datos = ANULACION.safeParse({ id: formulario.get('id'), motivo: formulario.get('motivo') })
  if (!datos.success) return { ok: false, error: datos.error.issues[0]?.message ?? 'Cuenta por qué se anula.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_documento_compra', { p_id: datos.data.id, p_motivo: datos.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se confirmó la anulación. Recarga la pantalla antes de volver a intentar.' }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/compras')
  revalidatePath('/ordenes/[id]', 'page')
  return { ok: true, mensaje: 'Documento anulado: queda tachado con su motivo y ya no cuenta para el pago de la OC.' }
}
