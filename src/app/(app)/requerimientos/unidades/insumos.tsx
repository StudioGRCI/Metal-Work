import Link from 'next/link'

import type { Tono } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import type { LineaRequerimiento, RequerimientoListado, SeguimientoDelInsumo } from '@/lib/datos/requerimientos'
import {
  ETAPA_AVANCE_RQ,
  PASOS_DEL_INSUMO,
  pasoDelInsumo,
  TITULO_PASO_DEL_INSUMO,
  VISTO_DEL_INSUMO,
  VISTO_QUE_PIDE_SUSTENTO,
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

/** Cómo se cuenta cada paso en el resumen del pliegue: «2 en compra». */
const EN_EL_RESUMEN: Record<PasoDelInsumo, string> = {
  VISTO_DISENO: 'esperando a Diseño',
  POR_ATENDER: 'por atender',
  EN_COMPRA: 'en compra',
  EN_CAMINO: 'en camino',
  EN_ALMACEN: 'en almacén',
  ENTREGADO: 'entregado',
}

type Insumo = {
  linea: LineaRequerimiento
  seguimiento: SeguimientoDelInsumo | null
  paso: ReturnType<typeof pasoDelInsumo>
  /** La fecha en que se espera, solo mientras se compra o viene en camino. */
  llega: string | null
}

/**
 * Cómo va cada insumo de un RQ, de principio a fin, para el supervisor que lo
 * pidió (Plan 1, entrega 1.2): sus pasos, la etapa en palabras, el visto de
 * Diseño si se pasa del metrado, la fecha en que se espera su compra y quién
 * lo recibió del almacén. De la compra no sale nada más: ni proveedor ni
 * precio. `seguimiento` es `null` si la base no lo pudo dar: los pasos salen
 * igual, de la etapa, y la página lo dice una vez arriba.
 *
 * El pliegue llega cerrado, pero su título ya dice lo que más se pregunta: en
 * qué va cada insumo y cuándo llega lo que falta; y si el área tiene que
 * escribir el sustento para Diseño, lo dice primero.
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
  const insumos: Insumo[] = rq.lineas.map((l) => {
    const s = seguimiento?.get(`${rq.id}:${l.item}`) ?? null
    const paso = pasoDelInsumo(l, s?.visto_diseno ?? null)
    const llega = paso !== null && ESPERA_COMPRA.includes(paso.actual) ? (s?.fecha_esperada ?? null) : null
    return { linea: l, seguimiento: s, paso, llega }
  })
  const pideSustento = insumos.some((i) => i.paso?.frenado && VISTO_QUE_PIDE_SUSTENTO.includes(i.seguimiento?.visto_diseno ?? ''))

  return (
    <Pliegue
      enCaja
      titulo={<TituloDelPliegue insumos={insumos} pideSustento={pideSustento} terminado={rq.estado === 'ENTREGADO'} />}
      className="mt-1"
      data-insumos-del-rq={rq.id}
    >
      {pideSustento && (
        <p className="mb-2 text-sm text-aviso" data-pide-sustento>
          Se pasa del metrado de Diseño y espera el sustento de tu área.{' '}
          <Link href={`/requerimientos?rq=${rq.id}`} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
            Escribe el sustento en el RQ
          </Link>
        </p>
      )}
      <ol className="divide-y divide-borde" aria-label={`Insumos de ${rq.numero}`}>
        {insumos.map(({ linea: l, seguimiento: s, paso, llega }) => {
          const visto = s?.visto_diseno ?? null
          const etapa = l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : undefined
          // El visto solo se dice si sigue valiendo: autorizado, o frenando ahora.
          const vistoDice = visto && (paso?.frenado || visto === 'AUTORIZADO') ? VISTO_DEL_INSUMO[visto] : undefined
          const atrasada = llega !== null && llega < hoy
          const salio = l.entregado !== null && l.entregado > 0 ? l.entregado : null
          const parte = salio !== null && salio < l.cantidad
          const titulo = paso ? TITULO_PASO_DEL_INSUMO[paso.actual] : null
          // La línea de abajo: el freno de Diseño, o la etapa; si ya salió entero, «Entregado».
          const dice =
            paso?.frenado && vistoDice
              ? vistoDice
              : paso?.actual === 'ENTREGADO'
                ? { etiqueta: 'Entregado', tono: 'neutro' as Tono }
                : etapa
          return (
            <li key={l.id} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0" data-insumo={l.item} data-paso={paso?.actual}>
              <p className="text-sm break-words text-texto">
                <span className="tabular text-texto-suave">{l.item}.</span> {l.descripcion}
                <span className="tabular text-texto-suave">
                  {' · '}
                  {cantidad(l.cantidad)} {l.unidad}
                </span>
              </p>
              {paso && <PasosDelInsumo item={l.item} {...paso} rechazado={visto === 'RECHAZADO' && paso.frenado} />}
              <p className="text-xs break-words text-texto-suave">
                {/* En el teléfono no se ven los nombres de los pasos: el de ahora va aquí, si la línea no lo dice ya. */}
                {titulo && titulo !== dice?.etiqueta && <span className="font-medium text-texto sm:hidden">{titulo} · </span>}
                <span className={cn(TEXTO[dice?.tono ?? 'neutro'], titulo === dice?.etiqueta && 'sm:hidden')}>
                  {dice?.etiqueta ?? 'Sin etapa'}
                </span>
                {llega && (
                  <span className={atrasada ? 'text-aviso' : undefined} data-llega={llega}>
                    {' · '}
                    {atrasada ? `Se esperaba el ${fecha(llega)}` : `Llega aprox. el ${fecha(llega)}`}
                  </span>
                )}
              </p>
              {/* El visto ya dado se dice aparte: el insumo siguió su camino. */}
              {vistoDice && !paso?.frenado && <p className={cn('text-xs', TEXTO[vistoDice.tono])}>{vistoDice.etiqueta}</p>}
              {s?.recibido_por && (
                <p className="text-xs break-words text-texto-suave" data-recibio>
                  {parte && (
                    <span className="tabular">
                      Salieron {cantidad(salio)} de {cantidad(l.cantidad)} {l.unidad}:{' '}
                    </span>
                  )}
                  {parte ? 'los recibió' : 'Lo recibió'} <span className="font-medium text-texto">{s.recibido_por}</span>
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
 * El título del pliegue, que se lee cerrado: si falta el sustento, eso
 * primero; después cuántos insumos van en cada paso, del más atrasado al más
 * adelantado, y la fecha más cercana en que llega lo que se compra.
 */
function TituloDelPliegue({ insumos, pideSustento, terminado }: { insumos: Insumo[]; pideSustento: boolean; terminado: boolean }) {
  const cuenta = new Map<PasoDelInsumo, number>()
  for (const i of insumos) if (i.paso) cuenta.set(i.paso.actual, (cuenta.get(i.paso.actual) ?? 0) + 1)
  // Con un solo insumo, el número sobra: «en compra».
  const enPasos = PASOS_DEL_INSUMO.filter((p) => cuenta.has(p)).map((p) =>
    insumos.length === 1 ? EN_EL_RESUMEN[p] : `${cuenta.get(p) ?? 0} ${EN_EL_RESUMEN[p]}`,
  )
  const llegan = insumos
    .map((i) => i.llega)
    .filter((d): d is string => d !== null)
    .sort()
  const resumen = [...enPasos, llegan.length > 0 ? `llega aprox. el ${fecha(llegan[0])}` : null].filter(Boolean).join(', ')
  return (
    <span className="block py-1.5" data-resumen-de-insumos>
      {pideSustento && <span className="block font-semibold text-aviso">Falta tu sustento para Diseño</span>}
      <span className="block">{insumos.length === 1 ? 'Cómo va su insumo' : `Cómo va cada insumo (${insumos.length})`}</span>
      {resumen && !terminado && <span className="block text-xs font-normal text-texto-suave first-letter:uppercase">{resumen}</span>}
    </span>
  )
}

/**
 * La línea de pasos del insumo: hecho en verde, el de ahora en acento (rojo si
 * Diseño no lo autorizó), lo que falta con su borde. En el teléfono los
 * nombres no entran bajo cada tramo: el de ahora se dice en la línea de abajo.
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
                hecho ? 'bg-exito' : ahora ? (rechazado ? 'bg-peligro' : 'bg-acento') : 'border border-texto-tenue bg-superficie',
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
