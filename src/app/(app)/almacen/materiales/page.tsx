import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tabla, TablaCabecera, TH, SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { catalogoCodificacion, listarMateriales } from '@/lib/datos/codificacion'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'
import { FilaMaterial } from './fila-material'

export const metadata = { title: 'Maestro de materiales' }

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
  const sinCodificar = materiales.filter((m) => !m.codigo_almacen).length

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

      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          name="buscar"
          defaultValue={busqueda ?? ''}
          placeholder="Buscar por descripción o código…"
          aria-label="Buscar material"
          className="w-72 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-1.5 text-sm text-texto"
        />
        <label className="flex items-center gap-2 text-sm text-texto">
          <input
            type="checkbox"
            name="pendientes"
            value="1"
            defaultChecked={sinCodigo}
            className="size-4 accent-[var(--acento)]"
          />
          Solo los que faltan codificar
        </label>
        <button type="submit" className="text-sm text-acento hover:underline">
          Filtrar
        </button>
      </form>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Material</TH>
              <TH>Código de almacén</TH>
              <TH>Código anterior</TH>
              <TH className="text-center">Criticidad</TH>
              <TH>Ubicación</TH>
              <TH>Controles</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {materiales.length === 0 ? (
              <SinDatos
                colSpan={6}
                titulo="Sin materiales"
                descripcion="Cambia el filtro o registra materiales desde los movimientos de almacén."
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
