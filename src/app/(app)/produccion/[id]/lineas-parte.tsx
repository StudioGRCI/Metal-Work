'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'

import { agregarHoras, eliminarHoras } from '../acciones'

type Linea = {
  id: string
  horas: number
  horas_extra: number
  horas_totales: number | null
  descripcion: string | null
  usuario: unknown
  orden: unknown
  etapa: unknown
}

export function LineasParte({
  parteId,
  lineas,
  editable,
  operarios,
  ordenes,
}: {
  parteId: string
  lineas: Linea[]
  editable: boolean
  operarios: { id: string; nombres: string; apellidos: string }[]
  ordenes: { id: string; numero: string; descripcion: string; cliente: string | null; placa: string | null }[]
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [agregando, setAgregando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [ordenId, setOrdenId] = useState('')
  const [etapas, setEtapas] = useState<{ ordenId: string; lista: { etapa_id: string; etapa: string }[] } | null>(null)

  // Las etapas dependen de la orden elegida; se cargan al vuelo.
  async function cambiarOrden(id: string) {
    setOrdenId(id)
    if (!id) return

    const { data } = await createClient()
      .from('ot_tablero_etapas')
      .select('etapa_id, etapa, orden_secuencia')
      .eq('orden_id', id)
      .order('orden_secuencia')

    setEtapas({
      ordenId: id,
      lista: (data ?? []).map((e) => ({ etapa_id: e.etapa_id as string, etapa: e.etapa as string })),
    })
  }

  const etapasVisibles = etapas?.ordenId === ordenId ? etapas.lista : []

  async function enviar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await agregarHoras(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setOrdenId('')
      setEtapas(null)
      setAgregando(false)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  async function borrar(lineaId: string) {
    const datos = new FormData()
    datos.set('linea_id', lineaId)
    datos.set('parte_id', parteId)

    const resultado = await eliminarHoras(null, datos)
    if (!resultado.ok) setError(resultado.error)
    else iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Horas del día"
        descripcion="Qué operario trabajó, en qué orden y etapa, y cuántas horas."
        acciones={
          editable && !agregando ? (
            <Boton variante="secundario" tamano="sm" onClick={() => setAgregando(true)}>
              <Plus aria-hidden className="size-3.5" />
              Registrar horas
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
                  Operario
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Orden
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Etapa
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                  Trabajo realizado
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Horas
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Extra
                </th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 ? (
                <tr>
                  <td colSpan={editable ? 7 : 6} className="px-3 py-10 text-center text-sm text-texto-suave">
                    Todavía no se han registrado horas en este parte.
                  </td>
                </tr>
              ) : (
                lineas.map((l) => {
                  const usuario = l.usuario as { nombres: string; apellidos: string }
                  const orden = l.orden as { numero: string; descripcion: string }
                  const etapa = l.etapa as { catalogo: { nombre: string } }

                  return (
                    <tr key={l.id} className="border-b border-borde last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {usuario.nombres} {usuario.apellidos}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-texto">{orden.numero}</p>
                        <p className="max-w-48 truncate text-[11px] text-texto-suave">
                          {orden.descripcion}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-texto-suave">{etapa.catalogo.nombre}</td>
                      <td className="max-w-64 px-3 py-2 text-texto-suave">{l.descripcion ?? '—'}</td>
                      <td className="tabular px-3 py-2 text-right font-medium">{cantidad(l.horas)}</td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
                        {cantidad(l.horas_extra)}
                      </td>
                      {editable && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => borrar(l.id)}
                            aria-label="Eliminar registro de horas"
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
            <input type="hidden" name="parte_id" value={parteId} />

            <Campo etiqueta="Operario" htmlFor="usuario_id" requerido className="sm:col-span-2">
              <Seleccion id="usuario_id" name="usuario_id" required autoFocus>
                <option value="">Selecciona</option>
                {operarios.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombres} {o.apellidos}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Orden de trabajo" htmlFor="orden_id" requerido className="sm:col-span-2">
              <Seleccion
                id="orden_id"
                name="orden_id"
                required
                value={ordenId}
                onChange={(e) => cambiarOrden(e.target.value)}
              >
                <option value="">Selecciona</option>
                {ordenes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero} · {o.cliente ?? ''} {o.placa ? `(${o.placa})` : ''}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo
              etiqueta="Etapa"
              htmlFor="etapa_id"
              requerido
              className="sm:col-span-2"
              ayuda={
                ordenId && etapasVisibles.length === 0
                  ? 'Esta orden aún no tiene etapas; apruébala primero'
                  : undefined
              }
            >
              <Seleccion id="etapa_id" name="etapa_id" required disabled={!ordenId}>
                <option value="">Selecciona</option>
                {etapasVisibles.map((e) => (
                  <option key={e.etapa_id} value={e.etapa_id}>
                    {e.etapa}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <Campo etiqueta="Horas" htmlFor="horas" requerido>
              <Entrada
                id="horas"
                name="horas"
                type="number"
                step="0.5"
                min="0.5"
                max={24}
                required
                defaultValue={8}
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Horas extra" htmlFor="horas_extra">
              <Entrada
                id="horas_extra"
                name="horas_extra"
                type="number"
                step="0.5"
                min={0}
                max={12}
                defaultValue={0}
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Trabajo realizado" htmlFor="descripcion" className="sm:col-span-4">
              <Entrada
                id="descripcion"
                name="descripcion"
                placeholder="Soldadura de refuerzos laterales"
              />
            </Campo>

            <div className="flex justify-end gap-2 sm:col-span-6">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAgregando(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Registrar
              </Boton>
            </div>
          </form>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
