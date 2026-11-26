'use client'

import { CalendarClock, MessageSquareText } from 'lucide-react'
import { useState } from 'react'

import { useAvisar } from '@/app/(app)/requerimientos/atencion/avisos'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { MOTIVO_DE_ATRASO, MOTIVOS_DE_ATRASO } from '@/lib/dominio/plazos'
import { useCursorAlRechazo, useEnvio, useIdDelEnvio } from '@/lib/envio'
import { fecha as formatoFecha, hoyLima, sumarDias } from '@/lib/format'

import { anotarMotivoAtraso, corregirFechaPrometida } from './acciones-seguimiento'

type Documento = {
  tipo: 'OC' | 'OS'
  id: string
  /** «OC-0001-MW», «OS-0001-MW». */
  nombre: string
}

/**
 * «Motivo del atraso» y «Corregir fecha» de una OC u OS (Plan 4.2). Lo anota
 * quien emite la compra; la base vuelve a exigir `compras.crear` y que la
 * compra esté atrasada (el motivo) o todavía sin llegar completa (la fecha).
 * Nada de esto cambia el documento ni su PDF: queda en su recorrido.
 *
 * El id de cada envío vive aquí, fuera del formulario que se rehace al abrir
 * (`useIdDelEnvio`): tras «No llegó la respuesta», cancelar y volver a abrir
 * lleva el mismo, y la base dice si ya quedó.
 */
export function SeguimientoDeLaCompra({
  documento,
  motivo,
  fecha,
}: {
  documento: Documento
  /** Si se puede anotar el motivo: la compra está atrasada o llegó tarde. */
  motivo: boolean
  /** La fecha prometida que vale hoy, si se puede corregir (vigente y sin llegar completa); `undefined` si no. */
  fecha?: string | null
}) {
  // Lo que dijo la base va arriba de la lista, con el cursor (`ConAvisos`): con
  // «Atrasadas», corregir la fecha saca la fila, y con ella el botón y su aviso.
  const avisar = useAvisar()
  const alTerminar = (texto: string) => avisar(`${documento.nombre}: ${texto}`)
  if (!motivo && fecha === undefined) return null
  // Sin envoltorio propio: los botones se suman al renglón de `AccionesDeFila`.
  return (
    <>
      {motivo && <AnotarMotivo documento={documento} alTerminar={alTerminar} />}
      {fecha !== undefined && <CorregirFecha documento={documento} actual={fecha} alTerminar={alTerminar} />}
    </>
  )
}

function AnotarMotivo({ documento, alTerminar }: { documento: Documento; alTerminar: (texto: string) => void }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  // Cada fila guarda su envío: sin `donde`, el pendiente de una OC lo tomaba la ventana de otra.
  const envio = useIdDelEnvio('motivo_atraso', undefined, `${documento.tipo}:${documento.id}`)
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label={`Motivo del atraso de la ${documento.nombre}`}
        onClick={() => {
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <MessageSquareText aria-hidden className="size-4" />
        Motivo del atraso
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Por qué se atrasó la ${documento.nombre}`}
        descripcion="Queda en su recorrido con tu puesto y la hora. La orden no cambia."
      >
        <EnvioAnterior texto={envio.anterior} />
        {envio.id && (
          <Formulario
            key={vez}
            envio={envio}
            documento={documento}
            accion={anotarMotivoAtraso}
            texto="Anotar"
            alCancelar={() => setAbierta(false)}
            alTerminar={(texto) => {
              setAbierta(false)
              alTerminar(texto)
            }}
          />
        )}
      </Ventana>
    </>
  )
}

function CorregirFecha({
  documento,
  actual,
  alTerminar,
}: {
  documento: Documento
  actual: string | null
  alTerminar: (texto: string) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const envio = useIdDelEnvio('fecha_prometida', undefined, `${documento.tipo}:${documento.id}`)
  const servicio = documento.tipo === 'OS'
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label={`Corregir fecha prometida de la ${documento.nombre}`}
        onClick={() => {
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <CalendarClock aria-hidden className="size-4" />
        Corregir fecha
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={servicio ? `Cuándo vuelve la ${documento.nombre}` : `Cuándo llega la ${documento.nombre}`}
        descripcion={
          actual
            ? `La fecha prometida es el ${formatoFecha(actual)}. Esa queda en el recorrido; el documento y su PDF no cambian.`
            : 'Todavía no tiene fecha prometida. La que pongas queda en el recorrido; el documento y su PDF no cambian.'
        }
      >
        <EnvioAnterior texto={envio.anterior} />
        {envio.id && (
          <Formulario
            key={vez}
            envio={envio}
            documento={documento}
            accion={corregirFechaPrometida}
            texto="Corregir"
            conFecha={{ servicio }}
            alCancelar={() => setAbierta(false)}
            alTerminar={(texto) => {
              setAbierta(false)
              alTerminar(texto)
            }}
          />
        )}
      </Ventana>
    </>
  )
}

function Formulario({
  envio,
  documento,
  accion,
  texto,
  conFecha,
  alCancelar,
  alTerminar,
}: {
  envio: ReturnType<typeof useIdDelEnvio>
  documento: Documento
  accion: typeof anotarMotivoAtraso
  texto: string
  conFecha?: { servicio: boolean }
  alCancelar: () => void
  alTerminar: (texto: string) => void
}) {
  const id = envio.id ?? ''
  const [motivo, setMotivo] = useState('')
  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      envio.salio()
      return accion(previo, datos)
    },
    (r) => {
      envio.otro()
      alTerminar(r.mensaje ?? 'Anotado.')
    },
    // Cambia lo que la fila muestra (el motivo, la fecha): el aviso sale con la fila ya al día.
    { alYaEntrar: envio.otro, corrige: true },
  )
  // El rechazo de la fecha va junto a su campo, con el cursor ahí; los demás, al pie.
  const deLaFecha = conFecha && error && /^(La fecha nueva|Elige la fecha nueva|La .+ ya tiene esa fecha)/.test(error) ? error : null
  useCursorAlRechazo(enviando, deLaFecha, () => document.getElementById(`seg-fecha-${id}`))
  return (
    <form onSubmit={alEnviar} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tipo" value={documento.tipo} />
      <input type="hidden" name="documento" value={documento.id} />
      {conFecha && (
        <Campo etiqueta={conFecha.servicio ? 'Fecha nueva en que vuelve' : 'Fecha nueva que prometió el proveedor'} htmlFor={`seg-fecha-${id}`} requerido error={deLaFecha ?? undefined}>
          <Entrada id={`seg-fecha-${id}`} name="fecha" type="date" required max={sumarDias(hoyLima(), 365)} className="tabular" />
        </Campo>
      )}
      <Campo etiqueta={conFecha ? 'Por qué cambia' : 'Por qué se atrasó'} htmlFor={`seg-motivo-${id}`} requerido>
        <Seleccion id={`seg-motivo-${id}`} name="motivo" required value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          <option value="" disabled>
            Elige el motivo
          </option>
          {MOTIVOS_DE_ATRASO.map((m) => (
            <option key={m} value={m}>
              {MOTIVO_DE_ATRASO[m]}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo
        etiqueta="Nota"
        htmlFor={`seg-nota-${id}`}
        requerido={motivo === 'OTRO'}
        ayuda={motivo === 'OTRO' ? 'Con «Otro», cuenta qué pasó en al menos 10 caracteres.' : 'Opcional: lo que dijo el proveedor, a quién se llamó.'}
      >
        <AreaTexto
          id={`seg-nota-${id}`}
          name="nota"
          rows={3}
          maxLength={500}
          required={motivo === 'OTRO'}
          minLength={motivo === 'OTRO' ? 10 : undefined}
          placeholder="Por ejemplo: el proveedor no tenía stock; avisó que llega el lunes."
        />
      </Campo>
      <PieDeVentana error={deLaFecha ? null : error} enviando={enviando} alCancelar={alCancelar} texto={texto} />
    </form>
  )
}
