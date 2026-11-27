'use client'

import { Ban, CircleCheck, LogIn, LogOut, RotateCw, Search, WifiOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import type { Marca, Trabajador } from '@/lib/datos/rrhh'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { horaCorta, minutosLargos } from '@/lib/dominio/rrhh'
import {
  decirElRechazoSiSeFue,
  esDeLaVersionAnterior,
  motivoDelFallo,
  partida,
  quedoEnDuda,
  refrescarSiEsDeLaPestana,
  SIN_RESPUESTA,
  useCursorAlRechazo,
  useEnvio,
  yaSeResolvio,
  type Partida,
} from '@/lib/envio'
import { hora as horaDe } from '@/lib/format'
import { cn } from '@/lib/utils'

import { anularAsistencia, buscarPorDni, marcarAsistencia, type MarcaGuardada } from './acciones'

type Persona = Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'cargo' | 'hora_entrada' | 'hora_salida'>
type Tipo = 'INGRESO' | 'SALIDA'

/** Lo que la base contestó para un DNI: la persona, nadie, o por qué no buscó. `red`: no contestó. */
type RespuestaDni = { dni: string; id: string | null; error?: string; red?: boolean }

/**
 * La marca que esta pantalla acaba de hacer, para decirla en grande. La hora es
 * la que contestó la base; cuando la lista se pone al día manda la de la lista,
 * que además dice si después se anuló. `busqueda`: lo escrito al marcarla; si
 * se escribe otra cosa, la confirmación se achica a una línea.
 */
type Ultima = {
  id: string
  persona: Persona
  tipo: Tipo
  hora: string | null
  es_tardanza: boolean
  tardanza_minutos: number
  ya_estaba: boolean
  busqueda: string
}

/**
 * Un envío que salió y del que no se sabe si entró: no llegó la respuesta, o el
 * servidor cayó a medio camino. Vive en la pestaña, no en el teléfono: es solo
 * para volver a mandar el mismo envío, que la base reconoce y no guarda dos
 * veces. La hora la pone la base cuando llega. Con `error`, no entró, y llegó
 * cuando su tarjeta ya no estaba (se buscaba a otra persona): se dice aquí.
 */
type Pendiente = { id: string; tipo: Tipo; persona: Persona; error?: string }

const nombreDe = (p: Persona) => `${p.nombres} ${p.apellidos}`
const queEs = (tipo: Tipo) => (tipo === 'INGRESO' ? 'el ingreso' : 'la salida')
/** Lo que la línea de arriba dice de esa persona si su marca vuelve con la portería ya en otra pantalla. */
const siSeVaDe = (p: Persona) => ({ que: `la marca de ${nombreDe(p)}`, enlace: 'Volver a Asistencia' })
/** De qué es esa línea: la marca siguiente de la persona que entra la quita (`yaSeResolvio`). */
const lineaDe = (p: Pick<Persona, 'id'>) => `marca-${p.id}`

/**
 * La hora de Lima, «HH:MM», al día cada minuto: «Pasó su hora» no se queda con
 * la de cuando se abrió la lista. Vacía en el servidor.
 */
function useHoraDeLima() {
  return useSyncExternalStore(
    (avisar) => {
      const reloj = window.setInterval(avisar, 15_000)
      return () => window.clearInterval(reloj)
    },
    () => horaDe(new Date()),
    () => '',
  )
}

/**
 * Si el teléfono dice tener conexión. Solo avisa: los botones siguen vivos,
 * porque el navegador a veces dice que hay señal y no la hay, y al revés.
 */
function useEnLinea() {
  return useSyncExternalStore(
    (avisar) => {
      window.addEventListener('online', avisar)
      window.addEventListener('offline', avisar)
      return () => {
        window.removeEventListener('online', avisar)
        window.removeEventListener('offline', avisar)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}

/** Las dos listas de solo lectura de hoy; `null` es la de marcar, con todos. */
type Vista = 'dentro' | 'faltan' | null

/**
 * La lista del día, pensada para el celular del portero: un buscador y una
 * tarjeta por persona con dos botones grandes. Quien solo consulta ve lo
 * mismo sin botones.
 *
 * El DNI no llega al celular (migración 20261020165000): con los 8 dígitos
 * escritos, la base contesta quién es y queda solo su tarjeta. Quien solo
 * consulta busca por nombre.
 *
 * Apenas entra una marca, arriba se dice en grande de quién fue, si fue
 * ingreso o salida y a qué hora la puso la base, con el botón para anularla.
 * Lo que salió sin respuesta queda arriba en «Sin confirmar» con su
 * «Reintentar», aunque se busque a otra persona. Hoy, además, dos listas de
 * solo lectura: quién está dentro y quién falta.
 */
export function Marcador({
  personal,
  marcas,
  marca,
  anula,
  esHoy,
  buscaPorDni,
}: {
  personal: Persona[]
  marcas: Marca[]
  marca: boolean
  anula: boolean
  esHoy: boolean
  /** La portería y RR. HH.: los demás buscan por nombre. */
  buscaPorDni: boolean
}) {
  const [busqueda, setBusqueda] = useState('')
  const [respuesta, setRespuesta] = useState<RespuestaDni | null>(null)
  const [ultima, setUltima] = useState<Ultima | null>(null)
  const [vista, setVista] = useState<Vista>(null)
  // «Todavía no llegan» marca a quien ya pasó su hora.
  const horaDeLima = useHoraDeLima()
  const [pendientes, setPendientes] = useState<Pendiente[]>([])
  // Envíos que ya no sirven para marcar (la base dijo que fueron otra marca, o
  // no entraron por otra razón): la tarjeta que los tenga estrena otro.
  const [gastados, setGastados] = useState<ReadonlySet<string>>(() => new Set())
  // Cada «Buscar otra vez» del DNI que no contestó.
  const [intentoDni, setIntentoDni] = useState(0)
  const enLinea = useEnLinea()
  const buscador = useRef<HTMLInputElement>(null)
  const confirmacion = useRef<HTMLDivElement>(null)
  const digitos = busqueda.replace(/\s/g, '')
  const esNumero = buscaPorDni && /^\d+$/.test(digitos)
  const dni = esNumero && digitos.length === 8 ? digitos : null

  useEffect(() => {
    if (!dni) return
    let vigente = true
    buscarPorDni(dni)
      .then((r) => vigente && setRespuesta({ dni, ...r }))
      .catch(
        (e: unknown) =>
          // Desde una pantalla de antes del despliegue, repetir daría lo mismo: no se ofrece.
          vigente &&
          setRespuesta({
            dni,
            id: null,
            red: !esDeLaVersionAnterior(e),
            error: motivoDelFallo(e, 'No se pudo buscar: no llegó la respuesta. Revisa la señal y toca «Buscar otra vez».'),
          }),
      )
    return () => {
      vigente = false
    }
  }, [dni, intentoDni])

  // Al volver a Asistencia, la línea de arriba que decía que no se sabía si la
  // marca de alguien quedó se quita si la lista ya la trae vigente.
  useEffect(() => {
    if (!esHoy) return
    for (const m of marcas) if (m.anulado_en === null) yaSeResolvio(lineaDe({ id: m.trabajador_id }))
  }, [esHoy, marcas])

  const porPersona = new Map<string, Marca[]>()
  for (const m of marcas) porPersona.set(m.trabajador_id, [...(porPersona.get(m.trabajador_id) ?? []), m])
  const vigente = (p: Persona, tipo: Tipo) => (porPersona.get(p.id) ?? []).find((m) => m.tipo === tipo && m.anulado_en === null)
  // Dentro: con ingreso y sin salida. Faltan: sin ingreso. Quien ya salió no está en ninguna.
  const dentro = personal.filter((p) => vigente(p, 'INGRESO') && !vigente(p, 'SALIDA'))
  const faltan = personal.filter((p) => !vigente(p, 'INGRESO'))
  const deLaVista = vista === 'dentro' ? dentro : vista === 'faltan' ? faltan : personal
  // Lo pendiente que la lista ya trae entró: no hay nada que reintentar, y se
  // dice («Sí entró, a las…») hasta que se toca «Entendido»; irse callado
  // dejaba sin saber si entró o se perdió.
  const conRespuesta = pendientes.map((x) => ({ ...x, entro: marcas.find((m) => m.id === x.id) ?? null }))
  const sinConfirmar = conRespuesta.filter((x) => !x.entro && !x.error)

  const contestado = dni !== null && respuesta?.dni === dni ? respuesta : null
  const palabras = palabrasDeBusqueda(busqueda)
  const visibles = esNumero
    ? contestado?.id
      ? deLaVista.filter((p) => p.id === contestado.id)
      : []
    : deLaVista.filter((p) => coincide(palabras, [p.nombres, p.apellidos]))
  const buscaAlgo = busqueda.trim() !== ''
  const vacio =
    personal.length === 0
      ? 'Recursos Humanos todavía no registró a nadie.'
      : vista === 'dentro' && dentro.length === 0
        ? 'Nadie está dentro ahora: no hay ingresos sin su salida.'
        : vista === 'faltan' && faltan.length === 0
          ? 'Ya llegaron todos: nadie queda sin ingreso.'
          : !esNumero
            ? vista
              ? 'Nadie de esta lista coincide. Mira en «Todos».'
              : buscaPorDni
                ? 'Nadie coincide. Prueba solo con el apellido o con el DNI.'
                : 'Nadie coincide. Prueba solo con el apellido.'
            : digitos.length < 8
              ? `Escribe los 8 dígitos del DNI (van ${digitos.length}).`
              : digitos.length > 8
                ? 'El DNI tiene 8 dígitos: sobra alguno.'
                : !contestado
                  ? 'Buscando…'
                  : (contestado.error ??
                    (contestado.id && vista
                      ? 'Esa persona no está en esta lista. Mira en «Todos».'
                      : 'Ese DNI no es de nadie del personal activo. Revísalo o busca por el apellido.'))

  /**
   * Una marca entró. Devuelve si el cursor fue a la confirmación: quien marca
   * desde «Todos» sin buscar, con la tarjeta a la vista, se queda donde está
   * (subir hasta arriba le hacía volver a bajar para el siguiente) y la tarjeta
   * lo dice en su línea.
   */
  function alMarcar(guardada: MarcaGuardada, persona: Persona, tipo: Tipo, tarjeta: HTMLElement | null): boolean {
    // Se mide antes de pintar: la confirmación que nace arriba baja la lista.
    const antes = tarjeta?.getBoundingClientRect()
    const aLaVista = Boolean(antes && antes.top >= 56 && antes.bottom <= window.innerHeight)
    const desdeArriba = Boolean(tarjeta?.closest('[data-sin-confirmar]'))
    // La línea de arriba que decía que no se sabía si quedó ya no vale.
    yaSeResolvio(lineaDe(persona))
    flushSync(() => {
      setUltima({ ...guardada, persona, tipo, busqueda })
      setPendientes((previos) => previos.filter((x) => !(x.persona.id === persona.id && x.tipo === tipo)))
    })
    if (!buscaAlgo && aLaVista && !desdeArriba) {
      // La tarjeta queda bajo el dedo: lo que nació arriba no la corre.
      const despues = tarjeta?.getBoundingClientRect().top
      if (antes && despues !== undefined && despues !== antes.top) window.scrollBy(0, despues - antes.top)
    } else {
      // Quien ya escribe el DNI siguiente se queda donde está: el salto le
      // cortaba lo escrito. La región de estado lo anuncia igual.
      const activo = document.activeElement
      if (!activo || activo === document.body || tarjeta?.contains(activo)) confirmacion.current?.focus()
    }
    const c = confirmacion.current?.getBoundingClientRect()
    return Boolean(c && c.height > 0 && c.top >= 0 && c.bottom <= window.innerHeight)
  }

  // También el rechazo que vuelve con la tarjeta ya desmontada: si no, no lo decía nadie.
  function alQuedarEnDuda(pendiente: Pendiente) {
    setPendientes((antes) => [...antes.filter((x) => x.id !== pendiente.id), pendiente])
  }

  function gastar(id: string) {
    setGastados((antes) => new Set(antes).add(id))
  }

  function seguir() {
    setUltima(null)
    setBusqueda('')
    buscador.current?.focus()
  }

  const compacta = Boolean(ultima && busqueda !== ultima.busqueda)

  return (
    <div>
      {/* Siempre montada: la región que nace con su texto no se anuncia. */}
      <p
        role="status"
        data-sin-senal=""
        className={marca && esHoy && !enLinea ? 'mb-3 flex max-w-xl items-start gap-2 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave p-3 text-sm text-texto' : 'sr-only'}
      >
        {marca && esHoy && !enLinea && (
          <>
            <WifiOff aria-hidden className="mt-0.5 size-4 shrink-0 text-aviso" />
            <span>
              <strong className="font-semibold">Este equipo está sin señal.</strong> Las marcas no se guardan en el equipo: la hora la pone el sistema cuando la
              marca llega. Espera la señal y vuelve a tocar.
            </span>
          </>
        )}
      </p>
      {conRespuesta.length > 0 && (
        <section
          id="sin-confirmar"
          aria-labelledby="sin-confirmar-titulo"
          data-sin-confirmar=""
          className="mb-3 max-w-xl scroll-mt-20 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave p-3"
        >
          <h2 id="sin-confirmar-titulo" className="text-sm font-semibold text-texto">
            Lo que salió sin respuesta
          </h2>
          {sinConfirmar.length > 0 && (
            <p className="mt-0.5 text-xs text-texto">
              <strong className="font-semibold">Sin confirmar ({sinConfirmar.length}).</strong> No llegó la respuesta: no se sabe si entraron. En este equipo no se guardó nada. Con señal, toca «Reintentar»: si ya había entrado, no se marca dos veces y
              sale con su hora.
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {conRespuesta.map((x) => (
              <PendienteDeMarca
                key={x.id}
                pendiente={x}
                entro={x.entro}
                alRechazo={(error) => alQuedarEnDuda({ id: x.id, tipo: x.tipo, persona: x.persona, error })}
                alMarcar={alMarcar}
                alGastar={gastar}
                alQuitar={() => {
                  // El botón tocado se va: el cursor vuelve al buscador, como en «Marcar a otra persona».
                  flushSync(() => setPendientes((previos) => previos.filter((y) => y.id !== x.id)))
                  buscador.current?.focus()
                }}
              />
            ))}
          </ul>
        </section>
      )}
      {/* Siempre montada y vacía: la región que nace con su texto no se anuncia.
          Achicada, ya no se anuncia de nuevo: solo cambia de tamaño. */}
      <div ref={confirmacion} role="status" aria-live={compacta ? 'off' : 'polite'} tabIndex={-1} data-confirmacion-de-marca="" className="scroll-mt-20 outline-none">
        {ultima && (
          <Confirmacion
            key={ultima.id}
            ultima={ultima}
            enLista={marcas.find((m) => m.id === ultima.id)}
            anula={anula}
            compacta={compacta}
            alSeguir={seguir}
          />
        )}
      </div>
      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-texto-suave" />
          <Entrada
            ref={buscador}
            type="search"
            aria-label={buscaPorDni ? 'Buscar por nombre o DNI' : 'Buscar por nombre'}
            placeholder={buscaPorDni ? 'Nombre o los 8 dígitos del DNI' : 'Nombre o apellido'}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            // Al volver al buscador queda todo marcado: el siguiente DNI se escribe encima.
            onFocus={(e) => e.currentTarget.select()}
            className="min-h-11 pl-9"
            autoComplete="off"
          />
        </div>
        {esHoy && personal.length > 0 && (
          <PastillaFiltro
            etiqueta="Qué lista se ve"
            activo={vista}
            alPulsar={(valor) => {
              setVista(valor === 'dentro' || valor === 'faltan' ? valor : null)
            }}
            opciones={[
              { valor: null, etiqueta: `Todos (${personal.length})` },
              { valor: 'dentro', etiqueta: `Dentro ahora (${dentro.length})` },
              { valor: 'faltan', etiqueta: `Todavía no llegan (${faltan.length})` },
            ]}
          />
        )}
        {visibles.length === 0 ? (
          <div role="status" className="rounded-[var(--radius-base)] border border-borde bg-superficie p-4 text-center text-sm text-texto-suave">
            <p>{vacio}</p>
            {/* La búsqueda por DNI no contestó: se pregunta otra vez sin borrar lo escrito. */}
            {contestado?.red && (
              <Boton
                type="button"
                variante="contorno"
                tamano="lg"
                className="mt-3"
                onClick={() => {
                  setRespuesta(null)
                  setIntentoDni((n) => n + 1)
                }}
              >
                <RotateCw aria-hidden className="size-4" />
                Buscar otra vez
              </Boton>
            )}
          </div>
        ) : vista ? (
          <ListaEnLectura
            vista={vista}
            personas={visibles}
            ingresoDe={(p) => vigente(p, 'INGRESO')}
            filtrada={buscaAlgo}
            horaDeLaLista={horaDeLima}
            marca={marca && esHoy}
          />
        ) : (
          <ul className="space-y-2">
            {visibles.map((p) => (
              <TarjetaPersona
                key={p.id}
                persona={p}
                marcas={porPersona.get(p.id) ?? []}
                marca={marca && esHoy}
                anula={anula}
                pendiente={sinConfirmar.find((x) => x.persona.id === p.id) ?? null}
                gastados={gastados}
                alMarcar={alMarcar}
                alQuedarEnDuda={alQuedarEnDuda}
                alGastar={gastar}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * La marca que acaba de entrar, en grande: de quién, ingreso o salida y la hora
 * que puso la base. Si fue a la persona equivocada, se anula ahí mismo con su
 * motivo; anulada, lo dice y queda tachada. Cuando ya se busca a otra persona,
 * se achica a una línea: grande, encima de la tarjeta de la siguiente, se podía
 * tomar por ella.
 */
function Confirmacion({
  ultima,
  enLista,
  anula,
  compacta,
  alSeguir,
}: {
  ultima: Ultima
  enLista: Marca | undefined
  anula: boolean
  compacta: boolean
  alSeguir: () => void
}) {
  const { persona: p, tipo } = ultima
  const hora = enLista?.hora ?? ultima.hora
  const anulada = Boolean(enLista?.anulado_en)
  const minutos = enLista?.tardanza_minutos ?? ultima.tardanza_minutos
  const tarde = enLista?.es_tardanza ?? ultima.es_tardanza
  const que = tipo === 'INGRESO' ? 'Ingreso' : 'Salida'
  const titulo = anulada
    ? tipo === 'INGRESO'
      ? 'Ingreso anulado'
      : 'Salida anulada'
    : ultima.ya_estaba
      ? tipo === 'INGRESO'
        ? 'Ya tenía su ingreso de hoy'
        : 'Ya tenía su salida de hoy'
      : tipo === 'INGRESO'
        ? 'Ingreso marcado'
        : 'Salida marcada'
  if (compacta)
    return (
      <p className="mb-3 max-w-xl rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2 text-sm text-texto-suave">
        Último: {anulada ? (tipo === 'INGRESO' ? 'ingreso anulado' : 'salida anulada') : que.toLowerCase()} de{' '}
        <span className="font-medium text-texto">
          {p.apellidos}, {p.nombres}
        </span>
        {hora && (
          <>
            {' '}
            a las <span className={cn('tabular font-semibold text-texto', anulada && 'line-through')}>{horaCorta(hora)}</span>
          </>
        )}
      </p>
    )
  return (
    <section
      aria-label={titulo}
      className={cn('mb-3 max-w-xl rounded-[var(--radius-base)] border p-4', anulada ? 'border-borde-fuerte bg-superficie-2' : 'border-exito bg-exito-suave')}
    >
      <p className={cn('flex items-center gap-2 text-sm font-semibold', anulada ? 'text-texto-suave' : 'text-exito')}>
        {anulada ? <Ban aria-hidden className="size-5 shrink-0" /> : <CircleCheck aria-hidden className="size-5 shrink-0" />}
        {titulo}
      </p>
      <p className="mt-2 text-xl leading-tight font-semibold text-balance break-words text-texto">
        {p.apellidos}, {p.nombres}
      </p>
      <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
        {hora ? (
          <p className={cn('tabular text-5xl leading-none font-semibold text-texto', anulada && 'text-texto-suave line-through')}>{horaCorta(hora)}</p>
        ) : (
          <p className="text-sm text-texto-suave">La hora aparece en su tarjeta al ponerse al día la lista.</p>
        )}
        {!anulada && tipo === 'INGRESO' && hora && (
          <span className="pb-1">
            <InsigniaDeLlegada minutos={minutos} tarde={tarde} />
          </span>
        )}
      </div>
      {anulada && enLista?.motivo_anulacion && <p className="mt-2 text-sm text-texto-suave">Motivo: {enLista.motivo_anulacion}</p>}
      {/* En el teléfono, uno debajo del otro y a todo el ancho: lado a lado no caben en 390. */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {/* Anulada, el cursor que tenía «Anular esta marca» pasa a este (`Ventana`). */}
        <Boton type="button" variante="contorno" tamano="lg" className="w-full justify-center sm:w-auto" onClick={alSeguir} data-cursor-vuelve={anulada ? 'marca-confirmada' : undefined}>
          Marcar a otra persona
        </Boton>
        {anula && !anulada && hora && <AnularMarca marca={{ id: ultima.id, tipo, hora }} de={nombreDe(p)} conTexto />}
      </div>
    </section>
  )
}

function InsigniaDeLlegada({ minutos, tarde }: { minutos: number; tarde: boolean }) {
  return tarde ? (
    <Insignia tono="peligro">Tarde {minutosLargos(minutos)}</Insignia>
  ) : minutos > 0 ? (
    <Insignia tono="aviso">{minutosLargos(minutos)} tarde, tolerado</Insignia>
  ) : (
    <Insignia tono="exito">A tiempo</Insignia>
  )
}

/**
 * Lo que salió sin respuesta, con su «Reintentar»: el mismo envío, con el mismo
 * id, que la base reconoce y no guarda dos veces. Queda aquí aunque se busque a
 * otra persona: en la tarjeta se perdía al buscar al siguiente.
 */
function PendienteDeMarca({
  pendiente: x,
  entro,
  alRechazo,
  alMarcar,
  alGastar,
  alQuitar,
}: {
  pendiente: Pendiente
  /** La lista ya la trae: entró, y se dice con su hora. */
  entro: Marca | null
  /** No entró, sin duda: deja de estar «sin confirmar» y la tarjeta vuelve a ofrecer el botón. */
  alRechazo: (error: string) => void
  alMarcar: (guardada: MarcaGuardada, persona: Persona, tipo: Tipo, tarjeta: HTMLElement | null) => boolean
  alGastar: (id: string) => void
  alQuitar: () => void
}) {
  const fila = useRef<HTMLLIElement>(null)
  const reintentar = useRef<HTMLButtonElement>(null)
  const entendido = useRef<HTMLButtonElement>(null)
  // Un rechazo que no deja duda: el envío ya no sirve, y la tarjeta estrena otro.
  const enviar = async (previo: unknown, datos: FormData): Promise<ResultadoAccion<MarcaGuardada>> => {
    const r = await marcarAsistencia(previo, datos)
    if (!r.ok && !quedoEnDuda(r.error)) {
      alGastar(x.id)
      alRechazo(r.error)
    }
    return r
  }
  const envio = useEnvio(
    enviar,
    (r) => {
      if (r.datos) alMarcar(r.datos, x.persona, x.tipo, fila.current)
    },
    // La respuesta ya trae la pantalla al día (`revalidatePath`): otra ida
    // después del ok, con la señal que va y viene, caía en la página sin
    // conexión y se llevaba la confirmación y lo que estaba sin confirmar.
    { documento: `pendiente-${x.id}`, refrescar: false, siSeVa: siSeVaDe(x.persona) },
  )
  const definitivo = x.error ?? (envio.error && !quedoEnDuda(envio.error) ? envio.error : null)

  // El envío que no contestó deja el botón que se tocó apagado y el cursor en la
  // página: va a «Reintentar», que es lo que se hace después.
  useEffect(() => {
    const activo = document.activeElement
    if (!activo || activo === document.body) reintentar.current?.focus()
  }, [])
  // Llegó con la lista: «Reintentar» se va y el cursor que tenía pasa a «Entendido».
  const yaEntro = Boolean(entro)
  useEffect(() => {
    if (!yaEntro) return
    const activo = document.activeElement
    if (!activo || activo === document.body) entendido.current?.focus()
  }, [yaEntro])
  const que = x.tipo === 'INGRESO' ? 'ingreso' : 'salida'

  return (
    <li ref={fila} data-pendiente-de={x.persona.id} className="rounded-[var(--radius-base)] border border-aviso bg-superficie p-3">
      <p className="text-sm text-texto">
        <span className="font-semibold">
          {x.persona.apellidos}, {x.persona.nombres}
        </span>
        <span className="text-texto-suave">
          {' '}
          · {que}
          {entro ? '' : x.error ? ' que no entró' : ' sin confirmar'}
        </span>
      </p>
      {/* Siempre puesta: la región que nace con su texto no se anuncia. */}
      <p role="status" className={entro ? 'mt-1 text-sm font-medium text-exito' : 'sr-only'}>
        {entro &&
          `Sí entró: ${x.tipo === 'INGRESO' ? 'el ingreso de' : 'la salida de'} ${x.persona.nombres} quedó a las ${horaCorta(entro.hora)}${
            entro.anulado_en ? `, y después se anuló. Motivo: ${entro.motivo_anulacion ?? 'sin motivo'}` : ''
          }.`.replace(/\.\.$/, '.')}
      </p>
      {entro ? (
        <Boton ref={entendido} type="button" variante="contorno" tamano="lg" className="mt-2 w-full justify-center sm:w-auto" onClick={alQuitar}>
          Entendido
        </Boton>
      ) : definitivo ? (
        <>
          <p role="alert" className="mt-1 text-sm text-peligro">
            {definitivo}
          </p>
          <Boton type="button" variante="contorno" tamano="lg" className="mt-2 w-full justify-center sm:w-auto" onClick={alQuitar}>
            Quitar de la lista
          </Boton>
        </>
      ) : (
        <form onSubmit={envio.alEnviar} className="mt-2">
          <input type="hidden" name="marca_id" value={x.id} />
          <input type="hidden" name="trabajador_id" value={x.persona.id} />
          <input type="hidden" name="tipo" value={x.tipo} />
          {envio.error && (
            <p role="alert" className="mb-2 text-sm text-texto">
              Tampoco llegó la respuesta esta vez. Revisa la señal y vuelve a tocar.
            </p>
          )}
          {/* El nombre ya está en el renglón de arriba; en el botón no cabía (nowrap). */}
          <Boton
            ref={reintentar}
            type="submit"
            tamano="lg"
            className="w-full justify-center sm:w-auto"
            cargando={envio.enviando}
            aria-label={`Reintentar ${queEs(x.tipo)} de ${nombreDe(x.persona)}`}
          >
            <RotateCw aria-hidden className="size-4" />
            Reintentar
          </Boton>
        </form>
      )}
    </li>
  )
}

/** «Dentro ahora» y «Todavía no llegan»: se leen, no se marca desde aquí. Solo nombre, cargo y horario. */
function ListaEnLectura({
  vista,
  personas,
  ingresoDe,
  filtrada,
  horaDeLaLista,
  marca,
}: {
  vista: Exclude<Vista, null>
  personas: Persona[]
  ingresoDe: (p: Persona) => Marca | undefined
  filtrada: boolean
  /** «HH:MM» de Lima, al día cada minuto. */
  horaDeLaLista: string
  /** Quien puede marcar: a él se le dice dónde. */
  marca: boolean
}) {
  // Dentro, por la hora en que entró; los que faltan, por la hora en que les toca entrar.
  const filas = personas
    .map((p) => ({ p, ingreso: ingresoDe(p) }))
    .sort((a, b) => (vista === 'dentro' ? (a.ingreso?.hora ?? '').localeCompare(b.ingreso?.hora ?? '') : a.p.hora_entrada.localeCompare(b.p.hora_entrada)))
  const titulo = vista === 'dentro' ? 'Dentro ahora' : 'Todavía no llegan'
  return (
    <section aria-label={titulo} className="rounded-[var(--radius-base)] border border-borde bg-superficie">
      <p className="border-b border-borde px-3 py-2 text-xs text-texto-suave">
        {vista === 'dentro' ? 'Con ingreso y sin salida, por la hora en que entraron.' : 'Sin ingreso hoy, por la hora en que les toca entrar.'}{' '}
        {filtrada ? 'Solo quienes coinciden con lo buscado. ' : ''}
        {marca && 'Para marcar, vuelve a «Todos».'}
      </p>
      <ul className="divide-y divide-borde">
        {filas.map(({ p, ingreso }) => {
          const yaPaso = Boolean(horaDeLaLista) && horaCorta(p.hora_entrada) < horaDeLaLista
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-texto">
                  {p.apellidos}, {p.nombres}
                </p>
                <p className="text-xs text-texto-suave">
                  {p.cargo ?? 'Sin cargo'} · entra <span className="tabular">{horaCorta(p.hora_entrada)}</span> · sale{' '}
                  <span className="tabular">{horaCorta(p.hora_salida)}</span>
                </p>
              </div>
              {ingreso ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-texto">
                    Ingreso <span className="tabular font-semibold">{horaCorta(ingreso.hora)}</span>
                  </span>
                  <InsigniaDeLlegada minutos={ingreso.tardanza_minutos} tarde={ingreso.es_tardanza} />
                </div>
              ) : (
                <Insignia tono={yaPaso ? 'aviso' : 'neutro'}>
                  {yaPaso ? 'Pasó su hora' : 'Le toca'} <span className="tabular">{horaCorta(p.hora_entrada)}</span>
                </Insignia>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TarjetaPersona({
  persona: p,
  marcas,
  marca,
  anula,
  pendiente,
  gastados,
  alMarcar,
  alQuedarEnDuda,
  alGastar,
}: {
  persona: Persona
  marcas: Marca[]
  marca: boolean
  anula: boolean
  /** Lo suyo que salió sin respuesta: se reintenta en «Sin confirmar», arriba. */
  pendiente: Pendiente | null
  gastados: ReadonlySet<string>
  alMarcar: (guardada: MarcaGuardada, persona: Persona, tipo: Tipo, tarjeta: HTMLElement | null) => boolean
  alQuedarEnDuda: (pendiente: Pendiente) => void
  alGastar: (id: string) => void
}) {
  // Un reintento manda el mismo id y la base no duplica; al marcar bien, se
  // estrena otro. Uno por botón: con uno solo para los dos, el ingreso que entró
  // sin que llegara la respuesta dejaba su id en «Salida».
  const [ids, setIds] = useState<Record<Tipo, string>>(() => ({ INGRESO: crypto.randomUUID(), SALIDA: crypto.randomUUID() }))
  // Un id que ya está en la lista terminó, vigente o anulado, y uno que la base
  // rechazó sin duda ya no sirve: la marca que sigue lleva otro. Con el mismo,
  // volver a marcar tras anularla no guardaba nada, y tras «ese envío ya fue
  // otra marca» cada toque repetía el rechazo hasta recargar.
  const gastado = (['INGRESO', 'SALIDA'] as const).find((tipo) => gastados.has(ids[tipo]) || marcas.some((m) => m.id === ids[tipo]))
  if (gastado) setIds({ ...ids, [gastado]: crypto.randomUUID() })
  // El «Ingreso marcado.» de la tarjeta es de una marca: si después se anula, se calla.
  const [aviso, setAviso] = useState<{ de: string; texto: string } | null>(null)
  const tarjeta = useRef<HTMLLIElement>(null)
  // Si sigue en la pantalla cuando vuelve la respuesta: se puede buscar a otra
  // persona con el envío en camino.
  const montada = useRef(false)
  useEffect(() => {
    montada.current = true
    return () => {
      montada.current = false
    }
  }, [])
  // Lo que salió en el último toque: la respuesta no dice si fue ingreso o salida.
  const enviado = useRef<{ id: string; tipo: Tipo; desde: Partida } | null>(null)
  // Si ya se fue de Asistencia (o a otro día), la línea de arriba de la
  // aplicación lo dice; en la misma pantalla lo dice «Sin confirmar», y esa
  // línea calla (sin `de`, `decirElRechazoSiSeFue` solo habla si se pidió otra
  // pantalla). Con las dos, la duda se decía dos veces.
  const siSeVa = siSeVaDe(p)
  const enviar = async (previo: unknown, datos: FormData): Promise<ResultadoAccion<MarcaGuardada>> => {
    const r = await marcarAsistencia(previo, datos)
    const fue = enviado.current
    if (!r.ok && !quedoEnDuda(r.error) && fue) {
      alGastar(fue.id)
      // Sin tarjeta, el rechazo va a la lista de arriba, que no se desmonta.
      if (!montada.current) alQuedarEnDuda({ id: fue.id, tipo: fue.tipo, persona: p, error: r.error })
      decirElRechazoSiSeFue(fue.desde, r.error, siSeVa, { documento: lineaDe(p) })
    }
    return r
  }
  const envio = useEnvio(
    enviar,
    (r) => {
      const fue = enviado.current
      if (!fue || !r.datos) return
      setIds((antes) => (antes[fue.tipo] === fue.id ? { ...antes, [fue.tipo]: crypto.randomUUID() } : antes))
      // Con la confirmación grande a la vista, la tarjeta no la repite; si
      // quedó fuera (se marcó con la lista bajada), la tarjeta dice que entró.
      const seVe = alMarcar(r.datos, p, fue.tipo, tarjeta.current)
      const texto = `${(r.mensaje ?? '').replace(/\.$/, '')}${r.datos.hora ? `, ${horaCorta(r.datos.hora)}` : ''}.`
      setAviso(r.mensaje && !seVe ? { de: r.datos.id, texto } : null)
    },
    {
      documento: p.id,
      // La respuesta ya trae la pantalla al día: ver `PendienteDeMarca`.
      refrescar: false,
      // Lo de la tarjeta que ya no está lo dice «Sin confirmar», y fuera de la
      // pantalla, `decirElRechazoSiSeFue` (en `enviar` y `alQuedarEnDuda`). Con
      // la línea de `useAccion`, en la misma pantalla se decía dos veces y
      // seguía después de que el reintento entrara.
      siSeVa: null,
      // Sin respuesta: pasa a «Sin confirmar», arriba, que no se pierde al buscar a otra persona.
      alQuedarEnDuda: (datos, desde) => {
        const id = datos.get('marca_id')
        const tipo = datos.get('tipo')
        if (typeof id === 'string' && (tipo === 'INGRESO' || tipo === 'SALIDA')) alQuedarEnDuda({ id, tipo, persona: p })
        decirElRechazoSiSeFue(desde, SIN_RESPUESTA, siSeVa, { documento: lineaDe(p) })
      },
    },
  )
  const vigentes = marcas.filter((m) => m.anulado_en === null)
  const ingreso = vigentes.find((m) => m.tipo === 'INGRESO')
  const salida = vigentes.find((m) => m.tipo === 'SALIDA')
  const anuladas = marcas.filter((m) => m.anulado_en !== null)
  // La duda la dice «Sin confirmar»; aquí, solo el rechazo que no la deja.
  const rechazo = envio.error && !quedoEnDuda(envio.error) ? envio.error : null

  return (
    <li ref={tarjeta} className="rounded-[var(--radius-base)] border border-borde bg-superficie p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-texto">
            {p.apellidos}, {p.nombres}
          </p>
          <p className="text-xs text-texto-suave">
            {p.cargo ?? 'Sin cargo'} · entra <span className="tabular">{horaCorta(p.hora_entrada)}</span> · sale{' '}
            <span className="tabular">{horaCorta(p.hora_salida)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {ingreso ? (
            <LineaMarca marca={ingreso} anula={anula} de={nombreDe(p)} />
          ) : pendiente?.tipo === 'INGRESO' ? (
            <Insignia tono="aviso">Ingreso sin confirmar</Insignia>
          ) : (
            <Insignia tono="neutro">Sin ingreso</Insignia>
          )}
          {salida ? <LineaMarca marca={salida} anula={anula} de={nombreDe(p)} /> : pendiente?.tipo === 'SALIDA' && <Insignia tono="aviso">Salida sin confirmar</Insignia>}
        </div>
      </div>
      {anuladas.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-texto-suave">
          {anuladas.map((m) => (
            <li key={m.id}>
              <s className="tabular">
                {m.tipo === 'INGRESO' ? 'Ingreso' : 'Salida'} {horaCorta(m.hora)}
              </s>{' '}
              · anulada: {m.motivo_anulacion}
            </li>
          ))}
        </ul>
      )}
      {marca && (
        <div className="mt-3 flex gap-2">
          {(['INGRESO', 'SALIDA'] as const).map((tipo) => (
            // Un formulario por botón: el valor del botón pulsado no viaja en el FormData.
            <form
              key={tipo}
              onSubmit={(e) => {
                setAviso(null)
                enviado.current = { id: ids[tipo], tipo, desde: partida() }
                envio.alEnviar(e)
              }}
              className="flex-1"
            >
              <input type="hidden" name="marca_id" value={ids[tipo]} />
              <input type="hidden" name="trabajador_id" value={p.id} />
              <input type="hidden" name="tipo" value={tipo} />
              <Boton
                type="submit"
                variante={tipo === 'INGRESO' ? 'primario' : 'secundario'}
                tamano="lg"
                className="min-h-12 w-full"
                // Lo que está sin confirmar se reintenta arriba, con su mismo envío.
                disabled={pendiente?.tipo === tipo || (tipo === 'INGRESO' ? Boolean(ingreso) : !ingreso || Boolean(salida))}
                cargando={envio.enviando}
                aria-label={`Marcar ${queEs(tipo)} de ${nombreDe(p)}`}
              >
                {tipo === 'INGRESO' ? <LogIn aria-hidden className="size-5" /> : <LogOut aria-hidden className="size-5" />}
                {tipo === 'INGRESO' ? 'Ingreso' : 'Salida'}
              </Boton>
            </form>
          ))}
        </div>
      )}
      {pendiente && (
        <p className="mt-2 text-sm text-texto">
          No se sabe si {queEs(pendiente.tipo)} quedó: <a href="#sin-confirmar" className="font-medium text-acento underline underline-offset-2">reintenta en «Sin confirmar»</a>.
        </p>
      )}
      {rechazo && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {rechazo}
        </p>
      )}
      {/* Sin región: la confirmación de arriba ya lo anuncia. */}
      {aviso && !envio.error && !anuladas.some((m) => m.id === aviso.de) && (
        <p className="mt-2 text-sm font-medium text-exito">
          {aviso.texto}
        </p>
      )}
    </li>
  )
}

function LineaMarca({ marca: m, anula, de }: { marca: Marca; anula: boolean; de: string }) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="text-xs text-texto">
        {m.tipo === 'INGRESO' ? 'Ingreso' : 'Salida'} <span className="tabular font-semibold">{horaCorta(m.hora)}</span>
      </span>
      {m.tipo === 'INGRESO' && <InsigniaDeLlegada minutos={m.tardanza_minutos} tarde={m.es_tardanza} />}
      {/* Por marca: con otro día, el motivo escrito para la de antes no pasa a la nueva. */}
      {anula && <AnularMarca key={m.id} marca={m} de={de} />}
    </div>
  )
}

/**
 * Anular una marca con su motivo. En la fila de la persona es un botón de
 * icono; en la confirmación (`conTexto`), uno con su nombre, que es lo que se
 * busca con el dedo cuando se marcó a quien no era. Dice de quién es: con
 * veinte ingresos de las 07:58, «Anular el ingreso de las 07:58» no distinguía.
 */
function AnularMarca({ marca: m, de, conTexto = false }: { marca: Pick<Marca, 'id' | 'tipo' | 'hora'>; de: string; conTexto?: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const router = useRouter()
  // Lo que salió sin respuesta: al cerrar la ventana, la pantalla se pone al
  // día, porque la marca pudo quedar anulada. Tras el ok no hace falta: la
  // respuesta ya trae la pantalla (ver `PendienteDeMarca`).
  const dudo = useRef(false)
  const envio = useEnvio(
    anularAsistencia,
    () => {
      dudo.current = false
      setAbierta(false)
    },
    {
      refrescar: false,
      alQuedarEnDuda: () => {
        dudo.current = true
      },
    },
  )
  function cerrar() {
    setAbierta(false)
    if (!dudo.current) return
    dudo.current = false
    refrescarSiEsDeLaPestana(router)
  }
  const que = `${queEs(m.tipo as Tipo)} de ${de}, de las ${horaCorta(m.hora)}`
  const campo = `anular-${conTexto ? 'confirmada-' : ''}${m.id}`
  const aviso = useRef<HTMLParagraphElement>(null)
  // El rechazo del motivo va en su campo, con el cursor ahí; lo demás, abajo.
  const delMotivo = envio.error && /^(Cuenta por qué se anula|El motivo pasa)/.test(envio.error) ? envio.error : null
  useCursorAlRechazo(envio.enviando, envio.error, () => (delMotivo ? document.getElementById(campo) : aviso.current))
  return (
    <>
      {conTexto ? (
        <Boton type="button" variante="fantasma" tamano="lg" className="w-full justify-center sm:w-auto" onClick={() => setAbierta(true)} data-cursor-vuelve="marca-confirmada">
          <Ban aria-hidden className="size-4" />
          Anular esta marca
        </Boton>
      ) : (
        <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${que}`} onClick={() => setAbierta(true)}>
          <Ban aria-hidden className="size-4" />
        </Boton>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo={`Anular ${que}`}
        descripcion="Para una marca que se hizo a la persona equivocada o por error. No se borra: queda con su motivo, y después se puede volver a marcar."
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={m.id} />
          <Campo etiqueta="Motivo" htmlFor={campo} requerido ayuda="Al menos 10 caracteres." error={delMotivo ?? undefined}>
            <AreaTexto id={campo} name="motivo" required minLength={10} maxLength={500} rows={3} placeholder="Por ejemplo: se marcó a la persona equivocada." />
          </Campo>
          {envio.error && !delMotivo && (
            <p ref={aviso} tabIndex={-1} role="alert" className="text-sm text-peligro outline-none">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={envio.enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
