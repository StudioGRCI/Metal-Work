'use client'

import { Ban, Check, PencilLine, X } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'

import { Boton, type Variante } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import type { Tramite } from '@/lib/datos/tramites'
import { ESTADOS_QUE_SE_LLEVAN, SITUACION_TRAMITE } from '@/lib/dominio/tramites'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { fecha } from '@/lib/format'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { actualizarTramite, pedirAnulacion, resolverAnulacion } from '../acciones'

/** Lo que dijo la última acción del trámite: va en el renglón de estado del encabezado, fuera de la ventana. */
const CLAVE_AVISO = 'tramites:ficha:aviso'

export function AvisoDelTramite() {
  const [aviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  // Montada siempre: el verde que nace con su texto no lo oye el lector.
  return (
    <p role="status" className={aviso ? 'text-sm text-exito' : 'sr-only'}>
      {aviso}
    </p>
  )
}

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

/**
 * Un botón que abre su ventana y envía su formulario, y el verde fuera de ella
 * al salir bien. Corrige lo que la ficha muestra: la ventana se cierra con la
 * ficha ya al día (`corrige`).
 */
function AccionDelTramite({
  id,
  accion,
  boton,
  variante = 'secundario',
  titulo,
  descripcion,
  enviar,
  envioPeligroso = false,
  marca,
  ancho = 'md',
  children,
}: {
  id: string
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion>
  boton: ReactNode
  variante?: Variante
  titulo: string
  descripcion: string
  enviar: string
  envioPeligroso?: boolean
  marca: string
  ancho?: 'md' | 'lg'
  children: (estado: { error: string | null; enviando: boolean }) => ReactNode
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [, setAviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    accion,
    (r) => {
      setAbierta(false)
      setAviso(r.mensaje ?? 'Listo.')
    },
    { corrige: true, documento: `${marca}:${id}` },
  )
  useCursorAlRechazo(
    enviando,
    error,
    useCallback(() => document.getElementById(`error-${marca}-${id}`), [marca, id]),
  )
  return (
    <>
      <Boton
        type="button"
        variante={variante}
        data-accion={marca}
        onClick={() => {
          limpiar()
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {boton}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={titulo} descripcion={descripcion} ancho={ancho}>
        {/* Cada apertura, el formulario con lo que la ficha dice ahora. */}
        <form key={vez} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
            {children({ error, enviando })}
          </fieldset>
          <PieDeVentana
            error={error}
            idError={`error-${marca}-${id}`}
            enviando={enviando}
            alCancelar={() => setAbierta(false)}
            texto={enviar}
            variante={envioPeligroso ? 'peligro' : 'primario'}
          />
        </form>
      </Ventana>
    </>
  )
}

/** Quien lleva el trámite anota en qué va, con su expediente, sus fechas y su nota. */
export function ActualizarTramite({ tramite: t, hoy }: { tramite: Tramite; hoy: string }) {
  return (
    <AccionDelTramite
      id={t.id}
      accion={actualizarTramite}
      variante="primario"
      marca="actualizar"
      ancho="lg"
      boton={
        <>
          <PencilLine aria-hidden className="size-4" />
          Actualizar
        </>
      }
      titulo={`Actualizar el trámite ${t.numero}`}
      descripcion="En qué va, su expediente y sus fechas. El tipo, la unidad y la OT no se cambian: si están mal, se pide su anulación y se registra de nuevo."
      enviar="Guardar"
    >
      {() => <CamposDelTramite tramite={t} hoy={hoy} />}
    </AccionDelTramite>
  )
}

function CamposDelTramite({ tramite: t, hoy }: { tramite: Tramite; hoy: string }) {
  const [estado, setEstado] = useState<string>((ESTADOS_QUE_SE_LLEVAN as readonly string[]).includes(t.estado) ? t.estado : 'EN_TRAMITE')
  const observado = estado === 'OBSERVADO'
  // Lo que la entidad observó sigue en la nota al volver a «En trámite»: se dice, para que no se lea como de hoy.
  const quedaLoObservado = t.estado === 'OBSERVADO' && !observado && Boolean(t.nota)
  return (
    <>
      {/* La hora con que esta ficha muestra el trámite: si cambió después (otra pestaña, el teléfono), la base no lo pisa. */}
      <input type="hidden" name="visto" value={t.actualizado_en ?? ''} />
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-medium text-texto-suave">
          En qué va<span className="ml-0.5 text-peligro">*</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {ESTADOS_QUE_SE_LLEVAN.map((valor) => (
            <label key={valor} className={OPCION}>
              <input type="radio" name="estado" value={valor} required checked={estado === valor} onChange={() => setEstado(valor)} className={RADIO} />
              <span>
                <span className="font-medium">{SITUACION_TRAMITE[valor].etiqueta}</span>
                <span className="block text-xs text-texto-suave">{SITUACION_TRAMITE[valor].descripcion}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Campo etiqueta="Qué se tramita" htmlFor={`actualizar-asunto-${t.id}`} requerido>
        <AreaTexto id={`actualizar-asunto-${t.id}`} name="asunto" required minLength={5} maxLength={300} rows={2} defaultValue={t.asunto} />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Entidad" htmlFor={`actualizar-entidad-${t.id}`} requerido>
          <Entrada id={`actualizar-entidad-${t.id}`} name="entidad" required minLength={2} maxLength={80} autoComplete="off" defaultValue={t.entidad} />
        </Campo>
        <Campo etiqueta="N.º de expediente" htmlFor={`actualizar-expediente-${t.id}`} ayuda="El que te dio la entidad." ayudaEnIcono={false}>
          <Entrada
            id={`actualizar-expediente-${t.id}`}
            name="expediente"
            maxLength={60}
            autoComplete="off"
            defaultValue={t.expediente ?? ''}
            className="tabular"
          />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {estado !== 'POR_INICIAR' && (
          <Campo etiqueta="Se presentó el" htmlFor={`actualizar-inicio-${t.id}`} requerido>
            <Entrada
              id={`actualizar-inicio-${t.id}`}
              name="fecha_inicio"
              type="date"
              required
              max={hoy}
              defaultValue={t.fecha_inicio ?? hoy}
              className="tabular"
            />
          </Campo>
        )}
        <Campo etiqueta="Fecha límite" htmlFor={`actualizar-limite-${t.id}`} ayuda="Hasta cuándo debe quedar." ayudaEnIcono={false}>
          <Entrada id={`actualizar-limite-${t.id}`} name="fecha_limite" type="date" defaultValue={t.fecha_limite ?? ''} className="tabular" />
        </Campo>
      </div>
      {estado === 'POR_INICIAR' && t.fecha_inicio && (
        <p className="text-sm text-aviso" data-se-quita-la-presentacion>
          Al volver a «Por iniciar» se quita la fecha en que se presentó ({fecha(t.fecha_inicio)}).
        </p>
      )}

      <Campo
        etiqueta={observado ? 'Qué observó la entidad' : 'Nota'}
        htmlFor={`actualizar-nota-${t.id}`}
        requerido={observado}
        ayuda={
          observado
            ? 'Lo que pide subsanar y hasta cuándo.'
            : quedaLoObservado
              ? 'Aquí sigue lo que observó la entidad: si ya se subsanó, bórralo o cuenta cómo quedó.'
              : 'Opcional: lo que haga falta recordar.'
        }
        ayudaEnIcono={false}
      >
        <AreaTexto
          id={`actualizar-nota-${t.id}`}
          name="nota"
          required={observado}
          minLength={observado ? 5 : undefined}
          maxLength={1000}
          rows={3}
          defaultValue={t.nota ?? ''}
        />
      </Campo>
    </>
  )
}

/** Quien lleva el trámite pide anularlo, con su motivo; lo aprueba Gerencia. */
export function PedirAnulacion({ id, numero }: { id: string; numero: string }) {
  return (
    <AccionDelTramite
      id={id}
      accion={pedirAnulacion}
      variante="contornoPeligro"
      envioPeligroso
      marca="pedir-anulacion"
      boton={
        <>
          <Ban aria-hidden className="size-4" />
          Pedir anulación
        </>
      }
      titulo={`Pedir la anulación del trámite ${numero}`}
      descripcion="Para un trámite repetido, registrado por error o que ya no se hará. No se borra: Gerencia aprueba la anulación y queda con su motivo. Mientras espera ese visto, el trámite no se cambia."
      enviar="Pedir la anulación"
    >
      {() => (
        <Campo etiqueta="Por qué se anula" htmlFor={`pedir-anulacion-${id}`} requerido>
          <AreaTexto
            id={`pedir-anulacion-${id}`}
            name="motivo"
            required
            minLength={10}
            maxLength={500}
            rows={3}
            placeholder="Por ejemplo: es el mismo trámite que TR-0003-2026."
          />
        </Campo>
      )}
    </AccionDelTramite>
  )
}

/** Gerencia aprueba la anulación que pidió quien lleva el trámite. */
export function AprobarAnulacion({
  id,
  numero,
  motivo,
  pidio,
  pedido,
}: {
  id: string
  numero: string
  motivo: string | null
  pidio: string | null
  /** La hora del pedido que se muestra: la respuesta vale solo para ese. */
  pedido: string
}) {
  return (
    <AccionDelTramite
      id={id}
      accion={resolverAnulacion}
      variante="peligro"
      envioPeligroso
      marca="aprobar-anulacion"
      boton={
        <>
          <Check aria-hidden className="size-4" />
          Aprobar la anulación
        </>
      }
      titulo={`Anular el trámite ${numero}`}
      descripcion="Queda anulado, con su motivo, quién lo pidió y tu visto. No se puede deshacer: un trámite anulado queda congelado como evidencia."
      enviar="Anular el trámite"
    >
      {() => (
        <>
          <input type="hidden" name="respuesta" value="aprobar" />
          <input type="hidden" name="pedido" value={pedido} />
          <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm">
            <p className="text-xs text-texto-suave">Motivo{pidio ? ` que dio ${pidio}` : ''}</p>
            <p className="mt-1 whitespace-pre-wrap text-texto">{motivo}</p>
          </div>
        </>
      )}
    </AccionDelTramite>
  )
}

/** Gerencia no aprueba la anulación: dice por qué y el trámite sigue como estaba. */
export function NoAprobarAnulacion({ id, numero, pedido }: { id: string; numero: string; pedido: string }) {
  return (
    <AccionDelTramite
      id={id}
      accion={resolverAnulacion}
      marca="no-aprobar-anulacion"
      boton={
        <>
          <X aria-hidden className="size-4" />
          No aprobar
        </>
      }
      titulo={`No anular el trámite ${numero}`}
      descripcion="El trámite sigue como estaba y quien lo lleva puede continuarlo. Le llega tu motivo."
      enviar="No aprobar la anulación"
    >
      {() => (
        <>
          <input type="hidden" name="respuesta" value="rechazar" />
          <input type="hidden" name="pedido" value={pedido} />
          <Campo etiqueta="Por qué no se anula" htmlFor={`no-aprobar-${id}`} requerido>
            <AreaTexto
              id={`no-aprobar-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="Por ejemplo: el trámite sigue vigente; falta presentar el documento que observó la entidad."
            />
          </Campo>
        </>
      )}
    </AccionDelTramite>
  )
}
