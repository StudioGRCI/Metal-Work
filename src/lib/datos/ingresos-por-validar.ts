import 'server-only'

import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import { fechasCorregidas } from '@/lib/datos/plazos-compras'
import { createClient } from '@/lib/supabase/server'

export type LineaPorValidar = {
  id: string
  materialId: string
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad: number
  ordenId: string | null
  ordenNumero: string | null
}

/** Una entrega del conductor: la OC que dejó en almacén y sus líneas por validar. */
export type EntregaPorValidar = {
  compraId: string
  /**
   * La OC nombrada por la base: su número, u «OC sin número (ref. del proveedor
   * …)» (migración 20261023130000). Es también el documento que queda en el
   * kardex si Almacén deja la guía en blanco.
   */
  referencia: string
  proveedor: string
  directa: boolean
  dejadoEn: string
  dejadoPor: string | null
  recogidoEn: string | null
  /**
   * Los días que lleva esperando la validación desde que el conductor la dejó,
   * por fecha de Lima (`dias_en_espera_de`, plan 2, entrega 2.3). `null` si no
   * se pudieron contar: la bandeja sigue sin la insignia.
   */
  dias: number | null
  /**
   * La fecha en que Logística esperaba la compra (la de su OC), sin precios
   * (decisión del plan 2): dice si llegó a tiempo. `null` si la OC no la tiene
   * o no se pudo leer.
   */
  fechaEsperada: string | null
  lineas: LineaPorValidar[]
}

/**
 * Lo que el conductor dejó en almacén y Almacén todavía no valida, agrupado
 * por compra y la más antigua primero. La base lo entrega por función: las
 * compras se leen por el área de su requerimiento y una OC directa no tiene.
 */
export async function ingresosPorValidar(): Promise<{
  entregas: EntregaPorValidar[]
  /** Qué no se pudo leer (los días, la fecha esperada): la bandeja sigue sin eso y lo dice. */
  sinLeer: string[]
}> {
  const db = await createClient()
  const { data, error } = await db.rpc('ingresos_por_validar')
  // Sin la función todavía en la base (la pantalla salió antes que la
  // migración del conductor) no hay nada que validar; cualquier otro error sí
  // se muestra.
  if (error?.code === 'PGRST202' || error?.code === '42883') return { entregas: [], sinLeer: [] }
  if (error) throw new Error(`No se pudieron cargar los ingresos por validar: ${error.message}`)

  const porCompra = new Map<string, EntregaPorValidar>()
  for (const f of data ?? []) {
    if (!f.id || !f.orden_compra_id || !f.material_id) continue
    const entrega = porCompra.get(f.orden_compra_id) ?? {
      compraId: f.orden_compra_id,
      referencia: f.referencia ?? 'OC',
      proveedor: f.proveedor ?? '',
      directa: Boolean(f.compra_directa),
      dejadoEn: f.dejado_en ?? '',
      dejadoPor: f.dejado_por_nombre,
      recogidoEn: f.recogido_en,
      dias: null,
      fechaEsperada: null,
      lineas: [],
    }
    porCompra.set(f.orden_compra_id, entrega)
    entrega.lineas.push({
      id: f.id,
      materialId: f.material_id,
      codigo: f.material_codigo ?? '',
      descripcion: f.material ?? 'Material',
      unidad: f.unidad_medida,
      cantidad: Number(f.cantidad),
      ordenId: f.orden_id,
      ordenNumero: f.orden_numero,
    })
  }
  // La que más espera, arriba: desde que el conductor la dejó (plan 2, entrega 2.3).
  const entregas = [...porCompra.values()].sort((a, b) => Date.parse(a.dejadoEn) - Date.parse(b.dejadoEn))
  const sinLeer: string[] = []
  // La fecha esperada de cada OC, sin precios (decisión del plan 2). La política
  // de las OC pide `compras.ver`, `almacen.recibir` o `tesoreria.ver_documentos`
  // y, si la OC viene de un RQ, que se vea su área; quien abre el kardex tiene
  // `almacen.ver`, que las ve todas. Si aun así vuelven menos, se dice.
  // Los días los cuenta la base con la fecha de Lima (`diasEnEspera`).
  // Y si Logística corrigió la fecha, la corregida: Almacén espera la compra el
  // mismo día que Logística.
  const [fechas, corregidas, dias] = await Promise.all([
    entregas.length > 0
      ? db.from('ordenes_compra_materiales').select('id, fecha_estimada').in('id', entregas.map((e) => e.compraId))
      : null,
    fechasCorregidas(db, { oc: entregas.map((e) => e.compraId) }).catch((e: unknown) => {
      console.error('Ingresos por validar: no se pudo leer la fecha corregida de las compras.', e instanceof Error ? e.message : e)
      return null
    }),
    diasEnEspera(entregas.map((e) => e.dejadoEn || null)).catch((e: unknown) => {
      console.error('Ingresos por validar: no se pudieron contar los días en espera.', e instanceof Error ? e.message : e)
      return null
    }),
  ])
  if (fechas?.error) {
    console.error('Ingresos por validar: no se pudo leer la fecha esperada de las compras.', fechas.error.message)
    sinLeer.push('No se pudo leer la fecha esperada de cada OC.')
  } else if (fechas && (fechas.data ?? []).length < entregas.length) {
    sinLeer.push('No se pudo leer la fecha esperada de algunas OC.')
  }
  if (corregidas === null && entregas.length > 0) sinLeer.push('No se pudo leer si Logística corrigió la fecha esperada de cada OC.')
  const porId = new Map((fechas?.data ?? []).map((f) => [f.id, corregidas?.get(f.id)?.fecha ?? f.fecha_estimada]))
  if (dias === null && entregas.length > 0) sinLeer.push('No se pudieron contar los días que espera cada compra.')
  entregas.forEach((e, i) => {
    e.fechaEsperada = porId.get(e.compraId) ?? null
    e.dias = dias?.[i] ?? null
  })
  return { entregas, sinLeer }
}
