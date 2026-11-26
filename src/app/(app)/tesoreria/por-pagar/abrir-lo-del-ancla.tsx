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
 * que nombra está dentro de secciones cerradas, las abre y lo trae a la vista.
 * `SeccionDesplegable` no vuelve a cerrarlas: su `abierta` vale solo al cargar.
 */
export function AbrirLoDelAncla() {
  useEffect(() => {
    let cuadro = 0
    function abrir() {
      const id = idDeLaDireccion()
      const destino = id ? document.getElementById(id) : null
      if (!destino) return
      let cerrada = false
      for (let s = destino.parentElement?.closest('details'); s; s = s.parentElement?.closest('details')) {
        if (!s.open) {
          s.open = true
          cerrada = true
        }
      }
      if (!cerrada) return
      // Después de que el navegador pinte lo que se abrió.
      requestAnimationFrame(() => destino.scrollIntoView({ block: 'start' }))
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
