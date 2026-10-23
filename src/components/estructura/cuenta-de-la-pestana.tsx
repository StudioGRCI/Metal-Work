'use client'

import { useEffect } from 'react'

import { entroLaCuenta } from '@/lib/envio'

/** Quién usa la pantalla, para guardar por cuenta el envío pendiente (`useIdDelEnvio`). */
export function CuentaDeLaPestana({ usuario }: { usuario: string }) {
  useEffect(() => {
    entroLaCuenta(usuario)
  }, [usuario])
  return null
}
