import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro, type OpcionFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador } from '@/components/ui/indicador'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { moneda, numero, porcentaje } from '@/lib/format'
import { listarMargenes } from '@/lib/datos/costos'
import { exigirPermiso } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

export const metadata = { title: 'Costos' }

/**
 * «Todas» viaja con valor propio y no como URL pelada: sin parámetro la
 * pantalla vuelve a su filtro por defecto —«En taller»—, así que la pastilla
 * de todas parecía no hacer nada y encima dejaba marcada la vecina.
 */
const TODAS = 'TODAS'

const FILTROS: OpcionFiltro[] = [
  { valor: 'ABIERTAS', etiqueta: 'En taller' },
  { valor: 'TERMINADA', etiqueta: 'Terminadas' },
  { valor: 'ENTREGADA', etiqueta: 'Entregadas' },
  { valor: TODAS, etiqueta: 'Todas' },
]

/** El vacío se dice en singular; la pastilla, en plural. No es la misma frase. */
const SIN_FILAS: Record<string, string> = {
  ABIERTAS: 'Ninguna orden en taller',
  TERMINADA: 'Ninguna orden terminada',
  ENTREGADA: 'Ninguna orden entregada',
}

export default async function PaginaCostos({ searchParams }: PageProps<'/costos'>) {
  await exigirPermiso('costos.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : 'ABIERTAS'

  const filas = await listarMargenes({ estado: estado === TODAS ? undefined : estado })

  const totales = filas.reduce(
    (acc, f) => ({
      costo: acc.costo + Number(f.costo_total ?? 0),
      presupuesto: acc.presupuesto + Number(f.presupuesto ?? 0),
      venta: acc.venta + Number(f.valor_venta ?? 0),
      utilidad: acc.utilidad + Number(f.utilidad ?? 0),
    }),
    { costo: 0, presupuesto: 0, venta: 0, utilidad: 0 },
  )

  const desviacionTotal = totales.costo - totales.presupuesto
  const margenTotal = totales.venta > 0 ? (100 * totales.utilidad) / totales.venta : null
  // La URL la puede escribir cualquiera: si el estado no es uno de los del
  // grupo, el vacío se cuenta en genérico en vez de quedar cojo.
  const tituloVacio = SIN_FILAS[estado] ?? 'Ninguna orden con este filtro'

  return (
    <>
      <EncabezadoPagina
        titulo="Costos por orden de trabajo"
        descripcion="Costo real acumulado contra lo presupuestado, y margen de cada orden."
      />

      <PastillaFiltro
        className="mb-4"
        ruta="/costos"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado}
        etiqueta="Filtrar por estado de la orden"
      />

      {/* Dos columnas en el teléfono: apilados, los cuatro totales tapaban la
          tabla, que es a lo que se entra. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Indicador
          titulo="Costo acumulado"
          valor={moneda(totales.costo)}
          pie={`${filas.length} ${filas.length === 1 ? 'orden' : 'órdenes'} en la lista`}
        />
        <Indicador
          titulo="Presupuestado"
          valor={moneda(totales.presupuesto)}
          pie={
            totales.presupuesto === 0
              ? 'sin presupuesto cargado'
              : desviacionTotal > 0
                ? `${moneda(desviacionTotal)} de sobrecosto`
                : `${moneda(-desviacionTotal)} de holgura`
          }
        />
        <Indicador titulo="Valor de venta" valor={moneda(totales.venta)} />
        <Indicador
          titulo="Utilidad"
          valor={moneda(totales.utilidad)}
          tono={totales.utilidad < 0 ? 'peligro' : 'exito'}
          pie={margenTotal === null ? 'sin venta valorizada' : `${porcentaje(margenTotal, 1)} de margen`}
        />
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              {/* En el teléfono estas columnas bajan a la celda de la orden o se
                  callan: once columnas obligaban a arrastrar la tabla de lado
                  para llegar a lo único que se mira de pie, el costo y el
                  margen. En el monitor la tabla es la de siempre. */}
              <TH className="hidden sm:table-cell">Cliente</TH>
              <TH className="hidden sm:table-cell">Estado</TH>
              <TH className="hidden text-right sm:table-cell">Materiales</TH>
              <TH className="hidden text-right sm:table-cell">Mano de obra</TH>
              <TH className="hidden text-right sm:table-cell">Servicios</TH>
              <TH className="hidden text-right sm:table-cell">Indirectos</TH>
              <TH className="text-right">Costo total</TH>
              <TH className="hidden text-right sm:table-cell">Presupuesto</TH>
              <TH className="hidden text-right sm:table-cell">Desviación</TH>
              <TH className="text-right">Margen</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {filas.length === 0 ? (
              estado === TODAS ? (
                <SinDatos
                  colSpan={11}
                  titulo="Sin órdenes que costear"
                  descripcion="Aquí aparecerán las órdenes con sus costos reales conforme se consuma material y se registren horas."
                />
              ) : (
                // Con filtro puesto no es lo mismo «no hay nada» que «no hay
                // nada de esto»: el que busca necesita saber cuál de las dos es.
                <SinDatos
                  colSpan={11}
                  titulo={tituloVacio}
                  descripcion="Hay costos registrados en otros estados. Mira la lista completa."
                  accion={
                    <EnlaceBoton href={`/costos?estado=${TODAS}`} variante="secundario" tamano="sm">
                      Ver todas las órdenes
                    </EnlaceBoton>
                  }
                />
              )
            ) : (
              filas.map((f) => {
                const est = definir(ESTADO_OT, f.estado)
                const desviacion = Number(f.desviacion ?? 0)
                const margen = f.margen_porcentaje === null ? null : Number(f.margen_porcentaje)
                const mon = (f.moneda ?? 'PEN') as CodigoMoneda

                return (
                  <TR key={f.orden_id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/ordenes/${f.orden_id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {f.numero}
                      </Link>
                      <span className="mt-0.5 block max-w-40 truncate text-xs text-texto-suave sm:hidden">
                        {f.cliente}
                      </span>
                      <span className="mt-1 flex items-center gap-2 sm:hidden">
                        <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                        <span
                          className={`tabular text-xs ${desviacion > 0 ? 'text-peligro' : 'text-exito'}`}
                        >
                          {desviacion > 0 ? '+' : ''}
                          {numero(desviacion)}
                        </span>
                      </span>
                    </TD>
                    <TD className="hidden max-w-48 truncate sm:table-cell">{f.cliente}</TD>
                    <TD className="hidden sm:table-cell">
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">
                      {numero(f.costo_materiales)}
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">
                      {numero(f.costo_mano_obra)}
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">
                      {numero(f.costo_servicios)}
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">
                      {numero(f.costo_indirecto)}
                    </TD>
                    <TD className="tabular text-right font-medium">{moneda(f.costo_total, mon)}</TD>
                    <TD className="tabular hidden text-right text-texto-suave sm:table-cell">
                      {moneda(f.presupuesto, mon)}
                    </TD>
                    <TD
                      className={`tabular hidden text-right sm:table-cell ${desviacion > 0 ? 'text-peligro' : 'text-exito'}`}
                    >
                      {desviacion > 0 ? '+' : ''}
                      {numero(desviacion)}
                    </TD>
                    <TD
                      className={`tabular text-right ${
                        margen === null ? 'text-texto-tenue' : margen < 0 ? 'text-peligro' : 'text-exito'
                      }`}
                    >
                      {margen === null ? '—' : porcentaje(margen, 1)}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-suave">
        La desviación positiva es sobrecosto. Las horas solo se valorizan cuando el parte diario
        está aprobado, y los servicios de terceros cuentan al ejecutarse.
      </p>
    </>
  )
}
