import {
  leerIgvDeCotizacion,
  leerNombreDeArchivo,
  leerTotalDeCotizacion,
  leerTextoDeCotizacion,
  textoDeWordXml,
  unirLecturas,
  type CabeceraCotizacion,
  type TotalCotizacion,
} from '@/lib/cotizacion-pdf'

/**
 * El archivo de una cotización: PDF o Word (migración 103). Lo usan la subida y
 * la corrección, en el navegador.
 */
export const TIPOS_DE_COTIZACION = {
  pdf: { mime: 'application/pdf', etiqueta: 'PDF' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', etiqueta: 'Word' },
  doc: { mime: 'application/msword', etiqueta: 'Word' },
} as const

export type ExtensionCotizacion = keyof typeof TIPOS_DE_COTIZACION

export const ACEPTA_COTIZACION = [
  '.pdf',
  '.docx',
  '.doc',
  ...Object.values(TIPOS_DE_COTIZACION).map((t) => t.mime),
].join(',')

/** De qué tipo es, por la extensión o por lo que dice el navegador; null si no es PDF ni Word. */
export function tipoDeCotizacion(archivo: File): { extension: ExtensionCotizacion; mime: string; etiqueta: string } | null {
  const porNombre = archivo.name.toLowerCase().match(/\.(pdf|docx|doc)$/)?.[1] as ExtensionCotizacion | undefined
  const porMime = (Object.keys(TIPOS_DE_COTIZACION) as ExtensionCotizacion[]).find(
    (e) => TIPOS_DE_COTIZACION[e].mime === archivo.type,
  )
  const extension = porNombre ?? porMime
  return extension ? { extension, ...TIPOS_DE_COTIZACION[extension] } : null
}

/** «PDF» o «Word», para los textos de la pantalla. */
export function etiquetaDeMime(mime: string | null | undefined): string {
  return mime && mime !== TIPOS_DE_COTIZACION.pdf.mime ? 'Word' : 'PDF'
}

const VACIA: CabeceraCotizacion = { numero: null, fecha: null, cliente: null, documento: null, producto: null }

export type LecturaArchivoCotizacion = {
  cabecera: CabeceraCotizacion
  total: TotalCotizacion
  /** Si el papel dice que el total trae IGV; null si no lo dice. */
  incluyeIgv: boolean | null
}

/**
 * La cabecera de la cotización, leída del archivo. Del PDF, la primera hoja; del
 * Word, el encabezado de página y el cuerpo, en ese orden. Un .doc viejo, un
 * escaneo o un archivo dañado no se leen: queda lo que diga el nombre.
 * Las librerías se cargan solo cuando hacen falta.
 */
export async function leerCabeceraDeArchivo(
  archivo: File,
  progreso?: (mensaje: string) => void,
): Promise<LecturaArchivoCotizacion> {
  const tipo = tipoDeCotizacion(archivo)
  let delTexto = VACIA
  let texto = ''
  try {
    if (tipo?.extension === 'pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf')
      const pdf = await getDocumentProxy(new Uint8Array(await archivo.arrayBuffer()))
      const { text } = await extractText(pdf, { mergePages: false })
      texto = text.join('\n')
      delTexto = leerTextoDeCotizacion(texto)
      if (!leerTotalDeCotizacion(texto).monto) {
        progreso?.('El PDF es un escaneo. Preparando lectura…')
        const tesseract = await import('tesseract.js')
        const worker = await tesseract.createWorker('spa+eng', undefined, {
          logger: (m) => {
            if (m.status === 'recognizing text') progreso?.(`Leyendo página ${m.userJobId || ''}…`)
          },
        })
        const paginas: string[] = []
        try {
          const paginasLeidas = Math.min(pdf.numPages, 30)
          for (let numero = 1; numero <= paginasLeidas; numero++) {
            progreso?.(`Leyendo página ${numero} de ${paginasLeidas}…`)
            const pagina = await pdf.getPage(numero)
            const viewport = pagina.getViewport({ scale: 1.6 })
            const canvas = document.createElement('canvas')
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            const contexto = canvas.getContext('2d')
            if (!contexto) throw new Error('No se pudo preparar la página para leerla.')
            await pagina.render({ canvas, canvasContext: contexto, viewport }).promise
            paginas.push((await worker.recognize(canvas)).data.text)
            canvas.width = 0
            canvas.height = 0
            pagina.cleanup()
          }
          if (paginasLeidas < pdf.numPages) progreso?.('Se revisaron las primeras 30 páginas; completa el monto manualmente si no apareció.')
        } finally {
          await worker.terminate()
        }
        const textoOcr = paginas.join('\n')
        if (textoOcr.trim()) {
          texto = `${texto}\n${textoOcr}`
          delTexto = leerTextoDeCotizacion(texto)
        }
      }
    } else if (tipo?.extension === 'docx') {
      const { unzipSync, strFromU8 } = await import('fflate')
      const partes = unzipSync(new Uint8Array(await archivo.arrayBuffer()), {
        filter: (f) => /^word\/(header\d*|document)\.xml$/.test(f.name),
      })
      const orden = Object.keys(partes).sort(
        (a, b) => Number(!a.includes('header')) - Number(!b.includes('header')) || a.localeCompare(b),
      )
      texto = orden.map((k) => textoDeWordXml(strFromU8(partes[k]))).join('\n')
      delTexto = leerTextoDeCotizacion(texto)
    }
  } catch {
    // Escaneado, dañado o protegido: queda lo que diga el nombre del archivo.
  }
  return {
    cabecera: unirLecturas(delTexto, leerNombreDeArchivo(archivo.name)),
    total: leerTotalDeCotizacion(texto),
    incluyeIgv: leerIgvDeCotizacion(texto),
  }
}
