import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoTope } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Tarjeta } from '@/components/ui/tarjeta'
import { misNotificaciones } from '@/lib/datos/notificaciones'
import { exigirSesion } from '@/lib/sesion'

import { ListaAvisos } from './lista-avisos'

export const metadata = { title: 'Avisos' }

const TOPE = 200

/**
 * Todos los avisos, no solo los últimos veinte de la campana.
 *
 * En un día movido los avisos de la mañana se caían de la campana sin haberse
 * leído y no había dónde recuperarlos. Acá están los últimos doscientos, con
 * los sin leer primero si se pide.
 */
export default async function PaginaAvisos({ searchParams }: PageProps<'/avisos'>) {
  await exigirSesion()
  const params = await searchParams
  const ver = params.ver === 'sin-leer' ? 'sin-leer' : null

  const avisos = await misNotificaciones(TOPE)
  const sinLeer = avisos.filter((a) => !a.leida_en)
  const lista = ver === 'sin-leer' ? sinLeer : avisos

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Avisos' }]}
        titulo="Avisos"
        descripcion="Lo que el circuito te fue dejando: cada uno lleva a la pantalla donde se resuelve."
      />

      <PastillaFiltro
        ruta="/avisos"
        clave="ver"
        opciones={[
          { valor: null, etiqueta: `Todos (${avisos.length})` },
          { valor: 'sin-leer', etiqueta: `Sin leer (${sinLeer.length})` },
        ]}
        params={params}
        activo={ver}
        etiqueta="Filtrar avisos"
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <ListaAvisos avisos={lista} sinLeer={sinLeer.length} />
      </Tarjeta>

      <AvisoTope mostradas={avisos.length} tope={TOPE} />
    </>
  )
}
