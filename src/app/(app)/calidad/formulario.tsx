'use client'

import { ClipboardCheck } from 'lucide-react'
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
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { AreaParaInspeccionar, CodigoParaInspeccionar, EtapaParaInspeccionar } from '@/lib/datos/calidad'
import {
  BUCKET_FOTOS_CALIDAD,
  MAXIMO_FOTOS_CALIDAD,
  MAXIMO_MB_FOTO_CALIDAD,
  RESULTADO_INSPECCION,
  RESULTADOS_INSPECCION,
} from '@/lib/dominio/calidad'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { registrarInspeccion } from './acciones'

/** El envío de la inspección y lo que dice cómo terminó: el botón y el renglón de estado del encabezado lo comparten. */
const CLAVE = 'calidad:inspeccionar'
const ID_DEL_ESTADO = 'estado-de-la-inspeccion'
type Entro = { mensaje: string; id: string | null }

/** Cómo terminó la inspección: el verde con «Ver la inspección», o por qué no entró si se cerró la ventana en vuelo. */
export function EstadoDeLaInspeccion() {
  const [entro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const [desenlace] = useEstadoCompartido<Desenlace | null>(`${CLAVE}:desenlace`, null)
  const [sigue] = useEstadoCompartido(`${CLAVE}:sigue`, false)
  return (
    <>
      {/* Montada siempre: el verde que nace con su texto no lo oye el lector. */}
      <p role="status" className={entro ? 'text-sm text-exito' : 'sr-only'}>
        {entro?.mensaje}
        {entro?.id && (
          <>
            {' '}
            <Link href={`/calidad/${entro.id}`} className="font-medium underline underline-offset-2">
              Ver la inspección
            </Link>
          </>
        )}
      </p>
      <EstadoDelEnvio id={ID_DEL_ESTADO} sigue={sigue} desenlace={desenlace} registro="La inspección" className="text-sm" />
    </>
  )
}

/**
 * «Registrar inspección» y su ventana: Calidad, en la planta, con el teléfono.
 * Las fotos, el id y el envío viven aquí y no en el formulario, que la ventana
 * desmonta al cerrarse (el patrón del reporte a SSOMA): tras «No llegó la
 * respuesta», volver a abrir manda el mismo id y la base no registra dos veces.
 */
export function RegistrarInspeccion({
  cuentaId,
  codigos,
  etapas,
  areas,
}: {
  cuentaId: string
  codigos: CodigoParaInspeccionar[]
  etapas: EtapaParaInspeccionar[]
  areas: AreaParaInspeccionar[]
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setEntro] = useEstadoCompartido<Entro | null>(`${CLAVE}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('inspeccion_calidad', () => refrescarSiEsDeLaPestana(router))
  const envio = useFotosDelEnvio(BUCKET_FOTOS_CALIDAD, CLAVE, ID_DEL_ESTADO)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    envio.conFotos((previo: unknown, datos: FormData) => {
      id.salio()
      return registrarInspeccion(previo, datos)
    }),
    (r) => {
      id.otro()
      if (!envio.seCerroAlEnviar()) setAbierta(false)
      setEntro({ mensaje: r.mensaje ?? 'Inspección registrada.', id: r.datos?.id ?? null })
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
        data-registrar-inspeccion
        onClick={() => {
          limpiar()
          setEntro(null)
          envio.abrir()
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <ClipboardCheck aria-hidden className="size-4" />}
        Registrar inspección
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo="Registrar inspección"
        descripcion="Elige el código y la etapa que revisaste. Lo no conforme le llega al área; no detiene la etapa siguiente."
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioInspeccion
            key={`${vez}:${id.id}`}
            id={id.id}
            cuentaId={cuentaId}
            codigos={codigos}
            etapas={etapas}
            areas={areas}
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
const DEL_CODIGO = /código interno|Elige un código/
const DE_LA_ETAPA = /etapa|Elige el área/i
const DE_LA_OBSERVACION = /no conforme, en al menos|observación pasa/

function FormularioInspeccion({
  id,
  cuentaId,
  codigos,
  etapas,
  areas,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  id: string
  cuentaId: string
  codigos: CodigoParaInspeccionar[]
  etapas: EtapaParaInspeccionar[]
  areas: AreaParaInspeccionar[]
  fotos: FotoLista[]
  setFotos: Dispatch<SetStateAction<FotoLista[]>>
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  const [codigo, setCodigo] = useState('')
  const [etapaId, setEtapaId] = useState('')
  const [resultado, setResultado] = useState('')
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const vieja = usePestanaDeLaVersionAnterior()
  const delCodigo = etapas.filter((e) => e.codigo === codigo)
  // Las etapas de siempre («Trámites», «Entrega») no tienen área, y la de Calidad
  // no se la observa a sí misma: Calidad elige el área que hizo el trabajo.
  const etapaSinArea = delCodigo.find((e) => e.id === etapaId)?.pide_area === true
  const pideArea = codigo !== '' && (delCodigo.length === 0 || etapaSinArea)
  const noConforme = resultado === 'NO_CONFORME'

  const errorCodigo = error && DEL_CODIGO.test(error) ? error : null
  const errorEtapa = !errorCodigo && error && DE_LA_ETAPA.test(error) ? error : null
  const errorObservacion = !errorCodigo && !errorEtapa && error && DE_LA_OBSERVACION.test(error) ? error : null
  // Un rechazo por el área va junto al área cuando se pide; si no, junto a la etapa.
  const errorArea = errorEtapa && pideArea && /área/i.test(errorEtapa) ? errorEtapa : null
  const errorDeLaEtapa = errorArea ? null : errorEtapa
  const errorDelPie = errorCodigo || errorEtapa || errorObservacion ? null : error
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () =>
        document.getElementById(
          errorCodigo
            ? 'calidad-codigo'
            : errorArea
              ? 'calidad-area'
              : errorDeLaEtapa
                ? 'calidad-etapa'
                : errorObservacion
                  ? 'calidad-observacion'
                  : 'calidad-error',
        ),
      [errorCodigo, errorArea, errorDeLaEtapa, errorObservacion],
    ),
  )
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="operacion_id" value={id} />
      {/* Trabado mientras se envía: una foto elegida o quitada entonces no iría con la inspección. */}
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo
          etiqueta="Código interno"
          htmlFor="calidad-codigo"
          requerido
          ayuda={codigos.length === 0 ? 'No hay códigos con una OT abierta ni con etapas: no hay nada que inspeccionar todavía.' : undefined}
          ayudaEnIcono={false}
          error={errorCodigo ?? undefined}
        >
          <SeleccionBuscable
            id="calidad-codigo"
            name="codigo"
            requerido
            marcador="Elige el código"
            marcadorBusqueda="Código, OT, cliente o unidad…"
            valor={codigo}
            onChange={(c) => {
              setCodigo(c)
              setEtapaId('')
            }}
            opciones={codigos.map((c) => ({
              valor: c.codigo,
              etiqueta: c.codigo,
              detalle: [c.ot && `OT ${c.ot}`, c.cliente, c.unidad].filter(Boolean).join(' · '),
            }))}
          />
        </Campo>

        {codigo && delCodigo.length > 0 && (
            <Campo
              etiqueta="Etapa que revisaste"
              htmlFor="calidad-etapa"
              requerido
              ayuda={etapaSinArea ? undefined : 'La observación le llega al área de la etapa.'}
              error={errorDeLaEtapa ?? undefined}
            >
              {/* Con otro código, otra lista: React no vuelve a aplicar el valor inicial de un select ya montado. */}
              <Seleccion key={codigo} id="calidad-etapa" name="etapa_id" required value={etapaId} onChange={(e) => setEtapaId(e.target.value)}>
                <option value="" disabled>
                  Elige la etapa
                </option>
                {delCodigo.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.padre_id ? '— ' : ''}
                    {e.orden}. {e.nombre}
                    {e.area ? ` · ${e.area}` : ''}
                    {e.terminada ? ' (terminada)' : ''}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          )}
        {pideArea && (
            <Campo
              etiqueta="Área que hizo el trabajo"
              htmlFor="calidad-area"
              requerido
              ayuda={
                etapaSinArea
                  ? 'Esta etapa no tiene otra área a cargo: elige la que hizo el trabajo, a ella le llega la observación.'
                  : 'Este código todavía no tiene etapas en el sistema: elige el área a la que le llega la observación.'
              }
              ayudaEnIcono={false}
              error={(errorArea ?? (delCodigo.length === 0 ? errorEtapa : null)) ?? undefined}
            >
              <Seleccion key={`${codigo}:${etapaId}`} id="calidad-area" name="area_id" required defaultValue="">
                <option value="" disabled>
                  Elige el área
                </option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          )}

        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            Resultado<span className="ml-0.5 text-peligro">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {RESULTADOS_INSPECCION.map((valor) => (
              <label key={valor} className={OPCION}>
                <input
                  type="radio"
                  name="resultado"
                  value={valor}
                  required
                  checked={resultado === valor}
                  onChange={() => setResultado(valor)}
                  className={RADIO}
                />
                <span>
                  <span className="font-medium">{RESULTADO_INSPECCION[valor].etiqueta}</span>
                  <span className="block text-xs text-texto-suave">{RESULTADO_INSPECCION[valor].descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Campo
          etiqueta={noConforme ? 'Qué está no conforme' : 'Observación (opcional)'}
          htmlFor="calidad-observacion"
          requerido={noConforme}
          ayuda={noConforme ? 'Dónde está y qué hay que corregir: es lo que el área va a leer.' : undefined}
          ayudaEnIcono={false}
          error={errorObservacion ?? undefined}
        >
          <AreaTexto
            id="calidad-observacion"
            name="observacion"
            required={noConforme}
            minLength={noConforme ? 10 : undefined}
            maxLength={2000}
            rows={4}
            placeholder={noConforme ? 'Por ejemplo: soldadura con poros en la unión del larguero trasero, lado izquierdo.' : undefined}
          />
        </Campo>

        <section aria-label="Fotos" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">Fotos (opcional)</p>
          <p className="text-xs text-texto-suave">De lo observado, para que el área lo encuentre sin buscarlo.</p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${id}`}
            maximo={MAXIMO_FOTOS_CALIDAD}
            bucket={BUCKET_FOTOS_CALIDAD}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_CALIDAD}
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
        idError="calidad-error"
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Registrar'}
        disabled={subiendo || fallidas || codigos.length === 0}
      />
    </form>
  )
}
