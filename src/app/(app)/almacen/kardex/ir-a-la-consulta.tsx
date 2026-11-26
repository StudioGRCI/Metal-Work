'use client'

import { useEffect, useRef } from 'react'

/**
 * Lleva la vista a lo que se acaba de filtrar.
 *
 * El tablero de almacenes, los filtros y el historial van debajo de lo
 * pendiente. Cada filtro cambia la URL, y con cada cambio la página vuelve
 * arriba: en el teléfono, tocar «Accesorios» dejaba a la vista las mismas
 * bandejas de antes y el historial filtrado tres pantallas más abajo, como si
 * el toque no hubiera hecho nada (auditoría de diseño del 2026-11-25).
 *
 * Con un filtro puesto —o recién quitado— baja a `#consulta`, donde empiezan
 * el tablero y los filtros; al cambiar de página, a `#historial`. Al entrar
 * sin filtros no mueve nada. La pantalla le pasa los filtros ya leídos: no
 * lee la URL por su cuenta. No cuenta el material elegido, que esconde lo
 * pendiente y deja su ficha arriba, ni el `?rq=` que abre una salida.
 */
export function IrALaConsulta({ filtro, pagina }: { filtro: string; pagina: number }) {
  const anterior = useRef<{ filtro: string; pagina: number } | null>(null)

  useEffect(() => {
    const antes = anterior.current
    anterior.current = { filtro, pagina }
    // Al entrar: solo si ya viene filtrado o en otra página.
    if (!antes && !filtro && pagina <= 1) return
    if (antes && antes.filtro === filtro && antes.pagina === pagina) return
    const cambioElFiltro = antes ? antes.filtro !== filtro : Boolean(filtro)
    document.getElementById(cambioElFiltro ? 'consulta' : 'historial')?.scrollIntoView({ block: 'start' })
  }, [filtro, pagina])

  return null
}
