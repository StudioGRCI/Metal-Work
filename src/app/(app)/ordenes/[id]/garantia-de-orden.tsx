import { garantiaTerminada } from '@/lib/datos/ordenes'
import { fechaHora, puesto } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'

import { TerminarGarantia } from './terminar-garantia'

/** Estados en los que la OT de garantía ya cuenta como terminada sin la marca. */
const YA_TERMINADA = ['TERMINADA', 'ENTREGADA', 'FACTURADA']

/**
 * La garantía terminada, en la cabecera de la OT de garantía (migración
 * 20261021120000). La da por terminada Administración cuando el taller avisa,
 * sin mover el estado de la OT, y es lo que espera la salida del vehículo
 * junto con el visto de Tesorería. Antes de la aprobación de Gerencia, o
 * anulada, no hay nada que decir.
 */
export async function GarantiaDeOrden({ orden, perfil }: {
  orden: { id: string; numero: string; estado: string; tipo_trabajo: string }
  perfil: PerfilSesion
}) {
  if (orden.tipo_trabajo !== 'GARANTIA' || orden.estado === 'BORRADOR' || orden.estado === 'ANULADA') return null

  const marca = await garantiaTerminada(orden.id)
  if (marca) {
    return (
      <p role="status" className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
        <strong>Garantía terminada</strong> el {fechaHora(marca.terminada_en)}
        {marca.quien ? ` por ${puesto(marca.quien)}` : ''}
        {marca.nota ? `: ${marca.nota.replace(/[\s.]+$/, '')}.` : '.'} Con el visto de Tesorería, el vehículo sale.
      </p>
    )
  }
  if (YA_TERMINADA.includes(orden.estado)) return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
      <p>
        <strong>Garantía por terminar.</strong>{' '}
        {puede(perfil, 'ordenes.editar')
          ? 'Cuando el taller avise que terminó, dala por terminada: el vehículo sale con el visto de Tesorería.'
          : 'Administración la da por terminada cuando el taller avise; hasta entonces el vehículo no sale.'}
      </p>
      {puede(perfil, 'ordenes.editar') && <TerminarGarantia ordenId={orden.id} numero={orden.numero} />}
    </div>
  )
}
