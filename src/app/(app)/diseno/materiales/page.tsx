import { exigirPermiso } from '@/lib/sesion'

import { ListaDeCodigosDeDiseno } from '../codigo/lista'

export const metadata = { title: 'Gestión de materiales' }

export default async function Pagina({ searchParams }: PageProps<'/diseno/materiales'>) {
  await exigirPermiso('diseno.codigos')
  return <ListaDeCodigosDeDiseno vista="materiales" params={await searchParams} />
}
