'use client'

import { useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { llaveParecido, normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { cn } from '@/lib/utils'

/** Un código que ofrece la lista: el de la base (`codigos_internos_para_elegir`) con su unidad. */
export type CodigoParaElegir = {
  codigo: string
  /** La placa y la marca y modelo, o el vehículo que anotó la portería; vacío si el sistema no lo sabe. */
  unidad: string | null
  /** Gerencia cerró su costeo al entregar la unidad: no se ofrece, pero se reconoce si alguien lo escribe. */
  cerrado: boolean
}

/** Los que no son de una unidad y van primero: PLANTA en el de operación, OFICINA en el de Administración. */
export type CodigoFijo = { codigo: string; detalle: string }

/** Cuántos se pintan de una vez. Con cientos de códigos, pintarlos todos traba la lista en el teléfono. */
const TOPE = 50

type Opcion = { codigo: string; detalle: string | null }

/**
 * El código interno escrito con ayuda: al tocar el campo sale la lista de los
 * códigos abiertos y, al escribir parte del código o de la unidad —«sr 04»,
 * «volvo», la placa—, quedan los que coinciden. Se elige tocando uno. Lo pidió
 * DKS el 2026-10-20 para Requerimientos: el código se escribía de memoria y
 * cada variante (`SR_O4` con O o con cero) era otro código en el costeo.
 *
 * No es una lista cerrada: un código que no está se puede escribir —la unidad
 * nueva todavía no aparece en ningún documento—, pero el campo avisa al salir
 * de él, y si se parece a uno de la lista, ofrece ese. El de costeo cerrado no
 * se ofrece y, escrito, avisa.
 *
 * Es un `datalist` hecho a mano: el del navegador filtra a su modo (con tildes,
 * sin la O por cero) y en el teléfono sale distinto en cada marca.
 */
export function EntradaCodigoInterno({
  id,
  name,
  valor,
  onChange,
  codigos,
  fijos = [],
  requerido,
  'aria-describedby': descripcion,
  'aria-invalid': invalido,
}: {
  id?: string
  name?: string
  valor: string
  onChange: (valor: string) => void
  /** `null` si la lista no se pudo leer: el campo queda para escribir. */
  codigos: CodigoParaElegir[] | null
  fijos?: CodigoFijo[]
  requerido?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
}) {
  const generado = useId()
  const idCampo = id ?? generado
  const idLista = `${idCampo}-lista`
  const idEstado = `${idCampo}-estado`

  const [abierto, setAbierto] = useState(false)
  const [resaltado, setResaltado] = useState(-1)
  const contenedor = useRef<HTMLDivElement>(null)
  const caja = useRef<HTMLInputElement>(null)

  const deFijos = new Set(fijos.map((f) => f.codigo))
  const abiertos: Opcion[] = [
    ...fijos.map((f) => ({ codigo: f.codigo, detalle: f.detalle })),
    ...(codigos ?? []).filter((c) => !c.cerrado && !deFijos.has(c.codigo)).map((c) => ({ codigo: c.codigo, detalle: c.unidad })),
  ]

  // Como todo buscador del sistema: sin tildes, en cualquier orden y la O por
  // cero. Lo escrito igual a un código no filtra: se ve la lista entera, con él marcado.
  const escrito = normalizarCodigo(valor)
  const exacto = abiertos.find((o) => o.codigo === escrito)
  const palabras = exacto ? [] : palabrasDeBusqueda(valor)
  const coincidencias = abiertos.filter((o) => coincide(palabras, [o.codigo, o.detalle]))
  const visibles = coincidencias.slice(0, TOPE)
  const ocultas = coincidencias.length - visibles.length
  const lista = abierto && codigos !== null && abiertos.length > 0

  function abrir() {
    setResaltado(-1)
    setAbierto(true)
  }

  function elegir(o: Opcion) {
    onChange(o.codigo)
    setAbierto(false)
    caja.current?.focus()
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto) return abrir()
      setResaltado((i) => Math.min(i + 1, visibles.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && lista && visibles[resaltado]) {
      // Con una opción resaltada, Enter la elige; sin ella, manda el formulario como siempre.
      e.preventDefault()
      elegir(visibles[resaltado])
    } else if (e.key === 'Escape' && abierto) {
      // Cortado aquí, como en `SeleccionBuscable`: dentro de una Ventana, el
      // Escape seguía subiendo y cerraba el formulario con todo lo escrito.
      e.preventDefault()
      e.stopPropagation()
      setAbierto(false)
    }
  }

  return (
    <div
      ref={contenedor}
      className="relative min-w-0"
      onBlur={(e) => {
        if (!contenedor.current?.contains(e.relatedTarget as Node | null)) setAbierto(false)
      }}
    >
      <Entrada
        ref={caja}
        id={idCampo}
        name={name}
        value={valor}
        onChange={(e) => {
          onChange(e.target.value)
          setResaltado(-1)
          setAbierto(true)
        }}
        onFocus={abrir}
        onClick={() => !abierto && abrir()}
        onKeyDown={teclas}
        required={requerido}
        minLength={2}
        maxLength={60}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder={codigos === null ? undefined : 'Escribe el código o la unidad'}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={lista}
        aria-controls={idLista}
        aria-activedescendant={lista && visibles[resaltado] ? `${idLista}-${resaltado}` : undefined}
        aria-describedby={[descripcion, idEstado].filter(Boolean).join(' ')}
        aria-invalid={invalido}
        className="pr-9 font-mono uppercase placeholder:font-sans placeholder:normal-case"
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-texto-tenue" />

      {lista && (
        <ul
          id={idLista}
          role="listbox"
          aria-label="Códigos internos abiertos"
          className="absolute z-30 mt-1 max-h-72 w-full min-w-56 overflow-y-auto rounded-[var(--radius-base)] border border-borde bg-superficie py-1 shadow-[var(--sombra)]"
        >
          {visibles.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-texto-suave">
              Ningún código abierto coincide. Prueba con menos letras, con la placa o con la marca.
            </li>
          )}
          {visibles.map((o, i) => {
            const elegida = o.codigo === escrito
            return (
              <li
                key={o.codigo}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={elegida}
                // El foco se queda en la caja: si pasara a la opción, el blur cerraría la lista antes del clic.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setResaltado(i)}
                onClick={() => elegir(o)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-start gap-2 px-3 py-2 text-left sm:min-h-0 sm:py-1.5',
                  elegida ? 'bg-acento-suave text-acento' : i === resaltado ? 'bg-superficie-2 text-texto' : 'text-texto',
                )}
              >
                <Check aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', elegida ? 'text-acento' : 'text-transparent')} />
                <span className="min-w-0">
                  <span className="block font-mono text-sm font-medium break-all">{o.codigo}</span>
                  {o.detalle && <span className="line-clamp-2 block text-[11px] text-texto-suave">{o.detalle}</span>}
                </span>
              </li>
            )
          })}
          {ocultas > 0 && (
            <li className="px-3 py-2 text-center text-[11px] text-texto-tenue">
              y {ocultas} más: sigue escribiendo para acotar
            </li>
          )}
        </ul>
      )}

      <EstadoDelCodigo id={idEstado} escrito={escrito} abierto={lista} codigos={codigos} opciones={abiertos} alElegir={elegir} />
    </div>
  )
}

/**
 * Lo que el campo dice del código escrito: de qué unidad es, o por qué conviene
 * revisarlo. Mientras la lista está abierta, la lista es la respuesta.
 */
function EstadoDelCodigo({
  id,
  escrito,
  abierto,
  codigos,
  opciones,
  alElegir,
}: {
  id: string
  escrito: string
  abierto: boolean
  codigos: CodigoParaElegir[] | null
  opciones: Opcion[]
  alElegir: (o: Opcion) => void
}) {
  let contenido: React.ReactNode = null
  if (codigos === null) {
    contenido = <span className="text-texto-suave">No se pudo leer la lista de códigos: escríbelo como está en la unidad.</span>
  } else if (escrito.length >= 2) {
    const abiertoIgual = opciones.find((o) => o.codigo === escrito)
    const cerrado = codigos.find((c) => c.cerrado && c.codigo === escrito)
    const llave = llaveParecido(escrito)
    const parecido = !abiertoIgual && llave ? opciones.find((o) => llaveParecido(o.codigo) === llave) : undefined
    if (abiertoIgual) {
      contenido = abiertoIgual.detalle ? <span className="text-texto-suave">{abiertoIgual.detalle}</span> : null
    } else if (abierto) {
      contenido = null
    } else if (cerrado) {
      contenido = (
        <span className="text-aviso">
          Gerencia ya cerró el costeo de {escrito} al entregar la unidad. Revisa que el pedido sea para ese código.
        </span>
      )
    } else if (parecido) {
      contenido = (
        <span className="text-aviso">
          No está en la lista, pero se parece a{' '}
          <button
            type="button"
            onClick={() => alElegir(parecido)}
            className="inline-flex min-h-11 items-center font-mono font-medium text-acento underline underline-offset-2 sm:min-h-0"
          >
            {parecido.codigo}
          </button>
          : tócalo si es ese.
        </span>
      )
    } else {
      contenido = (
        <span className="text-aviso">
          No está entre los códigos abiertos. Revisa que esté bien escrito: si es de una unidad nueva, se registra igual.
        </span>
      )
    }
  }
  return (
    <p id={id} aria-live="polite" className="mt-1 text-xs empty:hidden">
      {contenido}
    </p>
  )
}
