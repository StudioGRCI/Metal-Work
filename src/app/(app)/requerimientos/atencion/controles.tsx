'use client'

import { Check, ClipboardCheck, PackageCheck, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { MaterialParaRequerimiento } from '@/lib/datos/requerimientos'
import { useEnvio } from '@/lib/envio'
import { cantidad as formatoCantidad } from '@/lib/format'

import { marcarPasoRequerimiento, revisarStockRequerimiento } from './acciones'

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
  const { alEnviar, enviando, error } = useEnvio(marcarPasoRequerimiento, () => setAbierta(false))
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
          {error && (
            <p role="alert" className="text-sm text-peligro">
              {error}
            </p>
          )}
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
  compra,
  insumos,
  materiales,
}: {
  id: string
  numero: string
  /** Quién compra lo que falta: «Logística» o «la administradora». */
  compra: string
  insumos: InsumoPorRevisar[]
  /** El catálogo de Almacén; solo hace falta si algún insumo es un material nuevo. */
  materiales: MaterialParaRequerimiento[]
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
        <FormularioStock key={vez} id={id} compra={compra} insumos={insumos} materiales={materiales} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

function FormularioStock({
  id,
  compra,
  insumos,
  materiales,
  alTerminar,
}: {
  id: string
  compra: string
  insumos: InsumoPorRevisar[]
  materiales: MaterialParaRequerimiento[]
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
                {l.unidad_pendiente && (
                  <p className="text-xs text-texto-suave">La unidad de este material era provisional: queda en {l.unidad}.</p>
                )}
              </div>
              <Campo etiqueta={`Tienes (${l.unidad || 'cantidad'})`} htmlFor={`rq-stock-${id}-${l.item}`} requerido>
                <Entrada
                  id={`rq-stock-${id}-${l.item}`}
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
