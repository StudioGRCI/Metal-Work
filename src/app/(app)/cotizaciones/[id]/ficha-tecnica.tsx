'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import { Check, Minus, Pencil, Plus, Trash2, Wand2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ConfirmarAccion } from '@/components/ui/ventana'
import type { AccesorioCotizado, SeccionFicha } from '@/lib/datos/ficha'
import { cantidad as formatearCantidad } from '@/lib/format'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

import {
  agregarAccesorio,
  agregarLineaFicha,
  aplicarPlantilla,
  editarAccesorio,
  editarLineaFicha,
  guardarCabeceraTecnica,
  quitarAccesorio,
  quitarLineaFicha,
} from './acciones-ficha'
// El mismo cartel que las partidas: la ficha y las partidas son las dos mitades
// de la cotización de trabajo y se cierran juntas, así que el motivo se redacta
// en un solo sitio y no en dos que un día dirán cosas distintas.
import { CosteoCerrado } from './partidas'

export type Plantilla = { id: string; nombre: string; descripcion: string | null; carroceria: string | null }

export type CabeceraTecnica = {
  modelo: string | null
  tipo: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  capacidad: string | null
  peso_neto_tn: number | null
  garantia_meses: number
  incluye_igv: boolean
  plazo_en_habiles: boolean
  plazo_entrega_dias: number | null
  nota: string | null
  /**
   * Los cuatro datos que la migración 045 agregó porque están en todas las
   * cotizaciones de la casa y no había dónde guardarlos.
   *
   * Van opcionales mientras la página no los pase: la consulta que la alimenta
   * pide `*`, así que el dato ya viaja, pero el objeto que arma la página
   * todavía no los nombra y los tipos generados aún no conocen las columnas.
   */
  /** La garantía tal como se escribe, partida por sistema. Manda sobre los meses. */
  garantia_texto?: string | null
  /** La tolerancia que la casa siempre pone junto al peso: «+/- 5%». */
  peso_tolerancia?: string | null
  /** Las advertencias en negativo: «NO INCLUYE AROS NI LLANTAS». */
  no_incluye?: string | null
}

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
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

/**
 * La ficha técnica de la cotización de trabajo.
 *
 * La cotización de esta empresa no es una lista de precios: declara el espesor
 * de cada plancha, la norma de soldadura y qué accesorios entran y cuáles no.
 * Eso es lo que el taller fabrica y contra lo que el cliente reclama, así que
 * acá se llena como dato y no como párrafo.
 *
 * Es un acto de Administración, junto con las partidas: se arma en el costeo,
 * no cuando Ventas escribe el precio.
 */
export function FichaTecnica({
  cotizacionId,
  cabecera,
  secciones,
  accesorios,
  plantillas,
  puedeEditar,
  estado,
}: {
  cotizacionId: string
  cabecera: CabeceraTecnica
  secciones: SeccionFicha[]
  accesorios: AccesorioCotizado[]
  plantillas: Plantilla[]
  /**
   * Si esta mano puede armar la ficha ahora. La calcula la página cruzando el
   * estado con el permiso `cotizaciones.costear`; acá no se recalcula.
   */
  puedeEditar: boolean
  /**
   * Para contar por qué no se puede tocar. Opcional: sin él, el cartel dice la
   * regla del circuito y no adivina en qué estado está la cotización.
   */
  estado?: string
}) {
  return (
    <div className="space-y-4">
      {/* El encabezado del bloque dice una sola vez de qué acto forma parte
          todo esto; las tarjetas de abajo no lo repiten. */}
      <div>
        <h2 className="text-sm font-semibold text-texto">
          Ficha técnica de la cotización de trabajo
        </h2>
        <p className="mt-0.5 text-xs text-texto-suave">
          La arma Administración durante el costeo, junto con las partidas: con esto se compra el
          material y se programa el taller. A diferencia de las partidas, la ficha y los accesorios
          sí salen impresos en el papel del cliente.
        </p>
      </div>

      {/* Antes, sin permiso o fuera de turno, las tarjetas se quedaban mudas:
          ni botones ni motivo, y nadie sabía a quién pedirle el paso. */}
      {!puedeEditar && (
        <Tarjeta>
          <CosteoCerrado estado={estado} que="La ficha técnica y los accesorios" />
        </Tarjeta>
      )}

      {puedeEditar && plantillas.length > 0 && (
        <AplicarFicha cotizacionId={cotizacionId} plantillas={plantillas} vacia={secciones.length === 0} />
      )}

      <Medidas cotizacionId={cotizacionId} cabecera={cabecera} puedeEditar={puedeEditar} />

      <Especificaciones
        cotizacionId={cotizacionId}
        secciones={secciones}
        puedeEditar={puedeEditar}
      />

      <Accesorios
        cotizacionId={cotizacionId}
        accesorios={accesorios}
        puedeEditar={puedeEditar}
      />
    </div>
  )
}

function AplicarFicha({
  cotizacionId,
  plantillas,
  vacia,
}: {
  cotizacionId: string
  plantillas: Plantilla[]
  vacia: boolean
}) {
  const [resultado, accion, enviando] = useActionState(aplicarPlantilla, null)

  return (
    <Tarjeta className={vacia ? 'border-acento' : undefined}>
      <TarjetaCuerpo>
        <form action={accion} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />

          <Campo
            etiqueta="Partir de una ficha ya escrita"
            htmlFor="plantilla_id"
            ayuda={
              vacia
                ? 'Trae las especificaciones del producto para llenar solo lo que cambia'
                : 'Reemplaza la ficha actual por completo'
            }
            className="min-w-64 flex-1"
          >
            <Seleccion id="plantilla_id" name="plantilla_id" required>
              <option value="">Elegir…</option>
              {plantillas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.carroceria ? ` · ${p.carroceria}` : ''}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Boton type="submit" variante={vacia ? 'primario' : 'secundario'} cargando={enviando}>
            <Wand2 aria-hidden className="size-4" />
            Aplicar
          </Boton>
        </form>

        <div className="mt-2">
          <Aviso resultado={resultado} />
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Medidas({
  cotizacionId,
  cabecera,
  puedeEditar,
}: {
  cotizacionId: string
  cabecera: CabeceraTecnica
  puedeEditar: boolean
}) {
  const [resultado, accion, enviando] = useActionState(guardarCabeceraTecnica, null)

  if (!puedeEditar) {
    return (
      <Tarjeta>
        <TarjetaCabecera
          titulo="Medidas y condiciones"
          descripcion="Lo que se le prometió al cliente en esta cotización: sale impreso en su papel."
        />
        <TarjetaCuerpo className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Dato titulo="Modelo" valor={cabecera.modelo} />
          <Dato titulo="Tipo" valor={cabecera.tipo} />
          <Dato titulo="Capacidad" valor={cabecera.capacidad} />
          {/* El peso nunca se lee solo: la casa lo escribe siempre con su
              tolerancia, y sin ella el número parece exacto. */}
          <Dato titulo="Peso neto" valor={pesoConTolerancia(cabecera)} />
          <Dato titulo="Largo" valor={cabecera.largo_m ? `${cabecera.largo_m} m` : null} />
          <Dato titulo="Ancho" valor={cabecera.ancho_m ? `${cabecera.ancho_m} m` : null} />
          <Dato titulo="Alto" valor={cabecera.alto_m ? `${cabecera.alto_m} m` : null} />
          {/* Si está escrita a mano manda esa, que es la que se parte por
              sistema; los meses son el respaldo. */}
          <Dato
            titulo="Garantía"
            valor={cabecera.garantia_texto?.trim() || `${cabecera.garantia_meses} meses`}
          />
          <Dato titulo="Precio" valor={cabecera.incluye_igv ? 'Incluye IGV' : 'No incluye IGV'} />
          <Dato
            titulo="Plazo"
            valor={
              cabecera.plazo_entrega_dias
                ? `${cabecera.plazo_entrega_dias} días ${cabecera.plazo_en_habiles ? 'hábiles' : 'calendario'}`
                : null
            }
          />
          {cabecera.no_incluye && (
            <p className="text-xs text-texto-suave sm:col-span-3">
              <span className="font-medium text-texto">No incluye: </span>
              {cabecera.no_incluye}
            </p>
          )}
          {cabecera.nota && (
            <p className="text-xs text-texto-suave sm:col-span-3">{cabecera.nota}</p>
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Medidas y condiciones"
        descripcion="Lo que cambia en cada cotización de trabajo; la ficha de abajo trae el resto. De acá salen las medidas con las que se compra la plancha, y esto sí sale impreso en el papel del cliente."
      />
      <TarjetaCuerpo>
        <form action={accion} className="space-y-3">
          <input type="hidden" name="cotizacion_id" value={cotizacionId} />

          {/* El peso subió de fila para quedar pegado a su tolerancia: en el
              papel de la casa van juntos —«PESO NETO: 6.7 TN (+/- 5%)»— y
              separarlos era lo que hacía que la tolerancia se olvidara. La
              capacidad bajó con las medidas, que es lo que acompaña. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Modelo" htmlFor="modelo">
              <Entrada id="modelo" name="modelo" defaultValue={cabecera.modelo ?? ''} placeholder="VASCULANTE" />
            </Campo>
            <Campo etiqueta="Tipo" htmlFor="tipo">
              <Entrada id="tipo" name="tipo" defaultValue={cabecera.tipo ?? ''} placeholder="PLATAFORMA REFORZADA" />
            </Campo>
            <Campo etiqueta="Peso neto" htmlFor="peso_neto_tn" ayuda="Toneladas">
              <Entrada
                id="peso_neto_tn"
                name="peso_neto_tn"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.peso_neto_tn ?? ''}
              />
            </Campo>
            <Campo
              etiqueta="Tolerancia del peso"
              htmlFor="peso_tolerancia"
              ayuda="La casa siempre la escribe; sin ella el peso se lee como exacto."
            >
              {/* Es texto y no número: el papel dice «+/- 5%» tal cual. */}
              <Entrada
                id="peso_tolerancia"
                name="peso_tolerancia"
                autoComplete="off"
                list="peso-tolerancia-usuales"
                defaultValue={cabecera.peso_tolerancia ?? ''}
                placeholder="+/- 5%"
              />
            </Campo>
            {/* Fuera del Campo: el Campo clona a sus hijos para atarles la
                ayuda, y al datalist no hay nada que atarle. */}
            <datalist id="peso-tolerancia-usuales">
              <option value="+/- 5%" />
              <option value="+/- 3%" />
            </datalist>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Capacidad" htmlFor="capacidad" ayuda="Como va en la cotización">
              <Entrada id="capacidad" name="capacidad" defaultValue={cabecera.capacidad ?? ''} placeholder="10 M3" />
            </Campo>
            <Campo etiqueta="Largo" htmlFor="largo_m" ayuda="Metros">
              <Entrada
                id="largo_m"
                name="largo_m"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.largo_m ?? ''}
              />
            </Campo>
            <Campo etiqueta="Ancho" htmlFor="ancho_m" ayuda="Metros">
              <Entrada
                id="ancho_m"
                name="ancho_m"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.ancho_m ?? ''}
              />
            </Campo>
            <Campo etiqueta="Alto" htmlFor="alto_m" ayuda="Metros">
              <Entrada
                id="alto_m"
                name="alto_m"
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={cabecera.alto_m ?? ''}
              />
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Garantía" htmlFor="garantia_meses" ayuda="Meses">
              <Entrada
                id="garantia_meses"
                name="garantia_meses"
                type="number"
                inputMode="numeric"
                min="0"
                max="120"
                defaultValue={cabecera.garantia_meses}
              />
            </Campo>
            {/* Los meses solos no alcanzan: la casa parte la garantía por
                sistema y eso es lo que firma. Va pegado a los meses porque es
                el mismo dato contado con más detalle. */}
            <Campo
              etiqueta="Garantía, como va escrita"
              htmlFor="garantia_texto"
              ayuda="La garantía se parte por sistema: «01 año contra fallas de fabricación / 6 meses en sistema hidráulico». Si se deja vacía, el papel escribe los meses."
              className="sm:col-span-2 lg:col-span-3"
            >
              <Entrada
                id="garantia_texto"
                name="garantia_texto"
                autoComplete="off"
                defaultValue={cabecera.garantia_texto ?? ''}
                placeholder="01 año contra eventuales fallas de fabricación"
              />
            </Campo>
          </div>

          {/* La casilla crece en el teléfono -y la etiqueta entera se marca,
              que es lo que se toca con el guante puesto-; en `sm:` vuelve al
              tamaño de siempre. */}
          <div className="flex flex-wrap gap-5 pt-1">
            <label className="flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
              <input
                type="checkbox"
                name="incluye_igv"
                defaultChecked={cabecera.incluye_igv}
                className="size-5 accent-[var(--acento)] sm:size-4"
              />
              El precio incluye IGV
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
              <input
                type="checkbox"
                name="plazo_en_habiles"
                defaultChecked={cabecera.plazo_en_habiles}
                className="size-5 accent-[var(--acento)] sm:size-4"
              />
              El plazo se cuenta en días de taller
            </label>
          </div>

          {/* Lejos de los accesorios a propósito: los accesorios son lo que se
              entrega y esto es exactamente lo contrario. Puestos juntos, lo
              segundo se lee como más de lo primero. */}
          <Campo
            etiqueta="No incluye"
            htmlFor="no_incluye"
            ayuda="Lo que el cliente podría dar por incluido y no lo está. Va en mayúsculas, como en el papel."
          >
            <AreaTexto
              id="no_incluye"
              name="no_incluye"
              rows={2}
              defaultValue={cabecera.no_incluye ?? ''}
              placeholder="NO INCLUYE AROS NI LLANTAS"
            />
          </Campo>

          <NotaDeCierre nota={cabecera.nota ?? ''} />

          <Aviso resultado={resultado} />

          <div className="flex justify-end">
            {/* En la misma pantalla se guardan las medidas, el trabajo impreso
                y cada partida: el botón dice cuál de las tres es. */}
            <Boton type="submit" cargando={enviando}>
              Guardar medidas
            </Boton>
          </div>
        </form>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * El peso como lo escribe la casa: «6.7 TN (+/- 5%)».
 *
 * La tolerancia va pegada al número y no en una línea aparte: un peso sin
 * tolerancia se lee como promesa exacta, y eso es lo que después se reclama con
 * la unidad en la balanza.
 */
function pesoConTolerancia(cabecera: CabeceraTecnica) {
  if (!cabecera.peso_neto_tn) return null
  const tolerancia = cabecera.peso_tolerancia?.trim()
  return `${formatearCantidad(cabecera.peso_neto_tn)} TN${tolerancia ? ` (${tolerancia})` : ''}`
}

/** Una nota de cierre del catálogo `public.notas_cotizacion`. */
type NotaCatalogo = { id: string; codigo: string; texto: string; orden: number }

/**
 * La forma de `notas_cotizacion`, escrita acá a mano a propósito.
 *
 * La tabla entró con la migración 045 y `src/types/database.ts` todavía no se
 * regeneró —no es de este encargo—, así que en vez de inventar el archivo
 * generado se declara solo lo que esta pantalla consulta. Cuando se corra
 * `./scripts/generar-tipos.sh`, esto sobra: se borra el tipo y el `as` de abajo.
 */
type BaseNotas = {
  public: {
    Tables: {
      notas_cotizacion: {
        Row: NotaCatalogo & { activo: boolean }
        Insert: NotaCatalogo & { activo: boolean }
        Update: Partial<NotaCatalogo & { activo: boolean }>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

/**
 * La nota que cierra el papel del cliente, con el catálogo de la casa al lado.
 *
 * Las notas finales de esta empresa hablan siempre de lo mismo —certificados,
 * expediente para registros públicos, tarjeta, placas, plaqueta— y hasta ahora
 * se volvían a teclear en cada cotización: cada una terminaba diciendo una cosa
 * distinta. Acá se eligen del catálogo y se suman al texto, que sigue siendo
 * libre para lo que el catálogo no cubra.
 */
function NotaDeCierre({ nota }: { nota: string }) {
  const [texto, setTexto] = useState(nota)
  const [catalogo, setCatalogo] = useState<NotaCatalogo[] | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  // El catálogo se pide al abrirlo, no al cargar la pantalla: la mayoría de las
  // veces la ficha se toca sin mirar las notas. Y se pide desde el manejador
  // del clic, no desde un efecto, que en este proyecto está cerrado.
  async function alternarCatalogo() {
    if (abierto) {
      setAbierto(false)
      return
    }

    setAbierto(true)
    if (catalogo || cargando) return

    setCargando(true)
    setFallo(null)

    // Es vocabulario de la casa: lo lee cualquiera con la sesión iniciada, así
    // que va con el cliente del navegador y no por una acción de servidor.
    const supabase = createClient() as unknown as SupabaseClient<BaseNotas>
    const { data, error } = await supabase
      .from('notas_cotizacion')
      .select('id, codigo, texto, orden')
      .eq('activo', true)
      .order('orden')

    setCargando(false)

    if (error) {
      setFallo('No se pudo traer el catálogo de notas. La nota se puede escribir a mano.')
      return
    }

    setCatalogo(data ?? [])
  }

  function agregar(elegida: NotaCatalogo) {
    setTexto((actual) => {
      const limpio = actual.trim()
      // Se juntan con un espacio porque el papel imprime la nota como un solo
      // párrafo; en renglones sueltos saldría una lista que nadie escribió así.
      return limpio ? `${limpio} ${elegida.texto}` : elegida.texto
    })
  }

  return (
    <div className="space-y-2">
      <Campo
        etiqueta="Nota al pie"
        htmlFor="nota"
        ayuda="Cierra el papel del cliente. Lo que se repite en todas está en el catálogo de la casa."
      >
        <AreaTexto
          id="nota"
          name="nota"
          rows={3}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Incluye certificado de montaje y expediente para registros públicos."
        />
      </Campo>

      {/* El catálogo va fuera del Campo: el Campo clona a sus hijos para
          atarles la ayuda, y esto no es un control del formulario. */}
      <div className="space-y-2">
        <Boton
          type="button"
          variante="secundario"
          tamano="sm"
          aria-expanded={abierto}
          cargando={cargando}
          onClick={() => {
            void alternarCatalogo()
          }}
        >
          {abierto ? <Minus aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
          Notas de la casa
        </Boton>

        {abierto && (
          <div className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            {fallo && (
              <p role="alert" className="text-xs text-peligro">
                {fallo}
              </p>
            )}

            {!fallo && cargando && (
              <p role="status" className="text-xs text-texto-suave">
                Trayendo las notas…
              </p>
            )}

            {catalogo?.length === 0 && (
              <p className="text-xs text-texto-suave">
                El catálogo está vacío. Las notas que se repiten se dan de alta en Configuración.
              </p>
            )}

            {catalogo && catalogo.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {catalogo.map((n) => {
                  // Si ya está en el texto no se ofrece de nuevo: dos veces la
                  // misma frase en la misma nota es lo que se quiere evitar.
                  const yaEsta = texto.includes(n.texto)

                  return (
                    <li key={n.id}>
                      <Boton
                        type="button"
                        variante="contorno"
                        tamano="sm"
                        disabled={yaEsta}
                        onClick={() => agregar(n)}
                        aria-label={yaEsta ? `Ya está en la nota: ${n.texto}` : `Agregar a la nota: ${n.texto}`}
                        // La frase entera es el rótulo, así que el botón crece
                        // hacia abajo en vez de recortarla.
                        className="h-auto min-h-10 py-1.5 text-left whitespace-normal sm:h-auto sm:min-h-8"
                      >
                        {yaEsta ? (
                          <Check aria-hidden className="size-3.5 shrink-0" />
                        ) : (
                          <Plus aria-hidden className="size-3.5 shrink-0" />
                        )}
                        {n.texto}
                      </Boton>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null }) {
  return (
    <p>
      <span className="text-texto-suave">{titulo}: </span>
      <span className="text-texto">{valor ?? '—'}</span>
    </p>
  )
}

function Especificaciones({
  cotizacionId,
  secciones,
  puedeEditar,
}: {
  cotizacionId: string
  secciones: SeccionFicha[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarLineaFicha, null)
  const [, accionQuitar] = useActionState(quitarLineaFicha, null)

  // La línea que se está corrigiendo. Se llama a la acción directamente para
  // poder cerrar el formulario en cuanto guarda: con useActionState habría que
  // encadenarlo a un efecto, y esa puerta está cerrada en este proyecto.
  const [editando, setEditando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  // La línea que se pidió quitar, esperando la confirmación. Se guarda con qué
  // dice y de qué sección es: la pregunta tiene que nombrarla.
  const [porQuitar, setPorQuitar] = useState<{ id: string; seccion: string; texto: string } | null>(
    null,
  )

  function confirmarQuitar() {
    if (!porQuitar) return

    const datos = new FormData()
    datos.set('id', porQuitar.id)
    datos.set('cotizacion_id', cotizacionId)

    // Dentro de la transición a propósito: React avisa por consola si la acción
    // de `useActionState` se llama fuera de una, y el pendiente no se actualiza.
    iniciarTransicion(() => accionQuitar(datos))
    setPorQuitar(null)
  }

  async function guardarLinea(datos: FormData) {
    setErrorEdicion(null)
    setGuardando(true)
    const salida = await editarLineaFicha(null, datos)
    setGuardando(false)

    if (!salida.ok) {
      setErrorEdicion(salida.error)
      return
    }

    setEditando(null)
    iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Especificaciones técnicas"
        descripcion="Lo que el taller va a fabricar y contra lo que el cliente va a reclamar: con esto se compra el material y se programa el taller. Se escribe en el costeo y sale impresa en el papel del cliente."
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)}>
              {abierto ? <Minus aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
              Agregar línea
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-4">
        {abierto && puedeEditar && (
          <form action={accion} className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo etiqueta="Sección" htmlFor="seccion" requerido>
                <Entrada id="seccion" name="seccion" required placeholder="SISTEMA HIDRÁULICO" list="secciones-ficha" />
                <datalist id="secciones-ficha">
                  {secciones.map((s) => (
                    <option key={s.seccion} value={s.seccion} />
                  ))}
                </datalist>
              </Campo>
              <Campo etiqueta="Etiqueta" htmlFor="etiqueta" ayuda="Opcional">
                <Entrada id="etiqueta" name="etiqueta" placeholder="Pistón" />
              </Campo>
              <Campo etiqueta="Detalle" htmlFor="detalle" requerido className="sm:col-span-2">
                <Entrada
                  id="detalle"
                  name="detalle"
                  required
                  placeholder="Telescópico de cuatro (4) cuerpos cromados"
                />
              </Campo>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Aviso resultado={resultado} />
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar línea
              </Boton>
            </div>
          </form>
        )}

        {secciones.length === 0 ? (
          // Un vacío que dice cuál es el siguiente paso y trae el botón que lo
          // da; y que distingue al que puede escribirla del que solo la mira.
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-texto">
              Esta cotización todavía no tiene ficha técnica
            </p>
            <p className="mt-1 text-xs text-texto-suave">
              {puedeEditar
                ? 'Aplica una ficha ya escrita y ajusta lo que cambie, o escribe la primera línea a mano.'
                : 'La escribe Administración mientras la cotización está en costeo.'}
            </p>
            {puedeEditar && !abierto && (
              <div className="mt-4 flex justify-center">
                <Boton tamano="sm" onClick={() => setAbierto(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  Escribir la primera línea
                </Boton>
              </div>
            )}
          </div>
        ) : (
          secciones.map((seccion) => (
            <section key={seccion.seccion}>
              <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-acento uppercase">
                {seccion.seccion}
              </h3>
              <ul className="space-y-1">
                {seccion.lineas.map((linea) =>
                  editando === linea.id ? (
                    <li key={linea.id}>
                      <form
                        action={guardarLinea}
                        className="grid gap-2 rounded-[var(--radius-base)] bg-superficie-2 p-3 sm:grid-cols-4"
                      >
                        <input type="hidden" name="id" value={linea.id} />
                        <input type="hidden" name="cotizacion_id" value={cotizacionId} />

                        <Campo etiqueta="Etiqueta" htmlFor={`etiqueta-${linea.id}`} ayuda="Opcional">
                          <Entrada
                            id={`etiqueta-${linea.id}`}
                            name="etiqueta"
                            defaultValue={linea.etiqueta ?? ''}
                          />
                        </Campo>

                        <Campo
                          etiqueta="Detalle"
                          htmlFor={`detalle-${linea.id}`}
                          requerido
                          className="sm:col-span-3"
                        >
                          <Entrada
                            id={`detalle-${linea.id}`}
                            name="detalle"
                            required
                            autoFocus
                            defaultValue={linea.detalle}
                          />
                        </Campo>

                        <div className="flex items-center justify-between gap-3 sm:col-span-4">
                          {errorEdicion ? (
                            <p role="alert" className="text-xs text-peligro">
                              {errorEdicion}
                            </p>
                          ) : (
                            <span />
                          )}
                          <span className="flex gap-2">
                            <Boton
                              type="button"
                              variante="fantasma"
                              tamano="sm"
                              onClick={() => {
                                setErrorEdicion(null)
                                setEditando(null)
                              }}
                            >
                              Cancelar
                            </Boton>
                            <Boton type="submit" tamano="sm" cargando={guardando}>
                              Guardar la línea
                            </Boton>
                          </span>
                        </div>
                      </form>
                    </li>
                  ) : (
                    <li key={linea.id} className="group flex items-start gap-2 text-sm">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-borde-fuerte" />
                      <span className="flex-1 text-texto">
                        {linea.etiqueta && (
                          <span className="font-medium text-texto">{linea.etiqueta}: </span>
                        )}
                        {linea.detalle}
                      </span>
                      {puedeEditar && (
                        <span className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setErrorEdicion(null)
                              setEditando(linea.id)
                            }}
                            aria-label={`Editar ${linea.etiqueta ?? linea.detalle.slice(0, 30)}`}
                            className="rounded p-3.5 text-texto-tenue hover:text-acento sm:p-1"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          {/* Antes esto era un formulario que borraba de una:
                              el icono está agrandado para el guante y se
                              acierta sin querer. Ahora pregunta primero. */}
                          <button
                            type="button"
                            onClick={() =>
                              setPorQuitar({
                                id: linea.id,
                                seccion: seccion.seccion,
                                texto: linea.etiqueta
                                  ? `${linea.etiqueta}: ${linea.detalle}`
                                  : linea.detalle,
                              })
                            }
                            aria-label={`Quitar ${linea.etiqueta ?? linea.detalle.slice(0, 30)}`}
                            className="rounded p-3.5 text-texto-tenue hover:text-peligro sm:p-1"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))
        )}

        {/* Va dentro de la condición: la pregunta nombra la línea que se pidió
            quitar, y sin ella no hay nada que nombrar. */}
        {porQuitar && (
          <ConfirmarAccion
            abierta
            alCerrar={() => setPorQuitar(null)}
            alConfirmar={confirmarQuitar}
            titulo="¿Quitar la línea de la ficha?"
            detalle={`Se va «${porQuitar.texto}» de ${porQuitar.seccion}. Habrá que volver a escribirla, y lo que no queda en la ficha el taller no lo fabrica.`}
            etiquetaConfirmar="Sí, quitar la línea"
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Accesorios({
  cotizacionId,
  accesorios,
  puedeEditar,
}: {
  cotizacionId: string
  accesorios: AccesorioCotizado[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [resultado, accion, enviando] = useActionState(agregarAccesorio, null)
  const [, accionQuitar] = useActionState(quitarAccesorio, null)

  const [editando, setEditando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null)

  // El accesorio que se pidió quitar, esperando la confirmación: la pregunta
  // lo nombra con la cantidad, que es como figura en la ficha.
  const [porQuitar, setPorQuitar] = useState<AccesorioCotizado | null>(null)

  function confirmarQuitar() {
    if (!porQuitar) return

    const datos = new FormData()
    datos.set('id', porQuitar.id)
    datos.set('cotizacion_id', cotizacionId)

    // Dentro de la transición a propósito: React avisa por consola si la acción
    // de `useActionState` se llama fuera de una, y el pendiente no se actualiza.
    iniciarTransicion(() => accionQuitar(datos))
    setPorQuitar(null)
  }

  async function guardarAccesorio(datos: FormData) {
    setErrorEdicion(null)
    setGuardando(true)
    const salida = await editarAccesorio(null, datos)
    setGuardando(false)

    if (!salida.ok) {
      setErrorEdicion(salida.error)
      return
    }

    setEditando(null)
    iniciarTransicion(() => router.refresh())
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Accesorios y equipamiento"
        descripcion="Lo que la cotización de trabajo promete entregar, y que el taller tiene que comprar o fabricar. El que dice «solo el soporte» va marcado. Sale impreso en el papel del cliente."
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setAbierto((a) => !a)}>
              {abierto ? <Minus aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
              Agregar
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {abierto && puedeEditar && (
          <form action={accion} className="rounded-[var(--radius-base)] bg-superficie-2 p-3">
            <input type="hidden" name="cotizacion_id" value={cotizacionId} />
            <div className="grid gap-3 sm:grid-cols-5">
              <Campo etiqueta="Cantidad" htmlFor="cantidad" requerido>
                <Entrada
                  id="cantidad"
                  name="cantidad"
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0.5"
                  defaultValue={1}
                  required
                />
              </Campo>
              <Campo etiqueta="Unidad" htmlFor="unidad">
                <Entrada id="unidad" name="unidad" defaultValue="unid" />
              </Campo>
              <Campo etiqueta="Descripción" htmlFor="descripcion" requerido className="sm:col-span-3">
                <Entrada id="descripcion" name="descripcion" required placeholder="Porta conos de seguridad" />
              </Campo>
            </div>
            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-texto sm:min-h-0">
              <input
                type="checkbox"
                name="incluye_el_accesorio"
                defaultChecked
                className="size-5 accent-[var(--acento)] sm:size-4"
              />
              Se entrega también lo que va adentro
            </label>
            <div className="mt-2 flex items-center justify-between gap-3">
              <Aviso resultado={resultado} />
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Agregar accesorio
              </Boton>
            </div>
          </form>
        )}

        {accesorios.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-texto">Sin accesorios declarados</p>
            <p className="mt-1 text-xs text-texto-suave">
              {puedeEditar
                ? 'Lo que no figura acá no se prometió: el taller no lo monta y el cliente no lo reclama.'
                : 'Los declara Administración mientras la cotización está en costeo.'}
            </p>
            {puedeEditar && !abierto && (
              <div className="mt-4 flex justify-center">
                <Boton tamano="sm" onClick={() => setAbierto(true)}>
                  <Plus aria-hidden className="size-3.5" />
                  Agregar el primero
                </Boton>
              </div>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--borde)]">
            {accesorios.map((a) =>
              editando === a.id ? (
                <li key={a.id} className="py-2">
                  <form
                    action={guardarAccesorio}
                    className="grid gap-2 rounded-[var(--radius-base)] bg-superficie-2 p-3 sm:grid-cols-5"
                  >
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="cotizacion_id" value={cotizacionId} />

                    <Campo etiqueta="Cantidad" htmlFor={`cantidad-${a.id}`} requerido>
                      <Entrada
                        id={`cantidad-${a.id}`}
                        name="cantidad"
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0.5"
                        required
                        defaultValue={Number(a.cantidad)}
                        className="tabular text-right"
                      />
                    </Campo>

                    <Campo etiqueta="Unidad" htmlFor={`unidad-${a.id}`}>
                      <Entrada id={`unidad-${a.id}`} name="unidad" defaultValue={a.unidad} />
                    </Campo>

                    <Campo
                      etiqueta="Descripción"
                      htmlFor={`descripcion-${a.id}`}
                      requerido
                      className="sm:col-span-3"
                    >
                      <Entrada
                        id={`descripcion-${a.id}`}
                        name="descripcion"
                        required
                        autoFocus
                        defaultValue={a.descripcion}
                      />
                    </Campo>

                    <Campo
                      etiqueta="Observación"
                      htmlFor={`observacion-${a.id}`}
                      className="sm:col-span-5"
                    >
                      <Entrada
                        id={`observacion-${a.id}`}
                        name="observacion"
                        defaultValue={a.observacion ?? ''}
                        placeholder="Lo que haya que aclarar de este accesorio"
                      />
                    </Campo>

                    <label className="flex min-h-11 items-center gap-2 text-sm text-texto sm:col-span-5 sm:min-h-0">
                      <input
                        type="checkbox"
                        name="incluye_el_accesorio"
                        defaultChecked={a.incluye_el_accesorio}
                        className="size-5 accent-[var(--acento)] sm:size-4"
                      />
                      Se entrega también lo que va adentro
                    </label>

                    <div className="flex items-center justify-between gap-3 sm:col-span-5">
                      {errorEdicion ? (
                        <p role="alert" className="text-xs text-peligro">
                          {errorEdicion}
                        </p>
                      ) : (
                        <span />
                      )}
                      <span className="flex gap-2">
                        <Boton
                          type="button"
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => {
                            setErrorEdicion(null)
                            setEditando(null)
                          }}
                        >
                          Cancelar
                        </Boton>
                        <Boton type="submit" tamano="sm" cargando={guardando}>
                          Guardar el accesorio
                        </Boton>
                      </span>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={a.id} className="group flex items-center gap-3 py-1.5 text-sm">
                  <span className="tabular w-16 shrink-0 text-right text-texto-suave">
                    {formatearCantidad(a.cantidad)} {a.unidad}
                  </span>
                  <span className="min-w-0 flex-1 text-texto">
                    {a.descripcion}
                    {a.observacion && (
                      <span className="block text-[11px] text-texto-suave">{a.observacion}</span>
                    )}
                  </span>
                  {a.incluye_el_accesorio ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-exito">
                      <Check aria-hidden className="size-3.5" />
                      completo
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] whitespace-nowrap text-aviso">
                      <X aria-hidden className="size-3.5" />
                      solo el soporte
                    </span>
                  )}
                  {puedeEditar && (
                    <span className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => {
                          setErrorEdicion(null)
                          setEditando(a.id)
                        }}
                        aria-label={`Editar ${a.descripcion}`}
                        className="rounded p-3.5 text-texto-tenue hover:text-acento sm:p-1"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      {/* Igual que en las especificaciones: el borrado de un
                          toque se cambió por la pregunta, que dice qué se va. */}
                      <button
                        type="button"
                        onClick={() => setPorQuitar(a)}
                        aria-label={`Quitar ${a.descripcion}`}
                        className="rounded p-3.5 text-texto-tenue hover:text-peligro sm:p-1"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        )}

        {/* Va dentro de la condición: la pregunta nombra el accesorio que se
            pidió quitar, y sin él no hay nada que nombrar. */}
        {porQuitar && (
          <ConfirmarAccion
            abierta
            alCerrar={() => setPorQuitar(null)}
            alConfirmar={confirmarQuitar}
            titulo="¿Quitar el accesorio?"
            detalle={`Se va «${formatearCantidad(porQuitar.cantidad)} ${porQuitar.unidad} · ${porQuitar.descripcion}». Lo que no figura acá no se prometió: el taller no lo monta y el cliente no lo reclama.`}
            etiquetaConfirmar="Sí, quitar el accesorio"
          />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
