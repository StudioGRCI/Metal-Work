import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cantidad, fecha } from '@/lib/format'
import { listarPartes } from '@/lib/datos/produccion'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Producción' }

const ESTADOS = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' as const },
  CERRADO: { etiqueta: 'Cerrado', tono: 'info' as const },
  APROBADO: { etiqueta: 'Aprobado', tono: 'exito' as const },
}

// Las mismas cuatro pastillas de siempre, ahora en el componente compartido:
// así conservan lo que ya hubiera en la URL y marcan cuál está puesta.
const FILTROS = [
  { valor: null, etiqueta: 'Todos' },
  { valor: 'BORRADOR', etiqueta: 'En borrador' },
  { valor: 'CERRADO', etiqueta: 'Cerrados' },
  { valor: 'APROBADO', etiqueta: 'Aprobados' },
]

export default async function PaginaProduccion({ searchParams }: PageProps<'/produccion'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const partes = await listarPartes({ estado })

  // El mismo botón arriba y en el estado vacío: quien llega a una lista sin
  // nada tiene el siguiente paso a la mano y no vuelve a buscarlo arriba.
  const botonNuevo = puede(perfil, 'produccion.registrar') ? (
    <EnlaceBoton href="/produccion/nuevo">
      <Plus aria-hidden className="size-4" />
      Nuevo parte
    </EnlaceBoton>
  ) : null

  return (
    <>
      <EncabezadoPagina
        titulo="Partes diarios de producción"
        descripcion="Las horas del taller por día. Al aprobar un parte, sus horas se cargan a las etapas de cada orden y al costo de mano de obra."
        acciones={botonNuevo}
      />

      <PastillaFiltro
        ruta="/produccion"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado ?? null}
        etiqueta="Filtrar los partes por estado"
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Parte</TH>
              <TH>Fecha</TH>
              <TH className="hidden sm:table-cell">Taller</TH>
              <TH className="hidden sm:table-cell">Responsable</TH>
              <TH>Estado</TH>
              <TH className="hidden text-right sm:table-cell">Registros</TH>
              <TH className="text-right">Horas</TH>
              <TH className="hidden text-right sm:table-cell">Extra</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {partes.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={estado ? 'Ningún parte en ese estado' : 'Todavía no hay partes diarios'}
                descripcion={
                  estado
                    ? 'Con ese filtro no aparece ninguno. Quítalo para ver todos los partes del taller.'
                    : 'Registra el parte del día para cargar las horas trabajadas a las órdenes.'
                }
                accion={
                  estado ? (
                    <EnlaceBoton href="/produccion" variante="secundario">
                      Ver todos los partes
                    </EnlaceBoton>
                  ) : (
                    botonNuevo
                  )
                }
              />
            ) : (
              partes.map((p) => {
                const est = ESTADOS[p.estado as keyof typeof ESTADOS] ?? ESTADOS.BORRADOR
                const sede = p.sede as unknown as { nombre: string }
                const responsable = p.responsable as unknown as { nombres: string; apellidos: string } | null
                const registros = (p.detalle as unknown as { count: number }[])?.[0]?.count ?? 0
                const extra = Number(p.total_horas_extra ?? 0)

                return (
                  <TR key={p.id}>
                    <TD>
                      <Link
                        href={`/produccion/${p.id}`}
                        className="inline-flex min-h-11 items-center font-medium whitespace-nowrap text-acento hover:underline sm:min-h-0"
                      >
                        {p.numero}
                      </Link>
                      {/* En el teléfono no entran ocho columnas: taller, responsable
                          y número de registros bajan acá en letra chica en vez de
                          desaparecer con la columna. */}
                      <p className="text-xs text-texto-suave sm:hidden">
                        {sede.nombre}
                        {responsable ? ` · ${responsable.nombres} ${responsable.apellidos}` : ''}
                        {` · ${registros} ${registros === 1 ? 'registro' : 'registros'}`}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap">{fecha(p.fecha)}</TD>
                    <TD className="hidden text-texto-suave sm:table-cell">{sede.nombre}</TD>
                    <TD className="hidden text-texto-suave sm:table-cell">
                      {responsable ? `${responsable.nombres} ${responsable.apellidos}` : '—'}
                    </TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">{registros}</TD>
                    <TD className="tabular text-right font-medium">
                      {cantidad(p.total_horas)}
                      {extra > 0 && (
                        <span className="block text-xs font-normal text-texto-suave sm:hidden">
                          +{cantidad(p.total_horas_extra)} extra
                        </span>
                      )}
                    </TD>
                    <TD className="tabular hidden text-right text-texto-suave sm:table-cell">
                      {cantidad(p.total_horas_extra)}
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
