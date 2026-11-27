'use client'

import { Ban, Check, ClipboardCheck, ListPlus, RotateCcw, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { AreaParaInspeccionar, CuentaParaAsignar, PuntoDeLista } from '@/lib/datos/ssoma'
import {
  DIAS_PARA_REGISTRAR_INSPECCION,
  RESULTADO_INSPECCION,
  RESULTADOS_INSPECCION,
  TIPO_INSPECCION_SSOMA,
  TIPOS_INSPECCION_SSOMA,
  type ResultadoInspeccion,
} from '@/lib/dominio/ssoma'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { sumarDias } from '@/lib/format'
import { cn } from '@/lib/utils'

import { opcionesDeCuentas } from '../[id]/controles'
import { activarPuntoSsoma, agregarPuntoSsoma, anularInspeccionSsoma, registrarInspeccionSsoma } from '../acciones'

/** Lo que dice cómo terminó el registro: el botón y el renglón de estado del encabezado lo comparten. */
const CLAVE = 'ssoma:inspeccion'
type Entro = { mensaje: string; id: string | null }

/** El verde del registro, con «Ver la inspección»: siempre montado, para que se anuncie. */
export function EstadoDeLaInspeccion() {
  const [entro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  return (
    <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'}>
      {entro?.mensaje}
      {entro?.id && (
        <>
          {' '}
          <Link href={`/ssoma/inspecciones/${entro.id}`} className="font-medium underline underline-offset-2">
            Ver la inspección
          </Link>
        </>
      )}
    </p>
  )
}

/**
 * SSOMA registra la inspección de un área con su lista de verificación: marca
 * cada punto y, del que no está conforme, dice qué encontró y encarga la acción
 * que lo corrige. El id vive aquí (`useIdDelEnvio`): tras «No llegó la
 * respuesta», volver a abrir pregunta si la anterior entró, y no entra dos veces.
 */
export function NuevaInspeccion({
  areas,
  puntos,
  cuentas,
  hoy,
}: {
  areas: AreaParaInspeccionar[]
  /** Los puntos vigentes de la lista: los de todas las áreas y los de cada una. */
  puntos: PuntoDeLista[]
  cuentas: CuentaParaAsignar[]
  /** El día de hoy en Lima, para los límites de las fechas. */
  hoy: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('inspeccion_ssoma', () => refrescarSiEsDeLaPestana(router))
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    async (previo: unknown, datos: FormData) => {
      id.salio()
      const r = await registrarInspeccionSsoma(previo, datos)
      // La lista cambió con la ventana abierta: se pone al día sin cerrarla. Lo marcado va por punto y se conserva;
      // «vuelve a abrirla» no servía, porque la ventana volvía a abrir con la lista de cuando se pintó la página.
      if (!r.ok && LA_LISTA_CAMBIO.test(r.error ?? '')) refrescarSiEsDeLaPestana(router)
      return r
    },
    (r) => {
      id.otro()
      setAbierta(false)
      setEntro({ mensaje: r.mensaje ?? 'Inspección registrada.', id: r.datos?.id ?? null })
    },
    { alYaEntrar: id.otro },
  )
  return (
    <>
      <Boton
        type="button"
        data-nueva-inspeccion
        onClick={() => {
          limpiar()
          setEntro(null)
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
          // La lista y las cuentas, como están ahora: la página pudo pintarse hace horas.
          refrescarSiEsDeLaPestana(router)
        }}
      >
        <ClipboardCheck aria-hidden className="size-4" />
        Nueva inspección
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nueva inspección"
        descripcion="Marca cada punto de la lista del área. Lo que no esté conforme lleva su acción correctiva."
        ancho="xl"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioInspeccion
            key={`${vez}:${id.id}`}
            id={id.id}
            areas={areas}
            puntos={puntos}
            cuentas={cuentas}
            hoy={hoy}
            alEnviar={alEnviar}
            enviando={enviando}
            error={error}
            alLimpiar={limpiar}
            alCancelar={() => setAbierta(false)}
          />
        )}
      </Ventana>
    </>
  )
}

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

/**
 * Cada resultado se marca con un toque; el elegido toma su color, su borde grueso
 * y un visto. El visto y el borde, porque el gris de «No aplica» casi no se
 * distinguía de un punto sin marcar al repasar la lista con sol en el taller.
 */
const BOTON_RESULTADO =
  'group/resultado flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-base)] border border-borde-fuerte px-2 text-center text-sm text-texto has-[:checked]:border-2 has-[:checked]:font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-acento'
const COLOR_RESULTADO: Record<ResultadoInspeccion, string> = {
  CONFORME: 'has-[:checked]:border-exito has-[:checked]:bg-exito-suave',
  NO_CONFORME: 'has-[:checked]:border-peligro has-[:checked]:bg-peligro-suave',
  NO_APLICA: 'has-[:checked]:border-texto has-[:checked]:bg-neutro-suave',
}

/** Lo que se marca de un punto; del no conforme, lo que se encontró y su acción. */
type Marca = { areaDelPunto: string | null; texto: string; resultado: ResultadoInspeccion | ''; hallazgo: string; que: string; responsable: string; limite: string }

/** Como viaja cada punto a `ssoma_registrar_inspeccion`. */
type Respuesta = {
  punto: string
  resultado: ResultadoInspeccion
  hallazgo?: string
  accion?: { que: string; responsable: string; fecha_limite: string }
}

/** Los rechazos de la base que son de un campo: se dicen junto a él y el cursor va ahí. */
const DE_LA_FECHA = /posterior a hoy|últimos 60 días|fecha de la inspección/
const DE_UN_PUNTO = /^En el punto (\d+) /
/** El rechazo de `ssoma_registrar_inspeccion` cuando los puntos enviados ya no son los de la lista. */
const LA_LISTA_CAMBIO = /cambió mientras llenabas/

function FormularioInspeccion({
  id,
  areas,
  puntos,
  cuentas,
  hoy,
  alEnviar,
  enviando,
  error,
  alLimpiar,
  alCancelar,
}: {
  id: string
  areas: AreaParaInspeccionar[]
  puntos: PuntoDeLista[]
  cuentas: CuentaParaAsignar[]
  hoy: string
  alEnviar: (evento: FormEvent<HTMLFormElement>) => void
  enviando: boolean
  error: string | null
  /** Quita el rechazo a la vista: el de «la lista cambió» deja de valer en cuanto se marca lo que faltaba. */
  alLimpiar: () => void
  alCancelar: () => void
}) {
  const [area, setArea] = useState('')
  const [marcas, setMarcas] = useState<Record<string, Marca>>({})
  const opciones = useMemo(() => opcionesDeCuentas(cuentas), [cuentas])
  // Los de todas las áreas primero y después los propios: el mismo orden con que la base los numera.
  const delArea = useMemo(
    () => (area ? [...puntos.filter((p) => p.area_id === null), ...puntos.filter((p) => p.area_id === area)] : []),
    [puntos, area],
  )
  // A quién proponer: el responsable del área, si tiene cuenta activa.
  const jefe = areas.find((a) => a.id === area)?.jefe_id ?? ''
  const propuesto = cuentas.some((c) => c.id === jefe) ? jefe : ''

  const errorFecha = error && DE_LA_FECHA.test(error) ? error : null
  const puntoDelError = error ? Number(DE_UN_PUNTO.exec(error)?.[1] ?? 0) : 0
  const errorDelPie = errorFecha ? null : error
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () => document.getElementById(errorFecha ? 'inspeccion-fecha' : puntoDelError ? `inspeccion-punto-${puntoDelError}` : 'inspeccion-error'),
      [errorFecha, puntoDelError],
    ),
  )

  function marcar(punto: string, cambio: Partial<Marca>) {
    // «…marca lo que falte» seguía en rojo con todo ya marcado, hasta el envío siguiente.
    if (error && LA_LISTA_CAMBIO.test(error)) alLimpiar()
    setMarcas((antes) => {
      const actual = antes[punto] ?? {
        areaDelPunto: puntos.find((p) => p.id === punto)?.area_id ?? null,
        texto: puntos.find((p) => p.id === punto)?.texto ?? '',
        resultado: '',
        hallazgo: '',
        que: '',
        responsable: propuesto,
        limite: sumarDias(hoy, 7),
      }
      return { ...antes, [punto]: { ...actual, ...cambio } }
    })
  }

  const marcados = delArea.filter((p) => marcas[p.id]?.resultado).length
  const hallazgos = delArea.filter((p) => marcas[p.id]?.resultado === 'NO_CONFORME').length
  const primeroSinMarcar = delArea.findIndex((p) => !marcas[p.id]?.resultado) + 1
  const faltan = delArea.length - marcados
  // Lo que viaja: cada punto del área con lo que se marcó.
  const respuestas = delArea.flatMap((p): Respuesta[] => {
    const m = marcas[p.id]
    if (!m?.resultado) return []
    return m.resultado === 'NO_CONFORME'
      ? [{ punto: p.id, resultado: m.resultado, hallazgo: m.hallazgo, accion: { que: m.que, responsable: m.responsable, fecha_limite: m.limite } }]
      : [{ punto: p.id, resultado: m.resultado }]
  })
  // La lista se puso al día con la ventana abierta y un punto marcado «No conforme» ya no está: lo anotado de él
  // no viaja, y se dice, para que el hallazgo no se pierda sin que nadie lo note.
  const retirados = Object.entries(marcas).flatMap(([punto, m]) =>
    // Los de todas las áreas valen para la que se elija; los propios, solo para la suya.
    (m.areaDelPunto === null || m.areaDelPunto === area) && m.resultado === 'NO_CONFORME' && !puntos.some((p) => p.id === punto)
      ? [{ punto, texto: m.texto }]
      : [],
  )
  // El buscador de responsables no es un campo del navegador: lo que falta se dice aquí, antes de enviar.
  const sinResponsable = delArea.findIndex((p) => marcas[p.id]?.resultado === 'NO_CONFORME' && !marcas[p.id]?.responsable) + 1
  // Con una lista larga en el teléfono, el pie queda lejos del punto que falta: la nota lleva a él.
  const irA = (n: number, texto: string) => (
    <button
      type="button"
      className="min-h-11 text-left text-acento underline underline-offset-2 sm:min-h-0"
      data-ir-al-que-falta={n}
      onClick={() => {
        const punto = document.getElementById(`inspeccion-punto-${n}`)
        punto?.scrollIntoView({ block: 'center' })
        punto?.focus({ preventScroll: true })
      }}
    >
      {texto}
    </button>
  )
  const nota = !area
    ? 'Elige el área para ver su lista.'
    : retirados.length > 0
      ? 'Se retiró de la lista un punto que habías marcado como no conforme: mira el aviso sobre la lista.'
      : faltan > 0
      ? irA(primeroSinMarcar, `${faltan === 1 ? 'Falta 1 punto' : `Faltan ${faltan} puntos`} por marcar: ir al ${primeroSinMarcar}.`)
      : sinResponsable > 0
        ? irA(sinResponsable, `Falta el responsable de la acción del punto ${sinResponsable}: ir a él.`)
        : 'Una vez registrada no se edita: si quedó mal, se anula con su motivo.'

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
      <input type="hidden" name="respuestas" value={JSON.stringify(respuestas)} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Área inspeccionada" htmlFor="inspeccion-area" requerido>
            <Seleccion id="inspeccion-area" name="area_id" required value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Elige el área</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Campo
            etiqueta="Fecha"
            htmlFor="inspeccion-fecha"
            requerido
            ayuda={`De hoy o de los últimos ${DIAS_PARA_REGISTRAR_INSPECCION} días.`}
            error={errorFecha ?? undefined}
          >
            <Entrada
              id="inspeccion-fecha"
              name="fecha"
              type="date"
              required
              defaultValue={hoy}
              max={hoy}
              min={sumarDias(hoy, -DIAS_PARA_REGISTRAR_INSPECCION)}
              className="tabular"
            />
          </Campo>
        </div>

        <fieldset>
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            ¿Cómo fue?<span className="ml-0.5 text-peligro">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TIPOS_INSPECCION_SSOMA.map((valor) => (
              <label key={valor} className={OPCION}>
                <input type="radio" name="tipo" value={valor} required defaultChecked={valor === 'PLANEADA'} className={RADIO} />
                <span>
                  <span className="font-medium">{TIPO_INSPECCION_SSOMA[valor].etiqueta}</span>
                  <span className="block text-xs text-texto-suave">{TIPO_INSPECCION_SSOMA[valor].descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {area && (
          <section id="inspeccion-lista" tabIndex={-1} aria-labelledby="inspeccion-lista-titulo" className="space-y-2 outline-none" data-lista-de-inspeccion>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p id="inspeccion-lista-titulo" className="text-xs font-medium text-texto-suave">
                Lista de verificación<span className="ml-0.5 text-peligro">*</span>
              </p>
              <p className="tabular text-xs text-texto-suave" aria-live="polite" data-marcados={marcados} data-hallazgos={hallazgos}>
                Marcados: {marcados} de {delArea.length}
                {hallazgos > 0 ? ` · ${hallazgos} no ${hallazgos === 1 ? 'conforme' : 'conformes'}` : ''}
              </p>
            </div>
            {retirados.length > 0 && (
              <div role="status" className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-puntos-retirados-al-llenar>
                {retirados.map((r) => (
                  <p key={r.punto}>
                    El punto «{r.texto}» se retiró de la lista mientras llenabas la inspección: lo que anotaste de él como no conforme no va en esta
                    inspección. Si todavía hay que corregirlo, repórtalo en «Reportes de seguridad».
                  </p>
                ))}
                <button
                  type="button"
                  className="mt-1 min-h-11 font-medium text-acento underline underline-offset-2 sm:min-h-0"
                  data-entendido-retirados
                  onClick={() => {
                    alLimpiar()
                    // El botón se va con el aviso: el cursor se queda en la lista, no cae a la página.
                    document.getElementById('inspeccion-lista')?.focus({ preventScroll: true })
                    setMarcas((antes) => Object.fromEntries(Object.entries(antes).filter(([punto]) => !retirados.some((r) => r.punto === punto))))
                  }}
                >
                  Entendido, seguir sin {retirados.length === 1 ? 'ese punto' : 'esos puntos'}
                </button>
              </div>
            )}
            {delArea.length === 0 ? (
              <p className="rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto-suave">
                Esta área no tiene puntos en su lista de verificación: agrégalos en «Lista de verificación» antes de inspeccionar.
              </p>
            ) : (
              <ol className="space-y-2">
                {delArea.map((p, i) => {
                  const n = i + 1
                  const m = marcas[p.id]
                  const delError = puntoDelError === n ? error : null
                  return (
                    <li key={p.id}>
                      <fieldset
                        id={`inspeccion-punto-${n}`}
                        tabIndex={-1}
                        aria-describedby={delError ? `inspeccion-punto-${n}-error` : undefined}
                        className={cn(
                          'rounded-[var(--radius-base)] border border-borde p-3 focus:outline-2 focus:outline-offset-2 focus:outline-acento',
                          m?.resultado === 'NO_CONFORME' && 'border-peligro',
                        )}
                        data-punto={p.id}
                        data-resultado={m?.resultado || undefined}
                      >
                        <legend className="sr-only">
                          Punto {n}: {p.texto}
                        </legend>
                        <p className="text-sm text-texto" aria-hidden>
                          <span className="tabular text-texto-suave">{n}.</span> {p.texto}
                        </p>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {RESULTADOS_INSPECCION.map((valor) => (
                            <label key={valor} className={cn(BOTON_RESULTADO, COLOR_RESULTADO[valor])}>
                              <input
                                type="radio"
                                name={`resultado-${p.id}`}
                                value={valor}
                                checked={m?.resultado === valor}
                                onChange={() => marcar(p.id, { resultado: valor })}
                                className="sr-only"
                              />
                              <Check aria-hidden className="hidden size-4 shrink-0 group-has-[:checked]/resultado:block" />
                              {RESULTADO_INSPECCION[valor].etiqueta}
                            </label>
                          ))}
                        </div>
                        {delError && (
                          <p id={`inspeccion-punto-${n}-error`} className="mt-2 text-sm text-peligro">
                            {delError}
                          </p>
                        )}
                        {m?.resultado === 'NO_CONFORME' && (
                          <div className="mt-3 space-y-3" data-hallazgo={p.id}>
                            <Campo etiqueta="Qué encontraste" htmlFor={`inspeccion-hallazgo-${p.id}`} requerido>
                              <AreaTexto
                                id={`inspeccion-hallazgo-${p.id}`}
                                required
                                minLength={10}
                                maxLength={500}
                                rows={2}
                                value={m.hallazgo}
                                onChange={(e) => marcar(p.id, { hallazgo: e.target.value })}
                                placeholder="Por ejemplo: dos soldadores trabajando sin lentes en la mesa 2."
                              />
                            </Campo>
                            <Campo
                              etiqueta="Qué se tiene que hacer"
                              htmlFor={`inspeccion-que-${p.id}`}
                              requerido
                              ayuda="Es la acción correctiva: al responsable le llega el aviso y la cierra con fotos."
                            >
                              <AreaTexto
                                id={`inspeccion-que-${p.id}`}
                                required
                                minLength={10}
                                maxLength={500}
                                rows={2}
                                value={m.que}
                                onChange={(e) => marcar(p.id, { que: e.target.value })}
                                placeholder="Por ejemplo: entregar lentes y recordar su uso antes de empezar el turno."
                              />
                            </Campo>
                            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
                              <Campo etiqueta="Responsable" htmlFor={`inspeccion-responsable-${p.id}`} requerido>
                                <SeleccionBuscable
                                  id={`inspeccion-responsable-${p.id}`}
                                  requerido
                                  marcador="Elige la cuenta"
                                  marcadorBusqueda="Nombre, puesto o área…"
                                  valor={m.responsable}
                                  onChange={(valor) => marcar(p.id, { responsable: valor })}
                                  opciones={opciones}
                                />
                              </Campo>
                              <Campo etiqueta="Fecha límite" htmlFor={`inspeccion-limite-${p.id}`} requerido>
                                <Entrada
                                  id={`inspeccion-limite-${p.id}`}
                                  type="date"
                                  required
                                  min={hoy}
                                  max={sumarDias(hoy, 365)}
                                  value={m.limite}
                                  onChange={(e) => marcar(p.id, { limite: e.target.value })}
                                  className="tabular"
                                />
                              </Campo>
                            </div>
                          </div>
                        )}
                      </fieldset>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        )}

        <Campo etiqueta="Observación" htmlFor="inspeccion-observacion" ayuda="Opcional: con quién recorriste el área, o algo que no está en la lista.">
          <AreaTexto id="inspeccion-observacion" name="observacion" maxLength={1000} rows={2} />
        </Campo>
      </fieldset>
      <PieDeVentana
        error={puntoDelError ? null : errorDelPie}
        idError="inspeccion-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto="Registrar inspección"
        disabled={!area || delArea.length === 0 || retirados.length > 0 || faltan > 0 || sinResponsable > 0}
        nota={nota}
      />
    </form>
  )
}

/** SSOMA anula una inspección mal registrada. No se borra: queda con su motivo. */
export function AnularInspeccion({ id, area }: { id: string; area: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularInspeccionSsoma, () => setAbierta(false))
  return (
    <>
      <Boton
        type="button"
        variante="fantasma"
        data-anular-inspeccion
        onClick={() => {
          limpiar()
          setAbierta(true)
        }}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular la inspección de ${area}`}
        descripcion="Para una inspección repetida o registrada por error. No se borra: queda con su motivo y deja de contar como la última del área."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-inspeccion-${id}`} requerido>
              <AreaTexto
                id={`anular-inspeccion-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: se registró en el área equivocada; la buena es la de Soldadura del mismo día."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

const CLAVE_PUNTO = 'ssoma:punto'

/** El verde de la lista («Punto agregado…», «Punto retirado…»): siempre montado, para que se anuncie. */
export function EstadoDeLaLista() {
  const [entro] = useEstadoCompartido<string | null>(`${CLAVE_PUNTO}:aviso`, null)
  return (
    <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'}>
      {entro}
    </p>
  )
}

/** SSOMA agrega un punto a la lista de un área, o a la de todas. */
export function AgregarPunto({ areas }: { areas: AreaParaInspeccionar[] }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE_PUNTO}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('punto_ssoma', () => refrescarSiEsDeLaPestana(router))
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    (previo: unknown, datos: FormData) => {
      id.salio()
      return agregarPuntoSsoma(previo, datos)
    },
    (r) => {
      id.otro()
      setAbierta(false)
      setEntro(r.mensaje ?? 'Punto agregado.')
    },
    { alYaEntrar: id.otro },
  )
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById('punto-texto'), []),
  )
  return (
    <>
      <Boton
        type="button"
        data-agregar-punto
        onClick={() => {
          limpiar()
          setEntro(null)
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <ListPlus aria-hidden className="size-4" />
        Agregar punto
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Agregar un punto a la lista"
        descripcion="Lo que se revisa en cada inspección. Se pide desde la próxima; las ya registradas no cambian."
        ancho="md"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <form key={`${vez}:${id.id}`} onSubmit={alEnviar} className="space-y-4">
            <input type="hidden" name="operacion_id" value={id.id} />
            <fieldset disabled={enviando} className="min-w-0 space-y-4">
              <Campo etiqueta="Dónde se revisa" htmlFor="punto-area" requerido>
                <Seleccion id="punto-area" name="area_id" defaultValue="">
                  <option value="">Todas las áreas</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      Solo en {a.nombre}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
              <Campo etiqueta="Qué se revisa" htmlFor="punto-texto" requerido error={error ?? undefined}>
                <Entrada
                  id="punto-texto"
                  name="texto"
                  required
                  minLength={5}
                  maxLength={200}
                  placeholder="Por ejemplo: esmeriles con su guarda y su apoyo ajustados."
                />
              </Campo>
            </fieldset>
            <PieDeVentana error={null} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Agregar" />
          </form>
        )}
      </Ventana>
    </>
  )
}

/**
 * Retirar un punto de la lista o restituirlo. Retirar pregunta antes: un toque
 * de más entre diez botones iguales dejaba de pedir el punto en toda inspección
 * nueva, y el aviso salía arriba, fuera de la vista. Restituir va de un toque.
 */
export function CambiarPunto({ id, activo, texto }: { id: string; activo: boolean; texto: string }) {
  const [abierta, setAbierta] = useState(false)
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE_PUNTO}:aviso`, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(activarPuntoSsoma, (r) => {
    setAbierta(false)
    setEntro(r.mensaje ?? null)
  })
  const campos = (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={activo ? 'NO' : 'SI'} />
    </>
  )
  if (!activo) {
    return (
      <form
        onSubmit={(e) => {
          setEntro(null)
          alEnviar(e)
        }}
        className="flex flex-col items-end gap-1"
      >
        {campos}
        <Boton type="submit" variante="contorno" tamano="sm" cargando={enviando} aria-label={`Restituir el punto «${texto}»`} data-cambiar-punto={id}>
          {!enviando && <RotateCcw aria-hidden className="size-4" />}
          Restituir
        </Boton>
        {error && (
          <p role="alert" className="max-w-xs text-right text-xs text-peligro">
            {error}
          </p>
        )}
      </form>
    )
  }
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label={`Retirar el punto «${texto}»`}
        data-cambiar-punto={id}
        onClick={() => {
          limpiar()
          setEntro(null)
          setAbierta(true)
        }}
      >
        <X aria-hidden className="size-4" />
        Retirar
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Retirar el punto de la lista"
        descripcion="Deja de pedirse en las inspecciones nuevas. Las ya registradas no cambian, y lo puedes restituir cuando quieras."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          {campos}
          <p className="rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto" data-punto-por-retirar={id}>
            {texto}
          </p>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Retirar" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}
