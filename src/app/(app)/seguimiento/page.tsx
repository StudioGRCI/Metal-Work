import { vistaSeguimientoValida } from '@/lib/dominio/diseno-codigos'
import { exigirPermiso } from '@/lib/sesion'

import { ListaDeCodigosDeDiseno } from '../diseno/codigo/lista'

export const metadata = { title: 'Seguimiento por código' }

/**
 * Supervisión general y Almacén siguen cada unidad por su código interno, sin
 * la OT (migración 20261016110000): las etapas con su avance, los materiales
 * contra lo pedido y lo salido, y los planos de cada área. Solo lectura.
 */
export default async function PaginaSeguimiento({ searchParams }: PageProps<'/seguimiento'>) {
  await exigirPermiso('codigos_internos.seguimiento')
  const params = await searchParams
  return <ListaDeCodigosDeDiseno vista={vistaSeguimientoValida(params.vista)} params={params} seguimiento />
}
