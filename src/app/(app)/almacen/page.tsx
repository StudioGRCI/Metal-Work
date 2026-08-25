import { AlertTriangle } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad, moneda, numero } from '@/lib/format'
import { listarStock, resumenAlmacen } from '@/lib/datos/almacen'
import { exigirPermiso } from '@/lib/sesion'

import { BuscadorStock } from './buscador-stock'

export const metadata = { title: 'Almacén' }

export default async function PaginaAlmacen({ searchParams }: PageProps<'/almacen'>) {
  await exigirPermiso('almacen.ver')
  const params = await searchParams

  const filtros = {
    busqueda: typeof params.q === 'string' ? params.q : undefined,
    bajoMinimo: params.bajo === '1',
  }

  const [stock, resumen] = await Promise.all([listarStock(filtros), resumenAlmacen()])

  return (
    <>
      <EncabezadoPagina
        titulo="Almacén"
        descripcion="Existencias valorizadas al costo promedio ponderado."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">
              Materiales con existencia
            </p>
            <p className="tabular mt-1 text-lg font-semibold text-texto">{resumen.materiales}</p>
          </TarjetaCuerpo>
        </Tarjeta>
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">
              Valorización total
            </p>
            <p className="tabular mt-1 text-lg font-semibold text-texto">
              {moneda(resumen.valorizado)}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">
              Bajo stock mínimo
            </p>
            <p
              className={`tabular mt-1 text-lg font-semibold ${
                resumen.bajoMinimo > 0 ? 'text-peligro' : 'text-exito'
              }`}
            >
              {resumen.bajoMinimo}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      </div>

      <BuscadorStock />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Código</TH>
              <TH>Material</TH>
              <TH>Almacén</TH>
              <TH className="text-right">Stock</TH>
              <TH className="text-right">Reservado</TH>
              <TH className="text-right">Disponible</TH>
              <TH className="text-right">Costo prom.</TH>
              <TH className="text-right">Valorizado</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {stock.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={filtros.busqueda || filtros.bajoMinimo ? 'Sin resultados' : 'Almacén vacío'}
                descripcion={
                  filtros.busqueda || filtros.bajoMinimo
                    ? 'Prueba con otro término o quita el filtro.'
                    : 'Registra los ingresos de material para que aparezcan las existencias.'
                }
              />
            ) : (
              stock.map((f) => (
                <TR key={f.stock_id}>
                  <TD className="font-mono text-xs whitespace-nowrap">{f.material_codigo}</TD>
                  <TD>
                    <p className="max-w-72 truncate">{f.material_descripcion}</p>
                    <p className="text-[11px] text-texto-suave">
                      {f.categoria}
                      {f.especificacion_tecnica ? ` · ${f.especificacion_tecnica}` : ''}
                    </p>
                  </TD>
                  <TD className="whitespace-nowrap text-texto-suave">{f.almacen_nombre}</TD>
                  <TD className="tabular text-right">
                    {cantidad(f.cantidad)}
                    <span className="ml-1 text-[11px] text-texto-tenue">{f.unidad_medida}</span>
                  </TD>
                  <TD className="tabular text-right text-texto-suave">
                    {cantidad(f.cantidad_reservada)}
                  </TD>
                  <TD className="tabular text-right font-medium">
                    {cantidad(f.cantidad_disponible)}
                    {f.bajo_minimo && (
                      <Insignia tono="peligro" className="ml-2">
                        <AlertTriangle aria-hidden className="size-3" />
                        bajo mínimo
                      </Insignia>
                    )}
                  </TD>
                  <TD className="tabular text-right text-texto-suave">{numero(f.costo_promedio)}</TD>
                  <TD className="tabular text-right">{numero(f.valorizado)}</TD>
                </TR>
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-suave">
        El disponible descuenta lo reservado por requerimientos aprobados que aún no se han
        atendido.
      </p>
    </>
  )
}
