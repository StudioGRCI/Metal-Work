'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import type { catalogosDePlanos } from '@/lib/datos/versiones-planos'
import {
  agregarPersonaDiseno, actualizarPersonaDiseno, asignarAutorPlano, quitarPersonaDiseno,
} from './acciones-equipo'

type Catalogos = Awaited<ReturnType<typeof catalogosDePlanos>>

export function EquipoDiseno({ ordenId, abierta, puedeAsignar, catalogos }: {
  ordenId: string
  abierta: boolean
  puedeAsignar: boolean
  catalogos: Catalogos
}) {
  const equipo = catalogos.equipoNominal
  const responsable = equipo.find((persona) => persona.funcion === 'RESPONSABLE')
  const colaboradores = equipo.filter((persona) => persona.funcion === 'COLABORADOR').length
  const alta = useEnvio(agregarPersonaDiseno)
  return <details className="group mt-4 rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-acento [&::-webkit-details-marker]:hidden">
      <span className="min-w-0"><span className="block text-sm font-semibold text-texto">Personas que elaboran los planos</span>
        <span className="mt-0.5 block text-xs text-texto-suave">{responsable?.nombre ?? 'Sin responsable'} · {colaboradores} {colaboradores === 1 ? 'colaborador' : 'colaboradores'} · {catalogos.planos.length} {catalogos.planos.length === 1 ? 'plano' : 'planos'}</span>
      </span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
    </summary>
    <div className="space-y-5 border-t border-borde p-4">
      <p className="text-xs text-texto-suave">Diseño anota al responsable y a los colaboradores. En cada plano indica quién lo preparó.</p>
      {equipo.length === 0 && <p className="rounded-[var(--radius-base)] bg-superficie-2 p-3 text-sm text-texto-suave">
        Aún no se han anotado personas para esta OT.
      </p>}
      {equipo.length > 0 && <div className="grid gap-3 lg:grid-cols-2">
        {equipo.map((persona) => <Persona key={persona.id} persona={persona}
          ordenId={ordenId} editable={puedeAsignar && abierta}
          vinculada={catalogos.planos.some((plano) => plano.integrante_diseno_id === persona.id)}
          tieneResponsable={Boolean(responsable)} />)}
      </div>}
      {puedeAsignar && abierta && <form onSubmit={alta.alEnviar}
        className="grid gap-3 rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-4 sm:grid-cols-[minmax(0,2fr)_minmax(10rem,1fr)_auto] sm:items-end">
        <input type="hidden" name="orden_id" value={ordenId} />
        <Campo etiqueta="Nombre completo" htmlFor="equipo-nombre" requerido>
          <Entrada id="equipo-nombre" name="nombre" minLength={2} maxLength={120} required
            placeholder="Nombre y apellido" />
        </Campo>
        <Campo etiqueta="Función" htmlFor="equipo-funcion">
          <Seleccion id="equipo-funcion" name="funcion" defaultValue={responsable ? 'COLABORADOR' : 'RESPONSABLE'}>
            {!responsable && <option value="RESPONSABLE">Responsable</option>}
            <option value="COLABORADOR">Colaborador</option>
          </Seleccion>
        </Campo>
        <Boton type="submit" cargando={alta.enviando}>Agregar persona</Boton>
        {alta.error && <p role="alert" className="sm:col-span-3 text-sm text-peligro">{alta.error}</p>}
        {alta.resultado?.ok && <p role="status" className="sm:col-span-3 text-sm text-exito">{alta.resultado.mensaje}</p>}
      </form>}
      {catalogos.planos.length > 0 && <div>
        <h3 className="mb-2 text-sm font-semibold text-texto">Quién preparó cada plano</h3>
        <div className="grid gap-2 lg:grid-cols-2">
          {catalogos.planos.map((plano) => <AutorPlano key={plano.id} plano={plano}
            equipo={equipo} ordenId={ordenId} editable={puedeAsignar && abierta} />)}
        </div>
      </div>}
    </div>
  </details>
}

function Persona({ persona, ordenId, editable, vinculada, tieneResponsable }: {
  persona: Catalogos['equipoNominal'][number]
  ordenId: string
  editable: boolean
  vinculada: boolean
  tieneResponsable: boolean
}) {
  const [editando, setEditando] = useState(false)
  const cambio = useEnvio(actualizarPersonaDiseno, () => setEditando(false))
  const quitar = useEnvio(quitarPersonaDiseno)
  if (!editable || !editando) return <div className="rounded-[var(--radius-base)] border border-borde p-3">
    <p className="font-medium text-texto">{persona.nombre}</p>
    <p className="text-xs text-texto-suave">{persona.funcion === 'RESPONSABLE' ? 'Responsable de Diseño' : 'Colaborador de Diseño'}</p>
    {editable && <div className="mt-2 flex flex-wrap gap-2">
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setEditando(true)}>Editar nombre</Boton>
      {!vinculada && <form onSubmit={quitar.alEnviar}>
        <input type="hidden" name="orden_id" value={ordenId} />
        <input type="hidden" name="id" value={persona.id} />
        <Boton type="submit" variante="fantasma" tamano="sm" cargando={quitar.enviando}>Quitar</Boton>
      </form>}
      {quitar.error && <p role="alert" className="w-full text-xs text-peligro">{quitar.error}</p>}
    </div>}
  </div>
  return <form onSubmit={cambio.alEnviar} className="space-y-3 rounded-[var(--radius-base)] border border-acento p-3">
    <input type="hidden" name="orden_id" value={ordenId} />
    <input type="hidden" name="id" value={persona.id} />
    <Campo etiqueta="Nombre completo" htmlFor={`nombre-${persona.id}`} requerido>
      <Entrada id={`nombre-${persona.id}`} name="nombre" defaultValue={persona.nombre}
        minLength={2} maxLength={120} required />
    </Campo>
    <Campo etiqueta="Función" htmlFor={`funcion-${persona.id}`}>
      <Seleccion id={`funcion-${persona.id}`} name="funcion" defaultValue={persona.funcion}>
        <option value="COLABORADOR">Colaborador</option>
        {(!tieneResponsable || persona.funcion === 'RESPONSABLE') && <option value="RESPONSABLE">Responsable</option>}
      </Seleccion>
    </Campo>
    {cambio.error && <p role="alert" className="text-xs text-peligro">{cambio.error}</p>}
    <div className="flex gap-2">
      <Boton type="submit" tamano="sm" cargando={cambio.enviando}>Guardar</Boton>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setEditando(false)}>Cancelar</Boton>
    </div>
  </form>
}

function AutorPlano({ plano, equipo, ordenId, editable }: {
  plano: Catalogos['planos'][number]
  equipo: Catalogos['equipoNominal']
  ordenId: string
  editable: boolean
}) {
  const autor = equipo.find((persona) => persona.id === plano.integrante_diseno_id)
  const asignacion = useEnvio(asignarAutorPlano)
  return <div className="rounded-[var(--radius-base)] border border-borde p-3">
    <p className="text-sm font-medium text-texto">{plano.numero_plano} · {plano.nombre}</p>
    {!editable ? <p className="mt-1 text-xs text-texto-suave">
      Elaboró: {autor?.nombre ?? 'Sin asignar'}
    </p> : <form onSubmit={asignacion.alEnviar} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="orden_id" value={ordenId} />
      <input type="hidden" name="plano_id" value={plano.id} />
      <Campo etiqueta="Elaboró el plano" htmlFor={`autor-${plano.id}`} className="min-w-48 flex-1">
        <Seleccion id={`autor-${plano.id}`} name="integrante_id" defaultValue={plano.integrante_diseno_id ?? ''} required>
          <option value="" disabled>Elige una persona</option>
          {equipo.map((persona) => <option key={persona.id} value={persona.id}>{persona.nombre}</option>)}
        </Seleccion>
      </Campo>
      <Boton type="submit" variante="secundario" tamano="sm" cargando={asignacion.enviando}
        disabled={equipo.length === 0}>Asignar</Boton>
      {asignacion.error && <p role="alert" className="w-full text-xs text-peligro">{asignacion.error}</p>}
      {asignacion.resultado?.ok && <p role="status" className="w-full text-xs text-exito">{asignacion.resultado.mensaje}</p>}
    </form>}
  </div>
}
