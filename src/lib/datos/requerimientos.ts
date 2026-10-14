import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type LineaRequerimiento = {
  item: number
  descripcion: string
  cantidad: number
  unidad: string
  categoria: string
  /** La OC que Logística generó para este insumo (OC-5583-MW); vacía mientras no se compra. */
  orden_compra: string | null
  /** Gerencia rechazó esa OC: el insumo vuelve a estar libre para otra. */
  compra_rechazada: boolean
  /** En qué etapa va el insumo (`ETAPA_AVANCE_RQ`); vacía si el RQ está anulado. */
  etapa: string | null
  /** Desde cuándo está en esa etapa, si es del recojo (pendiente, en recojo, recogido, dejado). */
  etapa_desde: string | null
}

/** En qué porcentaje va el RQ y la etapa de su insumo más atrasado. */
export type AvanceRequerimiento = { porcentaje: number; etapa: string }

/** Un requerimiento en el listado: número, quién lo necesita, para qué, qué se pide y por dónde va. */
export type RequerimientoListado = {
  id: string
  numero: string
  area: string
  codigo_interno: string
  justificacion: string
  fecha_requerida: string | null
  estado: string
  motivo_anulacion: string | null
  nota_almacen: string | null
  nota_logistica: string | null
  nota_entrega: string | null
  revision_stock_en: string | null
  en_atencion_en: string | null
  listo_en_almacen_en: string | null
  entregado_en: string | null
  creado_en: string
  lineas: LineaRequerimiento[]
  /** Vacío si está anulado. */
  avance: AvanceRequerimiento | null
}

type LineaDeAvance = { item: number; orden_compra: string | null; rechazada: boolean; etapa: string; desde: string | null }

export type OpcionCatalogo = { id: string; codigo: string; nombre: string }

const SELECT_RQ =
  'id, numero, codigo_interno, justificacion, fecha_requerida, estado, motivo_anulacion, nota_almacen, nota_logistica, nota_entrega, revision_stock_en, en_atencion_en, listo_en_almacen_en, entregado_en, creado_en, area:areas(nombre), lineas:requerimiento_lineas(item, descripcion, cantidad, unidad:unidades_medida(codigo), categoria:categorias_material(nombre), orden_compra:ordenes_compra_materiales(numero, referencia, aprobacion))'

/**
 * Los requerimientos, del más nuevo al más viejo. Con `soloAbiertos`, los que
 * todavía esperan a Almacén, a Logística o a que el área los recoja: es lo que
 * la bandeja de atención muestra.
 */
export async function cargarRequerimientos(opciones: { soloAbiertos?: boolean } = {}): Promise<RequerimientoListado[]> {
  const supabase = await createClient()
  let consulta = supabase.from('requerimientos').select(SELECT_RQ)
  if (opciones.soloAbiertos) consulta = consulta.in('estado', ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN'])
  const { data, error } = await consulta.order('creado_en', { ascending: false }).limit(300)
  if (error) throw new Error(`No se pudieron leer los requerimientos: ${error.message}`)
  // El avance lo calcula la base con la OC y el recojo de cada insumo. Trae
  // también el número de la OC, que Supervisión y Requerimientos no leen de la
  // tabla de compras.
  const avances = new Map<string, AvanceRequerimiento & { lineas: Map<number, LineaDeAvance> }>()
  if (data && data.length > 0) {
    const avance = await supabase.rpc('avance_de_requerimientos', { p_ids: data.map((r) => r.id) })
    if (avance.error) throw new Error(`No se pudo calcular el avance de los requerimientos: ${avance.error.message}`)
    for (const a of avance.data ?? []) {
      if (!a.requerimiento_id || a.porcentaje == null || !a.etapa) continue
      const lineas = (a.lineas as LineaDeAvance[] | null) ?? []
      avances.set(a.requerimiento_id, { porcentaje: a.porcentaje, etapa: a.etapa, lineas: new Map(lineas.map((l) => [l.item, l])) })
    }
  }
  return (data ?? []).map((r) => {
    const avance = avances.get(r.id)
    return {
      id: r.id,
      numero: r.numero,
      area: r.area?.nombre ?? '—',
      codigo_interno: r.codigo_interno,
      justificacion: r.justificacion,
      fecha_requerida: r.fecha_requerida,
      estado: r.estado,
      motivo_anulacion: r.motivo_anulacion,
      nota_almacen: r.nota_almacen,
      nota_logistica: r.nota_logistica,
      nota_entrega: r.nota_entrega,
      revision_stock_en: r.revision_stock_en,
      en_atencion_en: r.en_atencion_en,
      listo_en_almacen_en: r.listo_en_almacen_en,
      entregado_en: r.entregado_en,
      creado_en: r.creado_en,
      lineas: (r.lineas ?? [])
        .map((l) => {
          const deLinea = avance?.lineas.get(l.item)
          return {
            item: l.item,
            descripcion: l.descripcion,
            cantidad: Number(l.cantidad),
            unidad: l.unidad?.codigo ?? '',
            categoria: l.categoria?.nombre ?? '',
            orden_compra: deLinea?.orden_compra ?? (l.orden_compra ? (l.orden_compra.numero ?? l.orden_compra.referencia ?? null) : null),
            compra_rechazada: deLinea ? deLinea.rechazada : l.orden_compra?.aprobacion === 'RECHAZADA',
            etapa: deLinea?.etapa ?? null,
            etapa_desde: deLinea?.desde ?? null,
          }
        })
        .sort((a, b) => a.item - b.item),
      avance: avance ? { porcentaje: avance.porcentaje, etapa: avance.etapa } : null,
    }
  })
}

/** Lo que el formulario del requerimiento ofrece para elegir: áreas, unidades y categorías. */
export async function catalogosDelRequerimiento() {
  const supabase = await createClient()
  const [areas, unidades, categorias] = await Promise.all([
    supabase.from('areas').select('id, codigo, nombre').eq('activo', true).order('nombre'),
    supabase.from('unidades_medida').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase
      .from('categorias_material')
      .select('id, codigo, nombre')
      .eq('activo', true)
      .is('categoria_padre_id', null)
      .neq('codigo', 'ALM_POR_CLASIFICAR')
      .order('nombre'),
  ])
  if (areas.error || unidades.error || categorias.error) {
    throw new Error('No se pudieron leer las áreas, unidades o categorías para el requerimiento.')
  }
  // El catálogo de Almacén (ALM_…) es el que usa el kardex. Las categorías
  // sueltas de la semilla inicial repiten las mismas familias con otro nombre:
  // si las de Almacén existen, se ofrecen solo esas para no clasificar doble.
  const todas = categorias.data ?? []
  const deAlmacen = todas.filter((c) => c.codigo.startsWith('ALM_'))
  return {
    areas: areas.data ?? [],
    unidades: unidades.data ?? [],
    categorias: deAlmacen.length > 0 ? deAlmacen : todas,
  }
}
