import { Insignia } from '@/components/ui/etiqueta-estado'
import type { CodigoDeDiseno } from '@/lib/datos/diseno-codigos'
import { fecha } from '@/lib/format'

/**
 * En una línea, lo que Diseño lleva en el código: la etapa en curso con su
 * fecha comprometida, las vencidas y los planos que el área no recibió. Va en
 * la fila de la lista de Gerencia y debajo de las cifras del detalle.
 */
export function LineaDeDiseno({ d }: { d: CodigoDeDiseno | undefined }) {
  if (!d || d.planos + d.etapas + d.materiales === 0) {
    return <p className="text-xs text-texto-suave">Diseño todavía no cargó planos ni etapas.</p>
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-texto-suave">
      {d.etapas > 0 && (
        <span>
          {d.etapa_actual ? (
            <>
              Etapa <span className="text-texto">{d.etapa_actual}</span>
              {d.etapa_actual_area && ` (${d.etapa_actual_area})`}
              {d.etapa_actual_fin && ` hasta el ${fecha(d.etapa_actual_fin)}`}
            </>
          ) : (
            <span className="text-texto">Todas las etapas terminadas</span>
          )}{' '}
          · {d.etapas_terminadas} de {d.etapas}
        </span>
      )}
      {d.etapas_vencidas > 0 && (
        <Insignia tono="peligro">
          {d.etapas_vencidas} {d.etapas_vencidas === 1 ? 'etapa vencida' : 'etapas vencidas'}
        </Insignia>
      )}
      {d.planos > 0 && (
        <span>
          {d.planos} {d.planos === 1 ? 'plano' : 'planos'}
          {d.planos_por_recibir > 0 && <span className="text-aviso"> · {d.planos_por_recibir} sin recibir</span>}
        </span>
      )}
      {d.materiales > 0 && (
        <span>
          {d.materiales} {d.materiales === 1 ? 'material' : 'materiales'} en la lista
        </span>
      )}
    </p>
  )
}
