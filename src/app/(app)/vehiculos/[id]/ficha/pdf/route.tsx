import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { DocumentoControlVehicular } from '@/lib/documentos/control-vehicular'
import { leerLogoDocumento } from '@/lib/documentos/logo'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

// Sin ficha empezada sale el formato con la placa, para llenarlo a mano en la puerta.
const FICHA_EN_BLANCO = {
  marca: '', conductor_ingreso: '', dni_ingreso: '', fecha_ingreso: null, combustible_ingreso: '',
  conductor_salida: '', dni_salida: '', fecha_salida: null, combustible_salida: '',
  adicionales: '', trabajos: '', observacion_ingreso: '', observacion_salida: '', items: {},
}

/**
 * La ficha única de ingreso y salida de un ingreso a la planta, en el formato
 * de Metal Work, para imprimirla y firmarla (migración 20261016110000). Sale
 * con lo que esté llenado: vacía, sirve para llenarla a mano en la puerta. Quién
 * la ve lo decide el RLS del registro y de la ficha.
 */
export async function GET(_request: Request, context: RouteContext<'/vehiculos/[id]/ficha/pdf'>) {
  await exigirPermiso(['vehiculos.registrar', 'vehiculos.ver'])
  const { id } = await context.params
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'El vehículo no está disponible.' }, { status: 404 })
  const db = await createClient()
  const [registro, ficha, items] = await Promise.all([
    db.from('registro_vehiculos').select('placa, chasis, codigo_interno, empresa').eq('id', id).maybeSingle(),
    db
      .from('registro_vehiculo_fichas')
      .select(
        'marca, conductor_ingreso, dni_ingreso, fecha_ingreso, combustible_ingreso, conductor_salida, dni_salida, fecha_salida, combustible_salida, adicionales, trabajos, observacion_ingreso, observacion_salida, items',
      )
      .eq('registro_id', id)
      .maybeSingle(),
    db.from('control_vehicular_items').select('codigo, categoria, nombre, orden').order('orden'),
  ])
  if (registro.error || ficha.error || items.error) return NextResponse.json({ error: 'No se pudo leer la ficha de este vehículo.' }, { status: 500 })
  const r = registro.data
  if (!r) return NextResponse.json({ error: 'El vehículo no está disponible.' }, { status: 404 })
  const placa = r.placa ?? (r.chasis ? `Chasis ${r.chasis}` : '')

  const buffer = await renderToBuffer(
    <DocumentoControlVehicular
      referencia={{ etiqueta: 'Código interno', valor: r.codigo_interno ?? '' }}
      cliente={r.empresa}
      items={items.data ?? []}
      control={{ ...(ficha.data ?? FICHA_EN_BLANCO), placa }}
      logo={await leerLogoDocumento()}
    />,
  )
  const nombre = (r.codigo_interno ?? r.placa ?? 'vehiculo').replace(/[^A-Za-z0-9_-]+/g, '-')
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="MW-Ficha-Vehicular-${nombre}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
