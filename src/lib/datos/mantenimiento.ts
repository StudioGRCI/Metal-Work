import 'server-only'

import { createClient } from '@/lib/supabase/server'

/*
 * Las OT de mantenimiento de las unidades de los clientes (plan «Las demás
 * áreas», A.3, migración 20261126996000). Todo sale de `mantenimiento_ots`,
 * que exige `mantenimiento.ots` y no trae montos: el puesto de Mantenimiento no
 * lee la tabla de órdenes. El mantenimiento se sigue por el N.º de su OT
 * («OT 2921-2026»), que hace de código en el RQ y en el reporte diario.
 */

export type OtDeMantenimiento = {
  orden: string
  numero: string
  /** El código con que se piden sus materiales y se sube su reporte: «OT 2921-2026». */
  codigo: string
  estado: string
  prioridad: string
  cliente: string
  placa: string | null
  vehiculo: string | null
  descripcion: string
  entrega: string | null
  motivo_pausa: string | null
  /** El vehículo entró por esta OT y todavía no sale. */
  en_planta: boolean
  ingreso_en: string | null
  salida_en: string | null
  /** El trabajo todavía no se dio por terminado. */
  abierta: boolean
  /** Cuándo lo dio por terminado Administración; `null` si la OT se cerró por su estado. */
  terminada_en: string | null
  /** El último reporte diario de su código que subió el área de quien mira (todas, para el administrador). */
  ultimo_reporte: string | null
  reportes: number
}

/** Las OT de mantenimiento ya aprobadas: las abiertas y las 30 últimas terminadas. */
export async function otsDeMantenimiento(): Promise<OtDeMantenimiento[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('mantenimiento_ots')
  if (error) throw new Error(`No se pudieron leer las OT de mantenimiento: ${error.message}`)
  return (data ?? []).flatMap((o) =>
    o.orden && o.numero && o.codigo
      ? [
          {
            orden: o.orden,
            numero: o.numero,
            codigo: o.codigo,
            estado: o.estado ?? '',
            prioridad: o.prioridad ?? '',
            cliente: o.cliente ?? '',
            placa: o.placa,
            vehiculo: o.vehiculo,
            descripcion: o.descripcion ?? '',
            entrega: o.entrega,
            motivo_pausa: o.motivo_pausa,
            en_planta: o.en_planta === true,
            ingreso_en: o.ingreso_en,
            salida_en: o.salida_en,
            abierta: o.abierta === true,
            terminada_en: o.terminada_en,
            ultimo_reporte: o.ultimo_reporte,
            reportes: o.reportes ?? 0,
          },
        ]
      : [],
  )
}
