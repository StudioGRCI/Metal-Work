import 'server-only'

import { ORDEN_DE_LAS_LINEAS, type LineaCosteo } from '@/lib/datos/codigos-internos'
import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/**
 * El gasto de cada código interno para Requerimientos: sale de las funciones de
 * la migración 20261015160000, que exigen `codigos_internos.gasto` y arman las
 * mismas líneas que el costeo de Gerencia, sin la mano de obra. Las compras se
 * leen con `comprasDelCodigo`, la misma función para las dos pantallas.
 */

/** Un código en la lista: lo que salió del almacén para él y lo que se compró, aparte. */
export type GastoDeCodigo = {
  codigo: string
  requerimientos: number
  compras: number
  salidas: number
  ultima_actividad: string | null
  materiales_pen: number
  materiales_usd: number
  materiales_sin_precio: number
  compras_pen: number
  compras_usd: number
  compras_sin_precio: number
}

const n = (v: number | null | undefined) => Number(v ?? 0)

/** Todos los códigos con gasto o con un requerimiento, del más reciente al más viejo. */
export async function listarGastoPorCodigo(): Promise<GastoDeCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('codigos_internos_gasto'), ['ultima_actividad.desc.nullslast', 'codigo'])
  if (error) throw new Error(`No se pudo leer el gasto por código interno: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.codigo
      ? [
          {
            codigo: f.codigo,
            requerimientos: n(f.requerimientos),
            compras: n(f.compras),
            salidas: n(f.salidas),
            ultima_actividad: f.ultima_actividad,
            materiales_pen: n(f.materiales_pen),
            materiales_usd: n(f.materiales_usd),
            materiales_sin_precio: n(f.materiales_sin_precio),
            compras_pen: n(f.compras_pen),
            compras_usd: n(f.compras_usd),
            compras_sin_precio: n(f.compras_sin_precio),
          },
        ]
      : [],
  )
}

/** Las salidas del almacén de un código, cada una con su precio o «sin precio». */
export async function materialesDelCodigo(codigo: string): Promise<LineaCosteo[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('codigo_interno_gasto', { p_codigo: codigo }), ORDEN_DE_LAS_LINEAS)
  if (error) throw new Error(`No se pudo leer el gasto del código: ${error.message}`)
  return (data ?? [])
    .filter((f) => f.fuente === 'MATERIALES' || f.fuente === 'MATERIALES_SIN_PRECIO')
    .map((f) => ({
      fuente: f.fuente as LineaCosteo['fuente'],
      fecha: f.fecha ?? '',
      concepto: f.concepto ?? '',
      detalle: f.detalle,
      cantidad: n(f.cantidad),
      unidad: f.unidad,
      horas: null,
      precio_unitario: f.precio_unitario === null ? null : Number(f.precio_unitario),
      moneda: f.moneda === 'USD' ? 'USD' : f.moneda === 'PEN' ? 'PEN' : null,
      monto: f.monto === null ? null : Number(f.monto),
      sin_precio: n(f.sin_precio),
      documento: f.documento,
      referencia_id: f.referencia_id,
    }))
}
