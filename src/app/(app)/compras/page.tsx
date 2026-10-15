import { redirect } from 'next/navigation'

// «Compras agrupadas» (las compras por OT) se quitó el 2026-10-15: la OT ya no
// se usa. La dirección vieja lleva a Órdenes de compra, donde siguen listadas.
export default function PaginaCompras() {
  redirect('/compras/ordenes')
}
