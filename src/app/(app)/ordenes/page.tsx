import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cantidad, fecha } from '@/lib/format'
import { ESTADO_OT, PRIORIDAD, TIPO_TRABAJO, definir } from '@/lib/dominio/estados'
import {
  ORDENES_POR_PAGINA,
  comoEstado,
  comoPrioridad,
  listarOrdenes,
} from '@/lib/datos/ordenes'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FiltrosOrdenes } from './filtros-ordenes'

export const metadata = { title: 'Órdenes de trabajo' }

function texto(valor: unknown) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined
}

export default async function PaginaOrdenes({ searchParams }: PageProps<'/ordenes'>) {
  const perfil = await exigirPermiso('ordenes.ver')
  const params = await searchParams

  const filtros = {
    busqueda: texto(params.q),
    estado: comoEstado(params.estado),
    prioridad: comoPrioridad(params.prioridad),
    atrasadas: params.atrasadas === '1',
    pagina: Number(params.pagina) || 1,
  }

  const { ordenes, total, pagina, paginas } = await listarOrdenes(filtros)
  const hayFiltros = Boolean(
    filtros.busqueda || filtros.estado || filtros.prioridad || filtros.atrasadas,
  )
  const puedeCrear = puede(perfil, 'ordenes.crear')

  // Cero con filtros puestos y cero de verdad no son lo mismo: al que busca le
  // importa saber si el vacío lo produjo su propio filtro.
  const vacio = hayFiltros
    ? 'Ninguna orden coincide con los filtros aplicados'
    : 'Ninguna orden registrada todavía'

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de trabajo"
        descripcion={
          total === 0
            ? vacio
            : `${total.toLocaleString('es-PE')} ${total === 1 ? 'orden' : 'órdenes'}${hayFiltros ? ' con los filtros aplicados' : ''}`
        }
        acciones={
          puedeCrear && (
            <EnlaceBoton href="/ordenes/nueva">
              <Plus aria-hidden className="size-4" />
              Nueva orden
            </EnlaceBoton>
          )
        }
      />

      <FiltrosOrdenes />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH>Cliente / unidad</TH>
              <TH>Trabajo</TH>
              <TH>Estado</TH>
              <TH className="w-40">Avance</TH>
              {/* Horas y responsable se esconden en el teléfono —donde la tabla
                  ya no cabe— y su dato baja en letra chica a la celda de al
                  lado, para no perderlo por el camino. */}
              <TH className="hidden text-right sm:table-cell">Horas</TH>
              <TH>Entrega</TH>
              <TH className="hidden sm:table-cell">Responsable</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {ordenes.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={hayFiltros ? 'Ninguna orden con estos filtros' : 'Aún no hay órdenes de trabajo'}
                descripcion={
                  hayFiltros
                    ? 'Con los filtros puestos no aparece ninguna. Prueba con otro estado, otra prioridad, o quita la búsqueda.'
                    : 'Registra la primera orden para empezar a controlar la producción.'
                }
                accion={
                  hayFiltros ? (
                    <EnlaceBoton href="/ordenes" variante="secundario" tamano="sm">
                      Quitar los filtros
                    </EnlaceBoton>
                  ) : (
                    puedeCrear && (
                      <EnlaceBoton href="/ordenes/nueva" tamano="sm">
                        <Plus aria-hidden className="size-4" />
                        Registrar la primera orden
                      </EnlaceBoton>
                    )
                  )
                }
              />
            ) : (
              ordenes.map((orden) => {
                const estado = definir(ESTADO_OT, orden.estado)
                const prioridad = definir(PRIORIDAD, orden.prioridad)
                const atraso = orden.dias_atraso ?? 0
                // Los días que el taller tiene por delante, ya descontados los
                // domingos y los feriados: es el número con el que se programa.
                const habiles =
                  orden.dias_habiles_restantes === null ||
                  orden.dias_habiles_restantes === undefined
                    ? null
                    : Number(orden.dias_habiles_restantes)

                return (
                  <TR key={orden.id}>
                    <TD className="whitespace-nowrap">
                      {/* Blanco de dedo —y de guante— en el teléfono; en el
                          monitor vuelve a ser una línea de texto y nada más. */}
                      <Link
                        href={`/ordenes/${orden.id}`}
                        className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
                      >
                        {orden.numero}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-texto-suave">
                        <Punto tono={prioridad.tono} />
                        {prioridad.etiqueta}
                      </p>
                    </TD>

                    <TD>
                      <p className="max-w-52 truncate text-texto">{orden.cliente}</p>
                      <p className="text-[11px] text-texto-suave">
                        {orden.placa ?? 'Sin unidad asignada'}
                        {/* El responsable no tiene columna propia en el
                            teléfono: viaja aquí, pegado a la unidad. */}
                        {orden.responsable && (
                          <span className="sm:hidden"> · {orden.responsable}</span>
                        )}
                      </p>
                    </TD>

                    <TD>
                      <p className="max-w-64 truncate">{orden.descripcion}</p>
                      <p className="text-[11px] text-texto-suave">
                        {definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta}
                        {orden.tipo_carroceria ? ` · ${orden.tipo_carroceria}` : ''}
                      </p>
                    </TD>

                    <TD>
                      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                    </TD>

                    <TD>
                      <Progreso valor={orden.avance_porcentaje} mostrarValor alto="sm" />
                      <p className="mt-1 text-[11px] text-texto-suave">
                        {orden.etapas_terminadas ?? 0} de {orden.etapas_total ?? 0} etapas
                        <span className="tabular sm:hidden">
                          {' · '}
                          {cantidad(orden.horas_reales)}/{cantidad(orden.horas_estimadas)} h
                        </span>
                      </p>
                    </TD>

                    <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                      <span className="text-texto">{cantidad(orden.horas_reales)}</span>
                      <span className="text-texto-tenue"> / {cantidad(orden.horas_estimadas)}</span>
                    </TD>

                    <TD className="whitespace-nowrap">
                      {fecha(orden.fecha_entrega_comprometida)}
                      {atraso > 0 ? (
                        <p className="text-[11px] font-medium text-peligro">
                          {atraso} {atraso === 1 ? 'día' : 'días'} de atraso
                        </p>
                      ) : (
                        habiles !== null && (
                          <p
                            className={`text-[11px] ${habiles <= 3 ? 'font-medium text-aviso' : 'text-texto-suave'}`}
                          >
                            {habiles === 0
                              ? 'se entrega hoy'
                              : `quedan ${habiles} ${habiles === 1 ? 'día' : 'días'} de taller`}
                          </p>
                        )
                      )}
                    </TD>

                    <TD className="hidden max-w-40 truncate text-texto-suave sm:table-cell">
                      {orden.responsable ?? '—'}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Paginacion
        ruta="/ordenes"
        pagina={pagina}
        paginas={paginas}
        total={total}
        porPagina={ORDENES_POR_PAGINA}
        params={params}
      />
    </>
  )
}
