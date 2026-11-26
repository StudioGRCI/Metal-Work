import { NextResponse, type NextRequest } from 'next/server'

import { controlDeCompras, faltaAlgo } from '@/lib/datos/control-de-compras'
import { generarControlDeCompras } from '@/lib/documentos/excel-control-de-compras'
import { hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

const esDia = (v: string | null): v is string => v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

/**
 * El CONTROL DE FACTURAS en Excel, con el formato que lleva Almacén: entre dos
 * días (`desde` y `hasta`, a lo más un año) o lo pendiente de cualquier día.
 */
export async function GET(pedido: NextRequest) {
  await exigirPermiso(['almacen.ver', 'adquisiciones.ver', 'tesoreria.ver_documentos'])
  const p = pedido.nextUrl.searchParams
  const hoy = hoyLima()
  let filas
  let periodo: string
  let archivo: string
  if (p.get('pendientes') === '1') {
    filas = (await controlDeCompras(null, null)).filter(faltaAlgo)
    periodo = `PENDIENTES AL ${hoy.split('-').reverse().join('/')}`
    archivo = `MW-Control-de-compras-pendientes-${hoy}.xlsx`
  } else {
    const hasta = esDia(p.get('hasta')) ? (p.get('hasta') as string) : hoy
    const pedidoDesde = esDia(p.get('desde')) ? (p.get('desde') as string) : `${hasta.slice(0, 7)}-01`
    // Un año a lo más, y nunca al revés.
    const tope = `${Number(hasta.slice(0, 4)) - 1}${hasta.slice(4)}`
    const desde = pedidoDesde > hasta ? hasta : pedidoDesde < tope ? tope : pedidoDesde
    filas = await controlDeCompras(desde, hasta)
    periodo = `DEL ${desde.split('-').reverse().join('/')} AL ${hasta.split('-').reverse().join('/')}`
    archivo = `MW-Control-de-compras-${desde}-al-${hasta}.xlsx`
  }
  const contenido = await generarControlDeCompras({ filas, periodo })
  return new NextResponse(new Uint8Array(contenido), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${archivo}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
