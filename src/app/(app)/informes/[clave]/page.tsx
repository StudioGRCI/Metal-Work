import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { comoFecha, correrInforme, periodoPorDefecto } from '@/lib/datos/informes'
import { informePorClave } from '@/lib/dominio/informes'
import { alineaDerecha, celda, total } from '@/lib/informes-formato'
import { fecha as formatearFecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { DescargarCsv } from './descargar-csv'
import { RangoDeFechas } from '../rango-de-fechas'

export async function generateMetadata({ params }: PageProps<'/informes/[clave]'>) {
  const { clave } = await params
  return { title: informePorClave(clave)?.titulo ?? 'Informe' }
}

export default async function PaginaInforme({
  params,
  searchParams,
}: PageProps<'/informes/[clave]'>) {
  const perfil = await exigirPermiso('reportes.ver')
  const { clave } = await params
  const consulta = await searchParams

  const informe = informePorClave(clave)
  if (!informe) notFound()

  // El informe declara qué hace falta para verlo; la base lo vuelve a comprobar.
  if (!informe.permisos.every((p) => puede(perfil, p))) redirect('/sin-permiso')

  const defecto = periodoPorDefecto()
  const desde = comoFecha(consulta.desde, defecto.desde)
  const hasta = comoFecha(consulta.hasta, defecto.hasta)

  const filas = await correrInforme(clave, desde, hasta)
  const hayTotales = informe.columnas.some((c) => c.totaliza)
  const inicioDeAnio = `${hasta.slice(0, 4)}-01-01`

  return (
    <>
      <Link
        href={`/informes?desde=${desde}&hasta=${hasta}`}
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-texto-suave hover:text-texto sm:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Todos los informes
      </Link>

      <EncabezadoPagina
        titulo={informe.titulo}
        descripcion={`${informe.descripcion} Del ${formatearFecha(desde)} al ${formatearFecha(hasta)}.`}
        acciones={
          filas.length > 0 && (
            <DescargarCsv clave={clave} desde={desde} hasta={hasta} titulo={informe.titulo} />
          )
        }
      />

      <RangoDeFechas ruta={`/informes/${clave}`} desde={desde} hasta={hasta} />

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              {informe.columnas.map((c) => (
                <TH key={c.clave} className={alineaDerecha(c) ? 'text-right' : undefined}>
                  {c.titulo}
                </TH>
              ))}
            </tr>
          </TablaCabecera>
          <tbody>
            {filas.length === 0 ? (
              // El informe siempre viene filtrado por fechas: aquí «no hay
              // nada» es siempre «no hay nada en este rango», y el siguiente
              // paso es ensanchar el rango sin tener que escribirlo a mano.
              <SinDatos
                colSpan={informe.columnas.length}
                titulo="Sin movimiento en este período"
                descripcion={`Entre el ${formatearFecha(desde)} y el ${formatearFecha(hasta)} no se registró nada para este informe.`}
                accion={
                  // Solo si de verdad ensancha: con un rango que ya empieza
                  // antes de enero, el botón estaría recortando la búsqueda.
                  desde <= inicioDeAnio ? undefined : (
                    <EnlaceBoton
                      href={`/informes/${clave}?desde=${inicioDeAnio}&hasta=${hasta}`}
                      variante="secundario"
                      tamano="sm"
                    >
                      Buscar en todo {hasta.slice(0, 4)}
                    </EnlaceBoton>
                  )
                }
              />
            ) : (
              filas.map((fila, i) => (
                <TR key={i}>
                  {informe.columnas.map((c) => (
                    <TD
                      key={c.clave}
                      className={
                        alineaDerecha(c)
                          ? 'tabular text-right whitespace-nowrap'
                          : 'max-w-56 truncate whitespace-nowrap'
                      }
                    >
                      {celda(fila[c.clave], c)}
                    </TD>
                  ))}
                </TR>
              ))
            )}
          </tbody>

          {filas.length > 0 && hayTotales && (
            <tfoot className="border-t border-borde-fuerte bg-superficie-2">
              <tr>
                {informe.columnas.map((c, i) => {
                  const suma = total(filas, c)
                  return (
                    <td
                      key={c.clave}
                      className={`px-4 py-2.5 text-sm font-semibold text-texto ${
                        alineaDerecha(c) ? 'tabular text-right whitespace-nowrap' : ''
                      }`}
                    >
                      {i === 0 ? 'Total' : suma === null ? '' : celda(suma, c)}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </Tabla>
      </Tarjeta>

      {informe.nota && <p className="mt-3 text-xs text-texto-tenue">{informe.nota}</p>}
    </>
  )
}
