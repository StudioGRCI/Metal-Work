'use client'

import { Check, Minus, Plus, Trash2, Wand2, X } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { AccesorioCotizado, SeccionFicha } from '@/lib/datos/ficha'
import { cantidad as formatearCantidad } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  agregarAccesorio,
  agregarLineaFicha,
  aplicarPlantilla,
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
                step="0.01"
                defaultValue={cabecera.peso_neto_tn ?? ''}
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Largo" htmlFor="largo_m" ayuda="Metros">
              <Entrada id="largo_m" name="largo_m" type="number" step="0.01" defaultValue={cabecera.largo_m ?? ''} />
            </Campo>
            <Campo etiqueta="Ancho" htmlFor="ancho_m" ayuda="Metros">
              <Entrada id="ancho_m" name="ancho_m" type="number" step="0.01" defaultValue={cabecera.ancho_m ?? ''} />
            </Campo>
            <Campo etiqueta="Alto" htmlFor="alto_m" ayuda="Metros">
              <Entrada id="alto_m" name="alto_m" type="number" step="0.01" defaultValue={cabecera.alto_m ?? ''} />
            </Campo>
            <Campo etiqueta="Garantía" htmlFor="garantia_meses" ayuda="Meses">
              <Entrada
                id="garantia_meses"
                name="garantia_meses"
                type="number"
                min="0"
                max="120"
                defaultValue={cabecera.garantia_meses}
              />
            </Campo>
          </div>

          <div className="flex flex-wrap gap-5 pt-1">
            <label className="flex items-center gap-2 text-sm text-texto">
              <input
                type="checkbox"
                name="incluye_igv"
                defaultChecked={cabecera.incluye_igv}
                className="size-4 accent-[var(--acento)]"
              />
              El precio incluye IGV
            </label>
            <label className="flex items-center gap-2 text-sm text-texto">
              <input
                type="checkbox"
                name="plazo_en_habiles"
                defaultChecked={cabecera.plazo_en_habiles}
                className="size-4 accent-[var(--acento)]"
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
            <Boton type="submit" cargando={enviando}>
              Guardar
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
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarLineaFicha, null)
  const [, accionQuitar] = useActionState(quitarLineaFicha, null)

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
                Agregar
              </Boton>
            </div>
          </form>
        )}

        {secciones.length === 0 ? (
          <p className="py-6 text-center text-sm text-texto-suave">
            Esta cotización todavía no tiene ficha técnica. Aplica una de las que ya están escritas
            y ajusta lo que cambie.
          </p>
        ) : (
          secciones.map((seccion) => (
            <section key={seccion.seccion}>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-acento uppercase">
                {seccion.seccion}
              </h3>
              <ul className="space-y-1">
                {seccion.lineas.map((linea) => (
                  <li key={linea.id} className="group flex items-start gap-2 text-sm">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-borde-fuerte" />
                    <span className="flex-1 text-texto">
                      {linea.etiqueta && (
                        <span className="font-medium text-texto">{linea.etiqueta}: </span>
                      )}
                      {linea.detalle}
                    </span>
                    {puedeEditar && (
                      <form action={accionQuitar} className="opacity-0 group-hover:opacity-100">
                        <input type="hidden" name="id" value={linea.id} />
                        <input type="hidden" name="cotizacion_id" value={cotizacionId} />
                        <button
                          type="submit"
                          aria-label={`Quitar ${linea.etiqueta ?? linea.detalle.slice(0, 30)}`}
                          className="rounded p-1 text-texto-tenue hover:text-peligro"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
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
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarAccesorio, null)
  const [, accionQuitar] = useActionState(quitarAccesorio, null)

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
                <Entrada id="cantidad" name="cantidad" type="number" step="0.5" min="0.5" defaultValue={1} required />
              </Campo>
              <Campo etiqueta="Unidad" htmlFor="unidad">
                <Entrada id="unidad" name="unidad" defaultValue="unid" />
              </Campo>
              <Campo etiqueta="Descripción" htmlFor="descripcion" requerido className="sm:col-span-3">
                <Entrada id="descripcion" name="descripcion" required placeholder="Porta conos de seguridad" />
              </Campo>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-texto">
              <input
                type="checkbox"
                name="incluye_el_accesorio"
                defaultChecked
                className="size-4 accent-[var(--acento)]"
              />
              Se entrega también lo que va adentro
            </label>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Aviso resultado={resultado} />
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar
              </Boton>
            </div>
          </form>
        )}

        {accesorios.length === 0 ? (
          <p className="py-6 text-center text-sm text-texto-suave">
            Sin accesorios declarados.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--borde)]">
            {accesorios.map((a) => (
              <li key={a.id} className="group flex items-center gap-3 py-1.5 text-sm">
                <span className="tabular w-16 shrink-0 text-right text-texto-suave">
                  {formatearCantidad(a.cantidad)} {a.unidad}
                </span>
                <span className="flex-1 text-texto">{a.descripcion}</span>
                {a.incluye_el_accesorio ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-exito">
                    <Check aria-hidden className="size-3.5" />
                    completo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] text-aviso">
                    <X aria-hidden className="size-3.5" />
                    solo el soporte
                  </span>
                )}
                {puedeEditar && (
                  <form action={accionQuitar} className="opacity-0 group-hover:opacity-100">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="cotizacion_id" value={cotizacionId} />
                    <button
                      type="submit"
                      aria-label={`Quitar ${a.descripcion}`}
                      className="rounded p-1 text-texto-tenue hover:text-peligro"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
