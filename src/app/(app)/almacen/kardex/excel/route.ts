import { NextRequest, NextResponse } from 'next/server'

import { filtrosDeKardex, kardexParaExcel, materialesDelKardex } from '@/lib/datos/kardex'
import { generarKardexExcel } from '@/lib/documentos/excel-almacen'
import { fecha as fechaCorta, hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

const TIPO: Record<string, string> = { INGRESO: 'Solo ingresos', SALIDA: 'Solo egresos', AJUSTE: 'Solo ajustes' }

/**
 * El kardex en Excel, con los filtros que tenga la pantalla: todo el almacén
 * o la ficha de un material, en orden de fecha y con el saldo de cada línea.
 * Lo baja quien lee el kardex (`almacen.ver`), igual que la pantalla.
 */
export async function GET(request: NextRequest) {
  const perfil = await exigirPermiso('almacen.ver')
  const filtros = filtrosDeKardex(Object.fromEntries(request.nextUrl.searchParams))
  const [{ filas, truncado }, materiales] = await Promise.all([
    kardexParaExcel(filtros),
    filtros.material ? materialesDelKardex() : Promise.resolve([]),
  ])
  const elegido = filtros.material ? materiales.find((m) => m.material_id === filtros.material) : undefined

  const partes = [
    elegido ? `Material: ${elegido.descripcion} (${elegido.codigo})` : 'Todo el almacén',
    filtros.tipo ? TIPO[filtros.tipo] : null,
    filtros.desde ? `desde el ${fechaCorta(filtros.desde)}` : null,
    filtros.hasta ? `hasta el ${fechaCorta(filtros.hasta)}` : null,
    filtros.unidad ? `unidad o código «${filtros.unidad}»` : null,
  ].filter(Boolean)

  const archivo = await generarKardexExcel({
    filas,
    filtrosTexto: partes.join(' · '),
    porMaterial: Boolean(elegido),
    truncado,
    generadoEn: new Date(),
    generadoPor: `${perfil.nombres} ${perfil.apellidos}`.trim(),
  })
  const nombre = `MW-Kardex-${elegido ? elegido.codigo.replace(/[^\w-]+/g, '_') : 'Almacen'}-${hoyLima()}.xlsx`
  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
