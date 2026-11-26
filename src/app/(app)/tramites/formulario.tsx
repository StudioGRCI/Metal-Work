'use client'

import { FilePlus2, Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { TipoDeTramite, UnidadParaTramitar } from '@/lib/datos/tramites'
import { definir, ESTADO_OT } from '@/lib/dominio/estados'
import { AMBITO_TRAMITE, AMBITOS_TRAMITE, MAXIMO_UNIDADES_PARA_ELEGIR, nombreDeLaUnidad } from '@/lib/dominio/tramites'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { guardarTipo, registrarTramite } from './acciones'

/** Lo que dijo el último registro: va en el renglón de estado del encabezado, fuera de la ventana. */
const CLAVE_AVISO = 'tramites:registrar:aviso'
type Entro = { mensaje: string; id: string | null }

/** El verde del registro, con su número y «Ver el trámite». */
export function EstadoDelTramite() {
  const [entro] = useEstadoCompartido<Entro | null>(CLAVE_AVISO, null)
  // Montada siempre: el verde que nace con su texto no lo oye el lector.
  return (
    <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'}>
      {entro?.mensaje}
      {entro?.id && (
        <>
          {' '}
          <Link href={`/tramites/${entro.id}`} className="font-medium underline underline-offset-2">
            Ver el trámite
          </Link>
        </>
      )}
    </p>
  )
}

/**
 * El botón «Registrar trámite» y su ventana, para quien lleva los trámites. El
 * id vive aquí, fuera del formulario que se rehace al abrir (`useIdDelEnvio`):
 * tras «No llegó la respuesta», cerrar y volver a abrir manda el mismo, y la
 * base no le da otro número TR al mismo trámite.
 */
export function RegistrarTramite({ tipos, unidades, hoy }: {
  /** Los tipos en uso, de una unidad y de la empresa. */
  tipos: TipoDeTramite[]
  unidades: UnidadParaTramitar[]
  /** El día de hoy en Lima: la fecha en que se presentó no puede pasarlo. */
  hoy: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<Entro | null>(CLAVE_AVISO, null)
  const router = useRouter()
  const envio = useIdDelEnvio('tramite', () => refrescarSiEsDeLaPestana(router))
  return (
    <>
      <Boton
        type="button"
        data-registrar-tramite
        onClick={() => {
          setEntro(null)
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <FilePlus2 aria-hidden className="size-4" />
        Registrar trámite
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Registrar un trámite"
        descripcion="De la unidad de un cliente o de la empresa. Sale con su número TR y queda guardado: después anotas en qué va desde su ficha."
        ancho="lg"
      >
        <EnvioAnterior texto={envio.anterior} />
        {envio.id && (
          <FormularioTramite
            // Con otro id, otro formulario: lo escrito para el que ya entró no se arrastra.
            key={`${vez}:${envio.id}`}
            envio={envio}
            tipos={tipos}
            unidades={unidades}
            hoy={hoy}
            alCancelar={() => setAbierta(false)}
            alAgregarTipo={() => {
              setAbierta(false)
              // Cuando la ventana ya devolvió el cursor a su botón, el catálogo se abre y lo recibe.
              window.setTimeout(() => {
                const catalogo = document.getElementById('tipos-de-tramite')
                if (!(catalogo instanceof HTMLDetailsElement)) return
                catalogo.open = true
                catalogo.scrollIntoView({ block: 'start' })
                catalogo.querySelector<HTMLElement>('[data-guardar-tipo="nuevo"]')?.focus()
              }, 150)
            }}
            alTerminar={(entro) => {
              setAbierta(false)
              setEntro(entro)
            }}
          />
        )}
      </Ventana>
    </>
  )
}

/** Los rechazos que son de un campo: se dicen junto a él y el cursor va ahí. */
const DEL_TIPO = /tipo de trámite/
const DE_LA_UNIDAD = /elige la unidad|unidad de la lista/i
const DE_LA_OT = /OT de esa unidad|OT de la lista/
const DEL_INICIO = /fecha en que se presentó/
const DEL_LIMITE = /fecha límite/

function FormularioTramite({ envio, tipos, unidades, hoy, alCancelar, alAgregarTipo, alTerminar }: {
  envio: ReturnType<typeof useIdDelEnvio>
  /** Cierra la ventana y lleva al catálogo, con el cursor en «Agregar tipo». */
  alAgregarTipo: () => void
  tipos: TipoDeTramite[]
  unidades: UnidadParaTramitar[]
  hoy: string
  alCancelar: () => void
  alTerminar: (entro: Entro) => void
}) {
  const id = envio.id ?? ''
  const [tipoId, setTipoId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [ordenId, setOrdenId] = useState('')
  const [entidad, setEntidad] = useState('')
  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      envio.salio()
      return registrarTramite(previo, datos)
    },
    (r) => {
      envio.otro()
      alTerminar({ mensaje: r.mensaje ?? 'Trámite registrado.', id: r.datos?.id ?? null })
    },
    { alYaEntrar: envio.otro },
  )
  const tipo = tipos.find((t) => t.id === tipoId) ?? null
  const deUnidad = tipo?.ambito === 'UNIDAD'
  const unidad = unidades.find((u) => u.id === unidadId) ?? null

  const campoDelError = !error
    ? null
    : DEL_TIPO.test(error)
      ? 'tipo'
      : DE_LA_UNIDAD.test(error)
        ? 'unidad'
        : DE_LA_OT.test(error)
          ? 'orden'
          : DEL_LIMITE.test(error) && !/no puede ser futura/.test(error)
            ? 'limite'
            : DEL_INICIO.test(error)
              ? 'inicio'
              : null
  const errorDe = (campo: string) => (campoDelError === campo ? (error ?? undefined) : undefined)
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById(campoDelError ? `tramite-${campoDelError}` : 'tramite-error'), [campoDelError]),
  )

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo
          etiqueta="Tipo de trámite"
          htmlFor="tramite-tipo"
          requerido
          error={errorDe('tipo')}
        >
          <Seleccion
            id="tramite-tipo"
            name="tipo_id"
            required
            value={tipoId}
            onChange={(e) => {
              const elegido = tipos.find((t) => t.id === e.target.value) ?? null
              setTipoId(e.target.value)
              // La entidad del tipo es la propuesta; cada trámite guarda la suya.
              setEntidad(elegido && elegido.entidad !== 'Por definir' ? elegido.entidad : '')
              if (elegido?.ambito !== 'UNIDAD') {
                setUnidadId('')
                setOrdenId('')
              }
            }}
          >
            <option value="">Elige el tipo</option>
            {AMBITOS_TRAMITE.map((ambito) => {
              const delAmbito = tipos.filter((t) => t.ambito === ambito)
              return (
                delAmbito.length > 0 && (
                  <optgroup key={ambito} label={AMBITO_TRAMITE[ambito].etiqueta}>
                    {delAmbito.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                      </option>
                    ))}
                  </optgroup>
                )
              )
            })}
          </Seleccion>
        </Campo>
        <p className="-mt-2 text-xs text-texto-suave">
          ¿No está en la lista?{' '}
          <button
            type="button"
            onClick={alAgregarTipo}
            data-ir-a-tipos
            className="inline-flex min-h-11 items-center font-medium text-acento underline-offset-2 hover:underline sm:min-h-0"
          >
            Agrégalo en «Tipos de trámite»
          </button>
          . Lo escrito aquí no se guarda.
        </p>

        {deUnidad && unidades.length === 0 && (
          <p className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm text-texto" data-sin-unidades>
            Todavía no hay unidades registradas. El trámite va con la unidad del cliente: pide que la registren en Unidades y vuelve aquí.
          </p>
        )}
        {deUnidad && unidades.length > 0 && (
          <>
            <Campo
              etiqueta="Unidad"
              htmlFor="tramite-unidad"
              requerido
              ayuda="Busca por la placa, el código interno o el cliente. El trámite queda con el cliente de la unidad."
              ayudaEnIcono={false}
              error={errorDe('unidad')}
            >
              <SeleccionBuscable
                id="tramite-unidad"
                name="unidad_id"
                requerido
                marcador="Elige la unidad"
                marcadorBusqueda="Placa, código interno o cliente…"
                valor={unidadId}
                onChange={(valor) => {
                  setUnidadId(valor)
                  // Si la unidad tiene una sola OT, es la suya; con varias, se elige.
                  const ordenes = unidades.find((u) => u.id === valor)?.ordenes ?? []
                  setOrdenId(ordenes.length === 1 ? ordenes[0].id : '')
                }}
                permiteVaciar={false}
                opciones={unidades.map((u) => ({
                  valor: u.id,
                  etiqueta: nombreDeLaUnidad(u),
                  detalle: [u.cliente ?? 'Sin cliente', u.marca].filter(Boolean).join(' · '),
                }))}
              />
            </Campo>
            {unidades.length >= MAXIMO_UNIDADES_PARA_ELEGIR && (
              <p className="-mt-2 text-xs text-aviso" data-unidades-al-tope>
                La lista trae las primeras {MAXIMO_UNIDADES_PARA_ELEGIR} unidades y hay más: si la tuya no sale, avisa al administrador del sistema.
              </p>
            )}
            {unidad && (
              <p className="-mt-2 text-xs text-texto-suave" data-cliente-de-la-unidad>
                Cliente: <span className="font-medium text-texto">{unidad.cliente ?? 'Sin cliente'}</span>.
              </p>
            )}
            {unidad && unidad.ordenes.length > 0 && (
              <Campo
                etiqueta="OT de la unidad"
                htmlFor="tramite-orden"
                ayuda="Opcional: la orden de trabajo por la que se hace el trámite."
                ayudaEnIcono={false}
                error={errorDe('orden')}
              >
                <Seleccion id="tramite-orden" name="orden_id" value={ordenId} onChange={(e) => setOrdenId(e.target.value)} className="tabular">
                  <option value="">Sin OT</option>
                  {unidad.ordenes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.numero} · {definir(ESTADO_OT, o.estado).etiqueta}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
            )}
          </>
        )}

        <Campo
          etiqueta="Qué se tramita"
          htmlFor="tramite-asunto"
          requerido
          ayuda="En una línea, para reconocerlo en la lista."
          ayudaEnIcono={false}
        >
          <Entrada
            id="tramite-asunto"
            name="asunto"
            required
            minLength={5}
            maxLength={300}
            autoComplete="off"
            placeholder={deUnidad ? 'Por ejemplo: tarjeta de propiedad del furgón' : 'Por ejemplo: renovación del SOAT de la camioneta de reparto'}
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Entidad" htmlFor="tramite-entidad" requerido ayuda="Ante quién se hace." ayudaEnIcono={false}>
            <Entrada
              id="tramite-entidad"
              name="entidad"
              required
              minLength={2}
              maxLength={80}
              autoComplete="off"
              value={entidad}
              onChange={(e) => setEntidad(e.target.value)}
              placeholder="SUNARP, la municipalidad, la aseguradora…"
            />
          </Campo>
          <Campo etiqueta="N.º de expediente" htmlFor="tramite-expediente" ayuda="El que te dio la entidad, si ya lo tienes." ayudaEnIcono={false}>
            <Entrada id="tramite-expediente" name="expediente" maxLength={60} autoComplete="off" className="tabular" />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Se presentó el"
            htmlFor="tramite-inicio"
            ayuda="Déjala vacía si todavía no se presenta: queda «Por iniciar»."
            ayudaEnIcono={false}
            error={errorDe('inicio')}
          >
            <Entrada id="tramite-inicio" name="fecha_inicio" type="date" max={hoy} className="tabular" />
          </Campo>
          <Campo
            etiqueta="Fecha límite"
            htmlFor="tramite-limite"
            ayuda="Hasta cuándo debe quedar. Pasada esa fecha, sale como vencido."
            ayudaEnIcono={false}
            error={errorDe('limite')}
          >
            <Entrada id="tramite-limite" name="fecha_limite" type="date" className="tabular" />
          </Campo>
        </div>

        <Campo etiqueta="Nota" htmlFor="tramite-nota" ayuda="Opcional: lo que haga falta recordar." ayudaEnIcono={false}>
          <AreaTexto id="tramite-nota" name="nota" maxLength={1000} rows={2} />
        </Campo>
      </fieldset>
      <PieDeVentana
        error={campoDelError ? null : error}
        idError="tramite-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto="Registrar el trámite"
        disabled={deUnidad && unidades.length === 0}
      />
    </form>
  )
}

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'
const CASILLA = 'flex min-h-11 cursor-pointer items-center gap-3 text-sm text-texto'

/** Lo que dijo el último cambio del catálogo: junto al título de «Tipos de trámite». */
const CLAVE_AVISO_TIPO = 'tramites:tipos:aviso'

export function AvisoDelCatalogo() {
  const [aviso] = useEstadoCompartido<string | null>(CLAVE_AVISO_TIPO, null)
  return (
    <p role="status" className={aviso ? 'text-sm text-exito' : 'sr-only'}>
      {aviso}
    </p>
  )
}

/**
 * «Agregar tipo» o «Editar» un tipo del catálogo, para quien lleva los
 * trámites. El tipo nuevo nace con su id al abrir la ventana: el mismo envío
 * repetido corrige ese, no crea otro.
 */
export function GuardarTipo({ tipo }: { tipo?: TipoDeTramite }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState<string | null>(null)
  const [, setAviso] = useEstadoCompartido<string | null>(CLAVE_AVISO_TIPO, null)
  return (
    <>
      <Boton
        type="button"
        variante={tipo ? 'contorno' : 'secundario'}
        tamano="sm"
        data-guardar-tipo={tipo ? tipo.nombre : 'nuevo'}
        aria-label={tipo ? `Editar el tipo ${tipo.nombre}` : undefined}
        onClick={() => {
          setAviso(null)
          setId(tipo?.id ?? crypto.randomUUID())
          setAbierta(true)
        }}
      >
        {tipo ? <Pencil aria-hidden className="size-4" /> : <Plus aria-hidden className="size-4" />}
        {tipo ? 'Editar' : 'Agregar tipo'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={tipo ? `Editar el tipo «${tipo.nombre}»` : 'Agregar un tipo de trámite'}
        descripcion="Lo que se propone al registrar un trámite de este tipo, y con cuántos días de anticipación se avisa su vencimiento."
        ancho="md"
      >
        {id && (
          <FormularioTipo
            key={id}
            id={id}
            tipo={tipo}
            alCancelar={() => setAbierta(false)}
            alTerminar={(mensaje) => {
              setAbierta(false)
              setAviso(mensaje)
            }}
          />
        )}
      </Ventana>
    </>
  )
}

/** Los avisos que se proponen a un tipo nuevo: 30, 15 y 7 días si se renueva; 5 si no (decisión del 26/11/2026). */
const DIAS_SI_SE_RENUEVA = '30, 15, 7'
const DIAS_SI_NO = '5'

function FormularioTipo({ id, tipo, alCancelar, alTerminar }: {
  id: string
  tipo?: TipoDeTramite
  alCancelar: () => void
  alTerminar: (mensaje: string) => void
}) {
  const { alEnviar, enviando, error } = useEnvio(guardarTipo, (r) => alTerminar(r.mensaje ?? 'Tipo guardado.'), {
    corrige: Boolean(tipo),
    documento: id,
  })
  const [renueva, setRenueva] = useState(tipo?.se_renueva ?? false)
  const [dias, setDias] = useState(tipo ? tipo.dias_aviso.join(', ') : DIAS_SI_NO)
  const [diasTocados, setDiasTocados] = useState(false)
  const errorNombre = error && /Ya hay un tipo|nombre del tipo/.test(error) ? error : null
  const errorDias = !errorNombre && error && /días de aviso|avisos antes/.test(error) ? error : null
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () => document.getElementById(errorNombre ? `tipo-nombre-${id}` : errorDias ? `tipo-dias-${id}` : `tipo-error-${id}`),
      [errorNombre, errorDias, id],
    ),
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      {!tipo && <input type="hidden" name="activo" value="on" />}
      {/* El tipo nuevo lo dice: si su envío se repite con otra cosa, la base no lo corrige a escondidas. */}
      {!tipo && <input type="hidden" name="alta" value="1" />}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo etiqueta="Nombre" htmlFor={`tipo-nombre-${id}`} requerido error={errorNombre ?? undefined}>
          <Entrada
            id={`tipo-nombre-${id}`}
            name="nombre"
            required
            minLength={3}
            maxLength={80}
            autoComplete="off"
            defaultValue={tipo?.nombre ?? ''}
            placeholder="Por ejemplo: Permiso de circulación"
          />
        </Campo>
        <Campo etiqueta="Entidad" htmlFor={`tipo-entidad-${id}`} requerido ayuda="Ante quién se hace. Se propone al registrar y se puede cambiar en cada trámite." ayudaEnIcono={false}>
          <Entrada id={`tipo-entidad-${id}`} name="entidad" required minLength={2} maxLength={80} autoComplete="off" defaultValue={tipo?.entidad ?? ''} />
        </Campo>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            De quién es<span className="ml-0.5 text-peligro">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {AMBITOS_TRAMITE.map((ambito) => (
              <label key={ambito} className={OPCION}>
                <input type="radio" name="ambito" value={ambito} required defaultChecked={(tipo?.ambito ?? 'EMPRESA') === ambito} className={RADIO} />
                <span>
                  <span className="font-medium">{AMBITO_TRAMITE[ambito].etiqueta}</span>
                  <span className="block text-xs text-texto-suave">{AMBITO_TRAMITE[ambito].descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Campo
          etiqueta="Avisar antes del vencimiento"
          htmlFor={`tipo-dias-${id}`}
          requerido
          ayuda="Los días de anticipación, separados por comas: 30, 15, 7. Hasta cinco avisos, de 0 a 120 días."
          ayudaEnIcono={false}
          error={errorDias ?? undefined}
        >
          <Entrada
            id={`tipo-dias-${id}`}
            name="dias_aviso"
            required
            // Sin teclado numérico: el del teléfono no trae la coma que separa los días.
            pattern="[0-9 ,;y]+"
            maxLength={40}
            autoComplete="off"
            value={dias}
            onChange={(e) => {
              setDias(e.target.value)
              setDiasTocados(true)
            }}
            className="tabular"
          />
        </Campo>
        <label className={CASILLA}>
          <input
            type="checkbox"
            name="se_renueva"
            checked={renueva}
            onChange={(e) => {
              setRenueva(e.target.checked)
              // En un tipo nuevo, los días que se proponen siguen a la marca mientras nadie los escriba.
              if (!tipo && !diasTocados) setDias(e.target.checked ? DIAS_SI_SE_RENUEVA : DIAS_SI_NO)
            }}
            className="size-5 shrink-0 accent-[var(--acento)] sm:size-4"
          />
          <span>
            Se renueva
            <span className="block text-xs text-texto-suave">Vence cada cierto tiempo y se vuelve a tramitar: el SOAT, una revisión técnica.</span>
          </span>
        </label>
        {tipo && (
          <label className={CASILLA}>
            <input type="checkbox" name="activo" defaultChecked={tipo.activo} className="size-5 shrink-0 accent-[var(--acento)] sm:size-4" />
            <span>
              En uso
              <span className="block text-xs text-texto-suave">Sin la marca deja de ofrecerse al registrar. Un tipo no se borra: sus trámites lo siguen nombrando.</span>
            </span>
          </label>
        )}
      </fieldset>
      <PieDeVentana
        error={errorNombre || errorDias ? null : error}
        idError={`tipo-error-${id}`}
        enviando={enviando}
        alCancelar={alCancelar}
        texto={tipo ? 'Guardar' : 'Agregar el tipo'}
      />
    </form>
  )
}
