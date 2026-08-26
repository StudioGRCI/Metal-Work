'use client'

import { KeyRound, Pencil, Plus, UserMinus, UserPlus } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { TD, TR } from '@/components/ui/tabla'
import type { PersonaEnLista } from '@/lib/datos/personal'
import { cn } from '@/lib/utils'

import { cambiarClave, cambiarEstado, darDeAltaPersona, guardarPersona } from './acciones'

type Catalogos = {
  roles: { id: string; codigo: string; nombre: string }[]
  areas: { id: string; codigo: string; nombre: string }[]
  sedes: { id: string; nombre: string }[]
}

/** Ventana modal simple, con el mismo aire que el resto del sistema. */
function Ventana({
  titulo,
  descripcion,
  onCerrar,
  children,
}: {
  titulo: string
  descripcion?: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const salir = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('keydown', salir)
    return () => document.removeEventListener('keydown', salir)
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-lg rounded-[calc(var(--radius-base)*1.5)] border border-borde bg-superficie p-5 shadow-2xl shadow-black/30"
      >
        <h2 className="text-base font-semibold text-texto">{titulo}</h2>
        {descripcion && <p className="mt-1 text-xs text-texto-suave">{descripcion}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado) return null
  const malo = resultado.ok === false
  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

/** Campos comunes al alta y a la edición. */
function CamposDePersona({
  catalogos,
  persona,
}: {
  catalogos: Catalogos
  persona?: PersonaEnLista
}) {
  const [esOperario, setEsOperario] = useState(persona?.es_operario ?? false)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombres" htmlFor="nombres" requerido>
          <Entrada id="nombres" name="nombres" required defaultValue={persona?.nombres} />
        </Campo>
        <Campo etiqueta="Apellidos" htmlFor="apellidos" requerido>
          <Entrada id="apellidos" name="apellidos" required defaultValue={persona?.apellidos} />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Puesto" htmlFor="rol_id" requerido>
          <Seleccion id="rol_id" name="rol_id" required defaultValue={persona?.rol?.id ?? ''}>
            <option value="">Elegir…</option>
            {catalogos.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Área" htmlFor="area_id">
          <Seleccion id="area_id" name="area_id" defaultValue={persona?.area?.id ?? ''}>
            <option value="">Sin área</option>
            {catalogos.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Taller" htmlFor="sede_id" requerido>
          <Seleccion id="sede_id" name="sede_id" required defaultValue={persona?.sede?.id ?? ''}>
            <option value="">Elegir…</option>
            {catalogos.sedes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Cargo" htmlFor="cargo" ayuda="Cómo se le llama en el taller">
          <Entrada id="cargo" name="cargo" defaultValue={persona?.cargo ?? ''} />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Documento" htmlFor="documento">
          <Entrada id="documento" name="documento" defaultValue={persona?.documento ?? ''} />
        </Campo>
        <Campo etiqueta="Teléfono" htmlFor="telefono">
          <Entrada id="telefono" name="telefono" defaultValue={persona?.telefono ?? ''} />
        </Campo>
      </div>

      <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-3">
        <label className="flex items-start gap-2.5 text-sm text-texto">
          <input
            type="checkbox"
            name="es_operario"
            value="true"
            checked={esOperario}
            onChange={(e) => setEsOperario(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            Trabaja en el taller
            <span className="mt-0.5 block text-xs text-texto-suave">
              Solo verá las órdenes donde esté asignado o donde cargue horas. Los jefes y
              supervisores no llevan esta marca.
            </span>
          </span>
        </label>

        {esOperario && (
          <div className="mt-3">
            <Campo etiqueta="Costo por hora (S/)" htmlFor="costo_hora" ayuda="Con esto se valoriza su tiempo">
              <Entrada
                id="costo_hora"
                name="costo_hora"
                type="number"
                step="0.01"
                min="0"
                defaultValue={persona?.costo_hora ?? 0}
              />
            </Campo>
          </div>
        )}
        {!esOperario && <input type="hidden" name="costo_hora" value={persona?.costo_hora ?? 0} />}
      </div>
    </>
  )
}

export function AltaDePersona({ catalogos }: { catalogos: Catalogos }) {
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(darDeAltaPersona, null)

  // Al dar de alta bien, se deja la ventana abierta para poder copiar la
  // contraseña: si se cerrara sola, se perdería y habría que cambiarla.
  return (
    <>
      <Boton onClick={() => setAbierto(true)}>
        <Plus aria-hidden className="size-4" />
        Dar de alta
      </Boton>

      {abierto && (
        <Ventana
          titulo="Dar de alta a una persona"
          descripcion="Se crea su ficha y su acceso al sistema en un solo paso."
          onCerrar={() => setAbierto(false)}
        >
          <form action={accion} className="space-y-3">
            <CamposDePersona catalogos={catalogos} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Correo" htmlFor="correo" requerido ayuda="Con este correo entra al sistema">
                <Entrada id="correo" name="correo" type="email" required autoComplete="off" />
              </Campo>
              <Campo
                etiqueta="Contraseña temporal"
                htmlFor="clave"
                requerido
                ayuda="Anótala: no se vuelve a mostrar"
              >
                <Entrada id="clave" name="clave" type="text" required minLength={10} autoComplete="off" />
              </Campo>
            </div>

            <Aviso resultado={resultado} />

            <div className="flex justify-end gap-2 pt-1">
              <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
                {resultado?.ok ? 'Cerrar' : 'Cancelar'}
              </Boton>
              <Boton type="submit" cargando={enviando}>
                Dar de alta
              </Boton>
            </div>
          </form>
        </Ventana>
      )}
    </>
  )
}

export function FilaDePersona({
  persona,
  catalogos,
  gestiona,
}: {
  persona: PersonaEnLista
  catalogos: Catalogos
  gestiona: boolean
}) {
  const [ventana, setVentana] = useState<'editar' | 'clave' | null>(null)

  const [edicion, accionEditar, editando] = useActionState(guardarPersona, null)
  const [claveHecha, accionClave, cambiandoClave] = useActionState(cambiarClave, null)
  const [estadoHecho, accionEstado, cambiandoEstado] = useActionState(cambiarEstado, null)

  return (
    <>
      <TR className={persona.activo ? undefined : 'opacity-60'}>
        <TD>
          <div className="font-medium">
            {persona.apellidos}, {persona.nombres}
          </div>
          <div className="text-xs text-texto-suave">{persona.cargo ?? '—'}</div>
        </TD>
        <TD className="text-xs">{persona.correo}</TD>
        <TD className="text-xs">{persona.rol?.nombre ?? '—'}</TD>
        <TD className="text-xs">{persona.area?.nombre ?? '—'}</TD>
        <TD>
          {persona.es_operario ? (
            <Insignia tono="info">Solo sus órdenes</Insignia>
          ) : (
            <Insignia tono="neutro">Todo el taller</Insignia>
          )}
          {!persona.activo && (
            <span className="ml-1">
              <Insignia tono="peligro">De baja</Insignia>
            </span>
          )}
        </TD>
        <TD className="tabular text-right text-xs">
          {persona.es_operario ? `S/ ${Number(persona.costo_hora).toFixed(2)}` : '—'}
        </TD>

        {gestiona && (
          <TD className="text-right whitespace-nowrap">
            <button
              type="button"
              onClick={() => setVentana('editar')}
              title="Editar la ficha"
              aria-label={`Editar a ${persona.nombres}`}
              className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setVentana('clave')}
              title="Cambiar la contraseña"
              aria-label={`Cambiar la contraseña de ${persona.nombres}`}
              className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto"
            >
              <KeyRound className="size-4" />
            </button>
            <form action={accionEstado} className="inline">
              <input type="hidden" name="id" value={persona.id} />
              <input type="hidden" name="activo" value={persona.activo ? 'false' : 'true'} />
              <button
                type="submit"
                disabled={cambiandoEstado}
                title={persona.activo ? 'Dar de baja' : 'Reactivar'}
                aria-label={persona.activo ? `Dar de baja a ${persona.nombres}` : `Reactivar a ${persona.nombres}`}
                className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto disabled:opacity-50"
              >
                {persona.activo ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />}
              </button>
            </form>
          </TD>
        )}
      </TR>

      {(estadoHecho?.ok === false || claveHecha || edicion?.ok === false) && (
        <TR>
          <TD colSpan={gestiona ? 7 : 6} className="py-1">
            <Aviso resultado={estadoHecho?.ok === false ? estadoHecho : (claveHecha ?? edicion)} />
          </TD>
        </TR>
      )}

      {ventana === 'editar' && (
        <Ventana
          titulo={`${persona.nombres} ${persona.apellidos}`}
          descripcion="Cambiar el puesto, el área o el alcance de esta persona."
          onCerrar={() => setVentana(null)}
        >
          <form action={accionEditar} className="space-y-3">
            <input type="hidden" name="id" value={persona.id} />
            <CamposDePersona catalogos={catalogos} persona={persona} />
            <Aviso resultado={edicion} />
            <div className="flex justify-end gap-2 pt-1">
              <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
                Cerrar
              </Boton>
              <Boton type="submit" cargando={editando}>
                Guardar
              </Boton>
            </div>
          </form>
        </Ventana>
      )}

      {ventana === 'clave' && (
        <Ventana
          titulo="Cambiar la contraseña"
          descripcion={`${persona.nombres} ${persona.apellidos} · ${persona.correo}`}
          onCerrar={() => setVentana(null)}
        >
          <form action={accionClave} className="space-y-3">
            <input type="hidden" name="id" value={persona.id} />
            <Campo
              etiqueta="Contraseña nueva"
              htmlFor={`clave-${persona.id}`}
              requerido
              ayuda="Anótala y entrégasela: no se vuelve a mostrar"
            >
              <Entrada
                id={`clave-${persona.id}`}
                name="clave"
                type="text"
                required
                minLength={10}
                autoComplete="off"
              />
            </Campo>
            <Aviso resultado={claveHecha} />
            <div className="flex justify-end gap-2 pt-1">
              <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
                {claveHecha?.ok ? 'Cerrar' : 'Cancelar'}
              </Boton>
              <Boton type="submit" cargando={cambiandoClave}>
                Cambiar
              </Boton>
            </div>
          </form>
        </Ventana>
      )}
    </>
  )
}
