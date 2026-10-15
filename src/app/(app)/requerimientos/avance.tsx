import { ChevronDown } from 'lucide-react'

import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import type { LineaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import { ATENCION_INSUMO, ETAPA_AVANCE_RQ, atencionDelInsumo, resumenDeAtencion, resumenDeEtapas } from '@/lib/dominio/requerimientos'
import { cantidad, fechaHora } from '@/lib/format'

const COLOR: Record<Tono, string> = {
  neutro: 'text-texto-suave',
  exito: 'text-exito',
  aviso: 'text-aviso',
  peligro: 'text-peligro',
  info: 'text-info',
  acento: 'text-acento',
}

/**
 * En qué porcentaje va el RQ: la barra, la etapa del insumo más atrasado y,
 * cuando los insumos van separados, cuántos hay en cada etapa. Lo comparten
 * Requerimientos y Atención de requerimiento.
 */
export function AvanceDelRequerimiento({ rq }: { rq: RequerimientoListado }) {
  if (!rq.avance) return null
  const etapa = ETAPA_AVANCE_RQ[rq.avance.etapa]
  const resumen = resumenDeEtapas(rq.lineas.map((l) => l.etapa))
  return (
    <div className="mt-2 w-48 max-w-full space-y-0.5">
      <Progreso valor={rq.avance.porcentaje} mostrarValor alto="sm" etiqueta={`Avance de ${rq.numero}`} />
      <p className={`text-[11px] font-medium ${COLOR[etapa?.tono ?? 'neutro']}`}>{etapa?.etiqueta ?? rq.avance.etapa}</p>
      {resumen && <p className="text-[11px] text-texto-suave">{resumen}</p>}
    </div>
  )
}

/**
 * De dónde sale el insumo: el código del catálogo de Almacén, o «material nuevo»
 * mientras Almacén no lo da de alta. Va delante de la categoría.
 */
export function MaterialDelInsumo({ linea: l }: { linea: LineaRequerimiento }) {
  if (l.material_nuevo && !l.material_id) {
    return <span className="font-medium text-aviso">Material nuevo: Almacén lo da de alta al revisarlo · </span>
  }
  if (!l.material_codigo) return null
  return (
    <>
      <span className="tabular">{l.material_codigo}</span>
      {l.material_nuevo && <span className="text-texto"> (pedido como material nuevo)</span>}
      {' · '}
    </>
  )
}

/**
 * La OC del insumo y en qué va. Mientras el RQ está por comprar o en compra
 * cada insumo va por su lado (lo que tenía Almacén, su OC, su recojo); antes y
 * después van todos juntos y basta la etapa del RQ.
 */
export function CompraDelInsumo({ linea: l, estadoRq }: { linea: LineaRequerimiento; estadoRq: string }) {
  const porInsumo = estadoRq === 'SIN_STOCK' || estadoRq === 'EN_ATENCION'
  const etapa = porInsumo && l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  // Almacén tenía una parte: se compra solo el resto.
  const parte = porInsumo && l.en_stock !== null && l.en_stock > 0 && l.por_comprar !== null && l.por_comprar > 0
  if (!l.orden_compra && !etapa && !parte) return null
  return (
    <>
      {parte && (
        <>
          {' · '}
          <span className="text-texto">
            Almacén tiene {cantidad(l.en_stock ?? 0)} {l.unidad}, se compran {cantidad(l.por_comprar ?? 0)}
          </span>
        </>
      )}
      {l.orden_compra && (
        <>
          {' · '}
          <span className={`tabular ${l.compra_rechazada ? 'text-peligro' : 'text-texto'}`}>
            {l.orden_compra}
            {l.compra_rechazada ? ' rechazada' : ''}
          </span>
        </>
      )}
      {etapa && (
        <>
          {' · '}
          <span className={COLOR[etapa.tono]}>{etapa.etiqueta}</span>
          {l.etapa_desde && <span> desde {fechaHora(l.etapa_desde)}</span>}
        </>
      )}
    </>
  )
}

/**
 * Los insumos del RQ, que se despliegan al presionar: cada uno con quién lo da
 * —Almacén de su stock, una compra, o los dos— y en qué va. Cerrado dice
 * cuántos son y cuántos da Almacén y cuántos van a compra. Lo pidió Supervisión
 * (2026-10-15): en un mismo RQ unos insumos los entrega Almacén y otros esperan
 * su compra.
 */
export function InsumosDelRequerimiento({ rq, abierto }: { rq: RequerimientoListado; abierto: boolean }) {
  const atenciones = rq.lineas.map((l) => atencionDelInsumo(l, rq.estado))
  const resumen = resumenDeAtencion(atenciones)
  const total = rq.lineas.length
  return (
    <details open={abierto || undefined} className="group" data-insumos={rq.numero}>
      <summary className="flex min-h-11 cursor-pointer list-none items-start gap-1.5 rounded-[var(--radius-base)] py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento sm:min-h-0 [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave transition-transform group-open:rotate-180" />
        <span className="min-w-0 text-xs">
          <span className="font-medium text-acento group-open:text-texto">
            {total} {total === 1 ? 'insumo' : 'insumos'}
            <span className="font-normal text-texto-suave group-open:hidden"> · ver cada uno</span>
          </span>
          {resumen && <span className="block text-[11px] text-texto-suave">{resumen}</span>}
        </span>
      </summary>
      <ul className="mt-2 space-y-2.5 border-l border-borde pl-3 text-xs">
        {rq.lineas.map((l, i) => (
          <InsumoDelRequerimiento key={l.item} linea={l} atencion={atenciones[i]} />
        ))}
      </ul>
    </details>
  )
}

function InsumoDelRequerimiento({ linea: l, atencion }: { linea: LineaRequerimiento; atencion: ReturnType<typeof atencionDelInsumo> }) {
  const def = atencion ? ATENCION_INSUMO[atencion] : null
  const etapa = l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  // «Almacén lo tiene» repite «Lo da Almacén»: la etapa se dice cuando agrega algo.
  const etapaDice = etapa && !(atencion === 'ALMACEN' && l.etapa === 'EN_STOCK') && !(atencion === 'POR_REVISAR' && l.etapa === 'POR_REVISAR')
  return (
    <li data-insumo={l.item}>
      <p>
        <span className="tabular font-medium text-texto">
          {cantidad(l.cantidad)} {l.unidad}
        </span>{' '}
        <span className="text-texto">{l.descripcion}</span>
      </p>
      <p className="text-[11px] text-texto-suave">
        <MaterialDelInsumo linea={l} />
        {l.categoria}
      </p>
      {def && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-texto-suave">
          <Insignia tono={def.tono} title={def.descripcion}>
            {def.etiqueta}
          </Insignia>
          {atencion === 'ALMACEN_Y_COMPRA' && l.en_stock !== null && (
            <span className="text-texto">
              Almacén {cantidad(l.en_stock)} · compra {cantidad(l.por_comprar ?? 0)} {l.unidad}
            </span>
          )}
          {l.orden_compra && (
            <span className={`tabular ${l.compra_rechazada ? 'text-peligro' : 'text-texto'}`}>
              {l.orden_compra}
              {l.compra_rechazada ? ' rechazada' : ''}
            </span>
          )}
          {etapaDice && etapa && (
            <span className={COLOR[etapa.tono]}>
              {etapa.etiqueta}
              {l.etapa_desde && <span className="text-texto-suave"> desde {fechaHora(l.etapa_desde)}</span>}
            </span>
          )}
        </p>
      )}
    </li>
  )
}
