import { NextResponse, type NextRequest } from 'next/server'

import { documentosDeLasCompras, trazabilidadDeCompras } from '@/lib/datos/trazabilidad-compras'
import { generarAdquisicionesExcel } from '@/lib/documentos/excel-adquisiciones'
import { diaLima, hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

/**
 * Las OC y OS emitidas en un mes, en Excel (Plan 10, entrega 10.2), con las
 * columnas que Adquisiciones le muestra a Contabilidad y lo que falta de cada
 * una. Lo baja quien lee Adquisiciones (`adquisiciones.ver`), como la pantalla:
 * no lleva nada que ella no muestre. El mes es el de emisión, en hora de Lima.
 *
 * El formulario es un GET: si el mes no se entiende o la base no contesta, se
 * vuelve a Adquisiciones con el aviso junto al botón (`?excel=`), en vez de bajar
 * otro mes callado o dejar a Contabilidad en una página de error.
 */
export async function GET(request: NextRequest) {
  const perfil = await exigirPermiso('adquisiciones.ver')
  const volver = (aviso: 'mes' | 'fallo') => NextResponse.redirect(new URL(`/adquisiciones?excel=${aviso}`, request.url), 303)
  const pedido = request.nextUrl.searchParams.get('mes')?.trim() || hoyLima().slice(0, 7)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(pedido)) return volver('mes')
  const mes = pedido

  let todas: Awaited<ReturnType<typeof trazabilidadDeCompras>>
  let papeles: Awaited<ReturnType<typeof documentosDeLasCompras>>
  try {
    ;[todas, papeles] = await Promise.all([trazabilidadDeCompras(), documentosDeLasCompras()])
  } catch (e) {
    console.error(e)
    return volver('fallo')
  }
  const filas = todas
    .filter((f) => diaLima(f.creado_en).startsWith(mes))
    // Del más viejo al más nuevo, como se lee un mes.
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
    .map((f) => ({ ...f, papeles: papeles.get(f.id) ?? [] }))

  const archivo = await generarAdquisicionesExcel({
    filas,
    mes,
    generadoEn: new Date(),
    generadoPor: `${perfil.nombres} ${perfil.apellidos}`.trim(),
  })
  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="MW-Adquisiciones-${mes}.xlsx"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
