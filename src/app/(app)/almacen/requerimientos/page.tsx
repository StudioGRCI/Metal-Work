import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
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

export default async function PaginaRequerimientos({
  searchParams,
}: PageProps<'/almacen/requerimientos'>) {
  const perfil = await exigirPermiso('requerimientos.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const requerimientos = await listarRequerimientos({ estado })

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Almacén', ruta: '/almacen' }, { titulo: 'Requerimientos' }]}
        titulo="Requerimientos de material"
        descripcion="Lo que el taller pide para cada orden. Al aprobarse se reserva el stock disponible."
        acciones={
          puede(perfil, 'requerimientos.crear') && (
            <Link
              href="/almacen/requerimientos/nuevo"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:bg-acento-fuerte"
            >
              <Plus aria-hidden className="size-4" />
              Nuevo requerimiento
            </Link>
          )
        }
      />

      <SubNavegacionAlmacen activa="/almacen/requerimientos" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/almacen/requerimientos"
          className={
            !estado
              ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
              : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
          }
        >
          Todos
        </Link>
        {Object.entries(ESTADO_REQUERIMIENTO).map(([valor, def]) => (
          <Link
            key={valor}
            href={`/almacen/requerimientos?estado=${valor}`}
            className={
              estado === valor
                ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
                : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
            }
          >
            {def.etiqueta}
          </Link>
        ))}
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Número</TH>
              <TH>Orden</TH>
              <TH>Solicita</TH>
              <TH>Fecha</TH>
              <TH>Requerido para</TH>
              <TH>Estado</TH>
              <TH className="text-right">Materiales</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {requerimientos.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo="Sin requerimientos"
                descripcion="El taller solicita material desde aquí para que almacén lo prepare."
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
                    </TD>
                    <TD>
                      {orden ? (
                        <Link href={`/ordenes/${orden.id}`} className="text-acento hover:underline">
                          {orden.numero}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="text-texto-suave">
                      {solicitante ? `${solicitante.nombres} ${solicitante.apellidos}` : '—'}
                    </TD>
                    <TD className="whitespace-nowrap">{fecha(r.fecha)}</TD>
                    <TD className="whitespace-nowrap">
                      {fecha(r.fecha_requerida)}
                      {urgente && <p className="text-[11px] text-peligro">vencido</p>}
                    </TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right">{lineas}</TD>
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
