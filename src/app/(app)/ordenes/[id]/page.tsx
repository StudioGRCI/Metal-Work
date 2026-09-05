import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, PRIORIDAD, TIPO_TRABAJO, definir } from '@/lib/dominio/estados'
import { cantidad, fecha, fechaHora, hoyLima, moneda, numero as fmtNumero } from '@/lib/format'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import {
  cronogramaDeOrden,
  estadoDeSalida,
  fechasClaveDeOrden,
  listarEtapas,
  listarHorasOrden,
  listarInspecciones,
  obtenerOrden,
} from '@/lib/datos/ordenes'
import { costoDeOrden, materialesDeOrden } from '@/lib/datos/costos'
import { cumplimientoDeOrden } from '@/lib/datos/cumplimiento'
import {
  accesoriosDeOrden,
  personalDelTaller,
  repuestosDeOrden,
  verificacionesDeOrden,
} from '@/lib/datos/ficha-ot'
import { timelineDeOrden, tiposDocumento } from '@/lib/datos/documentos'
import { exigirPermiso, puede } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

import { AccionesEstado } from './acciones-estado'
import { AvanceDeOrden } from '@/components/avance/avance-de-orden'

import { Bitacora } from './bitacora'
import { Costos } from './costos'
import { Cronograma } from './cronograma'
import { Cumplimiento } from './cumplimiento'
import { DocumentosOrden } from './documentos'
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
  'cronograma',
  'cumplimiento',
  'avance',
  'horas',
  'costos',
  'calidad',
  'documentos',
  'bitacora',
] as const
type Vista = (typeof VISTAS)[number]

/** Estados en los que la orden ya no corre plazo: no puede estar atrasada. */
const ESTADOS_CERRADOS: string[] = ['ENTREGADA', 'FACTURADA', 'ANULADA']

function pasadoDeHoras(reales: number | null, estimadas: number | null) {
  return Number(estimadas ?? 0) > 0 && Number(reales ?? 0) > Number(estimadas ?? 0)
}

/** Un número solo no dice nada: 120 h son pocas o muchas según lo estimado. */
function pieDeHoras(reales: number | null, estimadas: number | null) {
  const est = Number(estimadas ?? 0)
  const real = Number(reales ?? 0)
  if (est <= 0) return 'Sin horas estimadas con qué comparar'
  if (real > est) return `${cantidad(real - est)} h por encima de lo estimado`
  return `Quedan ${cantidad(est - real)} h del estimado`
}

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
  const verCostos = vista === 'costos' && puede(perfil, 'costos.ver')

  const verFicha = vista === 'ficha'
  // La salida importa cuando la orden se acerca a la puerta.
  const verSalida = vista === 'resumen' && ['TERMINADA', 'CONTROL_CALIDAD', 'ENTREGADA'].includes(orden.estado)

  const [
    etapas,
    timeline,
    inspecciones,
    horas,
    costo,
    materiales,
    tipos,
    accesorios,
    repuestos,
    verificaciones,
    personal,
    cronograma,
    cumplimiento,
  ] = await Promise.all([
    vista === 'etapas' || vista === 'resumen' ? listarEtapas(id) : Promise.resolve([]),
    vista === 'bitacora' ? timelineDeOrden(id) : Promise.resolve([]),
    vista === 'calidad' ? listarInspecciones(id) : Promise.resolve([]),
    vista === 'horas' ? listarHorasOrden(id) : Promise.resolve([]),
    verCostos ? costoDeOrden(id) : Promise.resolve(null),
    verCostos ? materialesDeOrden(id) : Promise.resolve([]),
    vista === 'documentos' ? tiposDocumento() : Promise.resolve([]),
    verFicha ? accesoriosDeOrden(id) : Promise.resolve([]),
    verFicha ? repuestosDeOrden(id) : Promise.resolve([]),
    verFicha ? verificacionesDeOrden(id) : Promise.resolve([]),
    verFicha ? personalDelTaller() : Promise.resolve([]),
    vista === 'cronograma' ? cronogramaDeOrden(id) : Promise.resolve([]),
    vista === 'cumplimiento' ? cumplimientoDeOrden(id) : Promise.resolve(null),
  ])

  const [salida, fechasClave] = await Promise.all([
    verSalida ? estadoDeSalida(id) : Promise.resolve(null),
    vista === 'resumen' ? fechasClaveDeOrden(id) : Promise.resolve(null),
  ])

  const estado = definir(ESTADO_OT, orden.estado)
  const prioridad = definir(PRIORIDAD, orden.prioridad)
  const cliente = orden.cliente as unknown as { razon_social: string; numero_documento: string; telefono: string | null }
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
        acciones={<AccionesEstado orden={{ id: orden.id, estado: orden.estado }} permisos={perfil.permisos} esAdmin={perfil.rol.codigo === 'ADMIN'} />}
      />

      {query.creada === '1' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          Orden registrada correctamente. Apruébala para generar sus etapas de producción.
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

      {/* Dos por fila desde el teléfono: cuatro tarjetas apiladas se comían la
          pantalla entera antes de llegar a las pestañas. En el monitor siguen
          siendo las cuatro de una fila, como siempre.
          Cada cifra lleva ahora a dónde se explica: el avance a su pestaña, las
          horas a los partes que las cargaron, el presupuesto al costo real. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Indicador
          titulo="Avance"
          valor={<Progreso valor={orden.avance_porcentaje} mostrarValor />}
          pie="Ponderado por las horas de cada etapa"
          href={`/ordenes/${orden.id}?vista=avance`}
        />
        <Indicador
          titulo="Horas"
          valor={
            <>
              {cantidad(orden.horas_reales)}
              <span className="text-sm font-normal text-texto-suave">
                {' / '}
                {cantidad(orden.horas_estimadas)} h
              </span>
            </>
          }
          tono={pasadoDeHoras(orden.horas_reales, orden.horas_estimadas) ? 'peligro' : 'neutro'}
          pie={pieDeHoras(orden.horas_reales, orden.horas_estimadas)}
          href={`/ordenes/${orden.id}?vista=horas`}
        />
        <Indicador
          titulo="Presupuesto"
          valor={moneda(orden.monto_presupuestado, orden.moneda as CodigoMoneda)}
          pie={cotizacion ? `Cotización ${cotizacion.numero}` : 'Sin cotización asociada'}
          href={puede(perfil, 'costos.ver') ? `/ordenes/${orden.id}?vista=costos` : undefined}
        />
        <Indicador
          titulo="Entrega comprometida"
          valor={fecha(orden.fecha_entrega_comprometida)}
          tono={entregaVencida ? 'peligro' : 'neutro'}
          pie={pieDeEntrega(orden.fecha_fin_real, orden.fecha_entrega_comprometida, entregaVencida)}
        />
      </div>

      <Pestanas ordenId={orden.id} activa={vista} verCostos={puede(perfil, 'costos.ver')} />

      {vista === 'resumen' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta>
            <TarjetaCabecera titulo="Cliente y unidad" />
            <TarjetaCuerpo className="space-y-0">
              <Dato etiqueta="Cliente" valor={cliente.razon_social} />
              <Dato etiqueta="Documento" valor={cliente.numero_documento} />
              <Dato etiqueta="Teléfono" valor={cliente.telefono} />
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
              documentosFaltantes={salida.documentosFaltantes}
              puedeLiberar={puede(perfil, 'tesoreria.liberar')}
              puedeConfirmar={puede(perfil, ['ordenes.entregar', 'requerimientos.crear'])}
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
          puedeEditar={puede(perfil, ['ordenes.editar', 'produccion.registrar', 'calidad.inspeccionar'])}
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

      {vista === 'cronograma' && (
        <Cronograma filas={cronograma} entregaComprometida={orden.fecha_entrega_comprometida} />
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

      {vista === 'avance' && (
        <AvanceDeOrden
          ordenId={orden.id}
          puedeRegistrar={puede(perfil, 'produccion.registrar')}
          conCabecera
        />
      )}

      {vista === 'horas' && (
        <TablaHoras horas={horas} puedeVerPartes={puede(perfil, 'produccion.ver')} />
      )}
      {vista === 'costos' &&
        (verCostos ? (
          <Costos costo={costo} materiales={materiales} />
        ) : (
          <Tarjeta>
            <TarjetaCuerpo>
              <p className="py-10 text-center text-sm text-texto-suave">
                Tu perfil no tiene acceso a la información de costos.
              </p>
            </TarjetaCuerpo>
          </Tarjeta>
        ))}
      {vista === 'calidad' && <TablaInspecciones inspecciones={inspecciones} />}
      {vista === 'documentos' && (
        <DocumentosOrden
          ordenId={orden.id}
          tipos={tipos}
          puedeSubir={puede(perfil, 'documentos.subir')}
        />
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

function TablaHoras({
  horas,
  puedeVerPartes,
}: {
  horas: Awaited<ReturnType<typeof listarHorasOrden>>
  puedeVerPartes: boolean
}) {
  const total = horas.reduce((suma, h) => suma + Number(h.horas_totales ?? 0), 0)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Horas registradas"
        descripcion={`${cantidad(total)} horas-hombre en ${horas.length} registros`}
      />
      <TarjetaCuerpo className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-borde bg-superficie-2">
              <tr>
                {/* El número de parte y las horas extra se esconden en el
                    teléfono y bajan a la celda de al lado en letra chica: son
                    las dos columnas que menos se miran de pie en el taller. */}
                <th className="hidden px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">Parte</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Fecha</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Operario</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Etapa</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">Horas</th>
                <th className="hidden px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase sm:table-cell">Extra</th>
              </tr>
            </thead>
            <tbody>
              {horas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center">
                    <p className="text-sm font-medium text-texto">
                      Todavía no se han registrado horas en esta orden
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-texto-suave">
                      Las horas no se anotan aquí: llegan de los partes diarios del taller. Al
                      aprobar un parte, sus horas se cargan a las etapas de esta orden.
                    </p>
                    {puedeVerPartes && (
                      <div className="mt-4 flex justify-center">
                        <EnlaceBoton href="/produccion" variante="secundario" tamano="sm">
                          Ver los partes diarios
                        </EnlaceBoton>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                horas.map((h) => {
                  const parte = h.parte as unknown as { numero: string; fecha: string; estado: string }
                  const usuario = h.usuario as unknown as { nombres: string; apellidos: string }
                  const etapa = h.etapa as unknown as { catalogo: { nombre: string } }
                  const extra = Number(h.horas_extra ?? 0)

                  return (
                    <tr key={h.id} className="border-b border-borde last:border-0">
                      <td className="hidden px-3 py-2 sm:table-cell">
                        {parte.numero}
                        {parte.estado !== 'APROBADO' && (
                          <span className="ml-1 text-[11px] text-aviso">(sin aprobar)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fecha(parte.fecha)}
                        <span className="block text-[11px] text-texto-suave sm:hidden">
                          {parte.numero}
                          {parte.estado !== 'APROBADO' && (
                            <span className="ml-1 text-aviso">(sin aprobar)</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2">{`${usuario.nombres} ${usuario.apellidos}`}</td>
                      <td className="px-3 py-2 text-texto-suave">{etapa.catalogo.nombre}</td>
                      <td className="tabular px-3 py-2 text-right">
                        {cantidad(h.horas)}
                        {extra > 0 && (
                          <span className="block text-[11px] text-texto-suave sm:hidden">
                            +{cantidad(extra)} extra
                          </span>
                        )}
                      </td>
                      <td className="tabular hidden px-3 py-2 text-right text-texto-suave sm:table-cell">
                        {cantidad(h.horas_extra)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function TablaInspecciones({
  inspecciones,
}: {
  inspecciones: Awaited<ReturnType<typeof listarInspecciones>>
}) {
  const TONOS = { CONFORME: 'exito', OBSERVADO: 'aviso', RECHAZADO: 'peligro' } as const

  return (
    <Tarjeta>
      <TarjetaCabecera titulo="Control de calidad" descripcion={`${inspecciones.length} inspecciones`} />
      <TarjetaCuerpo className="space-y-3">
        {inspecciones.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-texto">
              Aún no se han registrado inspecciones
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-texto-suave">
              Las levanta calidad sobre las etapas que exigen visto bueno; hasta que haya una
              conforme, esas etapas no se pueden dar por terminadas.
            </p>
          </div>
        ) : (
          inspecciones.map((i) => {
            const inspector = i.inspector as unknown as { nombres: string; apellidos: string } | null
            return (
              <div key={i.id} className="rounded-[var(--radius-base)] border border-borde p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-texto">{i.numero}</span>
                  <Insignia tono={TONOS[i.resultado as keyof typeof TONOS] ?? 'neutro'}>
                    {i.resultado}
                  </Insignia>
                </div>
                <p className="mt-1 text-xs text-texto-suave">
                  {fechaHora(i.fecha)}
                  {inspector && ` · ${inspector.nombres} ${inspector.apellidos}`}
                </p>
                {i.observaciones && <p className="mt-2 text-sm text-texto">{i.observaciones}</p>}
                {i.acciones_correctivas && (
                  <p className="mt-1 text-sm text-texto-suave">
                    <strong className="font-medium">Acciones:</strong> {i.acciones_correctivas}
                  </p>
                )}
                {i.fecha_levantamiento && (
                  <p className="mt-1 text-xs text-exito">
                    Observaciones levantadas el {fecha(i.fecha_levantamiento)}
                  </p>
                )}
              </div>
            )
          })
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
