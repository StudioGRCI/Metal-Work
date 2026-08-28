import { NextResponse } from 'next/server'
import { z } from 'zod'

import { cotizacionParaImprimir } from '@/lib/datos/impresion'
import { marcarEnviadaAlDescargar } from '@/app/(app)/cotizaciones/acciones'
import { nombreArchivoCotizacion, pdfDeCotizacion } from '@/lib/pdf/cotizacion'
import { obtenerSesion, puede } from '@/lib/sesion'

/**
 * La cotización en el formato de la empresa.
 *
 * Va por ruta y no por acción de servidor porque el navegador tiene que
 * recibir el archivo: una acción devuelve datos, no un adjunto. El nombre del
 * archivo viaja en la cabecera para que el vendedor no tenga que renombrarlo.
 *
 * Son dos gestos distintos y hasta ahora eran uno solo:
 *
 * · sin `?envia=1` se ve el borrador -el papel se devuelve para mirarlo en el
 *   navegador- y no se toca el estado de nada;
 * · con `?envia=1` el documento se descarga y la cotización pasa a ENVIADA.
 *
 * Mirar cómo va quedando el papel no puede emitirlo. Y no se envía una
 * cotización sin precio: ya pasó -la 3570-2026 quedó ENVIADA con cero partidas
 * y total 0.00-, y lo que el cliente recibía era un documento con membrete,
 * ficha técnica y ni una cifra.
 */
export async function GET(peticion: Request, contexto: RouteContext<'/cotizaciones/[id]/pdf'>) {
  const { id } = await contexto.params
  const envia = new URL(peticion.url).searchParams.get('envia') === '1'

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

  // Una cotización sin partidas no tiene precio: el PDF le omite el bloque
  // entero. Mirarla así está bien -es un borrador-; mandarla, no.
  if (envia && (datos.partidas.length === 0 || Number(datos.total) <= 0)) {
    return sinPapel(
      peticion,
      id,
      'Esta cotización todavía no tiene precio: agrega al menos una partida antes de enviarla.',
    )
  }

  let pdf: Buffer
  try {
    pdf = await pdfDeCotizacion(datos)
  } catch {
    return sinPapel(peticion, id, 'No se pudo armar el documento. Vuelve a intentarlo.')
  }

  // Recién ahora, con el papel en la mano, el borrador cuenta como enviado:
  // marcarlo antes dejaba cotizaciones «enviadas» que nunca llegaron a salir.
  if (envia) await marcarEnviadaAlDescargar(id)

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': envia
        ? `attachment; filename="${nombreArchivoCotizacion(datos)}"`
        : 'inline',
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
