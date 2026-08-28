import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro, type OpcionFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
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

const FILTROS: OpcionFiltro[] = [
  { valor: null, etiqueta: 'Todas' },
  ...Object.entries(ESTADO_ORDEN_COMPRA).map(([valor, def]) => ({ valor, etiqueta: def.etiqueta })),
]

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

      <PastillaFiltro
        ruta="/almacen/compras"
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
              <TH className="hidden sm:table-cell">Proveedor</TH>
              <TH className="hidden sm:table-cell">Emisión</TH>
              <TH>Entrega esperada</TH>
              <TH>Estado</TH>
              <TH className="hidden text-right sm:table-cell">Líneas</TH>
              <TH className="hidden text-right sm:table-cell">Total</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {ordenes.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo={estado ? 'Ninguna orden en ese estado' : 'Sin órdenes de compra'}
                descripcion={
                  estado
                    ? 'Quita el filtro para ver todas las compras, incluidas las ya recibidas.'
                    : 'Las compras a proveedores aparecerán aquí con su estado de recepción.'
                }
                accion={
                  estado ? (
                    <EnlaceBoton href="/almacen/compras" variante="secundario" tamano="sm">
                      Ver todas las órdenes
                    </EnlaceBoton>
                  ) : (
                    <EnlaceBoton href="/almacen/proveedores" variante="secundario" tamano="sm">
                      Ver proveedores
                    </EnlaceBoton>
                  )
                }
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
                    <TD className="font-medium whitespace-nowrap">
                      {o.numero}
                      {/* En el teléfono el proveedor, la fecha de emisión y el
                          total pierden su columna: bajan acá en letra chica,
                          porque un número de orden solo no le dice nada a nadie. */}
                      <p className="mt-0.5 text-[11px] font-normal whitespace-normal text-texto-suave sm:hidden">
                        {proveedor.razon_social}
                      </p>
                      <p className="tabular text-[11px] font-normal whitespace-normal text-texto-tenue sm:hidden">
                        {fecha(o.fecha)} · {moneda(o.total, (o.moneda ?? 'PEN') as CodigoMoneda)}
                      </p>
                    </TD>
                    <TD className="hidden max-w-56 truncate sm:table-cell">
                      {proveedor.razon_social}
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{fecha(o.fecha)}</TD>
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
                    <TD className="tabular hidden text-right sm:table-cell">{lineas}</TD>
                    <TD className="tabular hidden text-right font-medium whitespace-nowrap sm:table-cell">
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
