'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { AlertTriangle, Lock, Pencil, Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ConfirmarAccion } from '@/components/ui/ventana'
import { ESTADO_COTIZACION, TIPO_COSTO, definir } from '@/lib/dominio/estados'
import { cantidad, moneda, numero, porcentaje } from '@/lib/format'
import type { CodigoMoneda } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Tablas } from '@/types/database'

import { agregarPartida, editarPartida, eliminarPartida } from '../acciones'

type Partida = Tablas<'cotizacion_partidas'>

const UNIDADES = ['UND', 'JGO', 'PZA', 'KG', 'M', 'M2', 'M3', 'L', 'GAL', 'GLB', 'SERV']

export function Partidas({
  cotizacionId,
  partidas,
  moneda: mon,
  editable,
  precioVenta = 0,
  estado,
}: {
  cotizacionId: string
  partidas: Partida[]
  moneda: CodigoMoneda
  /**
   * Si esta mano puede armar la cotización de trabajo ahora. La calcula la
   * página cruzando el estado con el permiso `cotizaciones.costear`; acá no se
   * vuelve a calcular, porque dos cuentas distintas terminan discrepando y la
   * pantalla ofrecería botones que la base rechaza.
   */
  editable: boolean
  /**
   * Lo que Ventas le ofreció al cliente (`precio_venta`). Va opcional a
   * propósito: quien la pinta es la página, y mientras no llegue, la cabecera
   * muestra el costo solo, sin inventar una comparación contra cero.
   */
  precioVenta?: number
  /** Para contar por qué no se puede tocar cuando `editable` viene en falso. */
  estado?: string
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [agregando, setAgregando] = useState(false)
  const [editando, setEditando] = useState<Partida | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // La partida que se pidió quitar, esperando la confirmación. Se guarda la
  // fila entera y no el id: la pregunta tiene que nombrar lo que se va.
  const [porQuitar, setPorQuitar] = useState<Partida | null>(null)
  const [quitando, setQuitando] = useState(false)

  // El costo sale de las partidas que se están viendo y no de un campo aparte:
  // así la cifra de la cabecera y las filas de abajo no pueden discrepar.
  const costo = partidas.reduce((suma, p) => suma + Number(p.subtotal ?? 0), 0)
  const hayPrecio = precioVenta > 0
  const margen = precioVenta - costo
  // Sin partidas no hay margen que enseñar: el precio entero saldría como
  // ganancia del 100 %, que es exactamente lo contrario de lo que pasa.
  const hayMargen = hayPrecio && partidas.length > 0
  const seExcede = hayMargen && margen < 0

  async function enviar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await agregarPartida(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setAgregando(false)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  async function guardarEdicion(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await editarPartida(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setEditando(null)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  async function borrar(partida: Partida) {
    const datos = new FormData()
    datos.set('partida_id', partida.id)
    datos.set('cotizacion_id', cotizacionId)

    setError(null)
    setQuitando(true)
    const resultado = await eliminarPartida(null, datos)
    setQuitando(false)
    setPorQuitar(null)

    if (!resultado.ok) setError(resultado.error)
    else iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Partidas de la cotización de trabajo"
        descripcion="El costo del trabajo partida por partida: con esto Administración compra el material y programa el taller. No sale impreso en el papel del cliente."
        acciones={
          editable && !agregando && !editando ? (
            <Boton variante="secundario" tamano="sm" onClick={() => setAgregando(true)}>
              <Plus aria-hidden className="size-3.5" />
              Agregar partida
            </Boton>
          ) : null
        }
      />

      <TarjetaCuerpo className="p-0">
        {/* Lo que le dice a Administración si el trabajo cabe en el precio: lo
            que suman las partidas contra lo que Ventas ofreció. Es la primera
            pregunta de Gerencia cuando la cotización sube a revisión. */}
        {(hayPrecio || partidas.length > 0) && (
          <div
            className={cn(
              'flex flex-wrap items-end gap-x-8 gap-y-3 border-b border-borde px-3 py-3',
              seExcede && 'bg-aviso-suave',
            )}
          >
            <Cifra titulo="Costo de las partidas" valor={moneda(costo, mon)} avisa={seExcede} />
            {hayPrecio && (
              <Cifra titulo="Precio ofrecido al cliente" valor={moneda(precioVenta, mon)} />
            )}
            {hayMargen && (
              <Cifra
                titulo={seExcede ? 'Se pasa por' : 'Margen'}
                valor={moneda(Math.abs(margen), mon)}
                pie={porcentaje((Math.abs(margen) / precioVenta) * 100, 1)}
                avisa={seExcede}
              />
            )}
            {seExcede && (
              <p className="flex w-full items-start gap-1.5 text-xs text-aviso">
                <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
                El trabajo cuesta más de lo que se le ofreció al cliente. Antes de subirla a
                Gerencia hay que recortar el alcance o pedirle a Ventas que corrija el precio.
              </p>
            )}
          </div>
        )}

        {/* Sin esto la tarjeta se quedaba muda: ni botones ni explicación, y
            quien miraba no sabía si le faltaba el permiso o le faltaba el turno. */}
        {!editable && (
          <CosteoCerrado estado={estado} que="Las partidas" className="border-b border-borde" />
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-borde bg-superficie-2">
              <tr>
                <th className="w-8 px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  #
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Descripción
                </th>
                {/* En el teléfono estas cuatro se esconden: su contenido baja a
                    una línea chica bajo la descripción, que es la celda que
                    siempre está. Sin eso, la tabla se va de lado y el subtotal
                    -lo que se viene a mirar- queda fuera de la pantalla. */}
                <th className="hidden px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Tipo
                </th>
                <th className="hidden px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Cantidad
                </th>
                <th className="hidden px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Costo unit.
                </th>
                <th className="hidden px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Dcto.
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Subtotal
                </th>
                {editable && <th className="w-20" />}
              </tr>
            </thead>
            <tbody>
              {partidas.length === 0 ? (
                <tr>
                  <td colSpan={editable ? 8 : 7} className="px-3 py-10 text-center">
                    <p className="text-sm font-medium text-texto">
                      Esta cotización de trabajo todavía no tiene partidas
                    </p>
                    <p className="mt-1 text-xs text-texto-suave">
                      {editable
                        ? 'Sin al menos una no se sabe qué material comprar ni cuánto cuesta el trabajo, y el papel del cliente no se puede descargar.'
                        : 'Las arma Administración mientras la cotización está en costeo.'}
                    </p>
                    {editable && !agregando && (
                      <div className="mt-4 flex justify-center">
                        <Boton tamano="sm" onClick={() => setAgregando(true)}>
                          <Plus aria-hidden className="size-3.5" />
                          Agregar la primera partida
                        </Boton>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                partidas.map((p, i) => {
                  const tipo = definir(TIPO_COSTO, p.tipo_costo)
                  const enEdicion = editando?.id === p.id
                  const dcto = Number(p.descuento_porcentaje ?? 0)

                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-borde last:border-0 ${enEdicion ? 'bg-acento-suave' : ''}`}
                    >
                      <td className="tabular px-3 py-2 text-texto-tenue">{i + 1}</td>
                      <td className="px-3 py-2">
                        <p className="text-texto">{p.descripcion}</p>
                        {p.detalle && (
                          <p className="text-[11px] whitespace-pre-wrap text-texto-suave">
                            {p.detalle}
                          </p>
                        )}
                        <p className="tabular mt-0.5 text-[11px] text-texto-suave sm:hidden">
                          {tipo.etiqueta} · {cantidad(p.cantidad)} {p.unidad_medida} ×{' '}
                          {numero(p.precio_unitario)}
                          {dcto > 0 && ` · −${numero(dcto, 0)}%`}
                        </p>
                      </td>
                      <td className="hidden px-3 py-2 sm:table-cell">
                        <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
                      </td>
                      <td className="tabular hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell">
                        {cantidad(p.cantidad)}
                        <span className="ml-1 text-[11px] text-texto-tenue">{p.unidad_medida}</span>
                      </td>
                      <td className="tabular hidden px-3 py-2 text-right sm:table-cell">
                        {numero(p.precio_unitario)}
                      </td>
                      <td className="tabular hidden px-3 py-2 text-right text-texto-suave sm:table-cell">
                        {dcto > 0 ? `${numero(dcto, 0)}%` : '—'}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium">
                        {moneda(p.subtotal, mon)}
                      </td>
                      {editable && (
                        <td className="px-3 py-2">
                          {/* El relleno del teléfono deja el icono en 44 px de
                              lado, que es lo que ocupa un dedo con guante; en
                              `sm:` vuelve a ser el icono pelado de siempre. */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setError(null)
                                setAgregando(false)
                                setEditando(p)
                              }}
                              aria-label={`Editar partida ${p.descripcion}`}
                              className="rounded-[var(--radius-base)] p-3.5 text-texto-tenue hover:text-acento sm:p-0"
                            >
                              <Pencil aria-hidden className="size-4" />
                            </button>
                            {/* La papelera ya no borra: pregunta. Con el icono
                                agrandado para el guante también se acierta sin
                                querer, y la partida no se recupera. */}
                            <button
                              type="button"
                              onClick={() => {
                                setError(null)
                                setPorQuitar(p)
                              }}
                              aria-label={`Eliminar partida ${p.descripcion}`}
                              className="rounded-[var(--radius-base)] p-3.5 text-texto-tenue hover:text-peligro sm:p-0"
                            >
                              <Trash2 aria-hidden className="size-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {error && (
          <p
            role="alert"
            className="border-t border-borde bg-peligro-suave px-3 py-2 text-xs text-peligro"
          >
            {error}
          </p>
        )}

        {agregando && (
          <form action={enviar} className="grid gap-3 border-t border-borde p-4 sm:grid-cols-6">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />
            <CamposPartida />

            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                onClick={() => setAgregando(false)}
              >
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar partida
              </Boton>
            </div>
          </form>
        )}

        {editando && (
          <form
            key={editando.id}
            action={guardarEdicion}
            className="grid gap-3 border-t border-borde bg-superficie-2 p-4 sm:grid-cols-6"
          >
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />
            <input type="hidden" name="partida_id" value={editando.id} />

            <p className="text-xs text-texto-suave sm:col-span-6">
              Corrigiendo la partida <strong className="text-texto">{editando.descripcion}</strong>.
              El costo de la cotización de trabajo se recalcula solo.
            </p>

            <CamposPartida partida={editando} />

            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <Boton
                type="button"
                variante="fantasma"
                tamano="sm"
                onClick={() => setEditando(null)}
              >
                Cancelar
              </Boton>
              {/* En esta pantalla se guardan tres cosas distintas —el trabajo,
                  las medidas y la partida—: el botón dice cuál es la suya. */}
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Guardar la partida
              </Boton>
            </div>
          </form>
        )}

        {/* Va dentro de la condición: la pregunta nombra la partida que se
            pidió quitar, y sin ella no hay nada que nombrar. */}
        {porQuitar && (
          <ConfirmarAccion
            abierta
            alCerrar={() => setPorQuitar(null)}
            alConfirmar={() => borrar(porQuitar)}
            titulo="¿Quitar la partida?"
            detalle={`Se va «${porQuitar.descripcion}»: ${cantidad(porQuitar.cantidad)} ${porQuitar.unidad_medida} por ${moneda(porQuitar.subtotal, mon)}. Habrá que volver a escribirla entera, y el costo de la cotización de trabajo se recalcula sin ella.`}
            etiquetaConfirmar="Sí, quitar la partida"
            trabajando={quitando}
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * Una cifra de la cabecera con su rótulo. El tono de aviso lo enciende quien
 * llama; acá el único caso es el costo que se pasó del precio ofrecido.
 */
function Cifra({
  titulo,
  valor,
  pie,
  avisa,
}: {
  titulo: string
  valor: string
  pie?: string
  avisa?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
      <p className={cn('tabular text-base font-semibold', avisa ? 'text-aviso' : 'text-texto')}>
        {valor}
        {pie && <span className="ml-1.5 text-xs font-normal text-texto-suave">{pie}</span>}
      </p>
    </div>
  )
}

/**
 * Por qué la cotización de trabajo no se deja tocar ahora y qué habría que
 * hacer para poder tocarla.
 *
 * Las mismas puertas las defiende la base —el costeo se arma entre EN_COSTEO y
 * OBSERVADA, y desde REVISADA queda congelado—, así que la pantalla las cuenta
 * en vez de ofrecer botones que iban a fallar. La comparten las dos tarjetas
 * del costeo, partidas y ficha: `que` nombra lo que está cerrado en cada una.
 */
export function CosteoCerrado({
  estado,
  que,
  className,
}: {
  estado?: string
  que: string
  className?: string
}) {
  const motivo = motivoDelBloqueo(estado, que)
  const pintado = definir(ESTADO_COTIZACION, estado)

  return (
    <div className={cn('flex items-start gap-3 px-4 py-3', className)}>
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-tenue" />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-texto">
          {motivo.titulo}
          {estado && <Insignia tono={pintado.tono}>{pintado.etiqueta}</Insignia>}
        </p>
        <p className="mt-1 text-xs text-texto-suave">{motivo.detalle}</p>
      </div>
    </div>
  )
}

/**
 * El motivo redactado, por estado. Sin estado a la vista se responde lo único
 * que es cierto siempre —la regla del circuito—: nunca se adivina en cuál está,
 * porque adivinar mal manda a la gente a pedirle el paso a quien no es.
 */
function motivoDelBloqueo(estado: string | undefined, que: string) {
  if (!estado) {
    return {
      titulo: 'Ahora no se puede tocar',
      detalle: `${que} se arman mientras la cotización está en costeo, y ese trabajo es de Administración.`,
    }
  }

  switch (estado) {
    case 'BORRADOR':
      return {
        titulo: 'Todavía no llegó a costeo',
        detalle: `Ventas sigue escribiendo la cotización: el cliente, la unidad y el precio. ${que} se arman cuando la manden a costear, y recién ahí Administración escribe acá.`,
      }
    case 'EN_COSTEO':
    case 'OBSERVADA':
      return {
        titulo: 'Esto lo arma Administración',
        detalle: `La cotización está en costeo. ${que} se escriben en esta pantalla, y ese trabajo es de Administración —la misma área que después emite la orden de trabajo—.`,
      }
    case 'EN_REVISION':
      return {
        titulo: 'Está con Gerencia, esperando el visto',
        detalle:
          'Mientras la revisan no se toca nada. Si hay algo que corregir, Gerencia la devuelve con la observación escrita y vuelve a costeo.',
      }
    case 'ANULADA':
      return {
        titulo: 'La cotización está anulada',
        detalle: 'Queda con su motivo, como evidencia: no se toca ni se borra.',
      }
    default:
      return {
        titulo: 'Ya pasó de la revisión',
        detalle: `Con el visto puesto, ${que} quedan tal como se revisaron: es lo que se le ofreció al cliente. Para cambiar algo hay que devolver la cotización a costeo, y eso lo hace Gerencia.`,
      }
  }
}

/**
 * Los campos de una partida. Los mismos para agregarla y para corregirla: si se
 * escriben dos veces, un día se agrega un campo en un formulario y no en el
 * otro, y la partida corregida pierde lo que la nueva sí guarda.
 */
function CamposPartida({ partida }: { partida?: Partida }) {
  const unidad = partida?.unidad_medida ?? 'UND'
  const unidades = UNIDADES.includes(unidad) ? UNIDADES : [unidad, ...UNIDADES]
  // Los identificadores llevan prefijo propio porque en esta misma pantalla la
  // ficha técnica también tiene campos «detalle», «cantidad» y «descripción»:
  // con el id repetido, tocar la etiqueta llevaba el foco al campo de la otra
  // tarjeta —y en el teléfono la etiqueta es medio blanco de dedo—.
  const id = useId()

  return (
    <>
      <Campo etiqueta="Descripción" htmlFor={`${id}-descripcion`} requerido className="sm:col-span-4">
        <Entrada
          id={`${id}-descripcion`}
          name="descripcion"
          required
          autoFocus
          autoComplete="off"
          defaultValue={partida?.descripcion ?? ''}
          placeholder="Fabricación de tolva de volquete 18 m3 en acero A36"
        />
      </Campo>

      <Campo etiqueta="Tipo de costo" htmlFor={`${id}-tipo_costo`} className="sm:col-span-2">
        <Seleccion
          id={`${id}-tipo_costo`}
          name="tipo_costo"
          defaultValue={partida?.tipo_costo ?? 'MATERIAL'}
        >
          <option value="MATERIAL">Materiales</option>
          <option value="MANO_OBRA">Mano de obra</option>
          <option value="SERVICIO">Servicio</option>
          <option value="OTRO">Otro</option>
        </Seleccion>
      </Campo>

      <Campo etiqueta="Detalle" htmlFor={`${id}-detalle`} className="sm:col-span-6">
        <AreaTexto
          id={`${id}-detalle`}
          name="detalle"
          rows={2}
          defaultValue={partida?.detalle ?? ''}
          placeholder="Medidas, espesores y todo lo que precise el alcance de esta partida"
        />
      </Campo>

      <Campo etiqueta="Unidad" htmlFor={`${id}-unidad_medida`}>
        <Seleccion id={`${id}-unidad_medida`} name="unidad_medida" defaultValue={unidad}>
          {unidades.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Seleccion>
      </Campo>

      {/* Cantidad, costo y descuento llevan decimales: `inputMode` saca el
          teclado con la coma en el teléfono en vez del alfabético. */}
      <Campo etiqueta="Cantidad" htmlFor={`${id}-cantidad`} requerido>
        <Entrada
          id={`${id}-cantidad`}
          name="cantidad"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          required
          defaultValue={partida ? Number(partida.cantidad) : 1}
          className="tabular text-right"
        />
      </Campo>

      {/* El campo de la base sigue llamándose `precio_unitario`; el rótulo dice
          «costo» porque acá se anota lo que cuesta hacerlo, no lo que se cobra:
          lo que se cobra es el precio de Ventas, que se compara arriba. */}
      <Campo etiqueta="Costo unitario" htmlFor={`${id}-precio_unitario`} requerido>
        <Entrada
          id={`${id}-precio_unitario`}
          name="precio_unitario"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          required
          defaultValue={partida ? Number(partida.precio_unitario) : undefined}
          className="tabular text-right"
        />
      </Campo>

      <Campo etiqueta="Descuento %" htmlFor={`${id}-descuento_porcentaje`}>
        <Entrada
          id={`${id}-descuento_porcentaje`}
          name="descuento_porcentaje"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          max={100}
          defaultValue={partida ? Number(partida.descuento_porcentaje ?? 0) : 0}
          className="tabular text-right"
        />
      </Campo>
    </>
  )
}
