'use client'

import { Check, ClipboardCheck, PackageCheck, PackageX, ShoppingCart } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { InsumoPorSacar } from '@/lib/datos/kardex'
import type { MaterialParaRequerimiento } from '@/lib/datos/requerimientos'
import { redondearCantidad, topeDeCantidad } from '@/lib/dominio/almacen'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { useEnvio } from '@/lib/envio'
import { cantidad as formatoCantidad } from '@/lib/format'
import { cn } from '@/lib/utils'

import { entregarConFaltante, marcarPasoRequerimiento, revisarStockRequerimiento } from './acciones'
import { useAvisar } from './avisos'

type Paso = 'listo' | 'en_atencion' | 'entregado'

const PASO = {
  listo: {
    texto: 'Listo en almacén',
    icono: PackageCheck,
    variante: 'primario' as const,
    titulo: 'Listo en almacén',
    descripcion: 'Llegó lo que faltaba. Al supervisor del área le llega el aviso para que venga a recogerlo.',
    nota: 'Dónde está o qué llegó (opcional)',
    ejemplo: 'Por ejemplo: estante B, 3 planchas. Llegó con el conductor.',
    boton: 'Dejar listo',
  },
  en_atencion: {
    texto: 'Lo estoy comprando',
    icono: ShoppingCart,
    variante: 'primario' as const,
    titulo: 'Lo compro',
    descripcion: 'Queda «En compra». La orden de compra sale con «Generar OC»; Almacén lo recepciona cuando llegue.',
    nota: 'Con quién o cuándo (opcional)',
    ejemplo: 'Por ejemplo: cotizando con Aceros Arequipa, llega el jueves.',
    boton: 'Marcar en compra',
  },
  entregado: {
    texto: 'Entregado',
    icono: Check,
    variante: 'primario' as const,
    titulo: 'Entregar al área',
    descripcion: 'Cierra el requerimiento. Anota quién lo recogió: es lo que después se cruza con el formato firmado.',
    nota: 'Quién lo recogió',
    ejemplo: 'Por ejemplo: supervisor de Maestranza.',
    boton: 'Registrar entrega',
  },
} satisfies Record<Paso, unknown>

/** Un botón por paso; cada uno abre su ventana con la nota y manda a la base. */
export function PasoRequerimiento({ id, numero, paso }: { id: string; numero: string; paso: Paso }) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisar()
  const { alEnviar, enviando, error } = useEnvio(marcarPasoRequerimiento, (r) => {
    setAbierta(false)
    // Entregado, la fila se va de «Por atender»: lo que pasó se dice arriba.
    // Los otros pasos la dejan donde está, con su estado nuevo.
    if (paso === 'entregado' && r.mensaje) avisar(`${numero}: ${r.mensaje}`, r.datos?.aviso)
  })
  const d = PASO[paso]
  const Icono = d.icono
  return (
    <>
      <Boton type="button" variante={d.variante} tamano="sm" onClick={() => setAbierta(true)}>
        <Icono aria-hidden className="size-4" />
        {d.texto}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`${d.titulo} · ${numero}`} descripcion={d.descripcion} ancho="md">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="paso" value={paso} />
          <Campo etiqueta={d.nota} htmlFor={`rq-${paso}-${id}`} requerido={paso === 'entregado'}>
            <AreaTexto id={`rq-${paso}-${id}`} name="nota" rows={2} maxLength={500} required={paso === 'entregado'} minLength={paso === 'entregado' ? 3 : undefined} placeholder={d.ejemplo} />
          </Campo>
          {/* El botón se desactiva mientras envía y el foco caía en la página: el
              rechazo se lo lleva, y Escape sigue cerrando la ventana. */}
          {error && <AvisoEnfocado rol="alert">{error}</AvisoEnfocado>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              {d.boton}
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/**
 * Entregar un RQ listo con lo que salió del kardex, cuando lo que falta ya no
 * va a salir: el área no necesita el resto, devolvieron lo que sobró, se compró
 * en otra unidad. Sin esto el RQ quedaba listo para siempre. La ventana dice qué
 * no salió y pide el motivo, que le llega a quien lo pidió.
 */
export function EntregarConFaltante({ id, numero, faltan }: {
  id: string
  numero: string
  /** Lo que falta sacar del kardex; `null` si no se pudo leer (la base lo anota igual al entregar). */
  faltan: InsumoPorSacar[] | null
}) {
  const [abierta, setAbierta] = useState(false)
  const avisar = useAvisar()
  const { alEnviar, enviando, error } = useEnvio(entregarConFaltante, (r) => {
    setAbierta(false)
    if (r.mensaje) avisar(`${numero}: ${r.mensaje}`, r.datos?.aviso)
  })
  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)}>
        <PackageX aria-hidden className="size-4" />
        Entregar con faltante
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Entregar con faltante · ${numero}`}
        descripcion="Cierra el requerimiento aunque esto no salió del kardex. Si todavía va a salir, registra su salida."
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2">
            <p className="text-xs font-medium text-texto-suave">No salió del kardex</p>
            {faltan === null ? (
              <p className="mt-1 text-sm text-texto">No se pudo leer qué falta. Al entregarlo, el sistema anota lo que no salió.</p>
            ) : (
              <ul className="mt-1 space-y-0.5 text-sm text-texto" data-faltante>
                {faltan.map((f) => (
                  <li key={f.item}>
                    <span className="tabular font-medium">
                      {formatoCantidad(f.pendiente)} {f.unidad}
                    </span>{' '}
                    de {f.descripcion}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Campo etiqueta="Quién lo recogió" htmlFor={`rq-faltante-nota-${id}`} requerido>
            <AreaTexto id={`rq-faltante-nota-${id}`} name="nota" rows={2} maxLength={500} required minLength={3}
              placeholder="Por ejemplo: supervisor de Maestranza." />
          </Campo>
          <Campo etiqueta="Por qué lo que falta ya no sale" htmlFor={`rq-faltante-motivo-${id}`} requerido
            ayuda="Le llega a quien pidió el RQ y queda escrito en él.">
            <AreaTexto id={`rq-faltante-motivo-${id}`} name="motivo" rows={2} maxLength={500} required minLength={10}
              placeholder="Por ejemplo: el área ya no necesita el resto; devolvieron lo que sobró." />
          </Campo>
          {/* El botón se desactiva mientras envía y el foco caía en la página: el
              rechazo se lo lleva, y Escape sigue cerrando la ventana. */}
          {error && <AvisoEnfocado rol="alert">{error}</AvisoEnfocado>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Entregar con faltante
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** Lo que dice el sistema del material de un insumo: lo libre y lo que ya es de otros códigos internos. */
export type StockDelSistema = {
  existencia: number
  libre: number
  /** Lo apartado por los pedidos de OT del circuito anterior. */
  reservado_ot: number
  /** La unidad del kardex, que puede no ser la del insumo. */
  unidad: string
  /**
   * Lo separado para cada código, con cuánto de eso separaron sus RQ abiertos y
   * cuáles (los números, vacíos si quien mira no ve los RQ).
   */
  codigos: { codigo: string; cantidad: number; de_requerimientos: number; requerimientos: string[] }[]
}

/**
 * Lo que el sistema tiene para este RQ: lo libre y, de lo que ya es de su mismo
 * código, solo lo que ningún RQ abierto separó (el accesorio que entró para la
 * unidad). Lo que separó otro RQ del mismo código es de aquel: contarlo aquí lo
 * separaría dos veces, y la base lo marcaría «separado de más». Si se separó más
 * de lo que hay, lo de la unidad no pasa de lo que queda en el kardex fuera de
 * lo libre: `entro` es lo que entró para ella, `deLaUnidad` lo que de eso hay.
 */
function partesDelSistema(sistema: StockDelSistema, codigo: string) {
  const propio = normalizarCodigo(codigo)
  const mismo = sistema.codigos.find((c) => c.codigo === propio) ?? null
  const otros = sistema.codigos.filter((c) => c.codigo !== propio)
  // Redondeado a los tres decimales de la base: 0.3 − 0.1 da 0.19999999999999998 en el navegador.
  const entro = mismo ? Math.max(redondearCantidad(mismo.cantidad - mismo.de_requerimientos), 0) : 0
  const fueraDeLoLibre = Math.max(redondearCantidad(sistema.existencia - sistema.reservado_ot - sistema.libre), 0)
  const deLaUnidad = Math.min(entro, fueraDeLoLibre)
  // `paraElRq` es la cifra como la dice el kardex, con cuatro decimales, y con
  // ella se compara lo anotado: con 1.0005 libres, el aviso decía «el sistema
  // tiene 1» dos líneas debajo de «1.0005 libres». `usable` la corta a los tres
  // decimales de lo que se separa.
  const paraElRq = Math.round((sistema.libre + deLaUnidad) * 10000) / 10000
  return { mismo, otros, entro, deLaUnidad, usable: topeDeCantidad(paraElRq), paraElRq }
}

type InsumoPorRevisar = {
  item: number
  descripcion: string
  cantidad: number
  unidad: string
  /** Se pidió como material nuevo y todavía no tiene material del catálogo. */
  nuevo: boolean
  /** El código del material del catálogo, si ya lo tiene. */
  codigo: string | null
  /** La unidad del material es provisional: esta revisión la confirma con la del insumo. */
  unidad_pendiente: boolean
  /** Lo que dice el sistema; vacío si el insumo todavía no tiene material del catálogo. */
  sistema: StockDelSistema | 'no_se_pudo' | null
}

/**
 * Almacén revisa el requerimiento insumo por insumo: cuánto tiene de cada uno.
 * Lo que tiene completo no se compra; de lo demás, a quien compra le llega
 * solo lo que falta. Si tiene todo, el RQ queda listo para recoger. El insumo
 * pedido como material nuevo se asocia a uno del catálogo o se da de alta aquí.
 */
export function RevisarStock({
  id,
  numero,
  codigo,
  compra,
  insumos,
  materiales,
  stockDelCatalogo,
}: {
  id: string
  numero: string
  /** El código interno del RQ: lo que ya es de ese código se dice aparte. */
  codigo: string
  /** Quién compra lo que falta: «Logística» o «la administradora». */
  compra: string
  insumos: InsumoPorRevisar[]
  /** El catálogo de Almacén; solo hace falta si algún insumo es un material nuevo. */
  materiales: MaterialParaRequerimiento[]
  /** El stock de cada material del catálogo con kardex, para el material nuevo que se asocie; vacío si no se pudo leer. */
  stockDelCatalogo: Record<string, StockDelSistema> | null
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  return (
    <>
      <Boton
        type="button"
        tamano="sm"
        onClick={() => {
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <ClipboardCheck aria-hidden className="size-4" />
        Revisar stock
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Revisar stock · ${numero}`}
        descripcion={`Anota cuánto tienes de cada insumo. Lo que tienes completo no se compra; lo que falta le llega a ${compra}.`}
        ancho="lg"
      >
        <FormularioStock
          key={vez}
          id={id}
          codigo={codigo}
          compra={compra}
          insumos={insumos}
          materiales={materiales}
          stockDelCatalogo={stockDelCatalogo}
          alTerminar={() => setAbierta(false)}
        />
      </Ventana>
    </>
  )
}

function FormularioStock({
  id,
  codigo,
  compra,
  insumos,
  materiales,
  stockDelCatalogo,
  alTerminar,
}: {
  id: string
  codigo: string
  compra: string
  insumos: InsumoPorRevisar[]
  materiales: MaterialParaRequerimiento[]
  stockDelCatalogo: Record<string, StockDelSistema> | null
  alTerminar: () => void
}) {
  const [valores, setValores] = useState<Record<number, string>>({})
  // El material del catálogo que Almacén elige para cada material nuevo; vacío, se da de alta.
  const [elegidos, setElegidos] = useState<Record<number, string>>({})
  const opciones = useMemo(
    () =>
      materiales.map((m) => ({
        valor: m.id,
        etiqueta: m.descripcion,
        detalle: [m.codigo, m.unidad_pendiente ? 'unidad por confirmar' : m.unidad, m.categoria].filter(Boolean).join(' · '),
        unidad: m.unidad,
        unidad_pendiente: m.unidad_pendiente,
      })),
    [materiales],
  )
  const nuevos = insumos.filter((l) => l.nuevo).length
  const { alEnviar, enviando, error } = useEnvio(revisarStockRequerimiento, alTerminar)
  const anotados = insumos.filter((l) => (valores[l.item] ?? '') !== '')
  const faltan = anotados.filter((l) => Number(valores[l.item]) < l.cantidad).length
  const todos = anotados.length === insumos.length
  const llenar = (cuanto: (l: InsumoPorRevisar) => string) =>
    setValores(Object.fromEntries(insumos.map((l) => [l.item, cuanto(l)])))

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input
        type="hidden"
        name="lineas"
        value={JSON.stringify(
          insumos.map((l) => ({ item: l.item, en_stock: valores[l.item] ?? '', material_id: (l.nuevo && elegidos[l.item]) || null })),
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => llenar((l) => String(l.cantidad))}>
          Tengo todo
        </Boton>
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => llenar(() => '0')}>
          No tengo nada
        </Boton>
      </div>
      {nuevos > 0 && (
        <p className="text-sm text-texto-suave">
          {nuevos === 1 ? 'Un insumo se pidió como material nuevo' : `${nuevos} insumos se pidieron como materiales nuevos`}: si ya
          está en el catálogo con otro nombre, elígelo; si no, se da de alta con el nombre pedido y un código provisional.
        </p>
      )}
      <ul className="space-y-2">
        {insumos.map((l) => {
          const valor = valores[l.item] ?? ''
          const falta = valor === '' ? null : Math.max(l.cantidad - Number(valor), 0)
          // El material nuevo, en cuanto Almacén elige uno del catálogo, dice el stock de ése.
          const elegido = l.nuevo ? elegidos[l.item] : undefined
          const sistema: InsumoPorRevisar['sistema'] = !l.nuevo
            ? l.sistema
            : !elegido
              ? null
              : stockDelCatalogo === null
                ? 'no_se_pudo'
                : (stockDelCatalogo[elegido] ?? { existencia: 0, libre: 0, reservado_ot: 0, unidad: l.unidad, codigos: [] })
          // Anotar más de lo que el sistema tiene para este RQ no se impide —Almacén
          // cuenta lo que ve—, pero se avisa: separaría de más.
          const partes = sistema && sistema !== 'no_se_pudo' && sistema.unidad === l.unidad ? partesDelSistema(sistema, codigo) : null
          const usable = partes ? partes.usable : null
          // Lo separado lleva tres decimales y el kardex, cuatro: con 1.0005 en el
          // sistema, anotar 1.0005 avisaba que era de más con la misma cifra.
          const conMasDecimales = valor !== '' && Math.abs(Number(valor) * 1000 - Math.round(Number(valor) * 1000)) > 1e-6
          const deMas = !conMasDecimales && valor !== '' && partes !== null && Number(valor) > partes.paraElRq
          const conAviso = deMas || conMasDecimales
          return (
            <li key={l.item} className="grid gap-2 rounded-lg border border-borde p-3 sm:grid-cols-[1fr_9rem] sm:items-end">
              <div className="text-sm">
                <p className="text-texto">
                  {l.descripcion}
                  {l.codigo && <span className="tabular text-xs text-texto-suave"> · {l.codigo}</span>}
                </p>
                <p className="tabular text-xs text-texto-suave">
                  Pide {formatoCantidad(l.cantidad)} {l.unidad}
                  {falta !== null &&
                    (falta === 0 ? ' · lo tienes completo' : ` · se compran ${formatoCantidad(falta)} ${l.unidad}`)}
                </p>
                <EnElSistema sistema={sistema} codigo={codigo} />
                {l.unidad_pendiente && (
                  <p className="text-xs text-texto-suave">La unidad de este material era provisional: queda en {l.unidad}.</p>
                )}
              </div>
              <Campo etiqueta={`Tienes (${l.unidad || 'cantidad'})`} htmlFor={`rq-stock-${id}-${l.item}`} requerido>
                <Entrada
                  id={`rq-stock-${id}-${l.item}`}
                  aria-describedby={conAviso ? `rq-stock-${id}-${l.item}-aviso` : undefined}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={l.cantidad}
                  step="0.001"
                  required
                  value={valor}
                  onChange={(e) => setValores((v) => ({ ...v, [l.item]: e.target.value }))}
                />
              </Campo>
              {/* Siempre en la página, para que el lector de pantalla anuncie el aviso cuando aparece. */}
              <p
                id={`rq-stock-${id}-${l.item}-aviso`}
                aria-live="polite"
                className={cn('tabular text-xs text-aviso sm:col-span-2', !conAviso && 'sr-only')}
                data-separa-de-mas={deMas || undefined}
              >
                {conMasDecimales
                  ? `La revisión lleva hasta tres decimales: anota ${formatoCantidad(topeDeCantidad(Number(valor)))}.`
                  : deMas && sistema && sistema !== 'no_se_pudo'
                  ? sistema.existencia <= 0
                    ? 'El sistema no tiene stock de este material: revisa antes de separarlo.'
                    : usable !== null && usable <= 0
                      ? 'El sistema no tiene nada libre para este RQ: revisa antes de separarlo.'
                      : `El sistema tiene ${formatoCantidad(partes?.paraElRq ?? usable)} ${sistema.unidad} para este RQ: revisa antes de separar más.`
                  : ''}
              </p>
              {l.nuevo && (
                <Campo
                  etiqueta="Material nuevo: en el catálogo es…"
                  htmlFor={`rq-mat-${id}-${l.item}`}
                  className="sm:col-span-2"
                  ayuda={
                    elegidos[l.item]
                      ? 'El insumo queda con este material del catálogo.'
                      : `Sin elegir, se da de alta «${l.descripcion}» en ${l.unidad} con un código provisional.`
                  }
                >
                  <SeleccionBuscable
                    id={`rq-mat-${id}-${l.item}`}
                    valor={elegidos[l.item] ?? ''}
                    onChange={(v) => setElegidos((e) => ({ ...e, [l.item]: v }))}
                    marcador="No está: darlo de alta como material nuevo"
                    marcadorBusqueda="Nombre o código del material…"
                    // Solo los que se cuentan en la unidad pedida, o tienen la unidad por confirmar.
                    opciones={opciones.filter(
                      (o) =>
                        (o.unidad_pendiente || o.unidad === l.unidad) &&
                        (o.valor === elegidos[l.item] || !Object.entries(elegidos).some(([item, v]) => v === o.valor && Number(item) !== l.item)),
                    )}
                  />
                </Campo>
              )}
            </li>
          )
        })}
      </ul>
      <Campo etiqueta="Nota (opcional)" htmlFor={`rq-stock-nota-${id}`}>
        <AreaTexto
          id={`rq-stock-nota-${id}`}
          name="nota"
          rows={2}
          maxLength={500}
          placeholder="Por ejemplo: de 2 mm quedan 3 planchas en el estante B; de 3 mm no hay."
        />
      </Campo>
      <p role="status" className="text-sm text-texto-suave">
        {!todos
          ? `Anota cuánto tienes de cada insumo (${anotados.length} de ${insumos.length}).`
          : faltan === 0
            ? 'Tienes todo: queda listo en almacén y al área le llega el aviso para recogerlo.'
            : `${faltan === 1 ? 'Se compra' : 'Se compran'} ${faltan} de ${insumos.length} ${insumos.length === 1 ? 'insumo' : 'insumos'}: a ${compra} le llega solo lo que falta.`}
      </p>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando} disabled={!todos}>
          Guardar la revisión
        </Boton>
      </div>
    </form>
  )
}

/** Cuántos códigos se nombran antes de resumir el resto: en el teléfono la línea no debe crecer sin fin. */
const CODIGOS_A_LA_VISTA = 3

/**
 * Lo que ya es del mismo código del RQ. Lo que separó otro RQ abierto de ese
 * código es de aquel: si es el mismo pedido repetido, no se separa otra vez. Lo
 * que entró para la unidad y ningún RQ tomó sí le sirve a este.
 */
function DelMismoCodigo({ mismo, entro, deLaUnidad, unidad }: {
  mismo: StockDelSistema['codigos'][number]; entro: number; deLaUnidad: number; unidad: string
}) {
  const separado = mismo.de_requerimientos
  const numeros = mismo.requerimientos.join(', ')
  const propio = `${mismo.codigo}, el código de este RQ`
  const sirve = `${deLaUnidad === 1 ? 'sirve' : 'sirven'} para este pedido`
  // Se separó más de lo que hay: de lo que entró para la unidad no queda todo en el kardex.
  const queda = deLaUnidad <= 0 ? 'no queda ninguno' : `${deLaUnidad === 1 ? 'queda' : 'quedan'} ${formatoCantidad(deLaUnidad)}`
  return (
    <p className="tabular text-xs text-texto" data-mismo-codigo>
      {separado <= 0
        ? deLaUnidad < entro
          ? `${formatoCantidad(entro)} ${unidad} ${entro === 1 ? 'entró' : 'entraron'} para ${propio}, pero en el kardex ${queda}${deLaUnidad > 0 ? `: ${sirve}` : ''}.`
          : `${formatoCantidad(deLaUnidad)} ${unidad} ${deLaUnidad === 1 ? 'entró' : 'entraron'} para ${propio}: ${sirve}.`
        : entro <= 0
          ? `${formatoCantidad(separado)} ${unidad} ya ${separado === 1 ? 'está separado' : 'están separados'} para ${propio}${numeros && `, en ${numeros}`}: si es el mismo pedido, no ${separado === 1 ? 'lo' : 'los'} separes otra vez.`
          : `${formatoCantidad(mismo.cantidad)} ${unidad} son de ${propio}: ${formatoCantidad(separado)} ya separados${numeros && ` en ${numeros}`}; ${formatoCantidad(entro)} ${entro === 1 ? 'entró' : 'entraron'} para la unidad${deLaUnidad < entro ? `, y en el kardex ${queda}` : ''}${deLaUnidad > 0 ? ` y ${sirve}` : ''}.`}
    </p>
  )
}

/**
 * Lo que dice el sistema junto al insumo, para contar con eso a la vista (DKS,
 * 2026-10-20): lo libre se puede usar; lo separado para otros códigos internos
 * es de sus RQ o entró para esa unidad. Lo que ya es del mismo código del RQ va
 * aparte: puede ser un pedido repetido, o el accesorio que entró para esa
 * unidad y sirve para este. «Tienes» lo sigue anotando Almacén con lo que
 * cuenta: el sistema no lo llena.
 */
function EnElSistema({ sistema, codigo }: { sistema: InsumoPorRevisar['sistema']; codigo: string }) {
  if (sistema === null) return null
  if (sistema === 'no_se_pudo') {
    return <p className="text-xs text-texto-suave">No se pudo leer el stock del sistema: anota lo que cuentes.</p>
  }
  const { existencia, libre, reservado_ot: reservado, unidad } = sistema
  if (existencia <= 0) return <p className="text-xs text-texto-suave" data-en-el-sistema>En el sistema: no hay stock.</p>
  const { mismo, otros, entro, deLaUnidad } = partesDelSistema(sistema, codigo)
  const deOtros = otros.reduce((suma, c) => suma + c.cantidad, 0)
  const nombrados = otros.slice(0, CODIGOS_A_LA_VISTA)
  const resto = otros.length - nombrados.length
  return (
    <>
      {deOtros <= 0 && reservado <= 0 && libre > 0 ? (
        <p className="tabular text-xs text-texto" data-en-el-sistema>
          En el sistema: <strong className="font-semibold">{formatoCantidad(libre)} {unidad} libres</strong>
        </p>
      ) : (
        <p className="tabular text-xs text-texto" data-en-el-sistema>
          En el sistema hay {formatoCantidad(existencia)} {unidad}:{' '}
          <strong className="font-semibold">{libre > 0 ? `${formatoCantidad(libre)} libres` : 'nada libre'}</strong>
          {deOtros > 0 && (
            <span className="text-texto-suave">
              {' · '}
              {formatoCantidad(deOtros)} separados para otros códigos (
              {nombrados.map((c, i) => (
                <Fragment key={c.codigo}>
                  {i > 0 && ' · '}
                  <span className="whitespace-nowrap">
                    {c.codigo}: {formatoCantidad(c.cantidad)}
                  </span>
                </Fragment>
              ))}
              {resto > 0 && ` y ${resto} más`})
            </span>
          )}
          {reservado > 0 && (
            <span className="text-texto-suave">
              {' · '}
              {formatoCantidad(reservado)} en pedidos de antes de los RQ
            </span>
          )}
        </p>
      )}
      {mismo && <DelMismoCodigo mismo={mismo} entro={entro} deLaUnidad={deLaUnidad} unidad={unidad} />}
    </>
  )
}
