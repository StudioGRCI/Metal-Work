'use client'

import { ArrowDown, ArrowUp, ListPlus, Save, XCircle } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ConfirmarAccion } from '@/components/ui/ventana'
import { useAccion, useEnvio } from '@/lib/envio'

import { programarRecojo, quitarDeLaLista } from './acciones'

/**
 * El peso y el lugar en la lista del conductor. Sirve para programarla y,
 * ya programada, para cambiarle el peso o pasarla a otro lugar.
 *
 * `cuantas` es cuántas hay en la lista contando esta: los lugares que se le
 * pueden dar.
 */
export function ProgramarRecojo({
  id,
  peso,
  lugar,
  cuantas,
  pesoFijo,
}: {
  id: string
  peso: number | null
  lugar: number | null
  cuantas: number
  /** Con la guía emitida el peso ya no cambia: la guía se hizo con ese peso. */
  pesoFijo: boolean
}) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(programarRecojo, (r) => setMensaje(r.mensaje ?? null))
  const programada = lugar !== null
  return (
    // La clave rehace el formulario cuando la base le cambia el lugar o el
    // peso (otra OC pasó delante, una flecha): sin ella el desplegable se
    // quedaba con el lugar viejo y «Guardar» la devolvía ahí sin querer.
    <form
      key={`${lugar ?? 'fuera'}-${peso ?? 'sin-peso'}`}
      onSubmit={(e) => {
        setMensaje(null)
        alEnviar(e)
      }}
      className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,10rem)_auto] sm:items-end"
    >
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Peso (kg)" htmlFor={`peso-${id}`} requerido ayuda={pesoFijo ? 'Ya hay guía con este peso.' : undefined}>
        <Entrada
          id={`peso-${id}`}
          name="peso"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 350"
          defaultValue={peso === null ? '' : String(peso)}
          readOnly={pesoFijo}
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="Lugar en la lista" htmlFor={`lugar-${id}`}>
        <Seleccion id={`lugar-${id}`} name="lugar" defaultValue={lugar === null ? '' : String(lugar)} disabled={enviando}>
          {!programada && <option value="">Al final ({cuantas}.º)</option>}
          {Array.from({ length: cuantas }, (_, i) => i + 1)
            .filter((n) => programada || n < cuantas)
            .map((n) => (
              <option key={n} value={n}>
                {n}.º{n === 1 ? ' (la primera)' : ''}
              </option>
            ))}
        </Seleccion>
      </Campo>
      <Boton type="submit" variante={programada ? 'secundario' : 'primario'} cargando={enviando}>
        {programada ? <Save aria-hidden className="size-4" /> : <ListPlus aria-hidden className="size-4" />}
        {programada ? 'Guardar' : 'Poner en la lista'}
      </Boton>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-3">
          {error}
        </p>
      )}
      {mensaje && !error && (
        <p role="status" className="text-sm text-exito sm:col-span-3">
          {mensaje}
        </p>
      )}
    </form>
  )
}

/** Subir o bajar un lugar sin abrir nada: el mismo programar, con el peso que ya tiene. */
export function MoverEnLista({ id, peso, lugar, cuantas, nombre }: { id: string; peso: number; lugar: number; cuantas: number; nombre: string }) {
  const accion = useAccion(programarRecojo)
  function mover(destino: number) {
    const datos = new FormData()
    datos.set('id', id)
    datos.set('peso', String(peso))
    datos.set('lugar', String(destino))
    accion.ejecutar(datos)
  }
  return (
    <div className="flex items-center gap-1">
      <Boton
        type="button"
        variante="contorno"
        tamano="icono"
        aria-label={`Subir ${nombre} un lugar`}
        disabled={lugar <= 1 || accion.enviando}
        onClick={() => mover(lugar - 1)}
      >
        <ArrowUp aria-hidden className="size-4" />
      </Boton>
      <Boton
        type="button"
        variante="contorno"
        tamano="icono"
        aria-label={`Bajar ${nombre} un lugar`}
        disabled={lugar >= cuantas || accion.enviando}
        onClick={() => mover(lugar + 1)}
      >
        <ArrowDown aria-hidden className="size-4" />
      </Boton>
      {accion.error && (
        <p role="alert" className="text-xs text-peligro">
          {accion.error}
        </p>
      )}
    </div>
  )
}

/** Sacarla de la lista del conductor: pide confirmar, porque a él le llega el aviso. */
export function QuitarDeLaLista({ id, nombre }: { id: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const accion = useAccion(quitarDeLaLista, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)}>
        <XCircle aria-hidden className="size-4" />
        Sacar de la lista
      </Boton>
      {accion.error && !abierta && (
        <p role="alert" className="text-xs text-peligro">
          {accion.error}
        </p>
      )}
      <ConfirmarAccion
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`¿Sacar ${nombre} de la lista del conductor?`}
        detalle="Al conductor le llega el aviso de que no salga a recogerla. Se queda con su peso; la puedes volver a poner cuando quieras."
        etiquetaConfirmar="Sí, sacarla"
        trabajando={accion.enviando}
        alConfirmar={() => {
          const datos = new FormData()
          datos.set('id', id)
          accion.ejecutar(datos)
        }}
      />
    </>
  )
}
