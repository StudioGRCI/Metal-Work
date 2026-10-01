import { notFound, redirect } from 'next/navigation'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import { catalogosDePlanos, equipoDisenoNominal, planosConAutor, versionesDePlanos } from '@/lib/datos/versiones-planos'
import { cumplimientoDeOrden } from '@/lib/datos/cumplimiento'
import { areasDelTaller } from '@/lib/datos/actividades'
import { areasParaEtapas, listarEtapas, obtenerOrden } from '@/lib/datos/ordenes'
import { cotizacionPdfDeOrden } from '@/lib/datos/cotizaciones-pdf'
import { pendientesDeOrden } from '@/lib/datos/pendientes-ot'
import { exigirPermiso, puede, puedeHojaDeArea } from '@/lib/sesion'
import { CabeceraDeOrden, veCotizacionEnOt } from '../cabecera-orden'
import { Cumplimiento } from '../cumplimiento'
import { queMeToca } from '../te-toca'
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
  const [orden, versiones, catalogos, cumplimiento, areas, etapas, areasEtapas, pendientes, cotizacionPdf] = await Promise.all([
    obtenerOrden(id), versionesDePlanos(id),
    puede(perfil, ['diseno.planos', 'diseno.subir_pdf'])
      ? catalogosDePlanos(id)
      : Promise.all([equipoDisenoNominal(id), planosConAutor(id)]).then(([equipoNominal, planos]) => ({
        planos, areas: [], liderId: null, liderEntregaNombre: null,
        equipo: [], usuarios: [], equipoNominal,
      })),
    cumplimientoDeOrden(id),
    perfil.area_id ? areasDelTaller() : Promise.resolve([]),
    listarEtapas(id),
    areasParaEtapas(),
    // La cabecera es la misma de las demás pestañas: con sus contadores y,
    // para quien la consulta, la cotización.
    pendientesDeOrden(id),
    veCotizacionEnOt(perfil) ? cotizacionPdfDeOrden(id) : Promise.resolve(null),
  ])
  if (!orden) notFound()
  const abierta = !['BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado)
  const codigoArea = areas.find(a => a.id === perfil.area_id)?.codigo
  const manoDelTaller = codigoArea === 'MTZ' || codigoArea === 'PRD' ? codigoArea : null
  const motivoInactiva = orden.estado === 'BORRADOR'
    ? 'La orden aún no está aprobada'
    : abierta ? null : 'La orden ya se cerró'
  const toca = queMeToca(perfil, pendientes, orden, etapas.length)
  return <>
    <CabeceraDeOrden orden={orden} perfil={perfil} vista="planos" secciones={secciones}
      contadores={toca.contadores} cotizacionPdf={cotizacionPdf} />
    <div className="mt-5 space-y-5">
      <div className="min-w-0 space-y-4">
        <Cumplimiento ordenId={id} resumen={cumplimiento?.resumen ?? null} planos={cumplimiento?.planos ?? []}
          versiones={versiones.map(v => ({ ...v,
            puedeRevisarDiseno: abierta && v.revision_diseno === 'PENDIENTE' && v.creado_por !== perfil.id && puede(perfil, 'diseno.planos'),
            puedeRevisar: abierta && v.revision_diseno === 'APROBADO' && v.estado === 'POR_REVISAR' && v.creado_por !== perfil.id && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, 'produccion.actividades'),
            puedeRecibir: v.vigente && v.estado === 'APROBADO' && puedeHojaDeArea(perfil, v.area_id) && puede(perfil, ['produccion.actividades', 'produccion.cualquier_area']),
          }))}
          catalogos={catalogos} planoSeleccionado={query.plano}
          etapas={etapas.filter(e => e.etapa_id).map(e => ({
            id: e.etapa_id!,
            nombre: `${e.etapa ?? 'Etapa'} · ${areasEtapas.find(a => a.id === e.area_id)?.nombre ?? 'Área'}`,
          }))}
          puedeDisenar={puede(perfil, 'diseno.planos')}
          puedeSubirPdf={puede(perfil, 'diseno.subir_pdf')}
          areaPropia={manoDelTaller}
          ordenViva={abierta} motivoInactiva={motivoInactiva} />
        {/* Quién dibuja es configuración: se toca al empezar la OT y después
            se consulta. Va al final, como en las demás pestañas. */}
        <EquipoDiseno ordenId={id} abierta={abierta} puedeAsignar={puede(perfil, 'diseno.planos')}
          catalogos={catalogos} />
      </div>
    </div>
  </>
}
