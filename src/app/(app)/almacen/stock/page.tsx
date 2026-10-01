import { redirect } from 'next/navigation'

/**
 * Stock de Almacén se retiró el 2026-10-01: el kardex ya da el saldo de cada
 * material, los ingresos, las salidas y el conteo físico. La ruta queda para que
 * los enlaces guardados y los accesos del teléfono lleguen al kardex.
 */
export default function PaginaStockRetirada() {
  redirect('/almacen/kardex')
}
