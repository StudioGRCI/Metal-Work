'use client'

import { Check, Minus, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ConfirmarAccion } from '@/components/ui/ventana'
import type { AccesorioCotizado, SeccionFicha } from '@/lib/datos/ficha'
import { cantidad as formatearCantidad } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  agregarAccesorio,
  agregarLineaFicha,
  aplicarPlantilla,
  editarAccesorio,
  editarLineaFicha,
  guardarCabeceraTecnica,
  quitarAccesorio,
  quitarLineaFicha,
} from './acciones-ficha'

export type Plantilla = { id: string; nombre: string; descripcion: string | null; carroceria: string | null }

export type CabeceraTecnica = {
  modelo: string | null
  tipo: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  capacidad: string | null
  peso_neto_tn: number | null
  garantia_meses: number
  incluye_igv: boolean
  plazo_en_habiles: boolean
  plazo_entrega_dias: number | null
  nota: string | null
}

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
  const malo = resultado.ok === false

  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

/**
 * La ficha técnica de la cotización.
 *
 * La cotización de esta empresa no es una lista de precios: declara el espesor
 * de cada plancha, la norma de soldadura y qué accesorios entran y cuáles no.
 * Eso es lo que el taller fabrica y contra lo que el cliente reclama, así que
 * acá se llena como dato y no como párrafo.
 */
export function FichaTecnica({
  cotizacionId,
  cabecera,
  secciones,
  accesorios,
  plantillas,
  puedeEditar,
}: {
  cotizacionId: string
  cabecera: CabeceraTecnica
  secciones: SeccionFicha[]
  accesorios: AccesorioCotizado[]
  plantillas: Plantilla[]
  puedeEditar: boolean
}) {
  return (
    <div className="space-y-4">
      {puedeEditar && plantillas.length > 0 && (
        <AplicarFicha cotizacionId={cotizacionId} plantillas={plantillas} vacia={secciones.length === 0} />
      )}

      <Medidas cotizacionId={cotizacionId} cabecera={cabecera} puedeEditar={puedeEditar} />

      <Especificaciones
        cotizacionId={cotizacionId}
        secciones={secciones}
        puedeEditar={puedeEditar}
      />

      <Accesorios
        cotizacionId={cotizacionId}
        accesorios={accesorios}
        puedeEditar={puedeEditar}
      />
    </div>
  )
}

function AplicarFicha({
  cotizacionId,
  plantillas,
  vacia,
}: {
  cotizacionId: string
  plantillas: Plantilla[]
  vacia: boolean
}) {
  const [resultado, accion, enviando] = useActionState(aplicarPlantilla, null)

  return (
    <Tarjeta className={vacia ? 'border-acento' : undefined}>
      <TarjetaCuerpo>
        <form action={accion} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />

          <Campo
            etiqueta="Partir de una ficha ya escrita"
            htmlFor="plantilla_id"
            ayuda={
              vacia
                ? 'Trae las especificaciones del producto para llenar solo lo que cambia'
                : 'Reemplaza la ficha actual por completo'
            }
            className="min-w-64 flex-1"
          >
            <Seleccion id="plantilla_id" name="plantilla_id" required>
              <option value="">Elegir…</option>
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.carroceria ? ` · ${p.carroceria}` : ''}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Boton type="submit" variante={vacia ? 'primario' : 'secundario'} cargando={enviando}>
            <Wand2 aria-hidden className="size-4" />
            Aplicar
          </Boton>
        </form>

        <div className="mt-2">
          <Aviso resultado={resultado} />
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Medidas({
  cotizacionId,
  cabecera,
  puedeEditar,
}: {
  cotizacionId: string
  cabecera: CabeceraTecnica
  puedeEditar: boolean
}) {
  const [resultado, accion, enviando] = useActionState(guardarCabeceraTecnica, null)

  if (!puedeEditar) {
    return (
      <Tarjeta>
        <TarjetaCabecera titulo="Medidas y condiciones" />
        <TarjetaCuerpo className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Dato titulo="Modelo" valor={cabecera.modelo} />
          <Dato titulo="Tipo" valor={cabecera.tipo} />
          <Dato titulo="Capacidad" valor={cabecera.capacidad} />
          <Dato titulo="Largo" valor={cabecera.largo_m ? `${cabecera.largo_m} m` : null} />
          <Dato titulo="Ancho" valor={cabecera.ancho_m ? `${cabecera.ancho_m} m` : null} />
          <Dato titulo="Alto" valor={cabecera.alto_m ? `${cabecera.alto_m} m` : null} />
          <Dato titulo="Garantía" valor={`${cabecera.garantia_meses} meses`} />
          <Dato titulo="Precio" valor={cabecera.incluye_igv ? 'Incluye IGV' : 'No incluye IGV'} />
          <Dato
            titulo="Plazo"
            valor={
              cabecera.plazo_entrega_dias
                ? `${cabecera.plazo_entrega_dias} días ${cabecera.plazo_en_habiles ? 'hábiles' : 'calendario'}`
                : null
            }
          />
          {cabecera.nota && (
            <p className="text-xs text-texto-suave sm:col-span-3">{cabecera.nota}</p>
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Medidas y condiciones"
        descripcion="Lo que cambia en cada cotización. La ficha de abajo trae el resto."
      />
      <TarjetaCuerpo>
        <form action={accion} className="space-y-3">
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Modelo" htmlFor="modelo">
              <Entrada id="modelo" name="modelo" defaultValue={cabecera.modelo ?? ''} placeholder="VASCULANTE" />
            </Campo>
            <Campo etiqueta="Tipo" htmlFor="tipo">
              <Entrada id="tipo" name="tipo" defaultValue={cabecera.tipo ?? ''} placeholder="PLATAFORMA REFORZADA" />
            </Campo>
            <Campo etiqueta="Capacidad" htmlFor="capacidad" ayuda="Como va en la cotización">
              <Entrada id="capacidad" name="capacidad" defaultValue={cabecera.capacidad ?? ''} placeholder="10 M3" />
            </Campo>
            <Campo etiqueta="Peso neto" htmlFor="peso_neto_tn" ayuda="Toneladas">
              <Entrada
                id="peso_neto_tn"
                name="peso_neto_tn"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.peso_neto_tn ?? ''}
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Largo" htmlFor="largo_m" ayuda="Metros">
              <Entrada
                id="largo_m"
                name="largo_m"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.largo_m ?? ''}
              />
            </Campo>
            <Campo etiqueta="Ancho" htmlFor="ancho_m" ayuda="Metros">
              <Entrada
                id="ancho_m"
                name="ancho_m"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.ancho_m ?? ''}
              />
            </Campo>
            <Campo etiqueta="Alto" htmlFor="alto_m" ayuda="Metros">
              <Entrada
                id="alto_m"
                name="alto_m"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.alto_m ?? ''}
              />
            </Campo>
            <Campo etiqueta="Garantía" htmlFor="garantia_meses" ayuda="Meses">
              <Entrada
                id="garantia_meses"
                name="garantia_meses"
                type="number"
                inputMode="numeric"
                min="0"
                max="120"
                defaultValue={cabecera.garantia_meses}
              />
            </Campo>
          </div>

          {/* La casilla crece en el teléfono -y la etiqueta entera se marca,
              que es lo que se toca con el guante puesto-; en `sm:` vuelve al
              tamaño de siempre. */}
          <div className="flex flex-wrap gap-5 pt-1">
            <label className="flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
              <input
                type="checkbox"
                name="incluye_igv"
                defaultChecked={cabecera.incluye_igv}
                className="size-5 accent-[var(--acento)] sm:size-4"
              />
              El precio incluye IGV
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
              <input
                type="checkbox"
                name="plazo_en_habiles"
                defaultChecked={cabecera.plazo_en_habiles}
                className="size-5 accent-[var(--acento)] sm:size-4"
              />
              El plazo se cuenta en días de taller
            </label>
          </div>

          <Campo etiqueta="Nota al pie" htmlFor="nota">
            <AreaTexto
              id="nota"
              name="nota"
              rows={2}
              defaultValue={cabecera.nota ?? ''}
              placeholder="Incluye certificado de montaje y expediente para registros públicos."
            />
          </Campo>

          <Aviso resultado={resultado} />

          <div className="flex justify-end">
            {/* En la misma pantalla se guardan las medidas, el trabajo impreso
                y cada partida: el botón dice cuál de las tres es. */}
            <Boton type="submit" cargando={enviando}>
              Guardar medidas
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null }) {
  return (
    <p>
      <span className="text-texto-suave">{titulo}: </span>
      <span className="text-texto">{valor ?? '—'}</span>
    </p>
  )
}

function Especificaciones({
  cotizacionId,
  secciones,
  puedeEditar,
}: {
  cotizacionId: string
  secciones: SeccionFicha[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarLineaFicha, null)
  const [, accionQuitar] = useActionState(quitarLineaFicha, null)

  // La línea que se está corrigiendo. Se llama a la acción directamente para
  // poder cerrar el formulario en cuanto guarda: con useActionState habría que
  // encadenarlo a un efecto, y esa puerta está cerrada en este proyecto.
  const [editando, setEditando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  // La línea que se pidió quitar, esperando la confirmación. Se guarda con qué
  // dice y de qué sección es: la pregunta tiene que nombrarla.
  const [porQuitar, setPorQuitar] = useState<{ id: string; seccion: string; texto: string } | null>(
    null,
  )

  function confirmarQuitar() {
    if (!porQuitar) return

    const datos = new FormData()
    datos.set('id', porQuitar.id)
    datos.set('cotizacion_id', cotizacionId)

    // Dentro de la transición a propósito: React avisa por consola si la acción
    // de `useActionState` se llama fuera de una, y el pendiente no se actualiza.
    iniciarTransicion(() => accionQuitar(datos))
    setPorQuitar(null)
  }

  async function guardarLinea(datos: FormData) {
    setErrorEdicion(null)
    setGuardando(true)
    const salida = await editarLineaFicha(null, datos)
    setGuardando(false)

    if (!salida.ok) {
      setErrorEdicion(salida.error)
      return
    }

    setEditando(null)
    iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Especificaciones técnicas"
        descripcion="Lo que el taller va a fabricar y contra lo que el cliente va a reclamar."
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)}>
              {abierto ? <Minus aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
              Agregar línea
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-4">
        {abierto && puedeEditar && (
          <form action={accion} className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo etiqueta="Sección" htmlFor="seccion" requerido>
                <Entrada id="seccion" name="seccion" required placeholder="SISTEMA HIDRÁULICO" list="secciones-ficha" />
                <datalist id="secciones-ficha">
                  {secciones.map((s) => (
                    <option key={s.seccion} value={s.seccion} />
                  ))}
                </datalist>
              </Campo>
              <Campo etiqueta="Etiqueta" htmlFor="etiqueta" ayuda="Opcional">
                <Entrada id="etiqueta" name="etiqueta" placeholder="Pistón" />
              </Campo>
              <Campo etiqueta="Detalle" htmlFor="detalle" requerido className="sm:col-span-2">
                <Entrada
                  id="detalle"
                  name="detalle"
                  required
                  placeholder="Telescópico de cuatro (4) cuerpos cromados"
                />
              </Campo>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Aviso resultado={resultado} />
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar línea
              </Boton>
            </div>
          </form>
        )}

        {secciones.length === 0 ? (
          // Un vacío que dice cuál es el siguiente paso y trae el botón que lo
          // da; y que distingue al que puede escribirla del que solo la mira.
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-texto">
              Esta cotización todavía no tiene ficha técnica
            </p>
            <p className="mt-1 text-xs text-texto-suave">
              {puedeEditar
                ? 'Aplica una ficha ya escrita y ajusta lo que cambie, o escribe la primera línea a mano.'
                : 'La escribe quien elabora la cotización, mientras siga abierta.'}
            </p>
            {puedeEditar && !abierto && (
              <div className="mt-4 flex justify-center">
                <Boton tamano="sm" onClick={() => setAbierto(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  Escribir la primera línea
                </Boton>
              </div>
            )}
          </div>
        ) : (
          secciones.map((seccion) => (
            <section key={seccion.seccion}>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-acento uppercase">
                {seccion.seccion}
              </h3>
              <ul className="space-y-1">
                {seccion.lineas.map((linea) =>
                  editando === linea.id ? (
                    <li key={linea.id}>
                      <form
                        action={guardarLinea}
                        className="grid gap-2 rounded-[var(--radius-base)] bg-superficie-2 p-3 sm:grid-cols-4"
                      >
                        <input type="hidden" name="id" value={linea.id} />
                        <input type="hidden" name="cotizacion_id" value={cotizacionId} />

                        <Campo etiqueta="Etiqueta" htmlFor={`etiqueta-${linea.id}`} ayuda="Opcional">
                          <Entrada
                            id={`etiqueta-${linea.id}`}
                            name="etiqueta"
                            defaultValue={linea.etiqueta ?? ''}
                          />
                        </Campo>

                        <Campo
                          etiqueta="Detalle"
                          htmlFor={`detalle-${linea.id}`}
                          requerido
                          className="sm:col-span-3"
                        >
                          <Entrada
                            id={`detalle-${linea.id}`}
                            name="detalle"
                            required
                            autoFocus
                            defaultValue={linea.detalle}
                          />
                        </Campo>

                        <div className="flex items-center justify-between gap-3 sm:col-span-4">
                          {errorEdicion ? (
                            <p role="alert" className="text-xs text-peligro">
                              {errorEdicion}
                            </p>
                          ) : (
                            <span />
                          )}
                          <span className="flex gap-2">
                            <Boton
                              type="button"
                              variante="fantasma"
                              tamano="sm"
                              onClick={() => {
                                setErrorEdicion(null)
                                setEditando(null)
                              }}
                            >
                              Cancelar
                            </Boton>
                            <Boton type="submit" tamano="sm" cargando={guardando}>
                              Guardar la línea
                            </Boton>
                          </span>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={linea.id} className="group flex items-start gap-2 text-sm">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-borde-fuerte" />
                      <span className="flex-1 text-texto">
                        {linea.etiqueta && (
                          <span className="font-medium text-texto">{linea.etiqueta}: </span>
                        )}
                        {linea.detalle}
                      </span>
                      {puedeEditar && (
                        <span className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setErrorEdicion(null)
                              setEditando(linea.id)
                            }}
                            aria-label={`Editar ${linea.etiqueta ?? linea.detalle.slice(0, 30)}`}
                            className="rounded p-3.5 text-texto-tenue hover:text-acento sm:p-1"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          {/* Antes esto era un formulario que borraba de una:
                              el icono está agrandado para el guante y se
                              acierta sin querer. Ahora pregunta primero. */}
                          <button
                            type="button"
                            onClick={() =>
                              setPorQuitar({
                                id: linea.id,
                                seccion: seccion.seccion,
                                texto: linea.etiqueta
                                  ? `${linea.etiqueta}: ${linea.detalle}`
                                  : linea.detalle,
                              })
                            }
                            aria-label={`Quitar ${linea.etiqueta ?? linea.detalle.slice(0, 30)}`}
                            className="rounded p-3.5 text-texto-tenue hover:text-peligro sm:p-1"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))
        )}

        {/* Va dentro de la condición: la pregunta nombra la línea que se pidió
            quitar, y sin ella no hay nada que nombrar. */}
        {porQuitar && (
          <ConfirmarAccion
            abierta
            alCerrar={() => setPorQuitar(null)}
            alConfirmar={confirmarQuitar}
            titulo="¿Quitar la línea de la ficha?"
            detalle={`Se va «${porQuitar.texto}» de ${porQuitar.seccion}. Habrá que volver a escribirla, y lo que no queda en la ficha el taller no lo fabrica.`}
            etiquetaConfirmar="Sí, quitar la línea"
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Accesorios({
  cotizacionId,
  accesorios,
  puedeEditar,
}: {
  cotizacionId: string
  accesorios: AccesorioCotizado[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarAccesorio, null)
  const [, accionQuitar] = useActionState(quitarAccesorio, null)

  const [editando, setEditando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  // El accesorio que se pidió quitar, esperando la confirmación: la pregunta
  // lo nombra con la cantidad, que es como figura en la ficha.
  const [porQuitar, setPorQuitar] = useState<AccesorioCotizado | null>(null)

  function confirmarQuitar() {
    if (!porQuitar) return

    const datos = new FormData()
    datos.set('id', porQuitar.id)
    datos.set('cotizacion_id', cotizacionId)

    // Dentro de la transición a propósito: React avisa por consola si la acción
    // de `useActionState` se llama fuera de una, y el pendiente no se actualiza.
    iniciarTransicion(() => accionQuitar(datos))
    setPorQuitar(null)
  }

  async function guardarAccesorio(datos: FormData) {
    setErrorEdicion(null)
    setGuardando(true)
    const salida = await editarAccesorio(null, datos)
    setGuardando(false)

    if (!salida.ok) {
      setErrorEdicion(salida.error)
      return
    }

    setEditando(null)
    iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Accesorios y equipamiento"
        descripcion="Lo que la cotización promete entregar. El que dice «solo el soporte» va marcado."
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)}>
              {abierto ? <Minus aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
              Agregar
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {abierto && puedeEditar && (
          <form action={accion} className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />
            <div className="grid gap-3 sm:grid-cols-5">
              <Campo etiqueta="Cantidad" htmlFor="cantidad" requerido>
                <Entrada
                  id="cantidad"
                  name="cantidad"
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0.5"
                  defaultValue={1}
                  required
                />
              </Campo>
              <Campo etiqueta="Unidad" htmlFor="unidad">
                <Entrada id="unidad" name="unidad" defaultValue="unid" />
              </Campo>
              <Campo etiqueta="Descripción" htmlFor="descripcion" requerido className="sm:col-span-3">
                <Entrada id="descripcion" name="descripcion" required placeholder="Porta conos de seguridad" />
              </Campo>
            </div>
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
              <input
                type="checkbox"
                name="incluye_el_accesorio"
                defaultChecked
                className="size-5 accent-[var(--acento)] sm:size-4"
              />
              Se entrega también lo que va adentro
            </label>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Aviso resultado={resultado} />
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar accesorio
              </Boton>
            </div>
          </form>
        )}

        {accesorios.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-texto">Sin accesorios declarados</p>
            <p className="mt-1 text-xs text-texto-suave">
              {puedeEditar
                ? 'Lo que no figura acá no se prometió: el taller no lo monta y el cliente no lo reclama.'
                : 'Los declara quien elabora la cotización, mientras siga abierta.'}
            </p>
            {puedeEditar && !abierto && (
              <div className="mt-4 flex justify-center">
                <Boton tamano="sm" onClick={() => setAbierto(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  Agregar el primero
                </Boton>
              </div>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--borde)]">
            {accesorios.map((a) =>
              editando === a.id ? (
                <li key={a.id} className="py-2">
                  <form
                    action={guardarAccesorio}
                    className="grid gap-2 rounded-[var(--radius-base)] bg-superficie-2 p-3 sm:grid-cols-5"
                  >
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="cotizacion_id" value={cotizacionId} />

                    <Campo etiqueta="Cantidad" htmlFor={`cantidad-${a.id}`} requerido>
                      <Entrada
                        id={`cantidad-${a.id}`}
                        name="cantidad"
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0.5"
                        required
                        defaultValue={Number(a.cantidad)}
                        className="tabular text-right"
                      />
                    </Campo>

                    <Campo etiqueta="Unidad" htmlFor={`unidad-${a.id}`}>
                      <Entrada id={`unidad-${a.id}`} name="unidad" defaultValue={a.unidad} />
                    </Campo>

                    <Campo
                      etiqueta="Descripción"
                      htmlFor={`descripcion-${a.id}`}
                      requerido
                      className="sm:col-span-3"
                    >
                      <Entrada
                        id={`descripcion-${a.id}`}
                        name="descripcion"
                        required
                        autoFocus
                        defaultValue={a.descripcion}
                      />
                    </Campo>

                    <Campo
                      etiqueta="Observación"
                      htmlFor={`observacion-${a.id}`}
                      className="sm:col-span-5"
                    >
                      <Entrada
                        id={`observacion-${a.id}`}
                        name="observacion"
                        defaultValue={a.observacion ?? ''}
                        placeholder="Lo que haya que aclarar de este accesorio"
                      />
                    </Campo>

                    <label className="flex min-h-11 items-center gap-2 text-sm text-texto sm:col-span-5 sm:min-h-0">
                      <input
                        type="checkbox"
                        name="incluye_el_accesorio"
                        defaultChecked={a.incluye_el_accesorio}
                        className="size-5 accent-[var(--acento)] sm:size-4"
                      />
                      Se entrega también lo que va adentro
                    </label>

                    <div className="flex items-center justify-between gap-3 sm:col-span-5">
                      {errorEdicion ? (
                        <p role="alert" className="text-xs text-peligro">
                          {errorEdicion}
                        </p>
                      ) : (
                        <span />
                      )}
                      <span className="flex gap-2">
                        <Boton
                          type="button"
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => {
                            setErrorEdicion(null)
                            setEditando(null)
                          }}
                        >
                          Cancelar
                        </Boton>
                        <Boton type="submit" tamano="sm" cargando={guardando}>
                          Guardar el accesorio
                        </Boton>
                      </span>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={a.id} className="group flex items-center gap-3 py-1.5 text-sm">
                  <span className="tabular w-16 shrink-0 text-right text-texto-suave">
                    {formatearCantidad(a.cantidad)} {a.unidad}
                  </span>
                  <span className="min-w-0 flex-1 text-texto">
                    {a.descripcion}
                    {a.observacion && (
                      <span className="block text-[11px] text-texto-suave">{a.observacion}</span>
                    )}
                  </span>
                  {a.incluye_el_accesorio ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-exito">
                      <Check aria-hidden className="size-3.5" />
                      completo
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-aviso">
                      <X aria-hidden className="size-3.5" />
                      solo el soporte
                    </span>
                  )}
                  {puedeEditar && (
                    <span className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setErrorEdicion(null)
                          setEditando(a.id)
                        }}
                        aria-label={`Editar ${a.descripcion}`}
                        className="rounded p-3.5 text-texto-tenue hover:text-acento sm:p-1"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {/* Igual que en las especificaciones: el borrado de un
                          toque se cambió por la pregunta, que dice qué se va. */}
                      <button
                        type="button"
                        onClick={() => setPorQuitar(a)}
                        aria-label={`Quitar ${a.descripcion}`}
                        className="rounded p-3.5 text-texto-tenue hover:text-peligro sm:p-1"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        {/* Va dentro de la condición: la pregunta nombra el accesorio que se
            pidió quitar, y sin él no hay nada que nombrar. */}
        {porQuitar && (
          <ConfirmarAccion
            abierta
            alCerrar={() => setPorQuitar(null)}
            alConfirmar={confirmarQuitar}
            titulo="¿Quitar el accesorio?"
            detalle={`Se va «${formatearCantidad(porQuitar.cantidad)} ${porQuitar.unidad} · ${porQuitar.descripcion}». Lo que no figura acá no se prometió: el taller no lo monta y el cliente no lo reclama.`}
            etiquetaConfirmar="Sí, quitar el accesorio"
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
