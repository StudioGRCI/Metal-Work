'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, TriangleAlert } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { llaveParecido, normalizarCodigo, parecidos, type CodigoFijo, type CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { cn } from '@/lib/utils'

// Los tipos viven en el dominio: las consultas del servidor también los usan.
export type { CodigoFijo, CodigoParaElegir } from '@/lib/dominio/codigos-internos'

/** Cuántos se pintan de una vez. Con cientos de códigos, pintarlos todos traba la lista en el teléfono. */
const TOPE = 50

type Opcion = { codigo: string; detalle: string | null; registrada: boolean }

/**
 * El código interno escrito con ayuda: al tocar el campo sale la lista de los
 * códigos abiertos y, al escribir parte del código o de la unidad —«sr 04»,
 * «volvo», la placa—, quedan los que coinciden. Se elige tocando uno. Lo pidió
 * DKS el 2026-10-20 para Requerimientos: el código se escribía de memoria y
 * cada variante (`SR_O4` con O o con cero) era otro código en el costeo.
 *
 * No es una lista cerrada, pero lo que no está en ella no se envía sin querer:
 * lo escrito para buscar («volvo») se quedaba como código y en el costeo era
 * otra unidad. El formulario no sale hasta que se elige uno de la lista o se
 * confirma «es de una unidad nueva» —la unidad nueva todavía no aparece en
 * ningún documento—, y debajo del campo se ofrece el que se parece o los que
 * coinciden; la confirmación está también al final de la lista. El que el
 * formulario da por bueno (`aceptadoInicial`: el que ya tenía el documento al
 * corregir, o el de la carga anterior) vale como está. El de costeo cerrado no
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
  aceptadoInicial = '',
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
  /**
   * El código que vale aunque no esté en la lista: el que ya tenía el documento
   * al corregirlo, o el de la carga anterior. Nunca lo que se está escribiendo:
   * si el campo se desmonta y vuelve con una búsqueda a medias, esa búsqueda
   * tiene que elegirse o confirmarse otra vez.
   */
  aceptadoInicial?: string
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
  // El que no está en la lista y vale igual: el que el formulario da por bueno, o el nuevo que se confirmó.
  const [aceptado, setAceptado] = useState(() => normalizarCodigo(aceptadoInicial))
  const contenedor = useRef<HTMLDivElement>(null)
  const caja = useRef<HTMLInputElement>(null)

  const deFijos = new Set(fijos.map((f) => f.codigo))
  const deLista = (codigos ?? [])
    .filter((c) => !c.cerrado && !deFijos.has(c.codigo))
    .map((c) => ({ codigo: c.codigo, detalle: c.unidad, registrada: c.registrada }))
  // Primero los fijos, después los de una unidad del padrón y al final los demás
  // que se usaron alguna vez (caja, tareo, salidas…): «los códigos que deben ser».
  const abiertos: Opcion[] = [
    ...fijos.map((f) => ({ codigo: f.codigo, detalle: f.detalle, registrada: false })),
    ...deLista.filter((o) => o.registrada),
    ...deLista.filter((o) => !o.registrada),
  ]
  // Las variantes que ya conviven en el sistema (`PLA_SR_O4…` con O y con cero):
  // cada una avisa de su gemela, y dice cuál es la del padrón de unidades.
  const porCodigo = new Map(abiertos.map((o) => [o.codigo, o]))
  const deGemelos = parecidos(abiertos.map((o) => o.codigo))
  const gemelasDe = (codigo: string) => (deGemelos.get(codigo) ?? []).flatMap((c) => porCodigo.get(c) ?? [])

  // Como todo buscador del sistema: sin tildes, en cualquier orden y la O por
  // cero. Lo escrito igual a un código no filtra: se ve la lista entera, con él marcado.
  const escrito = normalizarCodigo(valor)
  const exacto = abiertos.find((o) => o.codigo === escrito)
  const palabras = exacto ? [] : palabrasDeBusqueda(valor)
  const coincidencias = abiertos.filter((o) => coincide(palabras, [o.codigo, o.detalle]))
  // El elegido va arriba: en la lista entera podía quedar fuera de los que se pintan.
  const ordenadas = exacto ? [exacto, ...coincidencias.filter((o) => o !== exacto)] : coincidencias
  const visibles = ordenadas.slice(0, TOPE)
  const ocultas = ordenadas.length - visibles.length
  const lista = abierto && codigos !== null && abiertos.length > 0
  const cerrado = codigos?.some((c) => c.cerrado && c.codigo === escrito) ?? false
  // Lo escrito no es un código de la lista: una búsqueda a medias o una unidad nueva sin confirmar.
  const sinElegir = codigos !== null && escrito.length > 0 && !exacto && !cerrado && escrito !== aceptado
  // Al final de la lista, la salida de la unidad nueva: sin ella, con la lista
  // abierta y nada que coincida, no había cómo seguir sin cerrarla primero.
  const conNuevo = sinElegir && escrito.length >= 2
  const idNuevo = `${idLista}-nuevo`
  const enNuevo = conNuevo && resaltado === visibles.length
  const idResaltado = lista ? (visibles[resaltado] ? `${idLista}-${resaltado}` : enNuevo ? idNuevo : undefined) : undefined

  // Con las flechas, la resaltada se trae a la vista: la lista mide unas seis
  // opciones y Enter elegía una que no se veía.
  useEffect(() => {
    if (idResaltado) document.getElementById(idResaltado)?.scrollIntoView({ block: 'nearest' })
  }, [idResaltado])

  // Con `required` y `minLength`, la validación del navegador ya para el envío
  // y lleva al campo; esto le suma el caso de lo que no se eligió.
  useEffect(() => {
    caja.current?.setCustomValidity(
      sinElegir ? 'Elige el código de la lista. Si es de una unidad nueva, confírmalo debajo del campo.' : '',
    )
  }, [sinElegir])

  function abrir() {
    setResaltado(-1)
    setAbierto(true)
  }

  function elegir(o: Opcion) {
    onChange(o.codigo)
    setAbierto(false)
    caja.current?.focus()
  }

  function usarNuevo() {
    setAceptado(escrito)
    onChange(escrito)
    setAbierto(false)
    caja.current?.focus()
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto) return abrir()
      setResaltado((i) => Math.min(i + 1, visibles.length - (conNuevo ? 0 : 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setResaltado((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && lista && enNuevo) {
      e.preventDefault()
      usarNuevo()
    } else if (e.key === 'Enter' && lista && (visibles[resaltado] || (!exacto && coincidencias.length === 1))) {
      // Enter elige la resaltada, o la única que coincide con lo escrito; si no,
      // manda el formulario como siempre.
      e.preventDefault()
      elegir(visibles[resaltado] ?? coincidencias[0])
    } else if (e.key === 'Escape' && lista) {
      // Cortado aquí, como en `SeleccionBuscable`: dentro de una Ventana, el
      // Escape seguía subiendo y cerraba el formulario con todo lo escrito. Sin
      // lista a la vista sigue su camino y cierra la ventana.
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
        // Se abre al tocarlo o al escribir, no al recibir el foco: al abrir
        // «Corregir», la ventana pone el foco en el primer campo y la lista
        // tapaba el formulario (y en el teléfono subía el teclado).
        onClick={() => !abierto && abrir()}
        onKeyDown={teclas}
        // Si el envío se para aquí, la lista se cierra: debajo del campo está qué falta.
        onInvalid={() => setAbierto(false)}
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
        aria-controls={lista ? idLista : undefined}
        aria-activedescendant={idResaltado}
        aria-describedby={[descripcion, idEstado].filter(Boolean).join(' ')}
        aria-invalid={invalido || (sinElegir && !lista) || undefined}
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
            <li role="presentation" className="px-3 py-4 text-center text-xs text-texto-suave">
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
                  {o.detalle ? (
                    <span className="line-clamp-2 block text-xs text-texto-suave">{o.detalle}</span>
                  ) : (
                    !deFijos.has(o.codigo) && <span className="block text-xs text-texto-tenue">Sin unidad registrada</span>
                  )}
                  <Gemelas opcion={o} gemelas={gemelasDe(o.codigo)} />
                </span>
              </li>
            )
          })}
          {ocultas > 0 && (
            <li role="presentation" className="px-3 py-2 text-center text-xs text-texto-tenue">
              y {ocultas} más: sigue escribiendo para acotar
            </li>
          )}
          {conNuevo && (
            <li
              id={idNuevo}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setResaltado(visibles.length)}
              onClick={usarNuevo}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-2 border-t border-borde px-3 py-2 text-left text-texto sm:min-h-0 sm:py-1.5',
                enNuevo && 'bg-superficie-2',
              )}
            >
              <Plus aria-hidden className="mt-0.5 size-3.5 shrink-0 text-acento" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Usar <span className="font-mono break-all">{escrito}</span> como código nuevo
                </span>
                <span className="block text-xs text-texto-suave">Solo si es de una unidad que todavía no está en la lista</span>
              </span>
            </li>
          )}
        </ul>
      )}

      <EstadoDelCodigo
        id={idEstado}
        escrito={escrito}
        abierto={lista}
        codigos={codigos}
        opciones={abiertos}
        coincidencias={exacto ? [] : coincidencias}
        gemelas={exacto ? gemelasDe(exacto.codigo) : []}
        sinElegir={sinElegir}
        alElegir={elegir}
        alUsarNuevo={usarNuevo}
      />
    </div>
  )
}

/**
 * El mismo campo con su propio estado, para el formulario que no necesita leer
 * el código mientras se escribe: se manda con el resto, por su `name`.
 */
export function CodigoInternoConLista({
  valorInicial = '',
  ...props
}: Omit<React.ComponentProps<typeof EntradaCodigoInterno>, 'valor' | 'onChange' | 'aceptadoInicial'> & { valorInicial?: string }) {
  const [valor, setValor] = useState(valorInicial)
  // Lo que trae el formulario sale de la base (al corregir) o es un fijo: vale como está.
  return <EntradaCodigoInterno {...props} valor={valor} onChange={setValor} aceptadoInicial={valorInicial} />
}

/**
 * Lo que el campo dice del código escrito: de qué unidad es, o qué elegir
 * cuando lo escrito no es un código de la lista. Mientras la lista está
 * abierta, la lista es la respuesta.
 */
function EstadoDelCodigo({
  id,
  escrito,
  abierto,
  codigos,
  opciones,
  coincidencias,
  gemelas,
  sinElegir,
  alElegir,
  alUsarNuevo,
}: {
  id: string
  escrito: string
  abierto: boolean
  codigos: CodigoParaElegir[] | null
  opciones: Opcion[]
  /** Los de la lista que coinciden con lo escrito como búsqueda («volvo», la placa). */
  coincidencias: Opcion[]
  /** Las casi iguales al elegido, para avisar después de elegir. */
  gemelas: Opcion[]
  sinElegir: boolean
  alElegir: (o: Opcion) => void
  alUsarNuevo: () => void
}) {
  let contenido: React.ReactNode = null
  if (codigos === null) {
    contenido = <span className="text-texto-suave">No se pudo leer la lista de códigos: escríbelo como está en la unidad.</span>
  } else if (escrito.length > 0) {
    const abiertoIgual = opciones.find((o) => o.codigo === escrito)
    const cerrado = codigos.some((c) => c.cerrado && c.codigo === escrito)
    const llave = llaveParecido(escrito)
    // Si lo escrito se parece a varios, primero el del padrón de unidades.
    const parecidas = !abiertoIgual && llave ? opciones.filter((o) => llaveParecido(o.codigo) === llave) : []
    const parecido = parecidas.find((o) => o.registrada) ?? parecidas[0]
    // Pocas coincidencias se ofrecen como botones; muchas, se acotan escribiendo en la lista.
    const ofrecidas = parecido ? [parecido] : coincidencias.length <= 3 ? coincidencias : []
    // Como en la lista: un código tiene al menos dos caracteres, y el que se pone
    // por botón no pasa por el `minLength` del navegador.
    const nuevo =
      escrito.length >= 2 ? (
        <>
          {' '}o, si es de una unidad nueva,{' '}
          <button type="button" onClick={alUsarNuevo} className={ENLACE}>
            usa {escrito} como código nuevo
          </button>
          .
        </>
      ) : (
        '.'
      )
    if (abiertoIgual) {
      contenido = (
        <>
          {abiertoIgual.detalle && <span className="text-texto-suave">{abiertoIgual.detalle}</span>}
          {gemelas.length > 0 && (
            <span className="block text-aviso">
              Ojo: también está{' '}
              {gemelas.map((o, i) => (
                <span key={o.codigo}>
                  {i > 0 && ', '}
                  <button type="button" onClick={() => alElegir(o)} className={cn(ENLACE, 'font-mono')}>
                    {o.codigo}
                  </button>
                  {o.registrada && ' (del padrón de unidades)'}
                </span>
              ))}
              . Revisa que sea este{abiertoIgual.registrada ? ', que es el del padrón' : ''}.
            </span>
          )}
        </>
      )
    } else if (abierto) {
      contenido = null
    } else if (cerrado) {
      contenido = (
        <span className="text-aviso">
          Gerencia ya cerró el costeo de {escrito} al entregar la unidad. Revisa que sea para ese código.
        </span>
      )
    } else if (!sinElegir) {
      contenido = <span className="text-texto-suave">No está en la lista: se registra como está escrito.</span>
    } else if (ofrecidas.length > 0) {
      contenido = (
        <span className="text-aviso">
          {parecido ? 'No está en la lista, pero se parece a ' : 'No es un código. Elige '}
          {ofrecidas.map((o, i) => (
            <span key={o.codigo}>
              {i > 0 && ', '}
              <button type="button" onClick={() => alElegir(o)} className={cn(ENLACE, 'font-mono')}>
                {o.codigo}
              </button>
              {!parecido && o.detalle && <span className="text-texto-suave"> ({o.detalle})</span>}
            </span>
          ))}
          {parecido && ': tócalo si es ese'}
          {nuevo}
        </span>
      )
    } else {
      contenido = (
        <span className="text-aviso">
          No está entre los códigos abiertos. Elígelo de la lista{nuevo}
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

/**
 * En la opción de la lista, el aviso de que hay otra casi igual: Gerencia las
 * junta a mano en «Parecidos a otro», y elegir la buena aquí evita una más.
 */
function Gemelas({ opcion, gemelas }: { opcion: Opcion; gemelas: Opcion[] }) {
  if (gemelas.length === 0) return null
  return (
    // El color va en el ícono: el texto en ámbar no se leía sobre la opción resaltada.
    <span className="mt-0.5 flex items-start gap-1 text-xs text-texto">
      <TriangleAlert aria-hidden className="mt-px size-3 shrink-0 text-aviso" />
      <span>
        {opcion.registrada ? 'Del padrón de unidades. ' : ''}
        Casi igual a {gemelas.map((g) => (g.registrada ? `${g.codigo} (del padrón)` : g.codigo)).join(', ')}
      </span>
    </span>
  )
}

const ENLACE = 'inline-flex min-h-11 items-center font-medium text-acento underline underline-offset-2 sm:min-h-0'
