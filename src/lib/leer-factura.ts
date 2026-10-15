import {
  leerFacturaDeTexto,
  leerFacturaDeXml,
  lecturaUtil,
  type LecturaFactura,
} from '@/lib/dominio/lectura-factura'

/**
 * El detector de la factura, en el navegador: lee el XML de SUNAT (suelto o en
 * su .zip) o el texto del PDF, y si el PDF es un escaneo, lo pasa por OCR. La
 * factura no sale del navegador: se lee aquí, y solo lo leído viaja con el
 * registro. Las librerías se cargan cuando hacen falta.
 *
 * Nunca falla: si no puede leer, devuelve null y el registro sigue como siempre.
 */

/** Lo que acepta el campo del XML: el .xml de SUNAT o el .zip en que lo manda el proveedor. */
export const ACEPTA_XML_FACTURA = '.xml,.zip,text/xml,application/xml,application/zip,application/x-zip-compressed'

const MAXIMO = 20 * 1024 * 1024

function esZip(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

function esPdf(bytes: Uint8Array) {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** El XML de la factura, no la constancia de recepción (CDR, ApplicationResponse) que viene en el mismo .zip. */
const esFacturaUbl = (xml: string) => /<(?:\w+:)?(?:Invoice|CreditNote|DebitNote)\b/.test(xml) && !/<(?:\w+:)?ApplicationResponse\b/.test(xml)

async function leerXml(bytes: Uint8Array): Promise<LecturaFactura | null> {
  if (esZip(bytes)) {
    const { unzipSync, strFromU8 } = await import('fflate')
    const partes = unzipSync(bytes, { filter: (f) => /\.xml$/i.test(f.name) && f.originalSize < MAXIMO })
    for (const contenido of Object.values(partes)) {
      const xml = strFromU8(contenido)
      if (esFacturaUbl(xml)) return leerFacturaDeXml(xml)
    }
    return null
  }
  const xml = new TextDecoder().decode(bytes)
  return esFacturaUbl(xml) ? leerFacturaDeXml(xml) : null
}

async function leerPdf(bytes: Uint8Array, progreso?: (mensaje: string) => void): Promise<LecturaFactura | null> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: false })
  const delTexto = leerFacturaDeTexto(text.join('\n'), 'PDF')
  if (delTexto.total !== null) return delTexto
  // Sin total en el texto: es un escaneo o una foto. Una factura cabe en dos hojas.
  progreso?.('La factura es un escaneo: leyéndola…')
  const tesseract = await import('tesseract.js')
  const worker = await tesseract.createWorker('spa')
  const paginas: string[] = []
  try {
    for (let numero = 1; numero <= Math.min(pdf.numPages, 2); numero++) {
      const pagina = await pdf.getPage(numero)
      const viewport = pagina.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const contexto = canvas.getContext('2d')
      if (!contexto) break
      await pagina.render({ canvas, canvasContext: contexto, viewport }).promise
      paginas.push((await worker.recognize(canvas)).data.text)
      canvas.width = 0
      canvas.height = 0
      pagina.cleanup()
    }
  } finally {
    await worker.terminate()
  }
  const delOcr = leerFacturaDeTexto(paginas.join('\n'), 'OCR')
  // Lo que el texto sí trajo (el número, las OC) vale más que lo del OCR.
  return {
    ...delOcr,
    numero: delTexto.numero ?? delOcr.numero,
    fecha_emision: delTexto.fecha_emision ?? delOcr.fecha_emision,
    moneda: delOcr.moneda ?? delTexto.moneda,
    ordenes: [...new Set([...delTexto.ordenes, ...delOcr.ordenes])],
  }
}

/** Lee la factura: el XML de SUNAT o el PDF. Null si no es una factura o no se pudo leer nada útil. */
export async function leerFactura(archivo: Blob, progreso?: (mensaje: string) => void): Promise<LecturaFactura | null> {
  if (archivo.size < 5 || archivo.size > MAXIMO) return null
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    const lectura = esPdf(bytes) ? await leerPdf(bytes, progreso) : await leerXml(bytes)
    return lecturaUtil(lectura) ? lectura : null
  } catch {
    // Dañado, protegido o un formato que no es: el detector calla.
    return null
  }
}

/** La factura que ya subió Logística, desde su enlace firmado. */
export async function leerFacturaDeEnlace(url: string, progreso?: (mensaje: string) => void): Promise<LecturaFactura | null> {
  try {
    const respuesta = await fetch(url)
    if (!respuesta.ok) return null
    return await leerFactura(await respuesta.blob(), progreso)
  } catch {
    return null
  }
}

/** Lo leído, en campos ocultos del formulario: viaja con el registro. */
export function camposDeLectura(l: LecturaFactura | null): Record<string, string> {
  return {
    lectura_fuente: l?.fuente ?? '',
    lectura_total: l?.total === null || l?.total === undefined ? '' : l.total.toFixed(2),
    lectura_moneda: l?.moneda ?? '',
    lectura_numero: l?.numero ?? '',
    lectura_ordenes: (l?.ordenes ?? []).join(','),
  }
}
