import { notFound, redirect } from 'next/navigation'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosDePlanos, equipoDisenoNominal, planosConAutor, versionesDePlanos } from '@/lib/datos/versiones-planos'
import { cumplimientoDeOrden } from '@/lib/datos/cumplimiento'
import { areasDelTaller } from '@/lib/datos/actividades'
import { areasParaEtapas, listarEtapas, obtenerOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'
import { Pestanas } from '../pestanas'
import { Cumplimiento } from '../cumplimiento'
import { EquipoDiseno } from './equipo-diseno'

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
  const [orden, versiones, catalogos, cumplimiento, areas, etapas, areasEtapas] = await Promise.all([
    obtenerOrden(id), versionesDePlanos(id),
    puede(perfil, 'diseno.planos')
      ? catalogosDePlanos(id)
      : Promise.all([equipoDisenoNominal(id), planosConAutor(id)]).then(([equipoNominal, planos]) => ({
        planos, areas: [], liderId: null, liderEntregaNombre: null,
        equipo: [], usuarios: [], equipoNominal,
      })),
    cumplimientoDeOrden(id),
    perfil.area_id ? areasDelTaller() : Promise.resolve([]),
    listarEtapas(id),
    areasParaEtapas(),
  ])
  if (!orden) notFound()
  const abierta = !['BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado)
  const codigoArea = areas.find(a => a.id === perfil.area_id)?.codigo
  const manoDelTaller = codigoArea === 'MTZ' || codigoArea === 'PRD' ? codigoArea : null
  const motivoInactiva = orden.estado === 'BORRADOR'
    ? 'La orden aún no está aprobada'
    : abierta ? null : 'La orden ya se cerró'
  return <>
    <EncabezadoPagina titulo={`Planos · ${orden.numero}`} descripcion="Planos, PDF y revisiones por área. Los materiales se definen en su pestaña." />
    <Pestanas ordenId={id} activa="planos" visibles={secciones} />
    <EquipoDiseno ordenId={id} abierta={abierta} puedeAsignar={puede(perfil, 'diseno.planos')}
      catalogos={catalogos} />
    <Cumplimiento ordenId={id} resumen={cumplimiento?.resumen ?? null} planos={cumplimiento?.planos ?? []}
      versiones={versiones.map(v => ({ ...v,
        puedeRevisar: abierta && v.estado === 'POR_REVISAR' && v.creado_por !== perfil.id && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, 'produccion.actividades'),
        puedeRecibir: v.vigente && v.estado === 'APROBADO' && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, ['produccion.actividades', 'produccion.cualquier_area']),
      }))}
      catalogos={catalogos} planoSeleccionado={query.plano}
      etapas={etapas.filter(e => e.etapa_id && e.area_id === areasEtapas.find(a => a.codigo === 'DIS')?.id).map(e => ({ id: e.etapa_id!, nombre: e.etapa ?? 'Diseño' }))}
      puedeDisenar={puede(perfil, 'diseno.planos')}
      areaPropia={manoDelTaller}
      ordenViva={abierta} motivoInactiva={motivoInactiva} />
  </>
}
