import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioTrabajo } from './formulario-trabajo'

export const metadata = { title: 'Nuevo trabajo sin orden' }

/**
 * El alta es una página y no una ventana: en el teléfono, cinco campos dentro
 * de un cuadro es un desplazamiento dentro de otro. La foto de cómo empieza se
 * pone en el primer reporte, desde la pantalla del trabajo, que es donde vive
 * el gesto de siempre.
 */
export default async function PaginaNuevoTrabajo() {
  await exigirPermiso('produccion.actividades')

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Avance en taller', ruta: '/avance' },
          { titulo: 'Trabajos sin orden', ruta: '/avance/trabajos' },
          { titulo: 'Nuevo' },
        ]}
        titulo="Nuevo trabajo sin orden"
        descripcion="Lo mínimo para que exista: qué es y qué se va a hacer. Si es una unidad de un cliente, su placa. Lo demás se escribe día a día, con foto."
      />

      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          <FormularioTrabajo />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
