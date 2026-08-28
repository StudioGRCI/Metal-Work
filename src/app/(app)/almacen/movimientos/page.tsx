import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro, type OpcionFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_MOVIMIENTO, TIPO_MOVIMIENTO } from '@/lib/dominio/almacen'
import { definir } from '@/lib/dominio/estados'
import { fecha, moneda } from '@/lib/format'
import { listarMovimientos } from '@/lib/datos/almacen-operativo'
import { exigirPermiso, puede } from '@/lib/sesion'

import { SubNavegacionAlmacen } from '../sub-navegacion'

export const metadata = { title: 'Movimientos de almacén' }

// «Sin confirmar» filtra por estado y las demás por tipo: es el grupo mezclado
// para el que `PastillaFiltro` acepta una clave por opción. Al pulsar una se
// apagan las dos claves y se enciende solo la suya, así que nunca quedan dos
// pastillas encendidas contradiciéndose.
const FILTROS: OpcionFiltro[] = [
  { valor: null, etiqueta: 'Todos' },
  { valor: 'BORRADOR', etiqueta: 'Sin confirmar', clave: 'estado' },
  ...Object.entries(TIPO_MOVIMIENTO).map(([valor, def]) => ({ valor, etiqueta: def.etiqueta })),
]

export default async function PaginaMovimientos({
  searchParams,
}: PageProps<'/almacen/movimientos'>) {
  const perfil = await exigirPermiso('almacen.ver')
  const params = await searchParams

  const tipo = typeof params.tipo === 'string' ? params.tipo : undefined
  const estado = typeof params.estado === 'string' ? params.estado : undefined
  const movimientos = await listarMovimientos({ tipo, estado })

  const filtrando = Boolean(tipo || estado)
  const puedeMover = puede(perfil, 'almacen.movimientos')

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Almacén', ruta: '/almacen' }, { titulo: 'Movimientos' }]}
        titulo="Movimientos de almacén"
        descripcion="Ingresos, vales de consumo, devoluciones, transferencias y ajustes. Al confirmarse afectan el kardex y ya no se pueden modificar."
        acciones={
          puedeMover && (
            <EnlaceBoton href="/almacen/movimientos/nuevo">
              <Plus aria-hidden className="size-4" />
              Nuevo movimiento
            </EnlaceBoton>
          )
        }
      />

      <SubNavegacionAlmacen activa="/almacen/movimientos" />

      <PastillaFiltro
        ruta="/almacen/movimientos"
        clave="tipo"
        opciones={FILTROS}
        params={params}
        activo={tipo ?? estado ?? null}
        etiqueta="Filtrar movimientos"
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Documento</TH>
              <TH>Tipo</TH>
              <TH className="hidden sm:table-cell">Fecha</TH>
              <TH className="hidden sm:table-cell">Almacén</TH>
              <TH className="hidden sm:table-cell">Orden</TH>
              <TH className="hidden sm:table-cell">Referencia</TH>
              <TH>Estado</TH>
              <TH className="hidden text-right sm:table-cell">Líneas</TH>
              <TH className="hidden text-right sm:table-cell">Valorizado</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {movimientos.length === 0 ? (
              <SinDatos
                colSpan={9}
                titulo={filtrando ? 'Ningún movimiento con ese filtro' : 'Sin movimientos'}
                descripcion={
                  filtrando
                    ? 'Con este tipo o estado no hay documentos. Quita el filtro para ver todos.'
                    : 'Registra un ingreso para cargar existencias, o un vale de consumo para entregar material a una orden.'
                }
                accion={
                  filtrando ? (
                    <EnlaceBoton href="/almacen/movimientos" variante="secundario" tamano="sm">
                      Ver todos los movimientos
                    </EnlaceBoton>
                  ) : puedeMover ? (
                    <EnlaceBoton href="/almacen/movimientos/nuevo" tamano="sm">
                      <Plus aria-hidden className="size-3.5" />
                      Nuevo movimiento
                    </EnlaceBoton>
                  ) : undefined
                }
              />
            ) : (
              movimientos.map((m) => {
                const t = definir(TIPO_MOVIMIENTO, m.tipo)
                const e = definir(ESTADO_MOVIMIENTO, m.estado)
                const almacen = m.almacen as unknown as { nombre: string }
                const orden = m.orden as unknown as { id: string; numero: string } | null
                const lineas = (m.detalle as unknown as { count: number }[])?.[0]?.count ?? 0

                return (
                  <TR key={m.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/almacen/movimientos/${m.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {m.numero}
                      </Link>
                      {/* En el teléfono la fecha, el almacén y la orden pierden su
                          columna: bajan acá en letra chica, porque sin ellas la
                          fila no dice de qué documento se trata. La orden va como
                          texto y no como enlace a propósito: dos enlaces pegados
                          en una fila estrecha se pulsan mal. */}
                      <p className="mt-0.5 text-[11px] whitespace-normal text-texto-suave sm:hidden">
                        {fecha(m.fecha)} · {almacen.nombre}
                        {orden ? ` · ${orden.numero}` : ''}
                      </p>
                    </TD>
                    <TD>
                      <Insignia tono={t.tono}>{t.etiqueta}</Insignia>
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{fecha(m.fecha)}</TD>
                    <TD className="hidden text-texto-suave sm:table-cell">{almacen.nombre}</TD>
                    <TD className="hidden sm:table-cell">
                      {orden ? (
                        <Link href={`/ordenes/${orden.id}`} className="text-acento hover:underline">
                          {orden.numero}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD className="hidden max-w-40 truncate text-texto-suave sm:table-cell">
                      {m.documento_referencia ?? m.motivo ?? '—'}
                    </TD>
                    <TD>
                      <Insignia tono={e.tono}>{e.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">{lineas}</TD>
                    <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                      {m.estado === 'CONFIRMADO' ? moneda(m.total_valorizado) : '—'}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
