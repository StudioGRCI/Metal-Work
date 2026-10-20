import type { ReactNode } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import type { EtapaDeCodigo } from '@/lib/datos/diseno-codigos'
import { AREAS_DE_PLANOS, estadoEtapa, plazoEtapa } from '@/lib/dominio/diseno-codigos'
import { fecha } from '@/lib/format'

const AREAS_QUE_REPORTAN: readonly string[] = AREAS_DE_PLANOS

/** «2 de 6 terminadas · 1 vencida»: lo que Gerencia lee primero. */
export function resumenEtapas(etapas: EtapaDeCodigo[], hoy: string): string {
  const terminadas = etapas.filter((e) => e.fin_real).length
  const vencidas = etapas.filter((e) => plazoEtapa(e, hoy).tono === 'peligro').length
  return [`${terminadas} de ${etapas.length} ${etapas.length === 1 ? 'terminada' : 'terminadas'}`, vencidas > 0 && `${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}`]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Las etapas de un código en su orden, como la hoja «Control de plazos»: lo
 * planeado, lo real, el semáforo contra la fecha comprometida y lo que dice el
 * reporte diario del área. Diseño y el supervisor ponen sus botones en `acciones`.
 */
export function ListaEtapas({
  etapas,
  hoy,
  acciones,
  conPlanosConPeso = false,
}: {
  etapas: EtapaDeCodigo[]
  hoy: string
  acciones?: (etapa: EtapaDeCodigo, i: number) => ReactNode
  /** El código tiene planos con % de la unidad: su avance no entra al de la etapa, y se dice. */
  conPlanosConPeso?: boolean
}) {
  return (
    <ol className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
      {etapas.map((e, i) => {
        const estado = estadoEtapa(e)
        const plazo = plazoEtapa(e, hoy)
        return (
          <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-3" data-etapa={e.nombre}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-xs text-texto-suave">{i + 1}.</span>
                <p className="font-medium text-texto">{e.nombre}</p>
                <span className="text-xs text-texto-suave">{e.area ?? 'Sin área del taller'}</span>
                <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                <Insignia tono={plazo.tono}>{plazo.etiqueta}</Insignia>
              </div>
              <p className="text-xs text-texto-suave">
                Plan: {e.inicio_plan ? fecha(e.inicio_plan) : 'sin inicio'} → {e.fin_plan ? fecha(e.fin_plan) : 'sin fecha comprometida'}
                {(e.inicio_real || e.fin_real) && (
                  <span className="text-texto">
                    {' '}
                    · Real: {e.inicio_real ? fecha(e.inicio_real) : '—'} → {e.fin_real ? fecha(e.fin_real) : 'en curso'}
                  </span>
                )}
              </p>
              {/* El reporte diario lo suben las áreas de producción; de Diseño o de Calidad no se espera. */}
              {e.area_id && (e.reportes > 0 || (e.area_codigo !== null && AREAS_QUE_REPORTAN.includes(e.area_codigo))) && (
                <div className={e.avance_reportado !== null ? 'grid max-w-md grid-cols-[1fr_6.5rem] items-center gap-3 text-xs' : 'text-xs'}>
                  <span className="text-texto-suave">
                    {e.reportes > 0
                      ? `${e.reportes} ${e.reportes === 1 ? 'reporte diario' : 'reportes diarios'} de ${e.area}, ${
                          e.primer_reporte === e.ultimo_reporte ? `el ${fecha(e.ultimo_reporte)}` : `del ${fecha(e.primer_reporte)} al ${fecha(e.ultimo_reporte)}`
                        }`
                      : `${e.area} no subió reportes de este código`}
                    {conPlanosConPeso &&
                      e.reportes > 0 &&
                      (e.avance_reportado !== null
                        ? ' · sin los planos con % de la unidad, que cuentan aparte'
                        : ' · solo reportó planos con % de la unidad, que cuentan aparte')}
                  </span>
                  {e.avance_reportado !== null && <Progreso valor={e.avance_reportado} alto="sm" mostrarValor etiqueta={`Avance reportado de ${e.nombre}`} />}
                </div>
              )}
              {e.nota && <p className="text-xs text-texto">Nota: {e.nota}</p>}
            </div>
            {acciones && <div className="flex flex-wrap items-center gap-1">{acciones(e, i)}</div>}
          </li>
        )
      })}
    </ol>
  )
}
