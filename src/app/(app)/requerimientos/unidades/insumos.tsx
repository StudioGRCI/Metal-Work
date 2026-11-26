import Link from 'next/link'

import type { Tono } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import type { LineaRequerimiento, RequerimientoListado, SeguimientoDelInsumo } from '@/lib/datos/requerimientos'
import {
  ETAPA_AVANCE_RQ,
  PASOS_DEL_INSUMO,
  cuandoLlega,
  ESPERA_LA_COMPRA,
  pasoDelInsumo,
  quienCompra,
  TITULO_PASO_DEL_INSUMO,
  VISTO_DEL_INSUMO,
  VISTO_QUE_PIDE_SUSTENTO,
  type PasoDelInsumo,
} from '@/lib/dominio/requerimientos'
import { cantidad, fecha, hoyLima } from '@/lib/format'
import { cn } from '@/lib/utils'

import { PasosDelInsumo } from '../pasos-del-insumo'

const TEXTO: Record<Tono, string> = {
  neutro: 'text-texto-suave',
  exito: 'text-exito',
  aviso: 'text-aviso',
  peligro: 'text-peligro',
  info: 'text-info',
  acento: 'text-acento',
}

/**
 * Cómo se cuenta cada paso en el resumen del pliegue: «2 en compra». El visto
 * de Diseño se parte en dos: si espera el sustento, no espera a Diseño.
 */
type EnElResumen = PasoDelInsumo | 'SUSTENTO'
const ORDEN_DEL_RESUMEN: readonly EnElResumen[] = ['SUSTENTO', ...PASOS_DEL_INSUMO]
const EN_EL_RESUMEN: Record<EnElResumen, string> = {
  SUSTENTO: 'esperando el sustento',
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
  /** La OC todavía espera la aprobación de Gerencia: su fecha es la que espera Logística. */
  porAprobar: boolean
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
 * qué va cada insumo y cuándo llega lo que falta; y si falta el sustento para
 * Diseño, lo dice primero. El sustento lo escribe quien registró el RQ
 * (`rq_exigir_del_area`): a él se le pide, con el enlace; a los demás del área
 * solo se les dice que espera (`yo` es quien mira).
 */
export function InsumosDelRequerimiento({
  rq,
  seguimiento,
  yo,
}: {
  rq: RequerimientoListado
  seguimiento: Map<string, SeguimientoDelInsumo> | null
  yo: string
}) {
  if (rq.lineas.length === 0 || rq.estado === 'ANULADO') return null
  const hoy = hoyLima()
  const insumos: Insumo[] = rq.lineas.map((l) => {
    const s = seguimiento?.get(`${rq.id}:${l.item}`) ?? null
    const paso = pasoDelInsumo(l, s?.visto_diseno ?? null)
    const llega = paso !== null && ESPERA_LA_COMPRA.includes(paso.actual) ? (s?.fecha_esperada ?? null) : null
    return { linea: l, seguimiento: s, paso, llega, porAprobar: l.etapa === 'OC_POR_APROBAR' }
  })
  // Lo que espera el sustento, antes de la revisión o ya revisado (no sale sin él).
  const sinSustento = insumos.filter(
    (i) => (i.paso?.frenado || i.paso?.frenaLaSalida) && VISTO_QUE_PIDE_SUSTENTO.includes(i.seguimiento?.visto_diseno ?? ''),
  )
  const faltaSustento = sinSustento.length > 0
  const rechazado = sinSustento.some((i) => i.seguimiento?.visto_diseno === 'RECHAZADO')
  const pideSustento = faltaSustento && rq.creado_por === yo

  return (
    <Pliegue
      enCaja
      titulo={
        <TituloDelPliegue
          insumos={insumos}
          faltaSustento={faltaSustento}
          rechazado={rechazado}
          pideSustento={pideSustento}
          terminado={rq.estado === 'ENTREGADO'}
          hoy={hoy}
        />
      }
      className="mt-1"
      data-insumos-del-rq={rq.id}
    >
      {pideSustento ? (
        <p className={cn('mb-2 text-sm', rechazado ? 'text-peligro' : 'text-aviso')} data-pide-sustento>
          {rechazado
            ? 'Diseño no autorizó lo que se pasa del metrado: corrige tu sustento o pide solo lo que dice el metrado.'
            : 'Se pasa del metrado de Diseño y espera tu sustento.'}
          <Link
            href={`/requerimientos?rq=${rq.id}`}
            className="mt-1 flex min-h-11 w-fit items-center font-medium text-acento hover:underline sm:min-h-0 sm:pointer-coarse:min-h-11"
          >
            {rechazado ? 'Corrige el sustento en el RQ' : 'Escribe el sustento en el RQ'}
          </Link>
        </p>
      ) : (
        faltaSustento && (
          <p className={cn('mb-2 text-sm', rechazado ? 'text-peligro' : 'text-aviso')} data-espera-sustento>
            {rechazado
              ? 'Diseño no autorizó lo que se pasa del metrado: espera que quien registró el RQ corrija el sustento.'
              : 'Se pasa del metrado de Diseño y espera el sustento de quien registró el RQ.'}
          </p>
        )
      )}
      <ol className="divide-y divide-borde" aria-label={`Insumos de ${rq.numero}`}>
        {insumos.map(({ linea: l, seguimiento: s, paso, llega, porAprobar }) => {
          const visto = s?.visto_diseno ?? null
          const etapa = l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : undefined
          // El visto solo se dice si sigue valiendo: autorizado, o frenando ahora.
          const vistoDice = visto && (paso?.frenado || paso?.frenaLaSalida || visto === 'AUTORIZADO') ? VISTO_DEL_INSUMO[visto] : undefined
          const atrasada = llega !== null && llega < hoy
          const salio = l.entregado !== null && l.entregado > 0 ? l.entregado : null
          const parte = salio !== null && salio < l.cantidad
          const titulo = paso && !paso.faltante ? TITULO_PASO_DEL_INSUMO[paso.actual] : null
          // La línea de abajo: el freno de Diseño, o la etapa; si ya salió entero,
          // «Entregado»; si el RQ se entregó sin todo, lo que no salió.
          const dice =
            paso?.frenado && vistoDice
              ? vistoDice
              : paso?.faltante
                ? { etiqueta: `Entregado con faltante: no salió ${cantidad(paso.faltante)} ${l.unidad}`, tono: 'aviso' as Tono }
                : paso?.actual === 'ENTREGADO'
                  ? { etiqueta: 'Entregado', tono: 'neutro' as Tono }
                  : etapa
          return (
            <li
              key={l.id}
              className="space-y-1.5 py-2.5 first:pt-0 last:pb-0"
              data-insumo={l.item}
              data-paso={paso?.actual}
              data-faltante={paso?.faltante ?? undefined}
            >
              <p className="text-sm break-words text-texto">
                <span className="tabular text-texto-suave">{l.item}.</span> {l.descripcion}
                <span className="tabular text-texto-suave">
                  {' · '}
                  {cantidad(l.cantidad)} {l.unidad}
                </span>
              </p>
              {paso && <PasosDelInsumo item={l.item} {...paso} rechazado={visto === 'RECHAZADO' && paso.frenado} conFaltante={paso.faltante !== null} />}
              <p className="text-xs break-words text-texto-suave">
                {/* En el teléfono no se ven los nombres de los pasos: el de ahora va aquí, si la línea no lo dice ya. */}
                {titulo && titulo !== dice?.etiqueta && <span className="font-medium text-texto sm:hidden">{titulo} · </span>}
                {/* Sin el visto no sale: la etapa no se pinta en verde aunque ya esté en almacén. */}
                <span className={cn(TEXTO[paso?.frenaLaSalida ? 'aviso' : (dice?.tono ?? 'neutro')], titulo === dice?.etiqueta && 'sm:hidden')}>
                  {dice?.etiqueta ?? 'Sin etapa'}
                </span>
                {llega && (
                  <span className={atrasada ? 'text-aviso' : undefined} data-llega={llega}>
                    {' · '}
                    {cuandoLlega({ llega, atrasada, porAprobar, quienCompra: quienCompra(rq) })}
                  </span>
                )}
              </p>
              {/* El visto se dice aparte si el insumo siguió su camino: ya dado, o que le falta para salir del almacén. */}
              {vistoDice && !paso?.frenado && (
                <p className={cn('text-xs', TEXTO[vistoDice.tono])} data-frena-la-salida={paso?.frenaLaSalida || undefined}>
                  {vistoDice.etiqueta}
                  {paso?.frenaLaSalida && '. No sale del almacén hasta que Diseño lo autorice.'}
                </p>
              )}
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
 * adelantado, y la fecha más cercana en que llega lo que ya se aprobó comprar.
 */
function TituloDelPliegue({
  insumos,
  faltaSustento,
  rechazado,
  pideSustento,
  terminado,
  hoy,
}: {
  insumos: Insumo[]
  faltaSustento: boolean
  rechazado: boolean
  pideSustento: boolean
  terminado: boolean
  hoy: string
}) {
  const cuenta = new Map<EnElResumen, number>()
  for (const i of insumos) {
    if (!i.paso) continue
    // Lo que no sale del almacén sin el visto se cuenta por lo que espera, no por dónde está.
    const espera = i.paso.actual === 'VISTO_DISENO' || i.paso.frenaLaSalida
    const p: EnElResumen = !espera
      ? i.paso.actual
      : VISTO_QUE_PIDE_SUSTENTO.includes(i.seguimiento?.visto_diseno ?? '')
        ? 'SUSTENTO'
        : 'VISTO_DISENO'
    cuenta.set(p, (cuenta.get(p) ?? 0) + 1)
  }
  // Con un solo insumo, el número sobra: «en compra».
  const enPasos = ORDEN_DEL_RESUMEN.filter((p) => cuenta.has(p)).map((p) => {
    const n = cuenta.get(p) ?? 0
    return insumos.length === 1 ? EN_EL_RESUMEN[p] : `${n} ${n > 1 && p === 'ENTREGADO' ? 'entregados' : EN_EL_RESUMEN[p]}`
  })
  const llegan = insumos
    .filter((i) => !i.porAprobar)
    .map((i) => i.llega)
    .filter((d): d is string => d !== null)
    .sort()
  const resumen = enPasos.join(', ')
  // La fecha más cercana; si ya pasó, no se promete: se dice que se esperaba.
  const primera = llegan[0] ?? null
  const atrasada = primera !== null && primera < hoy
  const sustento = rechazado
    ? pideSustento
      ? 'Diseño no autorizó: corrige tu sustento'
      : 'Diseño no autorizó: espera otro sustento'
    : pideSustento
      ? 'Falta tu sustento para Diseño'
      : 'Espera el sustento para Diseño'
  return (
    <span className="block py-1.5" data-resumen-de-insumos>
      {faltaSustento && <span className={cn('block font-semibold', rechazado ? 'text-peligro' : 'text-aviso')}>{sustento}</span>}
      <span className="block">{insumos.length === 1 ? 'Cómo va su insumo' : `Cómo va cada insumo (${insumos.length})`}</span>
      {(resumen || primera) && !terminado && (
        <span className="block text-xs font-normal text-texto-suave first-letter:uppercase">
          {resumen}
          {primera && (
            <span className={atrasada ? 'text-aviso' : undefined} data-resumen-llega={primera}>
              {resumen ? ', ' : ''}
              {atrasada ? `se esperaba el ${fecha(primera)}` : `llega aprox. el ${fecha(primera)}`}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
