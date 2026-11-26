'use client'

import { useEffect } from 'react'

/** El id que nombra la dirección; un `#` mal escrito no tumba la pantalla. */
function idDeLaDireccion(): string {
  const crudo = window.location.hash.slice(1)
  try {
    return decodeURIComponent(crudo)
  } catch {
    return crudo
  }
}

/**
 * El aviso «Pide el reembolso» (20261126975000) llega con `#compra-<id>`, y la
 * OC con boleta ya pagada va dentro de «OC con boleta pagadas», que sale
 * cerrada: el navegador no baja a lo que está dentro de un `<details>` cerrado,
 * y Tesorería caía arriba sin ver la OC. Lo mismo con «una OC pagada de más».
 *
 * Al montarse la pantalla, y cada vez que cambia el `#` sin salir de ella, si lo
 * que nombra está dentro de una sección, la abre y, si no está a la vista, lo
 * trae. Chrome abre solo la sección al cargar con el `#`, pero la ida de Next
 * deja la página arriba.
 * `SeccionDesplegable` no vuelve a cerrarlas: su `abierta` vale solo al cargar.
 */
export function AbrirLoDelAncla() {
  useEffect(() => {
    let cuadro = 0
    function abrir() {
      const id = idDeLaDireccion()
      const destino = id ? document.getElementById(id) : null
      if (!destino) return
      const seccion = destino.parentElement?.closest('details')
      if (!seccion) return
      for (let s: HTMLDetailsElement | null | undefined = seccion; s; s = s.parentElement?.closest('details')) s.open = true
      // Después de que el navegador pinte lo que se abrió. Chrome la abre solo al cargar, pero la ida
      // de Next deja la página arriba: si no está a la vista, se la trae.
      requestAnimationFrame(() => {
        const { top } = destino.getBoundingClientRect()
        if (top < 0 || top >= window.innerHeight) destino.scrollIntoView({ block: 'start' })
      })
    }
    const alCambiar = () => {
      cancelAnimationFrame(cuadro)
      cuadro = requestAnimationFrame(abrir)
    }
    abrir()
    const navegacion = (window as unknown as { navigation?: EventTarget }).navigation
    window.addEventListener('hashchange', alCambiar)
    window.addEventListener('popstate', alCambiar)
    navegacion?.addEventListener('currententrychange', alCambiar)
    return () => {
      cancelAnimationFrame(cuadro)
      window.removeEventListener('hashchange', alCambiar)
      window.removeEventListener('popstate', alCambiar)
      navegacion?.removeEventListener('currententrychange', alCambiar)
    }
  }, [])
  return null
}
