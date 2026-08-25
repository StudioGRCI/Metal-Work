import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosAlmacen } from '@/lib/datos/almacen-operativo'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioMovimiento } from './formulario-movimiento'

export const metadata = { title: 'Nuevo movimiento' }

export default async function PaginaNuevoMovimiento({
  searchParams,
}: PageProps<'/almacen/movimientos/nuevo'>) {
  await exigirPermiso('almacen.movimientos')
  const params = await searchParams
  const catalogos = await catalogosAlmacen()

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Almacén', ruta: '/almacen' },
          { titulo: 'Movimientos', ruta: '/almacen/movimientos' },
          { titulo: 'Nuevo' },
        ]}
        titulo="Nuevo movimiento de almacén"
        descripcion="Primero la cabecera; los materiales se agregan enseguida y el documento se confirma al final."
      />
      <FormularioMovimiento
        catalogos={catalogos}
        tipoInicial={typeof params.tipo === 'string' ? params.tipo : undefined}
        ordenInicial={typeof params.orden === 'string' ? params.orden : undefined}
      />
    </>
  )
}
