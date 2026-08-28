import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro, type OpcionFiltro } from '@/components/estructura/pastilla-filtro'
import { Entrada } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Tabla, TablaCabecera, TH, SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { catalogoCodificacion, listarMateriales } from '@/lib/datos/codificacion'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'
import { FilaMaterial } from './fila-material'

export const metadata = { title: 'Maestro de materiales' }

const FILTROS: OpcionFiltro[] = [
  { valor: null, etiqueta: 'Todos' },
  { valor: '1', etiqueta: 'Faltan codificar' },
]

export default async function PaginaMateriales({ searchParams }: PageProps<'/almacen/materiales'>) {
  const perfil = await exigirPermiso('almacen.ver')
  const query = await searchParams

  const busqueda = typeof query.buscar === 'string' ? query.buscar : undefined
  const sinCodigo = query.pendientes === '1'

  const [materiales, catalogo] = await Promise.all([
    listarMateriales({ busqueda, sinCodigo }),
    catalogoCodificacion(),
  ])

  const puedeEditar = puede(perfil, 'almacen.maestros')
  const puedeMover = puede(perfil, 'almacen.movimientos')
  const sinCodificar = materiales.filter((m) => !m.codigo_almacen).length
  const filtrando = Boolean(busqueda) || sinCodigo

  return (
    <>
      <EncabezadoPagina
        titulo="Maestro de materiales"
        descripcion={
          sinCodificar > 0
            ? `Codificación FAMILIA-SUBFAMILIA-MATERIAL-TIPO-CORRELATIVO del área. Faltan codificar ${sinCodificar}.`
            : 'Cada material con su código de cinco segmentos, su criticidad y su ubicación.'
        }
      />

      <SubNavegacionAlmacen activa="/almacen/materiales" />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-3">
        {/* El filtro de codificación vive en las pastillas de abajo; sin este
            campo oculto, buscar lo apagaría sin que nadie lo pidiera. */}
        {sinCodigo && <input type="hidden" name="pendientes" value="1" />}
        <Entrada
          type="search"
          name="buscar"
          defaultValue={busqueda ?? ''}
          placeholder="Buscar por descripción o código…"
          aria-label="Buscar material"
          autoComplete="off"
          className="w-full sm:w-72"
        />
        <button
          type="submit"
          // El texto se queda como estaba en el monitor; lo que crece es el
          // blanco que hay que acertar con el dedo.
          className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0"
        >
          Filtrar
        </button>
      </form>

      <PastillaFiltro
        ruta="/almacen/materiales"
        clave="pendientes"
        opciones={FILTROS}
        params={query}
        activo={sinCodigo ? '1' : null}
        etiqueta="Filtrar por codificación"
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Material</TH>
              <TH>Código de almacén</TH>
              <TH className="hidden sm:table-cell">Código anterior</TH>
              <TH className="text-center">Criticidad</TH>
              <TH>Ubicación</TH>
              <TH className="hidden sm:table-cell">Controles</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {materiales.length === 0 ? (
              <SinDatos
                colSpan={6}
                titulo={filtrando ? 'Ningún material con ese filtro' : 'Sin materiales'}
                descripcion={
                  filtrando
                    ? 'Prueba con otro término o quita el filtro para ver todo el maestro.'
                    : 'Los materiales entran al maestro cuando se registran en un ingreso de almacén.'
                }
                accion={
                  filtrando ? (
                    <EnlaceBoton href="/almacen/materiales" variante="secundario" tamano="sm">
                      Ver todo el maestro
                    </EnlaceBoton>
                  ) : puedeMover ? (
                    <EnlaceBoton href="/almacen/movimientos/nuevo?tipo=INGRESO" tamano="sm">
                      Registrar un ingreso
                    </EnlaceBoton>
                  ) : undefined
                }
              />
            ) : (
              materiales.map((m) => (
                <FilaMaterial key={m.id} material={m} catalogo={catalogo} puedeEditar={puedeEditar} />
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
