import type { ReactNode } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import type { EtapaDeCodigo } from '@/lib/datos/diseno-codigos'
import { AREAS_DE_PLANOS, estadoEtapa, plazoEtapa } from '@/lib/dominio/diseno-codigos'
import { fecha } from '@/lib/format'

const AREAS_QUE_REPORTAN: readonly string[] = AREAS_DE_PLANOS

/**
 * «2 de 6 terminadas · 1 vencida»: lo que Gerencia lee primero. Cuentan las
 * etapas de arriba, como el avance; vencidas, también las subetapas.
 */
export function resumenEtapas(etapas: EtapaDeCodigo[], hoy: string): string {
  const arriba = etapas.filter((e) => !e.padre_id)
  const terminadas = arriba.filter((e) => e.fin_real).length
  const vencidas = etapas.filter((e) => plazoEtapa(e, hoy).tono === 'peligro').length
  return [`${terminadas} de ${arriba.length} ${arriba.length === 1 ? 'terminada' : 'terminadas'}`, vencidas > 0 && `${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}`]
    .filter(Boolean)
    .join(' · ')
}

/** Dónde está la etapa entre las de su nivel: para las flechas de subir y bajar. */
export type LugarDeEtapa = { primera: boolean; ultima: boolean; subetapas: EtapaDeCodigo[] }

/**
 * Las etapas de arriba con sus subetapas debajo. Una subetapa cuya etapa de
 * arriba no viene en la lista (otra área) va como de arriba.
 */
export function etapasConSubetapas(etapas: EtapaDeCodigo[]): { etapa: EtapaDeCodigo; subetapas: EtapaDeCodigo[] }[] {
  const ids = new Set(etapas.map((e) => e.id))
  const arriba = etapas.filter((e) => !e.padre_id || !ids.has(e.padre_id))
  return arriba.map((etapa) => ({ etapa, subetapas: etapas.filter((s) => s.padre_id === etapa.id) }))
}

/**
 * Las etapas de un código en su orden, como la hoja «Control de plazos»: lo
 * planeado, lo real, el semáforo contra la fecha comprometida y lo que dice el
 * reporte diario del área. Las subetapas que agregó cada área van debajo de su
 * etapa. Diseño y el supervisor ponen sus botones en `acciones`.
 */
export function ListaEtapas({
  etapas,
  hoy,
  acciones,
  conPlanosConPeso = false,
}: {
  etapas: EtapaDeCodigo[]
  hoy: string
  acciones?: (etapa: EtapaDeCodigo, lugar: LugarDeEtapa) => ReactNode
  /** El código tiene planos con % de la unidad: su avance no entra al de la etapa, y se dice. */
  conPlanosConPeso?: boolean
}) {
  const grupos = etapasConSubetapas(etapas)
  return (
    <ol className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
      {grupos.map(({ etapa, subetapas }, i) => (
        <li key={etapa.id}>
          <FilaEtapa
            e={etapa}
            numero={`${i + 1}.`}
            hoy={hoy}
            conPlanosConPeso={conPlanosConPeso}
            acciones={acciones?.(etapa, { primera: i === 0, ultima: i === grupos.length - 1, subetapas })}
          />
          {subetapas.length > 0 && (
            <ol aria-label={`Subetapas de ${etapa.nombre}`} className="ml-6 border-l-2 border-borde pb-1">
              {subetapas.map((s, j) => (
                <li key={s.id} className="border-t border-borde first:border-t-0">
                  <FilaEtapa
                    e={s}
                    numero={`${i + 1}.${j + 1}`}
                    hoy={hoy}
                    conPlanosConPeso={conPlanosConPeso}
                    sub
                    acciones={acciones?.(s, { primera: j === 0, ultima: j === subetapas.length - 1, subetapas: [] })}
                  />
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  )
}

function FilaEtapa({
  e,
  numero,
  hoy,
  conPlanosConPeso,
  sub = false,
  acciones,
}: {
  e: EtapaDeCodigo
  numero: string
  hoy: string
  conPlanosConPeso: boolean
  sub?: boolean
  acciones?: ReactNode
}) {
  const estado = estadoEtapa(e)
  const plazo = plazoEtapa(e, hoy)
  // En el teléfono los botones van debajo: al lado dejaban el nombre en 60 px (auditoría del 27/10/2026).
  return (
    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between" data-etapa={e.nombre} data-subetapa={sub || undefined}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular text-xs text-texto-suave">{numero}</span>
          <p className={sub ? 'text-sm text-texto' : 'font-medium text-texto'}>{e.nombre}</p>
          {!sub && <span className="text-xs text-texto-suave">{e.area ?? 'Sin área del taller'}</span>}
          {!sub && e.de_area && <span className="text-xs text-texto-tenue">la agregó el área</span>}
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
        {/* El reporte diario lo suben las áreas de producción; de Diseño o de Calidad no se espera.
            La subetapa es de la misma área que su etapa: el reporte ya se dice arriba. */}
        {!sub && e.area_id && (e.reportes > 0 || (e.area_codigo !== null && AREAS_QUE_REPORTAN.includes(e.area_codigo))) && (
          <div className={e.avance_reportado !== null ? 'grid max-w-md grid-cols-[1fr_6.5rem] items-center gap-3 text-xs' : 'text-xs'}>
            <span className="text-texto-suave">
              {/* El reporte es del área en el código, no de la etapa: con dos juegos de
                  planos o subetapas, la que no empezó no lo toma (migración 20261106100000). */}
              {e.reportes > 0 && !e.inicio_real && !e.fin_real && e.avance_reportado === null
                ? `Todavía no empieza: el reporte diario de ${e.area} cuenta para esta etapa desde que empiece`
                : e.reportes > 0
                ? `${e.reportes} ${e.reportes === 1 ? 'reporte diario' : 'reportes diarios'} de ${e.area}, ${
                    e.primer_reporte === e.ultimo_reporte ? `el ${fecha(e.ultimo_reporte)}` : `del ${fecha(e.primer_reporte)} al ${fecha(e.ultimo_reporte)}`
                  }`
                : `${e.area} no subió reportes de este código`}
              {conPlanosConPeso &&
                e.reportes > 0 &&
                (e.inicio_real || e.fin_real || e.avance_reportado !== null) &&
                (e.avance_reportado !== null
                  ? ' · sin los planos con % de la unidad, que cuentan aparte'
                  : ' · solo reportó planos con % de la unidad, que cuentan aparte')}
            </span>
            {e.avance_reportado !== null && <Progreso valor={e.avance_reportado} alto="sm" mostrarValor etiqueta={`Avance reportado de ${e.nombre}`} />}
          </div>
        )}
        {e.nota && <p className="text-xs text-texto">Nota: {e.nota}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-1">{acciones}</div>}
    </div>
  )
}
