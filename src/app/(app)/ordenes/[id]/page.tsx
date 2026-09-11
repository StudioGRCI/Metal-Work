import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { PRIORIDAD, TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import { fecha, fechaHora, hoyLima, moneda, numero as fmtNumero } from '@/lib/format'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import {
  estadoDeSalida,
  fechasClaveDeOrden,
  listarEtapas,
  obtenerOrden,
  timelineDeOrden,
} from '@/lib/datos/ordenes'
import { actividadesDeOrden, areasDelTaller } from '@/lib/datos/actividades'
import { adjuntosDeOrden } from '@/lib/datos/adjuntos'
import { materialesParaPantalla } from '@/lib/datos/materiales-orden'
import { cumplimientoDeOrden } from '@/lib/datos/cumplimiento'
import {
  accesoriosDeOrden,
  personalDelTaller,
  repuestosDeOrden,
  verificacionesDeOrden,
} from '@/lib/datos/ficha-ot'
import {
  areasDeSuMano,
  exigirPermiso,
  puede,
  puedeCorregirReporte,
  puedeEliminarReporte,
} from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

import { AccionesEstado } from './acciones-estado'
import { ArchivosDeOrden, type AdjuntoEnPantalla } from './archivos-de-orden'
import { AvanceDeOrden } from '@/components/avance/avance-de-orden'

import { Bitacora } from './bitacora'
import { Cumplimiento } from './cumplimiento'
import { ActividadesDeOrden } from './actividades'
import { MaterialesDeOrden } from './materiales'
import { Etapas } from './etapas'
import { FichaTaller } from './ficha-taller'
import { FechasClave, SalidaDeUnidad } from './salida-y-plazos'
import { Pestanas } from './pestanas'

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

  const orden = await obtenerOrden(id)
  if (!orden) notFound()

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

  // La lista de Diseño y su catálogo.
  const listaMateriales = vista === 'materiales' ? await materialesParaPantalla(id) : null

  // La hoja de avance de cada area, con sus actividades y el diario.
  const hojaAreas =
    vista === 'actividades'
      ? await Promise.all([actividadesDeOrden(id), areasDelTaller()])
      : null

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
  // matrícula llega meses después, con la tarjeta de propiedad.
  // `codigo_interno` va opcional porque el select de `obtenerOrden` todavía no
  // lo trae; en cuanto lo traiga, nombreDeUnidad lo usa sin tocar esta pantalla.
  const unidad = orden.unidad as unknown as {
    placa: string | null
    codigo_interno?: string | null
    marca: string | null
    modelo: string | null
    anio: number | null
    numero_chasis: string | null
  } | null
  const sede = orden.sede as unknown as { nombre: string }
  const responsable = orden.responsable as unknown as { nombres: string; apellidos: string } | null
  const tipoCarroceria = orden.tipo_carroceria as unknown as { nombre: string } | null
  const cotizacion = orden.cotizacion as unknown as { numero: string } | null

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
        descripcion={orden.descripcion}
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
          Orden registrada correctamente. Apruébala para generar sus etapas de producción.
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
          pantalla entera antes de llegar a las pestañas. El avance lleva a su
          pestaña; el presupuesto es el de la cotización que abrió la orden. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Indicador
          titulo="Avance"
          valor={<Progreso valor={orden.avance_porcentaje} mostrarValor />}
          pie="Ponderado por las horas de cada etapa"
          href={`/ordenes/${orden.id}?vista=avance`}
        />
        <Indicador
          titulo="Presupuesto"
          valor={moneda(orden.monto_presupuestado, orden.moneda as CodigoMoneda)}
          pie={cotizacion ? `Cotización ${cotizacion.numero}` : 'Sin cotización asociada'}
        />
        <Indicador
          titulo="Entrega comprometida"
          valor={fecha(orden.fecha_entrega_comprometida)}
          tono={entregaVencida ? 'peligro' : 'neutro'}
          pie={pieDeEntrega(orden.fecha_fin_real, orden.fecha_entrega_comprometida, entregaVencida)}
        />
      </div>

      <Pestanas ordenId={orden.id} activa={vista} />

      {vista === 'resumen' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta>
            <TarjetaCabecera titulo="Cliente y unidad" />
            <TarjetaCuerpo className="space-y-0">
              <Dato etiqueta="Cliente" valor={cliente?.razon_social ?? null} />
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
                valor={responsable ? `${responsable.nombres} ${responsable.apellidos}` : null}
              />
              <Dato etiqueta="Registrada" valor={fecha(orden.fecha_registro)} />
              <Dato etiqueta="Inicio real" valor={fechaHora(orden.fecha_inicio_real)} />
            </TarjetaCuerpo>
          </Tarjeta>

          {fechasClave && <FechasClave fechas={fechasClave} />}

          {salida && (
            <SalidaDeUnidad
              ordenId={orden.id}
              liberacion={salida.liberacion}
              entrega={salida.entrega}
              puedeLiberar={puede(perfil, 'tesoreria.liberar')}
              puedeConfirmar={puede(perfil, ['ordenes.entregar', 'produccion.actividades'])}
            />
          )}

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

          <Tarjeta className="lg:col-span-2">
            <TarjetaCabecera
              titulo="Etapas de producción"
              descripcion={`${etapas.filter((e) => e.estado === 'TERMINADA').length} de ${etapas.length} terminadas`}
            />
            <TarjetaCuerpo className="space-y-2">
              {etapas.length === 0 ? (
                <p className="py-4 text-center text-sm text-texto-suave">
                  Las etapas se generan al aprobar la orden.
                </p>
              ) : (
                etapas.map((etapa) => (
                  <div key={etapa.etapa_id} className="flex items-center gap-3">
                    {/* En el teléfono el nombre cede sitio a la barra, que es
                        lo que se viene a mirar; en el monitor no se mueve. */}
                    <span className="w-28 shrink-0 truncate text-sm text-texto sm:w-44">
                      {etapa.etapa}
                    </span>
                    <Progreso valor={etapa.avance_porcentaje} alto="sm" />
                    <span className="tabular w-12 shrink-0 text-right text-xs text-texto-suave">
                      {fmtNumero(etapa.avance_porcentaje, 0)}%
                    </span>
                  </div>
                ))
              )}
            </TarjetaCuerpo>
          </Tarjeta>

          {archivos && (
            <div className="lg:col-span-2">
              <ArchivosDeOrden ordenId={orden.id} adjuntos={archivos} puedeSubir={puedeSubirArchivos} />
            </div>
          )}
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
          ordenViva={!['BORRADOR', ...ESTADOS_CERRADOS].includes(orden.estado)}
        />
      )}

      {vista === 'materiales' && listaMateriales && (
        <MaterialesDeOrden
          ordenId={orden.id}
          materiales={listaMateriales.materiales}
          catalogo={listaMateriales.catalogo}
          puedeDisenar={puede(perfil, 'diseno.planos')}
          ordenViva={!['BORRADOR', ...ESTADOS_CERRADOS].includes(orden.estado)}
        />
      )}

      {vista === 'actividades' && hojaAreas && (
        <ActividadesDeOrden
          ordenId={orden.id}
          actividades={hojaAreas[0].actividades}
          areas={hojaAreas[0].areas}
          diario={hojaAreas[0].diario}
          /* Las áreas de la lista son las que esta persona puede escribir: la
             suya, o todas si responde por el taller entero. Ofrecerle las que
             el RLS le va a rechazar es prometerle un botón que no hace nada. */
          areasDisponibles={areasDeSuMano(perfil, hojaAreas[1])}
          puedeArmar={
            puede(perfil, 'produccion.actividades') &&
            areasDeSuMano(perfil, hojaAreas[1]).length > 0
          }
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
      <span className="text-texto-suave">{etiqueta}</span>
      <span className="text-right font-medium text-texto">{valor || '—'}</span>
    </div>
  )
}

