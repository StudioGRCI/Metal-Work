'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad } from '@/lib/format'

import { agregarLineaRequerimiento } from '../../acciones'

type Linea = {
  id: string
  cantidad_solicitada: number
  cantidad_aprobada: number | null
  cantidad_atendida: number | null
  cantidad_reservada: number | null
  especificacion: string | null
  material: unknown
}

export function LineasRequerimiento({
  requerimientoId,
  lineas,
  editable,
  materiales,
}: {
  requerimientoId: string
  lineas: Linea[]
  editable: boolean
  materiales: { id: string; codigo: string; descripcion: string; unidad: unknown }[]
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [agregando, setAgregando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await agregarLineaRequerimiento(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setAgregando(false)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Materiales solicitados"
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
                  Solicitado
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Aprobado
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Reservado
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Atendido
                </th>
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-texto-suave">
                    Este requerimiento aún no tiene materiales.
                  </td>
                </tr>
              ) : (
                lineas.map((l) => {
                  const material = l.material as {
                    codigo: string
                    descripcion: string
                    unidad: { codigo: string }
                  }
                  const solicitado = Number(l.cantidad_solicitada)
                  const atendido = Number(l.cantidad_atendida ?? 0)
                  const avance = solicitado > 0 ? (atendido / solicitado) * 100 : 0

                  return (
                    <tr key={l.id} className="border-b border-borde last:border-0">
                      <td className="px-3 py-2">
                        <p className="text-texto">{material.descripcion}</p>
                        <p className="font-mono text-[11px] text-texto-suave">{material.codigo}</p>
                        {l.especificacion && (
                          <p className="text-[11px] text-texto-suave">{l.especificacion}</p>
                        )}
                      </td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {cantidad(solicitado)}
                        <span className="ml-1 text-[11px] text-texto-tenue">
                          {material.unidad.codigo}
                        </span>
                      </td>
                      <td className="tabular px-3 py-2 text-right">
                        {l.cantidad_aprobada === null ? '—' : cantidad(l.cantidad_aprobada)}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {cantidad(l.cantidad_reservada ?? 0)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Progreso valor={avance} alto="sm" />
                          <span className="tabular w-16 shrink-0 text-right text-[11px] text-texto-suave">
                            {cantidad(atendido)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {error && (
          <p role="alert" className="border-t border-borde bg-peligro-suave px-3 py-2 text-xs text-peligro">
            {error}
          </p>
        )}

        {agregando && (
          <form action={enviar} className="grid gap-3 border-t border-borde p-4 sm:grid-cols-6">
            <input type="hidden" name="requerimiento_id" value={requerimientoId} />

            <Campo etiqueta="Material" htmlFor="material_id" requerido className="sm:col-span-3">
              <Seleccion id="material_id" name="material_id" required autoFocus>
                <option value="">Selecciona</option>
                {materiales.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.codigo} · {m.descripcion}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Cantidad" htmlFor="cantidad_solicitada" requerido>
              <Entrada
                id="cantidad_solicitada"
                name="cantidad_solicitada"
                type="number"
                step="0.0001"
                min="0.0001"
                required
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Especificación" htmlFor="especificacion" className="sm:col-span-2">
              <Entrada
                id="especificacion"
                name="especificacion"
                placeholder="Medida o detalle particular"
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
