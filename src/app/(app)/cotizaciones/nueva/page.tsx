import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioCotizacion } from './formulario-cotizacion'

export const metadata = { title: 'Nueva cotización' }

export default async function PaginaNuevaCotizacion() {
  await exigirPermiso('cotizaciones.crear')
  const catalogos = await catalogosOrden()

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Cotizaciones', ruta: '/cotizaciones' }, { titulo: 'Nueva' }]}
        titulo="Nueva cotización"
        descripcion="Ventas escribe a quién se le cotiza, sobre qué unidad y a qué precio; de acá pasa a Administración, que arma la cotización de trabajo."
      />
      <FormularioCotizacion catalogos={catalogos} />
    </>
  )
}
