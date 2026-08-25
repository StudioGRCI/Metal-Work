import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_ORDEN_COMPRA } from '@/lib/dominio/almacen'
import { definir } from '@/lib/dominio/estados'
import { diasHasta, fecha, moneda } from '@/lib/format'
import { listarOrdenesCompra } from '@/lib/datos/almacen-operativo'
import { exigirPermiso } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

import { SubNavegacionAlmacen } from '../sub-navegacion'

export const metadata = { title: 'Órdenes de compra' }

export default async function PaginaCompras({ searchParams }: PageProps<'/almacen/compras'>) {
  await exigirPermiso('compras.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const ordenes = await listarOrdenesCompra({ estado })

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de compra"
        descripcion="Compras a proveedores. Al recibirlas se genera el ingreso al almacén y se actualiza el costo promedio."
      />

      <SubNavegacionAlmacen activa="/almacen/compras" />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/almacen/compras"
          className={
            !estado
              ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
              : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
          }
        >
          Todas
        </Link>
        {Object.entries(ESTADO_ORDEN_COMPRA).map(([valor, def]) => (
          <Link
            key={valor}
            href={`/almacen/compras?estado=${valor}`}
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
              <TH>Proveedor</TH>
              <TH>Emisión</TH>
              <TH>Entrega esperada</TH>
              <TH>Estado</TH>
              <TH className="text-right">Líneas</TH>
              <TH className="text-right">Total</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {ordenes.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo="Sin órdenes de compra"
                descripcion="Las compras a proveedores aparecerán aquí con su estado de recepción."
              />
            ) : (
              ordenes.map((o) => {
                const est = definir(ESTADO_ORDEN_COMPRA, o.estado)
                const proveedor = o.proveedor as unknown as { razon_social: string }
                const lineas = (o.detalle as unknown as { count: number }[])?.[0]?.count ?? 0
                const dias = diasHasta(o.fecha_entrega_esperada)
                const atrasada =
                  dias !== null && dias < 0 && o.estado !== 'RECIBIDA' && o.estado !== 'ANULADA'

                return (
                  <TR key={o.id}>
                    <TD className="font-medium whitespace-nowrap">{o.numero}</TD>
                    <TD className="max-w-56 truncate">{proveedor.razon_social}</TD>
                    <TD className="whitespace-nowrap">{fecha(o.fecha)}</TD>
                    <TD className="whitespace-nowrap">
                      {fecha(o.fecha_entrega_esperada)}
                      {atrasada && (
                        <p className="text-[11px] text-peligro">
                          {Math.abs(dias)} {Math.abs(dias) === 1 ? 'día' : 'días'} de atraso
                        </p>
                      )}
                    </TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right">{lineas}</TD>
                    <TD className="tabular text-right font-medium whitespace-nowrap">
                      {moneda(o.total, (o.moneda ?? 'PEN') as CodigoMoneda)}
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
