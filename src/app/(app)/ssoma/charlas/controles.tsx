'use client'

import { Ban, Presentation } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

import {
  EstadoDelEnvio,
  SelectorFotos,
  type Desenlace,
  fotosParaEnviar,
  hayFallidas,
  haySubiendo,
  useFotosDelEnvio,
  type FotoLista,
} from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { PersonaDeLaLista } from '@/lib/datos/ssoma'
import {
  BUCKET_FOTOS_SSOMA,
  DIAS_PARA_REGISTRAR_CHARLA,
  MAXIMO_FOTOS_CHARLA,
  MAXIMO_MB_FOTO_SSOMA,
  TIPO_CHARLA_SSOMA,
  TIPOS_CHARLA_SSOMA,
} from '@/lib/dominio/ssoma'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { sumarDias } from '@/lib/format'

import { anularCharlaSsoma, registrarCharlaSsoma } from '../acciones'

/** El envío de la charla y lo que dice cómo terminó: el botón y el renglón de estado del encabezado lo comparten. */
const CLAVE = 'ssoma:charla'
const ID_DEL_ESTADO = 'estado-de-la-charla-ssoma'
type Entro = { mensaje: string; id: string | null }

/** Cómo terminó el registro: el verde con «Ver la charla», o por qué no entró si se cerró la ventana en vuelo. */
export function EstadoDeLaCharla() {
  const [entro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const [desenlace] = useEstadoCompartido<Desenlace | null>(`${CLAVE}:desenlace`, null)
  const [sigue] = useEstadoCompartido(`${CLAVE}:sigue`, false)
  return (
    <>
      <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'}>
        {entro?.mensaje}
        {entro?.id && (
          <>
            {' '}
            <Link href={`/ssoma/charlas/${entro.id}`} className="font-medium underline underline-offset-2">
              Ver la charla
            </Link>
          </>
        )}
      </p>
      <EstadoDelEnvio id={ID_DEL_ESTADO} sigue={sigue} desenlace={desenlace} registro="La charla" className="text-sm" />
    </>
  )
}

/**
 * SSOMA registra la charla o la inducción que dio: tema, quién la dio, la
 * fecha, de una a cuatro fotos y quiénes asistieron, de la lista de RR. HH.
 * Como «Reportar incidente», las fotos, el envío y su id viven aquí y no en el
 * formulario: si se cierra sin registrar, las fotos se retiran; tras «No llegó
 * la respuesta», volver a abrir pregunta si aquella entró y no la duplica.
 */
export function RegistrarCharla({ cuentaId, personal, hoy, expositor }: {
  cuentaId: string
  /** El personal activo de RR. HH.: solo nombre, cargo y área. */
  personal: PersonaDeLaLista[]
  /** El día de hoy en Lima, para los límites de la fecha. */
  hoy: string
  /** Quien registra, para proponerlo como quien dio la charla. */
  expositor: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('charla_ssoma', () => refrescarSiEsDeLaPestana(router))
  const envio = useFotosDelEnvio(BUCKET_FOTOS_SSOMA, CLAVE, ID_DEL_ESTADO)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    envio.conFotos((previo: unknown, datos: FormData) => {
      id.salio()
      return registrarCharlaSsoma(previo, datos)
    }),
    (r) => {
      id.otro()
      if (!envio.seCerroAlEnviar()) setAbierta(false)
      setEntro({ mensaje: r.mensaje ?? 'Charla registrada.', id: r.datos?.id ?? null })
    },
    { alYaEntrar: id.otro },
  )
  function cerrar() {
    envio.cerrar()
    setAbierta(false)
  }
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && !abierta)
  return (
    <>
      <Boton
        type="button"
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        data-registrar-charla
        onClick={() => {
          limpiar()
          setEntro(null)
          envio.abrir()
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <Presentation aria-hidden className="size-4" />}
        Registrar charla
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo="Registrar charla o inducción"
        descripcion="Lo que se habló, quién la dio y quiénes asistieron. Una vez registrada no se edita: si quedó mal, se anula con su motivo y se registra otra."
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioCharla
            key={`${vez}:${id.id}`}
            id={id.id}
            cuentaId={cuentaId}
            personal={personal}
            hoy={hoy}
            expositor={expositor}
            fotos={envio.fotos}
            setFotos={envio.setFotos}
            alCancelar={cerrar}
            alEnviar={alEnviar}
            enviando={enviando}
            error={error}
          />
        )}
      </Ventana>
    </>
  )
}

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

/** Los rechazos de la base que son de un campo: se dicen junto a él y el cursor va ahí. */
const DE_LA_FECHA = /posterior a hoy|últimos 60 días|fecha de la charla/
const DE_ASISTENTES = /asistieron|asistentes|activo en RR\. HH\.|lista del personal/

/** Sin tildes ni mayúsculas, para buscar «nunez» y encontrar «Núñez». */
const llano = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function FormularioCharla({
  id,
  cuentaId,
  personal,
  hoy,
  expositor,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  id: string
  cuentaId: string
  personal: PersonaDeLaLista[]
  hoy: string
  expositor: string
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  const [tipo, setTipo] = useState<string>('CHARLA')
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set())
  const [busqueda, setBusqueda] = useState('')
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const listas = fotosParaEnviar(fotos).length
  const vieja = usePestanaDeLaVersionAnterior()
  const errorFecha = error && DE_LA_FECHA.test(error) ? error : null
  const errorAsistentes = !errorFecha && error && DE_ASISTENTES.test(error) ? error : null
  const errorDelPie = errorFecha || errorAsistentes ? null : error
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () => document.getElementById(errorFecha ? 'charla-fecha' : errorAsistentes ? 'charla-asistentes' : 'charla-error'),
      [errorFecha, errorAsistentes],
    ),
  )

  // Por área, como se pasa lista en la planta; quien no tiene área, al final.
  const porArea = useMemo(() => {
    const q = llano(busqueda.trim())
    const grupos = new Map<string, PersonaDeLaLista[]>()
    for (const p of personal) {
      if (q && !llano([p.nombre, p.cargo, p.area].filter(Boolean).join(' ')).includes(q)) continue
      const area = p.area ?? 'Sin área'
      grupos.set(area, [...(grupos.get(area) ?? []), p])
    }
    return [...grupos.entries()].sort(([a], [b]) => (a === 'Sin área' ? 1 : b === 'Sin área' ? -1 : a.localeCompare(b, 'es')))
  }, [personal, busqueda])

  function cambiar(ids: string[], marcar: boolean) {
    setMarcados((antes) => {
      const despues = new Set(antes)
      for (const i of ids) {
        if (marcar) despues.add(i)
        else despues.delete(i)
      }
      return despues
    })
  }

  const faltaQuien = marcados.size === 0
  const nota = listas === 0 && !subiendo ? 'Falta al menos una foto.' : faltaQuien ? 'Marca quiénes asistieron.' : undefined
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      {[...marcados].map((m) => (
        <input key={m} type="hidden" name="asistentes" value={m} />
      ))}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            ¿Qué fue?<span className="ml-0.5 text-peligro">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {TIPOS_CHARLA_SSOMA.map((valor) => (
              <label key={valor} className={OPCION}>
                <input type="radio" name="tipo" value={valor} required checked={tipo === valor} onChange={() => setTipo(valor)} className={RADIO} />
                <span>
                  <span className="font-medium">{TIPO_CHARLA_SSOMA[valor].etiqueta}</span>
                  <span className="block text-xs text-texto-suave">{TIPO_CHARLA_SSOMA[valor].descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Campo etiqueta="Tema" htmlFor="charla-tema" requerido>
          <Entrada
            id="charla-tema"
            name="tema"
            required
            minLength={5}
            maxLength={200}
            placeholder={tipo === 'INDUCCION' ? 'Inducción de seguridad para personal nuevo' : 'Uso correcto de la amoladora y sus guardas'}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Quién la dio" htmlFor="charla-expositor" requerido>
            <Entrada id="charla-expositor" name="expositor" required minLength={3} maxLength={120} defaultValue={expositor} />
          </Campo>
          <Campo
            etiqueta="Fecha"
            htmlFor="charla-fecha"
            requerido
            ayuda={`De hoy o de los últimos ${DIAS_PARA_REGISTRAR_CHARLA} días.`}
            error={errorFecha ?? undefined}
          >
            <Entrada
              id="charla-fecha"
              name="fecha"
              type="date"
              required
              defaultValue={hoy}
              max={hoy}
              min={sumarDias(hoy, -DIAS_PARA_REGISTRAR_CHARLA)}
            />
          </Campo>
        </div>

        <section
          id="charla-asistentes"
          tabIndex={-1}
          aria-labelledby="charla-asistentes-titulo"
          aria-describedby={errorAsistentes ? 'charla-asistentes-error' : undefined}
          className="space-y-2 outline-none"
          data-asistentes
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p id="charla-asistentes-titulo" className="text-xs font-medium text-texto-suave">
              Quiénes asistieron<span className="ml-0.5 text-peligro">*</span>
            </p>
            <p className="tabular text-xs text-texto-suave" aria-live="polite" data-marcados={marcados.size}>
              Marcados: {marcados.size} de {personal.length}
            </p>
          </div>
          {errorAsistentes && (
            <p id="charla-asistentes-error" className="text-sm text-peligro">
              {errorAsistentes}
            </p>
          )}
          {personal.length === 0 ? (
            <p className="rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto-suave">
              RR. HH. todavía no tiene a nadie activo en su lista: sin ella no hay a quién marcar.
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
                    const todos = gente.every((p) => marcados.has(p.id))
                    return (
                      <fieldset key={area} aria-labelledby={`charla-area-${i}`} className="border-b border-borde last:border-b-0">
                        <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-superficie-2 px-3 py-1.5">
                          <p id={`charla-area-${i}`} className="text-xs font-medium text-texto">
                            {area} <span className="tabular text-texto-suave">· {gente.length}</span>
                          </p>
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center text-xs font-medium text-acento hover:underline sm:min-h-0"
                            onClick={() => cambiar(gente.map((p) => p.id), !todos)}
                            aria-label={`${todos ? 'Desmarcar' : 'Marcar'} a ${gente.length === 1 ? 'la persona' : `las ${gente.length} personas`} de ${area}`}
                          >
                            {todos ? 'Desmarcar el área' : 'Marcar el área'}
                          </button>
                        </div>
                        <ul>
                          {gente.map((p) => (
                            <li key={p.id}>
                              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-superficie-2 has-[:checked]:bg-acento-suave">
                                <input
                                  type="checkbox"
                                  checked={marcados.has(p.id)}
                                  onChange={(e) => cambiar([p.id], e.target.checked)}
                                  className="size-4 shrink-0 accent-[var(--acento)]"
                                  data-asistente={p.id}
                                />
                                <span className="min-w-0">
                                  <span className="block truncate text-texto">{p.nombre}</span>
                                  {p.cargo && <span className="block truncate text-xs text-texto-suave">{p.cargo}</span>}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </fieldset>
                    )
                  })
                )}
              </div>
            </>
          )}
        </section>

        <section aria-label="Fotos de la charla" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">
            Fotos de la charla<span className="ml-0.5 text-peligro">*</span>
          </p>
          <p className="text-xs text-texto-suave">
            De una a {MAXIMO_FOTOS_CHARLA}: la del grupo y, si la hay, la de la hoja de asistencia firmada. Es la evidencia de que se dio.
          </p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${id}`}
            maximo={MAXIMO_FOTOS_CHARLA}
            bucket={BUCKET_FOTOS_SSOMA}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_SSOMA}
            titulo={null}
          />
        </section>
        {!subiendo && fallidas && (
          <p className="text-sm text-peligro">
            {vieja ? 'Vuelve a cargar la pantalla para registrar la charla.' : 'Quita o vuelve a subir las fotos que no entraron antes de registrar.'}
          </p>
        )}
      </fieldset>
      <PieDeVentana
        error={errorDelPie}
        idError="charla-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Registrar'}
        disabled={subiendo || fallidas || listas === 0 || faltaQuien}
        nota={nota}
      />
    </form>
  )
}

/** SSOMA anula una charla mal registrada: deja de contar como asistencia y queda con su motivo. */
export function AnularCharla({ id, tema }: { id: string; tema: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularCharlaSsoma, () => setAbierta(false))
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        data-anular-charla
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
        titulo="Anular la charla"
        descripcion={`«${tema}». No se borra: queda con su motivo y deja de contar como asistencia de quienes marcó.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-charla-${id}`} requerido>
              <AreaTexto
                id={`anular-charla-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: se registró dos veces; la buena es la del mismo día con 12 asistentes."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}
