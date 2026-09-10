import { MessageSquareWarning } from 'lucide-react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import { REVISION, definir, type DatosRevision } from '@/lib/dominio/estados'
import { fecha, hora } from '@/lib/format'

/** La insignia de en qué va el reporte con el jefe: por aprobar, aprobado u observado. */
export function InsigniaRevision({ revision }: { revision: string | null }) {
  if (!revision) return null
  const def = definir(REVISION, revision)
  return (
    <Insignia tono={def.tono} title={def.descripcion}>
      {def.etiqueta}
    </Insignia>
  )
}

/**
 * Lo que dijo el jefe, cuando hay algo que decir. Observado: qué pidió corregir,
 * en rojo, porque es lo primero que tiene que ver quien lo escribió. Corregido
 * después de una observación: una línea chica, para que el jefe sepa que lo que
 * mira ya es lo nuevo.
 */
export function NotaRevision({ r }: { r: DatosRevision }) {
  if (r.revision === 'OBSERVADO' && r.observacion) {
    return (
      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
        <MessageSquareWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>
          <span className="font-medium">{r.revisado_por_nombre ?? 'El jefe'} pidió corregir:</span>{' '}
          {r.observacion}
        </span>
      </p>
    )
  }

  if (r.revision === 'PENDIENTE' && r.observacion && r.corregido_en) {
    return (
      <p className="text-[11px] text-texto-suave">
        Corregido el {fecha(r.corregido_en)} a las {hora(r.corregido_en)}, después de la observación «
        {r.observacion}». Espera el visto otra vez.
      </p>
    )
  }

  return null
}

/** La firma del visto bueno, para la línea de un trabajo o de una orden. */
export function FirmaRevision({ r }: { r: DatosRevision }) {
  if (r.revision !== 'APROBADO' || !r.revisado_en) return null
  return (
    <p className="text-[11px] text-texto-tenue">
      Aprobado por {r.revisado_por_nombre ?? '—'} el {fecha(r.revisado_en)}
    </p>
  )
}
