'use client'

import { useLayoutEffect } from 'react'

import { entroLaCuenta } from '@/lib/envio'

/**
 * Quién usa la pantalla, para guardar por cuenta el envío pendiente (`useIdDelEnvio`).
 * Va en `useLayoutEffect`, que corre al montar y antes de que llegue ningún clic:
 * con `useEffect`, un clic justo después de hidratar abría la ventana sin cuenta,
 * sin leer lo pendiente y con un id nuevo (vigésima pasada).
 */
export function CuentaDeLaPestana({ usuario }: { usuario: string }) {
  useLayoutEffect(() => {
    entroLaCuenta(usuario)
  }, [usuario])
  return null
}
