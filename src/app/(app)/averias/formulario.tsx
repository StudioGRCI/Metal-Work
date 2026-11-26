'use client'

import { TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

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
import { AreaTexto, Campo } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { EquipoParaReportar } from '@/lib/datos/averias'
import { BUCKET_FOTOS_AVERIAS, MAXIMO_FOTOS_AVERIA, MAXIMO_MB_FOTO_AVERIA, TIPO_AVERIA, TIPOS_AVERIA } from '@/lib/dominio/averias'
import { ESTADO_EQUIPO, type EstadoEquipo } from '@/lib/dominio/equipos'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { reportarAveria } from './acciones'

/** El envío del reporte y lo que dice cómo terminó: el botón y el renglón de estado del encabezado lo comparten. */
const CLAVE = 'averias:reportar'
const ID_DEL_ESTADO = 'estado-del-reporte-de-averia'
type Entro = { mensaje: string; id: string | null }

/**
 * Cómo terminó el reporte: el verde con su número y «Ver cómo va», o por qué no
 * entró si se cerró la ventana en vuelo. Va en el renglón `estado` del encabezado.
 */
export function EstadoDelReporteDeAveria() {
  const [entro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const [desenlace] = useEstadoCompartido<Desenlace | null>(`${CLAVE}:desenlace`, null)
  const [sigue] = useEstadoCompartido(`${CLAVE}:sigue`, false)
  return (
    <>
      {/* Montada siempre: el verde que nace con su texto no lo oye el lector, y
          tras cerrar en vuelo es lo único que dice que entró. */}
      <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'}>
        {entro?.mensaje}
        {entro?.id && (
          <>
            {' '}
            <Link href={`/averias/${entro.id}`} className="font-medium underline underline-offset-2">
              Ver cómo va
            </Link>
          </>
        )}
      </p>
      <EstadoDelEnvio id={ID_DEL_ESTADO} sigue={sigue} desenlace={desenlace} registro="El reporte" className="text-sm" />
    </>
  )
}

/**
 * El botón «Reportar avería» y su ventana: lo usa cualquier puesto, desde el
 * teléfono. Las fotos y el envío viven aquí y no en el formulario, que la
 * ventana desmonta al cerrarse: si se cierra sin reportar, las fotos ya subidas
 * se retiran de Storage; si se cierra mientras se envía, lo que conteste se dice
 * en el renglón de estado.
 *
 * El id del reporte también vive aquí (`useIdDelEnvio`): tras «No llegó la
 * respuesta», cerrar y volver a abrir manda el mismo, y la base no da otro
 * número AV a la misma falla. Al volver a abrir se le pregunta si aquel entró.
 */
export function ReportarAveria({
  cuentaId,
  equipos,
  equipoInicial = '',
}: {
  cuentaId: string
  equipos: EquipoParaReportar[]
  /** El equipo ya elegido, si se llegó desde su fila (`?equipo=`). */
  equipoInicial?: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  // Si el anterior sí entró, «Tus reportes» lo muestra en el acto: no esperaba a la recarga.
  const id = useIdDelEnvio('reporte_averia', () => refrescarSiEsDeLaPestana(router))
  const envio = useFotosDelEnvio(BUCKET_FOTOS_AVERIAS, CLAVE, ID_DEL_ESTADO)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    envio.conFotos((previo: unknown, datos: FormData) => {
      id.salio()
      return reportarAveria(previo, datos)
    }),
    (r) => {
      id.otro()
      if (!envio.seCerroAlEnviar()) setAbierta(false)
      setEntro({ mensaje: r.mensaje ?? 'Reporte registrado.', id: r.datos?.id ?? null })
    },
    { alYaEntrar: id.otro },
  )
  function cerrar() {
    envio.cerrar()
    setAbierta(false)
  }
  // Cerrada mientras el reporte va en camino: no se abre otra hasta que conteste,
  // ni mientras la página se pone al día tras el ok.
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && !abierta)
  return (
    <>
      <Boton
        type="button"
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        data-reportar-averia
        onClick={() => {
          limpiar()
          setEntro(null)
          envio.abrir()
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <TriangleAlert aria-hidden className="size-4" />}
        Reportar avería
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo="Reportar una avería"
        descripcion="Una máquina, una herramienta o un equipo de cómputo que falla o está por fallar. Le llega a Mantenimiento en el momento y tú ves cómo va."
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioAveria
            // Con otro id, otro formulario: lo escrito para el que ya entró no se arrastra.
            key={`${vez}:${id.id}`}
            id={id.id}
            cuentaId={cuentaId}
            equipos={equipos}
            equipoInicial={equipoInicial}
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

/** Los rechazos de la base que son del equipo: se dicen junto a él y el cursor va ahí. */
const DEL_EQUIPO = /Elige el equipo|dado de baja/

function SiNo({ nombre, etiqueta, ayuda, valor, alCambiar }: { nombre: string; etiqueta: string; ayuda: string; valor: string; alCambiar: (v: string) => void }) {
  return (
    // La ayuda se oye al llegar a la pregunta, no solo se ve.
    <fieldset className="space-y-2" aria-describedby={`averia-${nombre}-ayuda`}>
      <legend className="mb-1 text-xs font-medium text-texto-suave">
        {etiqueta}
        <span className="ml-0.5 text-peligro">*</span>
      </legend>
      <p id={`averia-${nombre}-ayuda`} className="text-xs text-texto-suave">
        {ayuda}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
        {(['SI', 'NO'] as const).map((v) => (
          <label key={v} className={OPCION}>
            <input type="radio" name={nombre} value={v} required checked={valor === v} onChange={() => alCambiar(v)} className={RADIO} />
            <span>{v === 'SI' ? 'Sí' : 'No'}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function FormularioAveria({
  id,
  cuentaId,
  equipos,
  equipoInicial,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  id: string
  cuentaId: string
  equipos: EquipoParaReportar[]
  equipoInicial: string
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  const [equipo, setEquipo] = useState(() => (equipos.some((e) => e.id === equipoInicial) ? equipoInicial : ''))
  const [tipo, setTipo] = useState('')
  const [detiene, setDetiene] = useState('')
  const [riesgo, setRiesgo] = useState('')
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  // Con la pestaña vieja ni quitarlas ni subirlas otra vez sirve: no va a entrar.
  const vieja = usePestanaDeLaVersionAnterior()
  const elegido = equipos.find((e) => e.id === equipo) ?? null
  const errorEquipo = error && DEL_EQUIPO.test(error) ? error : null
  const errorDelPie = errorEquipo ? null : error
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById(errorEquipo ? 'averia-equipo' : 'averia-error'), [errorEquipo]),
  )
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      {/* Trabado mientras se envía: una foto elegida o quitada entonces no iría con el reporte. */}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo
          etiqueta="Equipo"
          htmlFor="averia-equipo"
          requerido
          ayuda="Busca por el código que lleva grabado o por lo que es: «AM-04», «soldadora», «laptop». ¿No está en la lista? Avísale a Mantenimiento para que lo dé de alta en el padrón."
          ayudaEnIcono={false}
          error={errorEquipo ?? undefined}
        >
          <SeleccionBuscable
            id="averia-equipo"
            name="equipo_id"
            requerido
            marcador="Elige el equipo"
            marcadorBusqueda="Código, nombre o área…"
            valor={equipo}
            onChange={setEquipo}
            permiteVaciar={false}
            opciones={equipos.map((e) => ({
              valor: e.id,
              etiqueta: `${e.codigo} · ${e.descripcion}`,
              detalle: [e.marca, e.area, e.ubicacion].filter(Boolean).join(' · '),
            }))}
          />
        </Campo>
        {elegido && elegido.estado !== 'OPERATIVO' && (
          <p className="-mt-2 text-xs text-texto-suave" data-equipo-ya-figura>
            En el padrón ya figura {ESTADO_EQUIPO[elegido.estado as EstadoEquipo]?.etiqueta.toLowerCase() ?? elegido.estado}. Si es otra falla, o
            empeoró, repórtala igual.
          </p>
        )}

        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            ¿Avería o posible avería?<span className="ml-0.5 text-peligro">*</span>
          </legend>
          {TIPOS_AVERIA.map((valor) => (
            <label key={valor} className={OPCION}>
              <input type="radio" name="tipo" value={valor} required checked={tipo === valor} onChange={() => setTipo(valor)} className={RADIO} />
              <span>
                <span className="font-medium">{TIPO_AVERIA[valor].etiqueta}</span>
                <span className="block text-xs text-texto-suave">{TIPO_AVERIA[valor].descripcion}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {tipo === 'AVERIA' && (
          <SiNo
            nombre="detiene"
            etiqueta="¿Detiene el trabajo?"
            ayuda="Si no se puede trabajar sin él, queda parado en el padrón hasta que Mantenimiento lo arregle."
            valor={detiene}
            alCambiar={setDetiene}
          />
        )}

        <SiNo
          nombre="riesgo"
          etiqueta="¿Es un riesgo para las personas?"
          ayuda="Un cable pelado, una guarda que falta, chispas, una pieza que puede saltar. Si lo es, también le avisamos a SSOMA."
          valor={riesgo}
          alCambiar={setRiesgo}
        />

        <Campo
          etiqueta="Qué hace el equipo"
          htmlFor="averia-descripcion"
          requerido
          ayuda="Con tus palabras: qué hace o qué deja de hacer, desde cuándo, y qué se hizo en el momento."
          ayudaEnIcono={false}
        >
          <AreaTexto
            id="averia-descripcion"
            name="descripcion"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            placeholder="Por ejemplo: el disco se traba al cortar y salen chispas por la guarda. La desenchufé."
          />
        </Campo>

        <section aria-label="Fotos" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">Fotos (opcional)</p>
          <p className="text-xs text-texto-suave">
            De la falla o de la placa del equipo: ayudan a Mantenimiento a llegar con lo que hace falta. Hasta {MAXIMO_FOTOS_AVERIA}.
          </p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${id}`}
            maximo={MAXIMO_FOTOS_AVERIA}
            bucket={BUCKET_FOTOS_AVERIAS}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_AVERIA}
            titulo={null}
          />
        </section>
        {!subiendo && fallidas && (
          <p className="text-sm text-peligro">
            {vieja ? 'Vuelve a cargar la pantalla para reportar.' : 'Quita o vuelve a subir las fotos que no entraron antes de reportar.'}
          </p>
        )}
      </fieldset>
      <PieDeVentana
        error={errorDelPie}
        idError="averia-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Enviar el reporte'}
        disabled={subiendo || fallidas}
      />
    </form>
  )
}
