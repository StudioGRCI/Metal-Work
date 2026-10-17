'use client'

import { Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { cerrarCosteo, reabrirCosteo } from '../acciones'

function useVentana() {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  return {
    abierta,
    vez,
    abrir: () => {
      setVez((v) => v + 1)
      setAbierta(true)
    },
    cerrar: () => setAbierta(false),
  }
}

function Pie({ error, enviando, alCancelar, texto }: { error: string | null; enviando: boolean; alCancelar: () => void; texto: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          {texto}
        </Boton>
      </div>
    </>
  )
}

/** Gerencia cierra el costeo al entregar la unidad: el costo y el margen de hoy quedan congelados. */
export function CerrarCosteo({ codigo, resumen }: { codigo: string; resumen: string }) {
  const v = useVentana()
  const { alEnviar, enviando, error } = useEnvio(cerrarCosteo, v.cerrar)
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={v.abrir} data-cerrar-costeo={codigo}>
        <Lock aria-hidden className="size-4" />
        Cerrar el costeo
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Cerrar el costeo de ${codigo}`}
        descripcion={`${resumen} Queda congelado con tu puesto y la fecha; lo que llegue después se verá como diferencia. Solo se cierra con todo completo: sin salidas sin precio, horas sin costo ni dólares sin tipo de cambio.`}
        ancho="md"
      >
        <form key={v.vez} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="codigo" value={codigo} />
          <Campo etiqueta="Observación" htmlFor="cierre-observacion" ayuda="Opcional: «Unidad entregada con su acta», por ejemplo.">
            <AreaTexto id="cierre-observacion" name="observacion" maxLength={500} />
          </Campo>
          <Pie error={error} enviando={enviando} alCancelar={v.cerrar} texto="Cerrar el costeo" />
        </form>
      </Ventana>
    </>
  )
}

/** Reabrir un costeo cerrado deja el cierre anterior como evidencia, con su motivo. */
export function ReabrirCosteo({ codigo }: { codigo: string }) {
  const v = useVentana()
  const { alEnviar, enviando, error } = useEnvio(reabrirCosteo, v.cerrar)
  return (
    <>
      <Boton type="button" tamano="sm" variante="contorno" onClick={v.abrir} data-reabrir-costeo={codigo}>
        <LockOpen aria-hidden className="size-4" />
        Reabrir
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Reabrir el costeo de ${codigo}`}
        descripcion="El cierre de hoy no se borra: queda con tu motivo, y el código vuelve a costearse con lo que entre hasta que lo cierres otra vez."
        ancho="md"
      >
        <form key={v.vez} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="codigo" value={codigo} />
          <Campo etiqueta="Motivo" htmlFor="reabrir-motivo" requerido>
            <AreaTexto id="reabrir-motivo" name="motivo" required minLength={10} maxLength={500} />
          </Campo>
          <Pie error={error} enviando={enviando} alCancelar={v.cerrar} texto="Reabrir el costeo" />
        </form>
      </Ventana>
    </>
  )
}
