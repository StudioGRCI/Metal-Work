import { FilePlus2 } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { exigirPermiso, puede } from '@/lib/sesion'

import { PestanaCompras } from './compras'
import { PestanaFacturas, VISTAS_DE_FACTURAS } from './facturas'

export const metadata = { title: 'Adquisiciones' }

/**
 * Todo lo comprado, en dos pestañas. «OC y OS», la de entrada: una fila por
 * orden de compra y por orden de servicio, de dónde salió hasta si se pagó y
 * con cada documento (migración 20261020170000). «Facturas», la de siempre: cada
 * factura con sus OC y si calza con ellas, donde Contabilidad las registra. Las
 * direcciones de antes (`?vista=por-pagar`…) abren la pestaña Facturas.
 */
export default async function PaginaAdquisiciones({ searchParams }: PageProps<'/adquisiciones'>) {
  const perfil = await exigirPermiso('adquisiciones.ver')
  const params = await searchParams
  const enFacturas = VISTAS_DE_FACTURAS.some((v) => v.valor === params.vista)
  const registra = puede(perfil, 'adquisiciones.registrar')

  return (
    <>
      <EncabezadoPagina
        titulo="Adquisiciones"
        ayuda="Cada orden de compra y de servicio, de su RQ o su OT hasta su pago, con la cotización, la factura, la guía y el voucher. En Facturas, Contabilidad registra cada factura con las OC que cubre y ve si su total calza con el de sus OC; Tesorería la paga en Cuentas por pagar."
        acciones={
          registra && !enFacturas ? (
            <EnlaceBoton href="/adquisiciones?vista=facturas#nuevo-comprobante" variante="secundario">
              <FilePlus2 aria-hidden className="size-4" />
              Registrar factura
            </EnlaceBoton>
          ) : undefined
        }
      />

      <Vistas
        etiqueta="Qué mirar"
        className="mb-4"
        vistas={[
          { clave: 'compras', titulo: 'OC y OS', href: '/adquisiciones', activa: !enFacturas },
          { clave: 'facturas', titulo: 'Facturas', href: '/adquisiciones?vista=facturas', activa: enFacturas },
        ]}
      />

      {enFacturas ? <PestanaFacturas perfil={perfil} params={params} /> : <PestanaCompras perfil={perfil} params={params} />}
    </>
  )
}
