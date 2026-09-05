'use client'

import { PackagePlus, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { ResultadoAccion } from '@/lib/acciones'
import type { CatalogoMateriales, MaterialDeOrden } from '@/lib/datos/materiales-orden'
import { cantidad as fmtCantidad } from '@/lib/format'

import {
  agregarMaterial,
  cambiarCantidadMaterial,
  mandarAlRequerimiento,
  quitarMaterial,
} from './acciones-materiales'

type Accion = (previo: unknown, datos: FormData) => Promise<ResultadoAccion>

function useEnvio(accion: Accion, alTerminar?: () => void) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enviar(datos: FormData) {
    if (enviando) return
    setError(null)
    setEnviando(true)
    const resultado = await accion(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      alTerminar?.()
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  return { enviar, enviando, error }
}

function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * La lista de materiales de la orden.
 *
 * «La OT no presupuesta materiales: quien ve cuánto material y qué cosas se van
 * a utilizar es Diseño al realizar el diseño del vehículo». Esta es esa hoja, y
 * de acá sale el pedido al almacén: se marca lo que se manda ahora —todo o una
 * parte— y el resto queda pendiente para el siguiente requerimiento.
 *
 * No lleva ni un importe a propósito: el costo es de `ot_presupuesto` y de quien
 * tiene `costos.ver`.
 */
export function MaterialesDeOrden({
  ordenId,
  materiales,
  catalogo,
  puedeDisenar,
  puedePedir,
  ordenViva,
}: {
  ordenId: string
  materiales: MaterialDeOrden[]
  catalogo: CatalogoMateriales
  /** `diseno.planos`: quien dibuja la unidad escribe qué lleva. */
  puedeDisenar: boolean
  /** `requerimientos.crear`: mandar al almacén es otra mano. */
  puedePedir: boolean
  ordenViva: boolean
}) {
  const pendientes = materiales.filter((m) => m.cantidad_pendiente > 0)
  const completas = materiales.length - pendientes.length

  return (
    <div className="space-y-4">
      <Tarjeta>
        <TarjetaCabecera
          titulo="Materiales de la orden"
          descripcion="Lo que Diseño dice que lleva la unidad. De acá sale el requerimiento al almacén: se manda todo o una parte, y lo que falte queda pendiente."
        />
        <TarjetaCuerpo className="grid gap-3 sm:grid-cols-3">
          <Dato titulo="Líneas" valor={String(materiales.length)} pie="materiales distintos" />
          <Dato
            titulo="Por pedir"
            valor={String(pendientes.length)}
            pie={pendientes.length === 1 ? 'línea con saldo' : 'líneas con saldo'}
          />
          <Dato titulo="Completas" valor={String(completas)} pie="ya mandadas al almacén" />
        </TarjetaCuerpo>
      </Tarjeta>

      {puedeDisenar && ordenViva && (
        <NuevoMaterial ordenId={ordenId} catalogo={catalogo} yaEnLista={materiales} />
      )}

      {materiales.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">La lista todavía está vacía</p>
            <p className="mt-1 text-sm text-texto-suave">
              {puedeDisenar
                ? 'Agrega el primer material con el botón de arriba: qué lleva la unidad y cuánto. Después se manda al almacén desde acá mismo.'
                : 'Diseño todavía no ha escrito qué material lleva esta unidad.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <Pedido
          ordenId={ordenId}
          materiales={materiales}
          catalogo={catalogo}
          puedeDisenar={puedeDisenar && ordenViva}
          puedePedir={puedePedir && ordenViva}
        />
      )}
    </div>
  )
}

function Dato({ titulo, valor, pie }: { titulo: string; valor: string; pie: string }) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <p className="text-2xl font-semibold tabular text-texto">{valor}</p>
      <p className="text-[11px] text-texto-suave">{pie}</p>
    </div>
  )
}

/**
 * La tabla y el pase al almacén, juntos: lo que se marca en la tabla es lo que
 * se manda, y por eso comparten estado.
 */
function Pedido({
  ordenId,
  materiales,
  catalogo,
  puedeDisenar,
  puedePedir,
}: {
  ordenId: string
  materiales: MaterialDeOrden[]
  catalogo: CatalogoMateriales
  puedeDisenar: boolean
  puedePedir: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [marcadas, setMarcadas] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [porcentaje, setPorcentaje] = useState('100')

  const lineas = Object.entries(marcadas)
    .map(([material, texto]) => ({ material, cantidad: Number(texto) }))
    .filter((l) => Number.isFinite(l.cantidad) && l.cantidad > 0)

  function alternar(m: MaterialDeOrden) {
    setMarcadas((previo) => {
      const copia = { ...previo }
      if (m.id in copia) {
        delete copia[m.id]
        return copia
      }
      copia[m.id] = String(m.cantidad_pendiente)
      return copia
    })
  }

  /** El atajo del porcentaje: escribe cantidades, que es lo único que viaja. */
  function aplicarPorcentaje() {
    const pct = Number(porcentaje)
    if (!Number.isFinite(pct) || pct <= 0) return
    const factor = Math.min(pct, 100) / 100
    setMarcadas(() => {
      const nuevas: Record<string, string> = {}
      for (const m of materiales) {
        if (m.cantidad_pendiente <= 0) continue
        // Tres decimales: es lo que admite la columna, y redondear a más de eso
        // hace que la base rechace el pedido por pasarse del saldo.
        nuevas[m.id] = String(Math.round(m.cantidad_pendiente * factor * 1000) / 1000)
      }
      return nuevas
    })
  }

  async function pedir(datos: FormData) {
    if (enviando) return
    setError(null)
    setEnviando(true)
    const resultado = await mandarAlRequerimiento(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setMarcadas({})
      const id = resultado.datos?.requerimiento
      if (id) {
        router.push(`/almacen/requerimientos/${id}`)
        return
      }
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  return (
    <>
      <Tarjeta>
        <TarjetaCuerpo className="p-0">
          <Tabla>
            <TablaCabecera>
              <TR>
                {puedePedir && <TH className="w-10">Pedir</TH>}
                <TH>Plano</TH>
                <TH>Material</TH>
                <TH>Destino</TH>
                <TH className="text-right">Lleva</TH>
                <TH className="text-right">Pedido</TH>
                <TH className="text-right">Pendiente</TH>
                <TH className="text-right">En almacén</TH>
                {puedePedir && <TH className="text-right">Se manda</TH>}
                {puedeDisenar && <TH className="w-20" />}
              </TR>
            </TablaCabecera>
            <tbody>
              {materiales.map((m) => {
                const marcada = m.id in marcadas
                const stock = catalogo.disponible[m.material_id] ?? 0
                return (
                  <TR key={m.id}>
                    {puedePedir && (
                      <TD>
                        <input
                          type="checkbox"
                          checked={marcada}
                          disabled={m.cantidad_pendiente <= 0}
                          onChange={() => alternar(m)}
                          aria-label={`Pedir ${m.material}`}
                          className="size-4 accent-[var(--acento)]"
                        />
                      </TD>
                    )}
                    <TD className="whitespace-nowrap text-xs text-texto-suave">
                      {m.numero_plano ? `${m.numero_plano} · ${m.plano_nombre}` : '—'}
                    </TD>
                    <TD>
                      <p className="text-sm font-medium text-texto">{m.material}</p>
                      <p className="text-[11px] text-texto-suave">
                        {m.material_codigo}
                        {m.observacion ? ` · ${m.observacion}` : ''}
                      </p>
                    </TD>
                    <TD className="text-xs text-texto-suave">
                      {m.area ?? m.etapa ?? <span className="text-texto-tenue">sin repartir</span>}
                    </TD>
                    <TD className="text-right tabular text-sm">
                      {fmtCantidad(m.cantidad)} {m.unidad}
                    </TD>
                    <TD className="text-right tabular text-sm text-texto-suave">
                      {fmtCantidad(m.cantidad_pedida)}
                    </TD>
                    <TD className="text-right tabular text-sm">
                      {m.cantidad_pendiente > 0 ? (
                        fmtCantidad(m.cantidad_pendiente)
                      ) : (
                        <Insignia tono="exito">completo</Insignia>
                      )}
                    </TD>
                    <TD className="text-right tabular text-xs text-texto-suave">
                      {fmtCantidad(stock)}
                    </TD>
                    {puedePedir && (
                      <TD className="text-right">
                        {marcada ? (
                          <Entrada
                            aria-label={`Cantidad de ${m.material}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.001"
                            max={m.cantidad_pendiente}
                            value={marcadas[m.id]}
                            onChange={(e) =>
                              setMarcadas((previo) => ({ ...previo, [m.id]: e.target.value }))
                            }
                            className="tabular w-24 text-right"
                          />
                        ) : (
                          <span className="text-texto-tenue">—</span>
                        )}
                      </TD>
                    )}
                    {puedeDisenar && (
                      <TD>
                        <AccionesLinea material={m} ordenId={ordenId} />
                      </TD>
                    )}
                  </TR>
                )
              })}
            </tbody>
          </Tabla>
        </TarjetaCuerpo>
      </Tarjeta>

      {puedePedir && (
        <Tarjeta className={lineas.length > 0 ? 'border-acento' : undefined}>
          <TarjetaCabecera
            titulo="Mandar al almacén"
            descripcion="Sale un requerimiento con lo marcado. Lo que no se mande queda pendiente para el siguiente pedido."
          />
          <TarjetaCuerpo>
            <div className="mb-4 flex flex-wrap items-end gap-2">
              <Campo etiqueta="Marcar el" htmlFor="mat-pct" ayuda="de lo pendiente de cada línea">
                <div className="flex items-center gap-2">
                  <Entrada
                    id="mat-pct"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={100}
                    step="5"
                    value={porcentaje}
                    onChange={(e) => setPorcentaje(e.target.value)}
                    className="tabular w-20 text-right"
                  />
                  <span className="text-sm text-texto-suave">%</span>
                  <Boton type="button" variante="secundario" tamano="sm" onClick={aplicarPorcentaje}>
                    Aplicar
                  </Boton>
                </div>
              </Campo>
              {Object.keys(marcadas).length > 0 && (
                <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setMarcadas({})}>
                  Desmarcar todo
                </Boton>
              )}
            </div>

            <form action={pedir} className="grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="orden_id" value={ordenId} />
              <input type="hidden" name="lineas" value={JSON.stringify(lineas)} />

              <Campo etiqueta="Almacén" htmlFor="mat-almacen" ayuda="De dónde saldrá">
                <Seleccion id="mat-almacen" name="almacen_id" defaultValue={catalogo.almacenes[0]?.id ?? ''}>
                  <option value="">Sin especificar</option>
                  {catalogo.almacenes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </Seleccion>
              </Campo>

              <Campo etiqueta="Prioridad" htmlFor="mat-prioridad">
                <Seleccion id="mat-prioridad" name="prioridad" defaultValue="NORMAL">
                  <option value="BAJA">Baja</option>
                  <option value="NORMAL">Normal</option>
                  <option value="ALTA">Alta</option>
                  <option value="URGENTE">Urgente</option>
                </Seleccion>
              </Campo>

              <Campo etiqueta="Se necesita el" htmlFor="mat-fecha" ayuda="Opcional">
                <Entrada id="mat-fecha" name="fecha_requerida" type="date" />
              </Campo>

              <Campo etiqueta="Observaciones" htmlFor="mat-obs" ayuda="Opcional">
                <Entrada id="mat-obs" name="observaciones" placeholder="Para el habilitado de la compuerta" />
              </Campo>

              {error && (
                <div className="sm:col-span-4">
                  <Error_ texto={error} />
                </div>
              )}

              <div className="flex items-center justify-between gap-3 sm:col-span-4">
                <p className="text-xs text-texto-suave">
                  {lineas.length === 0
                    ? 'Marca al menos un material en la tabla.'
                    : `${lineas.length} ${lineas.length === 1 ? 'material marcado' : 'materiales marcados'}.`}
                </p>
                <Boton type="submit" cargando={enviando} disabled={lineas.length === 0}>
                  <Send aria-hidden className="size-4" />
                  Mandar al requerimiento
                </Boton>
              </div>
            </form>
          </TarjetaCuerpo>
        </Tarjeta>
      )}
    </>
  )
}

function AccionesLinea({ material, ordenId }: { material: MaterialDeOrden; ordenId: string }) {
  const [editando, setEditando] = useState(false)
  const { enviar, enviando, error } = useEnvio(cambiarCantidadMaterial, () => setEditando(false))
  const quitar = useEnvio(quitarMaterial)

  if (editando) {
    return (
      <form action={enviar} className="flex items-center gap-1">
        <input type="hidden" name="id" value={material.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <Entrada
          aria-label={`Cantidad de ${material.material}`}
          name="cantidad"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.001"
          defaultValue={material.cantidad}
          autoFocus
          className="tabular w-20 text-right"
        />
        <Boton type="submit" tamano="sm" cargando={enviando}>
          Guardar
        </Boton>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setEditando(false)}>
          Cerrar
        </Boton>
        {error && <Error_ texto={error} />}
      </form>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Boton
        type="button"
        variante="fantasma"
        tamano="sm"
        aria-label={`Corregir la cantidad de ${material.material}`}
        onClick={() => setEditando(true)}
      >
        <Pencil aria-hidden className="size-4" />
      </Boton>
      <form action={quitar.enviar}>
        <input type="hidden" name="id" value={material.id} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <Boton
          type="submit"
          variante="fantasma"
          tamano="sm"
          cargando={quitar.enviando}
          aria-label={`Quitar ${material.material} de la lista`}
        >
          <Trash2 aria-hidden className="size-4 text-peligro" />
        </Boton>
      </form>
      {quitar.error && <Error_ texto={quitar.error} />}
    </div>
  )
}

function NuevoMaterial({
  ordenId,
  catalogo,
  yaEnLista,
}: {
  ordenId: string
  catalogo: CatalogoMateriales
  yaEnLista: MaterialDeOrden[]
}) {
  const [abierto, setAbierto] = useState(false)
  const [materialId, setMaterialId] = useState('')
  const { enviar, enviando, error } = useEnvio(agregarMaterial, () => {
    setAbierto(false)
    setMaterialId('')
  })

  if (!abierto) {
    return (
      <div className="flex justify-end">
        <Boton variante="secundario" tamano="sm" onClick={() => setAbierto(true)}>
          <Plus aria-hidden className="size-4" />
          Agregar material
        </Boton>
      </div>
    )
  }

  const elegido = catalogo.materiales.find((m) => m.id === materialId)
  const repetido = yaEnLista.some((m) => m.material_id === materialId && !m.plano_id)

  return (
    <Tarjeta className="border-acento">
      <TarjetaCabecera
        titulo="Agregar material a la lista"
        descripcion="Qué lleva la unidad y cuánto. El plano y la etapa son opcionales: hay material que es de la unidad entera."
      />
      <TarjetaCuerpo>
        <form action={enviar} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="orden_id" value={ordenId} />

          <Campo etiqueta="Material" htmlFor="nm-material" requerido className="sm:col-span-3">
            <SeleccionBuscable
              id="nm-material"
              name="material_id"
              requerido
              permiteVaciar={false}
              valor={materialId}
              onChange={setMaterialId}
              marcador="Busca el material"
              marcadorBusqueda="Código o descripción"
              opciones={catalogo.materiales.map((m) => ({
                valor: m.id,
                etiqueta: m.descripcion,
                detalle: [m.codigo, m.unidad].filter(Boolean).join(' · '),
              }))}
            />
          </Campo>

          <Campo
            etiqueta="Cantidad"
            htmlFor="nm-cantidad"
            requerido
            ayuda={elegido?.unidad ? `En ${elegido.unidad}` : 'Según su unidad'}
          >
            <Entrada
              id="nm-cantidad"
              name="cantidad"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.001"
              required
              className="tabular"
            />
          </Campo>

          <Campo etiqueta="Plano" htmlFor="nm-plano" ayuda="Opcional">
            <Seleccion id="nm-plano" name="plano_id" defaultValue="">
              <option value="">De la unidad</option>
              {catalogo.planos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.numero_plano} · {p.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Para la etapa" htmlFor="nm-etapa" ayuda="Opcional">
            <Seleccion id="nm-etapa" name="etapa_id" defaultValue="">
              <option value="">Sin repartir</option>
              {catalogo.etapas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                  {e.area ? ` · ${e.area}` : ''}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Observación" htmlFor="nm-obs" className="sm:col-span-6">
            <Entrada id="nm-obs" name="observacion" placeholder="Opcional: medida, corte, marca pedida" />
          </Campo>

          {repetido && (
            <p className="text-xs text-aviso sm:col-span-6">
              Ese material ya está en la lista como material de la unidad. Si es para un plano
              distinto, elige el plano; si no, corrige la cantidad en la tabla.
            </p>
          )}

          {error && (
            <div className="sm:col-span-6">
              <Error_ texto={error} />
            </div>
          )}

          <div className="flex justify-end gap-2 sm:col-span-6">
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" tamano="sm" cargando={enviando}>
              <PackagePlus aria-hidden className="size-4" />
              Agregar a la lista
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
