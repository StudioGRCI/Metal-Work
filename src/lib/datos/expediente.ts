import 'server-only'

import { enlacesDeFotos } from '@/lib/datos/avances'
import { createClient } from '@/lib/supabase/server'

/**
 * Todo lo que cuenta cómo se fabricó una unidad, en una sola lectura: las
 * etapas con su plan y su real, la hoja de cada área, cada reporte del taller
 * con su foto, lo que costó y cómo salió de planta.
 *
 * Cada consulta pasa por el RLS de quien mira: el supervisor ve las hojas de su
 * área, Diseño los planos, y el costo solo llega a quien tiene `costos.ver`
 * —ni siquiera se pide si no lo tiene—. Lo que una persona no puede ver no
 * aparece, en vez de romper la pantalla.
 *
 * Las etapas se leen de `ot_etapas` y no de `ot_tablero_etapas`, que esconde
 * las órdenes entregadas: el expediente de una unidad ya entregada es
 * justamente el que más se consulta.
 */

export type EtapaExpediente = {
  id: string
  nombre: string
  area: string | null
  area_codigo: string | null
  orden_secuencia: number
  estado: string
  avance: number
  peso: number | null
  inicio_programado: string | null
  fin_programado: string | null
  inicio_real: string | null
  fin_real: string | null
}

export type AreaExpediente = {
  area_codigo: string
  area: string
  actividades: number
  terminadas: number
  avance_pct: number
  ultimo_reporte: string | null
}

export type ReporteExpediente = {
  id: string
  fecha: string
  creado_en: string
  actividad: string
  area: string
  area_codigo: string
  avance_pct: number
  acumulado_pct: number | null
  nota: string | null
  reportado_por: string | null
  revision: string | null
  foto_url: string | null
}

export type LineaCosto = {
  fuente: string
  fecha: string | null
  concepto: string
  detalle: string | null
  cantidad: number | null
  unidad: string | null
  precio_unitario: number | null
  moneda: string | null
  monto: number | null
  referencia: string | null
}

/** Una línea del costo pasada a soles con el cambio de su fecha. */
export type LineaEnSoles = {
  fuente: string
  fecha: string | null
  concepto: string | null
  moneda: string | null
  monto: number | null
  tipo_cambio: number | null
  monto_pen: number | null
}

/** Lo que devuelve `margen_ot`: lo que falte para calcularlo viene en null. */
export type MargenExpediente = {
  moneda_venta: string | null
  precio_venta: number | null
  incluye_igv: boolean | null
  precio_neto: number | null
  cambio_venta: number | null
  precio_neto_pen: number | null
  costo_pen: number
  margen_pen: number | null
  margen_pct: number | null
  despachos_sin_precio: number
  lineas_sin_cambio: number
}

export type CierreExpediente = {
  costo_pen: number
  cerrado_en: string
  nota: string
  cerrado_por: string | null
}

export type ActaExpediente = {
  numero: string | null
  fecha_entrega: string | null
  recibe_nombre: string
  recibe_cargo: string | null
  conforme: boolean | null
  garantia_meses: number | null
  garantia_vence: string | null
  salida_confirmada_en: string | null
}

const TOPE_REPORTES = 500

export async function expedienteDeOrden(ordenId: string, opciones: { verCosteo: boolean; verMargen?: boolean }) {
  const supabase = await createClient()
  const verMargen = opciones.verCosteo && Boolean(opciones.verMargen)

  const [etapas, areas, diario, evidencias, acta, liberacion, salida, planos, materiales, resumen, detalle, enSoles, cierre, margen, venta] =
    await Promise.all([
      supabase
        .from('ot_etapas')
        .select(
          'id, nombre, orden_secuencia, estado, avance_porcentaje, peso_pct, fecha_inicio_programada, fecha_fin_programada, fecha_inicio_real, fecha_fin_real, area:areas!ot_etapas_area_id_fkey(codigo, nombre), catalogo:etapas_catalogo(nombre)',
        )
        .eq('orden_id', ordenId)
        .order('orden_secuencia'),
      supabase
        .from('v_ot_avance_areas')
        .select('area_codigo, area, actividades, terminadas, avance_pct, ultimo_reporte')
        .eq('orden_id', ordenId),
      supabase
        .from('v_ot_avance_diario')
        .select('id, fecha, creado_en, actividad, area, area_codigo, avance_pct, acumulado_pct, nota, reportado_por_nombre, revision')
        .eq('orden_id', ordenId)
        .order('fecha', { ascending: true })
        .order('creado_en', { ascending: true })
        .limit(TOPE_REPORTES),
      // Las fotos se buscan por la orden y no por la lista de reportes: con
      // cientos de identificadores la dirección de la consulta se volvía
      // demasiado larga.
      supabase
        .from('ot_actividad_avances')
        .select('id, foto_ruta')
        .eq('orden_id', ordenId)
        .not('foto_ruta', 'is', null)
        .limit(TOPE_REPORTES),
      supabase
        .from('ot_entregas')
        .select('numero, fecha_entrega, recibe_nombre, recibe_cargo, conforme, garantia_meses, garantia_vence, salida_confirmada_en')
        .eq('orden_id', ordenId)
        .maybeSingle(),
      supabase.from('liberaciones_tesoreria').select('liberado_en, observacion').eq('orden_id', ordenId).maybeSingle(),
      supabase
        .from('ot_salidas')
        .select('creado_en, constancia, entrega:ot_entregas!inner(orden_id)')
        .eq('entrega.orden_id', ordenId)
        .maybeSingle(),
      supabase
        .from('ot_planos')
        .select('id, numero_plano, nombre, peso_pct, fecha_entrega')
        .eq('orden_id', ordenId)
        .order('orden_secuencia'),
      supabase
        .from('v_atencion_materiales')
        .select('material, unidad, area_destino, cantidad_solicitada, cantidad_despachada')
        .eq('orden_id', ordenId)
        .limit(300),
      opciones.verCosteo
        ? supabase.rpc('resumen_costeo_ot', { p_orden: ordenId })
        : Promise.resolve({ data: [], error: null }),
      opciones.verCosteo
        ? supabase.rpc('detalle_costeo_ot', { p_orden: ordenId })
        : Promise.resolve({ data: [], error: null }),
      opciones.verCosteo
        ? supabase.rpc('costeo_ot_en_soles', { p_orden: ordenId })
        : Promise.resolve({ data: [], error: null }),
      opciones.verCosteo
        ? supabase
            .from('ot_cierres_costo')
            .select('costo_pen, cerrado_en, nota, quien:usuarios!ot_cierres_costo_cerrado_por_fkey(cargo, nombres, apellidos)')
            .eq('orden_id', ordenId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      verMargen ? supabase.rpc('margen_ot', { p_orden: ordenId }).maybeSingle() : Promise.resolve({ data: null, error: null }),
      // La cotización de la que salió la OT, para poder confirmar su IGV.
      verMargen
        ? supabase.from('ordenes_trabajo').select('cotizacion_pdf_id').eq('id', ordenId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

  if (etapas.error) throw new Error(`No se pudieron leer las etapas: ${etapas.error.message}`)
  if (diario.error) throw new Error(`No se pudo leer el diario de la unidad: ${diario.error.message}`)
  if (resumen.error) throw new Error(`No se pudo calcular el costo: ${resumen.error.message}`)
  if (detalle.error) throw new Error(`No se pudo leer el detalle del costo: ${detalle.error.message}`)
  if (enSoles.error) throw new Error(`No se pudo pasar el costo a soles: ${enSoles.error.message}`)
  if (cierre.error) throw new Error(`No se pudo leer el cierre del costo: ${cierre.error.message}`)
  if (margen.error) throw new Error(`No se pudo calcular el margen: ${margen.error.message}`)

  const rutas = (evidencias.data ?? []).map((e) => e.foto_ruta).filter((r): r is string => Boolean(r))
  const enlaces = await enlacesDeFotos(rutas, 3600)
  const fotoDe = new Map((evidencias.data ?? []).map((e) => [e.id, e.foto_ruta ? (enlaces[e.foto_ruta] ?? null) : null]))

  return {
    etapas: (etapas.data ?? []).map((e) => {
      const area = e.area as unknown as { codigo: string; nombre: string } | null
      const catalogo = e.catalogo as unknown as { nombre: string } | null
      return {
        id: e.id,
        nombre: e.nombre ?? catalogo?.nombre ?? 'Etapa',
        area: area?.nombre ?? null,
        area_codigo: area?.codigo ?? null,
        orden_secuencia: e.orden_secuencia,
        estado: e.estado,
        avance: Number(e.avance_porcentaje ?? 0),
        peso: e.peso_pct === null ? null : Number(e.peso_pct),
        inicio_programado: e.fecha_inicio_programada,
        fin_programado: e.fecha_fin_programada,
        inicio_real: e.fecha_inicio_real,
        fin_real: e.fecha_fin_real,
      } satisfies EtapaExpediente
    }),
    areas: ((areas.data ?? []) as unknown as AreaExpediente[]).sort((a, b) => a.area.localeCompare(b.area)),
    reportes: (diario.data ?? []).map((r) => ({
      id: r.id as string,
      fecha: r.fecha as string,
      creado_en: r.creado_en as string,
      actividad: r.actividad as string,
      area: r.area as string,
      area_codigo: r.area_codigo as string,
      avance_pct: Number(r.avance_pct ?? 0),
      acumulado_pct: r.acumulado_pct === null ? null : Number(r.acumulado_pct),
      nota: r.nota,
      reportado_por: r.reportado_por_nombre,
      revision: r.revision,
      foto_url: r.id ? (fotoDe.get(r.id) ?? null) : null,
    })) satisfies ReporteExpediente[],
    reportesAlTope: (diario.data ?? []).length >= TOPE_REPORTES,
    acta: (acta.data ?? null) as ActaExpediente | null,
    liberacion: liberacion.data ?? null,
    salida: salida.data ? { creado_en: salida.data.creado_en, constancia: salida.data.constancia } : null,
    planos: planos.data ?? [],
    materiales: materiales.data ?? [],
    costo: opciones.verCosteo
      ? {
          resumen: (resumen.data ?? []) as { fuente: string | null; moneda: string | null; monto: number | null; pendientes: number | null }[],
          lineas: (detalle.data ?? []) as LineaCosto[],
          enSoles: ((enSoles.data ?? []) as LineaEnSoles[]).map((l) => ({
            ...l,
            monto: l.monto === null ? null : Number(l.monto),
            tipo_cambio: l.tipo_cambio === null ? null : Number(l.tipo_cambio),
            monto_pen: l.monto_pen === null ? null : Number(l.monto_pen),
          })),
          cierre: cierre.data
            ? ({
                costo_pen: Number(cierre.data.costo_pen),
                cerrado_en: cierre.data.cerrado_en,
                nota: cierre.data.nota,
                cerrado_por: (() => {
                  const q = cierre.data.quien as unknown as { cargo: string | null; nombres: string; apellidos: string } | null
                  return q ? (q.cargo ?? `${q.nombres} ${q.apellidos}`) : null
                })(),
              } satisfies CierreExpediente)
            : null,
        }
      : null,
    margen: margen.data ? (normalizarMargen(margen.data as Record<string, unknown>) satisfies MargenExpediente) : null,
    cotizacionId: (venta.data as { cotizacion_pdf_id: string | null } | null)?.cotizacion_pdf_id ?? null,
  }
}

export type Expediente = Awaited<ReturnType<typeof expedienteDeOrden>>

function normalizarMargen(m: Record<string, unknown>): MargenExpediente {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    moneda_venta: (m.moneda_venta as string | null) ?? null,
    precio_venta: n(m.precio_venta),
    incluye_igv: (m.incluye_igv as boolean | null) ?? null,
    precio_neto: n(m.precio_neto),
    cambio_venta: n(m.cambio_venta),
    precio_neto_pen: n(m.precio_neto_pen),
    costo_pen: Number(m.costo_pen ?? 0),
    margen_pen: n(m.margen_pen),
    margen_pct: n(m.margen_pct),
    despachos_sin_precio: Number(m.despachos_sin_precio ?? 0),
    lineas_sin_cambio: Number(m.lineas_sin_cambio ?? 0),
  }
}
