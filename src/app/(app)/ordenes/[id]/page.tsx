import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, PRIORIDAD, TIPO_TRABAJO, definir } from '@/lib/dominio/estados'
import { cantidad, fecha, fechaHora, moneda, numero as fmtNumero } from '@/lib/format'
import {
  listarEtapas,
  listarHorasOrden,
  listarInspecciones,
  obtenerOrden,
} from '@/lib/datos/ordenes'
import { costoDeOrden, materialesDeOrden } from '@/lib/datos/costos'
import { timelineDeOrden, tiposDocumento } from '@/lib/datos/documentos'
import { exigirPermiso, puede } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

import { AccionesEstado } from './acciones-estado'
import { AvanceDeOrden } from '@/components/avance/avance-de-orden'

import { Bitacora } from './bitacora'
import { Costos } from './costos'
import { DocumentosOrden } from './documentos'
import { Etapas } from './etapas'
import { Pestanas } from './pestanas'

export async function generateMetadata({ params }: PageProps<'/ordenes/[id]'>): Promise<Metadata> {
  const { id } = await params
  const orden = await obtenerOrden(id)
  return { title: orden ? `Orden ${orden.numero}` : 'Orden no encontrada' }
}

const VISTAS = ['resumen', 'etapas', 'avance', 'horas', 'costos', 'calidad', 'documentos', 'bitacora'] as const
type Vista = (typeof VISTAS)[number]

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

  const [etapas, timeline, inspecciones, horas, costo, materiales, tipos] = await Promise.all([
    vista === 'etapas' || vista === 'resumen' ? listarEtapas(id) : Promise.resolve([]),
    vista === 'bitacora' ? timelineDeOrden(id) : Promise.resolve([]),
    vista === 'calidad' ? listarInspecciones(id) : Promise.resolve([]),
    vista === 'horas' ? listarHorasOrden(id) : Promise.resolve([]),
    verCostos ? costoDeOrden(id) : Promise.resolve(null),
    verCostos ? materialesDeOrden(id) : Promise.resolve([]),
    vista === 'documentos' ? tiposDocumento() : Promise.resolve([]),
  ])

  const estado = definir(ESTADO_OT, orden.estado)
  const prioridad = definir(PRIORIDAD, orden.prioridad)
  const cliente = orden.cliente as unknown as { razon_social: string; numero_documento: string; telefono: string | null }
  const unidad = orden.unidad as unknown as { placa: string; marca: string | null; modelo: string | null; anio: number | null; numero_chasis: string | null } | null
  const sede = orden.sede as unknown as { nombre: string }
  const responsable = orden.responsable as unknown as { nombres: string; apellidos: string } | null
  const tipoCarroceria = orden.tipo_carroceria as unknown as { nombre: string } | null

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

      <div className="grid gap-4 lg:grid-cols-4">
        <Indicador titulo="Avance">
          <Progreso valor={orden.avance_porcentaje} mostrarValor />
        </Indicador>
        <Indicador titulo="Horas">
          <p className="tabular text-lg font-semibold text-texto">
            {cantidad(orden.horas_reales)}
            <span className="text-sm font-normal text-texto-suave"> / {cantidad(orden.horas_estimadas)} h</span>
          </p>
        </Indicador>
        <Indicador titulo="Presupuesto">
          <p className="tabular text-lg font-semibold text-texto">
            {moneda(orden.monto_presupuestado, orden.moneda as CodigoMoneda)}
          </p>
        </Indicador>
        <Indicador titulo="Entrega comprometida">
          <p className="text-lg font-semibold text-texto">{fecha(orden.fecha_entrega_comprometida)}</p>
        </Indicador>
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
              <Dato etiqueta="Placa" valor={unidad?.placa} />
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
                    <span className="w-44 shrink-0 truncate text-sm text-texto">{etapa.etapa}</span>
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

      {vista === 'etapas' && (
        <Etapas
          ordenId={orden.id}
          etapas={etapas}
          puedeRegistrar={puede(perfil, 'produccion.registrar')}
        />
      )}

      {vista === 'avance' && (
        <AvanceDeOrden
          ordenId={orden.id}
          puedeRegistrar={puede(perfil, 'produccion.registrar')}
          conCabecera
        />
      )}

      {vista === 'horas' && <TablaHoras horas={horas} />}
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

function Indicador({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Tarjeta>
      <TarjetaCuerpo>
        <p className="mb-2 text-[11px] font-medium tracking-wide text-texto-suave uppercase">
          {titulo}
        </p>
        {children}
      </TarjetaCuerpo>
    </Tarjeta>
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

function TablaHoras({ horas }: { horas: Awaited<ReturnType<typeof listarHorasOrden>> }) {
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
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Parte</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Fecha</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Operario</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">Etapa</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">Horas</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">Extra</th>
              </tr>
            </thead>
            <tbody>
              {horas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-texto-suave">
                    Todavía no se han registrado horas en esta orden.
                  </td>
                </tr>
              ) : (
                horas.map((h) => {
                  const parte = h.parte as unknown as { numero: string; fecha: string; estado: string }
                  const usuario = h.usuario as unknown as { nombres: string; apellidos: string }
                  const etapa = h.etapa as unknown as { catalogo: { nombre: string } }

                  return (
                    <tr key={h.id} className="border-b border-borde last:border-0">
                      <td className="px-3 py-2">
                        {parte.numero}
                        {parte.estado !== 'APROBADO' && (
                          <span className="ml-1 text-[11px] text-aviso">(sin aprobar)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fecha(parte.fecha)}</td>
                      <td className="px-3 py-2">{`${usuario.nombres} ${usuario.apellidos}`}</td>
                      <td className="px-3 py-2 text-texto-suave">{etapa.catalogo.nombre}</td>
                      <td className="tabular px-3 py-2 text-right">{cantidad(h.horas)}</td>
                      <td className="tabular px-3 py-2 text-right text-texto-suave">
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
          <p className="py-6 text-center text-sm text-texto-suave">
            Aún no se han registrado inspecciones para esta orden.
          </p>
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
