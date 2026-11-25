import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * El último día que todavía es «por vencer»: hoy más tres días hábiles, con el
 * calendario laboral de la base (migración 20261125100000). Una vez por
 * petición. Si la base no lo da, vacío: `plazoEtapa` cae a tres días corridos,
 * y la pantalla sale igual.
 */
export const limitePorVencer = cache(async (): Promise<string | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('limite_por_vencer')
  if (error || typeof data !== 'string') return null
  return data
})
