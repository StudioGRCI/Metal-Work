import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioUnidad } from './formulario-unidad'

export const metadata = { title: 'Unidad que llega sin orden' }

/**
 * El alta es una página y no una ventana: en el teléfono, cinco campos dentro
 * de un cuadro es un desplazamiento dentro de otro. Las fotos de cómo llegó se
 * ponen en el primer reporte, desde la pantalla de la unidad, que es donde
 * vive el gesto de siempre.
 */
export default async function PaginaNuevaUnidad() {
  await exigirPermiso('produccion.actividades')

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Avance en taller', ruta: '/avance' },
          { titulo: 'Unidades sin orden', ruta: '/avance/flota' },
          { titulo: 'Nueva' },
        ]}
        titulo="Unidad que llega sin orden"
        descripcion="Lo mínimo para que exista: qué es, de quién es y a qué entró. Lo demás se escribe día a día, con foto."
      />

      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          <FormularioUnidad />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
