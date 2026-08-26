'use client'

import { PenLine } from 'lucide-react'
import { useState } from 'react'

import { VentanaFirmar } from '@/components/documentos/firmas-documento'
import { Boton } from '@/components/ui/boton'

/** Abre la ventana de firma desde la bandeja. */
export function BotonFirmar({ aprobacionId }: { aprobacionId: string }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <Boton tamano="sm" onClick={() => setAbierto(true)}>
        <PenLine aria-hidden className="size-3.5" />
        Firmar
      </Boton>
      {abierto && (
        <VentanaFirmar aprobacionId={aprobacionId} onCerrar={() => setAbierto(false)} />
      )}
    </>
  )
}
