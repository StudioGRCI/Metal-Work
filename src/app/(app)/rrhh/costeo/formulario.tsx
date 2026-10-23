'use client'

import { Ban, Clock } from 'lucide-react'
import { useRef, useState } from 'react'

import { EntradaCodigoInterno, type CodigoParaElegir } from '@/components/codigo-interno/elegir-codigo'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { CODIGO_FIJO_PLANTA } from '@/lib/dominio/codigos-internos'
import { HORAS_DEL_MES } from '@/lib/dominio/rrhh'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { anularTareo, registrarTareo } from './acciones'

export type PersonaTareo = { id: string; nombre: string; cargo: string | null; costo_mensual: number | null }

/**
 * «Cargar horas»: RR. HH. pasa el parte de los supervisores persona por persona.
 * La ventana se queda abierta después de cada carga, con el mismo día y el
 * mismo código, porque un parte trae a varios en la misma unidad. El id de cada
 * carga vive aquí (`useIdDelEnvio`): tras «No llegó la respuesta», cancelar y
 * volver a abrir lleva el mismo, y la base dice si ya quedó.
 */
export function CargarHoras({ personal, codigos, hoy }: { personal: PersonaTareo[]; codigos: CodigoParaElegir[] | null; hoy: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [ultimo, setUltimo] = useState({ fecha: hoy, codigo: '' })
  const [aviso, setAviso] = useState<string | null>(null)
  const envio = useIdDelEnvio(undefined, undefined, 'cargar-horas')
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <Clock aria-hidden className="size-4" />
        Cargar horas
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Cargar horas a un código interno"
        descripcion={`Las horas que la persona trabajó ese día en esa unidad. Cada hora vale su costo mensual entre ${HORAS_DEL_MES}.`}
        ancho="lg"
      >
        {envio.id && (
          <FormularioHoras
            key={vez}
            envio={envio}
            personal={personal}
            codigos={codigos}
            hoy={hoy}
            fecha={ultimo.fecha}
            codigo={ultimo.codigo}
            aviso={aviso}
            alCancelar={() => setAbierta(false)}
            alTerminar={(mensaje, fecha, codigo) => {
              setUltimo({ fecha, codigo })
              setAviso(mensaje)
              setVez((v) => v + 1)
            }}
          />
        )}
      </Ventana>
    </>
  )
}

function FormularioHoras({
  envio,
  personal,
  codigos,
  hoy,
  fecha,
  codigo,
  aviso,
  alCancelar,
  alTerminar,
}: {
  envio: ReturnType<typeof useIdDelEnvio>
  personal: PersonaTareo[]
  codigos: CodigoParaElegir[] | null
  hoy: string
  fecha: string
  codigo: string
  aviso: string | null
  alCancelar: () => void
  alTerminar: (mensaje: string, fecha: string, codigo: string) => void
}) {
  const id = envio.id ?? ''
  const [persona, setPersona] = useState('')
  const [horas, setHoras] = useState('')
  const [codigoEscrito, setCodigoEscrito] = useState(codigo)
  // El día y el código que se mandaron, para dejarlos puestos en la carga siguiente.
  const enviado = useRef({ fecha, codigo })
  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      envio.salio()
      return registrarTareo(previo, datos)
    },
    (r) => {
      // La carga siguiente, en la misma ventana, es otro envío.
      envio.otro()
      alTerminar(r.mensaje ?? 'Horas cargadas.', enviado.current.fecha, enviado.current.codigo)
    },
    { alYaEntrar: envio.otro },
  )
  const elegida = personal.find((p) => p.id === persona)
  const costoHora = elegida?.costo_mensual ? elegida.costo_mensual / HORAS_DEL_MES : null
  const n = Number(horas.replace(',', '.'))

  return (
    <form
      onSubmit={(e) => {
        const datos = new FormData(e.currentTarget)
        enviado.current = { fecha: String(datos.get('fecha') ?? fecha), codigo: String(datos.get('codigo_interno') ?? '').trim().toUpperCase() }
        alEnviar(e)
      }}
      className="space-y-4"
    >
      <input type="hidden" name="id" value={id} />
      {aviso && (
        <p role="status" className="rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          {aviso} Sigue con la siguiente persona o cierra la ventana.
        </p>
      )}
      <Campo etiqueta="Persona" htmlFor={`tareo-persona-${id}`} requerido>
        <SeleccionBuscable
          id={`tareo-persona-${id}`}
          name="trabajador_id"
          valor={persona}
          onChange={setPersona}
          requerido
          marcador="Elige a la persona"
          marcadorBusqueda="Nombre o cargo…"
          opciones={personal.map((p) => ({
            valor: p.id,
            etiqueta: p.nombre,
            detalle: `${p.cargo ?? 'Sin cargo'}${p.costo_mensual ? '' : ' · sin costo mensual'}`,
          }))}
        />
      </Campo>
      {elegida && !elegida.costo_mensual && (
        <p role="alert" className="text-sm text-aviso">
          {elegida.nombre} no tiene costo mensual: ponlo primero en su ficha de Personal.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Día trabajado" htmlFor={`tareo-fecha-${id}`} requerido>
          <Entrada id={`tareo-fecha-${id}`} name="fecha" type="date" required max={hoy} defaultValue={fecha} />
        </Campo>
        <Campo etiqueta="Código interno" htmlFor={`tareo-codigo-${id}`} requerido ayuda="El de la unidad, o PLANTA. Búscalo por el código, la placa o la marca.">
          <EntradaCodigoInterno
            id={`tareo-codigo-${id}`}
            name="codigo_interno"
            requerido
            valor={codigoEscrito}
            onChange={setCodigoEscrito}
            aceptadoInicial={codigo}
            codigos={codigos}
            fijos={[CODIGO_FIJO_PLANTA]}
          />
        </Campo>
        <Campo etiqueta="Horas" htmlFor={`tareo-horas-${id}`} requerido>
          <Entrada
            id={`tareo-horas-${id}`}
            name="horas"
            type="number"
            required
            min={0.25}
            max={16}
            step={0.25}
            inputMode="decimal"
            value={horas}
            onChange={(e) => setHoras(e.target.value)}
            className="tabular"
          />
        </Campo>
      </div>
      <Campo etiqueta="Labor" htmlFor={`tareo-labor-${id}`} ayuda="Qué hizo, como lo anota el supervisor.">
        <Entrada id={`tareo-labor-${id}`} name="labor" maxLength={200} placeholder="Soldadura de tolva, pintado de puertas…" autoComplete="off" />
      </Campo>
      {costoHora !== null && (
        <p className="text-xs text-texto-suave">
          La hora de {elegida?.nombre} vale <span className="tabular">{moneda(costoHora)}</span>
          {n > 0 && (
            <>
              {' '}
              · estas horas cuestan <span className="tabular font-semibold text-texto">{moneda(n * costoHora)}</span>
            </>
          )}
          .
        </p>
      )}
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Cargar horas" />
    </form>
  )
}

/** Anular unas horas mal cargadas: quedan tachadas, con su motivo. */
export function AnularTareo({ id, descripcion }: { id: string; descripcion: string }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(anularTareo, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${descripcion}`} onClick={() => setAbierta(true)}>
        <Ban aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular estas horas"
        descripcion={`${descripcion}. No se borran: quedan con su motivo y dejan de sumar al costo.`}
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-tareo-${id}`} requerido>
            <AreaTexto
              id={`anular-tareo-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="Por ejemplo: se cargaron al código equivocado."
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
