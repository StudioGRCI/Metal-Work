import { Camera } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { AccionesDeFila } from '@/components/ui/tabla'
import type { AccionSsoma, CuentaParaAsignar, PasoDeAccion } from '@/lib/datos/ssoma'
import { cuandoVence, ESTADO_ACCION_SSOMA, PASO_ACCION_SSOMA } from '@/lib/dominio/ssoma'
import { fecha, fechaHora } from '@/lib/format'
import { cn } from '@/lib/utils'

import { AnularAccion, AvisoDelCierre, CerrarAccion, ReabrirAccion, ReasignarAccion } from './[id]/controles'
import { Galeria } from './galeria'

/*
 * La acción correctiva como se ve en su ficha: la del reporte (15.2) y la de la
 * inspección (15.4) pintan la misma, con los mismos botones.
 */

/**
 * Una acción: qué se corrige, quién, hasta cuándo y cómo va, con lo que puede
 * hacer quien mira. Su historia y su evidencia, para quien la base deja verlas.
 */
export function FilaAccion({
  accion: a,
  historia,
  esMia,
  gestiona,
  cuentaId,
  cuentas,
  hoy,
  corregido = false,
}: {
  accion: AccionSsoma
  historia: PasoDeAccion[]
  esMia: boolean
  gestiona: boolean
  cuentaId: string
  cuentas: CuentaParaAsignar[]
  hoy: string
  /** El reporte de la acción ya está corregido: reabrirla lo vuelve a «En corrección». */
  corregido?: boolean
}) {
  const estado = ESTADO_ACCION_SSOMA[a.estado]
  const vence = a.estado === 'ABIERTA' ? cuandoVence(a.dias_para_vencer) : null
  const vencida = (a.dias_para_vencer ?? 0) < 0 && a.estado === 'ABIERTA'
  const abierta = a.estado === 'ABIERTA'
  const cierra = abierta && (esMia || gestiona)
  const ultimoCierre = [...historia].reverse().find((p) => p.tipo === 'CERRADA')
  return (
    <li
      id={`accion-${a.id}`}
      className={cn(
        'scroll-mt-20 py-4 first:pt-0 last:pb-0 target:rounded-lg target:bg-acento-suave/40',
        a.estado === 'ANULADA' && 'opacity-80',
      )}
      data-accion-ssoma={a.id}
      data-estado={a.estado}
      data-vencida={vencida || undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : a.estado}
            {vence && (
              <Insignia tono={vence.tono}>
                <span className="tabular">{vence.texto}</span>
              </Insignia>
            )}
            {esMia && abierta && <span className="text-xs font-medium text-acento">A tu cargo</span>}
          </div>
          <p
            className={cn(
              'max-w-3xl text-sm whitespace-pre-wrap text-texto',
              a.estado === 'ANULADA' && 'line-through decoration-texto-tenue',
            )}
          >
            {a.descripcion}
          </p>
          <p className="tabular text-xs text-texto-suave">
            {a.responsable}
            {a.responsable_puesto ? ` · ${a.responsable_puesto}` : ''} · hasta el {fecha(a.fecha_limite)}
          </p>
          {a.estado === 'CERRADA' && (
            <div className="mt-2 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-xs text-texto">
              <p className="tabular text-texto-suave">
                Cerró {a.cerro ?? 'el responsable'}
                {a.cerrado_en ? ` · ${fechaHora(a.cerrado_en)}` : ''}
                {a.fotos > 0 && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    · <Camera aria-hidden className="size-3.5" /> {a.fotos} {a.fotos === 1 ? 'foto' : 'fotos'}
                  </span>
                )}
              </p>
              {a.nota_cierre && <p className="mt-1 whitespace-pre-wrap">{a.nota_cierre}</p>}
            </div>
          )}
          <AvisoDelCierre accionId={a.id} />
          {a.estado === 'ANULADA' && a.motivo_anulacion && <p className="text-xs text-texto-suave">Anulada: {a.motivo_anulacion}</p>}
          {ultimoCierre && ultimoCierre.fotosDelCierre.length > 0 && a.estado === 'CERRADA' && (
            <div className="pt-2">
              <Galeria fotos={ultimoCierre.fotosDelCierre} texto={(f) => `Foto ${f.orden} de la evidencia`} />
            </div>
          )}
        </div>
        {(cierra || (gestiona && a.estado !== 'ANULADA')) && (
          // Lo de su responsable, relleno; lo de SSOMA, de contorno, y anular al final.
          <AccionesDeFila className="sm:max-w-sm">
            {cierra && <CerrarAccion accionId={a.id} cuentaId={cuentaId} descripcion={a.descripcion} principal={esMia} />}
            {gestiona && abierta && (
              <ReasignarAccion id={a.id} responsableId={a.responsable_id} fechaLimite={a.fecha_limite} cuentas={cuentas} hoy={hoy} />
            )}
            {gestiona && a.estado === 'CERRADA' && <ReabrirAccion id={a.id} hoy={hoy} corregido={corregido} />}
            {gestiona && abierta && <AnularAccion id={a.id} />}
          </AccionesDeFila>
        )}
      </div>
      {historia.length > 1 && <HistoriaDeAccion pasos={historia} />}
    </li>
  )
}

function HistoriaDeAccion({ pasos }: { pasos: PasoDeAccion[] }) {
  return (
    <Pliegue enCaja className="mt-3" titulo={`Historia · ${pasos.length} pasos`} data-historia-accion="">
      <ol className="space-y-3">
        {pasos.map((p) => (
          <li key={p.id} className="text-xs">
            <p className="text-texto">
              <span className="font-medium">{PASO_ACCION_SSOMA[p.tipo] ?? p.tipo}</span>
              <span className="text-texto-suave">
                {' '}
                · {p.hizo}
                {p.hizo_puesto ? ` (${p.hizo_puesto})` : ''}
              </span>
            </p>
            <time dateTime={p.creado_en} className="tabular block text-texto-suave">
              {fechaHora(p.creado_en)}
            </time>
            {(p.tipo === 'ASIGNADA' || p.tipo === 'REASIGNADA' || p.tipo === 'REABIERTA') && (
              <p className="tabular text-texto-suave">
                A cargo de {p.responsable ?? '—'}
                {p.fecha_limite ? `, hasta el ${fecha(p.fecha_limite)}` : ''}
              </p>
            )}
            {p.nota && <p className="mt-0.5 max-w-2xl whitespace-pre-wrap text-texto-suave">{p.nota}</p>}
            {p.tipo === 'CERRADA' && p.fotosDelCierre.length > 0 && (
              <div className="mt-2 max-w-md">
                <Galeria fotos={p.fotosDelCierre} texto={(f) => `Foto ${f.orden} del cierre del ${fechaHora(p.creado_en)}`} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </Pliegue>
  )
}
