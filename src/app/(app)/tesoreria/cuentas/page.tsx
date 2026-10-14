import { redirect } from 'next/navigation'

/** «Cuentas de Tesorería» se partió en Cuentas por cobrar y Cuentas por pagar (migración 20261015120000). */
export default function PaginaCuentas() {
  redirect('/tesoreria/por-cobrar')
}
