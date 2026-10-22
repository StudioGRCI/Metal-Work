'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, TriangleAlert } from 'lucide-react'

import { Entrada } from '@/components/ui/campos'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import {
  CODIGOS_FIJOS,
  llaveParecido,
  normalizarCodigo,
  parecidos,
  type CodigoFijo,
  type CodigoParaElegir,
} from '@/lib/dominio/codigos-internos'
import { cn } from '@/lib/utils'

// Los tipos viven en el dominio: las consultas del servidor también los usan.
export type { CodigoFijo, CodigoParaElegir } from '@/lib/dominio/codigos-internos'

/** Cuántos se pintan de una vez. Con cientos de códigos, pintarlos todos traba la lista en el teléfono. */
const TOPE = 50

/**
 * Solo las letras y los números, para comparar con los vetados: un espacio de
 * ancho cero pegado desde Excel no hace de OFICINA otro código. La base mira lo
 * mismo (migración 20261020196000).
 */
const llave = (codigo: string) => codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** PLANTA y OFICINA dicen qué son también en el formulario que no los pone arriba. */
const DETALLE_FIJO = new Map(CODIGOS_FIJOS.map((f) => [f.codigo, f.detalle]))

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
  alAceptarNuevo,
  codigos,
  fijos = [],
  vetados,
  reconocidos,
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
  /**
   * Al confirmar un código nuevo: el formulario que desmonta el campo (la
   * salida, al ir a «Vehículo registrado» y volver) lo guarda y se lo devuelve
   * en `aceptadoInicial`, o la confirmación se perdía.
   */
  alAceptarNuevo?: (codigo: string) => void
  /** `null` si la lista no se pudo leer: el campo queda para escribir. */
  codigos: CodigoParaElegir[] | null
  fijos?: CodigoFijo[]
  /**
   * Los códigos que este formulario no acepta, cada grupo con su porqué: un
   * accesorio no sale a PLANTA, ni hacia la placa de un vehículo sin código
   * interno. No se ofrecen, ni como fijos ni como código nuevo, y escritos (o
   * traídos en `aceptadoInicial`) dicen el motivo y no dejan enviar. Se
   * comparan por letras y números («Todos  los activos»), o tal cual con
   * `exacto` (una placa: así no esconde el código que se le parece). Lo de
   * `ofrecer` sale como botón debajo del motivo.
   */
  vetados?: readonly { codigos: readonly string[]; motivo: string; exacto?: boolean; ofrecer?: readonly string[] }[]
  /**
   * Lo escrito que este formulario sabe de quién es aunque no esté en la lista:
   * en la salida del kardex, la placa de un vehículo registrado. Vale sin
   * confirmarlo como código nuevo, y el campo dice adónde va: decía «se
   * registra como está escrito» y la base lo vinculaba al vehículo. Lo de
   * `ofrecer` sale como botón debajo.
   */
  reconocidos?: readonly { codigos: readonly string[]; texto: React.ReactNode; ofrecer?: readonly string[] }[]
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
  // Abierta al escribir, la lista filtra también lo escrito igual a un código;
  // abierta con un toque o la flecha, sin escribir, trae la lista entera.
  const [escribiendo, setEscribiendo] = useState(false)
  // El que no está en la lista y vale igual: el que el formulario da por bueno, o el nuevo que se confirmó.
  const [aceptado, setAceptado] = useState(() => normalizarCodigo(aceptadoInicial))
  const contenedor = useRef<HTMLDivElement>(null)
  const caja = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)
  // La lista se desplaza hacia la resaltada solo si se movió con las flechas: con
  // el ratón encima, desplazarla la corría en contra de la rueda.
  const porTeclado = useRef(false)

  const vetoDe = (codigo: string) =>
    vetados?.find((g) => g.codigos.some((v) => (g.exacto ? normalizarCodigo(v) === normalizarCodigo(codigo) : llave(v) === llave(codigo))))
  const motivoDe = (codigo: string) => vetoDe(codigo)?.motivo ?? null
  const vetado = (codigo: string) => motivoDe(codigo) !== null
  const fijosQueValen = fijos.filter((f) => !vetado(f.codigo))
  const deFijos = new Set(fijosQueValen.map((f) => f.codigo))
  const deLista = (codigos ?? [])
    .filter((c) => !c.cerrado && !deFijos.has(c.codigo) && !vetado(c.codigo))
    .map((c) => ({ codigo: c.codigo, detalle: c.unidad ?? DETALLE_FIJO.get(c.codigo) ?? null, registrada: c.registrada }))
  // Primero los fijos, después los de una unidad del padrón y al final los demás
  // que se usaron alguna vez (caja, tareo, salidas…): «los códigos que deben ser».
  const abiertos: Opcion[] = [
    ...fijosQueValen.map((f) => ({ codigo: f.codigo, detalle: f.detalle, registrada: false })),
    ...deLista.filter((o) => o.registrada),
    ...deLista.filter((o) => !o.registrada),
  ]
  // Las variantes que ya conviven en el sistema (`PLA_SR_O4…` con O y con cero):
  // cada una avisa de su gemela, y dice cuál es la del padrón de unidades.
  const porCodigo = new Map(abiertos.map((o) => [o.codigo, o]))
  const deGemelos = parecidos(abiertos.map((o) => o.codigo))
  const gemelasDe = (codigo: string) => (deGemelos.get(codigo) ?? []).flatMap((c) => porCodigo.get(c) ?? [])

  // Como todo buscador del sistema: sin tildes, en cualquier orden y la O por
  // cero. Lo escrito igual a un código no filtra si la lista se abrió con un
  // toque: se ve entera, con él marcado, para cambiarlo. Al escribirlo, sí: al
  // completar el código la lista pasaba de dos opciones al catálogo entero,
  // tapaba el campo que sigue y el clic en él elegía otro código (la salida del
  // kardex a 1440 × 900, «Nombre de quien recibe», 2026-10-22).
  const escrito = normalizarCodigo(valor)
  // Uno que este formulario no acepta: vale más que «aceptado», que puede venir de la carga anterior.
  const rechazado = motivoDe(escrito)
  const grupoReconocido = rechazado ? undefined : reconocidos?.find((g) => g.codigos.some((v) => normalizarCodigo(v) === escrito))
  const reconocido = grupoReconocido?.texto ?? null
  const exacto = abiertos.find((o) => o.codigo === escrito)
  // Lo reconocido filtra como una búsqueda: la placa de un vehículo con código
  // que también está en la lista abría el catálogo entero, desde PLANTA, y no el
  // código al que va la salida.
  const palabras = exacto && !reconocido && !escribiendo ? [] : palabrasDeBusqueda(valor)
  const coincidencias = abiertos.filter((o) => coincide(palabras, [o.codigo, o.detalle]))
  // El elegido va arriba: en la lista entera podía quedar fuera de los que se
  // pintan. Lo reconocido no: la placa de un vehículo con código puede estar en
  // la lista, y la salida va al código del vehículo, no a ella.
  const marcado = reconocido ? undefined : exacto
  // Escrito entero, la lista trae solo ese: con su casi igual debajo, tapaba el
  // campo que sigue y el clic en él elegía el otro (A30G-7E60 y A30G_7E60, en la
  // salida a 1440 × 900). El casi igual se dice en la opción y debajo del campo.
  const ordenadas = marcado && escribiendo ? [marcado] : marcado ? [marcado, ...coincidencias.filter((o) => o !== marcado)] : coincidencias
  const visibles = ordenadas.slice(0, TOPE)
  const ocultas = ordenadas.length - visibles.length
  const lista = abierto && codigos !== null && abiertos.length > 0
  const cerrado = codigos?.some((c) => c.cerrado && c.codigo === escrito) ?? false
  // Buscado a medias («ofi», «oficinas»), la lista no lo trae: dice por qué, en
  // vez de solo «ningún código coincide» y la invitación a crearlo como nuevo.
  const buscado = llave(escrito)
  // Lo que el motivo o el texto proponen elegir, si está entre los abiertos.
  const ofrecidos = ((rechazado ? vetoDe(escrito)?.ofrecer : grupoReconocido?.ofrecer) ?? [])
    .flatMap((c) => abiertos.find((o) => o.codigo === normalizarCodigo(c)) ?? [])
  // El aviso de lo buscado a medias es para los que se esquivan escribiéndolos
  // de otra manera, no para una placa.
  const aviso = !rechazado && !reconocido && buscado.length >= 3
    ? vetados?.find((g) => !g.exacto && g.codigos.some((v) => llave(v).startsWith(buscado) || buscado.startsWith(llave(v))))?.motivo ?? null
    : null
  // Lo escrito no es un código de la lista: una búsqueda a medias o una unidad nueva sin confirmar.
  const sinElegir = !rechazado && !reconocido && codigos !== null && escrito.length > 0 && !exacto && !cerrado && escrito !== aceptado
  // Al final de la lista, la salida de la unidad nueva: sin ella, con la lista
  // abierta y nada que coincida, no había cómo seguir sin cerrarla primero.
  const conNuevo = sinElegir && escrito.length >= 2
  const idNuevo = `${idLista}-nuevo`
  const enNuevo = conNuevo && resaltado === visibles.length
  const idResaltado = lista ? (visibles[resaltado] ? `${idLista}-${resaltado}` : enNuevo ? idNuevo : undefined) : undefined

  // Con las flechas, la resaltada se trae a la vista: la lista mide unas seis
  // opciones y Enter elegía una que no se veía.
  useEffect(() => {
    if (!porTeclado.current) return
    porTeclado.current = false
    if (idResaltado) document.getElementById(idResaltado)?.scrollIntoView({ block: 'nearest' })
  }, [idResaltado])

  // En el teléfono el campo suele quedar al fondo, y la lista se abría por
  // debajo del borde de la pantalla o detrás del teclado: en Observaciones se
  // veía una sola opción. Lo visible termina donde termina la pantalla (sin el
  // teclado) y, dentro de una ventana, donde termina lo que rueda: ahí la lista
  // pasaba el borde de la ventana y quedaba cortada (la salida del kardex,
  // 2026-10-21). Si la lista no cabe debajo y arriba hay más lugar, se abre
  // hacia arriba; si no, se acorta. Dentro de una ventana no se rueda nada: la
  // lista hacía rodar la ventana, al cerrarse con el clic en un botón de más
  // abajo la ventana volvía, el botón se corría antes de soltarlo y el clic se
  // perdía (Observaciones, 2026-10-22, también en un portátil de 1366 × 768).
  // Solo si ni arriba ni abajo quedan 120 px el campo sube arriba. En una
  // página, lo visible descuenta la barra de arriba y la de abajo del teléfono,
  // que son fijas, como en `SeleccionBuscable`; hoy los once formularios que lo
  // usan están en una ventana.
  // Se mira otra vez cuando el teclado aparece o se va, y al escribir: lo de
  // arriba del campo crece con lo escrito (en la salida, para quién es el
  // material) y empujaba el final de la lista afuera.
  useEffect(() => {
    if (!lista) return
    const vista = window.visualViewport
    function acomodar() {
      const ul = listaRef.current
      const campo = contenedor.current
      if (!ul || !campo) return
      let techo = vista ? vista.offsetTop : 0
      let piso = vista ? vista.offsetTop + vista.height : window.innerHeight
      const suelta = !campo.closest('[role="dialog"]')
      if (suelta) {
        const barra = document.querySelector('header')?.getBoundingClientRect()
        const pie = document.querySelector('[data-barra-inferior]')?.getBoundingClientRect()
        if (barra && barra.height > 0) techo = Math.max(techo, barra.bottom)
        if (pie && pie.height > 0) piso = Math.min(piso, pie.top)
      }
      for (let p = campo.parentElement; p && p !== document.body; p = p.parentElement) {
        const { overflowY } = getComputedStyle(p)
        if (overflowY === 'auto' || overflowY === 'scroll') {
          const borde = p.getBoundingClientRect()
          techo = Math.max(techo, borde.top)
          piso = Math.min(piso, borde.bottom)
          break
        }
      }
      Object.assign(ul.style, { maxHeight: '', top: '', bottom: '', marginTop: '', marginBottom: '' })
      const medir = () => {
        const caja = ul.getBoundingClientRect()
        return { caja, abajo: Math.floor(piso - caja.top - 8), arriba: Math.floor(campo.getBoundingClientRect().top - techo - 8) }
      }
      let { caja, abajo, arriba } = medir()
      if (caja.bottom <= piso) return
      if (Math.max(abajo, arriba) < 120) {
        campo.style.scrollMarginTop = suelta ? `${Math.ceil(techo - (vista ? vista.offsetTop : 0)) + 8}px` : ''
        campo.scrollIntoView({ block: 'start' })
        ;({ caja, abajo, arriba } = medir())
        if (caja.bottom <= piso) return
      }
      if (abajo >= 160 || abajo >= arriba) {
        ul.style.maxHeight = `${Math.max(abajo, 120)}px`
      } else {
        Object.assign(ul.style, { top: 'auto', bottom: '100%', marginTop: '0', marginBottom: '0.25rem' })
        if (caja.height > arriba) ul.style.maxHeight = `${Math.max(arriba, 120)}px`
      }
    }
    acomodar()
    vista?.addEventListener('resize', acomodar)
    return () => vista?.removeEventListener('resize', acomodar)
  }, [lista, escrito])

  // Con `required` y `minLength`, la validación del navegador ya para el envío
  // y lleva al campo; esto le suma el caso de lo que no se eligió.
  useEffect(() => {
    caja.current?.setCustomValidity(
      rechazado ?? (sinElegir ? 'Elige el código de la lista. Si es de una unidad nueva, confírmalo debajo del campo.' : ''),
    )
  }, [rechazado, sinElegir])

  function abrir() {
    setResaltado(-1)
    setEscribiendo(false)
    setAbierto(true)
  }

  function elegir(o: Opcion) {
    onChange(o.codigo)
    setAbierto(false)
    caja.current?.focus()
  }

  function usarNuevo() {
    setAceptado(escrito)
    alAceptarNuevo?.(escrito)
    onChange(escrito)
    setAbierto(false)
    caja.current?.focus()
  }

  function teclas(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!abierto) return abrir()
      porTeclado.current = true
      setResaltado((i) => Math.min(i + 1, visibles.length - (conNuevo ? 0 : 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      porTeclado.current = true
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
      className="relative min-w-0 scroll-mt-2"
      onBlur={(e) => {
        if (!contenedor.current?.contains(e.relatedTarget as Node | null)) setAbierto(false)
      }}
    >
      {/* La flecha se centra en el campo, no en el bloque, que lleva debajo lo que dice del código. */}
      <div className="relative">
        <Entrada
          ref={caja}
          id={idCampo}
          name={name}
          value={valor}
          onChange={(e) => {
            onChange(e.target.value)
            setResaltado(-1)
            setEscribiendo(true)
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
          // Corto: en la caja diaria el campo mide 227 px y «Escribe el código o la unidad» salía cortado.
          placeholder={codigos === null ? undefined : 'Código, placa o marca'}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={lista}
          aria-controls={lista ? idLista : undefined}
          aria-activedescendant={idResaltado}
          aria-describedby={[descripcion, idEstado].filter(Boolean).join(' ')}
          aria-invalid={invalido || ((sinElegir || rechazado !== null) && !lista) || undefined}
          className="pr-9 font-mono uppercase placeholder:font-sans placeholder:normal-case"
        />
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-texto-tenue" />
      </div>

      {lista && (
        <ul
          ref={listaRef}
          id={idLista}
          role="listbox"
          aria-label="Códigos internos abiertos"
          // Fuera del orden del Tab: Chromium entra a una lista que rueda, y con un
          // código igual escrito (la lista entera) el Tab se quedaba en ella, abierta,
          // sin pasar al campo siguiente ni decir debajo adónde va la salida.
          tabIndex={-1}
          // Y el clic en lo que no es opción (el aviso de arriba, «y N más») no le
          // quita el foco al campo: se lo llevaba la lista, lo escrito ya no
          // entraba y el Escape cerraba la ventana entera con todo lo escrito.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 mt-1 max-h-72 w-full min-w-56 overflow-y-auto rounded-[var(--radius-base)] border border-borde bg-superficie py-1 shadow-[var(--sombra)]"
        >
          {rechazado || aviso || reconocido ? (
            <li role="presentation" className={cn('px-3 py-3 text-xs', rechazado ? 'text-peligro' : aviso ? 'text-aviso' : 'text-texto-suave')}>
              {rechazado ?? aviso ?? reconocido}
            </li>
          ) : (
            visibles.length === 0 && (
              <li role="presentation" className="px-3 py-4 text-center text-xs text-texto-suave">
                Ningún código abierto coincide. Prueba con menos letras, con la placa o con la marca.
              </li>
            )
          )}
          {visibles.map((o, i) => {
            const elegida = o === marcado
            return (
              <li
                key={o.codigo}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={elegida}
                // El foco se queda en la caja: si pasara a la opción, el blur cerraría la lista antes del clic.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  porTeclado.current = false
                  setResaltado(i)
                }}
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
                    <span className="line-clamp-2 text-xs text-texto-suave">{o.detalle}</span>
                  ) : (
                    !o.registrada && <span className="block text-xs text-texto-tenue">Sin unidad registrada</span>
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
              onMouseEnter={() => {
                porTeclado.current = false
                setResaltado(visibles.length)
              }}
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
        rechazado={rechazado}
        aviso={aviso}
        reconocido={reconocido}
        ofrecidos={ofrecidos}
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
 * cuando lo escrito no es un código de la lista. Con la lista abierta, la lista
 * es la respuesta: esto se queda debajo, invisible, ocupando su lugar.
 */
function EstadoDelCodigo({
  id,
  escrito,
  abierto,
  codigos,
  opciones,
  coincidencias,
  gemelas,
  rechazado,
  aviso,
  reconocido,
  ofrecidos,
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
  /** Por qué este formulario no acepta lo escrito; `null` si lo acepta. */
  rechazado: string | null
  /** Por qué lo buscado a medias no sale en la lista, si se parece a uno que no se acepta. */
  aviso: string | null
  /** Adónde va lo escrito que el formulario reconoce sin estar en la lista (la placa de un vehículo). */
  reconocido: React.ReactNode
  /** Los que el motivo del rechazo o lo reconocido proponen elegir. */
  ofrecidos: Opcion[]
  sinElegir: boolean
  alElegir: (o: Opcion) => void
  alUsarNuevo: () => void
}) {
  // Lo que se lee va en el párrafo; lo que se toca, debajo, una salida por renglón.
  let texto: React.ReactNode = null
  let salidas: React.ReactNode = null
  if (codigos === null) {
    texto = <span className="text-texto-suave">No se pudo leer la lista de códigos: escríbelo como está en la unidad.</span>
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
    const nuevo = escrito.length >= 2 && (
      <button type="button" onClick={alUsarNuevo} className={SALIDA}>
        {/* Es la salida de último recurso: no pesa lo mismo que los códigos de la lista. */}
        <span className="text-texto-suave underline underline-offset-2">
          Usar <span className="font-mono break-all">{escrito}</span> como código nuevo
        </span>
        <span className="font-normal text-texto-suave">(unidad nueva)</span>
      </button>
    )
    if (rechazado) {
      // Antes que todo: no se ofrece como código nuevo.
      texto = <span className="text-peligro">{rechazado}</span>
      if (ofrecidos.length > 0) salidas = <Ofrecidos ofrecidos={ofrecidos} alElegir={alElegir} />
    } else if (reconocido) {
      // Antes que el de la lista: la placa de un vehículo con código puede estar
      // en ella (el código que tuvo cuando no lo tenía), y la salida va al suyo.
      texto = <span className="text-texto-suave">{reconocido}</span>
      if (ofrecidos.length > 0) salidas = <Ofrecidos ofrecidos={ofrecidos} alElegir={alElegir} />
    } else if (abiertoIgual) {
      texto = (
        <>
          {abiertoIgual.detalle && <span className="block text-texto-suave">{abiertoIgual.detalle}</span>}
          {gemelas.length > 0 && (
            <span className="block text-aviso">
              Ojo: hay {gemelas.length === 1 ? 'otro casi igual' : 'otros casi iguales'}. Revisa que sea este
              {abiertoIgual.registrada ? ', que es el del padrón' : ''}.
            </span>
          )}
        </>
      )
      if (gemelas.length > 0) {
        salidas = gemelas.map((o) => (
          <button key={o.codigo} type="button" onClick={() => alElegir(o)} className={SALIDA}>
            <span className={SUBRAYADO}>
              Cambiar a <span className="font-mono break-all">{o.codigo}</span>
            </span>
            {(o.registrada || abiertoIgual.registrada) && (
              <span className="font-normal text-texto-suave">{o.registrada ? '(del padrón de unidades)' : '(no está en el padrón)'}</span>
            )}
          </button>
        ))
      }
    } else if (cerrado) {
      texto = (
        <span className="text-aviso">
          Gerencia ya cerró el costeo de {escrito} al entregar la unidad. Revisa que sea para ese código.
        </span>
      )
    } else if (!sinElegir) {
      texto = <span className="text-texto-suave">No está en la lista: se registra como está escrito.</span>
    } else if (ofrecidas.length > 0) {
      texto = (
        <span className="text-aviso">
          {parecido ? 'No está en la lista, pero se parece a uno que sí: tócalo si es ese.' : 'No es un código. Elige uno:'}
        </span>
      )
      salidas = (
        <>
          {ofrecidas.map((o) => (
            <button key={o.codigo} type="button" onClick={() => alElegir(o)} className={SALIDA}>
              <span className={cn(SUBRAYADO, 'font-mono break-all')}>{o.codigo}</span>
              {o.detalle && <span className="font-normal text-texto-suave">({o.detalle})</span>}
            </button>
          ))}
          {nuevo}
        </>
      )
    } else {
      texto = (
        <span className="text-aviso">
          No está entre los códigos abiertos. Elígelo de la lista{nuevo ? ' o, si es de una unidad nueva, confírmalo:' : '.'}
        </span>
      )
      salidas = nuevo
    }
  }
  // Con la lista abierta, lo de debajo del campo está igual, pero invisible: la
  // lista lo tapa y lo dice ella. Si cambiara al cerrarla, el clic en un botón
  // de más abajo cerraba la lista, el botón se corría antes de soltarlo y el
  // clic se perdía (los «Cambiar a» que aparecían en la caja diaria,
  // 2026-10-22). Y con sus botones invisibles, el Tab pasa al campo siguiente y
  // no cae en uno tapado por la lista, ni en «Usar … como código nuevo».
  return (
    <div id={id} aria-live="polite" className={cn('mt-1 text-xs empty:hidden', abierto && 'invisible')}>
      {aviso && <p className="text-aviso">{aviso}</p>}
      {texto && <p>{texto}</p>}
      {/* Con aire arriba: el anillo del foco de una salida pisaba la línea del aviso. */}
      {salidas && <div className="mt-1.5 flex flex-col items-start sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1">{salidas}</div>}
    </div>
  )
}

/** Los códigos que el motivo o el texto del campo proponen, para tocarlos. */
function Ofrecidos({ ofrecidos, alElegir }: { ofrecidos: Opcion[]; alElegir: (o: Opcion) => void }) {
  return ofrecidos.map((o) => (
    <button key={o.codigo} type="button" onClick={() => alElegir(o)} className={SALIDA}>
      <span className={SUBRAYADO}>
        Cambiar a <span className="font-mono break-all">{o.codigo}</span>
      </span>
      {o.detalle && <span className="font-normal text-texto-suave">({o.detalle})</span>}
    </button>
  ))
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

// En el teléfono cada salida es un renglón propio de 44 px: dentro del párrafo,
// el área de toque agrandada de una pisaba el texto de la de arriba y el campo,
// y tocar la gemela elegía «usar como código nuevo» (auditoría del 2026-10-20).
const SALIDA = 'inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-1 text-left font-medium sm:min-h-0'
const SUBRAYADO = 'text-acento underline underline-offset-2'
