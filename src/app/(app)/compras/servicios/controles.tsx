'use client'

import { Ban, CheckCheck, Play } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useAccion, useEnvio } from '@/lib/envio'

import { avanzarOrdenServicio } from './acciones'

type Paso = 'CONFORME' | 'ANULADA'

/** Lo que Logística marca en una orden de servicio: que empezó, que volvió conforme o que se anula. */
export function AvanceServicio({
  id,
  numero,
  iniciar,
  conformar,
  anular,
}: {
  id: string
  numero: string
  iniciar: boolean
  conformar: boolean
  anular: boolean
}) {
  const [paso, setPaso] = useState<Paso | null>(null)
  const inicio = useAccion(avanzarOrdenServicio)
  const cierre = useEnvio(avanzarOrdenServicio, () => setPaso(null))

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {iniciar && (
        <Boton
          type="button"
          variante="secundario"
          tamano="sm"
          cargando={inicio.enviando}
          onClick={() => {
            const datos = new FormData()
            datos.set('id', id)
            datos.set('paso', 'EN_EJECUCION')
            inicio.ejecutar(datos)
          }}
        >
          <Play aria-hidden className="size-4" />
          En ejecución
        </Boton>
      )}
      {conformar && (
        <Boton type="button" variante="secundario" tamano="sm" onClick={() => setPaso('CONFORME')}>
          <CheckCheck aria-hidden className="size-4" />
          Conforme
        </Boton>
      )}
      {anular && (
        <Boton type="button" variante="contornoPeligro" tamano="sm" onClick={() => setPaso('ANULADA')}>
          <Ban aria-hidden className="size-4" />
          Anular
        </Boton>
      )}
      {inicio.error && (
        <p role="alert" className="basis-full text-right text-xs text-peligro">
          {inicio.error}
        </p>
      )}
      <Ventana
        abierta={paso !== null}
        alCerrar={() => setPaso(null)}
        titulo={paso === 'ANULADA' ? `Anular la orden de servicio ${numero}` : `Conformidad de la orden de servicio ${numero}`}
        descripcion={
          paso === 'ANULADA'
            ? 'No se borra: queda con su número, el motivo, quién y cuándo.'
            : 'El trabajo volvió bien. Con la conformidad, Tesorería puede pagarla.'
        }
        ancho="md"
      >
        <form onSubmit={cierre.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="paso" value={paso ?? ''} />
          <Campo
            etiqueta={paso === 'ANULADA' ? 'Motivo' : 'Observación (opcional)'}
            htmlFor={`os-nota-${id}`}
            requerido={paso === 'ANULADA'}
          >
            <AreaTexto
              id={`os-nota-${id}`}
              name="nota"
              required={paso === 'ANULADA'}
              minLength={paso === 'ANULADA' ? 10 : undefined}
              maxLength={500}
              placeholder={paso === 'ANULADA' ? 'Por ejemplo: el proveedor no puede hacerlo a tiempo; se encarga a otro.' : undefined}
            />
          </Campo>
          {cierre.error && (
            <p role="alert" className="text-sm text-peligro">
              {cierre.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setPaso(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante={paso === 'ANULADA' ? 'peligro' : 'primario'} cargando={cierre.enviando}>
              {paso === 'ANULADA' ? 'Anular' : 'Registrar conformidad'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
