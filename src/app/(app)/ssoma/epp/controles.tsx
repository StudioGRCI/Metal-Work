'use client'

import { Ban, UserCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { PersonaParaMarcar, SalidaDeEpp } from '@/lib/datos/ssoma'
import { DIAS_MAXIMOS_DE_EPP, MESES_DE_DURACION_EPP, nombreDeSalidaEpp, sumarMeses } from '@/lib/dominio/ssoma'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { cantidad, fecha, sumarDias } from '@/lib/format'
import { cn } from '@/lib/utils'

import { anularEntregaEpp, eppNoSeRenueva, eppSalidaSeReparte, eppSalidaSinReparto, registrarEntregasEpp } from '../acciones'

/** Lo que dice cómo terminó lo último que se hizo: los botones de las filas y el renglón del encabezado lo comparten. */
const CLAVE = 'ssoma:epp'

/** El verde de lo último que entró: siempre montado, para que se anuncie. */
export function EstadoDeLaEntrega() {
  const [entro] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  return (
    <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'} data-estado-epp>
      {entro}
    </p>
  )
}

const SIN_AREA = 'Sin área'
const SE_FUERON = 'Ya no están en la planta'

/** Sin tildes ni mayúsculas, para buscar «nunez» y encontrar «Núñez». */
const llano = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** «2,5» o «2.5» → 2.5; lo que no es un número, NaN. */
const numero = (texto: string) => (texto.trim() === '' ? Number.NaN : Number(texto.trim().replace(',', '.')))

/** «1 mes», «6 meses», «1 año». */
const duracion = (meses: number) => (meses % 12 === 0 ? `${meses / 12} ${meses === 12 ? 'año' : 'años'}` : `${meses} ${meses === 1 ? 'mes' : 'meses'}`)

/**
 * SSOMA anota a quién le tocó el equipo de una salida de Almacén: marca a las
 * personas de la lista de RR. HH., cuánto a cada una y hasta cuándo dura. El
 * kardex no cambia. El id vive aquí (`useIdDelEnvio`, por salida): tras «No
 * llegó la respuesta», volver a abrir pregunta si la anterior entró.
 */
export function AsignarEpp({ salida, personal }: {
  salida: SalidaDeEpp
  /** El personal de RR. HH. (el activo y quien se fue en los últimos 60 días): solo nombre, cargo y área. */
  personal: PersonaParaMarcar[]
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('epp_ssoma', () => refrescarSiEsDeLaPestana(router), salida.movimiento_id)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    (previo: unknown, datos: FormData) => {
      id.salio()
      return registrarEntregasEpp(previo, datos)
    },
    (r) => {
      id.otro()
      setAbierta(false)
      setEntro(`${r.mensaje ?? 'Entrega anotada.'} ${nombreDeSalidaEpp(salida)}.`)
    },
    { alYaEntrar: id.otro },
  )
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        data-asignar-epp={salida.movimiento_id}
        aria-label={`Anotar a quién se le entregó: ${salida.material}, ${nombreDeSalidaEpp(salida)}`}
        onClick={() => {
          limpiar()
          setEntro(null)
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <UserCheck aria-hidden className="size-4" />
        Anotar a quién
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="A quién se le entregó"
        descripcion="Marca a las personas que recibieron este equipo y hasta cuándo les dura. La salida de Almacén no cambia."
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioEpp
            key={`${vez}:${id.id}`}
            id={id.id}
            salida={salida}
            personal={personal}
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

/** Los rechazos de la base que son de un campo: se dicen junto a él y el cursor va ahí. */
const DE_LA_FECHA = /fecha de renovación/
const DE_LAS_PERSONAS = /en la planta|anotada su entrega|a quién se le entregó|una sola vez|por asignar|cantidad de cada persona|elegir a las personas/

function FormularioEpp({
  id,
  salida,
  personal,
  alEnviar,
  enviando,
  error,
  alLimpiar,
  alCancelar,
}: {
  id: string
  salida: SalidaDeEpp
  personal: PersonaParaMarcar[]
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
  /** Quita el rechazo de la base cuando se corrige el campo que lo causó. */
  alLimpiar: () => void
  alCancelar: () => void
}) {
  const queda = salida.por_asignar
  // Lo usual es uno por persona; de una salida de medio rollo, lo que quede.
  const porPersona = queda < 1 ? queda : 1
  const [renovar, setRenovar] = useState(salida.dias_sugeridos ? sumarDias(salida.fecha, salida.dias_sugeridos) : '')
  // A quién, y cuánto a cada uno (como texto, tal como se escribe).
  const [marcados, setMarcados] = useState<Record<string, string>>({})
  const [busqueda, setBusqueda] = useState('')
  const unidad = salida.unidad ?? ''

  const errorFecha = error && DE_LA_FECHA.test(error) ? error : null
  const errorPersonas = !errorFecha && error && DE_LAS_PERSONAS.test(error) ? error : null
  const errorDelPie = errorFecha || errorPersonas ? null : error
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () => document.getElementById(errorFecha ? 'epp-renovar' : errorPersonas ? 'epp-personas' : 'epp-error'),
      [errorFecha, errorPersonas],
    ),
  )

  // Por área, como se reparte en la planta; quien no tiene área, al final, y después quien ya se fue:
  // aparte, para que «Marcar el área» no lo marque en una salida de hoy (la base lo rechazaría).
  const porArea = useMemo(() => {
    const q = llano(busqueda.trim())
    const grupos = new Map<string, PersonaParaMarcar[]>()
    for (const p of personal) {
      if (q && !llano([p.nombre, p.cargo, p.area].filter(Boolean).join(' ')).includes(q)) continue
      const area = p.enPlanta ? (p.area ?? SIN_AREA) : SE_FUERON
      grupos.set(area, [...(grupos.get(area) ?? []), p])
    }
    const peso = (a: string) => (a === SE_FUERON ? 2 : a === SIN_AREA ? 1 : 0)
    return [...grupos.entries()].sort(([a], [b]) => peso(a) - peso(b) || a.localeCompare(b, 'es'))
  }, [personal, busqueda])

  // El rechazo de la base seguía en rojo junto al campo ya corregido, hasta el envío siguiente.
  function ponerFecha(dia: string) {
    if (errorFecha) alLimpiar()
    setRenovar(dia)
  }

  function cambiar(ids: string[], marcar: boolean) {
    if (errorPersonas) alLimpiar()
    setMarcados((antes) => {
      const despues = { ...antes }
      for (const i of ids) {
        if (!marcar) delete despues[i]
        else if (!(i in despues)) despues[i] = String(porPersona)
      }
      return despues
    })
  }

  const elegidos = Object.entries(marcados)
  const cantidades = elegidos.map(([, c]) => numero(c))
  const malas = cantidades.some((c) => !Number.isFinite(c) || c <= 0 || c > 999)
  const total = malas ? null : Math.round(cantidades.reduce((n, c) => n + c, 0) * 1000) / 1000
  const sePasa = total !== null && total > queda
  const yaPaso = renovar !== '' && renovar <= salida.fecha

  const nota =
    elegidos.length === 0
      ? 'Marca a quién se le entregó.'
      : malas
        ? 'Revisa las cantidades: cada una es mayor que cero.'
        : sePasa
          ? `Anotas ${cantidad(total)} y de esta salida ${queda === 1 ? 'queda 1' : `quedan ${cantidad(queda)}`} por asignar.`
          : renovar === ''
            ? 'Pon hasta cuándo dura el equipo.'
            : 'Una vez anotada no se edita: si quedó mal, se anula con su motivo.'

  return (
    <form
      onSubmit={(e) =>
        alEnviar(e, (datos) =>
          datos.set('personas', JSON.stringify(elegidos.map(([trabajador, c]) => ({ trabajador, cantidad: numero(c) })))),
        )
      }
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      <input type="hidden" name="movimiento_id" value={salida.movimiento_id} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm" data-salida-de-la-ventana>
          <p className="font-medium text-texto">{salida.material}</p>
          <p className="mt-0.5 text-xs text-texto-suave">
            <span className="tabular">{nombreDeSalidaEpp(salida)}</span>
            {salida.recibio ? ` · recibió ${salida.recibio}` : ''}
          </p>
          <p className="mt-1 text-xs text-texto">
            {queda === 1 ? 'Queda' : 'Quedan'} <span className="tabular font-medium">{cantidad(queda)}</span> {unidad} por asignar
            {salida.asignado > 0 || salida.devuelto > 0 ? (
              <span className="text-texto-suave">
                {' '}
                (salieron {cantidad(salida.cantidad)}
                {salida.devuelto > 0 ? `, volvieron a Almacén ${cantidad(salida.devuelto)}` : ''}
                {salida.asignado > 0 ? `, ya asignados ${cantidad(salida.asignado)}` : ''})
              </span>
            ) : null}
          </p>
        </div>

        {/* Los atajos van fuera del `Campo`: él marca como inválido y describe a su hijo directo, que tiene que ser la fecha. */}
        <div className="space-y-2">
          <Campo
            etiqueta="Renovar el"
            htmlFor="epp-renovar"
            requerido
            ayuda={`Hasta cuándo le dura a cada persona, contado desde el ${fecha(salida.fecha)}, el día de la salida.`}
            error={errorFecha ?? (yaPaso ? 'La renovación tiene que ser posterior al día de la salida.' : undefined)}
          >
            <Entrada
              id="epp-renovar"
              name="renovar_el"
              type="date"
              required
              value={renovar}
              onChange={(e) => ponerFecha(e.target.value)}
              min={sumarDias(salida.fecha, 1)}
              max={sumarDias(salida.fecha, DIAS_MAXIMOS_DE_EPP)}
              className="w-44"
            />
          </Campo>
          <div role="group" aria-label="Duración desde el día de la salida" className="flex flex-wrap gap-1.5">
            {MESES_DE_DURACION_EPP.map((m) => {
              const dia = sumarMeses(salida.fecha, m)
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={renovar === dia}
                  onClick={() => ponerFecha(dia)}
                  data-duracion={m}
                  className={cn(
                    'inline-flex min-h-11 items-center rounded-[var(--radius-base)] border px-3 text-xs font-medium sm:min-h-9',
                    renovar === dia ? 'border-acento bg-acento-suave text-texto' : 'border-borde-fuerte text-texto hover:bg-superficie-2',
                  )}
                >
                  {duracion(m)}
                </button>
              )
            })}
          </div>
        </div>

        <section
          id="epp-personas"
          tabIndex={-1}
          aria-labelledby="epp-personas-titulo"
          aria-describedby={errorPersonas ? 'epp-personas-error' : undefined}
          className="space-y-2 outline-none"
          data-personas-epp
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p id="epp-personas-titulo" className="text-xs font-medium text-texto-suave">
              A quién se le entregó<span className="ml-0.5 text-peligro">*</span>
            </p>
            <p className={cn('tabular text-xs', sePasa ? 'font-medium text-peligro' : 'text-texto-suave')} aria-live="polite" data-anotado={total ?? ''}>
              Anotas {total === null ? '—' : cantidad(total)} de {cantidad(queda)} {unidad}
            </p>
          </div>
          {errorPersonas && (
            <p id="epp-personas-error" className="text-sm text-peligro">
              {errorPersonas}
            </p>
          )}
          {personal.length === 0 ? (
            <p className="rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto-suave">
              RR. HH. todavía no tiene a nadie activo en su lista: sin ella no hay a quién anotar.
            </p>
          ) : (
            <>
              <Entrada
                type="search"
                aria-label="Buscar por nombre, cargo o área"
                placeholder="Buscar por nombre, cargo o área…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              {/* En el teléfono desplaza solo la ventana: una lista que desplaza dentro de otra atrapa el dedo. */}
              <div className="rounded-[var(--radius-base)] border border-borde md:max-h-80 md:overflow-y-auto">
                {porArea.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-texto-suave">Nadie coincide con «{busqueda.trim()}».</p>
                ) : (
                  porArea.map(([area, gente], i) => {
                    const todos = gente.every((p) => p.id in marcados)
                    return (
                      <fieldset key={area} aria-labelledby={`epp-area-${i}`} className="border-b border-borde last:border-b-0">
                        <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-superficie-2 px-3 py-1.5">
                          <p id={`epp-area-${i}`} className="text-xs font-medium text-texto">
                            {area} <span className="tabular text-texto-suave">· {gente.length}</span>
                          </p>
                          {/* Quien ya se fue se marca de a uno: solo si recibió de una salida de antes de irse. */}
                          {area !== SE_FUERON && (
                            <button
                              type="button"
                              className="inline-flex min-h-11 items-center text-xs font-medium text-acento hover:underline sm:min-h-0"
                              onClick={() => cambiar(gente.map((p) => p.id), !todos)}
                              aria-label={`${todos ? 'Desmarcar' : 'Marcar'} a ${gente.length === 1 ? 'la persona' : `las ${gente.length} personas`} de ${area}`}
                            >
                              {todos ? 'Desmarcar el área' : 'Marcar el área'}
                            </button>
                          )}
                        </div>
                        <ul>
                          {gente.map((p) => {
                            const marcado = p.id in marcados
                            return (
                              // El margen de arriba y abajo le deja sitio al anillo de foco de la cantidad: sin él lo tapaba la cabecera del área.
                              <li key={p.id} className={cn('flex items-center gap-2 py-1 pr-3', marcado ? 'bg-acento-suave' : 'hover:bg-superficie-2')}>
                                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5 pl-3 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={marcado}
                                    onChange={(e) => cambiar([p.id], e.target.checked)}
                                    className="size-4 shrink-0 accent-[var(--acento)]"
                                    data-persona-epp={p.id}
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate text-texto">{p.nombre}</span>
                                    {(p.cargo || (!p.enPlanta && p.area)) && (
                                      <span className="block truncate text-xs text-texto-suave">
                                        {[p.cargo, p.enPlanta ? null : p.area].filter(Boolean).join(' · ')}
                                      </span>
                                    )}
                                  </span>
                                </label>
                                {/* Cuánto se llevó: solo si de la salida queda más de lo que se da por persona. */}
                                {marcado && queda > porPersona && (
                                  <Entrada
                                    aria-label={`Cantidad para ${p.nombre}`}
                                    inputMode="decimal"
                                    value={marcados[p.id]}
                                    onChange={(e) => {
                                      if (errorPersonas) alLimpiar()
                                      setMarcados((antes) => ({ ...antes, [p.id]: e.target.value }))
                                    }}
                                    className="tabular w-20 shrink-0 text-right"
                                    data-cantidad-epp={p.id}
                                  />
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      </fieldset>
                    )
                  })
                )}
              </div>
            </>
          )}
        </section>
      </fieldset>
      <PieDeVentana
        error={errorDelPie}
        idError="epp-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto="Anotar"
        disabled={elegidos.length === 0 || malas || sePasa || renovar === '' || yaPaso}
        nota={nota}
      />
    </form>
  )
}

/** Lo que se nombra de una entrega en la ventana que la anula o la saca de «Por renovar». */
type DeQuien = { id: string; persona: string; material: string }

/** SSOMA anula una entrega mal anotada: no se borra, y lo asignado vuelve a quedar por asignar en su salida. */
export function AnularEntrega({ entrega }: { entrega: DeQuien }) {
  const [abierta, setAbierta] = useState(false)
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularEntregaEpp, (r) => {
    setAbierta(false)
    setEntro(r.mensaje ?? 'Entrega anulada.')
  })
  return (
    <>
      <Boton
        type="button"
        variante="fantasma"
        tamano="sm"
        data-anular-epp={entrega.id}
        aria-label={`Anular la entrega de ${entrega.material} a ${entrega.persona}`}
        onClick={() => {
          limpiar()
          setEntro(null)
          setAbierta(true)
        }}
      >
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular la entrega"
        descripcion={`${entrega.material}, a ${entrega.persona}. No se borra: queda con su motivo, y lo que tenía asignado vuelve a quedar por asignar en su salida.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={entrega.id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-epp-${entrega.id}`} requerido>
              <AreaTexto
                id={`anular-epp-${entrega.id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: se anotó a otra persona; ese casco lo recibió su compañero."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

/** SSOMA saca una entrega vigente de «Por renovar»: ese equipo ya no se le va a reponer a la persona. */
export function NoSeRenueva({ entrega }: { entrega: DeQuien }) {
  const [abierta, setAbierta] = useState(false)
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(eppNoSeRenueva, (r) => {
    setAbierta(false)
    setEntro(r.mensaje ?? 'Listo.')
  })
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        data-no-se-renueva={entrega.id}
        aria-label={`No se renueva: ${entrega.material} de ${entrega.persona}`}
        onClick={() => {
          limpiar()
          setEntro(null)
          setAbierta(true)
        }}
      >
        No se renueva
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="No se renueva"
        descripcion={`${entrega.material}, de ${entrega.persona}. Deja de salir en «Por renovar» y queda con su motivo. Si después se le entrega otro, se anota como siempre desde la salida de Almacén.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={entrega.id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Por qué ya no se renueva" htmlFor={`no-renueva-epp-${entrega.id}`} requerido>
              <AreaTexto
                id={`no-renueva-epp-${entrega.id}`}
                name="motivo"
                required
                minLength={5}
                maxLength={300}
                placeholder="Por ejemplo: pasó a oficina y ya no usa ese equipo."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Guardar" />
        </form>
      </Ventana>
    </>
  )
}

/** Cómo se nombra una salida en la ventana y en lo que lee el lector de pantalla. */
type DeSalida = Pick<SalidaDeEpp, 'movimiento_id' | 'numero' | 'fecha' | 'material' | 'por_asignar' | 'unidad'>

/**
 * SSOMA dice que lo que queda de una salida no se reparte por persona: las lunas
 * de soldar del área, un polo para una visita. Deja de esperar en su lista, con
 * su motivo. La salida de Almacén no cambia, y se puede deshacer con «Repartir».
 */
export function NoVaPorPersona({ salida }: { salida: DeSalida }) {
  const [abierta, setAbierta] = useState(false)
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(eppSalidaSinReparto, (r) => {
    setAbierta(false)
    setEntro(r.mensaje ?? 'Listo.')
  })
  const queda = `${cantidad(salida.por_asignar)} ${salida.unidad ?? ''}`.trim()
  return (
    <>
      <Boton
        type="button"
        variante="fantasma"
        tamano="sm"
        data-no-va-por-persona={salida.movimiento_id}
        aria-label={`No va por persona: ${salida.material}, ${nombreDeSalidaEpp(salida)}`}
        onClick={() => {
          limpiar()
          setEntro(null)
          setAbierta(true)
        }}
      >
        No va por persona
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="No va por persona"
        descripcion={`${salida.material}, ${nombreDeSalidaEpp(salida)}. Lo que queda por asignar (${queda}) deja de esperar en esta lista. La salida de Almacén no cambia, y se puede deshacer con «Repartir».`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="movimiento_id" value={salida.movimiento_id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Por qué no va por persona" htmlFor={`sin-reparto-${salida.movimiento_id}`} requerido>
              <AreaTexto
                id={`sin-reparto-${salida.movimiento_id}`}
                name="motivo"
                required
                minLength={5}
                maxLength={300}
                placeholder="Por ejemplo: son las lunas de repuesto del área de soldadura."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Guardar" />
        </form>
      </Ventana>
    </>
  )
}

/** Deshace «no va por persona»: la salida vuelve a esperar que se anote a quién le tocó. */
export function RepartirSalida({ salida }: { salida: DeSalida }) {
  const [, setEntro] = useEstadoCompartido<string | null>(`${CLAVE}:aviso`, null)
  const { alEnviar, enviando, error } = useEnvio(eppSalidaSeReparte, (r) => setEntro(r.mensaje ?? 'Listo.'))
  return (
    <form
      onSubmit={(e) => {
        setEntro(null)
        alEnviar(e)
      }}
      className="flex flex-col gap-1 md:items-end"
    >
      <input type="hidden" name="movimiento_id" value={salida.movimiento_id} />
      <Boton
        type="submit"
        variante="contorno"
        tamano="sm"
        cargando={enviando}
        data-repartir-salida={salida.movimiento_id}
        aria-label={`Repartir entre personas: ${salida.material}, ${nombreDeSalidaEpp(salida)}`}
      >
        Repartir
      </Boton>
      {error && (
        <p role="alert" className="max-w-xs text-xs text-peligro">
          {error}
        </p>
      )}
    </form>
  )
}
