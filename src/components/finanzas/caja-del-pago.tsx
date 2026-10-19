import type { CajaDelPago } from '@/lib/datos/caja'

/**
 * En la línea de un pago o un cobro, la cuenta de la caja que movió (migración
 * 20261019100000). Va en la línea y no en el aviso del botón: cuando el pago
 * salda el documento, el botón desaparece con su aviso, y la línea queda.
 * Solo se pinta para quien lleva la caja (`cajas` llega `undefined` si no):
 * a otro puesto el RLS no le deja ver movimientos y diría «no movió» sin saberlo.
 */
export function CajaDeLaLinea({
  cajas,
  id,
  tipo,
}: {
  cajas: Map<string, CajaDelPago> | undefined
  id: string
  tipo: 'pago' | 'cobro'
}) {
  if (!cajas) return null
  const mov = cajas.get(id)
  if (!mov) return <> · no movió la caja</>
  const movimiento = tipo === 'cobro' ? 'su ingreso' : 'su egreso'
  if (mov.anulado) return <> · {movimiento} en {mov.cuenta}, anulado</>
  return <> · {tipo === 'cobro' ? 'entró a' : 'salió de'} {mov.cuenta}</>
}
