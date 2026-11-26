import type { SeguimientoDelInsumo } from '@/lib/datos/requerimientos'
import { pasoDelInsumo, TITULO_PASO_DEL_INSUMO, type PasoDelInsumo } from '@/lib/dominio/requerimientos'
import { fecha } from '@/lib/format'
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
}: {
  item: number
  pasos: PasoDelInsumo[]
  actual: PasoDelInsumo
  terminado: boolean
  rechazado: boolean
  conFaltante: boolean
}) {
  const indice = pasos.indexOf(actual)
  return (
    <ol className={cn('grid gap-1', COLUMNAS[pasos.length])} aria-label={`En qué va el insumo ${item}`}>
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
              {TITULO_PASO_DEL_INSUMO[p]}
            </span>
            <span className="sr-only sm:hidden">{TITULO_PASO_DEL_INSUMO[p]}</span>
            <span className="sr-only">{hecho ? ': hecho' : ahora ? (conFaltante ? ': con faltante' : ': ahora') : ': falta'}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Mientras se compra o viene en camino, se dice cuándo llega. */
const ESPERA_LA_COMPRA: readonly PasoDelInsumo[] = ['EN_COMPRA', 'EN_CAMINO']

/**
 * De principio a fin, cómo va un insumo del requerimiento de Administración
 * (plan 8, entrega 8.3): sus pasos (Almacén lo revisa, va en compra, viene en
 * camino, llegó al almacén, se entregó) y, mientras se compra, la fecha en que
 * se espera. Es la misma cuenta que sigue el supervisor en «RQ por unidad»
 * (`pasoDelInsumo` y `seguimiento_de_insumos`, plan 1, entrega 1.2). Quién lo
 * recibió lo dicen las salidas, debajo, y cuánto falta, la barra.
 *
 * `seguimiento` es `null` si la base no lo dio: los pasos salen igual, de la
 * etapa, sin la fecha.
 */
export function ComoVaElInsumo({
  linea: l,
  seguimiento: s,
  hoy,
}: {
  linea: { item: number; etapa: string | null; cantidad: number; en_stock: number | null; entregado: number | null; sin_salida?: number | null }
  seguimiento: SeguimientoDelInsumo | null
  hoy: string
}) {
  const paso = pasoDelInsumo(l, s?.visto_diseno ?? null)
  if (!paso) return null
  const llega = ESPERA_LA_COMPRA.includes(paso.actual) ? (s?.fecha_esperada ?? null) : null
  const atrasada = llega !== null && llega < hoy
  const porAprobar = l.etapa === 'OC_POR_APROBAR'
  const titulo = paso.faltante ? 'Entregado con faltante' : paso.terminado ? 'Entregado' : TITULO_PASO_DEL_INSUMO[paso.actual]
  return (
    <div className="mt-2 space-y-1" data-como-va-el-insumo={paso.actual}>
      <PasosDelInsumo item={l.item} {...paso} rechazado={false} conFaltante={paso.faltante !== null} />
      {/* En el teléfono no se ven los nombres de los pasos: el de ahora va aquí. */}
      {(llega || titulo) && (
        <p className="text-xs text-texto-suave">
          <span className="font-medium text-texto sm:hidden">{titulo}</span>
          {llega && (
            <span className={atrasada ? 'text-aviso' : undefined} data-llega={llega}>
              <span className="sm:hidden"> · </span>
              {porAprobar
                ? atrasada
                  ? `Logística lo esperaba el ${fecha(llega)}`
                  : `Si Gerencia aprueba la compra, llega aprox. el ${fecha(llega)}`
                : atrasada
                  ? `Se esperaba el ${fecha(llega)}`
                  : `Llega aprox. el ${fecha(llega)}`}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
