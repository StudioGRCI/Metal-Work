'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion, mensajeDeArchivo } from '@/lib/acciones'
import { cambiosDelFormulario, datosDeCorreccion } from '@/lib/correccion-accion'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import { rucEsValido } from '@/lib/dominio/proveedores'
import { moneda } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * El RUC de quien emitió el comprobante, sin espacios ni guiones; vacío si no se
 * escribió (la base lo toma de la OC del padrón, y sin él no registra la factura
 * de compra). El dígito de control lo revisa la base.
 */
const RUC = z
  .string()
  .transform((t) => t.replace(/\D/g, ''))
  .refine((t) => t === '' || t.length === 11, 'El RUC son 11 dígitos: cópialo tal como sale en la factura.')

const esquema = z.object({
  tipo: z.enum(['FACTURA_COMPRA', 'RECIBO_HONORARIOS', 'FACTURA_VEHICULO', 'FACTURA_TESORERIA', 'OTRO']),
  proveedor: z.string().trim().min(2).max(160),
  ruc_proveedor: RUC.optional().transform((t) => t ?? ''),
  numero_documento: z.string().trim().min(3).max(80),
  fecha_emision: z.iso.date(),
  fecha_vencimiento: z.iso.date(),
  moneda: z.enum(['PEN', 'USD']),
  total: z.coerce.number().positive().multipleOf(0.01),
  condicion_pago: z.enum(['CONTADO', 'CREDITO']),
  orden_id: z.union([z.literal(''), z.guid()]),
  documento_compra_id: z.union([z.literal(''), z.guid()]),
  observacion: z.string().trim().max(1000),
})
const esquemaOrdenes = z.array(z.guid()).max(40, 'Una factura cubre hasta 40 OC.')

/**
 * Lo que el detector leyó de la factura en el navegador (`src/lib/leer-factura.ts`).
 * Es evidencia para el aviso, no un dato de la factura: si llega mal formado se
 * descarta y el comprobante se registra igual, sin lectura.
 */
const esquemaLectura = z.object({
  lectura_fuente: z.enum(['XML', 'PDF', 'OCR']),
  lectura_total: z.union([z.literal(''), z.coerce.number().positive().max(9999999999).multipleOf(0.01)]),
  lectura_moneda: z.union([z.literal(''), z.enum(['PEN', 'USD'])]),
  lectura_numero: z.union([z.literal(''), z.string().regex(/^[A-Z][A-Z0-9]{3}-\d{1,8}$/)]),
  lectura_ordenes: z.string().regex(/^(?:[1-9]\d{0,6}(?:,[1-9]\d{0,6}){0,39})?$/),
})

function lecturaDelFormulario(formulario: FormData) {
  const campo = (n: string) => {
    const v = formulario.get(n)
    return typeof v === 'string' ? v.trim() : ''
  }
  const r = esquemaLectura.safeParse({
    lectura_fuente: campo('lectura_fuente'),
    lectura_total: campo('lectura_total'),
    lectura_moneda: campo('lectura_moneda'),
    lectura_numero: campo('lectura_numero'),
    lectura_ordenes: campo('lectura_ordenes'),
  })
  if (!r.success) return { lectura_fuente: null, lectura_total: null, lectura_moneda: null, lectura_numero: null, lectura_ordenes: null }
  return {
    lectura_fuente: r.data.lectura_fuente,
    lectura_total: r.data.lectura_total === '' ? null : r.data.lectura_total,
    lectura_moneda: r.data.lectura_moneda || null,
    lectura_numero: r.data.lectura_numero || null,
    lectura_ordenes: r.data.lectura_ordenes ? [...new Set(r.data.lectura_ordenes.split(','))] : [],
  }
}

const condicionEnTexto = (c: string) => (c === 'CREDITO' ? 'crédito' : 'contado')

/**
 * Contabilidad registra una factura o un recibo. Una factura de compra cubre una
 * o varias OC del mismo proveedor (migración 20261015122000): la principal va en
 * el comprobante —es la que fija su OT— y las demás se enlazan mientras está en
 * borrador, antes de subir el PDF. Que el total no calce con el de las OC no
 * frena nada: Adquisiciones solo lo avisa.
 */
export async function registrarAdquisicion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('adquisiciones.registrar')
  const entrada = esquema.safeParse(Object.fromEntries(formulario))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa el comprobante.' }
  const marcadas = esquemaOrdenes.safeParse([...new Set(formulario.getAll('ordenes_compra').filter((v) => v !== ''))])
  if (!marcadas.success) return { ok: false, error: marcadas.error.issues[0]?.message ?? 'Vuelve a marcar las OC de la factura.' }
  // Las OC que esta factura cubre solo en parte (migración 20261016701000): el resto va en otra factura.
  const enParte = esquemaOrdenes.safeParse([...new Set(formulario.getAll('parciales').filter((v) => v !== ''))])
  if (!enParte.success || enParte.data.some((o) => !marcadas.data.includes(o))) {
    return { ok: false, error: 'Vuelve a marcar qué OC cubre solo en parte esta factura.' }
  }
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
  // Sin él, el borrador de una factura de compra no se podría completar nunca.
  if (v.tipo === 'FACTURA_COMPRA' && !v.ruc_proveedor) {
    return { ok: false, error: 'Anota el RUC de quien emitió la factura, tal como sale en ella.' }
  }
  const id = crypto.randomUUID()
  const supabase = await createClient()
  let ordenes = marcadas.data
  let principal: string | null = null
  if (v.documento_compra_id) {
    const { data: documento, error: errorDocumento } = await supabase.from('documentos_compra_material')
      .select('id, orden_compra_id, tipo').eq('id', v.documento_compra_id).maybeSingle()
    if (errorDocumento) return { ok: false, error: mensajeDeError(errorDocumento) }
    if (!documento || documento.tipo !== 'FACTURA' || (ordenes.length > 0 && !ordenes.includes(documento.orden_compra_id))) {
      return { ok: false, error: 'La factura que subió Logística tiene que ser de una de las OC marcadas.' }
    }
    principal = documento.orden_compra_id
    if (ordenes.length === 0) ordenes = [documento.orden_compra_id]
  }

  // Con el RUC escrito, la factura va solo a las OC de ese RUC (migración 20261022170000).
  if (v.ruc_proveedor && ordenes.length > 0) {
    const { data: padron, error: errorPadron } = await supabase.from('ordenes_compra_materiales')
      .select('id, numero, referencia, padron:proveedores(numero_documento)').in('id', ordenes)
    if (errorPadron) return { ok: false, error: mensajeDeError(errorPadron) }
    const otra = (padron ?? []).find((c) => {
      const suyo = c.padron?.numero_documento?.trim() ?? ''
      return rucEsValido(suyo) && suyo !== v.ruc_proveedor
    })
    if (otra) {
      return { ok: false, error: `La ${otra.numero ?? `OC ${otra.referencia}`} es del RUC ${otra.padron?.numero_documento?.trim()}, y la factura del ${v.ruc_proveedor}: una factura se liga solo a las OC de su proveedor.` }
    }
  }

  // Antes de crear nada: que las OC marcadas puedan ir juntas en esta factura.
  // La base lo vuelve a exigir; aquí se ataja para no dejar un borrador a medias.
  if (ordenes.length > 1 || (ordenes.length === 1 && !principal)) {
    const { data: pendientes, error: errorPendientes } = await supabase.rpc('compras_sin_factura')
    if (errorPendientes) return { ok: false, error: mensajeDeError(errorPendientes) }
    const porId = new Map((pendientes ?? []).flatMap((c) => (c.orden_compra_id ? [[c.orden_compra_id, c] as const] : [])))
    // Solo la OC de la factura que subió Logística puede no estar en la lista.
    if (ordenes.some((o) => !porId.has(o) && o !== principal)) {
      return { ok: false, error: 'Una de las OC marcadas ya tiene su factura registrada. Recarga la pantalla.' }
    }
    const conocidas = ordenes.flatMap((o) => porId.get(o) ?? [])
    const nombre = (p: string | null) => (p ?? '').trim().toUpperCase()
    const otroProveedor = conocidas.find((c) => nombre(c.proveedor) !== nombre(conocidas[0].proveedor))
    if (otroProveedor) return { ok: false, error: `Una factura es de un solo proveedor: la ${nombreDeOc(otroProveedor)} es de ${otroProveedor.proveedor}.` }
    const otraCondicion = conocidas.find((c) => c.condicion_pago !== v.condicion_pago)
    if (otraCondicion) {
      return { ok: false, error: `La ${nombreDeOc(otraCondicion)} es al ${condicionEnTexto(otraCondicion.condicion_pago ?? '')}: la factura tiene que ir igual.` }
    }
    // La principal fija la OT del comprobante: la de la OT elegida, si hay una.
    principal ??= (v.orden_id && conocidas.find((c) => c.orden_id === v.orden_id)?.orden_compra_id) || ordenes[0]
  }
  principal ??= ordenes[0] ?? null

  const { data: borrador, error: errorAlta } = await supabase.from('adquisiciones').insert({
    id, tipo: v.tipo, proveedor: v.proveedor, ruc_proveedor: v.ruc_proveedor || null, numero_documento: v.numero_documento,
    fecha_emision: v.fecha_emision, fecha_vencimiento: v.fecha_vencimiento,
    moneda: v.moneda, total: v.total, condicion_pago: v.condicion_pago,
    orden_id: v.orden_id || null, orden_compra_id: principal, documento_compra_id: v.documento_compra_id || null,
    observacion: v.observacion,
    ...lecturaDelFormulario(formulario),
  }).select('id').maybeSingle()
  if (errorAlta) return { ok: false, error: mensajeDeError(errorAlta) }
  if (!borrador) return { ok: false, error: NO_TOCO_NADA }
  // La principal la enlaza la base sola; las demás, aquí.
  const resto = ordenes.filter((o) => o !== principal)
  if (resto.length > 0) {
    const { data: enlazadas, error: errorEnlace } = await supabase.from('adquisiciones_ordenes_compra')
      .insert(resto.map((o) => ({ adquisicion_id: id, orden_compra_id: o }))).select('id')
    if (errorEnlace) return { ok: false, error: `El comprobante quedó en borrador sin todas sus OC: ${mensajeDeError(errorEnlace)}` }
    if ((enlazadas ?? []).length !== resto.length) return { ok: false, error: NO_TOCO_NADA }
  }
  // Las que cubre en parte, mientras sigue en borrador: registrada, solo se cambia con una corrección.
  if (enParte.data.length > 0) {
    const { data: parciales, error: errorParcial } = await supabase.from('adquisiciones_ordenes_compra')
      .update({ parcial: true }).eq('adquisicion_id', id).in('orden_compra_id', enParte.data).select('id')
    if (errorParcial) return { ok: false, error: `El comprobante quedó en borrador sin marcar las OC parciales: ${mensajeDeError(errorParcial)}` }
    if ((parciales ?? []).length !== enParte.data.length) return { ok: false, error: NO_TOCO_NADA }
  }
  const ruta = bytes ? `adquisiciones/${id}/comprobante.pdf` : null
  if (ruta && bytes) {
    const { error: errorArchivo } = await supabase.storage.from('comprobantes-financieros')
      .upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
    if (errorArchivo) return { ok: false, error: `Comprobante creado en borrador, pero no se pudo subir el PDF: ${mensajeDeArchivo(errorArchivo)}` }
  }
  const { data: registrado, error: errorRegistro } = await supabase.from('adquisiciones')
    .update({ ruta_storage: ruta, estado: 'REGISTRADA' }).eq('id', id)
    .select('id, orden_compra_id, oc:ordenes_compra_materiales!adquisiciones_orden_compra_id_fkey(numero, referencia)').maybeSingle()
  if (errorRegistro) return { ok: false, error: `Comprobante en borrador: ${mensajeDeError(errorRegistro)}` }
  if (!registrado) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  const espera = await queEspera(supabase, id)
  if (espera) return { ok: true, mensaje: `Comprobante ${v.numero_documento} registrado. ${espera}` }
  const tomo = await loQueTomoDeLaBoleta(supabase, id, v.moneda)
  // Sin OC marcada, la base la liga sola a la OC con boleta a la que Logística
  // anexó esa factura (migración 20261020210000): se dice, para que no se busque.
  if (ordenes.length === 0 && registrado.orden_compra_id) {
    const oc = registrado.oc ? nombreDeOc(registrado.oc) : 'OC con boleta'
    return {
      ok: true,
      mensaje: `Comprobante ${v.numero_documento} registrado y ligado a la ${oc}, a la que Logística lo anexó${tomo ?? ': se paga por él en Cuentas por pagar.'}`,
    }
  }
  const cuantas = ordenes.length
  const parcial = enParte.data.length > 0 ? ', como factura parcial: sus OC siguen esperando el resto' : ''
  return { ok: true, mensaje: `Comprobante ${v.numero_documento} registrado${cuantas > 1 ? ` con ${cuantas} OC` : cuantas === 1 ? ' con su OC' : ''}${parcial}${tomo ?? '.'}` }
}

/**
 * Si la factura que se acaba de registrar es de una OC con boleta que se dio por
 * pagada fuera (migración 20261022175000), qué le toca hacer a Contabilidad.
 * `null` si no espera; si no se pudo leer, lo dice.
 */
async function queEspera(supabase: Awaited<ReturnType<typeof createClient>>, id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('facturas_en_espera', { p_facturas: [id] })
  if (error) {
    console.error('No se pudo leer si la factura espera a Contabilidad', error)
    return null
  }
  const espera = data?.[0]
  if (!espera) return null
  return `La ${espera.compra} va con boleta y se dio por pagada fuera del sistema: en su fila de Facturas, di si ya se pagó o si falta pagarla; hasta entonces Tesorería no la paga.`
}

/**
 * Si la factura que se acaba de registrar tomó lo que Tesorería ya pagó por la
 * boleta de su OC (migración 20261020210000), cómo lo dice el aviso: lo que tomó,
 * lo que le falta (que paga Tesorería), lo pagado de más o, si va en otra
 * moneda, que no lo toma sola. Lo lee de `pago_directo_de_la_factura`, que
 * Contabilidad puede llamar. `null` si no hay pago por la boleta que tomar; si
 * no se pudo leer, lo dice y no adivina.
 */
async function loQueTomoDeLaBoleta(supabase: Awaited<ReturnType<typeof createClient>>, id: string, codigo: 'PEN' | 'USD') {
  const { data, error } = await supabase.rpc('pago_directo_de_la_factura', { p_factura: id })
  if (error) {
    console.error('No se pudo leer si la factura tomó lo pagado por la boleta', error)
    return '. No se pudo leer si tomó lo que Tesorería pagó por la boleta: mírala en Cuentas por pagar.'
  }
  const filas = data ?? []
  if (filas.length === 0) return null
  // Con una OC la nombra; con varias, las suma.
  const oc = filas.length === 1 ? `la ${filas[0].compra}` : 'sus OC con boleta'
  const otra = filas.find((f) => f.otra_moneda)
  if (otra) {
    return `. Va en otra moneda que la ${otra.compra}, que Tesorería ya pagó por su boleta: no toma ese pago sola; Tesorería lo pasa al cambio o registra la devolución antes de pagar lo que falte.`
  }
  // `tomado` y `falta` van en la moneda de la factura; lo pagado de más, en la de cada OC.
  const tomado = filas.reduce((suma, f) => suma + Number(f.tomado ?? 0), 0)
  const falta = Number(filas[0].falta ?? 0)
  const deMas = filas
    .filter((f) => Number(f.de_mas ?? 0) > 0)
    .map((f) => moneda(Number(f.de_mas), f.moneda === 'USD' ? 'USD' : 'PEN'))
    .join(' y ')
  if (tomado > 0) {
    if (falta > 0) return `: tomó lo que Tesorería pagó por la boleta de ${oc}, ${moneda(tomado, codigo)}; le faltan ${moneda(falta, codigo)}, que Tesorería paga en Cuentas por pagar.`
    if (deMas) return `: tomó ${moneda(tomado, codigo)} de lo que Tesorería pagó por la boleta de ${oc} y no le falta nada; se pagaron ${deMas} de más, y Tesorería pide la devolución.`
    return `: tomó lo que Tesorería pagó por la boleta de ${oc}, ${moneda(tomado, codigo)}, y no le falta nada.`
  }
  if (deMas) {
    return `. Tesorería ya la había pagado y también pagó ${filas.length === 1 ? `${oc} por su boleta` : oc}: se pagaron ${deMas} de más, y Tesorería pide la devolución.`
  }
  return null
}

export async function completarAdquisicion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirPermiso('adquisiciones.registrar')
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'El borrador no es válido.' }
  // El borrador de antes de la migración 20261022170000 pudo quedar sin RUC: se anota al completarlo.
  const ruc = RUC.optional().safeParse(formulario.get('ruc_proveedor') ?? undefined)
  if (!ruc.success) return { ok: false, error: ruc.error.issues[0]?.message ?? 'Revisa el RUC.' }
  const archivo = formulario.get('pdf')
  if (!(archivo instanceof File) || archivo.size < 5 || archivo.size > 10 * 1024 * 1024 || archivo.type !== 'application/pdf') {
    return { ok: false, error: 'Adjunta un PDF de hasta 10 MB.' }
  }
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return { ok: false, error: 'El archivo no es un PDF válido.' }
  const db = await createClient()
  const { data: borrador, error: errorLectura } = await db.from('adquisiciones')
    .select('id, registrado_por, estado, moneda').eq('id', id.data).maybeSingle()
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
      return { ok: false, error: `No se pudo subir el PDF: ${mensajeDeArchivo(errorArchivo)}` }
    }
  }
  // Lo que el detector leyó del PDF pendiente; si no leyó nada, queda lo que había.
  const lectura = lecturaDelFormulario(formulario)
  const { data, error } = await db.from('adquisiciones')
    .update({ ruta_storage: ruta, estado: 'REGISTRADA', ...(ruc.data ? { ruc_proveedor: ruc.data } : {}), ...(lectura.lectura_fuente ? lectura : {}) })
    .eq('id', id.data).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  const espera = await queEspera(db, id.data)
  if (espera) return { ok: true, mensaje: `Comprobante completado y registrado. ${espera}` }
  const tomo = await loQueTomoDeLaBoleta(db, id.data, borrador.moneda === 'USD' ? 'USD' : 'PEN')
  return { ok: true, mensaje: `Comprobante completado y registrado${tomo ?? '.'}` }
}

/**
 * El enlace de la factura que subió Logística, para que el detector la lea en
 * el navegador de Contabilidad. Lo firma la sesión de quien registra: si el
 * almacenamiento no se la deja ver, no hay enlace y el detector calla.
 */
export async function enlaceDeFacturaDeLogistica(documentoId: string): Promise<string | null> {
  await exigirPermiso('adquisiciones.registrar')
  const id = z.guid().safeParse(documentoId)
  if (!id.success) return null
  const db = await createClient()
  const { data } = await db.from('documentos_compra_material').select('ruta_storage, tipo').eq('id', id.data).maybeSingle()
  if (!data?.ruta_storage || data.tipo !== 'FACTURA') return null
  const { data: firmado } = await db.storage.from('documentos-compras').createSignedUrl(data.ruta_storage, 120)
  return firmado?.signedUrl ?? null
}

/** Lo leído del PDF corregido; si llega mal formado se descarta, como al registrar. */
const LECTURA_CORREGIDA = z
  .object({
    fuente: z.enum(['XML', 'PDF', 'OCR']),
    total: z.number().positive().max(9999999999).multipleOf(0.01).nullable(),
    moneda: z.enum(['PEN', 'USD']).nullable(),
    numero: z.string().regex(/^[A-Z][A-Z0-9]{3}-\d{1,8}$/).nullable(),
    ordenes: z.array(z.string().regex(/^[1-9]\d{0,6}$/)).max(40),
  })
  .optional()
  .catch(undefined)

const CAMBIOS_FACTURA = z.object({
  proveedor: z.string().trim().min(2, 'Escribe el proveedor.').max(160).optional(),
  ruc_proveedor: RUC.optional(),
  numero_documento: z.string().trim().min(3, 'Escribe el número del comprobante.').max(80).optional(),
  fecha_emision: z.iso.date('Revisa la fecha de emisión.').optional(),
  fecha_vencimiento: z.iso.date('Revisa la fecha de vencimiento.').optional(),
  moneda: z.enum(['PEN', 'USD']).optional(),
  total: z.number().positive('El total va mayor que cero.').multipleOf(0.01, 'El total lleva como máximo dos decimales.').optional(),
  condicion_pago: z.enum(['CONTADO', 'CREDITO']).optional(),
  observacion: z.string().trim().max(1000).optional(),
  ordenes: esquemaOrdenes.optional(),
  /** Las OC que la factura cubre solo en parte, de las que quedan en ella. */
  parciales: esquemaOrdenes.optional(),
  pdf_ruta: z
    .string()
    .regex(/^adquisiciones\/[0-9a-f-]{36}\/correccion-[0-9a-f-]{36}\.pdf$/, 'Vuelve a adjuntar el PDF corregido de la factura.')
    .optional(),
  lectura: LECTURA_CORREGIDA,
})

/**
 * Corregir un comprobante ya registrado, con su motivo y su justificante: sus
 * datos, las OC que cubre y su PDF. La OC que sale queda anotada como quitada y
 * vuelve a esperar su factura. Mismo permiso que `corregir_factura_compra`.
 */
export async function corregirFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('adquisiciones.registrar')
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció el comprobante. Vuelve a cargar la pantalla.' }
  const correccion = datosDeCorreccion(formulario)
  if (!correccion.ok) return correccion
  const cambios = CAMBIOS_FACTURA.safeParse(cambiosDelFormulario(formulario))
  if (!cambios.success) return { ok: false, error: cambios.error.issues[0]?.message ?? 'Revisa lo que corriges.' }
  const { lectura, ...resto } = cambios.data
  if (resto.pdf_ruta && !resto.pdf_ruta.startsWith(`adquisiciones/${id.data}/`)) {
    return { ok: false, error: 'Vuelve a adjuntar el PDF corregido de la factura.' }
  }

  const supabase = await createClient()
  const c = correccion.datos
  const { data, error } = await supabase.rpc('corregir_factura_compra', {
    p_correccion: c.correccion_id,
    p_id: id.data,
    p_motivo: c.motivo,
    p_justificante: c.justificante_ruta,
    p_nombre: c.justificante_nombre,
    // Lo leído viaja solo con un PDF nuevo: es la lectura de ese PDF.
    p_cambios: resto.pdf_ruta && lectura ? { ...resto, lectura } : resto,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id.data) return { ok: false, error: 'El comprobante no se corrigió. Vuelve a cargar la pantalla.' }

  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/compras/ordenes')
  return { ok: true, mensaje: 'Comprobante corregido, con su justificante.' }
}

const CONFIRMAR_PAGO = z.discriminatedUnion('pagada', [
  z.object({
    compra: z.guid(),
    pagada: z.literal('si'),
    // Solo para decir qué pasó si la factura no toma el pago: la base no lo decide por esto.
    otra_moneda: z.enum(['si', 'no']).optional(),
    fecha: z.iso.date('Elige el día en que se pagó.'),
    monto: z.coerce.number().positive('Escribe lo que se pagó.').multipleOf(0.01, 'Lo pagado lleva como máximo dos decimales.'),
    nota: z.string().trim().min(10, 'Cuenta cómo lo sabes, en al menos 10 caracteres.').max(500),
  }),
  z.object({
    compra: z.guid(),
    pagada: z.literal('no'),
    nota: z.string().trim().min(10, 'Cuenta cómo lo sabes, en al menos 10 caracteres.').max(500),
  }),
])

/**
 * Contabilidad dice si la OC con boleta que se dio por pagada fuera ya se pagó o
 * si falta pagarla, para que su factura deje de esperar (migración
 * 20261022175000). Mismo permiso que `confirmar_pago_de_la_boleta`.
 */
export async function confirmarPagoDeBoleta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('adquisiciones.registrar')
  const entrada = CONFIRMAR_PAGO.safeParse(Object.fromEntries(formulario))
  if (!entrada.success) return { ok: false, error: entrada.error.issues[0]?.message ?? 'Revisa lo que confirmas.' }
  const v = entrada.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('confirmar_pago_de_la_boleta', {
    p_compra: v.compra,
    p_ya_pagada: v.pagada === 'si',
    p_fecha: v.pagada === 'si' ? v.fecha : null,
    p_monto: v.pagada === 'si' ? v.monto : null,
    p_nota: v.nota,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  if (v.pagada === 'no') return { ok: true, mensaje: 'Anotado: Tesorería paga la factura en Cuentas por pagar.' }
  // En otra moneda la factura no toma sola lo pagado fuera: Tesorería lo pasa al cambio.
  const { count, error: errorToma } = await supabase.from('pagos_adquisicion')
    .select('id', { count: 'exact', head: true }).eq('pago_orden_compra_id', data).is('anulado_en', null)
  if (errorToma) {
    console.error('confirmarPagoDeBoleta: no se pudo ver si la factura tomó el pago', errorToma)
    return { ok: true, mensaje: 'Anotado. Mira en Cuentas por pagar cuánto tomó la factura de lo pagado fuera.' }
  }
  return {
    ok: true,
    mensaje:
      (count ?? 0) > 0
        ? 'Anotado: la factura toma lo que se pagó fuera, y Tesorería paga lo que falte.'
        : v.otra_moneda === 'si'
          ? 'Anotado. La factura va en otra moneda y no toma sola lo pagado fuera: Tesorería lo pasa al cambio en Cuentas por pagar.'
          : 'Anotado, pero la factura no tomó lo pagado fuera: Tesorería lo revisa en Cuentas por pagar.',
  }
}
