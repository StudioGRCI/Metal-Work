import { redirect } from 'next/navigation'

/**
 * Tesorería se ordenó en cuatro el 2026-10-14 (migración 20261015120000):
 * Adquisiciones, Cuentas por cobrar, Cuentas por pagar y Pagos de servicio.
 * Esta dirección vieja lleva a lo que más espera: lo que hay por cobrar.
 */
export default function PaginaTesoreria() {
  redirect('/tesoreria/por-cobrar')
}
