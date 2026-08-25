'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_COSTO, definir } from '@/lib/dominio/estados'
import { cantidad, moneda, numero } from '@/lib/format'
import type { CodigoMoneda } from '@/lib/format'
import type { Tablas } from '@/types/database'

import { agregarPartida, eliminarPartida } from '../acciones'

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
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

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

  async function borrar(partidaId: string) {
    const datos = new FormData()
    datos.set('partida_id', partidaId)
    datos.set('cotizacion_id', cotizacionId)

    const resultado = await eliminarPartida(null, datos)
    if (!resultado.ok) setError(resultado.error)
    else iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Partidas"
        descripcion="El subtotal de cada línea y los totales de la cotización los calcula el sistema."
        acciones={
          editable && !agregando ? (
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
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Tipo
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Cantidad
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  P. unitario
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Dcto.
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Subtotal
                </th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {partidas.length === 0 ? (
                <tr>
                  <td colSpan={editable ? 8 : 7} className="px-3 py-10 text-center text-sm text-texto-suave">
                    Esta cotización todavía no tiene partidas.
                  </td>
                </tr>
              ) : (
                partidas.map((p, i) => {
                  const tipo = definir(TIPO_COSTO, p.tipo_costo)
                  return (
                    <tr key={p.id} className="border-b border-borde last:border-0">
                      <td className="tabular px-3 py-2 text-texto-tenue">{i + 1}</td>
                      <td className="px-3 py-2">
                        <p className="text-texto">{p.descripcion}</p>
                        {p.detalle && (
                          <p className="text-[11px] whitespace-pre-wrap text-texto-suave">
                            {p.detalle}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
                      </td>
                      <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                        {cantidad(p.cantidad)}
                        <span className="ml-1 text-[11px] text-texto-tenue">{p.unidad_medida}</span>
                      </td>
                      <td className="tabular px-3 py-2 text-right">{numero(p.precio_unitario)}</td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {Number(p.descuento_porcentaje ?? 0) > 0
                          ? `${numero(p.descuento_porcentaje, 0)}%`
                          : '—'}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium">
                        {moneda(p.subtotal, mon)}
                      </td>
                      {editable && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => borrar(p.id)}
                            aria-label={`Eliminar partida ${p.descripcion}`}
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
          </table>
        </div>

        {error && (
          <p role="alert" className="border-t border-borde bg-peligro-suave px-3 py-2 text-xs text-peligro">
            {error}
          </p>
        )}

        {agregando && (
          <form action={enviar} className="grid gap-3 border-t border-borde p-4 sm:grid-cols-6">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />

            <Campo etiqueta="Descripción" htmlFor="descripcion" requerido className="sm:col-span-4">
              <Entrada
                id="descripcion"
                name="descripcion"
                required
                autoFocus
                placeholder="Fabricación de tolva de volquete 18 m3 en acero A36"
              />
            </Campo>

            <Campo etiqueta="Tipo de costo" htmlFor="tipo_costo" className="sm:col-span-2">
              <Seleccion id="tipo_costo" name="tipo_costo" defaultValue="MATERIAL">
                <option value="MATERIAL">Materiales</option>
                <option value="MANO_OBRA">Mano de obra</option>
                <option value="SERVICIO">Servicio</option>
                <option value="OTRO">Otro</option>
              </Seleccion>
            </Campo>

            <Campo etiqueta="Detalle" htmlFor="detalle" className="sm:col-span-6">
              <AreaTexto
                id="detalle"
                name="detalle"
                rows={2}
                placeholder="Medidas, espesores y todo lo que precise el alcance de esta partida"
              />
            </Campo>

            <Campo etiqueta="Unidad" htmlFor="unidad_medida">
              <Seleccion id="unidad_medida" name="unidad_medida" defaultValue="UND">
                {UNIDADES.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Cantidad" htmlFor="cantidad" requerido>
              <Entrada
                id="cantidad"
                name="cantidad"
                type="number"
                step="0.01"
                min="0.01"
                required
                defaultValue={1}
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Precio unitario" htmlFor="precio_unitario" requerido>
              <Entrada
                id="precio_unitario"
                name="precio_unitario"
                type="number"
                step="0.01"
                min={0}
                required
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Descuento %" htmlFor="descuento_porcentaje">
              <Entrada
                id="descuento_porcentaje"
                name="descuento_porcentaje"
                type="number"
                step="0.01"
                min={0}
                max={100}
                defaultValue={0}
                className="tabular text-right"
              />
            </Campo>

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
                Agregar
              </Boton>
            </div>
          </form>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
