import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_MOVIMIENTO, TIPO_MOVIMIENTO } from '@/lib/dominio/almacen'
import { definir } from '@/lib/dominio/estados'
import { fecha, moneda } from '@/lib/format'
import { listarMovimientos } from '@/lib/datos/almacen-operativo'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'

export const metadata = { title: 'Movimientos de almacén' }

export default async function PaginaMovimientos({
  searchParams,
}: PageProps<'/almacen/movimientos'>) {
  const perfil = await exigirPermiso('almacen.ver')
  const params = await searchParams

  const tipo = typeof params.tipo === 'string' ? params.tipo : undefined
  const estado = typeof params.estado === 'string' ? params.estado : undefined
  const movimientos = await listarMovimientos({ tipo, estado })

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Almacén', ruta: '/almacen' }, { titulo: 'Movimientos' }]}
        titulo="Movimientos de almacén"
        descripcion="Ingresos, vales de consumo, devoluciones, transferencias y ajustes. Al confirmarse afectan el kardex y ya no se pueden modificar."
        acciones={
          puede(perfil, 'almacen.movimientos') && (
            <Link
              href="/almacen/movimientos/nuevo"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:bg-acento-fuerte"
            >
              <Plus aria-hidden className="size-4" />
              Nuevo movimiento
            </Link>
          )
        }
      />

      <SubNavegacionAlmacen activa="/almacen/movimientos" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/almacen/movimientos"
          className={
            !tipo && !estado
              ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
              : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
          }
        >
          Todos
        </Link>
        <Link
          href="/almacen/movimientos?estado=BORRADOR"
          className={
            estado === 'BORRADOR'
              ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
              : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
          }
        >
          Sin confirmar
        </Link>
        {Object.entries(TIPO_MOVIMIENTO).map(([valor, def]) => (
          <Link
            key={valor}
            href={`/almacen/movimientos?tipo=${valor}`}
            className={
              tipo === valor
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
              <TH>Documento</TH>
              <TH>Tipo</TH>
              <TH>Fecha</TH>
              <TH>Almacén</TH>
              <TH>Orden</TH>
              <TH>Referencia</TH>
              <TH>Estado</TH>
              <TH className="text-right">Líneas</TH>
              <TH className="text-right">Valorizado</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {movimientos.length === 0 ? (
              <SinDatos
                colSpan={9}
                titulo="Sin movimientos"
                descripcion="Registra un ingreso para cargar existencias, o un vale de consumo para entregar material a una orden."
              />
            ) : (
              movimientos.map((m) => {
                const t = definir(TIPO_MOVIMIENTO, m.tipo)
                const e = definir(ESTADO_MOVIMIENTO, m.estado)
                const almacen = m.almacen as unknown as { nombre: string }
                const orden = m.orden as unknown as { id: string; numero: string } | null
                const lineas = (m.detalle as unknown as { count: number }[])?.[0]?.count ?? 0

                return (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/almacen/movimientos/${m.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {m.numero}
                      </Link>
                    </TD>
                    <TD>
                      <Insignia tono={t.tono}>{t.etiqueta}</Insignia>
                    </TD>
                    <TD className="whitespace-nowrap">{fecha(m.fecha)}</TD>
                    <TD className="text-texto-suave">{almacen.nombre}</TD>
                    <TD>
                      {orden ? (
                        <Link href={`/ordenes/${orden.id}`} className="text-acento hover:underline">
                          {orden.numero}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="max-w-40 truncate text-texto-suave">
                      {m.documento_referencia ?? m.motivo ?? '—'}
                    </TD>
                    <TD>
                      <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right">{lineas}</TD>
                    <TD className="tabular text-right whitespace-nowrap">
                      {m.estado === 'CONFIRMADO' ? moneda(m.total_valorizado) : '—'}
                    </TD>
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
