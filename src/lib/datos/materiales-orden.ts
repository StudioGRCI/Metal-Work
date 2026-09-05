import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type MaterialDeOrden = {
  id: string
  orden_id: string
  plano_id: string | null
  numero_plano: string | null
  plano_nombre: string | null
  etapa_id: string | null
  etapa: string | null
  area: string | null
  material_id: string
  material_codigo: string
  material: string
  especificacion_tecnica: string | null
  unidad: string | null
  cantidad: number
  cantidad_pedida: number
  cantidad_pendiente: number
  completo: boolean
  observacion: string | null
}

/**
 * La lista de materiales que Diseño escribió para la orden, con lo que ya se
 * mandó al almacén y lo que queda. El saldo lo calcula la vista sumando los
 * requerimientos vivos: guardarlo en la fila se desincroniza en cuanto alguien
 * anula un pedido.
 */
export async function listaDeMateriales(ordenId: string): Promise<MaterialDeOrden[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_materiales')
    .select(
      'id, orden_id, plano_id, numero_plano, plano_nombre, etapa_id, etapa, area, material_id, material_codigo, material, especificacion_tecnica, unidad, cantidad, cantidad_pedida, cantidad_pendiente, completo, observacion',
    )
    .eq('orden_id', ordenId)
    .order('numero_plano', { nullsFirst: false })
    .order('material_codigo')
    .limit(500)

  if (error) throw new Error(`No se pudo leer la lista de materiales: ${error.message}`)
  return (data ?? []) as unknown as MaterialDeOrden[]
}

/**
 * Lo que la pestaña carga de una vez. Son dos consultas encadenadas —el stock
 * se pide solo para lo que está en la lista— y por eso viven juntas acá y no en
 * el `Promise.all` de la pantalla.
 */
export async function materialesParaPantalla(ordenId: string) {
  const materiales = await listaDeMateriales(ordenId)
  const catalogo = await catalogoDeMateriales(
    ordenId,
    materiales.map((m) => m.material_id),
  )
  return { materiales, catalogo }
}

export type OpcionMaterial = {
  id: string
  codigo: string
  descripcion: string
  unidad: string | null
  especificacion: string | null
}

export type CatalogoMateriales = {
  materiales: OpcionMaterial[]
  planos: { id: string; numero_plano: string; nombre: string }[]
  etapas: { id: string; nombre: string; area: string | null }[]
  almacenes: { id: string; nombre: string }[]
  /** Existencia disponible de cada material de la lista, sumando almacenes. */
  disponible: Record<string, number>
}

/**
 * Lo que la pestaña necesita para armar la lista: el catálogo de materiales,
 * los planos y las etapas de esta orden, y el stock que hay.
 *
 * El stock se pide solo para los materiales que ya están en la lista: es lo
 * único que se muestra, y traer el almacén entero para pintar una columna sería
 * caro el día que la empresa tenga tres años de existencias.
 */
export async function catalogoDeMateriales(
  ordenId: string,
  materialesEnLista: string[] = [],
): Promise<CatalogoMateriales> {
  const supabase = await createClient()

  const [materiales, planos, etapas, almacenes, stock] = await Promise.all([
    supabase
      .from('materiales')
      .select('id, codigo, descripcion, especificacion_tecnica, unidad:unidades_medida(codigo)')
      .eq('activo', true)
      .order('codigo')
      .limit(1000),
    supabase
      .from('ot_planos')
      .select('id, numero_plano, nombre')
      .eq('orden_id', ordenId)
      .order('orden_secuencia'),
    supabase
      .from('ot_etapas')
      .select('id, orden_secuencia, etapa:etapas_catalogo(nombre, area:areas(nombre))')
      .eq('orden_id', ordenId)
      .order('orden_secuencia'),
    supabase.from('almacenes').select('id, nombre').eq('activo', true).order('nombre'),
    materialesEnLista.length > 0
      ? supabase
          .from('v_stock_actual')
          .select('material_id, cantidad_disponible')
          .in('material_id', materialesEnLista)
      : Promise.resolve({ data: [], error: null }),
  ])

  const disponible: Record<string, number> = {}
  for (const fila of (stock.data ?? []) as { material_id: string; cantidad_disponible: number }[]) {
    disponible[fila.material_id] = (disponible[fila.material_id] ?? 0) + Number(fila.cantidad_disponible ?? 0)
  }

  return {
    materiales: (materiales.data ?? []).map((m) => {
      const unidad = m.unidad as { codigo: string } | null
      return {
        id: m.id,
        codigo: m.codigo,
        descripcion: m.descripcion,
        especificacion: m.especificacion_tecnica,
        unidad: unidad?.codigo ?? null,
      }
    }),
    planos: planos.data ?? [],
    etapas: (etapas.data ?? []).map((e) => {
      const etapa = e.etapa as { nombre: string; area: { nombre: string } | null } | null
      return {
        id: e.id,
        nombre: etapa?.nombre ?? 'Etapa',
        area: etapa?.area?.nombre ?? null,
      }
    }),
    almacenes: almacenes.data ?? [],
    disponible,
  }
}
