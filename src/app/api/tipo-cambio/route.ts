import { NextResponse } from 'next/server'

import { hoyLima } from '@/lib/format'
import { createAdminClient } from '@/lib/supabase/server'
import { traerDeSunat } from '@/lib/tipo-cambio/sunat'

/**
 * El tipo de cambio del día, una vez al día, sin que nadie se acuerde.
 *
 * Lo llama el cron de Vercel (ver `vercel.json`). La alternativa era confiar en
 * que alguien entre a Configuración todas las mañanas: el sistema no se cae
 * cuando eso no pasa, sigue costeando con el cambio de la última vez que
 * alguien se acordó, y eso no lo nota nadie hasta que se compra el material.
 *
 * No hay sesión en un cron, así que escribe con la clave de servicio. Por eso
 * la puerta: sin `CRON_SECRET` configurado, esta ruta no hace nada. Es
 * preferible que el cron no corra a que quede abierta al mundo una ruta que
 * escribe en la base saltándose RLS.
 */
export const dynamic = 'force-dynamic'

function autorizado(pedido: Request): boolean {
  const secreto = process.env.CRON_SECRET
  if (!secreto) return false
  return pedido.headers.get('authorization') === `Bearer ${secreto}`
}

export async function GET(pedido: Request) {
  if (!autorizado(pedido)) {
    // Sin detalle: a quien llama sin permiso no se le cuenta si el secreto no
    // está configurado o si lo mandó mal.
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const fecha = hoyLima()
  const supabase = createAdminClient()

  // Si ya está, no se consulta: el servicio corta con 429 a la segunda consulta
  // seguida, y un valor corregido a mano no se pisa con el automático.
  const { data: yaEsta } = await supabase
    .from('tipos_cambio')
    .select('fecha, venta, fuente')
    .eq('fecha', fecha)
    .maybeSingle()

  if (yaEsta) {
    return NextResponse.json({ estado: 'ya estaba', fecha, venta: yaEsta.venta, fuente: yaEsta.fuente })
  }

  const resultado = await traerDeSunat(fecha)
  if (!resultado.ok) {
    // 200 a propósito cuando se puede reintentar: un 500 haría que Vercel lo
    // marque como fallo y llene el registro de alarmas por algo que se arregla
    // solo mañana. Lo que no se puede reintentar sí es un fallo de verdad.
    return NextResponse.json(
      { estado: 'sin cambio', fecha, motivo: resultado.error },
      { status: resultado.reintentable ? 200 : 500 },
    )
  }

  const { cambio } = resultado
  const { error } = await supabase
    .from('tipos_cambio')
    .upsert(
      { fecha: cambio.fecha, compra: cambio.compra, venta: cambio.venta, fuente: cambio.fuente },
      { onConflict: 'fecha' },
    )

  if (error) {
    return NextResponse.json({ estado: 'no se pudo guardar', motivo: error.message }, { status: 500 })
  }

  return NextResponse.json({ estado: 'guardado', ...cambio })
}
