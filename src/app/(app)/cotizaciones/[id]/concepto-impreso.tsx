'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad as enCantidad, moneda as enMoneda } from '@/lib/format'
import type { CodigoMoneda } from '@/lib/format'

import { editarConcepto } from '../acciones'

/** Las unidades con las que la empresa cotiza un trabajo entero. */
const UNIDADES = ['UND', 'JGO', 'SERV', 'GLB', 'M', 'M2', 'M3', 'KG']

/**
 * Lo único que el cliente ve del precio: qué se le va a hacer, cuántos, en qué
 * unidad y cuánto cuesta. El desglose por partida se queda adentro, para armar
 * el presupuesto de la OT y comprar el material.
 */
export function ConceptoImpreso({
  cotizacionId,
  concepto,
  cantidad,
  unidad,
  total,
  moneda,
  sugerencia,
  editable,
}: {
  cotizacionId: string
  concepto: string | null
  cantidad: number
  unidad: string
  total: number
  moneda: CodigoMoneda
  /** Lo que sale impreso cuando nadie escribió el concepto: la carrocería. */
  sugerencia: string
  editable: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [editando, setEditando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const texto = concepto?.trim() || sugerencia
  const unitario = cantidad > 0 ? total / cantidad : total

  async function enviar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const salida = await editarConcepto(null, datos)
    setEnviando(false)

    if (!salida.ok) {
      setError(salida.error)
      return
    }

    setEditando(false)
    iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Trabajo a realizar"
        descripcion="Es la única línea que sale impresa en la cotización del cliente."
        acciones={
          editable && !editando ? (
            // En la pantalla hay tres «Editar»: el de la cabecera, el de cada
            // partida y este. El rótulo largo dice cuál es sin mirar dónde está.
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => setEditando(true)}
              aria-label="Editar el trabajo a realizar"
            >
              <Pencil aria-hidden className="size-3.5" />
              Editar
            </Boton>
          ) : null
        }
      />

      <TarjetaCuerpo className={editando ? '' : 'p-0'}>
        {editando ? (
          <form action={enviar} className="space-y-4">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />

            <Campo
              etiqueta="Descripción"
              htmlFor="concepto"
              ayuda="El nombre del trabajo tal como quieres verlo impreso. Si lo dejas vacío se imprime la carrocería."
            >
              <AreaTexto
                id="concepto"
                name="concepto"
                rows={3}
                maxLength={400}
                defaultValue={concepto ?? ''}
                placeholder={sugerencia}
              />
            </Campo>

            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Cantidad" htmlFor="concepto_cantidad" requerido>
                <Entrada
                  id="concepto_cantidad"
                  name="concepto_cantidad"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  required
                  defaultValue={cantidad}
                />
              </Campo>

              <Campo etiqueta="Unidad" htmlFor="concepto_unidad" requerido>
                <Seleccion id="concepto_unidad" name="concepto_unidad" defaultValue={unidad}>
                  {(UNIDADES.includes(unidad) ? UNIDADES : [unidad, ...UNIDADES]).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
            </div>

            {error && (
              <p role="alert" className="text-sm text-peligro">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Boton
                type="button"
                variante="secundario"
                onClick={() => {
                  setError(null)
                  setEditando(false)
                }}
              >
                Cancelar
              </Boton>
              <Boton type="submit" cargando={enviando}>
                Guardar el trabajo
              </Boton>
            </div>
          </form>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-borde bg-superficie-2">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                    Descripción
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                    Cant.
                  </th>
                  {/* En el teléfono la unidad viaja pegada a la cantidad: una
                      columna de tres letras no vale lo que le quita al texto. */}
                  <th className="hidden px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                    Und.
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                    Precio
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-3 align-top text-texto">
                    {texto}
                    {!concepto?.trim() && (
                      <p className="mt-1 text-[11px] text-texto-tenue">
                        Sale la carrocería porque nadie escribió el concepto todavía.
                      </p>
                    )}
                  </td>
                  <td className="tabular px-3 py-3 text-right align-top whitespace-nowrap text-texto">
                    {enCantidad(cantidad)}
                    <span className="ml-1 text-texto-suave sm:hidden">{unidad}</span>
                  </td>
                  <td className="hidden px-3 py-3 align-top text-texto-suave sm:table-cell">
                    {unidad}
                  </td>
                  <td className="tabular px-3 py-3 text-right align-top font-medium text-texto">
                    {enMoneda(unitario, moneda)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
