'use client'

import { Link2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { definir, ESTADO_OT } from '@/lib/dominio/estados'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { engancharOtACotizacion } from './acciones'

/** La OT ya registrada que la pantalla ofrece enganchar (de `otsParaEnganchar`). */
export type OtRegistrada = {
  id: string
  numero: string
  estado: string
  codigo: string | null
  placa: string | null
  descripcion: string | null
  version: string
}

// Lo que entró se dice en el encabezado: si la cotización queda con todas sus
// OT, su tarjeta ya no pinta este botón y el aviso se iría con él.
const ENGANCHADA = 'enganchar-ot:hecho'

/** Junto a los estados del encabezado: la OT que se acaba de enganchar. */
export function EstadoDelEnganche() {
  const [hecho] = useEstadoCompartido<string | null>(ENGANCHADA, null)
  return (
    <span role="status" className={hecho ? 'text-xs font-medium text-exito sm:text-right' : 'sr-only'}>
      {hecho}
    </span>
  )
}

function nombreDeOt(o: OtRegistrada) {
  const vehiculo = [o.codigo, o.placa ? `placa ${o.placa}` : null].filter(Boolean).join(' · ')
  return `OT ${o.numero}${vehiculo ? ` · ${vehiculo}` : ''} · ${definir(ESTADO_OT, o.estado).etiqueta}`
}

/**
 * Administración engancha a la cotización aprobada una OT de su mismo cliente
 * que se registró antes, sin cotización (migración 20261127210000): queda como
 * una de sus unidades, sin cargar otra OT para el mismo vehículo. Con varias
 * unidades libres, elige cuál es, como al cargar. El motivo va a la
 * Trazabilidad de la OT; la base vuelve a comprobarlo todo.
 */
export function EngancharOtRegistrada({
  cotizacionId,
  numero,
  ots,
  unidades,
  libres,
  facturadas,
}: {
  cotizacionId: string
  numero: string
  ots: OtRegistrada[]
  unidades: number
  libres: number[]
  /** Las unidades libres que ya tienen una factura propia (su OT se anuló después de facturarla). */
  facturadas?: { unidad: number; codigo: string }[]
}) {
  const [abierta, setAbierta] = useState(false)
  const [elegida, setElegida] = useState(ots[0]?.id ?? '')
  const [unidad, setUnidad] = useState(libres[0] ?? 1)
  const [, setHecho] = useEstadoCompartido<string | null>(ENGANCHADA, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    engancharOtACotizacion,
    (resultado) => {
      setAbierta(false)
      setHecho(resultado.mensaje ?? 'La OT quedó enganchada a su cotización.')
    },
    { documento: cotizacionId },
  )
  const idOt = useId()
  const idUnidad = useId()
  const idMotivo = useId()
  const campoOt = useRef<HTMLSelectElement>(null)
  const campoUnidad = useRef<HTMLSelectElement>(null)
  const campoMotivo = useRef<HTMLTextAreaElement>(null)
  const aviso = useRef<HTMLParagraphElement>(null)

  const ot = ots.find((o) => o.id === elegida) ?? ots[0]
  const eligeUnidad = unidades > 1 && libres.length > 1
  const cual = libres.includes(unidad) ? unidad : (libres[0] ?? 1)
  const yaFacturada = facturadas?.find((f) => f.unidad === cual) ?? null
  // El rechazo de un campo va en el campo; lo demás, en el aviso de abajo.
  const errorMotivo = error && error.startsWith('Explica por qué') ? error : null
  const errorUnidad = error && /^La unidad \d+ de la cotización|elige una de la 1|es de una sola unidad/.test(error) ? error : null
  const errorOt = error && !errorMotivo && !errorUnidad && error.startsWith('La OT ') ? error : null
  const errorGeneral = error && !errorMotivo && !errorUnidad && !errorOt ? error : null
  useCursorAlRechazo(enviando, error, () =>
    errorMotivo ? campoMotivo.current : errorUnidad ? campoUnidad.current : errorOt ? campoOt.current : aviso.current,
  )

  if (!ot) return null

  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        variante="contorno"
        data-enganchar-ot
        onClick={() => {
          limpiar()
          setHecho(null)
          setElegida(ots[0]?.id ?? '')
          setUnidad(libres[0] ?? 1)
          setAbierta(true)
        }}
      >
        <Link2 aria-hidden className="size-3.5" />
        Usar una OT ya registrada
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Usar una OT ya registrada · cotización ${numero}`}
        descripcion={
          ots.length === 1
            ? 'El cliente tiene una OT registrada antes que esta cotización. Queda como una de sus unidades, sin cargar otra OT para el mismo vehículo.'
            : `El cliente tiene ${ots.length} OT registradas antes que esta cotización. La que elijas queda como una de sus unidades, sin cargar otra OT para el mismo vehículo.`
        }
      >
        <form onSubmit={alEnviar} className="space-y-3" data-enganchar-ot-formulario>
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />
          <input type="hidden" name="orden_id" value={ot.id} />
          <input type="hidden" name="version" value={ot.version} />
          {!eligeUnidad && <input type="hidden" name="unidad" value={unidades > 1 ? String(cual) : ''} />}

          <Campo etiqueta="OT ya registrada" htmlFor={idOt} requerido error={errorOt ?? undefined}
            ayuda="Las del mismo cliente que no tienen cotización, siguen vivas y son de la misma carrocería o no la dicen.">
            <Seleccion ref={campoOt} id={idOt} value={ot.id} onChange={(e) => setElegida(e.target.value)}>
              {ots.map((o) => (
                <option key={o.id} value={o.id}>
                  {nombreDeOt(o)}
                </option>
              ))}
            </Seleccion>
          </Campo>
          {ot.descripcion && <p className="text-xs text-texto-suave">{ot.descripcion}</p>}

          {eligeUnidad ? (
            <Campo etiqueta="Qué unidad de la cotización es" htmlFor={idUnidad} requerido error={errorUnidad ?? undefined}>
              <Seleccion ref={campoUnidad} id={idUnidad} name="unidad" value={String(cual)} onChange={(e) => setUnidad(Number(e.target.value))}>
                {libres.map((k) => (
                  <option key={k} value={k}>
                    Unidad {k} de {unidades}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          ) : (
            unidades > 1 && (
              <p className="text-sm text-texto">
                Queda como la <span className="font-medium">unidad {cual} de {unidades}</span>, la única que espera su OT.
              </p>
            )
          )}
          {yaFacturada && (
            <p role="status" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-aviso">
              La unidad {yaFacturada.unidad} ya tiene una factura con el código{' '}
              <span className="font-mono whitespace-nowrap">{yaFacturada.codigo}</span>, de una OT que se anuló: esta OT se quedaría con ella.
            </p>
          )}

          <Campo etiqueta="Por qué esta OT es de esta cotización" htmlFor={idMotivo} requerido error={errorMotivo ?? undefined}
            ayuda="Queda en la Trazabilidad de la OT, con tu nombre y la hora." ayudaEnIcono={false}>
            <AreaTexto ref={campoMotivo} id={idMotivo} name="motivo" rows={2} required minLength={5} maxLength={500}
              placeholder="Por ejemplo: el taller empezó antes de que se aprobara la cotización." />
          </Campo>

          {errorGeneral && (
            <p ref={aviso} role="alert" tabIndex={-1} className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
              {errorGeneral}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Enganchar la OT {ot.numero}
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
