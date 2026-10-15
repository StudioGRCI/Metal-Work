/**
 * Todo se corrige con su justificante (DKS, 15/10): el requerimiento, la orden
 * de compra y la factura de compra registrada. La base guarda cada corrección
 * con lo que decía antes y lo que dice después (migración 20261016602000);
 * aquí se traduce esa diferencia a frases que se leen de un vistazo.
 *
 * Sin imports a propósito: lo usan el servidor, el navegador y `node --test`.
 */

export const BUCKET_JUSTIFICANTES = 'justificantes-correccion'

/** Lo que acepta la base como justificante: el PDF o la foto que respalda el cambio. */
export const TIPOS_JUSTIFICANTE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
export const ACEPTA_JUSTIFICANTE = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp'
export const MAX_JUSTIFICANTE = 10 * 1024 * 1024

export type DocumentoCorregible = 'REQUERIMIENTO' | 'ORDEN_COMPRA' | 'FACTURA_COMPRA'

/** La ruta que exige la base: <id del documento>/<id de la corrección>.<extensión>. */
export function rutaDeJustificante(documentoId: string, correccionId: string, mime: string): string | null {
  const extension = TIPOS_JUSTIFICANTE[mime]
  return extension ? `${documentoId}/${correccionId}.${extension}` : null
}

/** Por qué no sirve el archivo elegido como justificante; null si sirve. */
export function problemaDelJustificante(archivo: { size: number; type: string } | null | undefined): string | null {
  if (!archivo || archivo.size < 1) return 'Adjunta el justificante de la corrección: el PDF o la foto que la respalda.'
  if (!TIPOS_JUSTIFICANTE[archivo.type]) return 'El justificante va en PDF o en foto (JPG, PNG o WEBP).'
  if (archivo.size > MAX_JUSTIFICANTE) return 'El justificante pasa de 10 MB: comprime la foto o el PDF.'
  return null
}

export type Formatos = {
  dinero: (monto: number, moneda: 'PEN' | 'USD') => string
  cantidad: (n: number) => string
  fecha: (iso: string) => string
  /** El número de una OC por su id (OC-5583-MW); null si no se conoce. */
  oc: (id: string) => string | null
  /** El nombre de un material del catálogo por su id; null si no se conoce. */
  material: (id: string) => string | null
}

type Objeto = Record<string, unknown>
const objeto = (v: unknown): Objeto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objeto) : {})
const lista = (v: unknown): Objeto[] => (Array.isArray(v) ? v.map(objeto) : [])
const texto = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
const numero = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function cambio(etiqueta: string, antes: string, despues: string) {
  return `${etiqueta}: ${antes} → ${despues}`
}

function fechaOVacio(v: unknown, f: Formatos) {
  return typeof v === 'string' && v ? f.fecha(v) : '—'
}

function delRequerimiento(antes: Objeto, despues: Objeto, f: Formatos): string[] {
  const salida: string[] = []
  if (!igual(antes.codigo_interno, despues.codigo_interno)) {
    salida.push(cambio('Código interno', texto(antes.codigo_interno), texto(despues.codigo_interno)))
  }
  if (!igual(antes.fecha_requerida, despues.fecha_requerida)) {
    salida.push(cambio('Se necesita el', fechaOVacio(antes.fecha_requerida, f), fechaOVacio(despues.fecha_requerida, f)))
  }
  if (!igual(antes.justificacion, despues.justificacion)) salida.push('Se corrigió la justificación.')
  const previas = new Map(lista(antes.lineas).map((l) => [Number(l.item), l]))
  for (const l of lista(despues.lineas)) {
    const p = previas.get(Number(l.item))
    if (!p) continue
    if (!igual(p.material_id, l.material_id) || !igual(p.descripcion, l.descripcion)) {
      salida.push(cambio(`Insumo ${l.item}`, texto(p.descripcion), texto(l.descripcion)))
    }
    if (!igual(numero(p.cantidad), numero(l.cantidad))) {
      salida.push(cambio(`Cantidad del insumo ${l.item}`, f.cantidad(Number(p.cantidad)), f.cantidad(Number(l.cantidad))))
    }
  }
  return salida
}

function deLaOrden(antes: Objeto, despues: Objeto, f: Formatos, moneda: 'PEN' | 'USD'): string[] {
  const salida: string[] = []
  if (!igual(antes.con_factura, despues.con_factura)) {
    const como = (v: unknown) => (v === true ? 'con factura' : 'sin factura')
    salida.push(cambio('Comprobante', como(antes.con_factura), como(despues.con_factura)))
  }
  if (!igual(antes.codigo_interno, despues.codigo_interno)) {
    salida.push(cambio('Código interno', texto(antes.codigo_interno), texto(despues.codigo_interno)))
  }
  const previas = new Map(lista(antes.lineas).map((l) => [String(l.detalle_id), l]))
  lista(despues.lineas).forEach((l, i) => {
    const p = previas.get(String(l.detalle_id))
    if (!p) return
    const nombre = (typeof l.material_id === 'string' && f.material(l.material_id)) || `Línea ${i + 1}`
    if (!igual(numero(p.cantidad), numero(l.cantidad))) {
      salida.push(cambio(`Cantidad de ${nombre}`, f.cantidad(Number(p.cantidad)), f.cantidad(Number(l.cantidad))))
    }
    if (!igual(numero(p.precio_unitario), numero(l.precio_unitario))) {
      const precio = (v: unknown) => (numero(v) === null ? 'sin precio' : f.dinero(Number(v), moneda))
      salida.push(cambio(`Precio sin IGV de ${nombre}`, precio(p.precio_unitario), precio(l.precio_unitario)))
    }
  })
  return salida
}

function deLaFactura(antes: Objeto, despues: Objeto, f: Formatos): string[] {
  const salida: string[] = []
  const moneda = (v: unknown): 'PEN' | 'USD' => (v === 'USD' ? 'USD' : 'PEN')
  const campos: [string, string, (v: unknown) => string][] = [
    ['proveedor', 'Proveedor', texto],
    ['numero_documento', 'Número', texto],
    ['fecha_emision', 'Emitida el', (v) => fechaOVacio(v, f)],
    ['fecha_vencimiento', 'Vence el', (v) => fechaOVacio(v, f)],
    ['condicion_pago', 'Condición', (v) => (v === 'CREDITO' ? 'crédito' : 'contado')],
    ['moneda', 'Moneda', (v) => (v === 'USD' ? 'dólares' : 'soles')],
  ]
  for (const [clave, etiqueta, como] of campos) {
    if (!igual(antes[clave], despues[clave])) salida.push(cambio(etiqueta, como(antes[clave]), como(despues[clave])))
  }
  if (!igual(numero(antes.total), numero(despues.total))) {
    salida.push(cambio('Total', f.dinero(Number(antes.total), moneda(antes.moneda)), f.dinero(Number(despues.total), moneda(despues.moneda))))
  }
  if (!igual(antes.observacion, despues.observacion)) salida.push('Se corrigió la observación.')
  if (!igual(antes.ruta_storage, despues.ruta_storage) || !igual(antes.documento_compra_id, despues.documento_compra_id)) {
    salida.push('Se reemplazó el PDF de la factura.')
  }
  const previas = (Array.isArray(antes.ordenes) ? antes.ordenes : []).map(String)
  const nuevas = (Array.isArray(despues.ordenes) ? despues.ordenes : []).map(String)
  const nombre = (id: string) => f.oc(id) ?? 'una OC'
  const entran = nuevas.filter((id) => !previas.includes(id)).map(nombre)
  const salen = previas.filter((id) => !nuevas.includes(id)).map(nombre)
  if (entran.length) salida.push(`Se sumó ${entran.length === 1 ? 'la' : 'las'} ${entran.join(', ')}.`)
  if (salen.length) salida.push(`Salió ${salen.length === 1 ? 'la' : 'las'} ${salen.join(', ')} (queda anotada como quitada).`)
  return salida
}

/** Lo que cambió en una corrección, en frases cortas: «Total: S/ 1 180.00 → S/ 1 185.90». */
export function cambiosDeCorreccion(
  documento: string,
  antes: unknown,
  despues: unknown,
  f: Formatos,
  monedaDelDocumento: string | null = null,
): string[] {
  const a = objeto(antes)
  const d = objeto(despues)
  if (documento === 'REQUERIMIENTO') return delRequerimiento(a, d, f)
  if (documento === 'ORDEN_COMPRA') return deLaOrden(a, d, f, monedaDelDocumento === 'USD' ? 'USD' : 'PEN')
  if (documento === 'FACTURA_COMPRA') return deLaFactura(a, d, f)
  return []
}

/** Los ids de OC y de materiales que nombra una corrección, para buscarles su número y su nombre. */
export function idsDeCorreccion(antes: unknown, despues: unknown): { ordenes: string[]; materiales: string[] } {
  const ordenes = new Set<string>()
  const materiales = new Set<string>()
  for (const lado of [objeto(antes), objeto(despues)]) {
    if (Array.isArray(lado.ordenes)) for (const id of lado.ordenes) ordenes.add(String(id))
    for (const l of lista(lado.lineas)) if (typeof l.material_id === 'string') materiales.add(l.material_id)
  }
  return { ordenes: [...ordenes], materiales: [...materiales] }
}
