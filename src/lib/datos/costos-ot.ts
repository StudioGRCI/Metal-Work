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
  /** El presupuesto lo fijó Gerencia a mano en la OT; si no, es el de la hoja (la venta sin IGV ÷ 1.15). */
  presupuestoFijado: boolean
  /** El código interno cuyo costo es este; `null` si la orden no tiene unidad con código y se costea sola. */
  codigo: string | null
  /** El costeo del código cerrado al entregar la unidad: con qué cifra, cuándo y qué puesto lo cerró. */
  cierre: { costo: number; en: string; por: string | null } | null
  /** La fecha del acta de entrega de la OT del código, si el taller la registró. */
  entregadaEl: string | null
}

/**
 * Lo que lleva costado cada orden, en soles, para ponerlo al lado de su avance
 * en el tablero. Desde el 15/10 el código interno es el centro: la orden cuya
 * unidad tiene código muestra el costo y el margen **del código**, el mismo que
 * ve Gerencia en Códigos internos (`codigos_internos_costo`), y no otro que se
 * le separe. Solo la orden sin código se costea sola, con su costeo de siempre
 * (lo comprado en dólares al cambio de su fecha). Los códigos van en una sola
 * llamada (la base calcula todos igual), y las órdenes sin código, una cada una,
 * a la vez; si una falla, esa orden sale sin cifra en vez de tumbar la pantalla. Solo se llama con `costos.ver`; el
 * margen y el presupuesto, además, solo con el precio a la vista (`conMargen`).
 */
export async function costoDeOrdenes(
  ordenes: { id: string; codigo_interno?: string | null }[],
  opciones: { conMargen?: boolean } = {},
) {
  const supabase = await createClient()
  const codigoDe = new Map(ordenes.map((o) => [o.id, normalizarCodigo(o.codigo_interno ?? '') || null]))
  const codigos = [...new Set([...codigoDe.values()].filter((c): c is string => c !== null && c !== CODIGO_SIN_AVANCE))]

  // Un código, con su filtro; varios, en una sola llamada sin filtro.
  const deLosCodigos = async (): Promise<Map<string, CostoDeOrden | null>> => {
    if (codigos.length === 0) return new Map()
    const { data, error } = await supabase.rpc('codigos_internos_costo', codigos.length === 1 ? { p_codigo: codigos[0] } : {})
    if (error) {
      // La pantalla dice «No se pudo leer el costo»; el motivo queda en el registro del servidor.
      console.error('No se pudo leer el costo de los códigos internos:', error.message)
      return new Map(codigos.map((c) => [c, null]))
    }
    const filaDe = new Map((data ?? []).flatMap((f) => (f.codigo ? [[f.codigo, f] as const] : [])))
    return new Map(
      codigos.map((codigo) => {
        // Un código sin nada cargado no trae fila: todavía no cuesta nada.
        const f = filaDe.get(codigo)
        const total: CostoDeOrden = {
          pen: Number(f?.costo_pen ?? 0),
          sinPrecio: Number(f?.materiales_sin_precio ?? 0),
          sinCambio: Number(f?.lineas_sin_cambio ?? 0),
          sinCosto: Number(f?.horas_sin_costo ?? 0),
          margenPct: null,
          consumidoPct: null,
          semaforo: null,
          presupuestoFijado: f?.presupuesto_fijado === true,
          codigo,
          entregadaEl: f?.entregada_el ?? null,
          cierre:
            f?.cierre_id && f.cerrado_en
              ? { costo: Number(f.costo_cerrado_pen ?? 0), en: f.cerrado_en, por: f.cerrado_por ?? null }
              : null,
        }
        // Sin costo cargado la base no da margen (saldría 100 %).
        if (opciones.conMargen && f && total.pen > 0) {
          total.margenPct = f.margen_pct === null ? null : Number(f.margen_pct)
          total.consumidoPct = f.consumido_pct === null ? null : Number(f.consumido_pct)
          total.semaforo = f.semaforo === 'EN_RANGO' || f.semaforo === 'AJUSTADO' || f.semaforo === 'EXCEDIDO' ? f.semaforo : null
        }
        return [codigo, total] as const
      }),
    )
  }

  const [porCodigo, sueltas] = await Promise.all([
    deLosCodigos(),
    Promise.all(
      ordenes
        .filter(({ id }) => {
          const codigo = codigoDe.get(id) ?? null
          return !codigo || codigo === CODIGO_SIN_AVANCE
        })
        .map(async ({ id }) => {
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
            presupuestoFijado: false,
            codigo: null,
            cierre: null,
            entregadaEl: null,
          }
          for (const l of costo.data) {
            if (l.fuente === 'MATERIALES_SIN_PRECIO') total.sinPrecio += 1
            else if (l.monto_pen === null && l.moneda === 'USD') total.sinCambio += 1
            else total.pen += Number(l.monto_pen ?? 0)
          }
          // Sin costo cargado el margen saldría 100 %: no se muestra hasta que haya costo.
          const p = presupuesto.data as { margen_pct: number | null; consumido_pct: number | null; semaforo: string | null; origen: string | null } | null
          if (p && total.pen > 0) {
            total.margenPct = p.margen_pct === null ? null : Number(p.margen_pct)
            total.consumidoPct = p.consumido_pct === null ? null : Number(p.consumido_pct)
            total.semaforo = (p.semaforo as typeof total.semaforo) ?? null
            total.presupuestoFijado = p.origen === 'MANUAL'
          }
          return [id, total] as const
        }),
    ),
  ])
  const deSuOt = new Map(sueltas)
  return new Map(
    ordenes.map(({ id }) => {
      const codigo = codigoDe.get(id) ?? null
      return [id, codigo && codigo !== CODIGO_SIN_AVANCE ? (porCodigo.get(codigo) ?? null) : (deSuOt.get(id) ?? null)] as const
    }),
  )
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
