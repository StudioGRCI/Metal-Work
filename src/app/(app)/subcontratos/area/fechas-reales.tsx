'use client'

import { CalendarCheck } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { marcarFechasReales } from '../acciones'

/**
 * El supervisor marca el día en que el subcontrato empezó de verdad y, cuando
 * termina, el día en que terminó (migración 20261020201000). Son referenciales:
 * las fechas del contrato las pone Administración y no cambian.
 */
export function MarcarFechasReales({
  id,
  numero,
  detalle,
  inicio,
  fin,
  hoy,
}: {
  id: string
  numero: string
  /** Código interno y quién hace el trabajo: así lo busca el supervisor. */
  detalle: string
  inicio: string | null
  fin: string | null
  hoy: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-marcar-fechas-reales
      >
        <CalendarCheck aria-hidden className="size-4" />
        {!inicio ? 'Marcar inicio real' : !fin ? 'Marcar fin real' : 'Corregir fechas reales'}
        <span className="sr-only"> de {numero}</span>
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Fechas reales de ${numero}`}
        descripcion={`${detalle}. El día en que empezó de verdad y, cuando termine, el día en que terminó. Son de referencia: las del contrato no cambian.`}
        ancho="sm"
      >
        <FormularioFechas key={vez} id={id} inicio={inicio} fin={fin} hoy={hoy} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

function FormularioFechas({
  id,
  inicio,
  fin,
  hoy,
  alTerminar,
}: {
  id: string
  inicio: string | null
  fin: string | null
  hoy: string
  alTerminar: () => void
}) {
  const [desde, setDesde] = useState(inicio ?? '')
  const { alEnviar, enviando, error } = useEnvio(marcarFechasReales, alTerminar)
  const prefijo = `real-${id.slice(0, 8)}`
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Empezó el" htmlFor={`${prefijo}-inicio`} ayuda="Vacío, si todavía no empieza.">
          <Entrada id={`${prefijo}-inicio`} name="inicio_real" type="date" max={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo etiqueta="Terminó el" htmlFor={`${prefijo}-fin`} ayuda="Vacío, si todavía no termina.">
          <Entrada
            id={`${prefijo}-fin`}
            name="fin_real"
            type="date"
            min={desde || undefined}
            max={hoy}
            defaultValue={fin ?? ''}
            disabled={!desde}
          />
        </Campo>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Guardar
        </Boton>
      </div>
    </form>
  )
}
