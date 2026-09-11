import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { clientesParaElTaller } from '@/lib/datos/ordenes'
import { exigirPermiso } from '@/lib/sesion'

import { FormularioOrdenTaller } from './formulario'

export const metadata = { title: 'Abrir orden por revisar' }

/**
 * Abrir una orden desde el taller: para lo que llega sin orden de la oficina y
 * sí necesita etapas, plazos y una hoja por área. Queda por revisar hasta que el
 * jefe de producción la apruebe o la rechace (migración 098).
 *
 * Es una página y no una ventana, igual que el trabajo sin orden: en el
 * teléfono, ocho campos dentro de un cuadro es un desplazamiento dentro de otro.
 */
export default async function PaginaAbrirOrden() {
  await exigirPermiso('ordenes.abrir_taller')
  const clientes = await clientesParaElTaller()

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avance en taller', ruta: '/avance' }, { titulo: 'Abrir orden' }]}
        titulo="Abrir una orden por revisar"
        descripcion="Para lo que llega al taller sin orden de la oficina: de quién es, qué unidad y qué hay que hacer. Queda por revisar hasta que el jefe de producción la apruebe; mientras, ya se le arma la lista de actividades y se reporta."
      />

      <Tarjeta className="max-w-3xl">
        <TarjetaCuerpo>
          {clientes.length === 0 ? (
            <>
              <p className="text-sm font-medium text-texto">Todavía no hay clientes dados de alta</p>
              <p className="mt-1 text-sm text-texto-suave">
                La orden tiene que decir de quién es la unidad. Pídele a la oficina que registre al
                cliente; mientras, lo que se trabaje se puede registrar como trabajo sin orden.
              </p>
            </>
          ) : (
            <FormularioOrdenTaller clientes={clientes} />
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
