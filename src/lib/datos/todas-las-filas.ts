import 'server-only'

/** Lo que el servicio entrega como mucho por consulta (`max_rows`), aunque se pida más. */
export const FILAS_POR_CONSULTA = 1000

type Respuesta<T> = { data: T[] | null; error: { message: string } | null }

type Lectura<T> = {
  order(columna: string, opciones?: { ascending?: boolean; nullsFirst?: boolean }): Lectura<T>
  range(desde: number, hasta: number): PromiseLike<Respuesta<T>>
}

/**
 * Todas las filas de una lectura —tabla, vista o función—, de mil en mil.
 *
 * Supabase corta cada respuesta en mil filas sin ningún error: una lista de todos
 * los códigos, el tareo de un mes o el costeo de una unidad grande salían cortos
 * y sumaban de menos sin que nadie lo notara.
 *
 * `orden` es la lista de columnas (`'fecha.desc'` para descendente, y
 * `'fecha.desc.nullslast'` o `'.nullsfirst'` para decir dónde van los vacíos) y tiene que
 * dejar un orden total: entre dos tandas la base puede devolver en otro orden
 * las filas empatadas, y una saldría dos veces y otra ninguna. Con una columna
 * única al final basta; sin ella, todas las columnas que devuelve la lectura,
 * para que lo único empatado sean filas idénticas.
 *
 * `crear` arma la consulta de nuevo en cada tanda: el constructor de Supabase
 * es mutable y no se puede reusar.
 */
export async function todasLasFilas<T>(crear: () => Lectura<T>, orden: string[]): Promise<Respuesta<T> & { data: T[] }> {
  const filas: T[] = []
  for (let desde = 0; ; desde += FILAS_POR_CONSULTA) {
    let consulta = crear()
    for (const columna of orden) {
      const [nombre, sentido, vacios] = columna.split('.')
      consulta = consulta.order(nombre, {
        ascending: sentido !== 'desc',
        ...(vacios ? { nullsFirst: vacios === 'nullsfirst' } : {}),
      })
    }
    const { data, error } = await consulta.range(desde, desde + FILAS_POR_CONSULTA - 1)
    if (error) return { data: filas, error }
    filas.push(...(data ?? []))
    if ((data ?? []).length < FILAS_POR_CONSULTA) return { data: filas, error: null }
  }
}
