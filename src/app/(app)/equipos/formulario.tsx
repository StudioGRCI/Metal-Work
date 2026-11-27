'use client'

import { Archive, Pencil, Plus, RotateCcw, Tags, UserRound, Wrench } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { AreaDeEquipo, CategoriaDeEquipo, Equipo } from '@/lib/datos/equipos'
import { ESTADO_EQUIPO, ESTADOS_EQUIPO, esErrorDelCodigo, type EstadoEquipo } from '@/lib/dominio/equipos'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { useEstadoCompartido } from '@/lib/estado-compartido'

import { cambiarACargoDe, cambiarEstadoEquipo, crearCategoria, darDeBajaEquipo, guardarEquipo, reactivarEquipo } from './acciones'

/**
 * Lo que dijo la base al guardar, en una sola región de la pantalla: el equipo
 * dado de baja o reactivado se va de la lista, y sin esto se iba callado.
 */
type Aviso = { texto: string; vez: number; llevarAlAviso: boolean } | null
function useAvisoDelPadron() {
  const [aviso, setAviso] = useEstadoCompartido<Aviso>('equipos:aviso', null)
  const avisar = useCallback(
    (texto: string | undefined, llevarAlAviso = false) => setAviso(texto ? { texto, vez: Date.now(), llevarAlAviso } : null),
    [setAviso],
  )
  return [aviso, avisar] as const
}

/**
 * Siempre montada: la región que nace ya con su texto no se anuncia. Cuando la
 * fila se va de la lista (baja, reactivación) o la ventana se abrió lejos (el
 * alta), el cursor y la vista suben al aviso: en el teléfono quedaba miles de
 * píxeles arriba y la fila desaparecía sin explicación a la vista.
 */
export function AvisoDelPadron() {
  const [aviso] = useAvisoDelPadron()
  const region = useRef<HTMLParagraphElement>(null)
  const vez = aviso?.llevarAlAviso ? aviso.vez : null
  useEffect(() => {
    if (vez === null) return
    // Dos cuadros: primero la ventana devuelve el cursor a su botón, si sigue ahí.
    let segundo = 0
    const primero = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => {
        region.current?.focus({ preventScroll: true })
        region.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    })
    return () => {
      cancelAnimationFrame(primero)
      cancelAnimationFrame(segundo)
    }
  }, [vez])
  return (
    <p ref={region} role="status" tabIndex={-1} className={aviso ? 'mb-3 text-sm text-exito outline-none' : 'sr-only'}>
      {aviso && <span key={aviso.vez}>{aviso.texto}</span>}
    </p>
  )
}

type Catalogos = {
  categorias: CategoriaDeEquipo[]
  areas: AreaDeEquipo[]
}

/** Estado y, si no es operativo, qué tiene. Lo comparten el alta y «Estado». */
function CamposDeEstado({ prefijo, inicial, nota }: { prefijo: string; inicial: EstadoEquipo; nota?: string | null }) {
  const [estado, setEstado] = useState<EstadoEquipo>(inicial)
  return (
    <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
      <Campo etiqueta="Estado" htmlFor={`${prefijo}-estado`} requerido ayuda={ESTADO_EQUIPO[estado].descripcion}>
        <Seleccion id={`${prefijo}-estado`} name="estado" value={estado} onChange={(e) => setEstado(e.target.value as EstadoEquipo)}>
          {ESTADOS_EQUIPO.map((e) => (
            <option key={e} value={e}>
              {ESTADO_EQUIPO[e].etiqueta}
            </option>
          ))}
        </Seleccion>
      </Campo>
      {estado !== 'OPERATIVO' && (
        <Campo etiqueta="Qué tiene" htmlFor={`${prefijo}-nota`} requerido>
          <Entrada
            id={`${prefijo}-nota`}
            name="estado_nota"
            defaultValue={nota ?? ''}
            required
            minLength={3}
            maxLength={300}
            placeholder={estado === 'PARADO' ? 'Ej.: no enciende' : 'Ej.: el cable está pelado'}
          />
        </Campo>
      )}
    </div>
  )
}

/**
 * El formulario del equipo. En el alta, el código puede quedar vacío: la base
 * le da el que sigue en su categoría, que es el que aquí se anuncia.
 */
function FormularioEquipo({
  equipo,
  id,
  categorias,
  areas,
  siguientes,
  alCancelar,
  alTerminar,
  alYaEntrar,
  alDarDeBaja,
}: Catalogos & {
  equipo?: Equipo
  id: string
  /** El código que la base le daría al próximo equipo de cada categoría. */
  siguientes?: Record<string, string>
  /** Pasa de corregir a dar de baja: la baja es rara y no ocupa un botón en cada fila. */
  alDarDeBaja?: () => void
  alCancelar: () => void
  alTerminar: (mensaje: string | undefined) => void
  alYaEntrar?: () => void
}) {
  const [categoria, setCategoria] = useState(equipo?.categoria_id ?? '')
  // Con `equipo` corrige la fila que la lista muestra: se cierra con la lista
  // ya al día (`corrige`). El alta se cierra al contestar.
  const { alEnviar, enviando, error } = useEnvio(guardarEquipo, (r) => alTerminar(r.mensaje), {
    corrige: Boolean(equipo),
    alYaEntrar,
    documento: equipo?.id,
  })
  const prefijo = `eq-${equipo?.id ?? 'nuevo'}`
  // Un código repetido o mal escrito se dice en su campo, y el cursor va ahí.
  const delCodigo = esErrorDelCodigo(error) ? error : null
  useCursorAlRechazo(enviando, delCodigo, () => document.getElementById(`${prefijo}-codigo`))
  const elegida = categorias.find((c) => c.id === categoria)
  const sigue = siguientes?.[categoria]
  // Una categoría que ya no se usa solo se ofrece al equipo que la tiene.
  const ofrecidas = categorias.filter((c) => c.activo || c.id === equipo?.categoria_id)
  const ayudaDelCodigo = equipo
    ? 'El que el equipo lleva grabado.'
    : !elegida
      ? 'Elige primero la categoría.'
      : sigue
        ? `Si lo dejas vacío toma el que sigue: ${sigue}. Si el equipo ya lleva uno grabado, escríbelo.`
        : `«${elegida.nombre}» no tiene código propio: escríbelo, como MC-01.`

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="alta" value={equipo ? 'no' : 'si'} />
      {/* La versión que se corrige: si otra cuenta la cambió entretanto, no se pisa. */}
      {equipo && <input type="hidden" name="version" value={equipo.actualizado_en} />}

      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Campo etiqueta="Categoría" htmlFor={`${prefijo}-categoria`} requerido>
          <Seleccion id={`${prefijo}-categoria`} name="categoria_id" value={categoria} onChange={(e) => setCategoria(e.target.value)} required>
            <option value="" disabled>
              Elige la categoría
            </option>
            {ofrecidas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo
          etiqueta="Código"
          htmlFor={`${prefijo}-codigo`}
          requerido={Boolean(equipo) || Boolean(elegida && !sigue)}
          ayuda={ayudaDelCodigo}
          ayudaEnIcono={false}
          error={delCodigo ?? undefined}
        >
          <Entrada
            id={`${prefijo}-codigo`}
            name="codigo"
            defaultValue={equipo?.codigo ?? ''}
            placeholder={equipo ? undefined : sigue}
            required={Boolean(equipo) || Boolean(elegida && !sigue)}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="characters"
            className="uppercase placeholder:normal-case"
          />
        </Campo>
      </div>

      <Campo etiqueta="Descripción" htmlFor={`${prefijo}-descripcion`} requerido ayuda="Qué es, como en el inventario: «Amoladora angular 4 1/2&quot; 1500 W».">
        <Entrada id={`${prefijo}-descripcion`} name="descripcion" defaultValue={equipo?.descripcion ?? ''} required minLength={2} maxLength={200} />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Marca" htmlFor={`${prefijo}-marca`}>
          <Entrada id={`${prefijo}-marca`} name="marca" defaultValue={equipo?.marca ?? ''} maxLength={80} className="uppercase" />
        </Campo>
        <Campo etiqueta="Serie de máquina" htmlFor={`${prefijo}-serie`}>
          <Entrada id={`${prefijo}-serie`} name="serie_maquina" defaultValue={equipo?.serie_maquina ?? ''} maxLength={60} autoComplete="off" className="uppercase" />
        </Campo>
        <Campo etiqueta="Serie de cabezal" htmlFor={`${prefijo}-cabezal`}>
          <Entrada id={`${prefijo}-cabezal`} name="serie_cabezal" defaultValue={equipo?.serie_cabezal ?? ''} maxLength={60} autoComplete="off" className="uppercase" />
        </Campo>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Área" htmlFor={`${prefijo}-area`} requerido>
          <Seleccion id={`${prefijo}-area`} name="area_id" defaultValue={equipo?.area_id ?? ''} required>
            <option value="" disabled>
              Elige el área
            </option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Ubicación" htmlFor={`${prefijo}-ubicacion`} ayuda="Dónde está: nave, mesa, estante.">
          <Entrada id={`${prefijo}-ubicacion`} name="ubicacion" defaultValue={equipo?.ubicacion ?? ''} maxLength={120} />
        </Campo>
      </div>

      {/* Después del alta, quién lo tiene se cambia con «A cargo de», que toca solo eso. */}
      {!equipo && (
        <Campo etiqueta="A cargo de" htmlFor={`${prefijo}-cargo`} ayuda="Operario, contratista o área que lo tiene. Vacío si nadie.">
          <Entrada id={`${prefijo}-cargo`} name="a_cargo_de" maxLength={120} className="uppercase" />
        </Campo>
      )}

      {!equipo && <CamposDeEstado prefijo={prefijo} inicial="OPERATIVO" />}

      <Campo etiqueta="Observaciones" htmlFor={`${prefijo}-obs`}>
        <AreaTexto id={`${prefijo}-obs`} name="observaciones" rows={2} defaultValue={equipo?.observaciones ?? ''} maxLength={1000} />
      </Campo>

      <PieDeVentana
        error={delCodigo ? null : error}
        enviando={enviando}
        alCancelar={alCancelar}
        texto={equipo ? 'Guardar cambios' : 'Registrar equipo'}
        nota={
          equipo && alDarDeBaja ? (
            // Lo destructivo y raro, a un lado de Cancelar y Guardar.
            <Boton type="button" tamano="sm" variante="fantasma" disabled={enviando} onClick={alDarDeBaja}>
              <Archive aria-hidden className="size-3.5" />
              Dar de baja
            </Boton>
          ) : undefined
        }
      />
    </form>
  )
}

export function NuevoEquipo({ categorias, areas, siguientes }: Catalogos & { siguientes: Record<string, string> }) {
  const [abierta, setAbierta] = useState(false)
  const [, avisar] = useAvisoDelPadron()
  // El id vive fuera de la ventana y vuelve con ella hasta saber cómo terminó:
  // con el mismo, el reenvío tras una respuesta perdida no registra otro equipo.
  const [id, setId] = useState(() => crypto.randomUUID())

  return (
    <>
      <Boton
        onClick={() => {
          avisar(undefined)
          setAbierta(true)
        }}
      >
        <Plus aria-hidden className="size-4" />
        Nuevo equipo
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Nuevo equipo"
        descripcion="Entra al padrón de la planta. No se borra: si deja de usarse, se da de baja."
        ancho="lg"
      >
        <FormularioEquipo
          key={id}
          id={id}
          categorias={categorias}
          areas={areas}
          siguientes={siguientes}
          alCancelar={() => setAbierta(false)}
          alYaEntrar={() => setId(crypto.randomUUID())}
          alTerminar={(mensaje) => {
            setId(crypto.randomUUID())
            setAbierta(false)
            avisar(mensaje ?? 'Equipo registrado.', true)
          }}
        />
      </Ventana>
    </>
  )
}

/** Las categorías que hay, con el prefijo de sus códigos, y el alta de una más. */
export function CategoriasDeEquipo({ categorias }: { categorias: CategoriaDeEquipo[] }) {
  const [abierta, setAbierta] = useState(false)
  const [vuelta, setVuelta] = useState(0)
  const { alEnviar, enviando, error, resultado } = useEnvio(crearCategoria, () => setVuelta((v) => v + 1))

  return (
    <>
      <Boton variante="contorno" onClick={() => setAbierta(true)}>
        <Tags aria-hidden className="size-4" />
        Categorías
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Categorías de equipos"
        descripcion="Los grupos del inventario. El prefijo es el del código de sus equipos."
        ancho="md"
      >
        <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
          {categorias.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-texto">{c.nombre}</span>
              <span className="tabular text-xs text-texto-suave">{c.prefijo ? `${c.prefijo}-01…` : 'El código se escribe'}</span>
            </li>
          ))}
        </ul>

        {/* Fuera del formulario, que se rehace al entrar: la región que nace con su texto no se anuncia. */}
        <p role="status" className={resultado?.ok ? 'mt-3 text-sm text-exito' : 'sr-only'}>
          {resultado?.ok ? resultado.mensaje : ''}
        </p>
        <form key={vuelta} onSubmit={alEnviar} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Campo etiqueta="Nueva categoría" htmlFor="eq-cat-nombre" requerido>
              <Entrada id="eq-cat-nombre" name="nombre" required minLength={2} maxLength={60} placeholder="Ej.: Compresor" />
            </Campo>
            <Campo etiqueta="Prefijo" htmlFor="eq-cat-prefijo" ayuda="Opcional. Ej.: CMP">
              <Entrada id="eq-cat-prefijo" name="prefijo" maxLength={12} autoComplete="off" autoCapitalize="characters" className="uppercase" />
            </Campo>
          </div>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Agregar categoría" />
        </form>
      </Ventana>
    </>
  )
}

type AlTerminar = (mensaje: string | undefined) => void

function CambiarEstado({ equipo, alCerrar, alTerminar }: { equipo: Equipo; alCerrar: () => void; alTerminar: AlTerminar }) {
  const { alEnviar, enviando, error } = useEnvio(cambiarEstadoEquipo, (r) => alTerminar(r.mensaje), { corrige: true, documento: equipo.id })
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={equipo.id} />
      <CamposDeEstado prefijo={`eq-est-${equipo.id}`} inicial={equipo.estado} nota={equipo.estado_nota} />
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCerrar} texto="Guardar estado" />
    </form>
  )
}

function CambiarACargo({ equipo, alCerrar, alTerminar }: { equipo: Equipo; alCerrar: () => void; alTerminar: AlTerminar }) {
  const { alEnviar, enviando, error } = useEnvio(cambiarACargoDe, (r) => alTerminar(r.mensaje), { corrige: true, documento: equipo.id })
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={equipo.id} />
      <Campo etiqueta="A cargo de" htmlFor={`eq-cargo-${equipo.id}`} ayuda="Operario, contratista o área que lo tiene. Vacío si vuelve a Almacén sin nadie a cargo.">
        <Entrada id={`eq-cargo-${equipo.id}`} name="a_cargo_de" defaultValue={equipo.a_cargo_de ?? ''} maxLength={120} className="uppercase" />
      </Campo>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCerrar} texto="Guardar" />
    </form>
  )
}

function DarDeBaja({ equipo, alCerrar, alTerminar }: { equipo: Equipo; alCerrar: () => void; alTerminar: AlTerminar }) {
  const { alEnviar, enviando, error } = useEnvio(darDeBajaEquipo, (r) => alTerminar(r.mensaje), { corrige: true, documento: equipo.id })
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={equipo.id} />
      <Campo etiqueta="Motivo de la baja" htmlFor={`eq-baja-${equipo.id}`} requerido>
        <AreaTexto
          id={`eq-baja-${equipo.id}`}
          name="baja_motivo"
          rows={3}
          required
          minLength={5}
          maxLength={300}
          placeholder="Ej.: se quemó el motor y no tiene arreglo"
        />
      </Campo>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCerrar} texto="Dar de baja" variante="peligro" />
    </form>
  )
}

function Reactivar({ equipo, alCerrar, alTerminar }: { equipo: Equipo; alCerrar: () => void; alTerminar: AlTerminar }) {
  const { alEnviar, enviando, error } = useEnvio(reactivarEquipo, (r) => alTerminar(r.mensaje), { corrige: true, documento: equipo.id })
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={equipo.id} />
      <p className="text-sm text-texto-suave">
        Se dio de baja por: <span className="text-texto">{equipo.baja_motivo}</span>
      </p>
      <Campo etiqueta="Por qué vuelve a usarse" htmlFor={`eq-react-${equipo.id}`} requerido>
        <AreaTexto
          id={`eq-react-${equipo.id}`}
          name="motivo"
          rows={3}
          required
          minLength={5}
          maxLength={300}
          placeholder="Ej.: se reparó el motor en el taller"
        />
      </Campo>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCerrar} texto="Reactivar" />
    </form>
  )
}

type Abierta = 'editar' | 'estado' | 'cargo' | 'baja' | 'reactivar' | null

/**
 * Lo que cada puesto puede hacer con un equipo: Mantenimiento corrige, cambia
 * el estado, anota quién lo tiene y, desde «Editar», lo da de baja; Almacén
 * solo anota quién lo tiene. Lo que contesta la base se dice arriba
 * (`AvisoDelPadron`): la fila de un equipo dado de baja se va de la lista.
 */
export function AccionesEquipo({
  equipo,
  gestiona,
  asigna,
  categorias,
  areas,
}: Catalogos & { equipo: Equipo; gestiona: boolean; asigna: boolean }) {
  const [abierta, setAbierta] = useState<Abierta>(null)
  const [, avisar] = useAvisoDelPadron()
  const cerrar = () => setAbierta(null)
  const terminar: AlTerminar = (mensaje) => {
    setAbierta(null)
    avisar(mensaje)
  }
  // La fila se va de la lista: el aviso recibe el cursor.
  const terminarYSalir: AlTerminar = (mensaje) => {
    setAbierta(null)
    avisar(mensaje, true)
  }
  const abrir = (cual: Exclude<Abierta, null>) => {
    avisar(undefined)
    setAbierta(cual)
  }

  if (!equipo.activo) {
    if (!gestiona) return null
    return (
      <>
        <Boton type="button" tamano="sm" variante="contorno" aria-label={`Reactivar ${equipo.codigo}`} onClick={() => abrir('reactivar')}>
          <RotateCcw aria-hidden className="size-3.5" />
          Reactivar
        </Boton>
        <Ventana
          abierta={abierta === 'reactivar'}
          alCerrar={cerrar}
          titulo={`Reactivar ${equipo.codigo}`}
          descripcion="Vuelve al padrón en uso. La baja no se pierde: queda en su historia con el motivo de ahora."
          ancho="md"
        >
          <Reactivar equipo={equipo} alCerrar={cerrar} alTerminar={terminarYSalir} />
        </Ventana>
      </>
    )
  }

  return (
    // Sin caja propia: sus botones entran en el renglón de `AccionesDeFila`
    // de la fila (entrega 4 del plan de orden y diseño).
    <div className="contents">
      {gestiona && (
        <>
          <Boton type="button" tamano="sm" variante="contorno" aria-label={`Estado de ${equipo.codigo}`} onClick={() => abrir('estado')}>
            <Wrench aria-hidden className="size-3.5" />
            Estado
          </Boton>
          <Boton type="button" tamano="sm" variante="contorno" aria-label={`Editar ${equipo.codigo}`} onClick={() => abrir('editar')}>
            <Pencil aria-hidden className="size-3.5" />
            Editar
          </Boton>
        </>
      )}
      {asigna && (
        <Boton type="button" tamano="sm" variante="contorno" aria-label={`A cargo de ${equipo.codigo}`} onClick={() => abrir('cargo')}>
          <UserRound aria-hidden className="size-3.5" />
          A cargo de
        </Boton>
      )}

      <Ventana abierta={abierta === 'editar'} alCerrar={cerrar} titulo={`${equipo.codigo} · ${equipo.descripcion}`} descripcion="Corregir los datos del equipo, o darlo de baja." ancho="lg">
        <FormularioEquipo
          equipo={equipo}
          id={equipo.id}
          categorias={categorias}
          areas={areas}
          alCancelar={cerrar}
          alTerminar={terminar}
          alDarDeBaja={() => setAbierta('baja')}
        />
      </Ventana>
      <Ventana abierta={abierta === 'estado'} alCerrar={cerrar} titulo={`Estado de ${equipo.codigo}`} descripcion={equipo.descripcion} ancho="md">
        <CambiarEstado equipo={equipo} alCerrar={cerrar} alTerminar={terminar} />
      </Ventana>
      <Ventana abierta={abierta === 'cargo'} alCerrar={cerrar} titulo={`A cargo de ${equipo.codigo}`} descripcion={equipo.descripcion} ancho="md">
        <CambiarACargo equipo={equipo} alCerrar={cerrar} alTerminar={terminar} />
      </Ventana>
      <Ventana
        abierta={abierta === 'baja'}
        alCerrar={cerrar}
        titulo={`Dar de baja ${equipo.codigo}`}
        descripcion="No se borra: queda en el padrón con el motivo, quién y cuándo, y deja de ofrecerse. Si fue un error, se reactiva diciendo por qué."
        ancho="md"
      >
        <DarDeBaja equipo={equipo} alCerrar={cerrar} alTerminar={terminarYSalir} />
      </Ventana>
    </div>
  )
}
