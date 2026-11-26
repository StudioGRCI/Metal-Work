import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { SinDatos, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { catalogosDeMateriales, listarCatalogoMateriales, materialesConUnidadPendiente } from '@/lib/datos/materiales'
import { paginaPedida } from '@/lib/dominio/paginas'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FilaMaterial, NuevoMaterial } from './fila-material'

export const metadata = { title: 'Materiales' }

/** El filtro de los que esperan su unidad: va por `?ver=`, junto al de los retirados (`?todos=1`). */
const POR_CONFIRMAR = 'unidad'

/**
 * El catálogo chico de Diseño. Existe para que dos personas no escriban
 * «plancha LAC 6 mm» de tres maneras distintas en el desglose de la orden.
 */
export default async function PaginaMateriales({ searchParams }: PageProps<'/materiales'>) {
  // Gerencia lo consulta sin crear ni corregir (`diseno.ver_materiales`, migración 20261126310000).
  const perfil = await exigirPermiso(['diseno.planos', 'diseno.ver_materiales'])
  const params = await searchParams

  const busqueda = typeof params.buscar === 'string' ? params.buscar : undefined
  // «Confirmar unidad» iba en ámbar en cada fila: repetido en cientos dejaba de
  // avisar (hallazgo 4 del plan de orden y diseño). Ahora es un filtro con su
  // cuenta, y la fila lo dice sin color.
  const soloPorConfirmar = params.ver === POR_CONFIRMAR
  const inactivos = !soloPorConfirmar && params.todos === '1'
  const pedida = paginaPedida(params.pagina)

  const [resultado, catalogos, porConfirmar] = await Promise.all([
    listarCatalogoMateriales({ busqueda, inactivos, unidadPendiente: soloPorConfirmar, pagina: pedida }),
    catalogosDeMateriales(),
    materialesConUnidadPendiente(busqueda),
  ])
  const { materiales, total, tamanoPagina, pagina } = resultado
  const paginas = Math.max(1, Math.ceil(total / tamanoPagina))
  const puedeEditar = puede(perfil, 'diseno.planos')

  return (
    <>
      <EncabezadoPagina
        titulo="Materiales"
        ayuda="Catálogo de Diseño y Almacén. Los materiales del Excel conservan su código original; Almacén debe confirmar las unidades provisionales."
        acciones={puedeEditar && <NuevoMaterial catalogos={catalogos} />}
      />

      {/* 20 px entre el buscador, los filtros y la lista (la escala de la skill diseno). */}
      <div className="space-y-5">
        <div className="space-y-3">
          <BuscadorSimple ruta="/materiales" clave="buscar" etiqueta="Buscar material" marcador="Nombre o código del material" />
          <PastillaFiltro
            ruta="/materiales"
            clave="todos"
            opciones={[
              { valor: null, etiqueta: 'En uso' },
              ...(porConfirmar === null || (porConfirmar === 0 && !soloPorConfirmar)
                ? []
                : [{ valor: POR_CONFIRMAR, clave: 'ver', etiqueta: `Unidad por confirmar (${porConfirmar})` }]),
              { valor: '1', etiqueta: 'También los retirados' },
            ]}
            params={params}
            activo={soloPorConfirmar ? POR_CONFIRMAR : inactivos ? '1' : null}
            etiqueta="Qué materiales mostrar"
          />
        </div>

        {/* En el teléfono cada material es una ficha con «Corregir» y «Retirar»
            en un renglón (entrega 5 del plan de orden y diseño): con la tabla
            apretada, el lápiz y el tacho iban uno sobre otro en 40 px. */}
        <Tarjeta className="overflow-hidden">
          <Tabla apilada>
            <TablaCabecera>
              <TR>
                <TH>Material</TH>
                <TH className="hidden md:table-cell">Categoría</TH>
                <TH className="hidden md:table-cell">Unidad</TH>
                <TH className="hidden xl:table-cell">Especificación</TH>
                {puedeEditar && <TH className="text-right md:w-60">Acciones</TH>}
              </TR>
            </TablaCabecera>
            <tbody>
              {materiales.length === 0 ? (
                <SinDatos
                  titulo={
                    soloPorConfirmar
                      ? 'Ningún material espera su unidad'
                      : busqueda
                        ? `Ningún material con «${busqueda}»`
                        : 'El catálogo está vacío'
                  }
                  descripcion={
                    soloPorConfirmar
                      ? busqueda
                        ? 'Ninguno de los buscados la tiene por confirmar. Borra la búsqueda o vuelve a «En uso».'
                        : 'Todos tienen confirmada la unidad en que se cuentan. Vuelve a «En uso» para ver el catálogo.'
                      : busqueda
                        ? `Prueba con menos palabras o con el código${puedeEditar ? '; si de verdad no está, créalo con «Nuevo material»' : ''}.`
                        : puedeEditar
                          ? 'Agrega el primero con «Nuevo material», arriba.'
                          : 'Lo arma Diseño.'
                  }
                />
              ) : (
                materiales.map((m) => <FilaMaterial key={m.id} material={m} catalogos={catalogos} puedeEditar={puedeEditar} />)
              )}
            </tbody>
          </Tabla>
        </Tarjeta>
      </div>
      <Paginacion ruta="/materiales" pagina={pagina} paginas={paginas} total={total} porPagina={tamanoPagina} params={params} />
    </>
  )
}
