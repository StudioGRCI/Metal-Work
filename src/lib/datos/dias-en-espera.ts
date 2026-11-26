import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Los días que lleva esperando cada fila de una bandeja, contados por la base
 * con la fecha de Lima (migración 20261125140000): 0 es hoy. Recibe desde cuándo
 * espera cada fila —la pantalla lo sabe: la OC desde que se pidió su aprobación—
 * y devuelve los días en el mismo orden; `null` donde no hay hora.
 *
 * Si la base no contesta, lanza: la pantalla decide si sigue sin los días.
 */
export async function diasEnEspera(desdes: readonly (string | null)[]): Promise<(number | null)[]> {
  if (desdes.length === 0) return []
  const supabase = await createClient()
  const dias: (number | null)[] = new Array(desdes.length).fill(null)
  // De a mil, el tope de la función y de cada respuesta.
  for (let inicio = 0; inicio < desdes.length; inicio += 1000) {
    const tanda = desdes.slice(inicio, inicio + 1000)
    const { data, error } = await supabase.rpc('dias_en_espera_de', { p_desde: tanda as string[] })
    if (error) throw new Error(`No se pudieron contar los días en espera: ${error.message}`)
    for (const f of data ?? []) {
      if (f.posicion == null || f.dias == null) continue
      dias[inicio + f.posicion - 1] = Number(f.dias)
    }
  }
  return dias
}
