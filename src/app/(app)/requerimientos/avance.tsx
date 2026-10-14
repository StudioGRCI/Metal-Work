import type { Tono } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import type { LineaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import { ETAPA_AVANCE_RQ, resumenDeEtapas } from '@/lib/dominio/requerimientos'
import { fechaHora } from '@/lib/format'

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
 * La OC del insumo y en qué va. Mientras el RQ está sin stock o en compra cada
 * insumo va por su lado (su OC, su recojo); antes y después van todos juntos y
 * basta la etapa del RQ.
 */
export function CompraDelInsumo({ linea: l, estadoRq }: { linea: LineaRequerimiento; estadoRq: string }) {
  const porInsumo = estadoRq === 'SIN_STOCK' || estadoRq === 'EN_ATENCION'
  const etapa = porInsumo && l.etapa ? ETAPA_AVANCE_RQ[l.etapa] : null
  if (!l.orden_compra && !etapa) return null
  return (
    <>
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
