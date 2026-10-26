'use client'

import { KeyRound, Pencil, Plus, UserMinus, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { TD, TR } from '@/components/ui/tabla'
import { Ventana } from '@/components/ui/ventana'
import type { PersonaEnLista } from '@/lib/datos/personal'
import { useEnvio } from '@/lib/envio'
import { cn } from '@/lib/utils'

import { cambiarClave, cambiarEstado, darDeAltaPersona, guardarPersona } from './acciones'

type Catalogos = {
  roles: { id: string; codigo: string; nombre: string }[]
  areas: { id: string; codigo: string; nombre: string }[]
  sedes: { id: string; nombre: string }[]
}

// Botón de icono de la fila. En el teléfono ocupa 44 px —lo que mide un dedo, y
// con guante puesto más—; a partir de `sm` vuelve a los 28 px de siempre, que es
// lo que daban el `p-1.5` y el icono de 16 px del escritorio.
const BOTON_ICONO =
  'inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 hover:text-texto sm:size-7'

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
        {/* `autoComplete="off"` en toda la ficha: el navegador rellena estos
            campos con los datos de quien está usando el sistema, y aquí se está
            dando de alta a otra persona. */}
        <Campo etiqueta="Nombres" htmlFor="nombres" requerido>
          <Entrada
            id="nombres"
            name="nombres"
            required
            autoComplete="off"
            defaultValue={persona?.nombres}
          />
        </Campo>
        <Campo etiqueta="Apellidos" htmlFor="apellidos" requerido>
          <Entrada
            id="apellidos"
            name="apellidos"
            required
            autoComplete="off"
            defaultValue={persona?.apellidos}
          />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Puesto" htmlFor="rol_id" requerido>
          <Seleccion id="rol_id" name="rol_id" required defaultValue={persona?.rol?.id ?? ''}>
            <option value="">Elegir…</option>
            {persona?.rol && !catalogos.roles.some((r) => r.id === persona.rol?.id) && (
              <option value={persona.rol.id} disabled>{persona.rol.nombre} (histórico)</option>
            )}
            {catalogos.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        {/* El área ya no es solo para agrupar en el tablero: decide de qué área
            es la hoja de avance que esta persona puede escribir. Quien reporta
            producción y se queda sin área no puede escribir nada. */}
        <Campo etiqueta="Área" htmlFor="area_id" ayuda="De quién es su hoja de avance">
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
          <Entrada id="cargo" name="cargo" autoComplete="off" defaultValue={persona?.cargo ?? ''} />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Teléfono" htmlFor="telefono">
          <Entrada
            id="telefono"
            name="telefono"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            defaultValue={persona?.telefono ?? ''}
          />
        </Campo>
      </div>

      {/* El DNI lo pone Recursos Humanos (migración 20261020165000): aquí solo
          se lee. */}
      {persona && (
        <p className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 p-3 text-sm text-texto">
          DNI <span className="tabular font-medium">{persona.documento ?? 'sin registrar'}</span>
          <span className="mt-0.5 block text-xs text-texto-suave">Lo pone y lo cambia Recursos Humanos, en «DNI de las cuentas».</span>
        </p>
      )}

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
              Solo verá las órdenes donde esté asignado o donde cargue horas. Supervisión no lleva esta marca.
            </span>
          </span>
        </label>


      </div>
    </>
  )
}

export function AltaDePersona({ catalogos }: { catalogos: Catalogos }) {
  const [abierto, setAbierto] = useState(false)
  const { alEnviar, enviando, resultado } = useEnvio(darDeAltaPersona)

  // Al dar de alta bien, se deja la ventana abierta para poder copiar la
  // contraseña: si se cerrara sola, se perdería y habría que cambiarla.
  return (
    <>
      <Boton onClick={() => setAbierto(true)}>
        <Plus aria-hidden className="size-4" />
        Dar de alta
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Dar de alta a una persona"
        descripcion="Se crea su ficha y su acceso al sistema en un solo paso."
      >
        <form onSubmit={alEnviar} className="space-y-3">
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
    </>
  )
}

export function FilaDePersona({
  persona,
  catalogos,
  gestiona,
  propia = false,
}: {
  persona: PersonaEnLista
  catalogos: Catalogos
  gestiona: boolean
  /** La fila de quien mira: la base no deja darse de baja a uno mismo. */
  propia?: boolean
}) {
  const router = useRouter()
  const [ventana, setVentana] = useState<'editar' | 'clave' | 'baja' | null>(null)

  const edicion = useEnvio(guardarPersona)
  const clave = useEnvio(cambiarClave)
  // Dada de baja, la fila se va de «Activos» y con ella el botón para
  // deshacerlo: se lleva a la lista donde quedó, con el botón a la vista.
  const estado = useEnvio(
    cambiarEstado,
    () => {
      setVentana(null)
      const lista = persona.activo ? 'bajas' : 'activos'
      router.push(`/personal?estado=${lista}&q=${encodeURIComponent(persona.correo ?? persona.apellidos)}`)
    },
    // La navegación ya trae la lista nueva: un refresco aparte la rehacía dos veces.
    { refrescar: false },
  )

  const alcance = (
    <>
      {persona.es_operario ? <Insignia tono="info">Solo sus órdenes</Insignia> : <Insignia tono="neutro">Todo el taller</Insignia>}
      {!persona.activo && (
        <span className="ml-1">
          <Insignia tono="peligro">De baja</Insignia>
        </span>
      )}
    </>
  )
  return (
    <>
      {/* Sin atenuar la fila: dejaba «Reactivar» y el correo por debajo del
          contraste que se lee. La insignia «De baja» ya dice el estado. */}
      <TR>
        <TD>
          <div className="font-medium">
            {persona.apellidos}, {persona.nombres}
          </div>
          {persona.cargo && <div className="text-xs text-texto-suave">{persona.cargo}</div>}
          {/* El correo es la columna que se esconde en el teléfono; aquí abajo
              sigue estando, que es el dato con el que se le escribe. */}
          <div className="text-[11px] break-all text-texto-suave sm:hidden">{persona.correo}</div>
          {/* El puesto y el alcance también bajan aquí en el teléfono: con sus
              columnas y los tres botones, la tabla se corría de costado. */}
          <div className="mt-1 text-xs text-texto sm:hidden">
            {[persona.rol?.nombre, persona.area?.nombre].filter(Boolean).join(' · ')}
          </div>
          <div className="mt-1 flex flex-wrap gap-1 sm:hidden">{alcance}</div>
        </TD>
        <TD className="hidden text-xs sm:table-cell">{persona.correo}</TD>
        <TD className="hidden text-xs sm:table-cell">{persona.rol?.nombre ?? '—'}</TD>
        <TD className="hidden text-xs sm:table-cell">{persona.area?.nombre ?? '—'}</TD>
        <TD className="hidden sm:table-cell">{alcance}</TD>

        {gestiona && (
          // En fila y con hueco solo en el teléfono: en el monitor los botones
          // iban pegados —JSX se come el salto de línea— y así siguen.
          <TD className="text-right whitespace-nowrap">
            <div className="flex items-center justify-end gap-1 sm:gap-0">
              <button
                type="button"
                onClick={() => setVentana('editar')}
                title="Editar la ficha"
                aria-label={`Editar a ${persona.nombres}`}
                className={BOTON_ICONO}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setVentana('clave')}
                title="Cambiar la contraseña"
                aria-label={`Cambiar la contraseña de ${persona.nombres}`}
                className={BOTON_ICONO}
              >
                <KeyRound className="size-4" />
              </button>
              {/* Dar de baja pregunta: el ícono está a un dedo del de la
                  contraseña y deja a la persona sin entrar. Reactivar no. */}
              {/* En la fila propia el lugar queda ocupado: si no, el lápiz caía
                  donde las demás filas tienen la llave. */}
              {persona.activo && propia ? (
                <span aria-hidden className={cn(BOTON_ICONO, 'invisible')} />
              ) : persona.activo ? (
                <button
                  type="button"
                  onClick={() => {
                    estado.limpiar()
                    setVentana('baja')
                  }}
                  title="Dar de baja"
                  aria-label={`Dar de baja a ${persona.nombres}`}
                  className={BOTON_ICONO}
                >
                  <UserMinus className="size-4" />
                </button>
              ) : (
                <form onSubmit={estado.alEnviar} className="inline">
                  <input type="hidden" name="id" value={persona.id} />
                  <input type="hidden" name="activo" value="true" />
                  <button
                    type="submit"
                    disabled={estado.enviando}
                    title="Reactivar"
                    aria-label={`Reactivar a ${persona.nombres}`}
                    className={cn(BOTON_ICONO, 'disabled:opacity-50')}
                  >
                    <UserPlus className="size-4" />
                  </button>
                </form>
              )}
              <Ventana
                abierta={ventana === 'baja'}
                alCerrar={() => setVentana(null)}
                titulo={`Dar de baja a ${persona.nombres} ${persona.apellidos}`}
                descripcion="Deja de entrar al sistema. Su ficha y sus horas se quedan, y se reactiva desde «Dados de baja»."
              >
                <form onSubmit={estado.alEnviar} className="flex flex-wrap justify-end gap-2">
                  <input type="hidden" name="id" value={persona.id} />
                  <input type="hidden" name="activo" value="false" />
                  {estado.resultado?.ok === false && (
                    <p role="alert" className="w-full text-sm text-peligro">{estado.resultado.error}</p>
                  )}
                  <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
                    Cancelar
                  </Boton>
                  <Boton type="submit" variante="peligro" cargando={estado.enviando}>
                    Dar de baja
                  </Boton>
                </form>
              </Ventana>
            </div>
          </TD>
        )}
      </TR>

      {((!persona.activo && estado.resultado?.ok === false) || clave.resultado || edicion.resultado?.ok === false) && (
        <TR>
          <TD colSpan={gestiona ? 7 : 6} className="py-1">
            <Aviso
              resultado={!persona.activo && estado.resultado?.ok === false ? estado.resultado : (clave.resultado ?? edicion.resultado)}
            />
          </TD>
        </TR>
      )}

      <Ventana
        abierta={ventana === 'editar'}
        alCerrar={() => setVentana(null)}
        titulo={`${persona.nombres} ${persona.apellidos}`}
        descripcion="Cambiar el puesto, el área o el alcance de esta persona."
      >
        <form onSubmit={edicion.alEnviar} className="space-y-3">
          <input type="hidden" name="id" value={persona.id} />
          <CamposDePersona catalogos={catalogos} persona={persona} />
          <Aviso resultado={edicion.resultado} />
          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
              Cerrar
            </Boton>
            <Boton type="submit" cargando={edicion.enviando}>
              Guardar la ficha
            </Boton>
          </div>
        </form>
      </Ventana>

      <Ventana
        abierta={ventana === 'clave'}
        alCerrar={() => setVentana(null)}
        titulo="Cambiar la contraseña"
        descripcion={`${persona.nombres} ${persona.apellidos} · ${persona.correo}`}
        ancho="sm"
      >
        <form onSubmit={clave.alEnviar} className="space-y-3">
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
          <Aviso resultado={clave.resultado} />
          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
              {clave.resultado?.ok ? 'Cerrar' : 'Cancelar'}
            </Boton>
            <Boton type="submit" cargando={clave.enviando}>
              Cambiar la contraseña
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
