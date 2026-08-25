import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosAlmacen } from '@/lib/datos/almacen-operativo'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioRequerimiento } from './formulario-requerimiento'

export const metadata = { title: 'Nuevo requerimiento' }

export default async function PaginaNuevoRequerimiento({
  searchParams,
}: PageProps<'/almacen/requerimientos/nuevo'>) {
  await exigirPermiso('requerimientos.crear')
  const params = await searchParams
  const catalogos = await catalogosAlmacen()

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Almacén', ruta: '/almacen' },
          { titulo: 'Requerimientos', ruta: '/almacen/requerimientos' },
          { titulo: 'Nuevo' },
        ]}
        titulo="Nuevo requerimiento de material"
        descripcion="Indica para qué orden se pide el material; los ítems se agregan enseguida."
      />
      <FormularioRequerimiento
        ordenes={catalogos.ordenes}
        almacenes={catalogos.almacenes}
        ordenInicial={typeof params.orden === 'string' ? params.orden : undefined}
      />
    </>
  )
}
