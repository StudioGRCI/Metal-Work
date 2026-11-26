'use client'

import { BadgeAlert } from 'lucide-react'
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
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { UnidadParaReclamar } from '@/lib/datos/garantias'
import { BUCKET_FOTOS_GARANTIAS, MAXIMO_FOTOS_GARANTIA, MAXIMO_MB_FOTO_GARANTIA } from '@/lib/dominio/garantias'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { registrarReclamo } from './acciones'

/** El envío del reclamo y lo que dice cómo terminó: el botón y el renglón de estado del encabezado lo comparten. */
const CLAVE = 'garantias:registrar'
const ID_DEL_ESTADO = 'estado-del-reclamo-de-garantia'
type Entro = { mensaje: string; id: string | null }

/**
 * Cómo terminó el reclamo: el verde con su número y «Ver cómo va», o por qué no
 * entró si se cerró la ventana en vuelo. Va en el renglón `estado` del encabezado.
 */
export function EstadoDelReclamo() {
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
            <Link href={`/garantias/${entro.id}`} className="font-medium underline underline-offset-2">
              Ver cómo va
            </Link>
          </>
        )}
      </p>
      <EstadoDelEnvio id={ID_DEL_ESTADO} sigue={sigue} desenlace={desenlace} registro="El reclamo" className="text-sm" />
    </>
  )
}

/**
 * El botón «Registrar reclamo» y su ventana, para Ventas. Las fotos y el envío
 * viven aquí y no en el formulario, que la ventana desmonta al cerrarse: si se
 * cierra sin registrar, las fotos ya subidas se retiran de Storage; si se
 * cierra mientras se envía, lo que conteste se dice en el renglón de estado.
 *
 * El id del reclamo también vive aquí (`useIdDelEnvio`): tras «No llegó la
 * respuesta», cerrar y volver a abrir manda el mismo, y la base no le da otro
 * número RG al mismo reclamo.
 */
export function RegistrarReclamo({ cuentaId, unidades }: { cuentaId: string; unidades: UnidadParaReclamar[] }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('reclamo_garantia', () => refrescarSiEsDeLaPestana(router))
  const envio = useFotosDelEnvio(BUCKET_FOTOS_GARANTIAS, CLAVE, ID_DEL_ESTADO)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    envio.conFotos((previo: unknown, datos: FormData) => {
      id.salio()
      return registrarReclamo(previo, datos)
    }),
    (r) => {
      id.otro()
      if (!envio.seCerroAlEnviar()) setAbierta(false)
      setEntro({ mensaje: r.mensaje ?? 'Reclamo registrado.', id: r.datos?.id ?? null })
    },
    { alYaEntrar: id.otro },
  )
  function cerrar() {
    envio.cerrar()
    setAbierta(false)
  }
  // Cerrada mientras el reclamo va en camino: no se abre otra hasta que conteste,
  // ni mientras la página se pone al día tras el ok.
  const { sigue, idDelEstado } = envio
  const ocupado = sigue || (enviando && !abierta)
  return (
    <>
      <Boton
        type="button"
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        data-registrar-reclamo
        onClick={() => {
          limpiar()
          setEntro(null)
          envio.abrir()
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <BadgeAlert aria-hidden className="size-4" />}
        Registrar reclamo
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo="Registrar un reclamo de garantía"
        descripcion="El cliente vuelve con su unidad por algo que hizo el taller. Sale con su número RG y le llega a Administración, que abre su OT de garantía."
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioReclamo
            // Con otro id, otro formulario: lo escrito para el que ya entró no se arrastra.
            key={`${vez}:${id.id}`}
            id={id.id}
            cuentaId={cuentaId}
            unidades={unidades}
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

/** Los rechazos de la base que son de la unidad: se dicen junto a ella y el cursor va ahí. */
const DE_LA_UNIDAD = /Elige la unidad|unidad no tiene cliente/

/** «ABC-123 · M-0045 · Furgón · TRANSPORTES SAC». */
const nombreDeLaUnidad = (u: UnidadParaReclamar) => [u.placa ?? 'Sin placa', u.codigo_interno, u.carroceria].filter(Boolean).join(' · ')

function FormularioReclamo({
  id,
  cuentaId,
  unidades,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  id: string
  cuentaId: string
  unidades: UnidadParaReclamar[]
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  const [unidad, setUnidad] = useState('')
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  // Con la pestaña vieja ni quitarlas ni subirlas otra vez sirve: no va a entrar.
  const vieja = usePestanaDeLaVersionAnterior()
  const elegida = unidades.find((u) => u.id === unidad) ?? null
  const errorUnidad = error && DE_LA_UNIDAD.test(error) ? error : null
  const errorDelPie = errorUnidad ? null : error
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById(errorUnidad ? 'reclamo-unidad' : 'reclamo-error'), [errorUnidad]),
  )
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      {/* Trabado mientras se envía: una foto elegida o quitada entonces no iría con el reclamo. */}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo
          etiqueta="Unidad"
          htmlFor="reclamo-unidad"
          requerido
          ayuda="Busca por la placa, el código interno o el cliente. El reclamo queda con el cliente de la unidad. ¿No está? Regístrala primero en Unidades."
          ayudaEnIcono={false}
          error={errorUnidad ?? undefined}
        >
          <SeleccionBuscable
            id="reclamo-unidad"
            name="unidad_id"
            requerido
            marcador="Elige la unidad"
            marcadorBusqueda="Placa, código interno o cliente…"
            valor={unidad}
            onChange={setUnidad}
            permiteVaciar={false}
            opciones={unidades.map((u) => ({
              valor: u.id,
              etiqueta: nombreDeLaUnidad(u),
              detalle: [u.cliente, u.marca].filter(Boolean).join(' · '),
            }))}
          />
        </Campo>
        {elegida && (
          <p className="-mt-2 text-xs text-texto-suave" data-cliente-de-la-unidad>
            Cliente: <span className="font-medium text-texto">{elegida.cliente}</span>.
            {elegida.reclamo_abierto && (
              <span className="block" data-ya-tiene-reclamo>
                Esta unidad ya tiene abierto el reclamo {elegida.reclamo_abierto}. Si es otra falla, regístrala igual; si es la misma, no la repitas.
              </span>
            )}
          </p>
        )}

        <Campo
          etiqueta="Qué reclama el cliente"
          htmlFor="reclamo-descripcion"
          requerido
          ayuda="Con sus palabras: qué falla, dónde, desde cuándo y qué trabajo del taller fue."
          ayudaEnIcono={false}
        >
          <AreaTexto
            id="reclamo-descripcion"
            name="descripcion"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            placeholder="Por ejemplo: la compuerta trasera no cierra y entra agua a la tolva. La carrocería se entregó en marzo."
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Quién lo trae" htmlFor="reclamo-trae" ayuda="El chofer o la persona que vino con la unidad." ayudaEnIcono={false}>
            <Entrada id="reclamo-trae" name="trae" maxLength={120} autoComplete="off" />
          </Campo>
          <Campo etiqueta="Contacto" htmlFor="reclamo-contacto" ayuda="Su teléfono o su correo, para avisarle." ayudaEnIcono={false}>
            <Entrada id="reclamo-contacto" name="contacto" maxLength={60} autoComplete="off" />
          </Campo>
        </div>

        <section aria-label="Fotos" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">Fotos (opcional)</p>
          <p className="text-xs text-texto-suave">De lo que falla y de la placa de la unidad. Hasta {MAXIMO_FOTOS_GARANTIA}.</p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${id}`}
            maximo={MAXIMO_FOTOS_GARANTIA}
            bucket={BUCKET_FOTOS_GARANTIAS}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_GARANTIA}
            titulo={null}
          />
        </section>
        {!subiendo && fallidas && (
          <p className="text-sm text-peligro">
            {vieja ? 'Vuelve a cargar la pantalla para registrar.' : 'Quita o vuelve a subir las fotos que no entraron antes de registrar.'}
          </p>
        )}
      </fieldset>
      <PieDeVentana
        error={errorDelPie}
        idError="reclamo-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Registrar el reclamo'}
        disabled={subiendo || fallidas}
      />
    </form>
  )
}
