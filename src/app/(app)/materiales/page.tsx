import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Entrada } from '@/components/ui/campos'
import { SinDatos, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { catalogosDeMateriales, listarCatalogoMateriales } from '@/lib/datos/materiales'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FilaMaterial, NuevoMaterial } from './fila-material'

export const metadata = { title: 'Materiales' }

const FILTROS = [
  { valor: null, etiqueta: 'En uso' },
  { valor: '1', etiqueta: 'También los retirados' },
]

/**
 * El catálogo chico de Diseño. Existe para que dos personas no escriban
 * «plancha LAC 6 mm» de tres maneras distintas en el desglose de la orden.
 */
export default async function PaginaMateriales({ searchParams }: PageProps<'/materiales'>) {
  const perfil = await exigirPermiso(['diseno.planos', 'cotizaciones.costear'])
  const params = await searchParams

  const busqueda = typeof params.buscar === 'string' ? params.buscar : undefined
  const inactivos = params.todos === '1'

  const [materiales, catalogos] = await Promise.all([
    listarCatalogoMateriales({ busqueda, inactivos }),
    catalogosDeMateriales(),
  ])
  const puedeEditar = puede(perfil, 'diseno.planos')

  return (
    <>
      <EncabezadoPagina
        titulo="Materiales"
        descripcion="El catálogo del que Diseño elige al desglosar qué lleva cada unidad: nombre, unidad y especificación. Sin stock ni almacén."
        acciones={puedeEditar && <NuevoMaterial catalogos={catalogos} />}
      />

      <form method="get" className="mb-3 flex flex-wrap items-center gap-3">
        {inactivos && <input type="hidden" name="todos" value="1" />}
        <Entrada
          type="search"
          name="buscar"
          defaultValue={busqueda ?? ''}
          placeholder="Buscar por nombre o código…"
          aria-label="Buscar material"
          autoComplete="off"
          className="w-full sm:w-72"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0"
        >
          Buscar
        </button>
      </form>

      <PastillaFiltro
        ruta="/materiales"
        clave="todos"
        opciones={FILTROS}
        params={params}
        activo={inactivos ? '1' : null}
        etiqueta="Qué materiales mostrar"
        className="mb-4"
      />

      <Tarjeta>
        <TarjetaCuerpo className="p-0">
          {materiales.length === 0 ? (
            <SinDatos
              titulo={busqueda ? `Ningún material con «${busqueda}»` : 'El catálogo está vacío'}
              descripcion={
                puedeEditar
                  ? 'Agrega el primero con «Nuevo material», arriba.'
                  : 'Lo arma Diseño.'
              }
            />
          ) : (
            <Tabla>
              <TablaCabecera>
                <TR>
                  <TH>Material</TH>
                  <TH>Categoría</TH>
                  <TH>Unidad</TH>
                  <TH>Especificación</TH>
                  {puedeEditar && <TH className="w-28" />}
                </TR>
              </TablaCabecera>
              <tbody>
                {materiales.map((m) => (
                  <FilaMaterial key={m.id} material={m} catalogos={catalogos} puedeEditar={puedeEditar} />
                ))}
              </tbody>
            </Tabla>
          )}
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
