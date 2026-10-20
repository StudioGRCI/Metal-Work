'use client'

import { useId, useState } from 'react'

import { Entrada } from '@/components/ui/campos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { llaveParecido } from '@/lib/dominio/codigos-internos'
import { cn } from '@/lib/utils'

/** Cuántas sugerencias se ven a la vez: más no caben en el teléfono sobre el teclado. */
const SUGERENCIAS = 8

/**
 * El código interno del reporte: se escribe, y debajo salen los códigos que
 * calzan, enteros, para tocar uno. Busca como «Códigos internos»: sin tildes,
 * por partes («cm n3» encuentra BAR_CM_N3_2_26/4) y con la O igual al 0. Se
 * puede dejar un código que no está en la lista (uno nuevo o PLANTA): la base
 * lo normaliza igual.
 *
 * Reemplaza al `<datalist>`, cuya lista pinta el navegador, cortaba los códigos
 * largos y no buscaba por partes (DKS, 2026-10-20: «mejora el buscador»). Está
 * aislado a propósito: el hilo de Requerimientos arma un selector de código
 * compartido, y cuando llegue se cambia aquí.
 */
export function BuscadorCodigo({
  id,
  codigos,
  valor,
  alCambiar,
  soloLectura = false,
  invalido = false,
}: {
  id: string
  codigos: string[]
  valor: string
  alCambiar: (codigo: string) => void
  soloLectura?: boolean
  invalido?: boolean
}) {
  const lista = useId()
  const [abierta, setAbierta] = useState(false)
  const [activa, setActiva] = useState(-1)

  const texto = valor.trim()
  const palabras = palabrasDeBusqueda(texto)
  const llave = llaveParecido(texto)
  const calzan = (
    texto === '' ? codigos : codigos.filter((c) => coincide(palabras, [c]) || (llave !== '' && llaveParecido(c).includes(llave)))
  )
    // Lo escrito tal cual no se ofrece de vuelta.
    .filter((c) => c.toUpperCase() !== texto.toUpperCase())
    .slice(0, SUGERENCIAS)
  const visible = abierta && !soloLectura && calzan.length > 0

  function elegir(codigo: string) {
    alCambiar(codigo)
    setAbierta(false)
    setActiva(-1)
  }

  return (
    <div className="relative">
      <Entrada
        id={id}
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? lista : undefined}
        aria-autocomplete="list"
        aria-activedescendant={visible && activa >= 0 ? `${lista}-${activa}` : undefined}
        aria-invalid={invalido || undefined}
        required
        minLength={2}
        maxLength={60}
        value={valor}
        readOnly={soloLectura}
        onChange={(e) => {
          alCambiar(e.target.value)
          setAbierta(true)
          setActiva(-1)
        }}
        onFocus={(e) => {
          setAbierta(true)
          // En el teléfono el teclado se come la mitad de abajo: el campo sube
          // arriba para que las sugerencias quepan entre él y el teclado.
          if (window.matchMedia('(max-width: 639px)').matches) e.currentTarget.scrollIntoView({ block: 'start', behavior: 'smooth' })
        }}
        // El toque en una sugerencia llega antes que el blur (onMouseDown), así que cerrar aquí no la pierde.
        onBlur={() => setAbierta(false)}
        onKeyDown={(e) => {
          if (!visible) {
            if (e.key === 'ArrowDown') setAbierta(true)
            return
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const paso = e.key === 'ArrowDown' ? 1 : -1
            setActiva((a) => (a + paso + calzan.length) % calzan.length)
          } else if (e.key === 'Enter' && activa >= 0) {
            e.preventDefault()
            elegir(calzan[activa])
          } else if (e.key === 'Escape') {
            setAbierta(false)
          }
        }}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Escribe parte del código"
        className="scroll-mt-20 font-mono uppercase placeholder:normal-case"
      />
      {visible && (
        <ul
          id={lista}
          role="listbox"
          aria-label="Códigos internos que calzan"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(20rem,40dvh)] overflow-y-auto rounded-lg border border-borde bg-superficie py-1 shadow-lg"
        >
          {calzan.map((c, i) => (
            <li
              key={c}
              id={`${lista}-${i}`}
              role="option"
              aria-selected={i === activa}
              onMouseDown={(e) => {
                e.preventDefault()
                elegir(c)
              }}
              className={cn(
                'flex min-h-11 cursor-pointer items-center px-3 font-mono text-sm break-all text-texto hover:bg-superficie-2',
                i === activa && 'bg-acento-suave',
              )}
            >
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
