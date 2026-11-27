'use client'

import { Ban, ClipboardCheck, Link2, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import type { OtParaEnlazar } from '@/lib/datos/garantias'
import { CAUSA_GARANTIA, CAUSAS_GARANTIA } from '@/lib/dominio/garantias'
import { definir, ESTADO_OT } from '@/lib/dominio/estados'
import { useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { anotarCausa, anularReclamo, enlazarOt, noProcede } from '../acciones'

/** Lo que dijo la última acción del reclamo: va en el renglón de estado del encabezado, fuera de la ventana. */
const CLAVE_AVISO = 'garantias:reclamo:aviso'

export function AvisoDelReclamo() {
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
 * al salir bien: lo que comparten las cuatro acciones del reclamo.
 */
function AccionDelReclamo({
  id,
  accion,
  boton,
  variante = 'secundario',
  titulo,
  descripcion,
  enviar,
  envioPeligroso = false,
  marca,
  children,
}: {
  id: string
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion>
  boton: ReactNode
  variante?: 'primario' | 'secundario' | 'fantasma'
  titulo: string
  descripcion: string
  enviar: string
  envioPeligroso?: boolean
  marca: string
  children: ReactNode
}) {
  const [abierta, setAbierta] = useState(false)
  const [, setAviso] = useEstadoCompartido<string | null>(CLAVE_AVISO, null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(accion, (r) => {
    setAbierta(false)
    setAviso(r.mensaje ?? 'Listo.')
  })
  return (
    <>
      <Boton
        type="button"
        variante={variante}
        data-accion={marca}
        onClick={() => {
          limpiar()
          setAviso(null)
          setAbierta(true)
        }}
      >
        {boton}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={titulo} descripcion={descripcion} ancho="md">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
            {children}
          </fieldset>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto={enviar} variante={envioPeligroso ? 'peligro' : 'primario'} />
        </form>
      </Ventana>
    </>
  )
}

/** Administración enlaza una OT de garantía de la unidad que ya existe. */
export function EnlazarOt({ id, numero, ots }: { id: string; numero: string; ots: OtParaEnlazar[] }) {
  return (
    <AccionDelReclamo
      id={id}
      accion={enlazarOt}
      marca="enlazar-ot"
      boton={
        <>
          <Link2 aria-hidden className="size-4" />
          Enlazar una OT
        </>
      }
      titulo={`Enlazar la OT de garantía del reclamo ${numero}`}
      descripcion="Las OT de garantía de esta unidad que no atienden otro reclamo. Al enlazarla, le avisamos a quien registró el reclamo."
      enviar="Enlazar"
    >
      <Campo etiqueta="OT de garantía" htmlFor={`enlazar-ot-${id}`} requerido>
        <Seleccion id={`enlazar-ot-${id}`} name="orden_id" required defaultValue={ots.length === 1 ? ots[0].id : ''}>
          {ots.length > 1 && <option value="">Elige la OT</option>}
          {ots.map((o) => (
            <option key={o.id} value={o.id}>
              {o.numero} · {definir(ESTADO_OT, o.estado).etiqueta}
            </option>
          ))}
        </Seleccion>
      </Campo>
    </AccionDelReclamo>
  )
}

/** Administración cierra sin OT el reclamo que no procede, con su motivo. */
export function NoProcede({ id, numero }: { id: string; numero: string }) {
  return (
    <AccionDelReclamo
      id={id}
      accion={noProcede}
      marca="no-procede"
      boton={
        <>
          <XCircle aria-hidden className="size-4" />
          No procede
        </>
      }
      titulo={`El reclamo ${numero} no procede`}
      descripcion="Cuando no es una garantía: el daño es de otro taller, venció el plazo o lo que se reclama no lo hizo Metal Work. Se cierra sin OT, o con la suya anulada, con tu motivo."
      enviar="Cerrar como «No procede»"
    >
      <Campo etiqueta="Por qué no procede" htmlFor={`no-procede-${id}`} requerido>
        <AreaTexto
          id={`no-procede-${id}`}
          name="motivo"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          placeholder="Por ejemplo: la tolva se cargó con el doble de lo que soporta; no es un defecto del trabajo."
        />
      </Campo>
    </AccionDelReclamo>
  )
}

/** Calidad anota por qué falló, con la garantía terminada, y el reclamo se cierra. */
export function AnotarCausa({ id, numero }: { id: string; numero: string }) {
  const [causa, setCausa] = useState('')
  return (
    <AccionDelReclamo
      id={id}
      accion={anotarCausa}
      variante="primario"
      marca="anotar-causa"
      boton={
        <>
          <ClipboardCheck aria-hidden className="size-4" />
          Anotar la causa
        </>
      }
      titulo={`La causa del reclamo ${numero}`}
      descripcion="La garantía ya está terminada: anota por qué falló. El reclamo se cierra con tu causa y queda como evidencia; no se cambia después."
      enviar="Anotar y cerrar"
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-medium text-texto-suave">
          Causa<span className="ml-0.5 text-peligro">*</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CAUSAS_GARANTIA.map((valor) => (
            <label key={valor} className={OPCION}>
              <input type="radio" name="causa" value={valor} required checked={causa === valor} onChange={() => setCausa(valor)} className={RADIO} />
              <span>
                <span className="font-medium">{CAUSA_GARANTIA[valor].etiqueta}</span>
                <span className="block text-xs text-texto-suave">{CAUSA_GARANTIA[valor].descripcion}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Campo etiqueta="Qué pasó" htmlFor={`causa-detalle-${id}`} requerido ayuda="Lo que encontraste al revisarla: qué falló y por qué." ayudaEnIcono={false}>
        <AreaTexto
          id={`causa-detalle-${id}`}
          name="detalle"
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          placeholder="Por ejemplo: la bisagra se soldó con un solo cordón y se abrió con la vibración."
        />
      </Campo>
    </AccionDelReclamo>
  )
}

/** Ventas o Administración anulan el reclamo sin OT, o con su OT anulada, con su motivo. */
export function AnularReclamo({ id, numero }: { id: string; numero: string }) {
  return (
    <AccionDelReclamo
      id={id}
      accion={anularReclamo}
      variante="fantasma"
      envioPeligroso
      marca="anular-reclamo"
      boton={
        <>
          <Ban aria-hidden className="size-4" />
          Anular
        </>
      }
      titulo={`Anular el reclamo ${numero}`}
      descripcion="Para un reclamo repetido o registrado por error. No se borra: queda con su motivo, quién y cuándo."
      enviar="Anular"
    >
      <Campo etiqueta="Motivo" htmlFor={`anular-reclamo-${id}`} requerido>
        <AreaTexto
          id={`anular-reclamo-${id}`}
          name="motivo"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          placeholder="Por ejemplo: es el mismo reclamo que RG-0003-2026."
        />
      </Campo>
    </AccionDelReclamo>
  )
}
