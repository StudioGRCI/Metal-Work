import Link from 'next/link'

type Params = Record<string, string | string[] | undefined>

/**
 * Pasar de página conservando los filtros de la URL. Dice también cuántos
 * registros se están viendo de cuántos: sin ese número nadie sabe si la lista
 * se acabó o si la cortamos nosotros.
 */
export function Paginacion({
  ruta,
  pagina,
  paginas,
  total,
  porPagina,
  params,
}: {
  ruta: string
  pagina: number
  paginas: number
  total: number
  porPagina: number
  params: Params
}) {
  if (paginas <= 1) return null

  const enlace = (destino: number) => {
    const query = new URLSearchParams()
    for (const [clave, valor] of Object.entries(params)) {
      if (clave !== 'pagina' && typeof valor === 'string' && valor) query.set(clave, valor)
    }
    query.set('pagina', String(destino))
    return `${ruta}?${query}`
  }

  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(pagina * porPagina, total)

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-4" aria-label="Paginación">
      <p className="text-xs text-texto-suave">
        Mostrando {desde}–{hasta} de {total.toLocaleString('es-PE')}
        <span className="text-texto-tenue"> · página {pagina} de {paginas}</span>
      </p>
      <div className="flex gap-2">
        {pagina > 1 && (
          <Link
            href={enlace(pagina - 1)}
            rel="prev"
            className="rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs hover:bg-superficie-2"
          >
            Anterior
          </Link>
        )}
        {pagina < paginas && (
          <Link
            href={enlace(pagina + 1)}
            rel="next"
            className="rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs hover:bg-superficie-2"
          >
            Siguiente
          </Link>
        )}
      </div>
    </nav>
  )
}

/**
 * Aviso para las listas que traen un tope fijo de filas: si llegó justo al
 * tope, es casi seguro que hay más detrás y hay que decirlo.
 */
export function AvisoTope({ mostradas, tope }: { mostradas: number; tope: number }) {
  if (mostradas < tope) return null

  return (
    <p className="mt-3 text-xs text-texto-suave">
      Se muestran los primeros {tope.toLocaleString('es-PE')} registros. Usa los filtros o la
      búsqueda para acotar la lista.
    </p>
  )
}
