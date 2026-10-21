import 'server-only'

import { z } from 'zod'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { BUCKET_PAGOS_COMPRAS, BUCKET_PAGOS_FACTURAS, BUCKET_PAGOS_SERVICIO } from '@/lib/dominio/finanzas'
import { createClient } from '@/lib/supabase/server'

/**
 * Cada OC y cada OS, de dónde salió hasta si se pagó, con la ruta de cada
 * archivo que la acompaña (migración 20261020170000). La función ya decide
 * quién la lee; los enlaces se firman aparte y solo para la página que se
 * muestra, con la sesión de quien mira.
 */

const texto = z.string().nullable()
const numero = z.coerce.number()

const esquemaPagoFactura = z.object({ id: z.guid(), fecha: z.string(), monto: numero, referencia: texto, ruta: texto })
const esquemaFactura = z.object({
  id: z.guid(),
  numero: z.string(),
  tipo: z.string(),
  fecha: texto,
  vence: texto,
  condicion: texto,
  total: numero,
  moneda: z.string(),
  estado: z.string(),
  parcial: z.boolean(),
  /**
   * La factura que Logística anexó a esta OC con boleta y que Contabilidad
   * registró sin ligarla: la OC se paga por ella igual (migración 20261020210000).
   */
  anexada: z.boolean().default(false),
  ruta: texto,
  bucket: texto,
  pagado: numero,
  saldo: numero,
  pagos: z.array(esquemaPagoFactura),
})
// El pago de la OS y, desde la migración 20261020210000, el de la OC con boleta.
// `bucket` dice dónde está cada archivo; falta en las filas de antes de esa migración.
const esquemaPagoServicio = z.object({
  id: z.guid(),
  fecha: z.string(),
  monto: numero,
  moneda: z.string(),
  // En la OC con boleta, si este pago fue el que la canceló; null si la OC no tiene total.
  cancela: z.boolean().nullable(),
  operacion: texto,
  comprobante: texto,
  ruta: texto,
  bucket: z.string().optional(),
})
const esquemaDocumento = z.object({
  id: z.guid(),
  tipo: z.string(),
  nombre: z.string(),
  ruta: z.string(),
  numero: texto,
  creado_en: z.string(),
  bucket: z.string().optional(),
  // La factura o la boleta que Logística anuló: queda como evidencia (migración 20261020210000).
  anulado_en: texto.optional().default(null),
  motivo_anulacion: texto.optional().default(null),
})
const esquemaGuia = z.object({ id: z.guid(), numero: z.string(), fecha: z.string(), nombre: z.string(), cargada_en: z.string() })

const esquemaFila = z.object({
  tipo: z.enum(['OC', 'OS']),
  id: z.guid(),
  numero: texto,
  referencia: texto,
  descripcion: texto,
  creado_en: z.string(),
  emitido_por: texto,
  origen: texto,
  requerimientos: z.array(z.object({ id: z.guid(), numero: z.string() })),
  ordenes: z.array(z.string()),
  codigos: z.array(z.string()),
  areas: z.array(z.string()),
  proveedor: z.string(),
  proveedor_id: texto,
  moneda: z.string(),
  total: numero.nullable(),
  sin_precio: z.boolean(),
  condicion_pago: texto,
  dias_credito: numero.nullable(),
  con_factura: z.boolean().nullable(),
  aprobacion: z.string(),
  aprobado_en: texto,
  motivo_rechazo: texto,
  estado: texto,
  recojo: texto,
  entregado_almacen_en: texto,
  ingreso: texto,
  anulado_en: texto,
  motivo_anulacion: texto,
  facturado: numero.nullable(),
  facturada_entera: z.boolean().nullable(),
  facturas: z.array(esquemaFactura),
  pagos: z.array(esquemaPagoServicio),
  documentos: z.array(esquemaDocumento),
  peso_kg: numero.nullable(),
  en_lista: z.boolean(),
  guia: esquemaGuia.nullable(),
  guias_anuladas: numero,
  pago: z.string(),
})

export type CompraTrazada = z.infer<typeof esquemaFila>
export type FacturaTrazada = z.infer<typeof esquemaFactura>

/** El bucket de un documento de la fila: el de la OS, o el de los PDF de Logística en la OC. */
export const bucketDelDocumento = (f: Pick<CompraTrazada, 'tipo'>, d: { bucket?: string }) =>
  d.bucket ?? (f.tipo === 'OS' ? 'documentos-servicio' : 'documentos-compras')
/** El bucket del voucher de un pago de la fila: el de la OS o el de la OC con boleta. */
export const bucketDelPago = (f: Pick<CompraTrazada, 'tipo'>, p: { bucket?: string }) =>
  p.bucket ?? (f.tipo === 'OS' ? BUCKET_PAGOS_SERVICIO : BUCKET_PAGOS_COMPRAS)

/** Todas las OC y OS, de la más nueva a la más vieja. */
export async function trazabilidadDeCompras(): Promise<CompraTrazada[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('trazabilidad_de_compras'), ['creado_en.desc', 'id'])
  if (error) throw new Error(`No se pudieron leer las órdenes de compra y de servicio: ${error.message}`)
  return z.array(esquemaFila).parse(data)
}

/** La clave con que se busca un enlace firmado: el bucket y la ruta. */
export const claveDeArchivo = (bucket: string, ruta: string) => `${bucket}:${ruta}`

/**
 * Los enlaces de los archivos de esas filas: los PDF de Logística, los de la OS,
 * el de cada factura, el voucher de cada pago de factura y el de cada pago de la
 * OS o de la OC con boleta. El
 * que la política de quien mira no deja abrir no sale, y su fila lo dice sin
 * enlace. La guía de remisión se abre por su ruta propia (`/compras/guia/…`).
 * Si falla la firma de un bucket, sus documentos salen sin enlace y `sinFirmar`
 * lo avisa arriba de la tabla: callarlo dejaría los documentos como texto sin
 * que nadie se entere, y tumbar la página entera por eso dejaría a Contabilidad
 * sin la tabla.
 */
export async function enlacesDeCompras(filas: CompraTrazada[]): Promise<{ urls: Map<string, string>; sinFirmar: boolean }> {
  const porBucket = new Map<string, string[]>()
  const sumar = (bucket: string | null, ruta: string | null) => {
    if (!bucket || !ruta) return
    porBucket.set(bucket, [...(porBucket.get(bucket) ?? []), ruta])
  }
  for (const f of filas) {
    for (const d of f.documentos) sumar(bucketDelDocumento(f, d), d.ruta)
    for (const fa of f.facturas) {
      sumar(fa.bucket, fa.ruta)
      for (const p of fa.pagos) sumar(BUCKET_PAGOS_FACTURAS, p.ruta)
    }
    for (const p of f.pagos) sumar(bucketDelPago(f, p), p.ruta)
  }
  const supabase = await createClient()
  const firmados = await Promise.all(
    [...porBucket].map(async ([bucket, rutas]) => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls([...new Set(rutas)], 600)
      if (error) console.error(`No se pudieron firmar los enlaces de ${bucket}:`, error.message)
      return { bucket, firmados: data ?? [], fallo: Boolean(error) }
    }),
  )
  const urls = new Map<string, string>()
  for (const { bucket, firmados: deEse } of firmados) for (const e of deEse) if (e.path && e.signedUrl) urls.set(claveDeArchivo(bucket, e.path), e.signedUrl)
  return { urls, sinFirmar: firmados.some((f) => f.fallo) }
}
