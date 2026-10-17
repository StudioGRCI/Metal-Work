import 'server-only'

import { CODIGO_SIN_AVANCE, normalizarCodigo } from '@/lib/dominio/codigos-internos'
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

export type CostoDeOrden = {
  pen: number
  sinPrecio: number
  sinCambio: number
  /** Horas del reporte de quien todavía no tiene costo: solo en el costo del código. */
  sinCosto: number
  margenPct: number | null
  consumidoPct: number | null
  semaforo: 'EN_RANGO' | 'AJUSTADO' | 'EXCEDIDO' | null
  /** El código interno cuyo costo es este; `null` si la orden no tiene unidad con código y se costea sola. */
  codigo: string | null
}

/**
 * Lo que lleva costado cada orden, en soles, para ponerlo al lado de su avance
 * en el tablero. Desde el 15/10 el código interno es el centro: la orden cuya
 * unidad tiene código muestra el costo y el margen **del código**, el mismo que
 * ve Gerencia en Códigos internos (`codigos_internos_costo`), y no otro que se
 * le separe. Solo la orden sin código se costea sola, con su costeo de siempre
 * (lo comprado en dólares al cambio de su fecha). Una llamada por código o por
 * orden —son pocas, las que caben en el tablero—; si una falla, esa orden sale
 * sin cifra en vez de tumbar la pantalla. Solo se llama con `costos.ver`; el
 * margen y el presupuesto, además, solo con el precio a la vista (`conMargen`).
 */
export async function costoDeOrdenes(
  ordenes: { id: string; codigo_interno?: string | null }[],
  opciones: { conMargen?: boolean } = {},
) {
  const supabase = await createClient()
  const codigoDe = new Map(ordenes.map((o) => [o.id, normalizarCodigo(o.codigo_interno ?? '') || null]))
  const codigos = [...new Set([...codigoDe.values()].filter((c): c is string => c !== null && c !== CODIGO_SIN_AVANCE))]

  const porCodigo = new Map(
    await Promise.all(
      codigos.map(async (codigo) => {
        const { data, error } = await supabase.rpc('codigos_internos_costo', { p_codigo: codigo })
        if (error) return [codigo, null] as const
        // Un código sin nada cargado no trae fila: todavía no cuesta nada.
        const f = data?.[0]
        const total: CostoDeOrden = {
          pen: Number(f?.costo_pen ?? 0),
          sinPrecio: Number(f?.materiales_sin_precio ?? 0),
          sinCambio: Number(f?.lineas_sin_cambio ?? 0),
          sinCosto: Number(f?.horas_sin_costo ?? 0),
          margenPct: null,
          consumidoPct: null,
          semaforo: null,
          codigo,
        }
        // Sin costo cargado el margen saldría 100 %: no se muestra hasta que haya costo.
        if (opciones.conMargen && f && total.pen > 0) {
          total.margenPct = f.margen_pct === null ? null : Number(f.margen_pct)
          total.consumidoPct = f.consumido_pct === null ? null : Number(f.consumido_pct)
          total.semaforo = f.semaforo === 'EN_RANGO' || f.semaforo === 'AJUSTADO' || f.semaforo === 'EXCEDIDO' ? f.semaforo : null
        }
        return [codigo, total] as const
      }),
    ),
  )

  const filas = await Promise.all(
    ordenes.map(async ({ id }) => {
      const codigo = codigoDe.get(id) ?? null
      if (codigo && codigo !== CODIGO_SIN_AVANCE) return [id, porCodigo.get(codigo) ?? null] as const
      // `presupuesto_ot` trae el margen y el semáforo del presupuesto en una llamada.
      const [costo, presupuesto] = await Promise.all([
        supabase.rpc('costeo_ot_en_soles', { p_orden: id }),
        opciones.conMargen
          ? supabase.rpc('presupuesto_ot', { p_orden: id }).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      if (costo.error || !costo.data) return [id, null] as const
      const total: CostoDeOrden = {
        pen: 0,
        sinPrecio: 0,
        sinCambio: 0,
        sinCosto: 0,
        margenPct: null,
        consumidoPct: null,
        semaforo: null,
        codigo: null,
      }
      for (const l of costo.data) {
        if (l.fuente === 'MATERIALES_SIN_PRECIO') total.sinPrecio += 1
        else if (l.monto_pen === null && l.moneda === 'USD') total.sinCambio += 1
        else total.pen += Number(l.monto_pen ?? 0)
      }
      // Sin costo cargado el margen saldría 100 %: no se muestra hasta que haya costo.
      const p = presupuesto.data as { margen_pct: number | null; consumido_pct: number | null; semaforo: string | null } | null
      if (p && total.pen > 0) {
        total.margenPct = p.margen_pct === null ? null : Number(p.margen_pct)
        total.consumidoPct = p.consumido_pct === null ? null : Number(p.consumido_pct)
        total.semaforo = (p.semaforo as typeof total.semaforo) ?? null
      }
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
