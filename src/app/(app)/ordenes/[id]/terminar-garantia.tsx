'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { darPorTerminadaLaGarantia } from '../acciones'

/**
 * El botón con el que Administración da por terminada la garantía cuando el
 * taller avisa. Pregunta antes: no se deshace con otro toque. La ventana se
 * cierra solo cuando la base aceptó; si rechaza, el error sale junto a la nota
 * y la nota se queda escrita.
 */
export function TerminarGarantia({ ordenId, numero }: { ordenId: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  // Cada apertura monta la ventana de nuevo: no arrastra el error de la anterior.
  const [vez, setVez] = useState(0)

  return (
    <>
      <Boton
        tamano="sm"
        variante="primario"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        Dar por terminada la garantía
      </Boton>
      <VentanaGarantia key={vez} ordenId={ordenId} numero={numero} abierta={abierta} alCerrar={() => setAbierta(false)} />
    </>
  )
}

function VentanaGarantia({ ordenId, numero, abierta, alCerrar }: {
  ordenId: string
  numero: string
  abierta: boolean
  alCerrar: () => void
}) {
  const { alEnviar, enviando, error } = useEnvio(darPorTerminadaLaGarantia, alCerrar)

  return (
    <Ventana
      abierta={abierta}
      alCerrar={alCerrar}
      titulo="Terminar la garantía"
      descripcion={`OT ${numero}. Hazlo cuando el taller avise que terminó. La OT no cambia de estado; si el vehículo está en la planta, a Requerimientos le llega el aviso, y sale con el visto de Tesorería. No se deshace.`}
      ancho="sm"
    >
      <form onSubmit={alEnviar} className="space-y-3">
        <input type="hidden" name="orden_id" value={ordenId} />
        <Campo etiqueta="Nota" htmlFor="nota_garantia" ayuda="Opcional: qué se hizo o quién del taller avisó.">
          <AreaTexto id="nota_garantia" name="nota" rows={2} maxLength={500} placeholder="Ej.: compuerta cambiada, avisó el taller" />
        </Campo>
        {error && (
          <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="fantasma" tamano="sm" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" tamano="sm" variante="primario" cargando={enviando}>
            Dar por terminada
          </Boton>
        </div>
      </form>
    </Ventana>
  )
}
