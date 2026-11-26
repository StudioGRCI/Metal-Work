'use client'

import { Ban, CheckCircle2, ClipboardCheck, ListPlus, RotateCcw, UserRoundPen } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState, type FormEvent } from 'react'

import {
  EstadoDelEnvio,
  SelectorFotos,
  fotosParaEnviar,
  hayFallidas,
  haySubiendo,
  useFotosDelEnvio,
} from '@/components/avance/selector-fotos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { CuentaParaAsignar } from '@/lib/datos/ssoma'
import {
  BUCKET_FOTOS_SSOMA,
  CLASIFICACION_SSOMA,
  CLASIFICACIONES_SSOMA,
  esAccidente,
  MAXIMO_FOTOS_EVIDENCIA,
  MAXIMO_MB_FOTO_SSOMA,
} from '@/lib/dominio/ssoma'
import { refrescarSiEsDeLaPestana, useCursorAlRechazo, useEnvio, useIdDelEnvio, usePestanaDeLaVersionAnterior } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'
import { sumarDias } from '@/lib/format'

import {
  anularAccionSsoma,
  anularReporteSsoma,
  cerrarAccionSsoma,
  clasificarReporteSsoma,
  crearAccionSsoma,
  reabrirAccionSsoma,
  reasignarAccionSsoma,
} from '../acciones'

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

/** SSOMA anula un reporte mal hecho, con su motivo. No se borra: queda con quién, cuándo y por qué. */
export function AnularReporte({ id, numero }: { id: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularReporteSsoma, () => setAbierta(false))
  return (
    <>
      <Boton
        type="button"
        variante="contornoPeligro"
        data-anular-reporte
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
        titulo={`Anular el reporte ${numero}`}
        descripcion="Para un reporte repetido o hecho por error. No se borra: queda con su motivo y le llega el aviso a quien lo reportó."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-ssoma-${id}`} requerido>
              <AreaTexto
                id={`anular-ssoma-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: es el mismo hecho del reporte RI-0012-2026."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

/** Lo que vale hoy de la clasificación del reporte, para corregirla. */
export type ClasificacionActual = {
  clasificacion: string
  hubo_atencion: boolean | null
  dias_perdidos: number | null
  causa: string
}

/**
 * SSOMA clasifica el reporte con las clases de la R.M. 050-2013-TR y anota la
 * causa. Del accidente, si hubo atención médica; del incapacitante, los días
 * perdidos. Nunca el diagnóstico. Se puede corregir: la base guarda cada una.
 */
export function ClasificarReporte({
  id,
  numero,
  actual,
  propuesta,
  atencionReportada,
}: {
  id: string
  numero: string
  actual: ClasificacionActual | null
  /** La clase que corresponde a lo que se reportó, para empezar por ella. */
  propuesta: string
  /** Lo que dijo quien reportó un accidente sobre la atención médica. */
  atencionReportada: boolean | null
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    clasificarReporteSsoma,
    () => setAbierta(false),
    // Corregir la clasificación cambia lo que la ficha muestra.
    { corrige: Boolean(actual) },
  )
  return (
    <>
      <Boton
        type="button"
        variante={actual ? 'secundario' : 'primario'}
        data-clasificar-reporte
        onClick={() => {
          limpiar()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <ClipboardCheck aria-hidden className="size-4" />
        {actual ? 'Corregir la clasificación' : 'Clasificar'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={actual ? `Corregir la clasificación del ${numero}` : `Clasificar el ${numero}`}
        descripcion="Qué fue de verdad y por qué pasó. La ven solo SSOMA y Gerencia: quien reportó y el área no la leen."
        ancho="lg"
      >
        <FormularioClasificar
          key={vez}
          id={id}
          actual={actual}
          propuesta={propuesta}
          atencionReportada={atencionReportada}
          alEnviar={alEnviar}
          enviando={enviando}
          error={error}
          alCancelar={() => setAbierta(false)}
        />
      </Ventana>
    </>
  )
}

const DE_LOS_DIAS = /días de descanso|días perdidos/
const DE_LA_CAUSA = /causa/

function FormularioClasificar({
  id,
  actual,
  propuesta,
  atencionReportada,
  alEnviar,
  enviando,
  error,
  alCancelar,
}: {
  id: string
  actual: ClasificacionActual | null
  propuesta: string
  atencionReportada: boolean | null
  alEnviar: (evento: FormEvent<HTMLFormElement>) => void
  enviando: boolean
  error: string | null
  alCancelar: () => void
}) {
  const [clase, setClase] = useState(actual?.clasificacion ?? propuesta)
  const accidente = esAccidente(clase)
  const atencion = actual?.hubo_atencion ?? atencionReportada
  const errorDias = error && DE_LOS_DIAS.test(error) ? error : null
  const errorCausa = !errorDias && error && DE_LA_CAUSA.test(error) ? error : null
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () => document.getElementById(errorDias ? `ssoma-dias-${id}` : errorCausa ? `ssoma-causa-${id}` : `ssoma-clasificar-error-${id}`),
      [errorDias, errorCausa, id],
    ),
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            Clasificación<span className="ml-0.5 text-peligro">*</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLASIFICACIONES_SSOMA.map((valor) => (
              <label key={valor} className={OPCION}>
                <input
                  type="radio"
                  name="clasificacion"
                  value={valor}
                  required
                  checked={clase === valor}
                  onChange={() => setClase(valor)}
                  className={RADIO}
                />
                <span>
                  <span className="font-medium">{CLASIFICACION_SSOMA[valor].etiqueta}</span>
                  <span className="block text-xs text-texto-suave">{CLASIFICACION_SSOMA[valor].descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {accidente && (
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-texto-suave">
                ¿Hubo atención médica?
                <span className="ml-0.5 text-peligro">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {(['SI', 'NO'] as const).map((v) => (
                  <label key={v} className={OPCION}>
                    <input
                      type="radio"
                      name="hubo_atencion"
                      value={v}
                      required
                      defaultChecked={atencion === null ? false : atencion === (v === 'SI')}
                      className={RADIO}
                    />
                    <span>{v === 'SI' ? 'Sí' : 'No'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {clase === 'ACCIDENTE_INCAPACITANTE' && (
              <Campo
                etiqueta="Días perdidos"
                htmlFor={`ssoma-dias-${id}`}
                requerido
                ayuda="Los días de descanso médico. Sin el diagnóstico."
                error={errorDias ?? undefined}
              >
                <Entrada
                  id={`ssoma-dias-${id}`}
                  name="dias_perdidos"
                  type="number"
                  inputMode="numeric"
                  required
                  min={1}
                  max={3650}
                  step={1}
                  defaultValue={actual?.dias_perdidos ?? undefined}
                  className="tabular sm:max-w-[10rem]"
                />
              </Campo>
            )}
          </div>
        )}
        {accidente && (
          <p className="text-xs text-texto-suave">
            Solo si hubo atención y cuántos días. El diagnóstico y los datos médicos no se guardan aquí.
          </p>
        )}

        <Campo
          etiqueta="Causa"
          htmlFor={`ssoma-causa-${id}`}
          requerido
          ayuda="Por qué pasó: qué condición o qué acto lo causó. La acción correctiva corrige esto."
          ayudaEnIcono={false}
          error={errorCausa ?? undefined}
        >
          <AreaTexto
            id={`ssoma-causa-${id}`}
            name="causa"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            defaultValue={actual?.causa}
            placeholder="Por ejemplo: el estante se armó sin el tope de fábrica y nadie lo revisó al recibirlo."
          />
        </Campo>
      </fieldset>
      <PieDeVentana
        error={errorDias || errorCausa ? null : error}
        idError={`ssoma-clasificar-error-${id}`}
        enviando={enviando}
        alCancelar={alCancelar}
        texto="Guardar la clasificación"
      />
    </form>
  )
}

/** Las cuentas, como las ofrece el buscador: nombre, y debajo el puesto y el área. */
function opcionesDeCuentas(cuentas: CuentaParaAsignar[]) {
  return cuentas.map((c) => ({
    valor: c.id,
    etiqueta: c.nombre,
    detalle: [c.puesto, c.area].filter(Boolean).join(' · '),
  }))
}

const CLAVE_ACCION = 'ssoma:accion'

/**
 * SSOMA encarga una acción correctiva: qué se hace, quién (una cuenta) y hasta
 * cuándo. El id vive aquí (`useIdDelEnvio`): tras «No llegó la respuesta»,
 * volver a abrir pregunta si la anterior entró, y no se encarga dos veces.
 */
export function AgregarAccion({
  reporteId,
  numero,
  cuentas,
  hoy,
  corregido = false,
}: {
  reporteId: string
  numero: string
  cuentas: CuentaParaAsignar[]
  /** Hoy en Lima, como lo dice el servidor: la fecha límite va desde hoy. */
  hoy: string
  /** El reporte ya está corregido: otra acción lo vuelve a «En corrección». */
  corregido?: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [entro, setEntro] = useEstadoCompartido<string | null>(`${CLAVE_ACCION}:${reporteId}`, null)
  const router = useRouter()
  const id = useIdDelEnvio('accion_ssoma', () => refrescarSiEsDeLaPestana(router), reporteId)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    (previo: unknown, datos: FormData) => {
      id.salio()
      return crearAccionSsoma(previo, datos)
    },
    (r) => {
      id.otro()
      setAbierta(false)
      setEntro(r.mensaje ?? 'Acción registrada.')
    },
    { alYaEntrar: id.otro },
  )
  return (
    <div className="flex flex-col items-end gap-1">
      <Boton
        type="button"
        // En un reporte ya corregido no es lo que más llama: la ficha terminó.
        variante={corregido ? 'secundario' : 'primario'}
        data-agregar-accion
        onClick={() => {
          limpiar()
          setEntro(null)
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <ListPlus aria-hidden className="size-4" />
        Agregar acción
      </Boton>
      <p role="status" className={entro ? 'text-right text-xs text-exito' : 'sr-only'}>
        {entro}
      </p>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Acción correctiva del ${numero}`}
        descripcion="Qué se tiene que hacer, quién lo hace y hasta cuándo. Al responsable le llega el aviso y la cierra con fotos de lo que hizo."
        ancho="lg"
      >
        <EnvioAnterior texto={id.anterior} />
        {corregido && <AvisoDeCorregido />}
        {id.id && (
          <FormularioAccion
            key={`${vez}:${id.id}`}
            id={id.id}
            reporteId={reporteId}
            cuentas={cuentas}
            hoy={hoy}
            alEnviar={alEnviar}
            enviando={enviando}
            error={error}
            alCancelar={() => setAbierta(false)}
          />
        )}
      </Ventana>
    </div>
  )
}

const DEL_RESPONSABLE = /responsable/
const DE_LA_FECHA_LIMITE = /fecha límite/

function FormularioAccion({
  id,
  reporteId,
  cuentas,
  hoy,
  alEnviar,
  enviando,
  error,
  alCancelar,
}: {
  id: string
  reporteId: string
  cuentas: CuentaParaAsignar[]
  hoy: string
  alEnviar: (evento: FormEvent<HTMLFormElement>) => void
  enviando: boolean
  error: string | null
  alCancelar: () => void
}) {
  const [responsable, setResponsable] = useState('')
  const errorResponsable = error && DEL_RESPONSABLE.test(error) ? error : null
  const errorFecha = !errorResponsable && error && DE_LA_FECHA_LIMITE.test(error) ? error : null
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(
      () =>
        document.getElementById(
          errorResponsable ? `ssoma-responsable-${id}` : errorFecha ? `ssoma-limite-${id}` : `ssoma-accion-error-${id}`,
        ),
      [errorResponsable, errorFecha, id],
    ),
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
      <input type="hidden" name="reporte_id" value={reporteId} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo etiqueta="Qué se tiene que hacer" htmlFor={`ssoma-que-${id}`} requerido>
          <AreaTexto
            id={`ssoma-que-${id}`}
            name="descripcion"
            required
            minLength={10}
            maxLength={500}
            rows={3}
            placeholder="Por ejemplo: poner el tope de fábrica al estante alto del pasillo 3."
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <Campo etiqueta="Responsable" htmlFor={`ssoma-responsable-${id}`} requerido error={errorResponsable ?? undefined}>
            <SeleccionBuscable
              id={`ssoma-responsable-${id}`}
              name="responsable_id"
              requerido
              marcador="Elige la cuenta"
              marcadorBusqueda="Nombre, puesto o área…"
              valor={responsable}
              onChange={setResponsable}
              opciones={opcionesDeCuentas(cuentas)}
            />
          </Campo>
          <Campo etiqueta="Fecha límite" htmlFor={`ssoma-limite-${id}`} requerido error={errorFecha ?? undefined}>
            <Entrada
              id={`ssoma-limite-${id}`}
              name="fecha_limite"
              type="date"
              required
              min={hoy}
              max={sumarDias(hoy, 365)}
              defaultValue={sumarDias(hoy, 7)}
              className="tabular"
            />
          </Campo>
        </div>
      </fieldset>
      <PieDeVentana
        error={errorResponsable || errorFecha ? null : error}
        idError={`ssoma-accion-error-${id}`}
        enviando={enviando}
        alCancelar={alCancelar}
        texto="Encargar la acción"
      />
    </form>
  )
}

/**
 * El responsable (o SSOMA) cierra la acción con qué se hizo y de una a cuatro
 * fotos. Como «Reportar incidente»: las fotos y el envío viven aquí y no en el
 * formulario, y el id del cierre (la carpeta de sus fotos) también, para que
 * tras «No llegó la respuesta» volver a abrir pregunte si aquel entró.
 */
/**
 * El verde del cierre, en la fila de la acción y siempre montado: el botón
 * «Cerrar con evidencia» desaparece cuando la acción queda cerrada, y el aviso
 * que vivía en él duraba una décima de segundo.
 */
export function AvisoDelCierre({ accionId }: { accionId: string }) {
  const [entro] = useEstadoCompartido<string | null>(`ssoma:cierre:${accionId}:aviso`, null)
  return (
    <p role="status" className={entro ? 'mt-1 text-xs text-exito' : 'sr-only'}>
      {entro}
    </p>
  )
}

export function CerrarAccion({
  accionId,
  cuentaId,
  descripcion,
  principal = true,
}: {
  accionId: string
  cuentaId: string
  descripcion: string
  /** Es de quien mira: el botón más llamativo. Para SSOMA, que cierra por otro, de contorno. */
  principal?: boolean
}) {
  const clave = `ssoma:cierre:${accionId}`
  const idDelEstado = `estado-del-cierre-${accionId}`
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [entro, setEntro] = useEstadoCompartido<string | null>(`${clave}:aviso`, null)
  const router = useRouter()
  const id = useIdDelEnvio('cierre_accion_ssoma', () => refrescarSiEsDeLaPestana(router), accionId)
  const envio = useFotosDelEnvio(BUCKET_FOTOS_SSOMA, clave, idDelEstado)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    envio.conFotos((previo: unknown, datos: FormData) => {
      id.salio()
      return cerrarAccionSsoma(previo, datos)
    }),
    (r) => {
      id.otro()
      if (!envio.seCerroAlEnviar()) setAbierta(false)
      setEntro(r.mensaje ?? 'Acción cerrada.')
    },
    { alYaEntrar: id.otro },
  )
  function cerrar() {
    envio.cerrar()
    setAbierta(false)
  }
  const { sigue } = envio
  const ocupado = sigue || (enviando && !abierta)
  return (
    // Sin `space-y`: los avisos ocultos le sumaban margen y el botón quedaba corrido junto a los demás.
    <div>
      <Boton
        type="button"
        tamano="sm"
        variante={principal ? 'primario' : 'contorno'}
        ocupado={ocupado}
        aria-describedby={sigue ? idDelEstado : undefined}
        data-cerrar-accion={accionId}
        onClick={() => {
          limpiar()
          setEntro(null)
          envio.abrir()
          id.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {!ocupado && <CheckCircle2 aria-hidden className="size-4" />}
        Cerrar con evidencia
      </Boton>
      {/* El verde («…ya le avisamos a SSOMA») lo pinta `AvisoDelCierre` en la fila: este botón se va con la acción cerrada. */}
      <EstadoDelEnvio id={idDelEstado} sigue={sigue} desenlace={envio.desenlace} registro="El cierre" className="mt-1 text-xs" />
      <Ventana abierta={abierta} alCerrar={cerrar} titulo="Cerrar la acción con evidencia" descripcion={descripcion} ancho="lg">
        <EnvioAnterior texto={id.anterior} />
        {id.id && (
          <FormularioCierre
            key={`${vez}:${id.id}`}
            id={id.id}
            accionId={accionId}
            cuentaId={cuentaId}
            fotos={envio.fotos}
            setFotos={envio.setFotos}
            alCancelar={cerrar}
            alEnviar={alEnviar}
            enviando={enviando}
            error={error}
          />
        )}
      </Ventana>
    </div>
  )
}

function FormularioCierre({
  id,
  accionId,
  cuentaId,
  fotos,
  setFotos,
  alCancelar,
  alEnviar,
  enviando,
  error,
}: {
  id: string
  accionId: string
  cuentaId: string
  fotos: ReturnType<typeof useFotosDelEnvio>['fotos']
  setFotos: ReturnType<typeof useFotosDelEnvio>['setFotos']
  alCancelar: () => void
  alEnviar: (evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) => void
  enviando: boolean
  error: string | null
}) {
  const subiendo = haySubiendo(fotos)
  const fallidas = hayFallidas(fotos)
  const listas = fotosParaEnviar(fotos).length
  const vieja = usePestanaDeLaVersionAnterior()
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById(`ssoma-cierre-error-${accionId}`), [accionId]),
  )
  return (
    <form
      onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', JSON.stringify(fotosParaEnviar(fotos).map((f) => f.ruta_storage))))}
      className="space-y-4"
    >
      <input type="hidden" name="accion_id" value={accionId} />
      <input type="hidden" name="operacion_id" value={id} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo etiqueta="Qué se hizo" htmlFor={`ssoma-hecho-${accionId}`} requerido>
          <AreaTexto
            id={`ssoma-hecho-${accionId}`}
            name="nota"
            required
            minLength={10}
            maxLength={1000}
            rows={3}
            placeholder="Por ejemplo: se puso el tope de fábrica y se ajustaron los pernos del estante."
          />
        </Campo>
        <section aria-label="Fotos de la evidencia" className="space-y-1">
          <p className="text-xs font-medium text-texto-suave">
            Fotos de lo que se hizo
            <span className="ml-0.5 text-peligro">*</span>
          </p>
          <p className="text-xs text-texto-suave">Al enviarlas, la acción queda cerrada. SSOMA ve las fotos y puede reabrirla si no bastan. No fotografíes caras.</p>
          <SelectorFotos
            fotos={fotos}
            alCambiar={setFotos}
            prefijoRuta={`${cuentaId}/${id}`}
            maximo={MAXIMO_FOTOS_EVIDENCIA}
            bucket={BUCKET_FOTOS_SSOMA}
            comprimir
            maximoMb={MAXIMO_MB_FOTO_SSOMA}
            titulo={null}
          />
        </section>
        {!subiendo && fallidas && (
          <p className="text-sm text-peligro">
            {vieja
              ? 'Vuelve a cargar la pantalla para cerrar la acción.'
              : 'Quita o vuelve a subir las fotos que no entraron antes de cerrar.'}
          </p>
        )}
      </fieldset>
      <PieDeVentana
        error={error}
        idError={`ssoma-cierre-error-${accionId}`}
        enviando={enviando}
        alCancelar={alCancelar}
        texto={subiendo ? 'Esperando las fotos…' : 'Cerrar la acción'}
        disabled={subiendo || fallidas || listas === 0}
        nota={listas === 0 && !subiendo ? 'Falta al menos una foto.' : undefined}
      />
    </form>
  )
}

/** SSOMA reabre una acción cuya evidencia no basta: con su motivo y una fecha nueva. */
export function ReabrirAccion({
  id,
  hoy,
  corregido = false,
}: {
  id: string
  hoy: string
  /** El reporte ya está corregido: reabrir lo vuelve a «En corrección». */
  corregido?: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(reabrirAccionSsoma, () => setAbierta(false), { corrige: true })
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        variante="contorno"
        data-reabrir-accion={id}
        onClick={() => {
          limpiar()
          setAbierta(true)
        }}
      >
        <RotateCcw aria-hidden className="size-4" />
        Reabrir
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Reabrir la acción"
        descripcion="Si la evidencia no basta. Vuelve a su responsable con tu motivo y la fecha nueva; el cierre anterior queda en la historia."
        ancho="md"
      >
        {corregido && <AvisoDeCorregido />}
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
            <Campo etiqueta="Por qué se reabre" htmlFor={`reabrir-${id}`} requerido>
              <AreaTexto
                id={`reabrir-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: falta el tope del lado derecho."
              />
            </Campo>
            <Campo etiqueta="Nueva fecha límite" htmlFor={`reabrir-fecha-${id}`} requerido>
              <Entrada
                id={`reabrir-fecha-${id}`}
                name="fecha_limite"
                type="date"
                required
                min={hoy}
                max={sumarDias(hoy, 365)}
                defaultValue={sumarDias(hoy, 3)}
                className="tabular sm:max-w-[12rem]"
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Reabrir" />
        </form>
      </Ventana>
    </>
  )
}

/** SSOMA le pasa la acción a otra cuenta o le cambia la fecha límite. */
export function ReasignarAccion({
  id,
  responsableId,
  fechaLimite,
  cuentas,
  hoy,
}: {
  id: string
  responsableId: string
  fechaLimite: string
  cuentas: CuentaParaAsignar[]
  hoy: string
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [responsable, setResponsable] = useState(responsableId)
  const { alEnviar, enviando, error, limpiar } = useEnvio(reasignarAccionSsoma, () => setAbierta(false), { corrige: true })
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        variante="contorno"
        data-reasignar-accion={id}
        onClick={() => {
          limpiar()
          setResponsable(responsableId)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <UserRoundPen aria-hidden className="size-4" />
        Reasignar
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Reasignar la acción"
        descripcion="Otra persona u otra fecha límite. A quien la recibe le llega el aviso, y quien la tenía se entera."
        ancho="md"
      >
        <form key={vez} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
            <Campo etiqueta="Responsable" htmlFor={`reasignar-${id}`} requerido>
              <SeleccionBuscable
                id={`reasignar-${id}`}
                name="responsable_id"
                requerido
                marcador="Elige la cuenta"
                marcadorBusqueda="Nombre, puesto o área…"
                valor={responsable}
                onChange={setResponsable}
                opciones={opcionesDeCuentas(cuentas)}
              />
            </Campo>
            <Campo etiqueta="Fecha límite" htmlFor={`reasignar-fecha-${id}`} requerido>
              <Entrada
                id={`reasignar-fecha-${id}`}
                name="fecha_limite"
                type="date"
                required
                min={fechaLimite < hoy ? fechaLimite : hoy}
                max={sumarDias(hoy, 365)}
                defaultValue={fechaLimite}
                className="tabular sm:max-w-[12rem]"
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Reasignar" />
        </form>
      </Ventana>
    </>
  )
}

/** SSOMA anula una acción abierta con su motivo. No se borra. */
export function AnularAccion({ id }: { id: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(anularAccionSsoma, () => setAbierta(false), { corrige: true })
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        variante="fantasma"
        data-anular-accion={id}
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
        titulo="Anular la acción"
        descripcion="Para una acción que ya no hace falta o se encargó por error. No se borra: queda con su motivo y le llega el aviso al responsable."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-accion-${id}`} requerido>
              <AreaTexto
                id={`anular-accion-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: la charla ya se dio en la inducción del lunes."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

/** En un reporte ya corregido: lo que se haga lo vuelve a abrir, y quien lo reportó ya recibió «corregido». */
function AvisoDeCorregido() {
  return (
    <p className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-texto" data-aviso-corregido>
      Este reporte ya está corregido y a quien lo reportó ya le llegó el aviso. Al guardar, vuelve a «En corrección» hasta que esta acción
      se cierre.
    </p>
  )
}
