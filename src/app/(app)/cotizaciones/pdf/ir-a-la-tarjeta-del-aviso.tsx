'use client'

import { useEffect } from 'react'

/**
 * El aviso de la campana llega a esta pantalla con `#<id>` de la cotización
 * (`destinoAviso`), pero la ida de Next no baja hasta ella: con la lista larga,
 * el vendedor caía arriba y la tarjeta de la que le hablaba el aviso quedaba
 * miles de píxeles abajo (Plan 9.1, comprobado en el banco). Al montarse la
 * lista, si la dirección nombra una tarjeta que está, se la trae a la vista.
 * No toca el historial ni la dirección: solo desplaza.
 */
export function IrALaTarjetaDelAviso() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    const tarjeta = document.getElementById(id)
    if (!tarjeta || tarjeta.getBoundingClientRect().top < window.innerHeight) return
    tarjeta.scrollIntoView({ block: 'start' })
  }, [])
  return null
}
