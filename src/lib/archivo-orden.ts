import { leerDatosOrdenPdf } from '@/lib/orden-pdf'

/** Lee la primera hoja; si es una imagen, intenta OCR sin subir el archivo. */
export async function leerArchivoOrden(archivo: File, progreso: (mensaje: string) => void) {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(await archivo.arrayBuffer()))
  const { text } = await extractText(pdf, { mergePages: false })
  let contenido = text.join('\n')
  let datos = leerDatosOrdenPdf(contenido, archivo.name)
  if ((!datos.numero || !datos.fechaEntrega) && contenido.trim().length < 80) {
    progreso('El PDF es una imagen. Leyendo la primera página…')
    const { createWorker } = await import('tesseract.js')
    const worker = await createWorker('spa+eng')
    try {
      const pagina = await pdf.getPage(1)
      const viewport = pagina.getViewport({ scale: 1.6 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const contexto = canvas.getContext('2d')
      if (!contexto) throw new Error('No se pudo preparar la página para su lectura.')
      await pagina.render({ canvas, canvasContext: contexto, viewport }).promise
      contenido = (await worker.recognize(canvas)).data.text
      pagina.cleanup()
      datos = leerDatosOrdenPdf(contenido, archivo.name)
    } finally {
      await worker.terminate()
    }
  }
  return datos
}
