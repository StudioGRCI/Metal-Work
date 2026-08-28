'use client'

import { useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

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

/** «GRUA» tiene que encontrar «Grúa», y «sac» a «S.A.C.». */
function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[.\-_/]/g, ' ')
    .toLowerCase()
}

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

  const elegida = opciones.find((o) => o.valor === valor) ?? null

  const t = normalizar(filtro.trim())
  const coincidencias = t
    ? opciones.filter((o) => normalizar(`${o.etiqueta} ${o.detalle ?? ''}`).includes(t))
    : opciones
  const visibles = coincidencias.slice(0, TOPE)
  const ocultas = coincidencias.length - visibles.length

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
      className={cn('relative', className)}
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
        campo. Va transparente y de un píxel -no `hidden` ni `display:none`-
        porque un control que no se puede enfocar hace que el navegador se
        niegue a enviar el formulario sin decir por qué.
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
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
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
        aria-label={etiquetaAccesible}
        aria-required={requerido}
        disabled={deshabilitado}
        onClick={() => (abierto ? cerrar(false) : abrir())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter') {
            e.preventDefault()
            abrir()
          }
        }}
        className={cn(
          'flex h-9 w-full items-center rounded-[var(--radius-base)] border border-borde bg-superficie pr-14 pl-3 text-left text-sm',
          'disabled:cursor-not-allowed disabled:opacity-60',
          elegida ? 'text-texto' : 'text-texto-tenue',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{elegida ? elegida.etiqueta : marcador}</span>
      </button>

      {elegida && permiteVaciar && !deshabilitado && (
        <button
          type="button"
          aria-label="Quitar la selección"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-8 -translate-y-1/2 rounded p-0.5 text-texto-tenue hover:bg-superficie-2 hover:text-texto"
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
              className="h-8 w-full rounded-[var(--radius-base)] border border-borde bg-superficie pr-2 pl-8 text-sm text-texto placeholder:text-texto-tenue"
            />
          </div>

          <ul id={idLista} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {visibles.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-texto-suave">
                Nada coincide con lo que escribiste.
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
                    'flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm',
                    i === resaltado ? 'bg-superficie-2' : '',
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
                    <span className="block truncate text-texto">{o.etiqueta}</span>
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
