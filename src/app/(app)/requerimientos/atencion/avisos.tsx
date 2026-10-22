'use client'

import { createContext, useContext, useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'

const Avisar = createContext<(mensaje: string, aviso?: boolean) => void>(() => {})

/**
 * Lo que acaba de pasar con un RQ, arriba de la lista. Al entregarlo, la fila
 * se va de «Por atender» y con ella el botón que se tocó: lo que diga la
 * ventana al cerrar tiene que quedar fuera de la fila, o no se ve nunca.
 */
export function ConAvisos({ children }: { children: React.ReactNode }) {
  const [aviso, setAviso] = useState<{ mensaje: string; aviso: boolean; n: number } | null>(null)
  return (
    <Avisar.Provider value={(mensaje, deAviso = false) => setAviso((previo) => ({ mensaje, aviso: deAviso, n: (previo?.n ?? 0) + 1 }))}>
      {aviso && (
        <AvisoEnfocado key={aviso.n} aviso={aviso.aviso} className="mb-3 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2">
          {aviso.mensaje}
        </AvisoEnfocado>
      )}
      {children}
    </Avisar.Provider>
  )
}

/** Deja un aviso arriba de la lista de «Atención». */
export function useAvisar() {
  return useContext(Avisar)
}
