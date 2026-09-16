import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioOrden } from './formulario-orden'

export const metadata = { title: 'Orden sin cotización' }

export default async function PaginaNuevaOrden() {
  await exigirPermiso('ordenes.crear')
  const catalogos = await catalogosOrden()

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Órdenes de trabajo', ruta: '/ordenes' }, { titulo: 'Sin cotización' }]}
        titulo="Orden sin cotización"
        descripcion="Para una reparación, una garantía o un trabajo que no salió de una cotización. Nace en borrador y Gerencia la aprueba; recién ahí se generan sus etapas. La orden de una cotización aprobada se emite desde «Cotizaciones» con el número de su papel."
      />
      <FormularioOrden catalogos={catalogos} />
    </>
  )
}
