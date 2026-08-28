'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ConfirmarAccion } from '@/components/ui/ventana'
import { TIPO_COSTO, definir } from '@/lib/dominio/estados'
import { cantidad, moneda, numero } from '@/lib/format'
import type { CodigoMoneda } from '@/lib/format'
import type { Tablas } from '@/types/database'

import { agregarPartida, editarPartida, eliminarPartida } from '../acciones'

type Partida = Tablas<'cotizacion_partidas'>

const UNIDADES = ['UND', 'JGO', 'PZA', 'KG', 'M', 'M2', 'M3', 'L', 'GAL', 'GLB', 'SERV']

export function Partidas({
  cotizacionId,
  partidas,
  moneda: mon,
  editable,
}: {
  cotizacionId: string
  partidas: Partida[]
  moneda: CodigoMoneda
  editable: boolean
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
        titulo="Partidas"
        descripcion="El alcance con el que se compra y se programa el trabajo. No sale impreso en la cotización del cliente."
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
                  P. unitario
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
                      Esta cotización todavía no tiene partidas
                    </p>
                    <p className="mt-1 text-xs text-texto-suave">
                      {editable
                        ? 'Sin al menos una no se puede abrir la orden de trabajo ni emitir el papel.'
                        : 'Las agrega quien la está elaborando, mientras siga abierta.'}
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
              Los totales de la cotización se recalculan solos.
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
            detalle={`Se va «${porQuitar.descripcion}»: ${cantidad(porQuitar.cantidad)} ${porQuitar.unidad_medida} por ${moneda(porQuitar.subtotal, mon)}. Habrá que volver a escribirla entera, y el total de la cotización se recalcula sin ella.`}
            etiquetaConfirmar="Sí, quitar la partida"
            trabajando={quitando}
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
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

      {/* Cantidad, precio y descuento llevan decimales: `inputMode` saca el
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

      <Campo etiqueta="Precio unitario" htmlFor={`${id}-precio_unitario`} requerido>
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
