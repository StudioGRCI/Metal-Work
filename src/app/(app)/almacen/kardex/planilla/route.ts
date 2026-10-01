import { NextResponse } from 'next/server'

import { catalogoDeAlmacen } from '@/lib/datos/atencion-materiales'
import { materialesDelKardex, unidadesParaSalida } from '@/lib/datos/kardex'
import { generarPlanillaAlmacen } from '@/lib/documentos/excel-almacen'
import { hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

/**
 * La planilla para anotar ingresos y salidas sin internet: el catálogo activo
 * con el saldo de hoy y las unidades a las que se puede sacar material.
 * La baja quien registra en el almacén.
 */
export async function GET() {
  const perfil = await exigirPermiso(['almacen.recibir', 'almacen.despachar'])
  const [catalogo, existencias, unidades] = await Promise.all([catalogoDeAlmacen(), materialesDelKardex(), unidadesParaSalida()])
  const saldo = new Map(existencias.map((m) => [m.material_id, m]))

  const archivo = await generarPlanillaAlmacen({
    materiales: catalogo
      .map((m) => ({ codigo: m.codigo, descripcion: m.descripcion, unidad: m.unidad, saldo: saldo.get(m.id)?.existencia ?? 0, libre: saldo.get(m.id)?.disponible ?? 0 }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo, 'es')),
    unidades: unidades
      .map((u) => ({ identificador: (u.codigo_interno?.trim() || u.placa?.trim() || '').toUpperCase(), placa: u.placa, vehiculo: u.vehiculo, ordenes: u.ordenes }))
      .filter((u) => u.identificador)
      .sort((a, b) => a.identificador.localeCompare(b.identificador, 'es')),
    generadoEn: new Date(),
    generadoPor: `${perfil.nombres} ${perfil.apellidos}`.trim(),
  })
  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="MW-Planilla-Almacen-${hoyLima()}.xlsx"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
