import 'server-only'

import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { createClient } from '@/lib/supabase/server'

export type LineaRequerimiento = {
  /** El insumo: la OC que junta varios RQ enlaza cada uno por aquí. */
  id: string
  item: number
  /** Lo que se pidió: el nombre del catálogo, o el que escribió el área si era un material nuevo. */
  descripcion: string
  cantidad: number
  unidad: string
  categoria: string
  /** El material del catálogo de Almacén; vacío en un material nuevo que Almacén todavía no revisó. */
  material_id: string | null
  /** El código y el nombre de ese material en el catálogo. */
  material_codigo: string | null
  material_nombre: string | null
  /** Se pidió como material nuevo, porque no estaba en el catálogo. */
  material_nuevo: boolean
  /** La unidad del material es provisional: Almacén la confirma con la de este insumo al revisarlo. */
  material_unidad_pendiente: boolean
  /** La OC que Logística generó para este insumo (OC-5583-MW); vacía mientras no se compra. */
  orden_compra: string | null
  /** Gerencia rechazó esa OC: el insumo vuelve a estar libre para otra. */
  compra_rechazada: boolean
  /** En qué etapa va el insumo (`ETAPA_AVANCE_RQ`); vacía si el RQ está anulado. */
  etapa: string | null
  /** Desde cuándo está en esa etapa, si es del recojo (pendiente, en recojo, recogido, dejado). */
  etapa_desde: string | null
  /** Cuánto tenía Almacén al revisarlo, de 0 a lo pedido; vacío mientras no lo revisa. */
  en_stock: number | null
  /** Lo que falta y se compra: lo pedido menos lo que tenía Almacén. Vacío mientras no lo revisa. */
  por_comprar: number | null
  /** Lo que ya salió del almacén para este insumo, menos lo devuelto (`entregado_de_requerimientos`). */
  entregado: number
}

/** En qué porcentaje va el RQ y la etapa de su insumo más atrasado. */
export type AvanceRequerimiento = { porcentaje: number; etapa: string }

/** Un requerimiento en el listado: número, quién lo necesita, para qué, qué se pide y por dónde va. */
export type RequerimientoListado = {
  id: string
  numero: string
  /** OPERACION o ADMINISTRACION (`TIPO_REQUERIMIENTO`). */
  tipo: string
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

type LineaDeAvance = {
  item: number
  orden_compra: string | null
  rechazada: boolean
  etapa: string
  desde: string | null
  en_stock: number | null
  por_comprar: number | null
}

export type OpcionCatalogo = { id: string; codigo: string; nombre: string }

/** Un área que puede pedir, con el requerimiento en que va (OPERACION o ADMINISTRACION). */
export type AreaParaRequerimiento = OpcionCatalogo & { requerimiento: string }

const SELECT_RQ =
  'id, numero, tipo, codigo_interno, justificacion, fecha_requerida, estado, motivo_anulacion, nota_almacen, nota_logistica, nota_entrega, revision_stock_en, en_atencion_en, listo_en_almacen_en, entregado_en, creado_en, area:areas(nombre), lineas:requerimiento_lineas(id, item, descripcion, cantidad, cantidad_en_stock, material_id, material_nuevo, material:materiales(codigo, descripcion, unidad_pendiente), unidad:unidades_medida(codigo), categoria:categorias_material(nombre), orden_compra:ordenes_compra_materiales(numero, referencia, aprobacion))'

/**
 * Los requerimientos, del más nuevo al más viejo. Con `soloAbiertos`, los que
 * todavía esperan a Almacén, a quien compra o a que el área los recoja: es lo
 * que la bandeja de atención muestra. Con `tipo`, solo los de operación o solo
 * los de Administración. Con `id`, solo ese: es el que abre Adquisiciones. Con
 * `area`, los que pidió esa área (el supervisor ve primero los de la suya); con
 * `codigo`, los de ese código interno.
 */
export async function cargarRequerimientos(
  opciones: { soloAbiertos?: boolean; tipo?: 'OPERACION' | 'ADMINISTRACION'; id?: string; area?: string; codigo?: string } = {},
): Promise<RequerimientoListado[]> {
  const supabase = await createClient()
  let consulta = supabase.from('requerimientos').select(SELECT_RQ)
  if (opciones.soloAbiertos) consulta = consulta.in('estado', ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN'])
  if (opciones.tipo) consulta = consulta.eq('tipo', opciones.tipo)
  if (opciones.id) consulta = consulta.eq('id', opciones.id)
  if (opciones.area) consulta = consulta.eq('area_id', opciones.area)
  if (opciones.codigo) consulta = consulta.eq('codigo_interno', opciones.codigo)
  const { data, error } = await consulta.order('creado_en', { ascending: false }).limit(300)
  if (error) throw new Error(`No se pudieron leer los requerimientos: ${error.message}`)
  // El avance lo calcula la base con la OC y el recojo de cada insumo. Trae
  // también el número de la OC, que Supervisión y Requerimientos no leen de la
  // tabla de compras.
  const avances = new Map<string, AvanceRequerimiento & { lineas: Map<number, LineaDeAvance> }>()
  // Lo que ya salió del almacén para cada insumo: Supervisión no lee el kardex,
  // así que también lo da la base (migración 20261020191000).
  const entregados = new Map<string, number>()
  if (data && data.length > 0) {
    const ids = data.map((r) => r.id)
    const [avance, entregado] = await Promise.all([
      supabase.rpc('avance_de_requerimientos', { p_ids: ids }),
      supabase.rpc('entregado_de_requerimientos', { p_ids: ids }),
    ])
    if (avance.error) throw new Error(`No se pudo calcular el avance de los requerimientos: ${avance.error.message}`)
    if (entregado.error) throw new Error(`No se pudo leer lo entregado de los requerimientos: ${entregado.error.message}`)
    for (const a of avance.data ?? []) {
      if (!a.requerimiento_id || a.porcentaje == null || !a.etapa) continue
      const lineas = (a.lineas as LineaDeAvance[] | null) ?? []
      avances.set(a.requerimiento_id, { porcentaje: a.porcentaje, etapa: a.etapa, lineas: new Map(lineas.map((l) => [l.item, l])) })
    }
    for (const e of entregado.data ?? []) {
      if (e.requerimiento_id && e.item != null) entregados.set(`${e.requerimiento_id}:${e.item}`, Number(e.entregado ?? 0))
    }
  }
  return (data ?? []).map((r) => {
    const avance = avances.get(r.id)
    return {
      id: r.id,
      numero: r.numero,
      tipo: r.tipo,
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
            id: l.id,
            item: l.item,
            descripcion: l.descripcion,
            cantidad: Number(l.cantidad),
            unidad: l.unidad?.codigo ?? '',
            categoria: l.categoria?.nombre ?? '',
            material_id: l.material_id,
            material_codigo: l.material?.codigo ?? null,
            material_nombre: l.material?.descripcion ?? null,
            material_nuevo: l.material_nuevo,
            material_unidad_pendiente: l.material?.unidad_pendiente ?? false,
            orden_compra: deLinea?.orden_compra ?? (l.orden_compra ? (l.orden_compra.numero ?? l.orden_compra.referencia ?? null) : null),
            compra_rechazada: deLinea ? deLinea.rechazada : l.orden_compra?.aprobacion === 'RECHAZADA',
            etapa: deLinea?.etapa ?? null,
            etapa_desde: deLinea?.desde ?? null,
            en_stock: l.cantidad_en_stock == null ? null : Number(l.cantidad_en_stock),
            por_comprar: l.cantidad_en_stock == null ? null : Math.max(Number(l.cantidad) - Number(l.cantidad_en_stock), 0),
            entregado: entregados.get(`${r.id}:${l.item}`) ?? 0,
          }
        })
        .sort((a, b) => a.item - b.item),
      avance: avance ? { porcentaje: avance.porcentaje, etapa: avance.etapa } : null,
    }
  })
}

/** Un material del catálogo de Almacén, como lo ofrece el formulario del requerimiento. */
export type MaterialParaRequerimiento = {
  id: string
  codigo: string
  descripcion: string
  categoria: string
  unidad_id: string
  unidad: string
  /** La unidad todavía es provisional: quien pide dice en cuál lo necesita y Almacén la confirma. */
  unidad_pendiente: boolean
}

/**
 * Todo el catálogo activo de Almacén, por nombre. Se lee por tramos de mil: el
 * catálogo importado ya pasa de quinientos materiales.
 */
async function materialesParaRequerimiento(db: Awaited<ReturnType<typeof createClient>>): Promise<MaterialParaRequerimiento[]> {
  const materiales: MaterialParaRequerimiento[] = []
  let ultimo: string | undefined
  for (;;) {
    let consulta = db
      .from('materiales')
      .select('id, codigo, descripcion, unidad_pendiente, unidad_medida_id, unidad:unidades_medida(codigo), categoria:categorias_material(nombre)')
      .eq('activo', true)
      .order('id')
      .limit(1000)
    if (ultimo) consulta = consulta.gt('id', ultimo)
    const { data, error } = await consulta
    if (error) throw new Error(`No se pudo leer el catálogo de Almacén: ${error.message}`)
    materiales.push(
      ...(data ?? []).map((m) => ({
        id: m.id,
        codigo: m.codigo,
        descripcion: m.descripcion,
        categoria: m.categoria?.nombre ?? '',
        unidad_id: m.unidad_medida_id,
        unidad: m.unidad?.codigo ?? '',
        unidad_pendiente: m.unidad_pendiente,
      })),
    )
    if (!data?.length || data.length < 1000) break
    ultimo = data[data.length - 1].id
  }
  return materiales.sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es'))
}

/** El catálogo de Almacén para que Almacén asocie el material nuevo de un requerimiento al revisarlo. */
export async function catalogoParaRequerimiento(): Promise<MaterialParaRequerimiento[]> {
  return materialesParaRequerimiento(await createClient())
}

/**
 * Lo que el formulario del requerimiento ofrece para elegir: las áreas que
 * pueden pedir (cada una con el requerimiento en que va), el catálogo de
 * Almacén, y las unidades y categorías para un material nuevo.
 */
export async function catalogosDelRequerimiento() {
  const supabase = await createClient()
  const [areas, unidades, categorias, materiales, codigos] = await Promise.all([
    supabase.from('areas').select('id, codigo, nombre, requerimiento').eq('activo', true).not('requerimiento', 'is', null).order('nombre'),
    supabase.from('unidades_medida').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    supabase
      .from('categorias_material')
      .select('id, codigo, nombre')
      .eq('activo', true)
      .is('categoria_padre_id', null)
      .neq('codigo', 'ALM_POR_CLASIFICAR')
      .order('nombre'),
    materialesParaRequerimiento(supabase),
    codigosParaElegir(supabase),
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
    areas: (areas.data ?? []).flatMap((a) => (a.requerimiento ? [{ id: a.id, codigo: a.codigo, nombre: a.nombre, requerimiento: a.requerimiento }] : [])),
    unidades: unidades.data ?? [],
    categorias: deAlmacen.length > 0 ? deAlmacen : todas,
    materiales,
    codigos,
  }
}
