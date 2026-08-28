import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir, opciones } from '@/lib/dominio/estados'
import { diasHasta, fecha, moneda } from '@/lib/format'
import { listarCotizaciones } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

export const metadata = { title: 'Cotizaciones' }

// La primera pastilla apaga el filtro; las demás salen del mismo mapa de
// estados con el que se pinta la insignia de cada fila.
const FILTROS = [{ valor: null, etiqueta: 'Todas' }, ...opciones(ESTADO_COTIZACION)]

/**
 * El aviso de vigencia, una sola vez: se pinta en su columna en el monitor y
 * bajo el número en el teléfono, donde esa columna no está. Solo tiene sentido
 * mientras la cotización sigue viva —una aprobada o anulada ya no «vence»—.
 */
function avisoDeVigencia(estado: string, dias: number | null) {
  const viva = estado === 'ENVIADA' || estado === 'BORRADOR'
  if (!viva || dias === null) return null
  if (dias < 0) return { texto: 'vencida', clase: 'text-peligro' }
  if (dias > 3) return null
  return { texto: dias === 0 ? 'vence hoy' : `vence en ${dias} d`, clase: 'text-aviso' }
}

export default async function PaginaCotizaciones({ searchParams }: PageProps<'/cotizaciones'>) {
  const perfil = await exigirPermiso('cotizaciones.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const cotizaciones = await listarCotizaciones({ estado })
  const puedeCrear = puede(perfil, 'cotizaciones.crear')

  return (
    <>
      <EncabezadoPagina
        titulo="Cotizaciones"
        descripcion="Propuestas económicas al cliente. Una cotización aprobada es el origen de la orden de trabajo."
        acciones={
          puedeCrear && (
            <EnlaceBoton href="/cotizaciones/nueva">
              <Plus aria-hidden className="size-4" />
              Nueva cotización
            </EnlaceBoton>
          )
        }
      />

      <PastillaFiltro
        ruta="/cotizaciones"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado ?? null}
        etiqueta="Filtrar por estado"
        className="mb-4"
      />

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Número</TH>
              <TH>Cliente</TH>
              {/* En el teléfono estas tres se esconden y su dato baja a las dos
                  primeras celdas: caben cuatro columnas, no siete. */}
              <TH className="hidden sm:table-cell">Trabajo</TH>
              <TH className="hidden sm:table-cell">Emisión</TH>
              <TH className="hidden sm:table-cell">Vigencia</TH>
              <TH>Estado</TH>
              <TH className="text-right">Total</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {cotizaciones.length === 0 ? (
              <SinDatos
                colSpan={7}
                // Con un filtro puesto no hay nada que dar de alta: lo que falta
                // es soltar el filtro. Sin filtro, la lista está de verdad vacía.
                titulo={estado ? 'Con este filtro no sale ninguna' : 'Aún no hay cotizaciones'}
                descripcion={
                  estado
                    ? 'Prueba con otro estado o mira todas las cotizaciones.'
                    : 'Elabora la primera para presentarle el precio al cliente.'
                }
                accion={
                  estado ? (
                    <EnlaceBoton href="/cotizaciones" variante="secundario" tamano="sm">
                      Ver todas
                    </EnlaceBoton>
                  ) : (
                    puedeCrear && (
                      <EnlaceBoton href="/cotizaciones/nueva" tamano="sm">
                        <Plus aria-hidden className="size-3.5" />
                        Nueva cotización
                      </EnlaceBoton>
                    )
                  )
                }
              />
            ) : (
              cotizaciones.map((c) => {
                const est = definir(ESTADO_COTIZACION, c.estado)
                const cliente = c.cliente as unknown as { razon_social: string }
                const unidad = c.unidad as unknown as { placa: string } | null
                const carroceria = c.tipo_carroceria as unknown as { nombre: string } | null
                const trabajo = [carroceria?.nombre, unidad?.placa].filter(Boolean).join(' · ')
                const aviso = avisoDeVigencia(c.estado, diasHasta(c.fecha_vencimiento))

                return (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap">
                      {/* El número es la puerta a la ficha: en el teléfono se
                          marca con el dedo, así que el enlace ocupa los 44 px
                          de alto en vez de la altura de la letra. */}
                      <Link
                        href={`/cotizaciones/${c.id}`}
                        className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
                      >
                        {c.numero}
                      </Link>
                      <p className="tabular mt-0.5 text-[11px] text-texto-suave sm:hidden">
                        {fecha(c.fecha_emision)} → {fecha(c.fecha_vencimiento)}
                      </p>
                      {aviso && (
                        <p className={`text-[11px] sm:hidden ${aviso.clase}`}>{aviso.texto}</p>
                      )}
                    </TD>
                    <TD className="max-w-48">
                      <p className="truncate">{cliente.razon_social}</p>
                      {trabajo && (
                        <p className="truncate text-[11px] text-texto-suave sm:hidden">{trabajo}</p>
                      )}
                    </TD>
                    <TD className="hidden text-texto-suave sm:table-cell">
                      {carroceria?.nombre ?? '—'}
                      {unidad && <span className="tabular"> · {unidad.placa}</span>}
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">
                      {fecha(c.fecha_emision)}
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">
                      {fecha(c.fecha_vencimiento)}
                      {aviso && <p className={`text-[11px] ${aviso.clase}`}>{aviso.texto}</p>}
                    </TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right font-medium whitespace-nowrap">
                      {moneda(c.total, (c.moneda ?? 'PEN') as CodigoMoneda)}
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
