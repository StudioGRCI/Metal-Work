import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_COSTO, definir } from '@/lib/dominio/estados'
import { cantidad, fecha, moneda, numero, porcentaje } from '@/lib/format'
import type { CodigoMoneda } from '@/lib/format'
import type { costoDeOrden, materialesDeOrden } from '@/lib/datos/costos'

export function Costos({
  costo,
  materiales,
}: {
  costo: Awaited<ReturnType<typeof costoDeOrden>>
  materiales: Awaited<ReturnType<typeof materialesDeOrden>>
}) {
  if (!costo) {
    return (
      <Tarjeta>
        <TarjetaCuerpo>
          <p className="py-10 text-center text-sm text-texto-suave">
            Todavía no hay información de costos para esta orden.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }

  const mon = (costo.moneda ?? 'PEN') as CodigoMoneda
  const total = Number(costo.costo_total ?? 0)
  const desviacion = Number(costo.desviacion ?? 0)
  const margen = costo.margen_porcentaje === null ? null : Number(costo.margen_porcentaje)

  const componentes = [
    { tipo: 'MATERIAL', monto: Number(costo.costo_materiales ?? 0) },
    { tipo: 'MANO_OBRA', monto: Number(costo.costo_mano_obra ?? 0) },
    { tipo: 'SERVICIO', monto: Number(costo.costo_servicios ?? 0) },
    { tipo: 'INDIRECTO', monto: Number(costo.costo_indirecto ?? 0) },
    { tipo: 'OTRO', monto: Number(costo.costo_adicional ?? 0) },
  ].filter((c) => c.monto !== 0)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Tarjeta className="lg:col-span-2">
        <TarjetaCabecera
          titulo="Costo real contra presupuesto"
          descripcion={
            costo.fuente_presupuesto === 'DETALLE'
              ? 'El presupuesto proviene del detalle de partidas de la orden'
              : 'El presupuesto proviene del monto de la cabecera de la orden'
          }
        />
        {/* Dos por fila en el teléfono: cuatro cifras apiladas obligan a rodar
            la pantalla para comparar el costo con el presupuesto, que es
            justamente lo que se viene a hacer aquí. */}
        <TarjetaCuerpo className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Cifra titulo="Costo acumulado" valor={moneda(total, mon)} />
          <Cifra titulo="Presupuesto" valor={moneda(costo.presupuesto, mon)} />
          <Cifra
            titulo="Desviación"
            valor={`${desviacion > 0 ? '+' : ''}${moneda(desviacion, mon)}`}
            tono={desviacion > 0 ? 'peligro' : 'exito'}
            nota={desviacion > 0 ? 'Sobrecosto' : 'Dentro de presupuesto'}
          />
          <Cifra
            titulo="Margen"
            valor={margen === null ? '—' : porcentaje(margen, 1)}
            tono={margen === null ? 'neutro' : margen < 0 ? 'peligro' : 'exito'}
            nota={costo.valor_venta ? `Venta ${moneda(costo.valor_venta, mon)}` : 'Sin valor de venta'}
          />

          <div className="col-span-2 sm:col-span-4">
            <div className="mb-1 flex justify-between text-xs text-texto-suave">
              <span>Consumo del presupuesto</span>
              <span className="tabular">
                {costo.consumo_presupuesto_porcentaje === null
                  ? '—'
                  : porcentaje(costo.consumo_presupuesto_porcentaje, 1)}
              </span>
            </div>
            <Progreso valor={costo.consumo_presupuesto_porcentaje ?? 0} />
          </div>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Composición del costo" />
        <TarjetaCuerpo className="space-y-3">
          {componentes.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm font-medium text-texto">
                Aún no se ha imputado ningún costo a esta orden
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-texto-suave">
                El costo se arma solo: material que sale del almacén, horas de partes aprobados y
                servicios ejecutados. Aparecerá aquí en cuanto ocurra el primero.
              </p>
            </div>
          ) : (
            componentes.map((c) => {
              const def = definir(TIPO_COSTO, c.tipo)
              const parte = total > 0 ? (c.monto / total) * 100 : 0

              return (
                <div key={c.tipo}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                    <span className="tabular font-medium text-texto">{moneda(c.monto, mon)}</span>
                  </div>
                  <Progreso valor={parte} alto="sm" />
                </div>
              )
            })
          )}

          {Number(costo.servicios_comprometidos ?? 0) > 0 && (
            <p className="border-t border-borde pt-3 text-xs text-texto-suave">
              Además hay {moneda(costo.servicios_comprometidos, mon)} en servicios solicitados
              todavía no ejecutados, que aún no cuentan como costo.
            </p>
          )}
          {Number(costo.horas_sin_costo ?? 0) > 0 && (
            <p className="text-xs text-aviso">
              {cantidad(costo.horas_sin_costo)} horas registradas sin costo por hora definido: el
              costo de mano de obra está subvalorado.
            </p>
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Materiales consumidos"
          descripcion="Valorizados al costo promedio del almacén en el momento de la salida"
        />
        <TarjetaCuerpo className="p-0">
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-borde bg-superficie-2">
                <tr>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-texto-suave uppercase">
                    Material
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                    Cantidad
                  </th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold text-texto-suave uppercase">
                    Costo
                  </th>
                </tr>
              </thead>
              <tbody>
                {materiales.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-10 text-center">
                      <p className="text-sm font-medium text-texto">
                        No se ha entregado material a esta orden
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-texto-suave">
                        El material se carga aquí cuando el almacén registra la salida contra esta
                        orden, valorizada al costo promedio de ese momento.
                      </p>
                    </td>
                  </tr>
                ) : (
                  materiales.map((m) => {
                    const material = m.material as unknown as {
                      codigo: string
                      descripcion: string
                      unidad: { codigo: string }
                    }
                    const devolucion = m.tipo_movimiento === 'INGRESO_DEVOLUCION'

                    return (
                      <tr key={m.id} className="border-b border-borde last:border-0">
                        <td className="px-3 py-2">
                          <p className="max-w-56 truncate">{material.descripcion}</p>
                          <p className="text-[11px] text-texto-suave">
                            {material.codigo} · {fecha(m.fecha)}
                            {devolucion && ' · devolución'}
                          </p>
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {devolucion ? '−' : ''}
                          {cantidad(Math.abs(Number(m.cantidad ?? 0)))}
                          <span className="ml-1 text-[11px] text-texto-tenue">
                            {material.unidad.codigo}
                          </span>
                        </td>
                        <td
                          className={`tabular px-3 py-2 text-right ${devolucion ? 'text-exito' : ''}`}
                        >
                          {devolucion ? '−' : ''}
                          {numero(m.costo_total)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
  )
}

function Cifra({
  titulo,
  valor,
  nota,
  tono = 'neutro',
}: {
  titulo: string
  valor: string
  nota?: string
  tono?: 'neutro' | 'exito' | 'peligro'
}) {
  const color = { neutro: 'text-texto', exito: 'text-exito', peligro: 'text-peligro' }[tono]

  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
      <p className={`tabular mt-1 text-lg font-semibold ${color}`}>{valor}</p>
      {nota && <p className="mt-0.5 text-[11px] text-texto-tenue">{nota}</p>}
    </div>
  )
}
