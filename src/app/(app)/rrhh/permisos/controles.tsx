'use client'

import { Ban, CalendarPlus, Flag, MinusCircle, PiggyBank } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { TIPOS_REPORTE_PERMISO, TIPO_OBSERVACION } from '@/lib/dominio/rrhh'
import { useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { anularPermiso, descontarPermiso, justificarPermiso, registrarPermiso, reportarPermiso } from './acciones'

type Persona = { id: string; nombre: string; cargo: string | null }

/** «3,5» para los campos y los textos de horas. */
function horasEnTexto(horas: number): string {
  return horas.toLocaleString('es-PE', { maximumFractionDigits: 2 })
}

/** El botón «Registrar permiso» y su ventana. */
export function RegistrarPermiso({ personal, hoy }: { personal: Persona[]; hoy: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-registrar-permiso
      >
        <CalendarPlus aria-hidden className="size-4" />
        Registrar permiso
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Registrar permiso"
        descripcion="Quién lo pidió, qué día y cuántas horas. Después se justifica con sus horas extras reservadas."
        ancho="md"
      >
        <FormularioPermiso
          key={vez}
          personal={personal}
          hoy={hoy}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioPermiso({ personal, hoy, alTerminar }: { personal: Persona[]; hoy: string; alTerminar: (mensaje: string) => void }) {
  // Decidido aquí: un reintento manda el mismo id y la base no duplica.
  const [id] = useState(() => crypto.randomUUID())
  const [persona, setPersona] = useState('')
  const { alEnviar, enviando, error } = useEnvio(registrarPermiso, (r) => alTerminar(r.mensaje ?? 'Permiso registrado.'))
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Campo etiqueta="Persona" htmlFor={`permiso-persona-${id}`} requerido>
        <SeleccionBuscable
          id={`permiso-persona-${id}`}
          name="trabajador_id"
          valor={persona}
          onChange={setPersona}
          requerido
          marcador="Elige a la persona"
          marcadorBusqueda="Nombre o cargo…"
          opciones={personal.map((p) => ({ valor: p.id, etiqueta: p.nombre, detalle: p.cargo ?? 'Sin cargo' }))}
        />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Día del permiso" htmlFor={`permiso-fecha-${id}`} requerido>
          <Entrada id={`permiso-fecha-${id}`} name="fecha" type="date" required defaultValue={hoy} />
        </Campo>
        <Campo etiqueta="Horas que pidió" htmlFor={`permiso-horas-${id}`} requerido ayuda="Hasta 8 por día. Varios días: uno por día.">
          <Entrada
            id={`permiso-horas-${id}`}
            name="horas"
            type="number"
            inputMode="decimal"
            min={0.25}
            max={8}
            step={0.25}
            required
            className="tabular"
          />
        </Campo>
      </div>
      <Campo etiqueta="Para qué" htmlFor={`permiso-motivo-${id}`} requerido>
        <AreaTexto
          id={`permiso-motivo-${id}`}
          name="motivo"
          required
          minLength={10}
          maxLength={300}
          rows={3}
          placeholder="Por ejemplo: cita médica en EsSalud, sale a las 10 y vuelve a la 1."
        />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          Registrar
        </Boton>
      </div>
    </form>
  )
}

/**
 * Justificar el permiso con las horas extras reservadas: propone lo que el
 * saldo alcanza a cubrir de lo que falta, y se puede bajar.
 */
export function JustificarPermiso({
  permisoId,
  nombre,
  porJustificar,
  saldo,
}: {
  permisoId: string
  nombre: string
  porJustificar: number
  saldo: number
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const tope = Math.min(porJustificar, saldo)
  return (
    <>
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-justificar={permisoId}
      >
        <PiggyBank aria-hidden className="size-4" />
        Justificar
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Justificar el permiso de ${nombre}`}
        descripcion={`Le faltan ${horasEnTexto(porJustificar)} h y tiene ${horasEnTexto(saldo)} h extras reservadas. Lo que justifiques sale de su saldo.`}
        ancho="sm"
      >
        <FormularioJustificar key={vez} permisoId={permisoId} tope={tope} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

function FormularioJustificar({ permisoId, tope, alTerminar }: { permisoId: string; tope: number; alTerminar: () => void }) {
  const [id] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(justificarPermiso, alTerminar)
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="permiso_id" value={permisoId} />
      <Campo etiqueta="Horas que se justifican" htmlFor={`justificar-horas-${id}`} requerido>
        <Entrada
          id={`justificar-horas-${id}`}
          name="horas"
          type="number"
          inputMode="decimal"
          min={0.25}
          max={tope}
          step={0.25}
          required
          defaultValue={tope}
          className="tabular"
        />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Justificar con horas extras
        </Boton>
      </div>
    </form>
  )
}

/**
 * Descontar lo que falta justificar: en taller esas horas no se pagan, en la
 * oficina se restan de su próximo pago. Se confirma en una ventana.
 */
export function DescontarPermiso({
  permisoId,
  nombre,
  dia,
  horas,
  porJustificar,
  justificadas,
  descontadas,
  horasReporte,
  valorHora,
  oficina,
}: {
  permisoId: string
  nombre: string
  dia: string
  /** Las horas del permiso. */
  horas: number
  porJustificar: number
  justificadas: number
  descontadas: number
  /** Las horas que el supervisor le puso ese día; `null` si todavía no hay reporte. */
  horasReporte: number | null
  /** La hora de su remuneración; `null` para quien no ve el sueldo o sin remuneración. */
  valorHora: number | null
  oficina: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const descripcion = oficina
    ? queRestaLaOficina(porJustificar, dia, valorHora)
    : queRestaElTaller({ horas, porJustificar, justificadas, descontadas, horasReporte, valorHora, dia })
  return (
    <>
      <Boton
        type="button"
        variante="secundario"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-descontar={permisoId}
      >
        <MinusCircle aria-hidden className="size-4" />
        Descontar
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Descontar el permiso de ${nombre}`}
        descripcion={descripcion}
        ancho="sm"
      >
        <FormularioDescontar key={vez} permisoId={permisoId} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

/** «S/ 37.50 (3 h a S/ 12.50 la hora)», o nada sin el valor de la hora. */
function enSoles(horas: number, valorHora: number | null): string {
  if (valorHora === null) return ''
  return ` ${moneda(Math.round(horas * valorHora * 100) / 100)} (${horasEnTexto(horas)} h a ${moneda(valorHora)} la hora)`
}

/** En la oficina se le paga el sueldo: lo descontado se resta del próximo pago. */
function queRestaLaOficina(porJustificar: number, dia: string, valorHora: number | null): string {
  const cuanto = enSoles(porJustificar, valorHora)
  return cuanto
    ? `Las ${horasEnTexto(porJustificar)} h del ${dia} que faltan justificar se restan de su próximo pago:${cuanto}.`
    : `Las ${horasEnTexto(porJustificar)} h del ${dia} que faltan justificar se restan de su próximo pago, a su remuneración entre 240.`
}

/**
 * En taller se le paga por las horas del reporte. La misma cuenta que la base
 * (`descuentos_pendientes`): el reporte le pone a lo más 8 h ordinarias; las del
 * permiso que no caben con ellas en la jornada son las que el reporte contó como
 * trabajadas, y de esas se resta lo descontado que no se justificó.
 */
function queRestaElTaller({
  horas,
  porJustificar,
  justificadas,
  descontadas,
  horasReporte,
  valorHora,
  dia,
}: {
  horas: number
  porJustificar: number
  justificadas: number
  descontadas: number
  horasReporte: number | null
  valorHora: number | null
  dia: string
}): string {
  const deLasHoras = `Las ${horasEnTexto(porJustificar)} h del ${dia} que faltan justificar no se pagan`
  if (horasReporte === null) {
    return `${deLasHoras}: si el reporte de ese día se las cuenta como trabajadas, la próxima planilla diaria se las resta.`
  }
  const solape = Math.max(Math.min(horasReporte, 8) + horas - 8, 0)
  const restable = (d: number) => Math.max(Math.min(d, solape - justificadas), 0)
  const nuevas = restable(descontadas + porJustificar) - restable(descontadas)
  if (nuevas <= 0) {
    return `${deLasHoras}. El reporte de ese día no se las cuenta como trabajadas, así que no hay nada que restar.`
  }
  return `${deLasHoras}. El reporte de ese día le cuenta ${horasEnTexto(nuevas)} h de ellas como trabajadas: la próxima planilla diaria se las resta${enSoles(nuevas, valorHora) ? `,${enSoles(nuevas, valorHora)}` : ''}.`
}

function FormularioDescontar({ permisoId, alTerminar }: { permisoId: string; alTerminar: () => void }) {
  const [id] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(descontarPermiso, alTerminar)
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="permiso_id" value={permisoId} />
      <p className="text-sm text-texto-suave">
        Ya descontado, no se justifica con horas extras. Si fue un error, se anula el permiso y se vuelve a registrar: lo restado se devuelve en
        el pago siguiente.
      </p>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Descontar
        </Boton>
      </div>
    </form>
  )
}

/** Reportar el permiso sin justificar: queda en sus observaciones, como observación o amonestación. */
export function ReportarPermiso({ permisoId, nombre, dia }: { permisoId: string; nombre: string; dia: string }) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-reportar={permisoId}
      >
        <Flag aria-hidden className="size-4" />
        Reportar
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Reportar el permiso de ${nombre}`}
        descripcion={`El permiso del ${dia} queda en sus observaciones como «Permiso sin justificar», y se avisa a quienes revisan la asistencia del personal.`}
        ancho="sm"
      >
        <FormularioReportar key={vez} permisoId={permisoId} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

function FormularioReportar({ permisoId, alTerminar }: { permisoId: string; alTerminar: () => void }) {
  const [id] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(reportarPermiso, alTerminar)
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="permiso_id" value={permisoId} />
      <Campo etiqueta="Cómo queda" htmlFor={`reportar-tipo-${id}`} requerido>
        <Seleccion id={`reportar-tipo-${id}`} name="tipo" required defaultValue="OBSERVACION">
          {TIPOS_REPORTE_PERMISO.map((t) => (
            <option key={t} value={t}>
              {TIPO_OBSERVACION[t].etiqueta}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Nota" htmlFor={`reportar-nota-${id}`} ayuda="Opcional: lo que conversaron o por qué no lo justificó.">
        <AreaTexto id={`reportar-nota-${id}`} name="nota" minLength={2} maxLength={500} rows={3} />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Reportar
        </Boton>
      </div>
    </form>
  )
}

/** Anular un permiso con su motivo: lo justificado vuelve a su saldo. */
export function AnularPermiso({ id, descripcion }: { id: string; descripcion: string }) {
  const [abierta, setAbierta] = useState(false)
  const envio = useEnvio(anularPermiso, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" aria-label={`Anular ${descripcion}`} onClick={() => setAbierta(true)} data-anular-permiso={id}>
        <Ban aria-hidden className="size-4" />
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Anular este permiso"
        descripcion={`${descripcion}. No se borra: queda con su motivo; lo que ya se justificó vuelve a su saldo de horas extras, lo descontado se devuelve en su próximo pago y su reporte se anula.`}
        ancho="sm"
      >
        <form onSubmit={envio.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-permiso-${id}`} requerido>
            <AreaTexto
              id={`anular-permiso-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              rows={3}
              placeholder="Por ejemplo: al final no salió, se quedó a trabajar."
            />
          </Campo>
          {envio.error && (
            <p role="alert" className="text-sm text-peligro">
              {envio.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={envio.enviando}>
              Anular
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
