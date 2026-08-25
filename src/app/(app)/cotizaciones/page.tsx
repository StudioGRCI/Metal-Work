import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir, opciones } from '@/lib/dominio/estados'
import { diasHasta, fecha, moneda } from '@/lib/format'
import { listarCotizaciones } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

export const metadata = { title: 'Cotizaciones' }

const ESTADOS = opciones(ESTADO_COTIZACION)

export default async function PaginaCotizaciones({ searchParams }: PageProps<'/cotizaciones'>) {
  const perfil = await exigirPermiso('cotizaciones.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const cotizaciones = await listarCotizaciones({ estado })

  return (
    <>
      <EncabezadoPagina
        titulo="Cotizaciones"
        descripcion="Propuestas económicas al cliente. Una cotización aprobada es el origen de la orden de trabajo."
        acciones={
          puede(perfil, 'cotizaciones.crear') && (
            <Link
              href="/cotizaciones/nueva"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:bg-acento-fuerte"
            >
              <Plus aria-hidden className="size-4" />
              Nueva cotización
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/cotizaciones"
          className={
            !estado
              ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
              : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
          }
        >
          Todas
        </Link>
        {ESTADOS.map((o) => (
          <Link
            key={o.valor}
            href={`/cotizaciones?estado=${o.valor}`}
            className={
              estado === o.valor
                ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
                : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
            }
          >
            {o.etiqueta}
          </Link>
        ))}
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Número</TH>
              <TH>Cliente</TH>
              <TH>Trabajo</TH>
              <TH>Emisión</TH>
              <TH>Vigencia</TH>
              <TH>Estado</TH>
              <TH className="text-right">Total</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {cotizaciones.length === 0 ? (
              <SinDatos
                colSpan={7}
                titulo={estado ? 'Sin cotizaciones en ese estado' : 'Aún no hay cotizaciones'}
                descripcion="Elabora una cotización para presentarle el precio al cliente."
              />
            ) : (
              cotizaciones.map((c) => {
                const est = definir(ESTADO_COTIZACION, c.estado)
                const cliente = c.cliente as unknown as { razon_social: string }
                const unidad = c.unidad as unknown as { placa: string } | null
                const carroceria = c.tipo_carroceria as unknown as { nombre: string } | null
                const dias = diasHasta(c.fecha_vencimiento)
                const vigente = c.estado === 'ENVIADA' || c.estado === 'BORRADOR'

                return (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/cotizaciones/${c.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {c.numero}
                      </Link>
                    </TD>
                    <TD className="max-w-48 truncate">{cliente.razon_social}</TD>
                    <TD className="text-texto-suave">
                      {carroceria?.nombre ?? '—'}
                      {unidad && <span className="tabular"> · {unidad.placa}</span>}
                    </TD>
                    <TD className="whitespace-nowrap">{fecha(c.fecha_emision)}</TD>
                    <TD className="whitespace-nowrap">
                      {fecha(c.fecha_vencimiento)}
                      {vigente && dias !== null && dias < 0 && (
                        <p className="text-[11px] text-peligro">vencida</p>
                      )}
                      {vigente && dias !== null && dias >= 0 && dias <= 3 && (
                        <p className="text-[11px] text-aviso">
                          vence en {dias === 0 ? 'hoy' : `${dias} d`}
                        </p>
                      )}
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
