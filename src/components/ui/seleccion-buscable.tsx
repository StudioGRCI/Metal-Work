'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { cn } from '@/lib/utils'

export type OpcionBuscable = {
  valor: string
  etiqueta: string
  /** Segunda línea: el RUC del cliente, la marca de la unidad, el código del material. */
  detalle?: string | null
}

/** Cuántas opciones se pintan de una vez. Con los 500 clientes cargados,
 *  pintarlas todas traba el desplegable en el teléfono del taller. */
const TOPE = 80

/**
 * Lista desplegable con buscador. Nace por las listas que crecen —clientes,
 * unidades, materiales, personal—: con doscientas opciones, el desplegable del
 * navegador obliga a rodar la rueda hasta dar con el nombre, y en el teléfono
 * es peor.
 *
 * Manda su valor en un campo oculto, así que dentro de un `<form action={…}>`
 * se comporta igual que el `select` al que reemplaza.
 */
export function SeleccionBuscable({
  name,
  opciones,
  valor,
  onChange,
  marcador = 'Selecciona…',
  marcadorBusqueda = 'Escribe para buscar…',
  requerido,
  deshabilitado,
  id,
  etiquetaAccesible,
  className,
  permiteVaciar = true,
  'aria-describedby': descripcion,
  'aria-invalid': invalido,
}: {
  name?: string
  opciones: OpcionBuscable[]
  valor: string
  onChange: (valor: string) => void
  marcador?: string
  marcadorBusqueda?: string
  requerido?: boolean
  deshabilitado?: boolean
  id?: string
  etiquetaAccesible?: string
  className?: string
  permiteVaciar?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}) {
  const generado = useId()
  const idCampo = id ?? generado
  const idLista = `${idCampo}-lista`

  const [abierto, setAbierto] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [resaltado, setResaltado] = useState(0)

  const contenedor = useRef<HTMLDivElement>(null)
  const disparador = useRef<HTMLButtonElement>(null)
  const caja = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)

  const elegida = opciones.find((o) => o.valor === valor) ?? null
  const conEquis = Boolean(elegida) && permiteVaciar && !deshabilitado

  // Como todo buscador: «grua» encuentra «Grúa», «sac» a «S.A.C.» y
  // «ejemplo agricola» a «Agrícola El Ejemplo».
  const palabras = palabrasDeBusqueda(filtro)
  const coincidencias = opciones.filter((o) => coincide(palabras, [o.etiqueta, o.detalle]))
  const visibles = coincidencias.slice(0, TOPE)
  const ocultas = coincidencias.length - visibles.length

  // Lo mismo que el buscador de códigos (`ElegirCodigo`): en el teléfono el
  // campo suele quedar al fondo de la ventana y el panel se abría por debajo
  // del borde de la pantalla —en la salida del kardex, a 390 px, no se veía
  // ninguno de los vehículos—. Si no cabe en lo visible, el campo sube arriba,
  // y si ni así cabe, la lista se acorta a lo que se ve. Se mira otra vez
  // cuando el teclado aparece o se va y cambia lo visible.
  useEffect(() => {
    if (!abierto) return
    const vista = window.visualViewport
    function acomodar() {
      const ul = listaRef.current
      if (!ul) return
      const visible = vista ? vista.offsetTop + vista.height : window.innerHeight
      ul.style.maxHeight = ''
      if (ul.getBoundingClientRect().bottom > visible) contenedor.current?.scrollIntoView({ block: 'start' })
      const lista = ul.getBoundingClientRect()
      if (lista.bottom > visible) ul.style.maxHeight = `${Math.max(Math.floor(visible - lista.top - 8), 120)}px`
    }
    acomodar()
    vista?.addEventListener('resize', acomodar)
    return () => vista?.removeEventListener('resize', acomodar)
  }, [abierto])

  function abrir() {
    if (deshabilitado) return
    setFiltro('')
    setResaltado(0)
    setAbierto(true)
    // El foco se mueve cuando el panel ya está pintado. Va acá, en el manejador
    // del clic, y no en un efecto: la regla del proyecto no admite estado
    // sincronizado desde useEffect.
    requestAnimationFrame(() => caja.current?.focus())
  }

  function cerrar(devolverFoco = true) {
    setAbierto(false)
    if (devolverFoco) disparador.current?.focus()
  }

  function elegir(opcion: OpcionBuscable) {
    onChange(opcion.valor)
    cerrar()
  }

  function teclas(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setResaltado((i) => Math.min(i + 1, visibles.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opcion = visibles[resaltado]
      if (opcion) elegir(opcion)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      // Se corta acá a propósito: dentro de una Ventana, este mismo Escape
      // seguía subiendo hasta el diálogo y cerraba el formulario entero. Quien
      // abría la lista de clientes, se arrepentía y pulsaba Escape perdía la
      // placa, el chasis y todo lo que llevara escrito.
      e.stopPropagation()
      cerrar()
    }
  }

  return (
    <div
      ref={contenedor}
      // `min-w-0` porque en flexbox un hijo no encoge por debajo de su
      // contenido salvo que se le diga. Al lado de un botón «Nuevo», con una
      // opción larga elegida —«Tolva para volquete (catálogo anterior)»— este
      // desplegable se negaba a ceder, la fila se pasaba del ancho de su columna
      // y el campo de al lado se montaba encima del botón. Se veía como si el
      // botón estuviera tapado; en realidad era esta caja empujándolo fuera.
      className={cn('relative min-w-0', className)}
      onBlur={(e) => {
        // Solo cierra si el foco se fue del componente entero, no al pasar de
        // la caja de búsqueda a una opción.
        if (!contenedor.current?.contains(e.relatedTarget as Node | null)) setAbierto(false)
      }}
    >
      {/*
        El valor viaja en un control de verdad y no en un input oculto: los
        ocultos están exentos de validación, así que un campo obligatorio se
        enviaba vacío y el «falta el material» llegaba desde el servidor, con
        su viaje de ida y vuelta, en lugar del aviso del navegador pegado al
        campo. Va transparente -no `hidden` ni `display:none`- porque un
        control que no se puede enfocar hace que el navegador se niegue a
        enviar el formulario sin decir por qué. Ocupa lo mismo que el botón y
        deja sitio a la cabecera fija: de un píxel al pie, el navegador lo
        subía hasta arriba para su aviso y el campo quedaba tapado.
      */}
      {name && (
        <select
          name={name}
          value={valor}
          required={requerido}
          disabled={deshabilitado}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scroll-mt-24 opacity-0"
        >
          <option value="" />
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
      )}

      <button
        ref={disparador}
        type="button"
        id={idCampo}
        role="combobox"
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-haspopup="listbox"
        title={elegida?.etiqueta}
        aria-label={etiquetaAccesible}
        aria-required={requerido}
        aria-describedby={descripcion}
        aria-invalid={invalido}
        disabled={deshabilitado}
        onClick={() => (abierto ? cerrar(false) : abrir())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault()
            abrir()
          }
        }}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-base)] border py-1 pl-3 text-left text-base transition-colors sm:h-9 sm:min-h-0 sm:py-0 sm:text-sm',
          // Lugar para la flecha y, solo si se dibuja, para la ×: reservarlo
          // siempre dejaba al cliente elegido en «TRANS…» en el teléfono.
          conEquis ? 'pr-20 sm:pr-14' : 'pr-9',
          'disabled:cursor-not-allowed disabled:opacity-60',
          elegida ? 'border-acento bg-acento-suave font-medium text-acento' : 'border-borde-fuerte bg-superficie text-texto-tenue',
        )}
      >
        {elegida && <Check aria-hidden className="size-4 shrink-0" />}
        <span className="line-clamp-2 min-w-0 flex-1 sm:line-clamp-1 sm:truncate">{elegida ? elegida.etiqueta : marcador}</span>
      </button>

      {conEquis && (
        <button
          type="button"
          aria-label="Quitar la selección"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-8 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded text-texto-tenue hover:bg-superficie-2 hover:text-texto sm:right-8 sm:size-auto sm:p-0.5"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}

      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-texto-tenue"
      />

      {abierto && (
        <div className="absolute z-30 mt-1 w-full min-w-56 rounded-[var(--radius-base)] border border-borde bg-superficie shadow-[var(--sombra)]">
          <div className="relative border-b border-borde p-2">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-texto-tenue"
            />
            <input
              ref={caja}
              type="search"
              value={filtro}
              onChange={(e) => {
                setFiltro(e.target.value)
                setResaltado(0)
              }}
              onKeyDown={teclas}
              placeholder={marcadorBusqueda}
              aria-label={marcadorBusqueda}
              aria-controls={idLista}
              className="h-11 w-full rounded-[var(--radius-base)] border border-borde-fuerte bg-superficie pr-2 pl-8 text-base text-texto placeholder:text-texto-tenue sm:h-8 sm:text-sm"
            />
          </div>

          <ul ref={listaRef} id={idLista} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {visibles.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-texto-suave">
                Nada coincide. Prueba con menos palabras o con el número.
              </li>
            )}

            {visibles.map((o, i) => (
              <li key={o.valor}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.valor === valor}
                  onMouseEnter={() => setResaltado(i)}
                  onClick={() => elegir(o)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm sm:min-h-0',
                    o.valor === valor ? 'bg-acento-suave font-medium text-acento' : i === resaltado ? 'bg-superficie-2 text-texto' : 'text-texto',
                  )}
                >
                  <Check
                    aria-hidden
                    className={cn(
                      'mt-0.5 size-3.5 shrink-0',
                      o.valor === valor ? 'text-acento' : 'text-transparent',
                    )}
                  />
                  <span className="min-w-0">
                    {/* Dos renglones y no uno: cortado, «TRANSPORTES PEÑA Y…»
                        salía igual en siete opciones. */}
                    <span className="line-clamp-2">{o.etiqueta}</span>
                    {o.detalle && (
                      <span className="block truncate text-[11px] text-texto-suave">
                        {o.detalle}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}

            {ocultas > 0 && (
              <li className="px-3 py-2 text-center text-[11px] text-texto-tenue">
                y {ocultas} más — sigue escribiendo para acotar
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
