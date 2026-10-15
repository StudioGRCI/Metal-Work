import { exigirPermiso } from '@/lib/sesion'

import { ListaDeCodigosDeDiseno } from '../codigo/lista'

export const metadata = { title: 'Control de etapas' }

export default async function Pagina({ searchParams }: PageProps<'/diseno/etapas'>) {
  await exigirPermiso('diseno.codigos')
  return <ListaDeCodigosDeDiseno vista="etapas" params={await searchParams} />
}
