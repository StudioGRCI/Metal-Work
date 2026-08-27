'use client'

import { Check, Minus, Plus, Trash2, Wand2 } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Progreso } from '@/components/ui/progreso'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { AccesorioOT, PasoVerificacion, RepuestoOT } from '@/lib/datos/ficha-ot'
import { cantidad as formatearCantidad, fecha } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  agregarAccesorioOT,
  agregarRepuesto,
  anotarVerificacion,
  armarFicha,
  guardarFichaFisica,
  marcarAccesorio,
  marcarVerificacion,
  quitarAccesorioOT,
  quitarRepuesto,
} from './acciones-ficha'

export type FichaFisica = {
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  capacidad_carga: string | null
  ruedas: string | null
  tipo_llantas: string | null
  cantidad_ejes: number | null
  tipo_suspension: string | null
  colores: string | null
  caracteristicas_especiales: string | null
  correo_contacto: string | null
  encargado_produccion_id: string | null
}

type Persona = { id: string; nombres: string; apellidos: string }

function Aviso({
  resultado,
}: {
  resultado: { ok?: boolean; error?: string; mensaje?: string } | null
}) {
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
 * La orden de trabajo tal como la llena el taller.
 *
 * En el formato de papel esto son cuatro secciones: las medidas de la unidad,
 * los accesorios con su visto bueno uno por uno, los repuestos, y la lista de
 * verificación con sus dos pasadas. Se llenan con lapicero mientras la unidad
 * está en planta, así que acá tienen que poder marcarse de a uno y sin abrir
 * un formulario cada vez.
 */
export function FichaTaller({
  ordenId,
  ficha,
  accesorios,
  repuestos,
  verificaciones,
  personal,
  puedeEditar,
  puedeEscribirOrden,
  puedeArmar,
}: {
  ordenId: string
  ficha: FichaFisica
  accesorios: AccesorioOT[]
  repuestos: RepuestoOT[]
  verificaciones: PasoVerificacion[]
  personal: Persona[]
  /** Marcar el V°B° y anotar la verificación: taller y calidad. */
  puedeEditar: boolean
  /** Escribir sobre la orden misma -medidas, colores, encargado-. */
  puedeEscribirOrden: boolean
  /** Poner y quitar líneas de la ficha: lo arma el taller. */
  puedeArmar: boolean
}) {
  const sinArmar = accesorios.length === 0 && verificaciones.length === 0

  return (
    <div className="space-y-4">
      {puedeEditar && sinArmar && <ArmarFicha ordenId={ordenId} />}

      {/* Cada sección con el permiso que su tabla honra de verdad: si la
          pantalla ofrece más de lo que la base acepta, el botón responde que
          sí y no guarda nada. */}
      <Medidas ordenId={ordenId} ficha={ficha} personal={personal} puedeEditar={puedeEscribirOrden} />

      <Verificacion
        ordenId={ordenId}
        pasos={verificaciones}
        puedeEditar={puedeEditar}
        sinArmar={sinArmar}
      />

      <Accesorios
        ordenId={ordenId}
        accesorios={accesorios}
        puedeEditar={puedeEditar}
        puedeArmar={puedeArmar}
      />

      <Repuestos ordenId={ordenId} repuestos={repuestos} puedeEditar={puedeArmar} />
    </div>
  )
}

function ArmarFicha({ ordenId }: { ordenId: string }) {
  const [resultado, accion, enviando] = useActionState(armarFicha, null)

  return (
    <Tarjeta className="border-acento">
      <TarjetaCuerpo className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-texto">Esta orden todavía no tiene ficha de taller</p>
          <p className="text-xs text-texto-suave">
            Se arma con los accesorios que se cotizaron y los pasos de verificación de su carrocería.
            En las órdenes nuevas se arma sola al aprobarlas.
          </p>
        </div>
        <form action={accion}>
          <input type="hidden" name="orden_id" value={ordenId} />
          <Boton type="submit" cargando={enviando}>
            <Wand2 aria-hidden className="size-4" />
            Armar ficha
          </Boton>
        </form>
        <div className="w-full">
          <Aviso resultado={resultado} />
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Medidas({
  ordenId,
  ficha,
  personal,
  puedeEditar,
}: {
  ordenId: string
  ficha: FichaFisica
  personal: Persona[]
  puedeEditar: boolean
}) {
  const [resultado, accion, enviando] = useActionState(guardarFichaFisica, null)

  if (!puedeEditar) {
    const encargado = personal.find((p) => p.id === ficha.encargado_produccion_id)
    return (
      <Tarjeta>
        <TarjetaCabecera titulo="Medidas, colores y características especiales" />
        <TarjetaCuerpo className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Dato titulo="Largo" valor={ficha.largo_m ? `${ficha.largo_m} m` : null} />
          <Dato titulo="Ancho" valor={ficha.ancho_m ? `${ficha.ancho_m} m` : null} />
          <Dato titulo="Alto" valor={ficha.alto_m ? `${ficha.alto_m} m` : null} />
          <Dato titulo="Capacidad de carga" valor={ficha.capacidad_carga} />
          <Dato titulo="Ruedas" valor={ficha.ruedas} />
          <Dato titulo="Tipo de llantas" valor={ficha.tipo_llantas} />
          <Dato titulo="Cantidad de ejes" valor={ficha.cantidad_ejes} />
          <Dato titulo="Tipo de suspensión" valor={ficha.tipo_suspension} />
          <Dato
            titulo="Encargado de producción"
            valor={encargado ? `${encargado.nombres} ${encargado.apellidos}` : null}
          />
          <Dato titulo="Colores" valor={ficha.colores} />
          <Dato titulo="Correo de contacto" valor={ficha.correo_contacto} />
          {ficha.caracteristicas_especiales && (
            <p className="text-xs whitespace-pre-wrap text-texto-suave sm:col-span-3">
              {ficha.caracteristicas_especiales}
            </p>
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Medidas, colores y características especiales"
        descripcion="Lo que el taller necesita tener a la vista para fabricar la unidad."
      />
      <TarjetaCuerpo>
        <form action={accion} className="space-y-3">
          <input type="hidden" name="orden_id" value={ordenId} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Largo" htmlFor="largo_m" ayuda="Metros">
              <Entrada id="largo_m" name="largo_m" type="number" step="0.01" defaultValue={ficha.largo_m ?? ''} />
            </Campo>
            <Campo etiqueta="Ancho" htmlFor="ancho_m" ayuda="Metros">
              <Entrada id="ancho_m" name="ancho_m" type="number" step="0.01" defaultValue={ficha.ancho_m ?? ''} />
            </Campo>
            <Campo etiqueta="Alto" htmlFor="alto_m" ayuda="Metros">
              <Entrada id="alto_m" name="alto_m" type="number" step="0.01" defaultValue={ficha.alto_m ?? ''} />
            </Campo>
            <Campo etiqueta="Capacidad de carga" htmlFor="capacidad_carga" ayuda="Como va en la OT">
              <Entrada
                id="capacidad_carga"
                name="capacidad_carga"
                defaultValue={ficha.capacidad_carga ?? ''}
                placeholder="37 TN"
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Ruedas" htmlFor="ruedas">
              <Entrada id="ruedas" name="ruedas" defaultValue={ficha.ruedas ?? ''} placeholder="12 ruedas" />
            </Campo>
            <Campo etiqueta="Tipo de llantas" htmlFor="tipo_llantas">
              <Entrada
                id="tipo_llantas"
                name="tipo_llantas"
                defaultValue={ficha.tipo_llantas ?? ''}
                placeholder="295/80 R22.5"
              />
            </Campo>
            <Campo etiqueta="Cantidad de ejes" htmlFor="cantidad_ejes">
              <Entrada
                id="cantidad_ejes"
                name="cantidad_ejes"
                type="number"
                min="1"
                max="8"
                defaultValue={ficha.cantidad_ejes ?? ''}
              />
            </Campo>
            <Campo etiqueta="Tipo de suspensión" htmlFor="tipo_suspension">
              <Entrada
                id="tipo_suspension"
                name="tipo_suspension"
                defaultValue={ficha.tipo_suspension ?? ''}
                placeholder="Neumática"
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Campo etiqueta="Colores" htmlFor="colores">
              <Entrada id="colores" name="colores" defaultValue={ficha.colores ?? ''} placeholder="Blanco / rojo" />
            </Campo>
            <Campo
              etiqueta="Encargado de producción"
              htmlFor="encargado_produccion_id"
              ayuda="Quien la lleva en planta"
            >
              <Seleccion
                id="encargado_produccion_id"
                name="encargado_produccion_id"
                defaultValue={ficha.encargado_produccion_id ?? ''}
              >
                <option value="">Sin asignar</option>
                {personal.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.apellidos}, {p.nombres}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Correo de contacto" htmlFor="correo_contacto" ayuda="A dónde se avisa el avance">
              <Entrada
                id="correo_contacto"
                name="correo_contacto"
                type="email"
                defaultValue={ficha.correo_contacto ?? ''}
              />
            </Campo>
          </div>

          <Campo etiqueta="Características especiales" htmlFor="caracteristicas_especiales">
            <AreaTexto
              id="caracteristicas_especiales"
              name="caracteristicas_especiales"
              rows={3}
              defaultValue={ficha.caracteristicas_especiales ?? ''}
              placeholder="Lo que esta unidad tiene y las demás no."
            />
          </Campo>

          <div className="flex items-center justify-between gap-3">
            <Aviso resultado={resultado} />
            <Boton type="submit" cargando={enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Verificacion({
  ordenId,
  pasos,
  puedeEditar,
  sinArmar,
}: {
  ordenId: string
  pasos: PasoVerificacion[]
  puedeEditar: boolean
  sinArmar: boolean
}) {
  const [, accionMarcar] = useActionState(marcarVerificacion, null)
  const [resultado, accionAnotar] = useActionState(anotarVerificacion, null)
  const [anotando, setAnotando] = useState<string | null>(null)

  const hechos = pasos.filter((p) => p.avance_2).length
  const avance = pasos.length ? Math.round((hechos / pasos.length) * 100) : 0

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Verificación y funcionamiento"
        descripcion={
          pasos.length
            ? `${hechos} de ${pasos.length} pasos revisados. El avance 1 es la primera pasada; el 2, la revisión.`
            : 'Los pasos se traen de la carrocería al aprobar la orden.'
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {pasos.length > 0 && <Progreso valor={avance} mostrarValor />}

        {pasos.length === 0 ? (
          <p className="py-6 text-center text-sm text-texto-suave">
            {sinArmar
              ? 'Todavía no hay pasos que verificar en esta orden.'
              : 'Esta carrocería no tiene pasos de verificación configurados.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-borde bg-superficie-2">
                <tr>
                  <th className="w-10 px-2 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                    N.º
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                    Descripción
                  </th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                    Responsable
                  </th>
                  <th className="w-20 px-2 py-2 text-center text-[11px] font-semibold text-texto-suave uppercase">
                    Avance 1
                  </th>
                  <th className="w-20 px-2 py-2 text-center text-[11px] font-semibold text-texto-suave uppercase">
                    Avance 2
                  </th>
                </tr>
              </thead>
              <tbody>
                {pasos.map((paso) => (
                  <tr key={paso.id} className="border-b border-borde align-top last:border-0">
                    <td className="tabular px-2 py-2 text-right text-texto-suave">{paso.numero}</td>
                    <td className="px-3 py-2">
                      <span className={cn('text-texto', paso.avance_2 && 'text-texto-suave line-through')}>
                        {paso.descripcion}
                      </span>
                      {paso.observaciones && (
                        <p className="mt-0.5 text-xs text-aviso">{paso.observaciones}</p>
                      )}
                      {puedeEditar &&
                        (anotando === paso.id ? (
                          <form
                            action={accionAnotar}
                            className="mt-1 flex gap-2"
                            onSubmit={() => setAnotando(null)}
                          >
                            <input type="hidden" name="id" value={paso.id} />
                            <input type="hidden" name="orden_id" value={ordenId} />
                            <Entrada
                              name="observaciones"
                              defaultValue={paso.observaciones ?? ''}
                              placeholder="Qué quedó pendiente"
                              className="text-xs"
                            />
                            <Boton type="submit" tamano="sm">
                              Guardar
                            </Boton>
                          </form>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAnotando(paso.id)}
                            className="mt-1 block text-[11px] text-texto-tenue hover:text-acento"
                          >
                            {paso.observaciones ? 'Editar observación' : 'Anotar observación'}
                          </button>
                        ))}
                    </td>
                    <td className="px-3 py-2 text-xs text-texto-suave">
                      {paso.responsable
                        ? `${paso.responsable.nombres} ${paso.responsable.apellidos}`
                        : '—'}
                    </td>
                    <Casilla
                      accion={accionMarcar}
                      ordenId={ordenId}
                      pasoId={paso.id}
                      avance="1"
                      marcado={paso.avance_1}
                      cuando={paso.avance_1_en}
                      puedeEditar={puedeEditar}
                      etiqueta={`Avance 1 del paso ${paso.numero}`}
                    />
                    <Casilla
                      accion={accionMarcar}
                      ordenId={ordenId}
                      pasoId={paso.id}
                      avance="2"
                      marcado={paso.avance_2}
                      cuando={paso.avance_2_en}
                      puedeEditar={puedeEditar && paso.avance_1}
                      etiqueta={`Avance 2 del paso ${paso.numero}`}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Aviso resultado={resultado} />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Casilla({
  accion,
  ordenId,
  pasoId,
  avance,
  marcado,
  cuando,
  puedeEditar,
  etiqueta,
}: {
  accion: (datos: FormData) => void
  ordenId: string
  pasoId: string
  avance: '1' | '2'
  marcado: boolean
  cuando: string | null
  puedeEditar: boolean
  etiqueta: string
}) {
  return (
    <td className="px-2 py-2 text-center">
      <form action={accion}>
        <input type="hidden" name="id" value={pasoId} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <input type="hidden" name="avance" value={avance} />
        <input type="hidden" name="valor" value={marcado ? 'no' : 'si'} />
        <button
          type="submit"
          disabled={!puedeEditar}
          aria-label={etiqueta}
          aria-pressed={marcado}
          className={cn(
            'mx-auto flex size-6 items-center justify-center rounded border transition-colors',
            marcado
              ? 'border-exito bg-exito-suave text-exito'
              : 'border-borde-fuerte text-transparent hover:border-acento',
            !puedeEditar && 'cursor-not-allowed opacity-40',
          )}
        >
          <Check aria-hidden className="size-4" />
        </button>
      </form>
      {cuando && <p className="mt-0.5 text-[10px] text-texto-tenue">{fecha(cuando)}</p>}
    </td>
  )
}

function Accesorios({
  ordenId,
  accesorios,
  puedeEditar,
  puedeArmar,
}: {
  ordenId: string
  accesorios: AccesorioOT[]
  /** Marcar el visto bueno: taller y calidad. */
  puedeEditar: boolean
  /** Agregar y quitar accesorios: solo el taller. */
  puedeArmar: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarAccesorioOT, null)
  const [, accionMarcar] = useActionState(marcarAccesorio, null)
  const [, accionQuitar] = useActionState(quitarAccesorioOT, null)

  const puestos = accesorios.filter((a) => a.verificado).length

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Accesorios"
        descripcion={
          accesorios.length
            ? `${puestos} de ${accesorios.length} con visto bueno. Salen de lo que se cotizó.`
            : 'Salen de lo que se cotizó: lo prometido es lo que hay que montar.'
        }
        acciones={
          puedeArmar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)}>
              {abierto ? (
                <Minus aria-hidden className="size-3.5" />
              ) : (
                <Plus aria-hidden className="size-3.5" />
              )}
              Agregar
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {abierto && puedeArmar && (
          <form action={accion} className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <input type="hidden" name="orden_id" value={ordenId} />
            <div className="grid gap-3 sm:grid-cols-5">
              <Campo etiqueta="Cantidad" htmlFor="cantidad" requerido>
                <Entrada
                  id="cantidad"
                  name="cantidad"
                  type="number"
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
                <Entrada
                  id="descripcion"
                  name="descripcion"
                  required
                  placeholder="Guardafango posterior"
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

        {accesorios.length === 0 ? (
          <p className="py-6 text-center text-sm text-texto-suave">
            Esta orden todavía no tiene accesorios que montar.
          </p>
        ) : (
          <ul className="divide-y divide-borde">
            {accesorios.map((a) => (
              <li key={a.id} className="group flex items-center gap-3 py-2">
                <form action={accionMarcar}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="orden_id" value={ordenId} />
                  <input type="hidden" name="verificado" value={a.verificado ? 'no' : 'si'} />
                  <button
                    type="submit"
                    disabled={!puedeEditar}
                    aria-label={`Visto bueno de ${a.descripcion}`}
                    aria-pressed={a.verificado}
                    className={cn(
                      'flex size-6 items-center justify-center rounded border transition-colors',
                      a.verificado
                        ? 'border-exito bg-exito-suave text-exito'
                        : 'border-borde-fuerte text-transparent hover:border-acento',
                      !puedeEditar && 'cursor-not-allowed opacity-40',
                    )}
                  >
                    <Check aria-hidden className="size-4" />
                  </button>
                </form>

                <span className="tabular w-16 shrink-0 text-right text-sm text-texto-suave">
                  {formatearCantidad(a.cantidad)} {a.unidad}
                </span>

                <span className="flex-1 text-sm text-texto">
                  {a.descripcion}
                  {!a.incluye_el_accesorio && (
                    <span className="ml-2 text-[11px] text-aviso">(no incluye el accesorio)</span>
                  )}
                  {a.verificado && a.verificador && (
                    <span className="ml-2 text-[11px] text-texto-tenue">
                      V°B° {a.verificador.nombres} {a.verificador.apellidos}
                      {a.verificado_en ? ` · ${fecha(a.verificado_en)}` : ''}
                    </span>
                  )}
                </span>

                {puedeArmar && (
                  <form action={accionQuitar} className="opacity-0 group-hover:opacity-100">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="orden_id" value={ordenId} />
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

function Repuestos({
  ordenId,
  repuestos,
  puedeEditar,
}: {
  ordenId: string
  repuestos: RepuestoOT[]
  puedeEditar: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarRepuesto, null)
  const [, accionQuitar] = useActionState(quitarRepuesto, null)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Repuestos"
        descripcion="Lo que se entrega con la unidad, con su marca."
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)}>
              {abierto ? (
                <Minus aria-hidden className="size-3.5" />
              ) : (
                <Plus aria-hidden className="size-3.5" />
              )}
              Agregar
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {abierto && puedeEditar && (
          <form action={accion} className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <input type="hidden" name="orden_id" value={ordenId} />
            <div className="grid gap-3 sm:grid-cols-5">
              <Campo etiqueta="Cantidad" htmlFor="cantidad_repuesto" requerido>
                <Entrada
                  id="cantidad_repuesto"
                  name="cantidad"
                  type="number"
                  step="1"
                  min="1"
                  defaultValue={1}
                  required
                />
              </Campo>
              <Campo etiqueta="Descripción" htmlFor="descripcion_repuesto" requerido className="sm:col-span-2">
                <Entrada
                  id="descripcion_repuesto"
                  name="descripcion"
                  required
                  placeholder="Zapata de freno"
                />
              </Campo>
              <Campo etiqueta="Marca" htmlFor="marca_repuesto" className="sm:col-span-2">
                <Entrada id="marca_repuesto" name="marca" placeholder="SUNTECH" />
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

        {repuestos.length === 0 ? (
          <p className="py-6 text-center text-sm text-texto-suave">
            Esta orden no entrega repuestos.
          </p>
        ) : (
          <ul className="divide-y divide-borde">
            {repuestos.map((r) => (
              <li key={r.id} className="group flex items-center gap-3 py-2 text-sm">
                <span className="tabular w-12 shrink-0 text-right text-texto-suave">
                  {formatearCantidad(r.cantidad)}
                </span>
                <span className="flex-1 text-texto">{r.descripcion}</span>
                <span className="text-xs text-texto-suave">{r.marca ?? '—'}</span>
                {puedeEditar && (
                  <form action={accionQuitar} className="opacity-0 group-hover:opacity-100">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="orden_id" value={ordenId} />
                    <button
                      type="submit"
                      aria-label={`Quitar ${r.descripcion}`}
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

function Dato({ titulo, valor }: { titulo: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-3 border-b border-borde py-1.5 last:border-0">
      <span className="text-texto-suave">{titulo}</span>
      <span className="text-right font-medium text-texto">{valor || '—'}</span>
    </div>
  )
}
