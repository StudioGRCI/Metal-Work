import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type Notificacion = {
  id: string
  titulo: string
  cuerpo: string | null
  ruta: string | null
  leida_en: string | null
  creado_en: string
}

/**
 * Lo que a esta persona le toca saber.
 *
 * No hace falta filtrar por usuario: la política de la tabla solo deja ver las
 * propias. Filtrar acá además sería repetir la regla en dos sitios y arriesgarse
 * a que un día digan cosas distintas.
 *
 * Se traen las últimas veinte y no todas: la campana es para enterarse de lo que
 * pasó, no un archivo histórico. Lo viejo ya se leyó o ya no importa.
 */
export async function misNotificaciones(limite = 20): Promise<Notificacion[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('notificaciones')
    .select('id, titulo, cuerpo, ruta, leida_en, creado_en')
    .order('creado_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudieron leer los avisos: ${error.message}`)
  return (data ?? []) as Notificacion[]
}

/** Cuántas sin leer, para el número de la campana. */
export async function avisosSinLeer(): Promise<number> {
  const supabase = await createClient()

  const { count, error } = await supabase
    .from('notificaciones')
    .select('id', { count: 'exact', head: true })
    .is('leida_en', null)

  if (error) throw new Error(`No se pudieron contar los avisos: ${error.message}`)
  return count ?? 0
}
