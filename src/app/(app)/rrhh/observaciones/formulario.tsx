'use client'

import { Ban, MessageSquareWarning } from 'lucide-react'
import { useState } from 'react'

import { CodigoInternoConLista } from '@/components/codigo-interno/elegir-codigo'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { MOTIVO_OBSERVACION, TIPO_OBSERVACION } from '@/lib/dominio/rrhh'
import { useEnvio } from '@/lib/envio'

import { anularObservacion, registrarObservacion } from './acciones'

type Persona = { id: string; nombre: string; cargo: string | null }

/** El botón «Registrar observación» y su ventana. */
export function RegistrarObservacion({
  personal,
  hoy,
  personaInicial,
  codigos,
}: {
  personal: Persona[]
  hoy: string
  personaInicial?: string
  /** Para el buscador de código interno; `null` si la lista no se pudo leer. */
  codigos: CodigoParaElegir[] | null
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <MessageSquareWarning aria-hidden className="size-4" />
        Registrar observación
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Registrar observación o amonestación"
        descripcion="Lo que pasó, a quién y por qué. Queda en su historial: no se borra, se anula con su motivo."
        ancho="lg"
      >
        <FormularioObservacion
          key={vez}
          personal={personal}
          hoy={hoy}
          personaInicial={personaInicial}
          codigos={codigos}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioObservacion({
  personal,
  hoy,
  personaInicial,
  codigos,
  alTerminar,
}: {
  personal: Persona[]
  hoy: string
  personaInicial?: string
  codigos: CodigoParaElegir[] | null
  alTerminar: (mensaje: string) => void
}) {
  // Decidido aquí: un reintento manda el mismo id y la base no duplica.
  const [id] = useState(() => crypto.randomUUID())
  const [persona, setPersona] = useState(personaInicial ?? '')
  const [tipo, setTipo] = useState('OBSERVACION')
  const { alEnviar, enviando, error } = useEnvio(registrarObservacion, (r) => alTerminar(r.mensaje ?? 'Registrada.'))
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Persona" htmlFor={`obs-persona-${id}`} requerido>
        <SeleccionBuscable
          id={`obs-persona-${id}`}
          name="trabajador_id"
          valor={persona}
          onChange={setPersona}
          requerido
          marcador="Elige a la persona"
          marcadorBusqueda="Nombre o cargo…"
          opciones={personal.map((p) => ({ valor: p.id, etiqueta: p.nombre, detalle: p.cargo ?? 'Sin cargo' }))}
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Qué es" htmlFor={`obs-tipo-${id}`} requerido>
          <Seleccion id={`obs-tipo-${id}`} name="tipo" required value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {Object.entries(TIPO_OBSERVACION).map(([valor, d]) => (
              <option key={valor} value={valor}>
                {d.etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Motivo" htmlFor={`obs-motivo-${id}`} requerido>
          <Seleccion id={`obs-motivo-${id}`} name="motivo" required defaultValue="">
            <option value="" disabled>
              Elige el motivo
            </option>
            {Object.entries(MOTIVO_OBSERVACION).map(([valor, d]) => (
              <option key={valor} value={valor}>
                {d.etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Día en que pasó" htmlFor={`obs-fecha-${id}`} requerido>
          <Entrada id={`obs-fecha-${id}`} name="fecha" type="date" required max={hoy} defaultValue={hoy} />
        </Campo>
      </div>
      <Campo etiqueta="Qué pasó" htmlFor={`obs-detalle-${id}`} requerido>
        <AreaTexto
          id={`obs-detalle-${id}`}
          name="detalle"
          required
          minLength={10}
          maxLength={1000}
          rows={4}
          placeholder="Por ejemplo: trabajaba en la tolva sin careta de soldar; se le pidió ponérsela y volvió a quitársela."
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Código interno" htmlFor={`obs-codigo-${id}`} ayuda="Si pasó trabajando en una unidad. Búscalo por el código, la placa o la marca.">
          <CodigoInternoConLista id={`obs-codigo-${id}`} name="codigo_interno" codigos={codigos} />
        </Campo>
        {tipo === 'SUSPENSION' && (
          <Campo etiqueta="Días de suspensión" htmlFor={`obs-dias-${id}`} requerido>
            <Entrada id={`obs-dias-${id}`} name="dias_suspension" type="number" required min={1} max={30} step={1} className="tabular" />
          </Campo>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          Registrar
        </Boton>
      </div>
    </form>
  )
}

/** Anular una observación equivocada: queda tachada, con su motivo. */
export function AnularObservacion({ id, descripcion }: { id: string; descripcion: string }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(anularObservacion, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${descripcion}`} onClick={() => setAbierta(true)}>
        <Ban aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular este registro"
        descripcion={`${descripcion}. No se borra: queda con su motivo y sale del resumen.`}
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-obs-${id}`} requerido>
            <AreaTexto
              id={`anular-obs-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="Por ejemplo: se registró a la persona equivocada."
            />
          </Campo>
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={envio.enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
