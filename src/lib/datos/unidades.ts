import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * La ficha de una unidad y su historia en el taller.
 *
 * El cliente va sin `!inner`: una unidad que registró el taller no tiene
 * cliente, y para quien no ve clientes (Supervisión entra con `produccion.ver`)
 * el RLS lo esconde. Con `!inner` cualquiera de los dos casos borraba la unidad
 * entera de la respuesta, igual que en el listado (ver `ordenes.ts`).
 */
const CAMPOS_UNIDAD =
  'id, cliente_id, placa, codigo_interno, numero_fmi, tipo_vehiculo, marca, modelo, anio, numero_chasis, numero_motor, color, capacidad_m3, capacidad_toneladas, observaciones, activo, creado_en, cliente:clientes(id, razon_social), tipo_carroceria:tipos_carroceria(nombre)'

export async function obtenerUnidad(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.from('unidades').select(CAMPOS_UNIDAD).eq('id', id).maybeSingle()
  if (error) throw new Error(`No se pudo cargar la unidad: ${error.message}`)
  return data
}

export type Unidad = NonNullable<Awaited<ReturnType<typeof obtenerUnidad>>>

/** Un valor que viaja dentro de un filtro `or()` de PostgREST: sin comas ni paréntesis que lo partan. */
function paraFiltro(valor: string | null | undefined) {
  const t = valor?.trim().replace(/[,()*%]/g, '')
  return t ? t : null
}

/**
 * Lo que pasó con la unidad en el taller: sus órdenes —fabricación, garantías,
 * reparaciones—, el acta de cada una con su garantía, y las otras fichas del
 * mismo vehículo. Una unidad es una ficha por dueño: si el camión cambia de
 * manos, o el taller la registró por su placa antes de que la oficina la
 * cargara por su código, el mismo vehículo queda en dos filas. Se reconocen por
 * el chasis, la placa, el código interno o el FMI.
 *
 * Las órdenes salen de `ot_resumen` y las actas de `ot_entregas`, con el RLS de
 * quien mira (`ordenes.ver`): sin ese permiso la historia sale vacía.
 */
export async function historiaDeUnidad(unidad: Pick<Unidad, 'id' | 'placa' | 'codigo_interno' | 'numero_chasis' | 'numero_fmi'>) {
  const supabase = await createClient()

  const claves = [
    paraFiltro(unidad.numero_chasis) && `numero_chasis.ilike.${paraFiltro(unidad.numero_chasis)}`,
    paraFiltro(unidad.placa) && `placa.ilike.${paraFiltro(unidad.placa)}`,
    paraFiltro(unidad.codigo_interno) && `codigo_interno.ilike.${paraFiltro(unidad.codigo_interno)}`,
    paraFiltro(unidad.numero_fmi) && `numero_fmi.ilike.${paraFiltro(unidad.numero_fmi)}`,
  ].filter((c): c is string => Boolean(c))

  const [ordenes, gemelas] = await Promise.all([
    supabase
      .from('ot_resumen')
      .select('id, numero, estado, abierta_en_taller, tipo_trabajo, descripcion, avance_porcentaje, fecha_registro, fecha_entrega_comprometida')
      .eq('unidad_id', unidad.id)
      .order('fecha_registro', { ascending: false })
      .limit(100),
    claves.length
      ? supabase
          .from('unidades')
          .select('id, placa, codigo_interno, numero_fmi, numero_chasis, marca, modelo, activo, cliente_id, cliente:clientes(razon_social)')
          .neq('id', unidad.id)
          .or(claves.join(','))
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (ordenes.error) throw new Error(`No se pudieron leer las órdenes de la unidad: ${ordenes.error.message}`)
  if (gemelas.error) throw new Error(`No se pudieron buscar otras fichas del vehículo: ${gemelas.error.message}`)

  const filas = (ordenes.data ?? []).filter((o): o is typeof o & { id: string; numero: string } => Boolean(o.id && o.numero))
  const ids = filas.map((o) => o.id)
  const actas = ids.length
    ? await supabase
        .from('ot_entregas')
        .select('orden_id, numero, fecha_entrega, garantia_meses, garantia_vence')
        .in('orden_id', ids)
    : { data: [], error: null }
  if (actas.error) throw new Error(`No se pudieron leer las actas de entrega: ${actas.error.message}`)

  const actaDe = new Map((actas.data ?? []).map((a) => [a.orden_id, a]))
  return {
    ordenes: filas.map((o) => ({ ...o, acta: actaDe.get(o.id) ?? null })),
    gemelas: gemelas.data ?? [],
  }
}

export type HistoriaDeUnidad = Awaited<ReturnType<typeof historiaDeUnidad>>
