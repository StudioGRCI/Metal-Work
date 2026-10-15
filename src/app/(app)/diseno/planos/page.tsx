import { exigirPermiso } from '@/lib/sesion'

import { ListaDeCodigosDeDiseno } from '../codigo/lista'

export const metadata = { title: 'Planos' }

export default async function Pagina({ searchParams }: PageProps<'/diseno/planos'>) {
  await exigirPermiso('diseno.codigos')
  return <ListaDeCodigosDeDiseno vista="planos" params={await searchParams} />
}
