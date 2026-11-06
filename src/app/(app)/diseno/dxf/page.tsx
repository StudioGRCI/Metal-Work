import { exigirPermiso } from '@/lib/sesion'

import { ListaDeCodigosDeDiseno } from '../codigo/lista'

export const metadata = { title: 'Archivos DXF' }

export default async function Pagina({ searchParams }: PageProps<'/diseno/dxf'>) {
  await exigirPermiso('diseno.codigos')
  return <ListaDeCodigosDeDiseno vista="dxf" params={await searchParams} />
}
