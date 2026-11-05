'use client'

import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { useSinLeer } from '@/components/estructura/use-avisos'

/**
 * «Todos» y «Sin leer (N)», con N como lo cuenta la lista: en una pantalla de
 * otro despliegue lo leído lo pinta la pestaña (`useAvisos`), y la pastilla
 * pintada por el servidor seguía en el número de antes (trigesimosegunda pasada).
 */
export function FiltroAvisos({ sinLeer, params, activo }: { sinLeer: number; params: Record<string, string | string[] | undefined>; activo: string | null }) {
  const quedan = useSinLeer(sinLeer)
  return (
    <PastillaFiltro
      ruta="/avisos"
      clave="ver"
      opciones={[
        { valor: null, etiqueta: 'Todos' },
        { valor: 'sin-leer', etiqueta: `Sin leer (${quedan})` },
      ]}
      params={params}
      activo={activo}
      etiqueta="Filtrar avisos"
      className="mb-4"
    />
  )
}
