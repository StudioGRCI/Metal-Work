import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro, type OpcionFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_REQUERIMIENTO } from '@/lib/dominio/almacen'
import { PRIORIDAD, definir } from '@/lib/dominio/estados'
import { diasHasta, fecha } from '@/lib/format'
import { listarRequerimientos } from '@/lib/datos/almacen-operativo'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'

export const metadata = { title: 'Requerimientos de material' }

const FILTROS: OpcionFiltro[] = [
  { valor: null, etiqueta: 'Todos' },
  ...Object.entries(ESTADO_REQUERIMIENTO).map(([valor, def]) => ({ valor, etiqueta: def.etiqueta })),
]

export default async function PaginaRequerimientos({
  searchParams,
}: PageProps<'/almacen/requerimientos'>) {
  const perfil = await exigirPermiso('requerimientos.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const requerimientos = await listarRequerimientos({ estado })
  const puedeCrear = puede(perfil, 'requerimientos.crear')

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Almacén', ruta: '/almacen' }, { titulo: 'Requerimientos' }]}
        titulo="Requerimientos de material"
        descripcion="Lo que el taller pide para cada orden. Al aprobarse se reserva el stock disponible."
        acciones={
          puedeCrear && (
            <EnlaceBoton href="/almacen/requerimientos/nuevo">
              <Plus aria-hidden className="size-4" />
              Nuevo requerimiento
            </EnlaceBoton>
          )
        }
      />

      <SubNavegacionAlmacen activa="/almacen/requerimientos" />

      <PastillaFiltro
        ruta="/almacen/requerimientos"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado ?? null}
        etiqueta="Filtrar por estado"
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Número</TH>
              <TH className="hidden sm:table-cell">Orden</TH>
              <TH className="hidden sm:table-cell">Solicita</TH>
              <TH className="hidden sm:table-cell">Fecha</TH>
              <TH>Requerido para</TH>
              <TH>Estado</TH>
              <TH className="hidden text-right sm:table-cell">Materiales</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {requerimientos.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo={estado ? 'Ningún requerimiento en ese estado' : 'Sin requerimientos'}
                descripcion={
                  estado
                    ? 'Quita el filtro para ver todos los pedidos del taller.'
                    : 'El taller solicita material desde aquí para que almacén lo prepare.'
                }
                accion={
                  estado ? (
                    <EnlaceBoton href="/almacen/requerimientos" variante="secundario" tamano="sm">
                      Ver todos los requerimientos
                    </EnlaceBoton>
                  ) : puedeCrear ? (
                    <EnlaceBoton href="/almacen/requerimientos/nuevo" tamano="sm">
                      <Plus aria-hidden className="size-3.5" />
                      Nuevo requerimiento
                    </EnlaceBoton>
                  ) : undefined
                }
              />
            ) : (
              requerimientos.map((r) => {
                const est = definir(ESTADO_REQUERIMIENTO, r.estado)
                const prioridad = definir(PRIORIDAD, r.prioridad)
                const orden = r.orden as unknown as { id: string; numero: string; descripcion: string } | null
                const solicitante = r.solicitante as unknown as { nombres: string; apellidos: string } | null
                const lineas = (r.detalle as unknown as { count: number }[])?.[0]?.count ?? 0
                const dias = diasHasta(r.fecha_requerida)
                const urgente = dias !== null && dias < 0 && r.estado === 'SOLICITADO'

                return (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/almacen/requerimientos/${r.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {r.numero}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-texto-suave">
                        <Punto tono={prioridad.tono} />
                        {prioridad.etiqueta}
                      </p>
                      {/* En el teléfono la orden y quién pidió no tienen columna:
                          bajan acá, que es lo que distingue un pedido de otro
                          cuando el número todavía no dice nada. */}
                      <p className="text-[11px] whitespace-normal text-texto-suave sm:hidden">
                        {orden ? orden.numero : 'Sin orden'}
                        {solicitante ? ` · ${solicitante.nombres} ${solicitante.apellidos}` : ''}
                      </p>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      {orden ? (
                        <Link href={`/ordenes/${orden.id}`} className="text-acento hover:underline">
                          {orden.numero}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">
                      {solicitante ? `${solicitante.nombres} ${solicitante.apellidos}` : '—'}
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{fecha(r.fecha)}</TD>
                    <TD className="whitespace-nowrap">
                      {fecha(r.fecha_requerida)}
                      {urgente && <p className="text-[11px] text-peligro">vencido</p>}
                    </TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">{lineas}</TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
