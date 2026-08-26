import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
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

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de trabajo"
        descripcion={
          total === 0
            ? 'Ninguna orden registrada todavía'
            : `${total.toLocaleString('es-PE')} ${total === 1 ? 'orden' : 'órdenes'}${hayFiltros ? ' con los filtros aplicados' : ''}`
        }
        acciones={
          puede(perfil, 'ordenes.crear') && (
            <Link
              href="/ordenes/nueva"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:bg-acento-fuerte"
            >
              <Plus aria-hidden className="size-4" />
              Nueva orden
            </Link>
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
              <TH className="text-right">Horas</TH>
              <TH>Entrega</TH>
              <TH>Responsable</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {ordenes.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={hayFiltros ? 'Sin resultados' : 'Aún no hay órdenes de trabajo'}
                descripcion={
                  hayFiltros
                    ? 'Prueba con otros filtros o limpia la búsqueda.'
                    : 'Registra la primera orden para empezar a controlar la producción.'
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
                      <Link
                        href={`/ordenes/${orden.id}`}
                        className="font-medium text-acento hover:underline"
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
                      </p>
                    </TD>

                    <TD className="tabular text-right whitespace-nowrap">
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

                    <TD className="max-w-40 truncate text-texto-suave">
                      {orden.responsable ?? '—'}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      {paginas > 1 && (
        <Paginacion pagina={pagina} paginas={paginas} total={total} params={params} />
      )}
    </>
  )
}

function Paginacion({
  pagina,
  paginas,
  total,
  params,
}: {
  pagina: number
  paginas: number
  total: number
  params: Record<string, string | string[] | undefined>
}) {
  const enlace = (destino: number) => {
    const query = new URLSearchParams()
    for (const [clave, valor] of Object.entries(params)) {
      if (clave !== 'pagina' && typeof valor === 'string' && valor) query.set(clave, valor)
    }
    query.set('pagina', String(destino))
    return `/ordenes?${query}`
  }

  const desde = (pagina - 1) * ORDENES_POR_PAGINA + 1
  const hasta = Math.min(pagina * ORDENES_POR_PAGINA, total)

  return (
    <nav className="mt-4 flex items-center justify-between gap-4" aria-label="Paginación">
      <p className="text-xs text-texto-suave">
        Mostrando {desde}–{hasta} de {total}
      </p>
      <div className="flex gap-2">
        {pagina > 1 && (
          <Link
            href={enlace(pagina - 1)}
            className="rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs hover:bg-superficie-2"
          >
            Anterior
          </Link>
        )}
        {pagina < paginas && (
          <Link
            href={enlace(pagina + 1)}
            className="rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs hover:bg-superficie-2"
          >
            Siguiente
          </Link>
        )}
      </div>
    </nav>
  )
}
