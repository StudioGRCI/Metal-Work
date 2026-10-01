import { FileText, Truck, CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { ESTADO_ETAPA, PRIORIDAD, TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import { fecha, fechaHora, hoyLima, numero as fmtNumero, puesto } from '@/lib/format'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { programaDeEtapa } from '@/lib/dominio/programa-etapa'
import { situacionDeEntrega } from '@/lib/dominio/expediente'
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

import { AccionesEstado } from './acciones-estado'
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
import { Pestanas } from './pestanas'
import { TeToca, queMeToca } from './te-toca'

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

/** Estados en los que la orden ya no corre plazo: no puede estar atrasada. */
const ESTADOS_CERRADOS: string[] = ['ENTREGADA', 'FACTURADA', 'ANULADA']

/** Lo que se dice bajo la fecha prometida: cuánto falta, o hace cuánto venció. */
function pieDeEntrega(finReal: string | null, comprometida: string | null, cerrada: boolean) {
  if (finReal) return `Trabajo terminado el ${fecha(finReal)}`
  if (cerrada) return 'Fecha prometida al cliente'
  return situacionDeEntrega(comprometida, null, hoyLima()).pie
}

export default async function PaginaOrden({ params, searchParams }: PageProps<'/ordenes/[id]'>) {
  const perfil = await exigirPermiso('ordenes.ver')
  const { id } = await params
  const query = await searchParams
  if (query.vista === 'cumplimiento') redirect(`/ordenes/${id}/planos`)
  const secciones = seccionesDeOrden(perfil)
  const vista: Vista = VISTAS.includes(query.vista as Vista) ? (query.vista as Vista) : 'resumen'
  if (!secciones.includes(vista)) redirect('/sin-permiso')

  // En la OT solo Gerencia, Administración y Tesorería consultan el documento
  // comercial. Ventas conserva su propia pantalla de cotizaciones.
  const puedeVerCotizacionEnOt = ['GERENTE', 'ADMINISTRACION', 'TESORERIA', 'ADMIN']
    .includes(perfil.rol.codigo)
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
  if (orden.plan_etapas_manual && vista === 'ficha') redirect(`/ordenes/${id}?vista=bitacora`)

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

  // Las observaciones van arriba del resumen, con las áreas a las que se dirigen.
  const [observaciones, areasParaObservar] =
    vista === 'resumen' ? await Promise.all([observacionesDeOrden(id), areasDelTaller()]) : [[], []]

  // Los archivos de la orden (099): en el resumen y junto a la hoja, que es
  // donde el taller los busca. Quitarlos es de quien los subió, la oficina o
  // el jefe: lo mismo que dice la política.
  const puedeSubirArchivos = perfil.rol.codigo === 'SUPERVISOR' && puede(perfil, [
    'produccion.actividades',
    'ordenes.editar',
    'ordenes.crear',
    'ordenes.abrir_taller',
  ])
  const quitaCualquiera = puede(perfil, ['ordenes.editar', 'produccion.cualquier_area'])
  const archivos: AdjuntoEnPantalla[] | null =
    vista === 'resumen' || vista === 'actividades'
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

  const estado = estadoDeOrden(orden.estado, orden.abierta_en_taller)
  const porRevisar = orden.abierta_en_taller && orden.estado === 'BORRADOR'
  const prioridad = definir(PRIORIDAD, orden.prioridad)
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

  // Comparación de texto contra la fecha de hoy en el taller: son fechas planas
  // YYYY-MM-DD y `hoyLima()` da la del taller, no la de UTC, que de noche ya va
  // un día adelante y pintaba de rojo lo que todavía estaba en plazo. Esto es un
  // componente de servidor, así que el navegador no lo vuelve a calcular y no
  // hay error de hidratación que suprimir.
  const entregaVencida = Boolean(
    orden.fecha_entrega_comprometida &&
      !orden.fecha_fin_real &&
      !ESTADOS_CERRADOS.includes(orden.estado) &&
      orden.fecha_entrega_comprometida < hoyLima(),
  )
  const areaSupervisor = vista === 'ficha' && perfil.rol.codigo === 'SUPERVISOR' && perfil.area_id
    ? (await areasDelTaller()).find((a) => a.id === perfil.area_id)?.codigo
    : null

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Órdenes de trabajo', ruta: '/ordenes' }, { titulo: orden.numero }]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {orden.numero}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            <span className="flex items-center gap-1 text-xs font-normal text-texto-suave">
              <Punto tono={prioridad.tono} />
              {prioridad.etiqueta}
            </span>
          </span>
        }
        descripcion={
          /* Quien abre una orden busca primero de quién es y qué unidad: el
             número solo no lo dice. Van en <span> porque la descripción ya es
             un <p>. */
          <>
            {cliente?.razon_social && (
              <span className="block font-medium text-texto">{cliente.razon_social}</span>
            )}
            <span className="block">
              {[unidad ? nombreDeUnidad(unidad) : null, orden.descripcion].filter(Boolean).join(' · ')}
            </span>
          </>
        }
        acciones={
          <AccionesEstado
            orden={{ id: orden.id, estado: orden.estado, abiertaEnTaller: orden.abierta_en_taller }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
          />
        }
      />

      {query.creada === '1' && orden.estado === 'BORRADOR' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          {/* A quien no aprueba no se le pide que apruebe: se le dice quién lo hace. */}
          {puede(perfil, 'ordenes.aprobar')
            ? 'Orden registrada. Apruébala para que Diseño pueda definir las etapas.'
            : 'Orden registrada. Falta su aprobación para que Diseño pueda definir las etapas.'}
        </p>
      )}

      {/* La que abrió el taller: se dice quién la revisa y que el trabajo no
          espera. Al abrirla se llega acá, a la pestaña de actividades. */}
      {porRevisar && (
        <p
          role={query.abierta === '1' ? 'status' : undefined}
          className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso"
        >
          {query.abierta === '1' ? <strong>Orden abierta. </strong> : <strong>Por revisar. </strong>}
          La abrió el taller y espera que Administración la apruebe o la rechace; ya se le
          avisó. Administración revisará sus datos; después Diseño definirá las etapas y Administración programará las fechas.
        </p>
      )}

      {orden.estado === 'PAUSADA' && orden.motivo_pausa && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
          <strong>Orden pausada:</strong> {orden.motivo_pausa}
        </p>
      )}
      {orden.estado === 'ANULADA' && orden.motivo_anulacion && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Orden anulada:</strong> {orden.motivo_anulacion}
        </p>
      )}

      {/* En el monitor las secciones viven en la barra lateral: el contenedor
          se oculta pero el componente se monta igual, porque es el que las
          publica allí. */}
      <div className="mb-4 lg:hidden"><Pestanas ordenId={orden.id} numero={orden.numero} activa={vista} contadores={toca.contadores} visibles={secciones} /></div>
      <Tarjeta className={vista==='resumen'?'overflow-hidden border-acento/20':'border-borde shadow-none'}>
        <TarjetaCuerpo className={vista==='resumen'?'grid items-center gap-6 bg-gradient-to-r from-acento-suave/50 to-superficie p-5 sm:grid-cols-[minmax(0,1fr)_auto]':'flex flex-wrap items-center gap-x-6 gap-y-3 py-3'}>
          <div className={vista==='resumen'?'flex min-w-0 items-center gap-4':'flex min-w-44 flex-1 items-center gap-3'}>
            {vista==='resumen'&&<span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-acento-suave text-acento sm:flex"><Truck aria-hidden className="size-7"/></span>}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <span className="text-xs font-medium text-texto-suave">Avance de la unidad</span>
                <strong className="tabular text-lg text-texto">{fmtNumero(orden.avance_porcentaje,1)} %</strong>
              </div>
              <Progreso valor={orden.avance_porcentaje} etiqueta="Avance de la orden de trabajo" alto={vista==='resumen'?'md':'sm'}/>
              {/* El número suma todos los reportes de las áreas, revisados o no
                  (migración 097: la aprobación es el visto bueno, no la llave
                  del porcentaje). Decía «aprobado» y no lo era. */}
              {vista==='resumen'&&<p className="mt-2 text-xs text-texto-suave">Según lo que reportan las áreas · {tipoCarroceria?.nombre??definir(TIPO_TRABAJO,orden.tipo_trabajo).etiqueta} · <Link href={`/ordenes/${orden.id}/expediente`} className="font-medium text-acento hover:underline">Ver expediente</Link></p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <CalendarDays aria-hidden className="size-4 shrink-0 text-texto-suave"/>
              <div><p className="text-xs text-texto-suave">Entrega comprometida</p><p className={entregaVencida?'tabular font-semibold text-peligro':'tabular font-semibold text-texto'}>{fecha(orden.fecha_entrega_comprometida)}</p>
                {vista==='resumen'&&<p className={entregaVencida?'mt-1 max-w-48 text-xs text-peligro':'mt-1 max-w-48 text-xs text-texto-suave'}>{pieDeEntrega(orden.fecha_fin_real,orden.fecha_entrega_comprometida,ESTADOS_CERRADOS.includes(orden.estado))}</p>}
              </div>
            </div>
            {cotizacionPdf&&<div className="border-l border-borde pl-4"><p className="text-xs text-texto-suave">Cotización {cotizacionPdf.numero}</p>
              {cotizacionPdf.url?<a href={cotizacionPdf.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-acento hover:underline"><FileText aria-hidden className="size-4"/>{cotizacionPdf.revisionPendiente?'PDF aprobado anterior':'Abrir cotización'}</a>:<p className="text-xs text-aviso">PDF no disponible</p>}
            </div>}
          </div>
        </TarjetaCuerpo>
      </Tarjeta>

      <div className="mt-5 space-y-5">
        <div className="min-w-0 space-y-4">
      {vista === 'resumen' && <TeToca ordenId={orden.id} items={toca.items} />}

      {vista === 'resumen' && (
        <div className="grid gap-4 lg:grid-cols-2 *:min-w-0">
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

          {orden.especificaciones_tecnicas && (
            <Tarjeta className="lg:col-span-2">
              <TarjetaCabecera titulo="Especificaciones técnicas" />
              <TarjetaCuerpo>
                <p className="text-sm whitespace-pre-wrap text-texto-suave">
                  {orden.especificaciones_tecnicas}
                </p>
              </TarjetaCuerpo>
            </Tarjeta>
          )}

          {/* Las etapas a la izquierda, a lo largo; lo demás apilado a la
              derecha. Antes las fechas dejaban media fila en blanco y las
              etapas ocupaban el ancho entero con el nombre cortado. */}
          <Tarjeta>
            <TarjetaCabecera
              titulo="Etapas de producción"
              descripcion={etapas.length > 0 ? `${etapas.filter((e) => e.estado === 'TERMINADA').length} de ${etapas.length} terminadas` : undefined}
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
                <p className="py-4 text-center text-sm text-texto-suave">
                  {orden.estado === 'BORRADOR'
                    ? 'Cuando la orden sea aprobada, Diseño definirá las etapas.'
                    : 'Diseño aún no definió las etapas. Abre Etapas para ver el siguiente paso.'}
                </p>
              ) : (
                <ol className="divide-y divide-borde">
                  {etapas.map((etapa) => {
                    const estadoEtapa = definir(ESTADO_ETAPA, etapa.estado)
                    const programa = programaDeEtapa(etapa, hoyLima())
                    return (
                      <li key={etapa.etapa_id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm text-texto">
                            {etapa.etapa}
                            {/* Lo que /plazos llama «Vencido», aquí con nombre de etapa. */}
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
                        <Progreso valor={etapa.avance_porcentaje} alto="sm" className="w-20 shrink-0 sm:w-28" />
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

          <div className="space-y-4">
            {fechasClave && (
              <FechasClave
                fechas={fechasClave}
                disenoCumplida={pendientes.planos > 0 && pendientes.planosEntregados >= pendientes.planos}
              />
            )}
            {archivos && (archivos.length > 0 || puedeSubirArchivos) && (
              <ArchivosDeOrden ordenId={orden.id} adjuntos={archivos} puedeSubir={puedeSubirArchivos} />
            )}
          </div>
        </div>
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
          puedeEditar={puede(perfil, 'diseno.planos') && !ESTADOS_CERRADOS.includes(orden.estado)}
          puedeEscribirOrden={puede(perfil, 'diseno.planos') && !ESTADOS_CERRADOS.includes(orden.estado)}
          puedeArmar={puede(perfil, 'diseno.planos') && !ESTADOS_CERRADOS.includes(orden.estado)}
          rolVerificacion={
            ESTADOS_CERRADOS.includes(orden.estado) ? null :
            areaSupervisor === 'PRD' || areaSupervisor === 'MTZ' ? areaSupervisor : null
          }
          puedeCrearVerificacion={perfil.rol.codigo === 'DISENO' && !ESTADOS_CERRADOS.includes(orden.estado)}
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
        />{verMerma && (
          <MermaDeOrden ordenId={orden.id}
            merma={merma ? {
              porcentaje: Number(merma.porcentaje),
              motivo: merma.motivo,
              registradoEn: merma.registrado_en,
              registradoPor: merma.registrador ? `${merma.registrador.nombres} ${merma.registrador.apellidos}`.trim() : null,
            } : null}
            puedeFijar={puede(perfil, 'diseno.merma')}
            ordenViva={!ESTADOS_CERRADOS.includes(orden.estado)} />
        )}<AtencionMaterialesDeOrden ordenId={orden.id} perfil={perfil} /></div>
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
          {datosCostos && (
            <ControlDeSalida ordenId={orden.id} datos={datosCostos}
              puedeControlar={puede(perfil, 'costos.controlar_ot')}
              puedeVerCosteo={puede(perfil, 'costos.ver')}
              puedeSolicitar={puede(perfil, 'costos.solicitar_pago')}
              ordenCerrada={ESTADOS_CERRADOS.includes(orden.estado)} />
          )}
          {salida && <SalidaDeUnidad ordenId={orden.id}
            liberacion={salida.liberacion} entrega={salida.entrega} fisica={salida.fisica}
            puedeRegistrarSalida={puede(perfil, 'ordenes.entregar')}
            puedeLiberar={puede(perfil, 'tesoreria.liberar')}
            puedeConfirmar={puede(perfil, ['ordenes.entregar', 'produccion.actividades'])}
            puedeRegistrarEntrega={orden.estado === 'TERMINADA' && puede(perfil, 'ordenes.entregar')} />}
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
          {!orden.plan_etapas_manual && (secciones.includes('ficha') || secciones.includes('avance')) && (
            <Tarjeta>
              <TarjetaCabecera titulo="Registros del flujo anterior" descripcion="Estos documentos y reportes se conservan para consulta." />
              <TarjetaCuerpo className="flex flex-wrap gap-2">
                {secciones.includes('ficha') && <EnlaceBoton href={`/ordenes/${orden.id}?vista=ficha`} variante="secundario" tamano="sm">Ver ficha de taller</EnlaceBoton>}
                {secciones.includes('avance') && <EnlaceBoton href={`/ordenes/${orden.id}?vista=avance`} variante="secundario" tamano="sm">Ver reportes anteriores</EnlaceBoton>}
              </TarjetaCuerpo>
            </Tarjeta>
          )}
          <Bitacora ordenId={orden.id} eventos={timeline} puedeComentar={puede(perfil, 'ordenes.ver')} />
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

