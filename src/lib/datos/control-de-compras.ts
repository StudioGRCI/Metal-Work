import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/**
 * Cómo va el material de una OC, contado por línea: POR_APROBAR (Gerencia no la
 * aprueba: no salió al proveedor), EN_CAMINO, POR_VALIDAR, OBSERVADO, PARCIAL
 * (entró una parte) y LLEGO (todo, menos lo devuelto). La OS no trae material.
 */
export type MaterialDeLaCompra = 'POR_APROBAR' | 'EN_CAMINO' | 'POR_VALIDAR' | 'OBSERVADO' | 'PARCIAL' | 'LLEGO' | 'NO_APLICA'

/**
 * Una fila del CONTROL DE FACTURAS de Almacén (`control_de_compras_almacen`,
 * migración 20261126160000): una OC u OS del día en que se emitió, con lo que
 * Almacén recibió de ella y el comprobante que registró Contabilidad.
 */
export type FilaControlDeCompras = {
  tipo: 'OC' | 'OS'
  id: string
  /** El número de la casa; vacío en la OC de antes de la serie (se nombra con `nombreDeOc`). */
  numero: string | null
  referencia: string | null
  fecha: string
  descripcion: string | null
  proveedor: string | null
  /** El código interno, la OT, el área o «STOCK». */
  destino: string | null
  moneda: 'PEN' | 'USD'
  total: number | null
  peso_kg: number | null
  /** POR_APROBAR, APROBADA o NO_REQUERIDA (la rechazada y la anulada no salen). */
  aprobacion: string | null
  material: MaterialDeLaCompra
  material_en: string | null
  factura_numero: string | null
  factura_recibida_en: string | null
  guia_numero: string | null
  guia_recibida_en: string | null
  observacion: string | null
  /** Quién de Almacén la recibió, nombre y apellido. */
  recibio: string | null
  /**
   * Cuándo cambió por última vez lo que Almacén anotó, tal como lo da la base:
   * la pantalla lo devuelve al anotar para no pisar lo de otra pantalla.
   */
  recepcion_actualizada_en: string | null
  /** El comprobante de la OC que registró Contabilidad, o el que se adjuntó a la OS. */
  comprobante_registrado: string | null
}

const MATERIALES: MaterialDeLaCompra[] = ['POR_APROBAR', 'EN_CAMINO', 'POR_VALIDAR', 'OBSERVADO', 'PARCIAL', 'LLEGO', 'NO_APLICA']

/**
 * Lo que falta de una fila para cerrarla en el control: que llegue todo el
 * material (la OC; una parte, observado o por aprobar sigue pendiente) y que
 * Almacén reciba la factura.
 */
export function faltaAlgo(f: FilaControlDeCompras): boolean {
  return f.factura_numero === null || (f.material !== 'LLEGO' && f.material !== 'NO_APLICA')
}

/**
 * El control entre dos días (de Lima, ambos incluidos); sin días, todo. Si no
 * se pudo leer, lanza: una lista vacía diría «no hubo compras».
 */
export async function controlDeCompras(desde: string | null, hasta: string | null): Promise<FilaControlDeCompras[]> {
  const supabase = await createClient()
  // Diez compras al día pasan de mil en tres meses, y Supabase corta en mil sin avisar.
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('control_de_compras_almacen', { p_desde: desde, p_hasta: hasta }),
    ['fecha.desc', 'tipo', 'id'],
  )
  if (error) throw new Error(`No se pudo leer el control de compras: ${error.message}`)
  // Como en el Excel: el día, y en el día las OC y después las OS, por número.
  const porNumero = new Intl.Collator('es', { numeric: true })
  return data
    .toSorted((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '') || (a.tipo ?? '').localeCompare(b.tipo ?? '') || porNumero.compare(a.numero ?? '', b.numero ?? ''))
    .flatMap((f) =>
    f.id && (f.tipo === 'OC' || f.tipo === 'OS')
      ? [
          {
            tipo: f.tipo,
            id: f.id,
            numero: f.numero,
            referencia: f.referencia,
            fecha: f.fecha ?? '',
            descripcion: f.descripcion,
            proveedor: f.proveedor,
            destino: f.destino,
            moneda: f.moneda === 'USD' ? 'USD' : 'PEN',
            total: f.total == null ? null : Number(f.total),
            peso_kg: f.peso_kg == null ? null : Number(f.peso_kg),
            aprobacion: f.aprobacion,
            material: MATERIALES.includes(f.material as MaterialDeLaCompra) ? (f.material as MaterialDeLaCompra) : 'EN_CAMINO',
            material_en: f.material_en,
            factura_numero: f.factura_numero,
            factura_recibida_en: f.factura_recibida_en,
            guia_numero: f.guia_numero,
            guia_recibida_en: f.guia_recibida_en,
            observacion: f.observacion,
            recibio: f.recibio,
            recepcion_actualizada_en: f.recepcion_actualizada_en,
            comprobante_registrado: f.comprobante_registrado,
          },
        ]
      : [],
  )
}
