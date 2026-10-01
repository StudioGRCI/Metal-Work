import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import type { Metadata } from 'next'

import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { ESTADO_ETAPA, TIPO_TRABAJO, definir } from '@/lib/dominio/estados'
import { fecha, fechaHora, hoyLima, numero as fmtNumero, puesto } from '@/lib/format'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { programaDeEtapa } from '@/lib/dominio/programa-etapa'
import {
  actividadParaConvertirEtapas,
  clientesParaElegir,
  areasParaEtapas,
  estadoDeSalida,
  fechasClaveDeOrden,
  listarEtapas,
  obtenerOrden,
  responsablesDeOrden,
  timelineDeOrden,
} from '@/lib/datos/ordenes'
import { actividadesDeOrden, areasDelTaller, despachosParaReporte } from '@/lib/datos/actividades'
import { adjuntosDeOrden } from '@/lib/datos/adjuntos'
import { cotizacionPdfDeOrden } from '@/lib/datos/cotizaciones-pdf'
import { materialesParaPantalla } from '@/lib/datos/materiales-orden'
import { controlesYSolicitudesDeOrden, mermaDeOrden } from '@/lib/datos/costos-ot'
import {
  accesoriosDeOrden,
  personalDelTaller,
  repuestosDeOrden,
  verificacionesDeOrden,
} from '@/lib/datos/ficha-ot'
import { observacionesDeOrden } from '@/lib/datos/observaciones'
import { pendientesDeOrden } from '@/lib/datos/pendientes-ot'
import {
  areasDeSuMano,
  areasParaArmar,
  exigirPermiso,
  puede,
  puedeCorregirReporte,
  puedeEliminarReporte,
  puedeResolverObservacion,
} from '@/lib/sesion'

import { CabeceraDeOrden, ESTADOS_CERRADOS, veCotizacionEnOt } from './cabecera-orden'
import { ArchivosDeOrden, type AdjuntoEnPantalla } from './archivos-de-orden'
import { PonerCliente } from './poner-cliente'
import { EditarOrden } from './editar-orden'
import { EditarResumenAdministracion } from './editar-resumen-administracion'
import { cotizacionesParaCambio } from '@/lib/datos/edicion-ot'
import { AvanceDeOrden } from '@/components/avance/avance-de-orden'

import { Bitacora } from './bitacora'
import { Observaciones } from './observaciones'
import { ActividadesDeOrden } from './actividades'
import { MaterialesDeOrden } from './materiales'
import { AtencionMaterialesDeOrden } from './atencion-materiales'
import { MermaDeOrden } from './merma'
import { CostosYControles, ControlDeSalida } from './costos-y-controles'
import { Etapas } from './etapas'
import { FichaTaller } from './ficha-taller'
import { FechasClave, SalidaDeUnidad } from './salida-y-plazos'
import { queMeToca } from './te-toca'

export async function generateMetadata({ params }: PageProps<'/ordenes/[id]'>): Promise<Metadata> {
  const { id } = await params
  const orden = await obtenerOrden(id)
  return { title: orden ? `Orden ${orden.numero}` : 'Orden no encontrada' }
}

const VISTAS = [
  'resumen',
  'ficha',
  'etapas',
  'materiales',
  'costos',
  'entrega',
  'actividades',
  'avance',
  'bitacora',
] as const
type Vista = (typeof VISTAS)[number]

export default async function PaginaOrden({ params, searchParams }: PageProps<'/ordenes/[id]'>) {
  const perfil = await exigirPermiso('ordenes.ver')
  const { id } = await params
  const query = await searchParams
  if (query.vista === 'cumplimiento') redirect(`/ordenes/${id}/planos`)
  const secciones = seccionesDeOrden(perfil)
  // Sin pestaña pedida se abre el resumen, o la primera que la persona ve:
  // a Almacén la OT se le abre directo en Materiales.
  const vista: Vista = VISTAS.includes(query.vista as Vista)
    ? (query.vista as Vista)
    : secciones.includes('resumen') ? 'resumen' : ((secciones[0] ?? 'resumen') as Vista)
  if (!secciones.includes(vista)) redirect('/sin-permiso')

  const puedeVerCotizacionEnOt = veCotizacionEnOt(perfil)
  const [orden, cotizacionPdf, pendientes] = await Promise.all([
    obtenerOrden(id),
    puedeVerCotizacionEnOt
      ? cotizacionPdfDeOrden(id)
      : Promise.resolve(null),
    // Lo pendiente se cuenta en todas las pestañas: es lo que las numera.
    pendientesDeOrden(id),
  ])
  if (!orden) notFound()
  if (orden.plan_etapas_manual && vista === 'avance') redirect(`/ordenes/${id}?vista=actividades`)

  // Por qué la hoja de Diseño no acepta planos: en borrador falta quien la
  // apruebe; cerrada, ya no hay qué repartir.
  const motivoInactiva =
    orden.estado === 'BORRADOR'
      ? orden.abierta_en_taller
        ? 'Falta que Administración revise la orden'
        : 'Falta que Gerencia apruebe la orden'
      : ESTADOS_CERRADOS.includes(orden.estado)
        ? 'La orden ya se cerró'
        : null


  // Cada pestaña carga solo lo suyo: la bitácora de una OT larga puede tener
  // cientos de eventos y no tiene sentido traerlos para ver el resumen.
  const verFicha = vista === 'ficha'
  // La salida importa cuando la orden se acerca a la puerta.
  const verSalida = vista === 'entrega'

  const [etapas, timeline, accesorios, repuestos, verificaciones, personal] =
    await Promise.all([
      vista === 'etapas' || vista === 'resumen' || vista === 'actividades' ? listarEtapas(id) : Promise.resolve([]),
      vista === 'bitacora' ? timelineDeOrden(id) : Promise.resolve([]),
      verFicha ? accesoriosDeOrden(id) : Promise.resolve([]),
      verFicha ? repuestosDeOrden(id) : Promise.resolve([]),
      verFicha ? verificacionesDeOrden(id) : Promise.resolve([]),
      verFicha ? personalDelTaller() : Promise.resolve([]),
    ])
  const toca = queMeToca(perfil, pendientes, orden, etapas.length)
  const [areasEtapas, actividadesPorVincular] = await Promise.all([
    vista === 'etapas' ? areasParaEtapas() : Promise.resolve([]),
    vista === 'etapas' && !orden.plan_etapas_manual && orden.id === '78c95158-bddc-4398-b7b5-afa45cd0d8d0'
      && puede(perfil, 'diseno.planos') ? actividadParaConvertirEtapas(id) : Promise.resolve([]),
  ])

  const [salida, fechasClave] = await Promise.all([
    verSalida ? estadoDeSalida(id) : Promise.resolve(null),
    vista === 'resumen' && !orden.plan_etapas_manual ? fechasClaveDeOrden(id) : Promise.resolve(null),
  ])

  // La orden del taller sin cliente (100): la oficina, que ve los clientes y
  // hace órdenes, se lo pone desde el resumen.
  const clientesParaPoner =
    vista === 'resumen' &&
    orden.cliente_id === null &&
    !['ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado) &&
    puede(perfil, 'ordenes.editar') &&
    puede(perfil, 'clientes.ver')
      ? await clientesParaElegir()
      : null

  const puedeEditarDatos = vista === 'resumen' && puede(perfil, 'ordenes.editar')
    && !['ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado)
  const nuevasCotizaciones = puedeEditarDatos
    ? await cotizacionesParaCambio(orden.cliente_id, orden.tipo_carroceria?.id ?? null) : []
  const responsablesDisponibles = vista === 'resumen' && perfil.rol.codigo === 'ADMINISTRACION'
    && puedeEditarDatos ? await responsablesDeOrden() : []

  // La lista de Diseño y su catálogo.
  const listaMateriales =
    vista === 'materiales'
      ? await materialesParaPantalla(id, puede(perfil, 'requerimientos.ver'))
      : null
  // La merma la fija Diseño (`diseno.merma`) y la leen Diseño y Costos: los
  // mismos permisos que acepta la política `ver_ot_mermas`.
  const verMerma = vista === 'materiales' && puede(perfil, ['diseno.merma', 'diseno.planos', 'costos.ver'])
  const merma = verMerma ? await mermaDeOrden(id) : null
  const puedeVerControlEntrega = puede(perfil, 'costos.controlar_ot') || puede(perfil, 'costos.ver') || puede(perfil, 'costos.solicitar_pago')
  const datosCostos = vista === 'costos' || (vista === 'entrega' && puedeVerControlEntrega)
    ? await controlesYSolicitudesDeOrden(id, puede(perfil, 'costos.ver')) : null
  const areaPropiaMaterial =
    vista === 'materiales' && perfil.area_id && !puede(perfil, 'diseno.planos')
      ? ((await areasDelTaller()).find((a) => a.id === perfil.area_id)?.codigo ?? null)
      : null

  // La hoja de avance de cada area, con sus actividades y el diario.
  const hojaAreas =
    vista === 'actividades'
      ? await Promise.all([actividadesDeOrden(id), areasDelTaller()])
      : null
  // Diseño las arma todas (106); el jefe y el supervisor, las de su mano.
  const areasArmables = hojaAreas ? areasParaArmar(perfil, hojaAreas[1]) : []
  // Y las que ve: las que arma más las de su mano. Sin estas, el operario —que
  // reporta pero no arma— se quedaba sin su hoja y sin «Reportar día».
  const areasVisibles = hojaAreas
    ? puede(perfil, 'supervision.general') ? hojaAreas[1] : hojaAreas[1].filter(
        (a) => areasArmables.some((x) => x.id === a.id) || areasDeSuMano(perfil, [a]).length > 0,
      )
    : []
  const areasParaCrearTarea = orden.plan_etapas_manual
    ? !ESTADOS_CERRADOS.includes(orden.estado) && orden.estado !== 'BORRADOR'
      && perfil.rol.codigo === 'SUPERVISOR' && puede(perfil, 'produccion.registrar')
      ? areasVisibles.filter((a) => a.id === perfil.area_id)
      : []
    : areasArmables
  const despachosTaller = vista === 'actividades' && orden.plan_etapas_manual && puede(perfil, 'produccion.reportar_tarea')
    ? await despachosParaReporte(id) : []
  const idsAreasVisibles = new Set(areasVisibles.map((area) => area.id))
  const actividadesVisibles = hojaAreas
    ? hojaAreas[0].actividades.filter((actividad) => idsAreasVisibles.has(actividad.area_id))
    : []
  const avancesVisibles = hojaAreas
    ? hojaAreas[0].areas.filter((area) => idsAreasVisibles.has(area.area_id))
    : []
  const diarioVisible = hojaAreas
    ? hojaAreas[0].diario.filter((reporte) => idsAreasVisibles.has(reporte.area_id))
    : []

  // Las observaciones van con la orden en papel, con las áreas a las que se dirigen.
  const [observaciones, areasParaObservar] =
    vista === 'resumen' ? await Promise.all([observacionesDeOrden(id), areasDelTaller()]) : [[], []]

  // Los archivos de la orden (099), en el resumen junto a sus observaciones.
  // Quitarlos es de quien los subió, la oficina o el jefe: lo mismo que dice
  // la política.
  const puedeSubirArchivos = perfil.rol.codigo === 'SUPERVISOR' && puede(perfil, [
    'produccion.actividades',
    'ordenes.editar',
    'ordenes.crear',
    'ordenes.abrir_taller',
  ])
  const quitaCualquiera = puede(perfil, ['ordenes.editar', 'produccion.cualquier_area'])
  const archivos: AdjuntoEnPantalla[] | null =
    vista === 'resumen'
      ? (await adjuntosDeOrden(id)).map((a) => ({
          id: a.id,
          tipo: a.tipo,
          nombre_archivo: a.nombre_archivo,
          tamano_bytes: a.tamano_bytes,
          creado_en: a.creado_en,
          url: a.url,
          quitable: quitaCualquiera || a.subido_por === perfil.id,
        }))
      : null

  // Puede venir vacío: quien no tiene `clientes.ver` abre la orden igual, pero
  // sin los datos del cliente.
  const cliente = orden.cliente as unknown as {
    razon_social: string
    numero_documento: string
    telefono: string | null
  } | null
  // La placa dejó de ser obligatoria: la unidad existe desde el chasis y la
  // matrícula llega meses después, con la tarjeta de propiedad. Mientras, la
  // nombra su número FMI o su código de fábrica (`nombreDeUnidad`).
  const unidad = orden.unidad as unknown as {
    id: string
    placa: string | null
    numero_fmi: string | null
    codigo_interno: string | null
    marca: string | null
    modelo: string | null
    anio: number | null
    numero_chasis: string | null
  } | null
  const sede = orden.sede as unknown as { nombre: string }
  const responsable = orden.responsable as unknown as { puesto: string | null } | null
  const tipoCarroceria = orden.tipo_carroceria as unknown as { nombre: string } | null

  // Diseño guarda las etapas por partes: lo que aún no reparte se avisa en el resumen.
  const faltaContemplar = Math.max(0, 100 - etapas.reduce((suma, e) => suma + Number(e.peso_pct ?? 0), 0))
  const areaSupervisor = vista === 'ficha' && perfil.rol.codigo === 'SUPERVISOR' && perfil.area_id
    ? (await areasDelTaller()).find((a) => a.id === perfil.area_id)?.codigo
    : null

  return (
    <>
      <CabeceraDeOrden orden={orden} perfil={perfil} vista={vista} secciones={secciones}
        contadores={toca.contadores} cotizacionPdf={cotizacionPdf}
        creada={query.creada === '1'} abierta={query.abierta === '1'} />

      <div className="mt-5 space-y-5">
        <div className="min-w-0 space-y-4">
      {vista === 'resumen' && (
        <>
          {/* Arriba lo que más se consulta: cómo van las etapas y, al lado, la
              orden en papel con sus observaciones, que hablan de ella (pedido
              de la empresa, 2026-10-01). La franja «Siguiente paso para ti» se
              retiró: lo pendiente ya lo numeran las pestañas. En el teléfono la
              orden va primero: es lo que el taller busca y donde se anota un
              error; en el monitor queda a la derecha. */}
          <div className="grid items-start gap-4 lg:grid-cols-3 *:min-w-0">
            <div className="space-y-4 lg:col-start-3 lg:row-start-1">
              <ArchivosDeOrden ordenId={orden.id} adjuntos={archivos ?? []} puedeSubir={puedeSubirArchivos}>
                <Observaciones
                  ordenId={orden.id}
                  observaciones={observaciones.map((o) => ({ ...o, resoluble: puedeResolverObservacion(perfil, o) }))}
                  areas={areasParaObservar}
                  puedeAnotar={orden.estado !== 'ANULADA'}
                  /* «Observar» desde una pieza o una actividad llega con el área y el
                     encabezado en la URL; el texto se acota porque es de la URL. */
                  preseleccion={
                    typeof query.observar === 'string' && /^[A-Z]{2,5}$/.test(query.observar)
                      ? {
                          areaCodigo: query.observar,
                          texto: typeof query.sobre === 'string' ? query.sobre.slice(0, 300) : '',
                        }
                      : null
                  }
                />
              </ArchivosDeOrden>
              {fechasClave && (
                <FechasClave
                  fechas={fechasClave}
                  disenoCumplida={pendientes.planos > 0 && pendientes.planosEntregados >= pendientes.planos}
                />
              )}
            </div>

            <Tarjeta className="lg:col-span-2 lg:col-start-1 lg:row-start-1">
              <TarjetaCabecera
                titulo="Etapas de producción"
                descripcion={etapas.length > 0 ? `${etapas.filter((e) => e.estado === 'TERMINADA').length} de ${etapas.length} terminadas`
                  + (orden.plan_etapas_manual && faltaContemplar > 0 ? ` · falta contemplar ${fmtNumero(faltaContemplar, 0)} %` : '') : undefined}
                acciones={
                  etapas.length > 0 && (
                    <EnlaceBoton href={`/ordenes/${orden.id}?vista=etapas`} variante="fantasma" tamano="sm">
                      Ver etapas
                    </EnlaceBoton>
                  )
                }
              />
              <TarjetaCuerpo>
                {etapas.length === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-sm text-texto-suave">
                      {orden.estado === 'BORRADOR'
                        ? 'Cuando la orden sea aprobada, Diseño definirá las etapas.'
                        : 'Diseño aún no definió las etapas de esta orden.'}
                    </p>
                    {orden.estado !== 'BORRADOR' && orden.plan_etapas_manual && puede(perfil, 'diseno.planos')
                      && !ESTADOS_CERRADOS.includes(orden.estado) && (
                      <EnlaceBoton href={`/ordenes/${orden.id}?vista=etapas`} tamano="sm" className="mt-3">
                        Definir etapas
                      </EnlaceBoton>
                    )}
                  </div>
                ) : (
                  <ol className="divide-y divide-borde">
                    {etapas.map((etapa) => {
                      const estadoEtapa = definir(ESTADO_ETAPA, etapa.estado)
                      const programa = programaDeEtapa(etapa, hoyLima())
                      return (
                        <li key={etapa.etapa_id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                          <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-superficie-2 text-[11px] font-semibold text-texto-suave">
                            {etapa.orden_secuencia}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2 text-sm text-texto">
                              {etapa.etapa}
                              {/* Una etapa que pasó su fecha programada, con su nombre. */}
                              {programa.vencida && <Insignia tono="peligro">Vencida</Insignia>}
                              {programa.tocaAhora && <Insignia tono="aviso">Toca ahora</Insignia>}
                            </p>
                            {(etapa.estado !== 'PENDIENTE' || programa.fin) && (
                              <p className="text-[11px] text-texto-suave">
                                {[etapa.estado !== 'PENDIENTE' ? estadoEtapa.etiqueta : null, programa.fin ? `hasta el ${fecha(programa.fin)}` : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            )}
                          </div>
                          <Progreso valor={etapa.avance_porcentaje} alto="sm" className="w-20 shrink-0 sm:w-32" />
                          <span className="tabular w-10 shrink-0 text-right text-xs text-texto-suave">
                            {fmtNumero(etapa.avance_porcentaje, 0)}%
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </TarjetaCuerpo>
            </Tarjeta>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 *:min-w-0">
            <SeccionDesplegable titulo="Cliente y unidad" descripcion={cliente?.razon_social ?? 'Datos de identificación de esta OT'} abierta={puedeEditarDatos}>
              {puedeEditarDatos && (
                <div className="mb-2 flex justify-end">
                  <EditarOrden orden={orden} cotizaciones={nuevasCotizaciones} />
                </div>
              )}
              <div>
                {/* Sin cliente solo puede estar la que abrió el taller (100): la
                    oficina se lo pone acá; los demás leen que falta. */}
                {orden.cliente_id === null && clientesParaPoner ? (
                  <PonerCliente ordenId={orden.id} clientes={clientesParaPoner} />
                ) : (
                  <Dato
                    etiqueta="Cliente"
                    valor={
                      cliente?.razon_social ??
                      (orden.cliente_id === null ? 'Sin cliente todavía: lo pone la oficina' : null)
                    }
                  />
                )}
                <Dato etiqueta="Documento" valor={cliente?.numero_documento ?? null} />
                <Dato etiqueta="Teléfono" valor={cliente?.telefono ?? null} />
                {/* «Unidad» y no «Placa»: mientras no esté matriculada lo que
                    aquí sale es el código de fábrica o el chasis, y llamarlo
                    placa sería mentir. Sin unidad, la función ya lo dice. */}
                <Dato etiqueta="Unidad" valor={nombreDeUnidad(unidad)} />
                <Dato
                  etiqueta="Vehículo"
                  valor={[unidad?.marca, unidad?.modelo, unidad?.anio].filter(Boolean).join(' ') || null}
                />
                <Dato etiqueta="N.º de chasis" valor={unidad?.numero_chasis} />
                {unidad && puede(perfil, ['clientes.ver', 'produccion.ver']) && (
                  <Link href={`/unidades/${unidad.id}`} className="mt-2 inline-block text-sm text-acento hover:underline">
                    Ver todo lo que se le hizo a esta unidad
                  </Link>
                )}
              </div>
            </SeccionDesplegable>

            <SeccionDesplegable titulo="Datos del trabajo" descripcion={`${tipoCarroceria?.nombre ?? 'Carrocería'} · ${sede.nombre}`} abierta={puedeEditarDatos}>
              {perfil.rol.codigo === 'ADMINISTRACION' && puedeEditarDatos && (
                <div className="mb-2 flex justify-end">
                  <EditarResumenAdministracion orden={orden} responsables={responsablesDisponibles} />
                </div>
              )}
              <div>
                <Dato etiqueta="Tipo de trabajo" valor={definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta} />
                <Dato etiqueta="Tipo de carrocería" valor={tipoCarroceria?.nombre} />
                <Dato etiqueta="Taller" valor={sede.nombre} />
                <Dato
                  etiqueta="Responsable"
                  valor={responsable ? puesto(responsable) : null}
                />
                <Dato etiqueta="Registrada" valor={fecha(orden.fecha_registro)} />
                <Dato etiqueta="Inicio real" valor={fechaHora(orden.fecha_inicio_real)} />
              </div>
            </SeccionDesplegable>
          </div>

          {orden.especificaciones_tecnicas && (
            <Tarjeta>
              <TarjetaCabecera titulo="Especificaciones técnicas" />
              <TarjetaCuerpo>
                <p className="text-sm whitespace-pre-wrap text-texto-suave">
                  {orden.especificaciones_tecnicas}
                </p>
              </TarjetaCuerpo>
            </Tarjeta>
          )}

        </>
      )}

      {vista === 'ficha' && (
        <FichaTaller
          ordenId={orden.id}
          ficha={{
            largo_m: orden.largo_m,
            ancho_m: orden.ancho_m,
            alto_m: orden.alto_m,
            capacidad_carga: orden.capacidad_carga,
            ruedas: orden.ruedas,
            tipo_llantas: orden.tipo_llantas,
            cantidad_ejes: orden.cantidad_ejes,
            tipo_suspension: orden.tipo_suspension,
            colores: orden.colores,
            caracteristicas_especiales: orden.caracteristicas_especiales,
            correo_contacto: orden.correo_contacto,
            encargado_produccion_id: orden.encargado_produccion_id,
          }}
          accesorios={accesorios}
          repuestos={repuestos}
          verificaciones={verificaciones}
          personal={personal}
          /* La ficha la llena Administración (`ordenes.editar`, lo mismo que
             piden sus políticas); Diseño y el taller la ven. */
          puedeEditar={puede(perfil, 'ordenes.editar') && !ESTADOS_CERRADOS.includes(orden.estado)}
          puedeEscribirOrden={puede(perfil, 'ordenes.editar') && !ESTADOS_CERRADOS.includes(orden.estado)}
          puedeArmar={puede(perfil, 'ordenes.editar') && !ESTADOS_CERRADOS.includes(orden.estado)}
          rolVerificacion={
            ESTADOS_CERRADOS.includes(orden.estado) ? null :
            areaSupervisor === 'PRD' || areaSupervisor === 'MTZ' ? areaSupervisor : null
          }
          puedeCrearVerificacion={puede(perfil, 'ordenes.editar') && !ESTADOS_CERRADOS.includes(orden.estado)}
        />
      )}

      {vista === 'etapas' && (
        <Etapas
          ordenId={orden.id}
          etapas={etapas}
          areas={areasEtapas}
          actividadesPorVincular={actividadesPorVincular}
          hoy={hoyLima()}
          esNueva={orden.plan_etapas_manual}
          puedeDefinir={(orden.plan_etapas_manual || orden.id === '78c95158-bddc-4398-b7b5-afa45cd0d8d0')
            && puede(perfil, 'diseno.planos') && !ESTADOS_CERRADOS.includes(orden.estado)}
          puedeProgramar={perfil.rol.codigo === 'ADMINISTRACION' && !ESTADOS_CERRADOS.includes(orden.estado)}
        />
      )}

      {vista === 'materiales' && listaMateriales && (
        <div className="space-y-6"><MaterialesDeOrden
          ordenId={orden.id}
          materiales={listaMateriales.materiales}
          catalogo={listaMateriales.catalogo}
          puedeDisenar={puede(perfil, 'diseno.planos')}
          puedeSolicitar={puede(perfil, 'requerimientos.crear') && !puede(perfil, 'diseno.planos') && ['MTZ', 'PRD', 'ACB'].includes(areaPropiaMaterial ?? '')}
          areaPropia={areaPropiaMaterial}
          ordenViva={motivoInactiva === null}
          motivoInactiva={motivoInactiva}
        />
        <AtencionMaterialesDeOrden ordenId={orden.id} perfil={perfil} />
        {/* La merma es un dato del costeo, no del trabajo de la lista: al final. */}
        {verMerma && (
          <MermaDeOrden ordenId={orden.id}
            merma={merma ? {
              porcentaje: Number(merma.porcentaje),
              motivo: merma.motivo,
              registradoEn: merma.registrado_en,
              registradoPor: merma.registrador ? `${merma.registrador.nombres} ${merma.registrador.apellidos}`.trim() : null,
            } : null}
            puedeFijar={puede(perfil, 'diseno.merma')}
            ordenViva={!ESTADOS_CERRADOS.includes(orden.estado)} />
        )}</div>
      )}

      {vista === 'costos' && datosCostos && (
        <CostosYControles ordenId={orden.id} datos={datosCostos}
          puedeRegistrarGasto={puede(perfil, 'costos.registrar_gasto')}
          puedeRevisarGasto={puede(perfil, 'costos.revisar_gasto')}
          puedeVerCosteo={puede(perfil, 'costos.ver')}
          ordenCerrada={ESTADOS_CERRADOS.includes(orden.estado)}
          esAdministracion={perfil.rol.codigo === 'ADMINISTRACION'} />
      )}

      {vista === 'entrega' && (
        <div className="space-y-4">
          {/* Primero en qué paso va la salida y qué sigue; la ficha vehicular,
              que es un formulario largo, después. Antes el «0 de 4 pasos ·
              Siguiente…» quedaba al fondo, debajo de toda la ficha. La
              liberación no depende de la ficha: son dos caminos paralelos. */}
          {salida && <SalidaDeUnidad ordenId={orden.id}
            liberacion={salida.liberacion} entrega={salida.entrega} fisica={salida.fisica}
            puedeRegistrarSalida={puede(perfil, 'ordenes.entregar')}
            puedeLiberar={puede(perfil, 'tesoreria.liberar')}
            puedeConfirmar={puede(perfil, ['ordenes.entregar', 'produccion.actividades'])}
            puedeRegistrarEntrega={orden.estado === 'TERMINADA' && puede(perfil, 'ordenes.entregar')} />}
          {datosCostos && (
            <ControlDeSalida ordenId={orden.id} datos={datosCostos}
              puedeControlar={puede(perfil, 'costos.controlar_ot')}
              puedeVerCosteo={puede(perfil, 'costos.ver')}
              puedeSolicitar={puede(perfil, 'costos.solicitar_pago')}
              ordenCerrada={ESTADOS_CERRADOS.includes(orden.estado)} />
          )}
        </div>
      )}

      {vista === 'actividades' && hojaAreas && (
        <ActividadesDeOrden
          ordenId={orden.id}
          esNueva={orden.plan_etapas_manual}
          despachos={despachosTaller}
          etapas={etapas.filter((e) => e.etapa_id).map((e) => ({ id: e.etapa_id!, nombre: e.etapa ?? 'Etapa', area_id: e.area_id }))}
          actividades={actividadesVisibles}
          areas={avancesVisibles}
          diario={diarioVisible}
          /* Las áreas de la lista son las que esta persona puede escribir: la
             suya, o todas si responde por el taller entero o es Diseño.
             Ofrecerle las que el RLS le va a rechazar es prometerle un botón
             que no hace nada. */
          areasDisponibles={areasParaCrearTarea}
          areasVisibles={areasVisibles}
          puedeArmar={orden.plan_etapas_manual ? areasParaCrearTarea.length > 0 : areasArmables.length > 0}
          puedeCrear={areasParaCrearTarea.length > 0}
          puedeCargarCronograma={!orden.plan_etapas_manual && !['ENTREGADA', 'FACTURADA', 'ANULADA'].includes(orden.estado)}
          puedeReportar={puede(perfil, orden.plan_etapas_manual ? 'produccion.reportar_tarea' : 'produccion.registrar')}
          areaPropia={perfil.area_id}
          aprueba={puede(perfil, 'produccion.aprobar_reportes')}
          /* Quién corrige qué lo decide el gemelo de las políticas, acá en el
             servidor: la hoja es un componente de cliente y el perfil no viaja. */
          corregibles={diarioVisible
            .filter((r) =>
              puedeCorregirReporte(
                perfil,
                { clase: 'hoja', revision: r.revision, autor: r.reportado_por, fecha: r.fecha, areaId: r.area_id },
                hoyLima(),
              ),
            )
            .map((r) => r.id)}
          eliminables={diarioVisible
            .filter((r) => puedeEliminarReporte(perfil, { revision: r.revision, autor: r.reportado_por }))
            .map((r) => r.id)}
        />
      )}

      {vista === 'avance' && (
        <AvanceDeOrden ordenId={orden.id} perfil={perfil} conCabecera />
      )}

      {vista === 'bitacora' && (
        <div className="space-y-4">
          <Bitacora ordenId={orden.id} eventos={timeline} puedeComentar={puede(perfil, 'ordenes.ver')} />
          {!orden.plan_etapas_manual && secciones.includes('avance') && (
            <Tarjeta>
              <TarjetaCabecera titulo="Registros del flujo anterior" descripcion="Estos reportes se conservan para consulta." />
              <TarjetaCuerpo className="flex flex-wrap gap-2">
                {secciones.includes('avance') && <EnlaceBoton href={`/ordenes/${orden.id}?vista=avance`} variante="secundario" tamano="sm">Ver reportes anteriores</EnlaceBoton>}
              </TarjetaCuerpo>
            </Tarjeta>
          )}
        </div>
      )}
        </div>
      </div>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm last:border-0">
      <span className="shrink-0 text-texto-suave">{etiqueta}</span>
      <span className="min-w-0 text-right font-medium wrap-break-word text-texto">{valor || '—'}</span>
    </div>
  )
}

