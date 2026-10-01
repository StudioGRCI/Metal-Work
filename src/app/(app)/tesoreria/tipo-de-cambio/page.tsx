import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tabla, TablaCabecera, TD, TH, TR } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { fecha, hoyLima, numero, sumarDias } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { FormularioTipoDeCambio } from './formulario'

export const metadata = { title: 'Tipo de cambio' }

const FUENTE: Record<string, string> = { SUNAT: 'SUNAT', SBS: 'SBS', BANCO: 'Banco', OTRO: 'Otra' }

/**
 * El cambio del dólar día por día. Con él, el costo de cada OT suma en soles lo
 * que se compró en dólares, al cambio de la fecha de cada compra.
 */
export default async function PaginaTipoDeCambio() {
  await exigirPermiso('tesoreria.tipo_cambio')
  const hoy = hoyLima()
  const db = await createClient()
  const { data, error } = await db
    .from('tipos_de_cambio')
    .select('id, fecha, compra, venta, fuente, actualizado_en')
    .gte('fecha', sumarDias(hoy, -60))
    .order('fecha', { ascending: false })
  if (error) throw new Error(`No se pudo leer el tipo de cambio: ${error.message}`)
  const cambios = data ?? []
  const deHoy = cambios.find((c) => c.fecha === hoy)

  return (
    <>
      <EncabezadoPagina
        titulo="Tipo de cambio"
        descripcion="El cambio del dólar de cada día. El costo de cada OT pasa a soles lo comprado en dólares con el cambio de su fecha."
      />

      <Tarjeta className="mb-5">
        <TarjetaCabecera
          titulo={deHoy ? 'Cambio de hoy registrado' : 'Registrar el cambio de hoy'}
          descripcion={
            deHoy
              ? `Compra ${numero(deHoy.compra, 3)} · venta ${numero(deHoy.venta, 3)}. Si estaba mal, vuelve a guardarlo con la misma fecha y se corrige.`
              : 'Copia el cambio que publica la SUNAT. Si un día no lo tiene (fin de semana, feriado), vale el último de los diez días anteriores.'
          }
        />
        <TarjetaCuerpo>
          <FormularioTipoDeCambio hoy={hoy} />
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Últimos 60 días" />
        {cambios.length === 0 ? (
          <TarjetaCuerpo>
            <p className="text-sm text-texto-suave">Todavía no hay ningún cambio registrado. Registra el de hoy con el formulario de arriba.</p>
          </TarjetaCuerpo>
        ) : (
          <div className="overflow-x-auto">
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH>Fecha</TH>
                  <TH className="text-right">Compra</TH>
                  <TH className="text-right">Venta</TH>
                  <TH>Fuente</TH>
                </TR>
              </TablaCabecera>
              <tbody>
                {cambios.map((c) => (
                  <TR key={c.id}>
                    <TD className="tabular">{fecha(c.fecha)}</TD>
                    <TD className="tabular text-right">{numero(c.compra, 3)}</TD>
                    <TD className="tabular text-right">{numero(c.venta, 3)}</TD>
                    <TD className="text-texto-suave">{FUENTE[c.fuente] ?? c.fuente}</TD>
                  </TR>
                ))}
              </tbody>
            </Tabla>
          </div>
        )}
      </Tarjeta>
    </>
  )
}
