'use client'

import { CalendarClock, MessageSquareText } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { MOTIVO_DE_ATRASO, MOTIVOS_DE_ATRASO } from '@/lib/dominio/plazos'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'
import { fecha as formatoFecha } from '@/lib/format'

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
  // El aviso de «listo» queda siempre puesto y se vacía al abrir otra ventana:
  // así el lector de pantalla anuncia cada vez que cambia.
  const [aviso, setAviso] = useState('')
  if (!motivo && fecha === undefined) return null
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {motivo && <AnotarMotivo documento={documento} alAbrir={() => setAviso('')} alTerminar={setAviso} />}
      {fecha !== undefined && <CorregirFecha documento={documento} actual={fecha} alAbrir={() => setAviso('')} alTerminar={setAviso} />}
      <p role="status" className="basis-full text-right text-xs text-exito empty:hidden">
        {aviso}
      </p>
    </div>
  )
}

function AnotarMotivo({ documento, alAbrir, alTerminar }: { documento: Documento; alAbrir: () => void; alTerminar: (texto: string) => void }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const envio = useIdDelEnvio('motivo_atraso')
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label={`Anotar el motivo del atraso de la ${documento.nombre}`}
        onClick={() => {
          alAbrir()
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
  alAbrir,
  alTerminar,
}: {
  documento: Documento
  actual: string | null
  alAbrir: () => void
  alTerminar: (texto: string) => void
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const envio = useIdDelEnvio('fecha_prometida')
  const servicio = documento.tipo === 'OS'
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        aria-label={`Corregir la fecha prometida de la ${documento.nombre}`}
        onClick={() => {
          alAbrir()
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
            ? `Hoy vale el ${formatoFecha(actual)}. La fecha anterior queda en el recorrido; el documento y su PDF no cambian.`
            : 'La fecha anterior queda en el recorrido; el documento y su PDF no cambian.'
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
    { alYaEntrar: envio.otro },
  )
  return (
    <form onSubmit={alEnviar} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tipo" value={documento.tipo} />
      <input type="hidden" name="documento" value={documento.id} />
      {conFecha && (
        <Campo etiqueta={conFecha.servicio ? 'Fecha nueva en que vuelve' : 'Fecha nueva que prometió el proveedor'} htmlFor={`seg-fecha-${id}`} requerido>
          <Entrada id={`seg-fecha-${id}`} name="fecha" type="date" required className="tabular" />
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
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto={texto} />
    </form>
  )
}
