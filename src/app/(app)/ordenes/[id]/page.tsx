import { FileText } from 'lucide-react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_ETAPA, PRIORIDAD, TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import { fecha, fechaHora, hoyLima, moneda, numero as fmtNumero, puesto } from '@/lib/format'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import {
  clientesParaElegir,
  estadoDeSalida,
  fechasClaveDeOrden,
  listarEtapas,
  obtenerOrden,
  timelineDeOrden,
} from '@/lib/datos/ordenes'
import { actividadesDeOrden, areasDelTaller } from '@/lib/datos/actividades'
import { adjuntosDeOrden } from '@/lib/datos/adjuntos'
import { cotizacionPdfDeOrden } from '@/lib/datos/cotizaciones-pdf'
import { materialesParaPantalla } from '@/lib/datos/materiales-orden'
import { cumplimientoDeOrden } from '@/lib/datos/cumplimiento'
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
import type { CodigoMoneda } from '@/lib/format'

import { AccionesEstado } from './acciones-estado'
import { ArchivosDeOrden, type AdjuntoEnPantalla } from './archivos-de-orden'
import { PonerCliente } from './poner-cliente'
import { AvanceDeOrden } from '@/components/avance/avance-de-orden'

import { Bitacora } from './bitacora'
import { Observaciones } from './observaciones'
import { Cumplimiento } from './cumplimiento'
import { ActividadesDeOrden } from './actividades'
import { MaterialesDeOrden } from './materiales'
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
  'cumplimiento',
  'materiales',
  'actividades',
  'avance',
  'bitacora',
] as const
type Vista = (typeof VISTAS)[number]

/** Estados en los que la orden ya no corre plazo: no puede estar atrasada. */
const ESTADOS_CERRADOS: string[] = ['ENTREGADA', 'FACTURADA', 'ANULADA']

function pieDeEntrega(finReal: string | null, comprometida: string | null, vencida: boolean) {
  if (finReal) return `Trabajo terminado el ${fecha(finReal)}`
  if (vencida) return 'Ya pasó la fecha prometida al cliente'
  if (comprometida) return 'Fecha prometida al cliente'
  return 'Todavía sin fecha comprometida'
}

export default async function PaginaOrden({ params, searchParams }: PageProps<'/ordenes/[id]'>) {
  const perfil = await exigirPermiso('ordenes.ver')
  const { id } = await params
  const query = await searchParams

  // La cotización de la que salió va en la cabecera de todas las pestañas; se
  // pide junto con la orden y solo si quien mira ve cotizaciones.
  const [orden, cotizacionPdf, pendientes] = await Promise.all([
    obtenerOrden(id),
    puede(perfil, 'cotizaciones.ver') ? cotizacionPdfDeOrden(id) : Promise.resolve(null),
    // Lo pendiente se cuenta en todas las pestañas: es lo que las numera.
    pendientesDeOrden(id),
  ])
  if (!orden) notFound()

  const toca = queMeToca(perfil, pendientes, orden)
  // Por qué la hoja de Diseño no acepta planos: en borrador falta quien la
  // apruebe; cerrada, ya no hay qué repartir.
  const motivoInactiva =
    orden.estado === 'BORRADOR'
      ? orden.abierta_en_taller
        ? 'Falta que el jefe de producción apruebe la orden'
        : 'Falta que Gerencia apruebe la orden'
      : ESTADOS_CERRADOS.includes(orden.estado)
        ? 'La orden ya se cerró'
        : null

  const vista: Vista = VISTAS.includes(query.vista as Vista) ? (query.vista as Vista) : 'resumen'

  // Cada pestaña carga solo lo suyo: la bitácora de una OT larga puede tener
  // cientos de eventos y no tiene sentido traerlos para ver el resumen.
  const verFicha = vista === 'ficha'
  // La salida importa cuando la orden se acerca a la puerta.
  const verSalida = vista === 'resumen' && ['TERMINADA', 'CONTROL_CALIDAD', 'ENTREGADA'].includes(orden.estado)

  const [etapas, timeline, accesorios, repuestos, verificaciones, personal, cumplimiento] =
    await Promise.all([
      vista === 'etapas' || vista === 'resumen' ? listarEtapas(id) : Promise.resolve([]),
      vista === 'bitacora' ? timelineDeOrden(id) : Promise.resolve([]),
      verFicha ? accesoriosDeOrden(id) : Promise.resolve([]),
      verFicha ? repuestosDeOrden(id) : Promise.resolve([]),
      verFicha ? verificacionesDeOrden(id) : Promise.resolve([]),
      verFicha ? personalDelTaller() : Promise.resolve([]),
      vista === 'cumplimiento' ? cumplimientoDeOrden(id) : Promise.resolve(null),
    ])

  const [salida, fechasClave] = await Promise.all([
    verSalida ? estadoDeSalida(id) : Promise.resolve(null),
    vista === 'resumen' ? fechasClaveDeOrden(id) : Promise.resolve(null),
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

  // La lista de Diseño y su catálogo.
  const listaMateriales = vista === 'materiales' ? await materialesParaPantalla(id) : null

  // De qué mano es quien mira la hoja de cumplimiento: el supervisor de
  // Maestranza ve solo sus botones; el jefe (cualquier área) y la oficina, los dos.
  const codigoDeSuArea =
    vista === 'cumplimiento' && !puede(perfil, 'produccion.cualquier_area') && perfil.area_id
      ? ((await areasDelTaller()).find((a) => a.id === perfil.area_id)?.codigo ?? null)
      : null
  const manoDelTaller = codigoDeSuArea === 'MTZ' || codigoDeSuArea === 'PRD' ? codigoDeSuArea : null

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
    ? hojaAreas[1].filter(
        (a) => areasArmables.some((x) => x.id === a.id) || areasDeSuMano(perfil, [a]).length > 0,
      )
    : []

  // Las observaciones van arriba del resumen, con las áreas a las que se dirigen.
  const [observaciones, areasParaObservar] =
    vista === 'resumen' ? await Promise.all([observacionesDeOrden(id), areasDelTaller()]) : [[], []]

  // Los archivos de la orden (099): en el resumen y junto a la hoja, que es
  // donde el taller los busca. Quitarlos es de quien los subió, la oficina o
  // el jefe: lo mismo que dice la política.
  const puedeSubirArchivos = puede(perfil, [
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
  const cotizacion = orden.cotizacion as unknown as { numero: string } | null
  // El monto es de quien arma o cobra la cotización, y solo cuando lo hay: la
  // orden que sale de la cotización en PDF no lo trae, y «S/ 0.00» mentía.
  const verMonto = Number(orden.monto_presupuestado ?? 0) > 0 && puede(perfil, ['cotizaciones.costear', 'pagos.ver'])

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

      {query.creada === '1' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          {/* A quien no aprueba no se le pide que apruebe: se le dice quién lo hace. */}
          {puede(perfil, 'ordenes.aprobar')
            ? 'Orden registrada. Apruébala para que nazcan sus etapas de producción.'
            : 'Orden registrada. Gerencia tiene que aprobarla para que nazcan sus etapas de producción; ya se le avisó.'}
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
          La abrió el taller y espera que el jefe de producción la apruebe o la rechace; ya se le
          avisó. Mientras, se le puede armar la lista de actividades y reportar. Al aprobarla nacen
          sus etapas y sus plazos.
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

      {/* Dos por fila desde el teléfono: las tarjetas apiladas se comían la
          pantalla entera antes de llegar a las pestañas. La tercera ocupa la
          fila entera ahí. `min-w-0` deja que cada tarjeta se achique: sin él,
          el contenido más ancho estiraba la columna fuera de la pantalla. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 *:min-w-0">
        <Indicador
          titulo="Avance"
          valor={<Progreso valor={orden.avance_porcentaje} mostrarValor />}
          pie="Ponderado por las horas de cada etapa"
          href={`/ordenes/${orden.id}?vista=etapas`}
        />
        <Indicador
          titulo="Entrega"
          valor={fecha(orden.fecha_entrega_comprometida)}
          tono={entregaVencida ? 'peligro' : 'neutro'}
          pie={pieDeEntrega(orden.fecha_fin_real, orden.fecha_entrega_comprometida, entregaVencida)}
        />
        {/* Quien no ve cotizaciones —el taller— no sabría si la orden salió de
            una o no: para él la tercera dice qué se fabrica. */}
        {!verMonto && !puede(perfil, 'cotizaciones.ver') ? (
          <Indicador
            className="col-span-2 lg:col-span-1"
            titulo="Carrocería"
            valor={tipoCarroceria?.nombre ?? '—'}
            pie={definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta}
          />
        ) : (
        <Indicador
          className="col-span-2 lg:col-span-1"
          titulo={verMonto ? 'Presupuesto' : 'Cotización'}
          valor={
            verMonto
              ? moneda(orden.monto_presupuestado, orden.moneda as CodigoMoneda)
              : (cotizacionPdf?.numero ?? cotizacion?.numero ?? '—')
          }
          pie={
            cotizacionPdf?.url ? (
              <a
                href={cotizacionPdf.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-medium text-acento hover:underline sm:min-h-0"
              >
                <FileText aria-hidden className="size-3.5 shrink-0" />
                {verMonto ? `Cotización ${cotizacionPdf.numero}` : 'Abrir la cotización'}
              </a>
            ) : cotizacion ? (
              verMonto ? `Cotización ${cotizacion.numero}` : 'La cotización de venta que abrió la orden'
            ) : cotizacionPdf ? (
              'La cotización de la que salió la orden'
            ) : (
              'La orden no salió de una cotización'
            )
          }
        />
        )}
      </div>

      <TeToca ordenId={orden.id} items={toca.items} />

      <Pestanas ordenId={orden.id} activa={vista} contadores={toca.contadores} />

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

          <Tarjeta>
            <TarjetaCabecera titulo="Cliente y unidad" />
            <TarjetaCuerpo className="space-y-0">
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
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera titulo="Trabajo" />
            <TarjetaCuerpo className="space-y-0">
              <Dato etiqueta="Tipo de trabajo" valor={definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta} />
              <Dato etiqueta="Tipo de carrocería" valor={tipoCarroceria?.nombre} />
              <Dato etiqueta="Taller" valor={sede.nombre} />
              <Dato
                etiqueta="Responsable"
                valor={responsable ? puesto(responsable) : null}
              />
              <Dato etiqueta="Registrada" valor={fecha(orden.fecha_registro)} />
              <Dato etiqueta="Inicio real" valor={fechaHora(orden.fecha_inicio_real)} />
            </TarjetaCuerpo>
          </Tarjeta>

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
              descripcion={`${etapas.filter((e) => e.estado === 'TERMINADA').length} de ${etapas.length} terminadas`}
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
                  Las etapas se generan al aprobar la orden.
                </p>
              ) : (
                <ol className="divide-y divide-borde">
                  {etapas.map((etapa) => {
                    const estadoEtapa = definir(ESTADO_ETAPA, etapa.estado)
                    return (
                      <li key={etapa.etapa_id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-texto">{etapa.etapa}</p>
                          {etapa.estado !== 'PENDIENTE' && (
                            <p className="text-[11px] text-texto-suave">{estadoEtapa.etiqueta}</p>
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
            {salida && (
              <SalidaDeUnidad
                ordenId={orden.id}
                liberacion={salida.liberacion}
                entrega={salida.entrega}
                puedeLiberar={puede(perfil, 'tesoreria.liberar')}
                puedeConfirmar={puede(perfil, ['ordenes.entregar', 'produccion.actividades'])}
              />
            )}
            {fechasClave && (
              <FechasClave
                fechas={fechasClave}
                disenoCumplida={pendientes.planos > 0 && pendientes.planosEntregados >= pendientes.planos}
              />
            )}
            {archivos && (
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
          puedeEditar={puede(perfil, ['ordenes.editar', 'produccion.registrar'])}
          puedeEscribirOrden={puede(perfil, ['ordenes.editar', 'ordenes.cambiar_estado'])}
          puedeArmar={puede(perfil, ['ordenes.editar', 'produccion.registrar'])}
        />
      )}

      {vista === 'etapas' && (
        <Etapas
          ordenId={orden.id}
          etapas={etapas}
          puedeRegistrar={puede(perfil, 'produccion.registrar')}
        />
      )}

      {vista === 'cumplimiento' && (
        <Cumplimiento
          ordenId={orden.id}
          resumen={cumplimiento?.resumen ?? null}
          planos={cumplimiento?.planos ?? []}
          puedeDisenar={puede(perfil, 'diseno.planos')}
          puedeReportar={puede(perfil, 'produccion.registrar')}
          areaPropia={manoDelTaller}
          puedeObservar={orden.estado !== 'ANULADA'}
          ordenViva={motivoInactiva === null}
          motivoInactiva={motivoInactiva}
        />
      )}

      {vista === 'materiales' && listaMateriales && (
        <MaterialesDeOrden
          ordenId={orden.id}
          materiales={listaMateriales.materiales}
          catalogo={listaMateriales.catalogo}
          puedeDisenar={puede(perfil, 'diseno.planos')}
          ordenViva={motivoInactiva === null}
          motivoInactiva={motivoInactiva}
        />
      )}

      {vista === 'actividades' && hojaAreas && (
        <ActividadesDeOrden
          ordenId={orden.id}
          actividades={hojaAreas[0].actividades}
          areas={hojaAreas[0].areas}
          diario={hojaAreas[0].diario}
          /* Las áreas de la lista son las que esta persona puede escribir: la
             suya, o todas si responde por el taller entero o es Diseño.
             Ofrecerle las que el RLS le va a rechazar es prometerle un botón
             que no hace nada. */
          areasDisponibles={areasArmables}
          areasVisibles={areasVisibles}
          puedeArmar={areasArmables.length > 0}
          puedeReportar={puede(perfil, 'produccion.registrar')}
          areaPropia={perfil.area_id}
          aprueba={puede(perfil, 'produccion.aprobar_reportes')}
          /* Quién corrige qué lo decide el gemelo de las políticas, acá en el
             servidor: la hoja es un componente de cliente y el perfil no viaja. */
          corregibles={hojaAreas[0].diario
            .filter((r) =>
              puedeCorregirReporte(
                perfil,
                { clase: 'hoja', revision: r.revision, autor: r.reportado_por, fecha: r.fecha, areaId: r.area_id },
                hoyLima(),
              ),
            )
            .map((r) => r.id)}
          eliminables={hojaAreas[0].diario
            .filter((r) => puedeEliminarReporte(perfil, { revision: r.revision, autor: r.reportado_por }))
            .map((r) => r.id)}
        />
      )}

      {vista === 'actividades' && archivos && (
        <div className="mt-4">
          <ArchivosDeOrden ordenId={orden.id} adjuntos={archivos} puedeSubir={puedeSubirArchivos} />
        </div>
      )}

      {vista === 'avance' && (
        <AvanceDeOrden ordenId={orden.id} perfil={perfil} conCabecera />
      )}

      {vista === 'bitacora' && (
        <Bitacora ordenId={orden.id} eventos={timeline} puedeComentar={puede(perfil, 'ordenes.ver')} />
      )}
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

