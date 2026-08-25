import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { catalogosParte } from '@/lib/datos/produccion'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioParte } from './formulario-parte'

export const metadata = { title: 'Nuevo parte diario' }

export default async function PaginaNuevoParte() {
  const perfil = await exigirPermiso('produccion.registrar')
  const { sedes } = await catalogosParte()

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Producción', ruta: '/produccion' }, { titulo: 'Nuevo parte' }]}
        titulo="Nuevo parte diario"
        descripcion="Un parte por taller y día. Las horas se agregan enseguida, en el detalle."
      />
      <FormularioParte sedes={sedes} sedePorDefecto={perfil.sede_id} />
    </>
  )
}
