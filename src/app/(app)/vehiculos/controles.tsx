'use client'

import { Ban, LogOut } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { anularRegistroVehiculo, registrarSalidaVehiculo } from './acciones'

type Paso = 'SALIDA' | 'ANULAR'

/** Lo que se marca en un vehículo que está en planta: que salió, o que el ingreso se anotó mal. */
export function ControlesVehiculo({ id, nombre }: { id: string; nombre: string }) {
  const [paso, setPaso] = useState<Paso | null>(null)
  const salida = useEnvio(registrarSalidaVehiculo, () => setPaso(null))
  const anular = useEnvio(anularRegistroVehiculo, () => setPaso(null))
  const envio = paso === 'ANULAR' ? anular : salida

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Boton type="button" variante="secundario" tamano="sm" onClick={() => setPaso('SALIDA')}>
        <LogOut aria-hidden className="size-4" />
        Marcar salida
      </Boton>
      <Boton type="button" variante="contornoPeligro" tamano="sm" aria-label={`Anular el ingreso de ${nombre}`} onClick={() => setPaso('ANULAR')}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={paso !== null}
        alCerrar={() => setPaso(null)}
        titulo={paso === 'ANULAR' ? `Anular el ingreso de ${nombre}` : `Salida de ${nombre}`}
        descripcion={
          paso === 'ANULAR'
            ? 'Para un ingreso que se anotó mal. No se borra: queda con su motivo.'
            : 'El vehículo deja la planta. La salida ya marcada no se corrige.'
        }
        ancho="md"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          {paso === 'SALIDA' && (
            <Campo etiqueta="Fecha y hora de salida" htmlFor={`veh-salida-${id}`} ayuda="Déjalo vacío si sale ahora.">
              <Entrada id={`veh-salida-${id}`} name="salida_en" type="datetime-local" />
            </Campo>
          )}
          <Campo
            etiqueta={paso === 'ANULAR' ? 'Motivo' : 'Observación (opcional)'}
            htmlFor={`veh-nota-${id}`}
            requerido={paso === 'ANULAR'}
          >
            <AreaTexto
              id={`veh-nota-${id}`}
              name={paso === 'ANULAR' ? 'motivo' : 'observacion'}
              required={paso === 'ANULAR'}
              minLength={paso === 'ANULAR' ? 10 : undefined}
              maxLength={500}
              placeholder={paso === 'ANULAR' ? 'Por ejemplo: se anotó la placa de otro vehículo.' : 'Por ejemplo: sale al arenado externo.'}
            />
          </Campo>
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setPaso(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante={paso === 'ANULAR' ? 'peligro' : 'primario'} cargando={envio.enviando}>
              {paso === 'ANULAR' ? 'Anular' : 'Registrar salida'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
