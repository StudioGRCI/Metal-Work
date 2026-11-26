import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * Lo que la oficina tiene por completar en las OT (plan 8, migración
 * 20261126300000): la cotización aprobada que se quedó sin OT, y la OT abierta
 * sin código interno o sin fecha de entrega comprometida. Lo más viejo primero,
 * con los días que lleva esperando contados por la base con la fecha de Lima.
 *
 * La función corre como quien llama: solo lista lo que su RLS ya le deja ver, y
 * la pide quien carga y corrige las OT (`ordenes.crear` u `ordenes.editar`). Sin
 * importes.
 */
export type PendienteDeOt = {
  clase: 'COTIZACION' | 'OT'
  documento: string
  numero: string
  cliente: string | null
  trabajo: string | null
  faltaOt: boolean
  faltaCodigo: boolean
  faltaFecha: boolean
  desde: string | null
  dias: number | null
}

export const pendientesDeLasOt = cache(async (): Promise<PendienteDeOt[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('pendientes_de_las_ot')
  if (error) throw new Error(`No se pudieron leer los pendientes de las OT: ${error.message}`)
  return (data ?? [])
    .filter((f) => f.documento && f.numero)
    .map((f) => ({
      clase: f.clase === 'COTIZACION' ? 'COTIZACION' : 'OT',
      documento: f.documento as string,
      numero: f.numero as string,
      cliente: f.cliente,
      trabajo: f.trabajo,
      faltaOt: Boolean(f.falta_ot),
      faltaCodigo: Boolean(f.falta_codigo),
      faltaFecha: Boolean(f.falta_fecha),
      desde: f.desde,
      dias: f.dias == null ? null : Number(f.dias),
    }))
})
