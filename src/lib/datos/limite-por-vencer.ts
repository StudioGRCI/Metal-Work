import 'server-only'

import { cache } from 'react'

import { createClient } from '@/lib/supabase/server'

/**
 * El último día que todavía es «por vencer»: hoy más tres días hábiles, con el
 * calendario laboral de la base (migración 20261125100000). Una vez por
 * petición. Solo mientras la función todavía no existe (el despliegue llega
 * antes que la migración) va vacío y `plazoEtapa` cae a tres días corridos;
 * cualquier otro error se lanza, para no pintar otro semáforo en silencio.
 */
export const limitePorVencer = cache(async (): Promise<string | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('limite_por_vencer')
  if (error) {
    if (error.code === 'PGRST202') return null
    throw new Error(`No se pudo leer el límite de «por vencer»: ${error.message}`)
  }
  return typeof data === 'string' ? data : null
})
