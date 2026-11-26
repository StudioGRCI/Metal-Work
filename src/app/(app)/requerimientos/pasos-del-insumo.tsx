import type { LineaRequerimiento } from '@/lib/datos/requerimientos'
import { cuandoLlega, ESPERA_LA_COMPRA, pasoDelInsumo, TITULO_PASO_DEL_INSUMO, type PasoDelInsumo } from '@/lib/dominio/requerimientos'
import { cn } from '@/lib/utils'

/** Cada clase entera: Tailwind no ve las que se arman. */
const COLUMNAS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' }

/**
 * La línea de pasos del insumo: hecho en verde, el de ahora en acento (rojo si
 * Diseño no lo autorizó), lo que falta con su borde. En el teléfono los
 * nombres no entran bajo cada tramo: el de ahora se dice en la línea de abajo.
 */
export function PasosDelInsumo({
  item,
  pasos,
  actual,
  terminado,
  rechazado,
  conFaltante,
  titulos = TITULO_PASO_DEL_INSUMO,
  className,
}: {
  item: number
  pasos: PasoDelInsumo[]
  actual: PasoDelInsumo
  terminado: boolean
  rechazado: boolean
  conFaltante: boolean
  /** El nombre de cada paso; el RQ de Administración dice quién revisa y quién compra. */
  titulos?: Record<PasoDelInsumo, string>
  /** El RQA la alinea con la barra de partes, que no pasa de `max-w-xl`. */
  className?: string
}) {
  const indice = pasos.indexOf(actual)
  return (
    <ol className={cn('grid gap-1', COLUMNAS[pasos.length], className)} aria-label={`En qué va el insumo ${item}`}>
      {pasos.map((p, i) => {
        const hecho = i < indice || terminado
        const ahora = i === indice && !terminado
        return (
          <li key={p} aria-current={ahora ? 'step' : undefined} className="min-w-0" data-paso-del-insumo={p}>
            <span
              aria-hidden
              className={cn(
                'block h-1.5 rounded-full',
                hecho ? 'bg-exito' : ahora ? (rechazado ? 'bg-peligro' : conFaltante ? 'bg-aviso' : 'bg-acento') : 'border border-texto-tenue bg-superficie',
              )}
            />
            <span
              className={cn(
                'mt-1 hidden text-xs leading-tight sm:block',
                ahora ? 'font-semibold text-texto' : hecho ? 'text-texto-suave' : 'text-texto-tenue',
              )}
            >
              {titulos[p]}
            </span>
            <span className="sr-only sm:hidden">{titulos[p]}</span>
            <span className="sr-only">{hecho ? ': hecho' : ahora ? (conFaltante ? ': con faltante' : ': ahora') : ': falta'}</span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * En el RQ de Administración los dos primeros pasos dicen quién los hace, como
 * la barra del RQ: Almacén revisa, ella compra. Con la OC por aprobar, el paso
 * de compra lo tiene Gerencia, y lo dice.
 */
const titulosDelRqa = (quienCompra: string, porAprobar: boolean): Record<PasoDelInsumo, string> => ({
  ...TITULO_PASO_DEL_INSUMO,
  POR_ATENDER: 'Almacén revisa',
  EN_COMPRA: porAprobar ? 'Gerencia aprueba' : `${quienCompra} compra`,
})

/**
 * De principio a fin, cómo va un insumo del requerimiento de Administración
 * (plan 8, entrega 8.3): Almacén lo revisa, Administración lo compra, viene en
 * camino, llegó al almacén, se entregó; y, mientras se compra, la fecha en que
 * se espera. Es la misma cuenta que sigue el supervisor en «RQ por unidad»
 * (`pasoDelInsumo`, plan 1, entrega 1.2). La fecha (`fecha_esperada`) y el
 * visto de Diseño (el metrado) ya vienen con la tarjeta: no hace falta otra
 * lectura. Quién lo recibió lo dicen las salidas, debajo, y cuánto falta, la barra.
 */
export function ComoVaElInsumo({
  linea: l,
  visto,
  hoy,
  quienCompra,
}: {
  linea: Pick<LineaRequerimiento, 'item' | 'etapa' | 'cantidad' | 'en_stock' | 'entregado' | 'sin_salida' | 'fecha_esperada'>
  /** El estado del metrado de Diseño de la línea; vacío si no se pasa o no aplica. */
  visto: string | null
  hoy: string
  /** Quien lleva el RQ y hace su OC: la administradora. */
  quienCompra: string
}) {
  const paso = pasoDelInsumo(l, visto)
  if (!paso) return null
  const llega = ESPERA_LA_COMPRA.includes(paso.actual) ? l.fecha_esperada : null
  const porAprobar = l.etapa === 'OC_POR_APROBAR'
  const titulos = titulosDelRqa(quienCompra, porAprobar)
  const titulo = paso.faltante ? 'Entregado con faltante' : paso.terminado ? 'Entregado' : titulos[paso.actual]
  return (
    <div className="mt-2 mb-3 space-y-1" data-como-va-el-insumo={paso.actual}>
      <PasosDelInsumo
        item={l.item}
        {...paso}
        rechazado={visto === 'RECHAZADO' && paso.frenado}
        conFaltante={paso.faltante !== null}
        titulos={titulos}
        className="max-w-xl"
      />
      {/* En el teléfono no se ven los nombres de los pasos: el de ahora va aquí. En el monitor, solo la fecha. */}
      <p className={cn('text-xs text-texto-suave', !llega && 'sm:hidden')}>
        <span className="font-medium text-texto sm:hidden">{titulo}</span>
        {llega && (
          <span className={llega < hoy ? 'text-aviso' : undefined} data-llega={llega}>
            <span className="sm:hidden"> · </span>
            {/* La fecha la puso quien lee: con la OC por aprobar, se dice que espera a Gerencia. */}
            {cuandoLlega({ llega, atrasada: llega < hoy, porAprobar, quienCompra: null })}
          </span>
        )}
      </p>
    </div>
  )
}
