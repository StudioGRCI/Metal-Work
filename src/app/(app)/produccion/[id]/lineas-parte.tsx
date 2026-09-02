'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ConfirmarAccion } from '@/components/ui/ventana'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import type { UnidadNombrable } from '@/lib/dominio/unidades'
import { cantidad } from '@/lib/format'
import { agregarHoras, eliminarHoras, etapasParaElParte } from '../acciones'

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
  ordenes: {
    id: string
    numero: string
    descripcion: string
    cliente: string | null
    unidad: UnidadNombrable | null
  }[]
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [agregando, setAgregando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [ordenId, setOrdenId] = useState('')
  const [etapas, setEtapas] = useState<{ ordenId: string; lista: { etapa_id: string; etapa: string }[] } | null>(null)
  const [falloEtapas, setFalloEtapas] = useState<string | null>(null)
  // La línea que se está por quitar, con el detalle ya armado: dentro de la
  // ventana ya no se tiene a mano el operario ni la orden de esa fila.
  const [porQuitar, setPorQuitar] = useState<{ id: string; detalle: string } | null>(null)
  const [quitando, setQuitando] = useState(false)

  // Las etapas dependen de la orden elegida; se cargan al vuelo.
  async function cambiarOrden(id: string) {
    setOrdenId(id)
    if (!id) return

    setFalloEtapas(null)
    const resultado = await etapasParaElParte(id)
    if (!resultado.ok) {
      setFalloEtapas(resultado.error)
      setEtapas({ ordenId: id, lista: [] })
      return
    }
    setEtapas({ ordenId: id, lista: resultado.datos ?? [] })
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

  // Quitar horas no se deshace: la línea se borra de la base y hay que volver a
  // anotarla de memoria. Por eso la papelera solo pregunta y el borrado ocurre
  // aquí, ya con la respuesta dada.
  async function quitar() {
    if (!porQuitar) return

    const datos = new FormData()
    datos.set('linea_id', porQuitar.id)
    datos.set('parte_id', parteId)

    setError(null)
    setQuitando(true)
    const resultado = await eliminarHoras(null, datos)
    setQuitando(false)
    setPorQuitar(null)

    if (!resultado.ok) setError(resultado.error)
    else iniciarTransicion(() => router.refresh())
  }

  const botonAgregar =
    editable && !agregando ? (
      <Boton variante="secundario" tamano="sm" onClick={() => setAgregando(true)}>
        <Plus aria-hidden className="size-3.5" />
        Registrar horas
      </Boton>
    ) : null

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Horas del día"
        descripcion="Qué operario trabajó, en qué orden y etapa, y cuántas horas."
        acciones={botonAgregar}
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
                {/* Etapa, trabajo realizado y extra se esconden en el teléfono y
                    bajan a la celda de la orden: siete columnas ahí solo se leen
                    arrastrando la tabla de lado. */}
                <th className="hidden px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Etapa
                </th>
                <th className="hidden px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Trabajo realizado
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                  Horas
                </th>
                <th className="hidden px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">
                  Extra
                </th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lineas.length === 0 ? (
                <SinDatos
                  colSpan={editable ? 7 : 6}
                  titulo="Todavía no hay horas en este parte"
                  descripcion={
                    editable
                      ? 'Agrega el primer registro: operario, orden, etapa y cuántas horas trabajó.'
                      : 'El parte se cerró sin registros de horas.'
                  }
                  accion={botonAgregar}
                />
              ) : (
                lineas.map((l) => {
                  const usuario = l.usuario as { nombres: string; apellidos: string }
                  const orden = l.orden as { numero: string; descripcion: string }
                  const etapa = l.etapa as { catalogo: { nombre: string } }
                  const extra = Number(l.horas_extra ?? 0)

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
                        <p className="text-[11px] text-texto-suave sm:hidden">
                          {etapa.catalogo.nombre}
                          {l.descripcion ? ' · ' + l.descripcion : ''}
                        </p>
                      </td>
                      <td className="hidden px-3 py-2 text-texto-suave sm:table-cell">
                        {etapa.catalogo.nombre}
                      </td>
                      <td className="hidden max-w-64 px-3 py-2 text-texto-suave sm:table-cell">
                        {l.descripcion ?? '—'}
                      </td>
                      <td className="tabular px-3 py-2 text-right font-medium">
                        {cantidad(l.horas)}
                        {extra > 0 && (
                          <span className="block text-[11px] font-normal text-texto-suave sm:hidden">
                            +{cantidad(l.horas_extra)} extra
                          </span>
                        )}
                      </td>
                      <td className="tabular hidden px-3 py-2 text-right text-texto-suave sm:table-cell">
                        {cantidad(l.horas_extra)}
                      </td>
                      {editable && (
                        <td className="px-3 py-2">
                          {/* El margen negativo agranda lo que se puede tocar con
                              el dedo sin mover ni un píxel la fila; en el monitor
                              vuelve a ser el icono de siempre. */}
                          <button
                            type="button"
                            onClick={() =>
                              setPorQuitar({
                                id: l.id,
                                detalle:
                                  `Se van ${cantidad(l.horas)} h` +
                                  (extra > 0 ? ` y ${cantidad(extra)} h extra` : '') +
                                  ` de ${usuario.nombres} ${usuario.apellidos} en ${orden.numero}, etapa ${etapa.catalogo.nombre}.` +
                                  ' Habrá que volver a anotarlas a mano.',
                              })
                            }
                            aria-label={'Eliminar las horas de ' + usuario.nombres + ' ' + usuario.apellidos + ' en ' + orden.numero}
                            className="-m-2.5 p-2.5 text-texto-tenue hover:text-peligro sm:m-0 sm:p-0"
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
                {/* La unidad siempre se nombra —placa si la tiene, y si no, lo
                    que la identifique—: el operario elige la orden por el
                    camión que tiene delante, no por el número. Se arma con
                    `join` para que un cliente sin nombre no deje un separador
                    suelto en la lista. */}
                {ordenes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {[o.numero, o.cliente, nombreDeUnidad(o.unidad)].filter(Boolean).join(' · ')}
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
                falloEtapas
                  ? `No se pudieron cargar las etapas: ${falloEtapas}`
                  : ordenId && etapasVisibles.length === 0
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

            {/* inputMode decimal: en el celular abre el teclado de números, no el
                de letras. Estas horas se anotan de pie y a veces con guante. */}
            <Campo etiqueta="Horas" htmlFor="horas" requerido>
              <Entrada
                id="horas"
                name="horas"
                type="number"
                inputMode="decimal"
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
                inputMode="decimal"
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
                autoComplete="off"
                placeholder="Soldadura de refuerzos laterales"
              />
            </Campo>

            <div className="flex justify-end gap-2 sm:col-span-6">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAgregando(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Registrar horas
              </Boton>
            </div>
          </form>
        )}

        <ConfirmarAccion
          abierta={porQuitar !== null}
          alCerrar={() => setPorQuitar(null)}
          alConfirmar={() => void quitar()}
          titulo="¿Quitar estas horas del parte?"
          detalle={porQuitar?.detalle ?? ''}
          trabajando={quitando}
        />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
