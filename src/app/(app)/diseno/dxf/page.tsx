import { exigirPermiso, puede } from '@/lib/sesion'

import { ListaDeCodigosDeDiseno } from '../codigo/lista'

export const metadata = { title: 'Archivos DXF' }

export default async function Pagina({ searchParams }: PageProps<'/diseno/dxf'>) {
  // Gerencia los consulta y descarga sin subir ni quitar (`diseno.ver_dxf`, migración 20261126310000).
  const perfil = await exigirPermiso(['diseno.codigos', 'diseno.ver_dxf'])
  return <ListaDeCodigosDeDiseno vista="dxf" params={await searchParams} soloLectura={!puede(perfil, 'diseno.codigos')} />
}
