import type { CajaDelPago } from '@/lib/datos/caja'
import type { TipoDeLaCaja } from '@/lib/dominio/caja'
import { fecha, moneda, type CodigoMoneda } from '@/lib/format'

/**
 * En la línea de un pago, un cobro o una devolución, la cuenta de la caja que
 * movió (migración 20261019100000). Va en la línea y no en el aviso del botón:
 * cuando el pago salda el documento, el botón desaparece con su aviso, y la
 * línea queda. Solo se pinta para quien lleva la caja (`cajas` llega
 * `undefined` si no): a otro puesto el RLS no le deja ver movimientos y diría
 * «no movió» sin saberlo.
 *
 * El cobro y la devolución del proveedor entran a la cuenta; el pago sale. Si la
 * cuenta es de otra moneda que el documento, dice también cuánto salió o entró
 * en ella: es la cifra que se busca en el estado de cuenta. Con `sola`, la frase
 * va en su propio lugar, sin el punto que la une a la anterior.
 */
export function CajaDeLaLinea({
  cajas,
  id,
  tipo,
  monedaDocumento,
  sola = false,
}: {
  cajas: Map<string, CajaDelPago> | undefined
  id: string
  tipo: TipoDeLaCaja
  monedaDocumento: CodigoMoneda
  sola?: boolean
}) {
  if (!cajas) return null
  const mov = cajas.get(id)
  const frase = (texto: string) => (sola ? texto.charAt(0).toUpperCase() + texto.slice(1) : ` · ${texto}`)
  if (!mov) return <>{frase('no movió la caja')}</>
  const entra = tipo !== 'pago'
  const enLaCuenta = mov.moneda !== monedaDocumento ? `: ${moneda(mov.monto, mov.moneda)}` : ''
  if (mov.anulado) return <>{frase(`${entra ? 'su ingreso' : 'su egreso'} en ${mov.cuenta}${enLaCuenta}, anulado`)}</>
  // Anulado con su día ya cerrado: el movimiento se queda en ese día y el extorno entra o sale el día de la anulación.
  if (mov.extornado) {
    const anularlo = tipo === 'devolucion' ? 'al anularla' : 'al anularlo'
    return (
      <>
        {frase(
          entra
            ? `entró a ${mov.cuenta}${enLaCuenta} y volvió a salir el ${fecha(mov.extornado)}, ${anularlo}`
            : `salió de ${mov.cuenta}${enLaCuenta} y volvió el ${fecha(mov.extornado)}, ${anularlo}`,
        )}
      </>
    )
  }
  return <>{frase(`${entra ? 'entró a' : 'salió de'} ${mov.cuenta}${enLaCuenta}`)}</>
}
