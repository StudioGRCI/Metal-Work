'use client'

import { PenLine } from 'lucide-react'
import { useState } from 'react'

import { VentanaFirmar } from '@/components/documentos/firmas-documento'
import { Boton } from '@/components/ui/boton'

/** Abre la ventana de firma desde la bandeja. */
export function BotonFirmar({ aprobacionId, titulo }: { aprobacionId: string; titulo: string }) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      {/* En la bandeja hay un «Firmar» por fila y todos dicen lo mismo: el
          aria-label carga el título para que se sepa cuál se está firmando.
          Ancho completo en el teléfono —queda debajo del texto al envolverse y
          medio botón suelto a la derecha no se acierta con el guante puesto—;
          en el monitor vuelve a ocupar solo lo suyo. */}
      <Boton
        tamano="sm"
        onClick={() => setAbierto(true)}
        aria-label={`Firmar ${titulo}`}
        className="w-full justify-center sm:w-auto"
      >
        <PenLine aria-hidden className="size-3.5" />
        Firmar
      </Boton>
      {abierto && (
        <VentanaFirmar aprobacionId={aprobacionId} onCerrar={() => setAbierto(false)} />
      )}
    </>
  )
}
