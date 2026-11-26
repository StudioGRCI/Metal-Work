'use client'

import { Ban, CircleCheck, LogIn, LogOut, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Ventana } from '@/components/ui/ventana'
import type { Marca, Trabajador } from '@/lib/datos/rrhh'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { horaCorta, minutosLargos } from '@/lib/dominio/rrhh'
import { motivoDelFallo, useEnvio } from '@/lib/envio'
import { cn } from '@/lib/utils'

import { anularAsistencia, buscarPorDni, marcarAsistencia } from './acciones'

type Persona = Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'cargo' | 'hora_entrada' | 'hora_salida'>
type Tipo = 'INGRESO' | 'SALIDA'

/** Lo que la base contestó para un DNI: la persona, nadie, o por qué no buscó. */
type RespuestaDni = { dni: string; id: string | null; error?: string }

/**
 * La marca que esta pantalla acaba de hacer, para decirla en grande. La hora es
 * la que contestó la base; cuando la lista se pone al día manda la de la lista,
 * que además dice si después se anuló.
 */
type Ultima = { id: string; persona: Persona; tipo: Tipo; hora: string | null; es_tardanza: boolean; tardanza_minutos: number }

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
 * Hoy, además, dos listas de solo lectura: quién está dentro y quién falta.
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
      .catch((e: unknown) => vigente && setRespuesta({ dni, id: null, error: motivoDelFallo(e, 'No se pudo buscar. Revisa la conexión y vuelve a escribirlo.') }))
    return () => {
      vigente = false
    }
  }, [dni])

  const porPersona = new Map<string, Marca[]>()
  for (const m of marcas) porPersona.set(m.trabajador_id, [...(porPersona.get(m.trabajador_id) ?? []), m])
  const vigente = (p: Persona, tipo: Tipo) => (porPersona.get(p.id) ?? []).find((m) => m.tipo === tipo && m.anulado_en === null)
  // Dentro: con ingreso y sin salida. Faltan: sin ingreso. Quien ya salió no está en ninguna.
  const dentro = personal.filter((p) => vigente(p, 'INGRESO') && !vigente(p, 'SALIDA'))
  const faltan = personal.filter((p) => !vigente(p, 'INGRESO'))
  const deLaVista = vista === 'dentro' ? dentro : vista === 'faltan' ? faltan : personal

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

  function alMarcar(nueva: Ultima, tarjeta: HTMLElement | null) {
    // Pintada ya, para llevarle el cursor: en el teléfono, con la lista bajada,
    // la confirmación quedaba fuera de la vista.
    flushSync(() => setUltima(nueva))
    // Quien ya escribe el DNI siguiente se queda donde está: el salto le
    // cortaba lo escrito. La región de estado lo anuncia igual.
    const activo = document.activeElement
    if (!activo || activo === document.body || tarjeta?.contains(activo)) confirmacion.current?.focus()
  }

  function seguir() {
    setUltima(null)
    setBusqueda('')
    buscador.current?.focus()
  }

  return (
    <div>
      {/* Siempre montada y vacía: la región que nace con su texto no se anuncia. */}
      <div ref={confirmacion} role="status" tabIndex={-1} data-confirmacion-de-marca="" className="scroll-mt-20 outline-none">
        {ultima && (
          <Confirmacion
            key={ultima.id}
            ultima={ultima}
            enLista={marcas.find((m) => m.id === ultima.id)}
            anula={anula}
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
            alPulsar={(valor) => setVista(valor === 'dentro' || valor === 'faltan' ? valor : null)}
            opciones={[
              { valor: null, etiqueta: `Todos (${personal.length})` },
              { valor: 'dentro', etiqueta: `Dentro ahora (${dentro.length})` },
              { valor: 'faltan', etiqueta: `Todavía no llegan (${faltan.length})` },
            ]}
          />
        )}
        {visibles.length === 0 ? (
          <p
            role="status"
            className="rounded-[var(--radius-base)] border border-borde bg-superficie p-4 text-center text-sm text-texto-suave"
          >
            {vacio}
          </p>
        ) : vista ? (
          <ListaEnLectura vista={vista} personas={visibles} ingresoDe={(p) => vigente(p, 'INGRESO')} filtrada={buscaAlgo} />
        ) : (
          <ul className="space-y-2">
            {visibles.map((p) => (
              <TarjetaPersona key={p.id} persona={p} marcas={porPersona.get(p.id) ?? []} marca={marca && esHoy} anula={anula} alMarcar={alMarcar} />
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
 * motivo; anulada, lo dice y queda tachada.
 */
function Confirmacion({ ultima, enLista, anula, alSeguir }: { ultima: Ultima; enLista: Marca | undefined; anula: boolean; alSeguir: () => void }) {
  const { persona: p, tipo } = ultima
  const hora = enLista?.hora ?? ultima.hora
  const anulada = Boolean(enLista?.anulado_en)
  const minutos = enLista?.tardanza_minutos ?? ultima.tardanza_minutos
  const tarde = enLista?.es_tardanza ?? ultima.es_tardanza
  const que = tipo === 'INGRESO' ? 'Ingreso' : 'Salida'
  return (
    <section
      aria-label={anulada ? `${que} anulado` : `${que} marcado`}
      className={cn('mb-3 max-w-xl rounded-[var(--radius-base)] border p-4', anulada ? 'border-borde-fuerte bg-superficie-2' : 'border-exito bg-exito-suave')}
    >
      <p className={cn('flex items-center gap-2 text-sm font-semibold', anulada ? 'text-texto-suave' : 'text-exito')}>
        {anulada ? <Ban aria-hidden className="size-5 shrink-0" /> : <CircleCheck aria-hidden className="size-5 shrink-0" />}
        {anulada ? (tipo === 'INGRESO' ? 'Ingreso anulado' : 'Salida anulada') : tipo === 'INGRESO' ? 'Ingreso marcado' : 'Salida marcada'}
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
            {tarde ? (
              <Insignia tono="peligro">Tarde {minutosLargos(minutos)}</Insignia>
            ) : minutos > 0 ? (
              <Insignia tono="aviso">{minutosLargos(minutos)} tarde, tolerado</Insignia>
            ) : (
              <Insignia tono="exito">A tiempo</Insignia>
            )}
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
        {anula && !anulada && hora && <AnularMarca marca={{ id: ultima.id, tipo, hora }} conTexto />}
      </div>
    </section>
  )
}

/** «Dentro ahora» y «Todavía no llegan»: se leen, no se marca desde aquí. Solo nombre, cargo y horario. */
function ListaEnLectura({
  vista,
  personas,
  ingresoDe,
  filtrada,
}: {
  vista: Exclude<Vista, null>
  personas: Persona[]
  ingresoDe: (p: Persona) => Marca | undefined
  filtrada: boolean
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
        {filtrada ? 'Solo quienes coinciden con lo buscado. ' : ''}Para marcar, vuelve a «Todos».
      </p>
      <ul className="divide-y divide-borde">
        {filas.map(({ p, ingreso }) => (
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
                {ingreso.es_tardanza && <Insignia tono="peligro">Tarde {minutosLargos(ingreso.tardanza_minutos)}</Insignia>}
              </div>
            ) : (
              <Insignia tono="neutro">Sin ingreso</Insignia>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function TarjetaPersona({
  persona: p,
  marcas,
  marca,
  anula,
  alMarcar,
}: {
  persona: Persona
  marcas: Marca[]
  marca: boolean
  anula: boolean
  alMarcar: (nueva: Ultima, tarjeta: HTMLElement | null) => void
}) {
  // Un reintento manda el mismo id y la base no duplica; al marcar bien, se
  // estrena otro. Uno por botón: con uno solo para los dos, el ingreso que entró
  // sin que llegara la respuesta dejaba su id en «Salida».
  const [ids, setIds] = useState<Record<Tipo, string>>(() => ({ INGRESO: crypto.randomUUID(), SALIDA: crypto.randomUUID() }))
  // Un id que ya está en la lista terminó, vigente o anulado: la marca que sigue
  // lleva otro (entró sin respuesta y la lista se puso al día después).
  const gastado = (['INGRESO', 'SALIDA'] as const).find((tipo) => marcas.some((m) => m.id === ids[tipo]))
  if (gastado) setIds({ ...ids, [gastado]: crypto.randomUUID() })
  // El «Ingreso marcado.» de la tarjeta es de una marca: si después se anula, se calla.
  const [aviso, setAviso] = useState<{ de: string | null; texto: string } | null>(null)
  const tarjeta = useRef<HTMLLIElement>(null)
  // Lo que salió en el último toque: la respuesta no dice si fue ingreso o salida.
  const enviado = useRef<{ id: string; tipo: Tipo } | null>(null)
  const envio = useEnvio(marcarAsistencia, (r) => {
    const fue = enviado.current
    if (fue) setIds((antes) => (antes[fue.tipo] === fue.id ? { ...antes, [fue.tipo]: crypto.randomUUID() } : antes))
    setAviso(r.mensaje ? { de: fue?.id ?? null, texto: r.mensaje } : null)
    if (fue) alMarcar({ id: fue.id, persona: p, tipo: fue.tipo, hora: r.datos?.hora ?? null, es_tardanza: r.datos?.es_tardanza ?? false, tardanza_minutos: r.datos?.tardanza_minutos ?? 0 }, tarjeta.current)
  }, { documento: p.id })
  const vigentes = marcas.filter((m) => m.anulado_en === null)
  const ingreso = vigentes.find((m) => m.tipo === 'INGRESO')
  const salida = vigentes.find((m) => m.tipo === 'SALIDA')
  const anuladas = marcas.filter((m) => m.anulado_en !== null)

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
            <LineaMarca marca={ingreso} anula={anula} />
          ) : (
            <Insignia tono="neutro">Sin ingreso</Insignia>
          )}
          {salida && <LineaMarca marca={salida} anula={anula} />}
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
                enviado.current = { id: ids[tipo], tipo }
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
                disabled={tipo === 'INGRESO' ? Boolean(ingreso) : !ingreso || Boolean(salida)}
                cargando={envio.enviando}
                aria-label={`Marcar ${tipo === 'INGRESO' ? 'el ingreso' : 'la salida'} de ${p.nombres} ${p.apellidos}`}
              >
                {tipo === 'INGRESO' ? <LogIn aria-hidden className="size-5" /> : <LogOut aria-hidden className="size-5" />}
                {tipo === 'INGRESO' ? 'Ingreso' : 'Salida'}
              </Boton>
            </form>
          ))}
        </div>
      )}
      {envio.error && (
        <p role="alert" className="mt-2 text-sm text-peligro">
          {envio.error}
        </p>
      )}
      {aviso && !envio.error && !anuladas.some((m) => m.id === aviso.de) && (
        <p role="status" className="mt-2 text-sm text-exito">
          {aviso.texto}
        </p>
      )}
    </li>
  )
}

function LineaMarca({ marca: m, anula }: { marca: Marca; anula: boolean }) {
  const tarde = m.tipo === 'INGRESO' && m.es_tardanza
  return (
    <div className="flex items-center justify-end gap-1.5">
      <span className="text-xs text-texto">
        {m.tipo === 'INGRESO' ? 'Ingreso' : 'Salida'} <span className="tabular font-semibold">{horaCorta(m.hora)}</span>
      </span>
      {tarde ? (
        <Insignia tono="peligro">Tarde {minutosLargos(m.tardanza_minutos)}</Insignia>
      ) : m.tipo === 'INGRESO' && m.tardanza_minutos > 0 ? (
        <Insignia tono="aviso">{minutosLargos(m.tardanza_minutos)} tarde, tolerado</Insignia>
      ) : m.tipo === 'INGRESO' ? (
        <Insignia tono="exito">A tiempo</Insignia>
      ) : null}
      {/* Por marca: con otro día, el motivo escrito para la de antes no pasa a la nueva. */}
      {anula && <AnularMarca key={m.id} marca={m} />}
    </div>
  )
}

/**
 * Anular una marca con su motivo. En la fila de la persona es un botón de
 * icono; en la confirmación (`conTexto`), uno con su nombre, que es lo que se
 * busca con el dedo cuando se marcó a quien no era.
 */
function AnularMarca({ marca: m, conTexto = false }: { marca: Pick<Marca, 'id' | 'tipo' | 'hora'>; conTexto?: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(anularAsistencia, () => setAbierta(false))
  const que = m.tipo === 'INGRESO' ? 'el ingreso' : 'la salida'
  return (
    <>
      {conTexto ? (
        <Boton type="button" variante="contornoPeligro" tamano="lg" className="w-full justify-center sm:w-auto" onClick={() => setAbierta(true)} data-cursor-vuelve="marca-confirmada">
          <Ban aria-hidden className="size-4" />
          Anular esta marca
        </Boton>
      ) : (
        <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${que} de las ${horaCorta(m.hora)}`} onClick={() => setAbierta(true)}>
          <Ban aria-hidden className="size-4" />
        </Boton>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular ${que} de las ${horaCorta(m.hora)}`}
        descripcion="Para una marca que se hizo a la persona equivocada o por error. No se borra: queda con su motivo, y después se puede volver a marcar."
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={m.id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-${conTexto ? 'confirmada-' : ''}${m.id}`} requerido>
            <AreaTexto
              id={`anular-${conTexto ? 'confirmada-' : ''}${m.id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="Por ejemplo: se marcó a la persona equivocada."
            />
          </Campo>
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
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
