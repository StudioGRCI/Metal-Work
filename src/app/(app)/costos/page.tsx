import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { moneda, numero, porcentaje } from '@/lib/format'
import { listarMargenes } from '@/lib/datos/costos'
import { exigirPermiso } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

export const metadata = { title: 'Costos' }

export default async function PaginaCostos({ searchParams }: PageProps<'/costos'>) {
  await exigirPermiso('costos.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : 'ABIERTAS'

  const filas = await listarMargenes({ estado })

  const totales = filas.reduce(
    (acc, f) => ({
      costo: acc.costo + Number(f.costo_total ?? 0),
      presupuesto: acc.presupuesto + Number(f.presupuesto ?? 0),
      venta: acc.venta + Number(f.valor_venta ?? 0),
      utilidad: acc.utilidad + Number(f.utilidad ?? 0),
    }),
    { costo: 0, presupuesto: 0, venta: 0, utilidad: 0 },
  )

  return (
    <>
      <EncabezadoPagina
        titulo="Costos por orden de trabajo"
        descripcion="Costo real acumulado contra lo presupuestado, y margen de cada orden."
      />

      <div className="mb-4 flex gap-2">
        {[
          { valor: 'ABIERTAS', titulo: 'En taller' },
          { valor: 'TERMINADA', titulo: 'Terminadas' },
          { valor: 'ENTREGADA', titulo: 'Entregadas' },
          { valor: '', titulo: 'Todas' },
        ].map((o) => (
          <Link
            key={o.valor || 'todas'}
            href={o.valor ? `/costos?estado=${o.valor}` : '/costos'}
            className={
              estado === o.valor
                ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
                : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
            }
          >
            {o.titulo}
          </Link>
        ))}
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Resumen titulo="Costo acumulado" valor={moneda(totales.costo)} />
        <Resumen titulo="Presupuestado" valor={moneda(totales.presupuesto)} />
        <Resumen titulo="Valor de venta" valor={moneda(totales.venta)} />
        <Resumen
          titulo="Utilidad"
          valor={moneda(totales.utilidad)}
          tono={totales.utilidad < 0 ? 'peligro' : 'exito'}
        />
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH>Cliente</TH>
              <TH>Estado</TH>
              <TH className="text-right">Materiales</TH>
              <TH className="text-right">Mano de obra</TH>
              <TH className="text-right">Servicios</TH>
              <TH className="text-right">Indirectos</TH>
              <TH className="text-right">Costo total</TH>
              <TH className="text-right">Presupuesto</TH>
              <TH className="text-right">Desviación</TH>
              <TH className="text-right">Margen</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {filas.length === 0 ? (
              <SinDatos
                colSpan={11}
                titulo="Sin órdenes que costear"
                descripcion="Aquí aparecerán las órdenes con sus costos reales conforme se consuma material y se registren horas."
              />
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
                    </TD>
                    <TD className="max-w-48 truncate">{f.cliente}</TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right">{numero(f.costo_materiales)}</TD>
                    <TD className="tabular text-right">{numero(f.costo_mano_obra)}</TD>
                    <TD className="tabular text-right">{numero(f.costo_servicios)}</TD>
                    <TD className="tabular text-right">{numero(f.costo_indirecto)}</TD>
                    <TD className="tabular text-right font-medium">{moneda(f.costo_total, mon)}</TD>
                    <TD className="tabular text-right text-texto-suave">
                      {moneda(f.presupuesto, mon)}
                    </TD>
                    <TD
                      className={`tabular text-right ${desviacion > 0 ? 'text-peligro' : 'text-exito'}`}
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

function Resumen({
  titulo,
  valor,
  tono = 'neutro',
}: {
  titulo: string
  valor: string
  tono?: 'neutro' | 'exito' | 'peligro'
}) {
  const color = { neutro: 'text-texto', exito: 'text-exito', peligro: 'text-peligro' }[tono]

  return (
    <Tarjeta>
      <TarjetaCuerpo>
        <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
        <p className={`tabular mt-1 text-lg font-semibold ${color}`}>{valor}</p>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
