'use client'

import { Ban, CalendarPlus, PiggyBank } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { anularPermiso, justificarPermiso, registrarPermiso } from './acciones'

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
        descripcion={`${descripcion}. No se borra: queda con su motivo, y lo que ya se justificó vuelve a su saldo de horas extras.`}
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
