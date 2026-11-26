import type { Tono } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import type { RequerimientoListado, SeguimientoDelInsumo } from '@/lib/datos/requerimientos'
import {
  ETAPA_AVANCE_RQ,
  pasoDelInsumo,
  TITULO_PASO_DEL_INSUMO,
  VISTO_DEL_INSUMO,
  type PasoDelInsumo,
} from '@/lib/dominio/requerimientos'
import { cantidad, fecha, hoyLima } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Cada clase entera: Tailwind no ve las que se arman. */
const COLUMNAS: Record<number, string> = { 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' }
const TEXTO: Record<Tono, string> = {
  neutro: 'text-texto-suave',
  exito: 'text-exito',
  aviso: 'text-aviso',
  peligro: 'text-peligro',
  info: 'text-info',
  acento: 'text-acento',
}

/** Lo que se espera de la compra mientras no llega al almacén. */
const ESPERA_COMPRA: readonly PasoDelInsumo[] = ['EN_COMPRA', 'EN_CAMINO']

/**
 * Cómo va cada insumo de un RQ, de principio a fin, para el supervisor que lo
 * pidió (Plan 1, entrega 1.2): sus pasos, la etapa en palabras, el visto de
 * Diseño si se pasa del metrado, la fecha en que se espera su compra y quién
 * lo recibió del almacén. De la compra no sale nada más: ni proveedor ni
 * precio. `seguimiento` es `null` si la base no lo pudo dar: los pasos salen
 * igual, de la etapa, y se dice qué falta.
 */
export function InsumosDelRequerimiento({
  rq,
  seguimiento,
}: {
  rq: RequerimientoListado
  seguimiento: Map<string, SeguimientoDelInsumo> | null
}) {
  if (rq.lineas.length === 0 || rq.estado === 'ANULADO') return null
  const hoy = hoyLima()
  return (
    <Pliegue
      enCaja
      titulo={rq.lineas.length === 1 ? 'Cómo va su insumo' : `Cómo va cada insumo (${rq.lineas.length})`}
      className="mt-1"
      data-insumos-del-rq={rq.id}
    >
      {seguimiento === null && (
        <p role="status" className="mb-2 text-xs text-aviso">
          No se pudo leer el visto de Diseño, la fecha en que llega ni quién lo recibió. Recarga la página; si continúa, avisa al administrador.
        </p>
      )}
      <ol className="divide-y divide-borde" aria-label={`Insumos de ${rq.numero}`}>
        {rq.lineas.map((l) => {
          const s = seguimiento?.get(`${rq.id}:${l.item}`) ?? null
          const visto = s?.visto_diseno ?? null
          const paso = pasoDelInsumo(l.etapa, visto)
          const etapa = l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : undefined
          const vistoDice = visto ? VISTO_DEL_INSUMO[visto] : undefined
          // Solo mientras se compra o viene en camino: después ya llegó.
          const llega = paso !== null && ESPERA_COMPRA.includes(paso.actual) ? (s?.fecha_esperada ?? null) : null
          const atrasada = llega !== null && llega < hoy
          return (
            <li key={l.id} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0" data-insumo={l.item} data-paso={paso?.actual}>
              <p className="text-sm break-words text-texto">
                <span className="tabular text-texto-suave">{l.item}.</span> {l.descripcion}
                <span className="tabular text-texto-suave">
                  {' · '}
                  {cantidad(l.cantidad)} {l.unidad}
                </span>
              </p>
              {paso && <PasosDelInsumo item={l.item} {...paso} rechazado={visto === 'RECHAZADO'} />}
              <p className="text-xs break-words text-texto-suave">
                {/* En el teléfono no se ven los nombres de los pasos: el de ahora va aquí, si la etapa no lo dice ya. */}
                {paso && TITULO_PASO_DEL_INSUMO[paso.actual] !== etapa?.etiqueta && (
                  <span className="font-medium text-texto sm:hidden">{TITULO_PASO_DEL_INSUMO[paso.actual]} · </span>
                )}
                {paso?.actual === 'VISTO_DISENO' && vistoDice ? (
                  <span className={TEXTO[vistoDice.tono]}>{vistoDice.etiqueta}</span>
                ) : (
                  // Con los nombres a la vista, «Entregado» bajo «Entregado» sobra.
                  <span className={cn(TEXTO[etapa?.tono ?? 'neutro'], paso && TITULO_PASO_DEL_INSUMO[paso.actual] === etapa?.etiqueta && 'sm:hidden')}>
                    {etapa?.etiqueta ?? 'Sin etapa'}
                  </span>
                )}
                {llega && (
                  <span className={atrasada ? 'text-aviso' : undefined} data-llega={llega}>
                    {' · '}
                    {atrasada ? `Se esperaba el ${fecha(llega)}` : `Llega aprox. el ${fecha(llega)}`}
                  </span>
                )}
              </p>
              {/* El visto ya dado se dice aparte: el insumo siguió su camino. */}
              {vistoDice && paso?.actual !== 'VISTO_DISENO' && <p className={cn('text-xs', TEXTO[vistoDice.tono])}>{vistoDice.etiqueta}</p>}
              {s?.recibido_por && (
                <p className="text-xs break-words text-texto-suave" data-recibio>
                  Lo recibió <span className="font-medium text-texto">{s.recibido_por}</span>
                  {s.recibido_en && ` · ${fecha(s.recibido_en)}`}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </Pliegue>
  )
}

/**
 * La línea de pasos del insumo: hecho en verde, el de ahora en acento (rojo si
 * Diseño no lo autorizó), lo que falta en gris. En el teléfono los nombres no
 * entran bajo cada tramo: el de ahora se dice en la línea de abajo.
 */
function PasosDelInsumo({
  item,
  pasos,
  actual,
  terminado,
  rechazado,
}: {
  item: number
  pasos: PasoDelInsumo[]
  actual: PasoDelInsumo
  terminado: boolean
  rechazado: boolean
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
                hecho ? 'bg-exito' : ahora ? (rechazado ? 'bg-peligro' : 'bg-acento') : 'bg-neutro-suave',
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
            <span className="sr-only">{hecho ? ': hecho' : ahora ? ': ahora' : ': falta'}</span>
          </li>
        )
      })}
    </ol>
  )
}
