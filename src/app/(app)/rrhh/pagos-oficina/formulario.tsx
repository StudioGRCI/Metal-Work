'use client'

import { Ban, Wallet } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { FRECUENCIAS, type Frecuencia, diasEntre, tramoSugerido } from '@/lib/dominio/pagos-oficina'
import { aplicarDescuentos } from '@/lib/dominio/planilla-diaria'
import { useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { anularPagoOficina, registrarPagoOficina } from './acciones'

/**
 * `inicio`: su primer día sin pago en el mes, con el que se llena «Desde» al
 * elegirla. `descuentos`: lo que tiene por restar (o devolver, en negativo)
 * hasta hoy, en el orden en que la base lo aplica; `fecha` es el mes de las
 * tardanzas (su día 1) o el día del permiso.
 */
export type PersonaOficina = {
  id: string
  nombre: string
  cargo: string | null
  inicio: string
  descuentos: { fecha: string; monto: number; detalle: string }[]
}

/** «Registrar pago»: lo que se le pagó a una persona de la oficina y qué días paga. */
export function RegistrarPago({ personal, inicio }: { personal: PersonaOficina[]; inicio: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      {/* Botón y avisos en columna: un texto suelto en las acciones del encabezado lo ensancha y mueve el botón. */}
      <div className="flex flex-col items-end gap-1">
        <Boton
          type="button"
          onClick={() => {
            setAviso(null)
            setVez((v) => v + 1)
            setAbierta(true)
          }}
          disabled={personal.length === 0}
        >
          <Wallet aria-hidden className="size-4" />
          Registrar pago
        </Boton>
        {personal.length === 0 && (
          <p className="max-w-xs text-right text-xs text-texto-suave">
            No hay nadie de planilla administrativa a quien pagarle: elige su planilla en su ficha de Personal.
          </p>
        )}
        {aviso && (
          <p role="status" className="max-w-xs text-right text-sm text-exito">
            {aviso}
          </p>
        )}
      </div>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Pago a una persona de la oficina"
        descripcion="Su sueldo de esos días: la base le resta lo que tiene por tardanzas y permisos descontados. Entra al costeo de cada mes por los días que caen en él."
        ancho="lg"
      >
        <FormularioPago
          key={vez}
          personal={personal}
          inicio={inicio}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioPago({
  personal,
  inicio,
  alTerminar,
}: {
  personal: PersonaOficina[]
  inicio: string
  alTerminar: (mensaje: string) => void
}) {
  // Decidido aquí: un reintento manda el mismo id y la base no lo duplica.
  const [id] = useState(() => crypto.randomUUID())
  const [frecuencia, setFrecuencia] = useState<Frecuencia>('QUINCENA')
  const [desde, setDesde] = useState(inicio)
  const [hasta, setHasta] = useState(() => tramoSugerido('QUINCENA', inicio) ?? inicio)
  const [personaId, setPersonaId] = useState('')
  const [monto, setMonto] = useState('')
  const { alEnviar, enviando, error } = useEnvio(registrarPagoOficina, (r) => alTerminar(r.mensaje ?? 'Pago registrado.'))
  const dias = desde && hasta ? diasEntre(desde, hasta) : 0
  // Lo mismo que va a restar la base: lo que hay hasta el último día que paga.
  const descuentos = (personal.find((p) => p.id === personaId)?.descuentos ?? []).filter((d) => hasta && d.fecha <= hasta)
  const sueldo = Number(monto.replace(/[\s,]/g, ''))
  const vista = descuentos.length > 0 && sueldo > 0 ? aplicarDescuentos(sueldo, descuentos) : null

  function cambiarTramo(f: Frecuencia, d: string) {
    setFrecuencia(f)
    setDesde(d)
    const sugerido = tramoSugerido(f, d)
    if (sugerido) setHasta(sugerido)
  }

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Persona" htmlFor={`pago-persona-${id}`} requerido>
        <Seleccion
          id={`pago-persona-${id}`}
          name="trabajador_id"
          required
          defaultValue=""
          onChange={(e) => {
            const persona = personal.find((p) => p.id === e.target.value)
            setPersonaId(e.target.value)
            if (persona) cambiarTramo(frecuencia, persona.inicio)
          }}
        >
          <option value="" disabled>
            Elige a quién se le pagó
          </option>
          {personal.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
              {p.cargo ? ` · ${p.cargo}` : ''}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Cada cuánto se le paga" htmlFor={`pago-frecuencia-${id}`} ayuda="Llena el último día; puedes cambiarlo.">
          <Seleccion
            id={`pago-frecuencia-${id}`}
            value={frecuencia}
            onChange={(e) => cambiarTramo(e.target.value as Frecuencia, desde)}
          >
            {Object.entries(FRECUENCIAS).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Desde" htmlFor={`pago-desde-${id}`} requerido>
          <Entrada
            id={`pago-desde-${id}`}
            name="desde"
            type="date"
            required
            value={desde}
            onChange={(e) => cambiarTramo(frecuencia, e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Hasta" htmlFor={`pago-hasta-${id}`} requerido ayuda={dias > 0 ? `${dias} ${dias === 1 ? 'día' : 'días'}` : undefined}>
          <Entrada
            id={`pago-hasta-${id}`}
            name="hasta"
            type="date"
            required
            min={desde}
            value={hasta}
            onChange={(e) => {
              setFrecuencia('OTRO')
              setHasta(e.target.value)
            }}
          />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          etiqueta="Su sueldo de esos días (S/)"
          htmlFor={`pago-monto-${id}`}
          requerido
          ayuda="Sueldo, asignación y bonos de esos días, sin restar tardanzas ni permisos: eso lo resta la base."
        >
          <Entrada
            id={`pago-monto-${id}`}
            name="monto"
            type="number"
            required
            min={0.01}
            max={100000}
            step={0.01}
            inputMode="decimal"
            className="tabular"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
        </Campo>
        <Campo etiqueta="Aportes de la empresa (S/)" htmlFor={`pago-aportes-${id}`} ayuda="EsSalud y otros por ese pago. También es costo.">
          <Entrada id={`pago-aportes-${id}`} name="aportes" type="number" min={0} max={100000} step={0.01} inputMode="decimal" defaultValue="0" className="tabular" />
        </Campo>
      </div>
      {descuentos.length > 0 && (
        <div className="rounded-lg border border-borde bg-superficie-2 px-3 py-2 text-sm" data-vista-descuentos>
          <p className="font-medium text-texto">Lo que el pago le resta o devuelve</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {descuentos.map((d, i) => {
              const aplica = vista ? vista.aplicados[i] : d.monto
              return (
                <li key={`${d.fecha}-${i}`} className={d.monto > 0 ? 'text-peligro' : 'text-exito'}>
                  <span className="tabular">
                    {d.monto > 0 ? '− ' : '+ '}
                    {moneda(Math.abs(aplica))}
                  </span>{' '}
                  · {d.detalle}
                  {vista && d.monto > 0 && aplica < d.monto && (
                    <span className="text-texto-suave">
                      {' '}
                      (<span className="tabular">{moneda(d.monto - aplica)}</span> quedan para el siguiente pago)
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {vista && (
            <p className="mt-1 text-texto">
              Se le paga <span className="tabular font-semibold">{moneda(vista.neto)}</span>
            </p>
          )}
        </div>
      )}
      <Campo etiqueta="Nota" htmlFor={`pago-nota-${id}`}>
        <Entrada id={`pago-nota-${id}`} name="nota" maxLength={200} placeholder="Por ejemplo: incluye un bono por cierre de mes." />
      </Campo>
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

/** Anular un pago mal registrado: queda tachado, con su motivo, y sale del costeo. */
export function AnularPago({ id, descripcion }: { id: string; descripcion: string }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(anularPagoOficina, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${descripcion}`} onClick={() => setAbierta(true)}>
        <Ban aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular este pago"
        descripcion={`${descripcion}. No se borra: queda con su motivo y deja de sumar al costeo.`}
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-pago-${id}`} requerido>
            <AreaTexto
              id={`anular-pago-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="Por ejemplo: se registró con el monto de otra persona."
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
