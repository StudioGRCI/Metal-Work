'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
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

  async function borrar(lineaId: string) {
    const datos = new FormData()
    datos.set('linea_id', lineaId)
    datos.set('movimiento_id', movimientoId)

    const resultado = await eliminarLineaMovimiento(null, datos)
    if (!resultado.ok) setError(resultado.error)
    else iniciarTransicion(() => router.refresh())
  }

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
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
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
                  <td colSpan={editable ? 5 : 4} className="px-3 py-10 text-center text-sm text-texto-suave">
                    Este documento aún no tiene materiales.
                  </td>
                </tr>
              ) : (
                lineas.map((l) => {
                  const material = l.material as {
                    codigo: string
                    descripcion: string
                    unidad: { codigo: string }
                  }
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
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {numero(l.costo_unitario)}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium">
                        {numero(importe)}
                      </td>
                      {editable && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => borrar(l.id)}
                            aria-label={`Eliminar ${material.descripcion}`}
                            className="text-texto-tenue hover:text-peligro"
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
                  <td colSpan={3} className="px-3 py-2 text-right text-xs text-texto-suave">
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
              <Seleccion
                id="material_id"
                name="material_id"
                required
                autoFocus
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
              >
                <option value="">Selecciona</option>
                {materiales.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo} · {m.descripcion}
                  </option>
                ))}
              </Seleccion>
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
                className="tabular text-right"
              />
            </Campo>

            <div className="flex justify-end gap-2 sm:col-span-6">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAgregando(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar
              </Boton>
            </div>
          </form>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
