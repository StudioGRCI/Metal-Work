import { FileText } from 'lucide-react'
import type { ReactNode } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import type { PlanoDeCodigo, RevisionDePlano } from '@/lib/datos/diseno-codigos'
import { tamanoArchivo } from '@/lib/dominio/diseno-codigos'
import { cantidad, fecha, fechaHora } from '@/lib/format'

/** El PDF se abre por la ruta que pide el enlace firmado en el momento del toque. */
export function enlacePdfPlano(revision: string) {
  return `/planos/archivo/${revision}`
}

/**
 * Los planos de un código por área, con su revisión vigente, si el área la
 * recibió y lo que cambió. La usan Diseño, el supervisor y Gerencia: cada uno
 * pone sus botones en `acciones`. Los anulados van al final, con su motivo.
 */
export function ListaPlanos({
  planos,
  historial,
  acciones,
  avisarSinPeso = false,
}: {
  planos: PlanoDeCodigo[]
  /** Las revisiones de los planos que tienen más de una, por plano. */
  historial?: Map<string, RevisionDePlano[]>
  acciones?: (plano: PlanoDeCodigo) => ReactNode
  /** Solo para Diseño, que es quien le pone el porcentaje: el plano sin él sale con aviso. */
  avisarSinPeso?: boolean
}) {
  const vigentes = planos.filter((p) => !p.anulado_en)
  const anulados = planos.filter((p) => p.anulado_en)
  const areas = [...new Set(vigentes.map((p) => p.area))]
  return (
    <div className="space-y-4">
      {areas.map((area) => {
        const deArea = vigentes.filter((p) => p.area === area)
        const porRecibir = deArea.filter((p) => !p.recibido_en).length
        return (
          <section key={area} aria-label={`Planos para ${area}`} data-area={area}>
            <h3 className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-texto">
              {area}
              <span className="text-xs font-normal text-texto-suave">
                {deArea.length} {deArea.length === 1 ? 'plano' : 'planos'}
                {porRecibir > 0 && ` · ${porRecibir} por recibir`}
              </span>
            </h3>
            <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
              {deArea.map((p) => (
                <FilaPlano key={p.id} plano={p} anteriores={historial?.get(p.id)?.filter((r) => r.id !== p.revision_id)} acciones={acciones?.(p)} avisarSinPeso={avisarSinPeso} />
              ))}
            </ul>
          </section>
        )
      })}
      {anulados.length > 0 && (
        <Pliegue titulo={`${anulados.length} ${anulados.length === 1 ? 'plano anulado' : 'planos anulados'}`} enCaja className="text-sm">
          <ul className="space-y-2">
            {anulados.map((p) => (
              <li key={p.id} data-plano={p.id}>
                <p className="text-texto line-through">
                  {p.numero} · {p.nombre} <span className="text-texto-suave">({p.area})</span>
                </p>
                <p className="text-xs text-texto-suave">
                  Anulado el {fecha(p.anulado_en)}: {p.motivo_anulacion}
                </p>
              </li>
            ))}
          </ul>
        </Pliegue>
      )}
    </div>
  )
}

function FilaPlano({
  plano: p,
  anteriores,
  acciones,
  avisarSinPeso,
}: {
  plano: PlanoDeCodigo
  anteriores?: RevisionDePlano[]
  acciones?: ReactNode
  avisarSinPeso: boolean
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 p-3" data-plano={p.id}>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-texto">
          <span className="font-mono">{p.numero}</span> · {p.nombre}{' '}
          <span className="text-xs font-normal text-texto-suave">
            R{p.revision}
            {p.revisiones > 1 && ` de ${p.revisiones}`}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {p.peso === null ? (
            avisarSinPeso && <Insignia tono="aviso">Sin % de la unidad</Insignia>
          ) : (
            <Insignia tono="neutro">
              <span className="tabular">{cantidad(p.peso)} %</span> de la unidad
            </Insignia>
          )}
          {p.recibido_en ? (
            <Insignia tono="exito">
              Recibido{p.recibido_por_area ? ` por ${p.recibido_por_area}` : ''} el {fecha(p.recibido_en)}
            </Insignia>
          ) : (
            <Insignia tono="aviso">{p.revision > 1 ? `R${p.revision} por recibir` : 'Por recibir'}</Insignia>
          )}
          {p.revision_id && (
            <a href={enlacePdfPlano(p.revision_id)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-acento hover:underline">
              <FileText aria-hidden className="size-3.5" />
              Abrir PDF{p.tamano_bytes ? ` (${tamanoArchivo(p.tamano_bytes)})` : ''}
            </a>
          )}
          <span className="text-texto-suave">Subido el {fechaHora(p.subido_en)}</span>
        </div>
        {p.cambios && <p className="text-xs text-texto">Cambió: {p.cambios}</p>}
        {p.observacion && <p className="text-xs text-texto-suave">{p.observacion}</p>}
        {anteriores && anteriores.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-texto-suave">Revisiones anteriores ({anteriores.length})</summary>
            <ul className="mt-1 space-y-1">
              {anteriores.map((r) => (
                <li key={r.id}>
                  <a href={enlacePdfPlano(r.id)} target="_blank" rel="noopener" className="text-acento hover:underline">
                    R{r.revision}
                  </a>{' '}
                  <span className="text-texto-suave">
                    del {fecha(r.subido_en)}
                    {r.recibido_en ? ` · recibida el ${fecha(r.recibido_en)}` : ' · no se recibió'}
                    {r.cambios && ` · ${r.cambios}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-1">{acciones}</div>}
    </li>
  )
}
