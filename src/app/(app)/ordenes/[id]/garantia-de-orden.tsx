import { Insignia } from '@/components/ui/etiqueta-estado'
import { garantiaTerminada } from '@/lib/datos/ordenes'
import { fechaHora, puesto } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'

import { TerminarGarantia } from './terminar-garantia'

/** Estados en los que la OT de garantía ya cuenta como terminada sin la marca. */
const YA_TERMINADA = ['TERMINADA', 'ENTREGADA', 'FACTURADA']

type OrdenDeGarantia = { id: string; numero: string; estado: string; tipo_trabajo: string }

/**
 * Junto al estado en el título: en una garantía la OT se queda «Aprobada», y
 * lo que de verdad dice dónde está es si ya se terminó la garantía.
 */
export async function InsigniaDeGarantia({ orden }: { orden: OrdenDeGarantia }) {
  if (orden.tipo_trabajo !== 'GARANTIA' || orden.estado === 'BORRADOR' || orden.estado === 'ANULADA') return null
  if (YA_TERMINADA.includes(orden.estado)) return null
  const marca = await garantiaTerminada(orden.id)
  return marca ? <Insignia tono="exito">Garantía terminada</Insignia> : <Insignia tono="aviso">Garantía por terminar</Insignia>
}

/**
 * La garantía terminada, en la cabecera de la OT de garantía (migración
 * 20261021120000). La da por terminada Administración cuando el taller avisa,
 * sin mover el estado de la OT, y es lo que espera la salida del vehículo
 * junto con el visto de Tesorería. Antes de la aprobación de Gerencia, o
 * anulada, no hay nada que decir.
 */
export async function GarantiaDeOrden({ orden, perfil }: { orden: OrdenDeGarantia; perfil: PerfilSesion }) {
  if (orden.tipo_trabajo !== 'GARANTIA' || orden.estado === 'BORRADOR') return null

  // La marca se ve también si después se anuló la OT: es la que dejó salir al vehículo.
  const marca = await garantiaTerminada(orden.id)
  if (marca) {
    return (
      <p role="status" className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
        <strong>Garantía terminada</strong> el {fechaHora(marca.terminada_en)}
        {marca.quien ? ` por ${puesto(marca.quien)}` : ''}
        {marca.nota ? `: ${marca.nota.replace(/[\s.]+$/, '')}.` : '.'} Si su vehículo está en la planta, sale con el visto de Tesorería.
      </p>
    )
  }
  if (orden.estado === 'ANULADA' || YA_TERMINADA.includes(orden.estado)) return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
      <p>
        <strong>Garantía por terminar.</strong>{' '}
        {puede(perfil, 'ordenes.editar')
          ? 'Cuando el taller avise que terminó, dala por terminada: después, el vehículo sale con el visto de Tesorería.'
          : 'Administración la da por terminada cuando el taller avise; hasta entonces el vehículo no sale.'}
      </p>
      {puede(perfil, 'ordenes.editar') && <TerminarGarantia ordenId={orden.id} numero={orden.numero} />}
    </div>
  )
}
