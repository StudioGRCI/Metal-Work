import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'

import { DocumentoControlVehicular } from '@/lib/documentos/control-vehicular'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: Request, context: RouteContext<'/ordenes/[id]/control-vehicular/pdf'>) {
  await exigirPermiso(['costos.controlar_ot', 'costos.ver'])
  const { id } = await context.params
  const db = await createClient()
  const [orden, control, items] = await Promise.all([
    db.from('ordenes_trabajo').select('numero, cliente:clientes!ordenes_trabajo_cliente_id_fkey(razon_social)').eq('id', id).maybeSingle(),
    db.from('ot_control_vehicular').select('placa, marca, conductor_ingreso, dni_ingreso, fecha_ingreso, combustible_ingreso, conductor_salida, dni_salida, fecha_salida, combustible_salida, adicionales, trabajos, observacion_ingreso, observacion_salida, items').eq('orden_id', id).maybeSingle(),
    db.from('control_vehicular_items').select('codigo, categoria, nombre, orden').order('orden'),
  ])
  if (orden.error || control.error || items.error) return NextResponse.json({ error: 'No se pudo leer la ficha de esta OT.' }, { status: 500 })
  if (!orden.data) return NextResponse.json({ error: 'No se encontró la OT.' }, { status: 404 })
  const buffer = await renderToBuffer(<DocumentoControlVehicular
    numeroOt={orden.data.numero}
    cliente={orden.data.cliente?.razon_social ?? ''}
    items={items.data ?? []}
    control={control.data}
  />)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="MW-Control-Vehicular-OT-' + orden.data.numero + '.pdf"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
