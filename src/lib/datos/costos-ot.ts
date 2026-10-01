import 'server-only'

import { createClient } from '@/lib/supabase/server'

export async function controlesYSolicitudesDeOrden(ordenId: string, verCosteo: boolean) {
  const supabase = await createClient()
  const [control, items, solicitudes, gastos, costeo] = await Promise.all([
    supabase.from('ot_control_vehicular')
      .select('id, orden_id, placa, marca, conductor_ingreso, dni_ingreso, fecha_ingreso, combustible_ingreso, conductor_salida, dni_salida, fecha_salida, combustible_salida, adicionales, trabajos, observacion_ingreso, observacion_salida, items, ingreso_cerrado_en, salida_cerrada_en, escaneo_ruta, escaneo_nombre')
      .eq('orden_id', ordenId).maybeSingle(),
    supabase.from('control_vehicular_items')
      .select('codigo, categoria, nombre, orden').order('orden'),
    supabase.from('ot_solicitudes_tesoreria')
      .select('id, tipo, concepto, monto, moneda, estado, respuesta, creado_en, atendido_en, solicitante:usuarios!ot_solicitudes_tesoreria_solicitado_por_fkey(nombres, apellidos), atendedor:usuarios!ot_solicitudes_tesoreria_atendido_por_fkey(nombres, apellidos)')
      .eq('orden_id', ordenId).order('creado_en', { ascending: false }),
    supabase.from('ot_gastos_areas')
      .select('id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, observacion_revision, creado_en, area:areas!ot_gastos_areas_area_id_fkey(nombre), registrador:usuarios!ot_gastos_areas_registrado_por_fkey(nombres, apellidos)')
      .eq('orden_id', ordenId).order('creado_en', { ascending: false }).limit(200),
    verCosteo ? supabase.rpc('resumen_costeo_ot', { p_orden: ordenId }) : Promise.resolve({ data: [], error: null }),
  ])
  if (control.error) throw new Error(`No se pudo leer la ficha vehicular: ${control.error.message}`)
  if (items.error) throw new Error(`No se pudieron leer los puntos de control: ${items.error.message}`)
  if (solicitudes.error) throw new Error(`No se pudieron leer las solicitudes: ${solicitudes.error.message}`)
  if (gastos.error) throw new Error(`No se pudieron leer los gastos: ${gastos.error.message}`)
  if (costeo.error) throw new Error(`No se pudo calcular el costeo: ${costeo.error.message}`)
  const rutas = gastos.data?.map(g => g.comprobante_ruta) ?? []
  const [urlsGastos, urlControl] = await Promise.all([
    rutas.length ? supabase.storage.from('gastos-ot').createSignedUrls(rutas, 600) : Promise.resolve({ data: [], error: null }),
    control.data?.escaneo_ruta
      ? supabase.storage.from('control-ot').createSignedUrl(control.data.escaneo_ruta, 600)
      : Promise.resolve({ data: null, error: null }),
  ])
  if (urlsGastos.error) throw new Error(`No se pudieron abrir los comprobantes: ${urlsGastos.error.message}`)
  if (urlControl.error) throw new Error(`No se pudo abrir el escaneo: ${urlControl.error.message}`)
  return {
    control: control.data,
    items: items.data ?? [],
    solicitudes: solicitudes.data ?? [],
    gastos: (gastos.data ?? []).map((g, i) => ({ ...g, url: urlsGastos.data?.[i]?.signedUrl ?? null })),
    costeo: costeo.data ?? [],
    escaneoUrl: urlControl.data?.signedUrl ?? null,
  }
}

export async function solicitudesPendientesTesoreria() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_solicitudes_tesoreria')
    .select('id, orden_id, tipo, concepto, monto, moneda, creado_en, orden:ordenes_trabajo!ot_solicitudes_tesoreria_orden_id_fkey(numero), solicitante:usuarios!ot_solicitudes_tesoreria_solicitado_por_fkey(nombres, apellidos)')
    .eq('estado', 'PENDIENTE').order('creado_en').limit(100)
  if (error) throw new Error(`No se pudieron leer las solicitudes pendientes: ${error.message}`)
  return data ?? []
}

/**
 * Lo que lleva costado cada orden, en soles, para ponerlo al lado de su avance
 * en el tablero: lo comprado en dólares entra al cambio de su fecha. Una llamada
 * por orden —son pocas, las que caben en el tablero—; si una falla, esa orden
 * sale sin cifra en vez de tumbar la pantalla. Solo se llama con `costos.ver`;
 * el margen, además, solo con el precio a la vista (`conMargen`).
 */
export async function costoDeOrdenes(ids: string[], opciones: { conMargen?: boolean } = {}) {
  const supabase = await createClient()
  const filas = await Promise.all(
    ids.map(async (id) => {
      const [costo, margen] = await Promise.all([
        supabase.rpc('costeo_ot_en_soles', { p_orden: id }),
        opciones.conMargen ? supabase.rpc('margen_ot', { p_orden: id }).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ])
      if (costo.error || !costo.data) return [id, null] as const
      const total = { pen: 0, sinPrecio: 0, sinCambio: 0, margenPct: null as number | null }
      for (const l of costo.data) {
        if (l.fuente === 'MATERIALES_SIN_PRECIO') total.sinPrecio += 1
        else if (l.monto_pen === null && l.moneda === 'USD') total.sinCambio += 1
        else total.pen += Number(l.monto_pen ?? 0)
      }
      // Sin costo cargado el margen saldría 100 %: no se muestra hasta que haya costo.
      const pct = (margen.data as { margen_pct: number | null } | null)?.margen_pct
      total.margenPct = pct === null || pct === undefined || total.pen <= 0 ? null : Number(pct)
      return [id, total] as const
    }),
  )
  return new Map(filas)
}

/**
 * El % de merma que fijó Diseño e Ingeniería para la OT, o null si aún no lo
 * evaluó. La política `ver_ot_mermas` lo muestra a `diseno.planos` y `costos.ver`.
 */
export async function mermaDeOrden(ordenId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('ot_mermas')
    .select('porcentaje, motivo, registrado_en, registrador:usuarios!ot_mermas_registrado_por_fkey(nombres, apellidos)')
    .eq('orden_id', ordenId).maybeSingle()
  if (error) throw new Error(`No se pudo leer la merma de la OT: ${error.message}`)
  return data
}
