import { notFound } from 'next/navigation'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosDePlanos, versionesDePlanos } from '@/lib/datos/versiones-planos'
import { obtenerOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'
import { Pestanas } from '../pestanas'
import { PanelPlanos } from './panel-planos'

export const metadata = { title: 'Planos y revisiones' }

export default async function PaginaPlanos({ params }: { params: Promise<{ id: string }> }) {
  const perfil = await exigirPermiso('ordenes.ver')
  const { id } = await params
  const [orden, versiones, catalogos] = await Promise.all([
    obtenerOrden(id), versionesDePlanos(id),
    puede(perfil, 'diseno.planos') ? catalogosDePlanos(id) : Promise.resolve({ planos: [], areas: [] }),
  ])
  if (!orden) notFound()
  const abierta = !['BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado)
  return <>
    <EncabezadoPagina titulo={`Planos · ${orden.numero}`} descripcion="Versiones revisadas, destinatarios y recepción del taller. Cada área consulta los archivos que le corresponden." />
    <Pestanas ordenId={id} activa="planos" verPlanos />
    <PanelPlanos ordenId={id} abierta={abierta} puedeCargar={puede(perfil, 'diseno.planos')} catalogos={catalogos}
      versiones={versiones.map(v => ({ ...v,
        puedeRevisar: abierta && v.estado === 'POR_REVISAR' && v.creado_por !== perfil.id && puede(perfil, 'diseno.revisar'),
        puedeRecibir: v.vigente && v.estado === 'APROBADO' && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, ['produccion.actividades', 'produccion.cualquier_area']),
      }))} />
  </>
}
