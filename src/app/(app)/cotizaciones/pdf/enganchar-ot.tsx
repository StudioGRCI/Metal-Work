'use client'

import { Link2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { yaEntroLaPrimeraVez } from '@/lib/acciones'
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

// Lo que entró, y en qué cotización. Lo dicen el encabezado y la tarjeta: si la
// cotización queda con todas sus OT, su tarjeta ya no pinta este botón y el
// aviso se iría con él; y en el teléfono el encabezado queda fuera de la vista
// (auditoría de diseño).
const ENGANCHADA = 'enganchar-ot:hecho'
type Enganche = { cotizacionId: string; mensaje: string; vez: number }

/** Junto a los estados del encabezado: la OT que se acaba de enganchar. */
export function EstadoDelEnganche() {
  const [hecho] = useEstadoCompartido<Enganche | null>(ENGANCHADA, null)
  return (
    <span role="status" className={hecho ? 'text-xs font-medium text-exito sm:text-right' : 'sr-only'}>
      {hecho?.mensaje}
    </span>
  )
}

/**
 * En la tarjeta, siempre montado (una región que nace con su texto no se
 * anuncia): lo que se acaba de enganchar a esta cotización. Al entrar, el
 * cursor viene aquí: el botón que abrió la ventana puede no estar ya, y caía a
 * la página con el aviso fuera de la vista.
 */
export function EngancheEnLaTarjeta({ cotizacionId }: { cotizacionId: string }) {
  const [hecho] = useEstadoCompartido<Enganche | null>(ENGANCHADA, null)
  const aqui = hecho?.cotizacionId === cotizacionId ? hecho : null
  const caja = useRef<HTMLParagraphElement>(null)
  const vez = aqui?.vez
  useEffect(() => {
    if (!vez) return
    // Después de que la ventana devuelva el cursor al cerrarse.
    const cuadro = requestAnimationFrame(() => {
      caja.current?.scrollIntoView({ block: 'center' })
      caja.current?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(cuadro)
  }, [vez])
  return (
    <p
      ref={caja}
      role="status"
      tabIndex={-1}
      data-enganche-en-la-tarjeta={aqui ? '' : undefined}
      className={aqui ? 'rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-xs font-medium text-exito' : 'sr-only'}
    >
      {aqui?.mensaje}
    </p>
  )
}

/**
 * Sobre los botones de la tarjeta: el cliente ya tiene una OT registrada sin
 * cotización. Sin esto, quien entra por costumbre carga otra OT para el mismo
 * vehículo, que es lo que el enganche quiere evitar.
 */
export function AvisoDeOtRegistrada({ ots }: { ots: OtRegistrada[] }) {
  if (ots.length === 0) return null
  const numeros = ots.map((o) => o.numero)
  const lista = numeros.length === 1 ? numeros[0] : `${numeros.slice(0, -1).join(', ')} y ${numeros[numeros.length - 1]}`
  return (
    <p className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-texto" data-aviso-ot-registrada>
      {ots.length === 1
        ? <>El cliente tiene la OT <span className="font-medium whitespace-nowrap">{lista}</span> registrada sin cotización: si es de esta venta, úsala en vez de cargar otra.</>
        : <>El cliente tiene las OT <span className="font-medium">{lista}</span> registradas sin cotización: si alguna es de esta venta, úsala en vez de cargar otra.</>}
    </p>
  )
}

function nombreDeOt(o: OtRegistrada) {
  return `OT ${o.numero}${o.placa ? ` · placa ${o.placa}` : ''}`
}

/**
 * Administración engancha a la cotización aprobada una OT de su mismo cliente
 * que se registró antes, sin cotización (migración 20261127210000): queda como
 * una de sus unidades, sin cargar otra OT para el mismo vehículo. Con varias
 * unidades libres, elige cuál es, como al cargar. El motivo va a la
 * Trazabilidad de la OT; la base vuelve a comprobarlo todo.
 *
 * Mientras envía, la ventana no se cierra (`corrige`): cerrada en vuelo, el
 * rechazo no se decía en ningún lado y la persona no sabía si había quedado.
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
  // Lo que la ventana ofrecía al abrirse. La pantalla se pone al día con la
  // ventana abierta (tras un envío sin respuesta), y la OT o la unidad elegidas
  // pueden dejar de estar: la ventana no cae sola a otra OT ni a otra unidad,
  // que el segundo toque engancharía para siempre (P0 de funcionamiento).
  const [alAbrir, setAlAbrir] = useState({ ots, libres })
  const [elegida, setElegida] = useState(ots[0]?.id ?? '')
  const [unidad, setUnidad] = useState(libres[0] ?? 1)
  const [, setHecho] = useEstadoCompartido<Enganche | null>(ENGANCHADA, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    engancharOtACotizacion,
    (resultado) => {
      setAbierta(false)
      setHecho({ cotizacionId, mensaje: resultado.mensaje ?? 'La OT quedó enganchada a su cotización.', vez: Date.now() })
    },
    { documento: cotizacionId, corrige: true },
  )
  const idOt = useId()
  const idFicha = useId()
  const idUnidad = useId()
  const idMotivo = useId()
  const idFacturada = useId()
  const campoOt = useRef<HTMLSelectElement>(null)
  const campoUnidad = useRef<HTMLSelectElement>(null)
  const campoMotivo = useRef<HTMLTextAreaElement>(null)

  const ot = alAbrir.ots.find((o) => o.id === elegida) ?? alAbrir.ots[0]
  const eligeUnidad = unidades > 1 && alAbrir.libres.length > 1
  const cual = unidad
  // Ya no se ofrece: la tomó el envío anterior u otra persona.
  const otYaNo = abierta && ot && !ots.some((o) => o.id === ot.id)
  const unidadYaNo = abierta && unidades > 1 && !libres.includes(cual)
  const yaFacturada = facturadas?.find((f) => f.unidad === cual) ?? null
  // El rechazo de un campo va en el campo; lo demás, en el pie. Sin la lista de
  // unidades en la ventana, el de la unidad también va al pie.
  const errorMotivo = error && error.startsWith('Explica por qué') ? error : null
  const errorUnidad =
    error && eligeUnidad && /^La unidad \d+ de la cotización|elige una de la 1|es de una sola unidad/.test(error) ? error : null
  // Lo que ya había entrado con el primer envío no es de un campo: lo dice el pie, sin rojo.
  const errorOt = error && !errorMotivo && !errorUnidad && !yaEntroLaPrimeraVez(error) && error.startsWith('La OT ') ? error : null
  const errorGeneral = error && !errorMotivo && !errorUnidad && !errorOt ? error : null
  // El del pie lo lleva `PieDeVentana`; los de campo, aquí.
  useCursorAlRechazo(enviando, errorMotivo || errorUnidad || errorOt, () =>
    errorMotivo ? campoMotivo.current : errorUnidad ? campoUnidad.current : campoOt.current,
  )

  if (!ot) return null
  const estado = definir(ESTADO_OT, ot.estado)

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
          setAlAbrir({ ots, libres })
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

          <fieldset disabled={enviando} className="min-w-0 space-y-3">
            <Campo etiqueta="OT ya registrada" htmlFor={idOt} requerido error={errorOt ?? undefined}
              ayuda="Las del mismo cliente que no tienen cotización, siguen vivas y son de la misma carrocería o no la dicen.">
              <Seleccion ref={campoOt} id={idOt} value={ot.id} onChange={(e) => setElegida(e.target.value)} aria-describedby={idFicha}>
                {alAbrir.ots.map((o) => (
                  <option key={o.id} value={o.id}>
                    {nombreDeOt(o)}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            {/* La OT elegida entera: en el teléfono la lista cerrada cortaba el código y el estado. */}
            <div id={idFicha} className="space-y-1 rounded-[var(--radius-base)] border border-borde px-3 py-2" data-ficha-ot>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-texto">OT {ot.numero}</span>
                <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
              </p>
              {(ot.codigo || ot.placa) && (
                <p className="text-xs text-texto-suave">
                  {ot.codigo && <span className="font-mono whitespace-nowrap">{ot.codigo}</span>}
                  {ot.codigo && ot.placa && ' · '}
                  {ot.placa && <span className="whitespace-nowrap">placa {ot.placa}</span>}
                </p>
              )}
              {ot.descripcion && <p className="text-xs text-texto-suave">{ot.descripcion}</p>}
              {ot.estado !== 'APROBADA' && (
                <p className="text-xs text-texto" data-ya-empezo>
                  El taller ya la empezó: desde el enganche, las listas muestran el avance de su código interno, como toda OT de una cotización.
                </p>
              )}
            </div>

            {eligeUnidad ? (
              <Campo etiqueta="Qué unidad de la cotización es" htmlFor={idUnidad} requerido error={errorUnidad ?? undefined}>
                <Seleccion ref={campoUnidad} id={idUnidad} name="unidad" value={String(cual)} onChange={(e) => setUnidad(Number(e.target.value))}
                  aria-describedby={yaFacturada ? idFacturada : undefined}>
                  {alAbrir.libres.map((k) => (
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
            {/* Siempre montado: el aviso que nace con su texto al cambiar de unidad no se anuncia. */}
            <p
              id={idFacturada}
              role="status"
              className={yaFacturada ? 'rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-aviso' : 'sr-only'}
            >
              {yaFacturada && (
                <>
                  La unidad {yaFacturada.unidad} ya tiene una factura con el código{' '}
                  <span className="font-mono whitespace-nowrap">{yaFacturada.codigo}</span>, de una OT que se anuló: esta OT se quedaría con ella.
                </>
              )}
            </p>

            <Campo etiqueta="Por qué esta OT es de esta cotización" htmlFor={idMotivo} requerido error={errorMotivo ?? undefined}
              ayuda="Queda en la Trazabilidad de la OT, con tu nombre y la hora." ayudaEnIcono={false}>
              <AreaTexto ref={campoMotivo} id={idMotivo} name="motivo" rows={2} required minLength={5} maxLength={500}
                placeholder="Por ejemplo: el taller empezó antes de que se aprobara la cotización." />
            </Campo>
          </fieldset>

          {(otYaNo || unidadYaNo) && !enviando && (
            <p role="status" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-texto" data-enganche-ya-no>
              {otYaNo
                ? `La OT ${ot.numero} ya no se ofrece para esta cotización: puede que haya quedado con el envío anterior. Cierra la ventana y mira la tarjeta antes de volver a intentar.`
                : `La unidad ${cual} ya no está libre: puede que la haya tomado el envío anterior u otra persona. Cierra la ventana y mira la tarjeta antes de volver a intentar.`}
            </p>
          )}
          <PieDeVentana
            error={errorGeneral}
            enviando={enviando}
            alCancelar={() => setAbierta(false)}
            texto={otYaNo || unidadYaNo ? undefined : `Enganchar la OT ${ot.numero}`}
          />
        </form>
      </Ventana>
    </>
  )
}
