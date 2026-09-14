import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioOrdenTaller } from './formulario'

export const metadata = { title: 'Abrir orden por revisar' }

/**
 * Abrir una orden desde el taller: para lo que llega sin orden de la oficina y
 * sí necesita etapas, plazos y una hoja por área. Queda por revisar hasta que el
 * jefe de producción la apruebe o la rechace (migración 098).
 *
 * No pide cliente (migración 100): el taller conoce la unidad por su placa, no
 * de quién es. Si la placa ya está registrada, la orden toma su cliente; si no,
 * la oficina se lo pone después, desde la orden.
 *
 * Es una página y no una ventana, igual que el trabajo sin orden: en el
 * teléfono, siete campos dentro de un cuadro es un desplazamiento dentro de otro.
 */
export default async function PaginaAbrirOrden() {
  await exigirPermiso('ordenes.abrir_taller')

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avance en taller', ruta: '/avance' }, { titulo: 'Abrir orden' }]}
        titulo="Abrir una orden por revisar"
        descripcion="Para lo que llega al taller sin orden de la oficina: qué unidad y qué hay que hacer. Queda por revisar hasta que el jefe de producción la apruebe; mientras, ya se le arma la lista de actividades y se reporta."
      />

      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          <FormularioOrdenTaller />
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
