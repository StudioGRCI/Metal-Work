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
 * El aviso de la campana llega a esta pantalla con `#<id>` de la cotización
 * (`destinoAviso`), y la ficha del cliente enlaza igual. Pero la ida de Next no
 * baja hasta ella cuando viene de otra pantalla (busca el ancla mientras se ve
 * el esqueleto de carga), y como navega sin recargar, `:target` nunca se
 * enciende: con la lista larga, el vendedor caía arriba o sobre otra tarjeta
 * (Plan 9.1, comprobado en el banco).
 *
 * Al montarse la lista, y cada vez que la dirección cambia de `#` sin salir de
 * la pantalla (otro aviso abierto aquí mismo), trae esa tarjeta a la vista, la
 * marca con `data-del-aviso` —y le quita la marca a la de antes— y le da el
 * cursor, para que el lector de pantalla empiece por ella. No toca el historial
 * ni la dirección. Lo de «aquí mismo» lo dice la Navigation API del navegador;
 * donde no la hay, la tarjeta igual baja (Next lo hace en esa ida) y solo no se
 * marca.
 */
export function IrALaTarjetaDelAviso() {
  useEffect(() => {
    let marcada: HTMLElement | null = null
    let cuadro = 0
    function irALaTarjeta() {
      const id = idDeLaDireccion()
      const tarjeta = id ? document.getElementById(id) : null
      if (tarjeta === marcada) return
      marcada?.removeAttribute('data-del-aviso')
      marcada = tarjeta
      if (!tarjeta) return
      tarjeta.setAttribute('data-del-aviso', '')
      tarjeta.tabIndex = -1
      const { top } = tarjeta.getBoundingClientRect()
      if (top < 0 || top >= window.innerHeight) tarjeta.scrollIntoView({ block: 'start' })
      tarjeta.focus({ preventScroll: true })
    }
    // Después de que Next termine su ida y su desplazamiento.
    const alCambiar = () => {
      cancelAnimationFrame(cuadro)
      cuadro = requestAnimationFrame(irALaTarjeta)
    }
    irALaTarjeta()
    const navegacion = (window as unknown as { navigation?: EventTarget }).navigation
    window.addEventListener('hashchange', alCambiar)
    window.addEventListener('popstate', alCambiar)
    navegacion?.addEventListener('currententrychange', alCambiar)
    return () => {
      cancelAnimationFrame(cuadro)
      window.removeEventListener('hashchange', alCambiar)
      window.removeEventListener('popstate', alCambiar)
      navegacion?.removeEventListener('currententrychange', alCambiar)
      marcada?.removeAttribute('data-del-aviso')
    }
  }, [])
  return null
}
