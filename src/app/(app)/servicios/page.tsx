import type { ReactNode } from 'react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador } from '@/components/ui/indicador'
import { SinDatos, TH, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { catalogosDeServicio, listarOrdenesDeServicio, resumirServicios } from '@/lib/datos/servicios'
import { moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FilaDeServicio, NuevaOrdenDeServicio } from './acciones-servicio'

export const metadata = { title: 'Servicios de terceros' }

const FILTROS = [
  { valor: 'abiertas', etiqueta: 'Abiertas' },
  { valor: 'EJECUTADO', etiqueta: 'Por conformar' },
  { valor: 'CONFORME', etiqueta: 'Por pagar' },
  { valor: 'PAGADO', etiqueta: 'Pagadas' },
  { valor: 'todas', etiqueta: 'Todas' },
]

export default async function PaginaServicios({ searchParams }: PageProps<'/servicios'>) {
  const perfil = await exigirPermiso(['compras.ver', 'costos.ver', 'calidad.ver'])
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const estado = typeof params.estado === 'string' ? params.estado : 'abiertas'

  const emite = puede(perfil, ['compras.crear', 'costos.editar'])

  const [servicios, catalogos] = await Promise.all([
    listarOrdenesDeServicio({ estado, busqueda }),
    emite ? catalogosDeServicio() : Promise.resolve(null),
  ])

  const resumen = resumirServicios(servicios)
  const conforma = puede(perfil, 'calidad.inspeccionar')
  const paga = puede(perfil, 'costos.editar')

  const etiquetaFiltro = FILTROS.find((f) => f.valor === estado)?.etiqueta ?? 'Todas'

  /** Cambiar de filtro no debe tirar lo que la persona escribió en el buscador. */
  const rutaConBusqueda = (valor: string) =>
    busqueda
      ? `/servicios?estado=${valor}&q=${encodeURIComponent(busqueda)}`
      : `/servicios?estado=${valor}`

  // Una lista vacía porque no hay nada y una vacía por el filtro se arreglan de
  // maneras opuestas: emitir la primera orden, o soltar el filtro.
  const filtrando = Boolean(busqueda) || estado !== 'todas'
  let accionSinDatos: ReactNode = null
  if (filtrando) {
    accionSinDatos = (
      <EnlaceBoton href="/servicios?estado=todas" variante="contorno">
        Ver todas las órdenes
      </EnlaceBoton>
    )
  } else if (emite && catalogos) {
    accionSinDatos = <NuevaOrdenDeServicio catalogos={catalogos} />
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Servicios de terceros"
        descripcion="El trabajo que se manda a hacer afuera: arenado, corte láser, galvanizado, torno."
        acciones={emite && catalogos && <NuevaOrdenDeServicio catalogos={catalogos} />}
      />

      {/* Dos por fila en el teléfono: cuatro apiladas se comían la pantalla antes
          de llegar a la lista, que es a lo que se viene. */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Indicador titulo="Órdenes listadas" valor={resumen.total} pie={`Filtro: ${etiquetaFiltro}`} />
        <Indicador
          titulo="Comprometido"
          valor={moneda(resumen.comprometido)}
          pie="Pedido y todavía afuera"
        />
        {/* Este número sí lleva a algún lado: es exactamente el filtro
            «Por conformar», con la búsqueda que hubiera puesta. */}
        <Indicador
          titulo="Por conformar"
          valor={resumen.porConformar}
          pie="Volvieron y esperan la aceptación"
          tono={resumen.porConformar > 0 ? 'aviso' : 'neutro'}
          href={rutaConBusqueda('EJECUTADO')}
        />
        <Indicador
          titulo="Atrasadas"
          valor={resumen.atrasadas}
          pie="Pasaron su fecha de entrega"
          tono={resumen.atrasadas > 0 ? 'peligro' : 'neutro'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <BuscadorSimple
            ruta="/servicios"
            etiqueta="Buscar órdenes de servicio"
            marcador="Buscar por número, proveedor, trabajo u OT"
          />
        </div>
        {/* Antes cada pastilla rearmaba la URL a mano; PastillaFiltro conserva
            todos los parámetros y no recarga la pantalla entera. */}
        <PastillaFiltro
          ruta="/servicios"
          clave="estado"
          opciones={FILTROS}
          params={params}
          activo={estado}
          etiqueta="Filtrar por estado"
        />
      </div>

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              {/* En el teléfono el proveedor baja bajo el número de orden y la
                  entrega bajo el estado; sus columnas se esconden para que quepan
                  el trabajo, el monto y los botones. */}
              <TH className="hidden sm:table-cell">Proveedor</TH>
              <TH>Trabajo</TH>
              <TH>Estado</TH>
              <TH className="hidden sm:table-cell">Entrega</TH>
              <TH className="text-right">Monto</TH>
              <TH className="text-right">Acciones</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {servicios.length === 0 && (
              <SinDatos
                colSpan={7}
                titulo={filtrando ? 'Ninguna orden coincide' : 'Todavía no se mandó nada afuera'}
                descripcion={
                  filtrando
                    ? `Con lo que hay puesto —${etiquetaFiltro.toLowerCase()}— no queda ninguna orden en la lista.`
                    : 'Aquí aparece cada trabajo que se manda a hacer afuera, con su plazo y su monto.'
                }
                accion={accionSinDatos}
              />
            )}

            {servicios.map((servicio) => (
              <FilaDeServicio
                key={servicio.id}
                servicio={servicio}
                puedeMover={emite}
                puedeConformar={conforma}
                puedePagar={paga}
              />
            ))}
          </tbody>
        </Tabla>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-tenue">
        Mientras el trabajo está afuera el monto es un compromiso. Al dar la conformidad pasa a ser
        costo de la unidad, y recién ahí se puede registrar la factura y el pago.
      </p>
    </>
  )
}
