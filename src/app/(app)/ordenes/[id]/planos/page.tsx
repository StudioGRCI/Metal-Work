import { notFound, redirect } from 'next/navigation'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosDePlanos, versionesDePlanos } from '@/lib/datos/versiones-planos'
import { cumplimientoDeOrden } from '@/lib/datos/cumplimiento'
import { areasDelTaller } from '@/lib/datos/actividades'
import { obtenerOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'
import { Pestanas } from '../pestanas'
import { Cumplimiento } from '../cumplimiento'
import { PanelPlanos } from './panel-planos'

export const metadata = { title: 'Planos' }

export default async function PaginaPlanos({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ plano?: string }>
}) {
  const perfil = await exigirPermiso('ordenes.ver')
  const secciones = seccionesDeOrden(perfil)
  if (!secciones.includes('planos')) redirect('/sin-permiso')
  const { id } = await params
  const query = await searchParams
  const [orden, versiones, catalogos, cumplimiento, areas] = await Promise.all([
    obtenerOrden(id), versionesDePlanos(id),
    puede(perfil, 'diseno.planos')
      ? catalogosDePlanos(id)
      : Promise.resolve({ planos: [], areas: [], liderId: null, equipo: [], usuarios: [] }),
    cumplimientoDeOrden(id),
    perfil.area_id ? areasDelTaller() : Promise.resolve([]),
  ])
  if (!orden) notFound()
  const abierta = !['BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado)
  const codigoArea = areas.find(a => a.id === perfil.area_id)?.codigo
  const manoDelTaller = codigoArea === 'MTZ' || codigoArea === 'PRD' ? codigoArea : null
  const motivoInactiva = orden.estado === 'BORRADOR'
    ? 'La orden aún no está aprobada'
    : abierta ? null : 'La orden ya se cerró'
  return <>
    <EncabezadoPagina titulo={`Planos · ${orden.numero}`} descripcion="Planos, piezas, avance, PDF y revisiones por área." />
    <Pestanas ordenId={id} activa="planos" visibles={secciones} />
    <Cumplimiento ordenId={id} resumen={cumplimiento?.resumen ?? null} planos={cumplimiento?.planos ?? []}
      puedeDisenar={puede(perfil, 'diseno.planos')} puedeReportar={puede(perfil, 'produccion.registrar')}
      areaPropia={manoDelTaller} puedeObservar={orden.estado !== 'ANULADA'}
      ordenViva={abierta} motivoInactiva={motivoInactiva} />
    <PanelPlanos ordenId={id} abierta={abierta} puedeCargar={puede(perfil, 'diseno.planos')}
      puedeAsignar={puede(perfil, 'diseno.asignar')} verEquipo={puede(perfil, 'diseno.planos')} catalogos={catalogos}
      planoSeleccionado={query.plano}
      versiones={versiones.map(v => ({ ...v,
        puedeRevisar: abierta && v.estado === 'POR_REVISAR' && v.creado_por !== perfil.id && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, 'produccion.actividades'),
        puedeRecibir: v.vigente && v.estado === 'APROBADO' && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, ['produccion.actividades', 'produccion.cualquier_area']),
      }))} />
  </>
}
