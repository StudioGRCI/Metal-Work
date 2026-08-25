import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioOrden } from './formulario-orden'

export const metadata = { title: 'Nueva orden de trabajo' }

export default async function PaginaNuevaOrden() {
  await exigirPermiso('ordenes.crear')
  const catalogos = await catalogosOrden()

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Órdenes de trabajo', ruta: '/ordenes' }, { titulo: 'Nueva' }]}
        titulo="Nueva orden de trabajo"
        descripcion="La orden nace en borrador. Al aprobarla se generan sus etapas de producción y queda liberada al taller."
      />
      <FormularioOrden catalogos={catalogos} />
    </>
  )
}
