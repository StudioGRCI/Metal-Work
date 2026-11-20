import { Insignia } from '@/components/ui/etiqueta-estado'
import { garantiaTerminada } from '@/lib/datos/ordenes'
import { fechaHora, puesto } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'

import { TerminarGarantia } from './terminar-garantia'

/** Estados en los que la OT ya cuenta como terminada sin la marca. */
const YA_TERMINADA = ['TERMINADA', 'ENTREGADA', 'FACTURADA']

type OrdenDeGarantia = { id: string; numero: string; estado: string; tipo_trabajo: string }

/**
 * Las OT cuyo trabajo lo da por terminado Administración, porque no tienen un
 * avance de código que llegue al 100 %: la garantía (migración 20261021120000)
 * y el mantenimiento, que va por el número de su OT (20261120500000).
 */
const SE_TERMINAN_A_MANO = {
  GARANTIA: {
    terminada: 'Garantía terminada',
    porTerminar: 'Garantía por terminar',
    paraQuienTermina: 'Cuando el taller avise que terminó, dala por terminada: después, el vehículo sale con el visto de Tesorería.',
    paraLosDemas: 'Administración la da por terminada cuando el taller avise; hasta entonces el vehículo no sale.',
  },
  MANTENIMIENTO: {
    terminada: 'Mantenimiento terminado',
    porTerminar: 'Mantenimiento por terminar',
    paraQuienTermina: 'Cuando el taller avise que terminó, dalo por terminado: después, el vehículo sale con el visto de Tesorería.',
    paraLosDemas: 'Administración lo da por terminado cuando el taller avise; hasta entonces el vehículo no sale.',
  },
} as const

function seTerminaAMano(tipo: string): tipo is keyof typeof SE_TERMINAN_A_MANO {
  return tipo in SE_TERMINAN_A_MANO
}

/**
 * Junto al estado en el título: en una garantía o un mantenimiento la OT se
 * queda «Aprobada», y lo que de verdad dice dónde está es si ya se terminó.
 */
export async function InsigniaDeGarantia({ orden }: { orden: OrdenDeGarantia }) {
  if (!seTerminaAMano(orden.tipo_trabajo) || orden.estado === 'BORRADOR' || orden.estado === 'ANULADA') return null
  if (YA_TERMINADA.includes(orden.estado)) return null
  const textos = SE_TERMINAN_A_MANO[orden.tipo_trabajo]
  const marca = await garantiaTerminada(orden.id)
  return marca ? <Insignia tono="exito">{textos.terminada}</Insignia> : <Insignia tono="aviso">{textos.porTerminar}</Insignia>
}

/**
 * El trabajo terminado, en la cabecera de la OT de garantía o de
 * mantenimiento. Lo da por terminado Administración cuando el taller avisa,
 * sin mover el estado de la OT, y es lo que espera la salida del vehículo
 * junto con el visto de Tesorería. Antes de la aprobación de Gerencia, o
 * anulada, no hay nada que decir.
 */
export async function GarantiaDeOrden({ orden, perfil }: { orden: OrdenDeGarantia; perfil: PerfilSesion }) {
  if (!seTerminaAMano(orden.tipo_trabajo) || orden.estado === 'BORRADOR') return null
  const textos = SE_TERMINAN_A_MANO[orden.tipo_trabajo]

  // La marca se ve también si después se anuló la OT: es la que dejó salir al vehículo.
  const marca = await garantiaTerminada(orden.id)
  if (marca) {
    return (
      <p role="status" className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
        <strong>{textos.terminada}</strong> el {fechaHora(marca.terminada_en)}
        {marca.quien ? ` por ${puesto(marca.quien)}` : ''}
        {marca.nota ? `: ${marca.nota.replace(/[\s.]+$/, '')}.` : '.'} Si su vehículo está en la planta, sale con el visto de Tesorería.
      </p>
    )
  }
  if (orden.estado === 'ANULADA' || YA_TERMINADA.includes(orden.estado)) return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
      <p>
        <strong>{textos.porTerminar}.</strong>{' '}
        {puede(perfil, 'ordenes.editar') ? textos.paraQuienTermina : textos.paraLosDemas}
      </p>
      {puede(perfil, 'ordenes.editar') && <TerminarGarantia ordenId={orden.id} numero={orden.numero} tipo={orden.tipo_trabajo} />}
    </div>
  )
}
