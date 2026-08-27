import { NextResponse } from 'next/server'

import { cotizacionParaImprimir } from '@/lib/datos/impresion'
import { nombreArchivoCotizacion, pdfDeCotizacion } from '@/lib/pdf/cotizacion'
import { obtenerSesion, puede } from '@/lib/sesion'

/**
 * La cotización en el formato de la empresa, lista para enviar al cliente.
 *
 * Va por ruta y no por acción de servidor porque el navegador tiene que
 * recibir el archivo: una acción devuelve datos, no un adjunto. El nombre del
 * archivo viaja en la cabecera para que el vendedor no tenga que renombrarlo.
 */
export async function GET(_peticion: Request, contexto: RouteContext<'/cotizaciones/[id]/pdf'>) {
  const perfil = await obtenerSesion()
  if (!perfil) {
    return NextResponse.json({ error: 'Inicia sesión para descargar el documento.' }, { status: 401 })
  }
  if (!perfil.activo || !puede(perfil, 'cotizaciones.ver')) {
    return NextResponse.json({ error: 'No tienes permiso para ver cotizaciones.' }, { status: 403 })
  }

  const { id } = await contexto.params
  const datos = await cotizacionParaImprimir(id)
  if (!datos) {
    return NextResponse.json({ error: 'La cotización no existe o no puedes verla.' }, { status: 404 })
  }

  const pdf = await pdfDeCotizacion(datos)

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${nombreArchivoCotizacion(datos)}"`,
      // Es un documento con precios: no se guarda en ninguna caché intermedia.
      'cache-control': 'private, no-store',
    },
  })
}
