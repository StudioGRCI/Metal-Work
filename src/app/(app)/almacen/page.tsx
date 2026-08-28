import { AlertTriangle } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador } from '@/components/ui/indicador'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cantidad, moneda, numero } from '@/lib/format'
import { listarStock, resumenAlmacen } from '@/lib/datos/almacen'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from './sub-navegacion'

import { BuscadorStock } from './buscador-stock'

export const metadata = { title: 'Almacén' }

export default async function PaginaAlmacen({ searchParams }: PageProps<'/almacen'>) {
  const perfil = await exigirPermiso('almacen.ver')
  const params = await searchParams

  const filtros = {
    busqueda: typeof params.q === 'string' ? params.q : undefined,
    bajoMinimo: params.bajo === '1',
  }

  const [stock, resumen] = await Promise.all([listarStock(filtros), resumenAlmacen()])

  // Con filtro puesto, «no hay nada» quiere decir otra cosa: hay almacén, pero
  // no con lo que se pidió. Quien busca necesita saber cuál de las dos es.
  const filtrando = Boolean(filtros.busqueda) || filtros.bajoMinimo
  const puedeMover = puede(perfil, 'almacen.movimientos')

  return (
    <>
      <EncabezadoPagina
        titulo="Almacén"
        descripcion="Existencias valorizadas al costo promedio ponderado."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Indicador
          titulo="Materiales con existencia"
          valor={resumen.materiales}
          pie="con saldo en algún almacén"
        />
        <Indicador
          titulo="Valorización total"
          /* La moneda es la cifra más larga de las tres y en el teléfono comparte
             fila: se queda un punto por debajo del resto para que no se corte. En
             `sm:` mide igual que las demás, como siempre. */
          valor={<span className="text-xl sm:text-lg">{moneda(resumen.valorizado)}</span>}
        />
        <Indicador
          titulo="Bajo stock mínimo"
          valor={resumen.bajoMinimo}
          tono={resumen.bajoMinimo > 0 ? 'peligro' : 'exito'}
          /* Sin nada bajo mínimo el enlace llevaría a una lista vacía: mejor que
             no lleve a ninguna parte. */
          href={resumen.bajoMinimo > 0 ? '/almacen?bajo=1' : undefined}
          pie={resumen.bajoMinimo > 0 ? 'Ver solo estos' : 'Nada por reponer'}
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <SubNavegacionAlmacen activa="/almacen" />

      <BuscadorStock />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH className="hidden sm:table-cell">Código</TH>
              <TH>Material</TH>
              <TH className="hidden sm:table-cell">Almacén</TH>
              <TH className="text-right">Stock</TH>
              <TH className="hidden text-right sm:table-cell">Reservado</TH>
              <TH className="text-right">Disponible</TH>
              <TH className="hidden text-right sm:table-cell">Costo prom.</TH>
              <TH className="hidden text-right sm:table-cell">Valorizado</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {stock.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={filtrando ? 'Ningún material con ese filtro' : 'Almacén vacío'}
                descripcion={
                  filtrando
                    ? 'Prueba con otro término o quita el filtro para ver todo lo que hay.'
                    : 'Registra un ingreso para cargar las existencias; el costo promedio lo calcula el sistema.'
                }
                accion={
                  filtrando ? (
                    <EnlaceBoton href="/almacen" variante="secundario" tamano="sm">
                      Ver todo el almacén
                    </EnlaceBoton>
                  ) : puedeMover ? (
                    <EnlaceBoton href="/almacen/movimientos/nuevo?tipo=INGRESO" tamano="sm">
                      Registrar un ingreso
                    </EnlaceBoton>
                  ) : undefined
                }
              />
            ) : (
              stock.map((f) => (
                <TR key={f.stock_id}>
                  <TD className="hidden font-mono text-xs whitespace-nowrap sm:table-cell">
                    {f.material_codigo}
                  </TD>
                  <TD>
                    <p className="max-w-72 truncate">{f.material_descripcion}</p>
                    <p className="text-[11px] text-texto-suave">
                      {f.categoria}
                      {f.especificacion_tecnica ? ` · ${f.especificacion_tecnica}` : ''}
                    </p>
                    {/* En el teléfono el código y el almacén pierden su columna:
                        bajan acá en letra chica para no perderlos del todo. */}
                    <p className="font-mono text-[11px] text-texto-tenue sm:hidden">
                      {f.material_codigo} · {f.almacen_nombre}
                    </p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-texto-suave sm:table-cell">
                    {f.almacen_nombre}
                  </TD>
                  <TD className="tabular text-right">
                    {cantidad(f.cantidad)}
                    <span className="ml-1 text-[11px] text-texto-tenue">{f.unidad_medida}</span>
                  </TD>
                  <TD className="tabular hidden text-right text-texto-suave sm:table-cell">
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
                  <TD className="tabular hidden text-right text-texto-suave sm:table-cell">
                    {numero(f.costo_promedio)}
                  </TD>
                  <TD className="tabular hidden text-right sm:table-cell">{numero(f.valorizado)}</TD>
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
