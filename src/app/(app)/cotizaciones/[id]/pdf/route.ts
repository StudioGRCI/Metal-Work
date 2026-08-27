import { NextResponse } from 'next/server'
import { z } from 'zod'

import { cotizacionParaImprimir } from '@/lib/datos/impresion'
import { marcarEnviadaAlDescargar } from '@/app/(app)/cotizaciones/acciones'
import { nombreArchivoCotizacion, pdfDeCotizacion } from '@/lib/pdf/cotizacion'
import { obtenerSesion, puede } from '@/lib/sesion'

/**
 * La cotización en el formato de la empresa, lista para enviar al cliente.
 *
 * Va por ruta y no por acción de servidor porque el navegador tiene que
 * recibir el archivo: una acción devuelve datos, no un adjunto. El nombre del
 * archivo viaja en la cabecera para que el vendedor no tenga que renombrarlo.
 */
export async function GET(peticion: Request, contexto: RouteContext<'/cotizaciones/[id]/pdf'>) {
  const { id } = await contexto.params

  const perfil = await obtenerSesion()
  if (!perfil || !perfil.activo) {
    return sinPapel(peticion, id, 'Inicia sesión para descargar el documento.')
  }
  if (!puede(perfil, 'cotizaciones.ver')) {
    return sinPapel(peticion, id, 'No tienes permiso para ver cotizaciones.')
  }

  // Un identificador que no es un identificador es una cotización que no
  // existe, no un error del servidor.
  if (!z.string().uuid().safeParse(id).success) {
    return sinPapel(peticion, id, 'La cotización no existe.')
  }

  let datos
  try {
    datos = await cotizacionParaImprimir(id)
  } catch {
    return sinPapel(peticion, id, 'No se pudo armar el documento. Vuelve a intentarlo.')
  }

  if (!datos) return sinPapel(peticion, id, 'La cotización no existe o no puedes verla.')

  let pdf: Buffer
  try {
    pdf = await pdfDeCotizacion(datos)
  } catch {
    return sinPapel(peticion, id, 'No se pudo armar el documento. Vuelve a intentarlo.')
  }

  // Recién ahora, con el papel en la mano, el borrador cuenta como enviado:
  // marcarlo antes dejaba cotizaciones «enviadas» que nunca llegaron a salir.
  await marcarEnviadaAlDescargar(id)

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${nombreArchivoCotizacion(datos)}"`,
      // Es un documento con precios: no se guarda en ninguna caché intermedia.
      'cache-control': 'private, no-store',
    },
  })
}

/**
 * Cuando no hay papel que entregar, el navegador tiene que ver el motivo, no
 * guardarlo en la carpeta de descargas: el enlace lleva «download», así que un
 * JSON de error terminaba en el disco del vendedor con nombre «pdf» y sin que
 * nada apareciera en pantalla. Se le devuelve a la cotización con el aviso.
 */
function sinPapel(peticion: Request, id: string, motivo: string) {
  // Con un identificador que no lo es, no hay detalle al que volver.
  const ruta = z.string().uuid().safeParse(id).success
    ? `/cotizaciones/${id}`
    : '/cotizaciones'

  const destino = new URL(ruta, peticion.url)
  destino.searchParams.set('aviso', motivo)
  return NextResponse.redirect(destino, { status: 303 })
}
