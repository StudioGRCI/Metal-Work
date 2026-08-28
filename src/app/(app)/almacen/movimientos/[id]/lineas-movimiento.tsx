'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ConfirmarAccion } from '@/components/ui/ventana'
import { cantidad, numero } from '@/lib/format'

import { agregarLineaMovimiento, eliminarLineaMovimiento } from '../../acciones'

type Linea = {
  id: string
  cantidad: number
  costo_unitario: number
  costo_total: number
  observaciones: string | null
  material: unknown
}

/** El material llega sin tipar del join; es la forma que la consulta trae. */
type MaterialDeLinea = { codigo: string; descripcion: string; unidad: { codigo: string } }

type Material = {
  id: string
  codigo: string
  descripcion: string
  costo_promedio: number
  unidad: unknown
}

export function LineasMovimiento({
  movimientoId,
  lineas,
  editable,
  materiales,
  esSalida,
  confirmado,
  totalValorizado,
}: {
  movimientoId: string
  lineas: Linea[]
  editable: boolean
  materiales: Material[]
  esSalida: boolean
  confirmado: boolean
  totalValorizado: number
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [agregando, setAgregando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [materialId, setMaterialId] = useState('')
  // La línea que se va a quitar, entera: la ventana necesita su nombre y su
  // cantidad para decir qué se pierde, no solo el id.
  const [porQuitar, setPorQuitar] = useState<Linea | null>(null)
  const [quitando, setQuitando] = useState(false)

  const elegido = materiales.find((m) => m.id === materialId)

  async function enviar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await agregarLineaMovimiento(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setMaterialId('')
      setAgregando(false)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  async function borrar(linea: Linea) {
    const datos = new FormData()
    datos.set('linea_id', linea.id)
    datos.set('movimiento_id', movimientoId)

    setQuitando(true)
    const resultado = await eliminarLineaMovimiento(null, datos)
    setQuitando(false)
    setPorQuitar(null)

    if (!resultado.ok) setError(resultado.error)
    else iniciarTransicion(() => router.refresh())
  }

  const materialPorQuitar = porQuitar ? (porQuitar.material as MaterialDeLinea) : null

  const estimado = lineas.reduce(
    (suma, l) => suma + Math.abs(Number(l.cantidad)) * Number(l.costo_unitario ?? 0),
    0,
  )

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Materiales"
        descripcion={
          confirmado
            ? 'Valorizados al costo promedio ponderado del almacén en el momento de confirmar.'
            : 'Los materiales del documento. Se pueden editar mientras esté en borrador.'
        }
        acciones={
          editable && !agregando ? (
            <Boton variante="secundario" tamano="sm" onClick={() => setAgregando(true)}>
              <Plus aria-hidden className="size-3.5" />
              Agregar material
            </Boton>
          ) : null
        }
      />

      <TarjetaCuerpo className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-borde bg-superficie-2">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Material
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Cantidad
                </th>
                {/* En el teléfono el costo unitario cede su columna y baja debajo
                    del importe: lo que se mira de pie es cuánto salió, no a cómo. */}
                <th className="hidden px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Costo unitario
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Importe
                </th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 ? (
                <tr>
                  <td colSpan={editable ? 5 : 4} className="px-3 py-10 text-center text-sm">
                    <p className="text-texto-suave">Este documento aún no tiene materiales.</p>
                    {editable && (
                      <>
                        <p className="mt-1 text-xs text-texto-tenue">
                          Sin al menos uno no se puede confirmar y el kardex no se entera.
                        </p>
                        {!agregando && (
                          <div className="mt-4 flex justify-center">
                            <Boton
                              variante="secundario"
                              tamano="sm"
                              onClick={() => setAgregando(true)}
                            >
                              <Plus aria-hidden className="size-3.5" />
                              Agregar material
                            </Boton>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ) : (
                lineas.map((l) => {
                  const material = l.material as MaterialDeLinea
                  const importe = confirmado
                    ? Number(l.costo_total ?? 0)
                    : Math.abs(Number(l.cantidad)) * Number(l.costo_unitario ?? 0)

                  return (
                    <tr key={l.id} className="border-b border-borde last:border-0">
                      <td className="px-3 py-2">
                        <p className="text-texto">{material.descripcion}</p>
                        <p className="font-mono text-[11px] text-texto-suave">{material.codigo}</p>
                        {l.observaciones && (
                          <p className="text-[11px] text-texto-suave">{l.observaciones}</p>
                        )}
                      </td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {cantidad(l.cantidad)}
                        <span className="ml-1 text-[11px] text-texto-tenue">
                          {material.unidad.codigo}
                        </span>
                      </td>
                      <td className="tabular hidden px-3 py-2 text-right text-texto-suave sm:table-cell">
                        {numero(l.costo_unitario)}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium">
                        {numero(importe)}
                        <span className="block text-[11px] font-normal text-texto-tenue sm:hidden">
                          {numero(l.costo_unitario)} c/u
                        </span>
                      </td>
                      {editable && (
                        <td className="px-3 py-2">
                          {/* 44 px de blanco en el teléfono: quitar una línea con
                              el dedo no puede depender de acertarle a un icono de
                              16 px. En `sm:` vuelve al tamaño de siempre. */}
                          <button
                            type="button"
                            onClick={() => setPorQuitar(l)}
                            aria-label={`Eliminar ${material.descripcion}`}
                            className="inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] text-texto-tenue hover:text-peligro sm:size-9"
                          >
                            <Trash2 aria-hidden className="size-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })
              )}
            </tbody>
            {lineas.length > 0 && (
              <tfoot>
                <tr className="border-t border-borde bg-superficie-2">
                  {/* El rótulo del total abarca las columnas que quedan a la
                      vista, y en el teléfono son una menos. */}
                  <td colSpan={2} className="px-3 py-2 text-right text-xs text-texto-suave sm:hidden">
                    {confirmado ? 'Total valorizado' : 'Importe estimado'}
                  </td>
                  <td
                    colSpan={3}
                    className="hidden px-3 py-2 text-right text-xs text-texto-suave sm:table-cell"
                  >
                    {confirmado ? 'Total valorizado' : 'Importe estimado'}
                  </td>
                  <td className="tabular px-3 py-2 text-right font-semibold">
                    {numero(confirmado ? totalValorizado : estimado)}
                  </td>
                  {editable && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {error && (
          <p role="alert" className="border-t border-borde bg-peligro-suave px-3 py-2 text-xs text-peligro">
            {error}
          </p>
        )}

        {agregando && (
          <form action={enviar} className="grid gap-3 border-t border-borde p-4 sm:grid-cols-6">
            <input type="hidden" name="movimiento_id" value={movimientoId} />

            <Campo etiqueta="Material" htmlFor="material_id" requerido className="sm:col-span-3">
              <SeleccionBuscable
                id="material_id"
                name="material_id"
                requerido
                valor={materialId}
                onChange={setMaterialId}
                marcador="Selecciona el material"
                marcadorBusqueda="Código o descripción"
                opciones={materiales.map((m) => ({
                  valor: m.id,
                  etiqueta: m.descripcion,
                  detalle: m.codigo,
                }))}
              />
            </Campo>

            <Campo
              etiqueta="Cantidad"
              htmlFor="cantidad"
              requerido
              ayuda={
                elegido
                  ? `En ${(elegido.unidad as { codigo: string }).codigo}`
                  : undefined
              }
            >
              <Entrada
                id="cantidad"
                name="cantidad"
                type="number"
                step="0.0001"
                required
                // El teléfono abre el teclado numérico con separador decimal; con
                // el de letras hay que ir a buscar la coma y se escribe cualquier
                // cosa con el guante puesto.
                inputMode="decimal"
                className="tabular text-right"
              />
            </Campo>

            <Campo
              etiqueta="Costo unitario"
              htmlFor="costo_unitario"
              className="sm:col-span-2"
              ayuda={
                esSalida
                  ? 'Se ignora: manda el promedio del almacén'
                  : elegido
                    ? `Promedio actual ${numero(elegido.costo_promedio)}`
                    : undefined
              }
            >
              <Entrada
                id="costo_unitario"
                name="costo_unitario"
                type="number"
                step="0.01"
                min={0}
                disabled={esSalida}
                defaultValue={0}
                inputMode="decimal"
                className="tabular text-right"
              />
            </Campo>

            <div className="flex justify-end gap-2 sm:col-span-6">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAgregando(false)}>
                Cancelar
              </Boton>
              {/* «Agregar» a secas no dice qué: en esta misma pantalla también se
                  confirma el movimiento y se anula. */}
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar material
              </Boton>
            </div>
          </form>
        )}

        {/* Quitar una línea no se deshace y volver a ponerla es buscar otra vez
            el material en la lista y reescribir cantidad y costo. Por eso se
            pregunta, y la pregunta dice cuál se va con su cantidad: en un
            movimiento de diez materiales, «¿estás seguro?» no distingue nada. */}
        <ConfirmarAccion
          abierta={porQuitar !== null}
          alCerrar={() => setPorQuitar(null)}
          alConfirmar={() => {
            if (porQuitar) borrar(porQuitar)
          }}
          titulo="¿Quitar el material?"
          detalle={
            porQuitar && materialPorQuitar
              ? `Se va «${materialPorQuitar.descripcion}» con sus ${cantidad(porQuitar.cantidad)} ${
                  materialPorQuitar.unidad.codigo
                }. Habrá que buscarlo de nuevo en la lista y volver a escribir la cantidad.`
              : ''
          }
          trabajando={quitando}
        />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
