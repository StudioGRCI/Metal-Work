'use client'

import { Ban, Check, Link2, Stethoscope, Wrench, X } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import type { RqParaEnlazar } from '@/lib/datos/averias'
import { ESTADO_REQUERIMIENTO_DEL_CODIGO } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { anularAveria, atenderAveria, cerrarAveria, confirmarAveria, enlazarRequerimiento, quitarRequerimiento } from '../acciones'

/** Lo que dijo la última acción de la ficha: va en el renglón de estado del encabezado, fuera de la ventana. */
const CLAVE_AVISO = 'averias:ficha:aviso'

export function AvisoDeLaFicha() {
  const [aviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  // Montada siempre: el verde que nace con su texto no lo oye el lector.
  return (
    <p role="status" className={aviso ? 'text-sm text-exito' : 'sr-only'}>
      {aviso}
    </p>
  )
}

/** Una ventana con su formulario: el botón que la abre, el envío y el verde que queda arriba al terminar. */
function useVentanaDeLaFicha<T = never>(
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion<T>>,
  alEntrar?: () => void,
) {
  const [abierta, setAbierta] = useState(false)
  const [, setAviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  const envio = useEnvio<T>(accion, (r) => {
    setAbierta(false)
    setAviso(r.mensaje ?? 'Listo.')
    alEntrar?.()
  })
  return {
    ...envio,
    abierta,
    abrir: () => {
      envio.limpiar()
      setAviso(null)
      setAbierta(true)
    },
    cerrar: () => setAbierta(false),
  }
}

/**
 * Mantenimiento la toma con su diagnóstico (qué tiene el equipo). Mientras la
 * atiende, el mismo botón corrige el diagnóstico.
 */
export function AtenderAveria({ id, numero, diagnostico }: { id: string; numero: string; diagnostico: string | null }) {
  const primera = diagnostico == null
  const v = useVentanaDeLaFicha(atenderAveria)
  return (
    <>
      <Boton type="button" variante={primera ? 'primario' : 'secundario'} data-atender-averia onClick={v.abrir}>
        <Stethoscope aria-hidden className="size-4" />
        {primera ? 'Atender' : 'Corregir diagnóstico'}
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={primera ? `Atender el reporte ${numero}` : `Corregir el diagnóstico de ${numero}`}
        descripcion={
          primera
            ? 'Revisa el equipo y anota qué tiene. La avería pasa a «En atención» y quien la reportó lo ve en su recorrido.'
            : 'Lo que encontraste al seguir revisando. Queda el diagnóstico nuevo; el primero sigue en el recorrido.'
        }
        ancho="md"
      >
        <form onSubmit={v.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="primera" value={primera ? 'SI' : 'NO'} />
          <fieldset disabled={v.enviando} className="min-w-0">
            <Campo etiqueta="Diagnóstico" htmlFor={`diagnostico-${id}`} requerido>
              <AreaTexto
                id={`diagnostico-${id}`}
                name="diagnostico"
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                defaultValue={diagnostico ?? ''}
                placeholder="Por ejemplo: interruptor de encendido quemado y carbones gastados."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={v.error} enviando={v.enviando} alCancelar={v.cerrar} texto={primera ? 'Atender' : 'Guardar'} />
        </form>
      </Ventana>
    </>
  )
}

/**
 * Mantenimiento enlaza el RQ con que se pidieron los repuestos: el RQ se hace
 * como siempre, aquí solo se dice cuál es. El id del enlace vive aquí y no en la
 * ventana: si no llegó la respuesta, el reintento no lo enlaza dos veces.
 */
export function EnlazarRequerimiento({ averia, opciones }: { averia: string; opciones: RqParaEnlazar[] }) {
  const [enlace, setEnlace] = useState(() => crypto.randomUUID())
  const [requerimiento, setRequerimiento] = useState('')
  const v = useVentanaDeLaFicha(enlazarRequerimiento, () => {
    setEnlace(crypto.randomUUID())
    setRequerimiento('')
  })
  return (
    <>
      <Boton type="button" variante="secundario" tamano="sm" data-enlazar-rq onClick={v.abrir}>
        <Link2 aria-hidden className="size-4" />
        Enlazar RQ
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo="Enlazar el RQ de los repuestos"
        descripcion="El repuesto se pide con un RQ, como siempre. Aquí eliges cuál es, para que quien reportó y su área vean cómo va."
        ancho="md"
      >
        <form onSubmit={v.alEnviar} className="space-y-4">
          <input type="hidden" name="enlace" value={enlace} />
          <input type="hidden" name="averia" value={averia} />
          <fieldset disabled={v.enviando} className="min-w-0 space-y-4">
            <Campo
              etiqueta="RQ"
              htmlFor={`rq-${averia}`}
              requerido
              ayuda={
                opciones.length === 0
                  ? 'No hay RQ vivos de los últimos seis meses. Pide el repuesto a Requerimientos o a Administración y vuelve cuando tenga su número.'
                  : 'Los RQ vivos de los últimos seis meses. Busca por número, área, código o lo que pide.'
              }
            >
              <SeleccionBuscable
                id={`rq-${averia}`}
                name="requerimiento"
                requerido
                marcador="Elige el RQ"
                marcadorBusqueda="Número, área, código o lo que pide…"
                valor={requerimiento}
                onChange={setRequerimiento}
                deshabilitado={opciones.length === 0}
                opciones={opciones.map((r) => ({
                  valor: r.id,
                  etiqueta: `${r.numero} · ${ESTADO_REQUERIMIENTO_DEL_CODIGO[r.estado]?.etiqueta ?? r.estado}`,
                  detalle: [r.area, r.codigo_interno, r.justificacion].filter(Boolean).join(' · '),
                }))}
              />
            </Campo>
            <Campo etiqueta="Qué repuesto" htmlFor={`rq-nota-${averia}`} requerido>
              <Entrada
                id={`rq-nota-${averia}`}
                name="nota"
                required
                minLength={3}
                maxLength={300}
                placeholder="Por ejemplo: interruptor y juego de carbones."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={v.error} enviando={v.enviando} alCancelar={v.cerrar} texto="Enlazar" disabled={opciones.length === 0} />
        </form>
      </Ventana>
    </>
  )
}

/** Quitar un RQ enlazado por error. No se borra: queda quién y cuándo. */
export function QuitarRequerimiento({ enlace, numero }: { enlace: string; numero: string }) {
  const v = useVentanaDeLaFicha(quitarRequerimiento)
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" aria-label={`Quitar el ${numero} de este reporte`} data-quitar-rq={numero} onClick={v.abrir}>
        <X aria-hidden className="size-4" />
        Quitar
      </Boton>
      <Ventana abierta={v.abierta} alCerrar={v.cerrar} titulo={`Quitar el ${numero}`} ancho="sm">
        <form onSubmit={v.alEnviar} className="space-y-4">
          <input type="hidden" name="enlace" value={enlace} />
          <p className="text-sm text-texto-suave">
            Deja de mostrarse en este reporte. El RQ sigue como está, y queda anotado quién lo quitó y cuándo.
          </p>
          <PieDeVentana error={v.error} enviando={v.enviando} alCancelar={v.cerrar} texto="Quitar" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

/**
 * Mantenimiento la cierra con el trabajo hecho y las horas que el equipo estuvo
 * parado. Las horas se proponen desde que quedó parado por este reporte.
 */
export function CerrarAveria({
  id,
  numero,
  horasSugeridas,
  dejaOperativo,
}: {
  id: string
  numero: string
  horasSugeridas: number | null
  /** Si el equipo sigue parado por este reporte: al cerrar vuelve a operativo. */
  dejaOperativo: boolean
}) {
  const v = useVentanaDeLaFicha(cerrarAveria)
  return (
    <>
      <Boton type="button" data-cerrar-averia onClick={v.abrir}>
        <Wrench aria-hidden className="size-4" />
        Cerrar
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Cerrar el reporte ${numero}`}
        descripcion={
          dejaOperativo
            ? 'El equipo vuelve a operativo en el padrón y le avisamos a quien la reportó para que confirme si quedó bien.'
            : 'Le avisamos a quien la reportó para que confirme si quedó bien.'
        }
        ancho="md"
      >
        <form onSubmit={v.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={v.enviando} className="min-w-0 space-y-4">
            <Campo etiqueta="Trabajo hecho" htmlFor={`trabajo-${id}`} requerido>
              <AreaTexto
                id={`trabajo-${id}`}
                name="trabajo"
                required
                minLength={10}
                maxLength={2000}
                rows={4}
                placeholder="Por ejemplo: se cambió el interruptor y los carbones, y se probó una hora."
              />
            </Campo>
            <Campo
              etiqueta="Horas parado"
              htmlFor={`horas-${id}`}
              requerido
              ayuda={
                horasSugeridas != null
                  ? 'Las que lleva parado en el padrón por este reporte. Corrígelas si no es así.'
                  : 'Cuántas horas no se pudo usar el equipo por esta avería. 0 si no se paró.'
              }
            >
              <Entrada
                id={`horas-${id}`}
                name="horas"
                required
                inputMode="decimal"
                pattern="[0-9]+([.,][0-9])?"
                title="Un número de horas, con un decimal como mucho: 3 o 2,5."
                defaultValue={horasSugeridas != null ? String(horasSugeridas).replace('.', ',') : ''}
                className="tabular max-w-32"
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={v.error} enviando={v.enviando} alCancelar={v.cerrar} texto="Cerrar la avería" />
        </form>
      </Ventana>
    </>
  )
}

const OPCION =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'size-4 shrink-0 accent-[var(--acento)]'

/** Quien la reportó dice si quedó bien. Si no, cuenta qué sigue fallando y vuelve a Mantenimiento. */
export function ConfirmarAveria({ id, numero, detieneElTrabajo }: { id: string; numero: string; detieneElTrabajo: boolean }) {
  const [quedo, setQuedo] = useState('')
  const v = useVentanaDeLaFicha(confirmarAveria)
  return (
    <>
      <Boton
        type="button"
        data-confirmar-averia
        onClick={() => {
          setQuedo('')
          v.abrir()
        }}
      >
        <Check aria-hidden className="size-4" />
        ¿Quedó bien?
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`¿Quedó bien? · ${numero}`}
        descripcion="Mantenimiento la dio por arreglada. Pruébalo y dinos cómo quedó."
        ancho="md"
      >
        <form onSubmit={v.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={v.enviando} className="min-w-0 space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-texto-suave">
                ¿El equipo quedó bien?
                <span className="ml-0.5 text-peligro">*</span>
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={OPCION}>
                  <input type="radio" name="quedo" value="SI" required className={RADIO} checked={quedo === 'SI'} onChange={() => setQuedo('SI')} />
                  Sí, quedó bien
                </label>
                <label className={OPCION}>
                  <input type="radio" name="quedo" value="NO" required className={RADIO} checked={quedo === 'NO'} onChange={() => setQuedo('NO')} />
                  No, sigue fallando
                </label>
              </div>
            </fieldset>
            {quedo === 'NO' && (
              <p className="text-xs text-texto-suave">
                Vuelve a Mantenimiento con lo que cuentes{detieneElTrabajo ? ', y el equipo queda parado otra vez en el padrón' : ''}.
              </p>
            )}
            <Campo etiqueta={quedo === 'NO' ? 'Qué sigue fallando' : 'Nota (si quieres)'} htmlFor={`nota-${id}`} requerido={quedo === 'NO'}>
              <AreaTexto
                id={`nota-${id}`}
                name="nota"
                required={quedo === 'NO'}
                minLength={quedo === 'NO' ? 10 : undefined}
                maxLength={500}
                rows={3}
                placeholder={quedo === 'NO' ? 'Por ejemplo: se volvió a apagar a la media hora.' : undefined}
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={v.error} enviando={v.enviando} alCancelar={v.cerrar} texto={quedo === 'NO' ? 'Devolver a Mantenimiento' : 'Enviar'} />
        </form>
      </Ventana>
    </>
  )
}

/**
 * Mantenimiento anula un reporte mal hecho, con su motivo. No se borra: queda
 * con quién, cuándo y por qué; si el equipo sigue parado por él, vuelve a como estaba.
 */
export function AnularAveria({ id, numero, paroElEquipo }: { id: string; numero: string; paroElEquipo: boolean }) {
  const v = useVentanaDeLaFicha(anularAveria)
  return (
    <>
      <Boton type="button" variante="contornoPeligro" data-anular-averia onClick={v.abrir}>
        <Ban aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={v.abierta}
        alCerrar={v.cerrar}
        titulo={`Anular el reporte ${numero}`}
        descripcion={
          paroElEquipo
            ? 'Para un reporte repetido o hecho por error. No se borra: queda con su motivo, le llega el aviso a quien lo reportó y, si el equipo sigue parado por este reporte, vuelve a como estaba.'
            : 'Para un reporte repetido o hecho por error. No se borra: queda con su motivo y le llega el aviso a quien lo reportó.'
        }
        ancho="md"
      >
        <form onSubmit={v.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={v.enviando} className="min-w-0">
            <Campo etiqueta="Motivo" htmlFor={`anular-averia-${id}`} requerido>
              <AreaTexto
                id={`anular-averia-${id}`}
                name="motivo"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: es la misma falla del reporte AV-0012-2026."
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={v.error} enviando={v.enviando} alCancelar={v.cerrar} texto="Anular" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}
