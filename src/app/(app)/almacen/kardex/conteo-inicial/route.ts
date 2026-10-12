import { NextResponse } from 'next/server'

import { catalogoDeAlmacen } from '@/lib/datos/atencion-materiales'
import { materialesDelKardex } from '@/lib/datos/kardex'
import { generarConteoInicial } from '@/lib/documentos/excel-almacen'
import { hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

/** El formato para el conteo inicial: el catálogo activo con el saldo que el sistema tiene hoy. */
export async function GET() {
  const perfil = await exigirPermiso('almacen.recibir')
  const [catalogo, existencias] = await Promise.all([catalogoDeAlmacen(), materialesDelKardex()])
  const saldo = new Map(existencias.map((m) => [m.material_id, m.existencia]))

  const archivo = await generarConteoInicial({
    materiales: catalogo
      .map((m) => ({ codigo: m.codigo, descripcion: m.descripcion, unidad: m.unidad, saldo: saldo.get(m.id) ?? 0 }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es')),
    generadoEn: new Date(),
    generadoPor: `${perfil.nombres} ${perfil.apellidos}`.trim(),
  })
  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="MW-Conteo-Inicial-${hoyLima()}.xlsx"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
