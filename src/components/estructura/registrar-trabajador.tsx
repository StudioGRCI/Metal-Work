'use client'

import { useEffect } from 'react'

/**
 * Registra `public/sw.js`, que solo muestra la página «sin conexión» cuando el
 * taller se queda sin señal. En desarrollo no se registra: un trabajador viejo
 * sirviendo desde la memoria del navegador es la clase de confusión que cuesta
 * una tarde.
 */
export function RegistrarTrabajador() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Sin trabajador la aplicación funciona igual; solo no hay página propia sin señal.
    })
  }, [])

  return null
}
