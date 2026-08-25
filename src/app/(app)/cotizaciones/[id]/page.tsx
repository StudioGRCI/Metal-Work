import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir } from '@/lib/dominio/estados'
import { fecha, moneda, porcentaje } from '@/lib/format'
import { obtenerCotizacion, partidasDeCotizacion } from '@/lib/datos/comercial'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { CodigoMoneda } from '@/lib/format'

import { AccionesCotizacion } from './acciones-cotizacion'
import { Partidas } from './partidas'

export async function generateMetadata({
  params,
}: PageProps<'/cotizaciones/[id]'>): Promise<Metadata> {
  const { id } = await params
  const cotizacion = await obtenerCotizacion(id)
  return { title: cotizacion ? `Cotización ${cotizacion.numero}` : 'Cotización no encontrada' }
}

export default async function PaginaCotizacion({ params }: PageProps<'/cotizaciones/[id]'>) {
  const perfil = await exigirPermiso('cotizaciones.ver')
  const { id } = await params

  const cotizacion = await obtenerCotizacion(id)
  if (!cotizacion) notFound()

  const [partidas, catalogos] = await Promise.all([
    partidasDeCotizacion(id),
    puede(perfil, 'ordenes.crear') ? catalogosOrden() : Promise.resolve(null),
  ])

  // Si esta cotización ya generó una orden, se enlaza en lugar de ofrecer crearla otra vez.
  const supabase = await createClient()
  const { data: orden } = await supabase
    .from('ordenes_trabajo')
    .select('id, numero')
    .eq('cotizacion_id', id)
    .maybeSingle()

  const estado = definir(ESTADO_COTIZACION, cotizacion.estado)
  const mon = (cotizacion.moneda ?? 'PEN') as CodigoMoneda
  const cliente = cotizacion.cliente as unknown as { id: string; razon_social: string; numero_documento: string }
  const unidad = cotizacion.unidad as unknown as { placa: string; marca: string | null } | null
  const carroceria = cotizacion.tipo_carroceria as unknown as { nombre: string } | null
  const vendedor = cotizacion.vendedor as unknown as { nombres: string; apellidos: string } | null
  const editable = cotizacion.estado === 'BORRADOR' || cotizacion.estado === 'ENVIADA'

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Cotizaciones', ruta: '/cotizaciones' }, { titulo: cotizacion.numero }]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {cotizacion.numero}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          </span>
        }
        descripcion={
          <Link href={`/clientes/${cliente.id}`} className="hover:underline">
            {cliente.razon_social} · {cliente.numero_documento}
          </Link>
        }
        acciones={
          <AccionesCotizacion
            cotizacion={{ id: cotizacion.id, estado: cotizacion.estado }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
            sedes={catalogos?.sedes ?? []}
            ordenExistente={orden}
            tienePartidas={partidas.length > 0}
          />
        }
      />

      {cotizacion.estado === 'RECHAZADA' && cotizacion.motivo_rechazo && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Rechazada:</strong> {cotizacion.motivo_rechazo}
        </p>
      )}

      {orden && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          Esta cotización generó la orden{' '}
          <Link href={`/ordenes/${orden.id}`} className="font-medium underline">
            {orden.numero}
          </Link>
          .
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta>
          <TarjetaCabecera titulo="Datos de la cotización" />
          <TarjetaCuerpo className="space-y-0">
            <Dato etiqueta="Emisión" valor={fecha(cotizacion.fecha_emision)} />
            <Dato etiqueta="Vence" valor={fecha(cotizacion.fecha_vencimiento)} />
            <Dato etiqueta="Unidad" valor={unidad ? `${unidad.placa}${unidad.marca ? ` · ${unidad.marca}` : ''}` : null} />
            <Dato etiqueta="Carrocería" valor={carroceria?.nombre} />
            <Dato
              etiqueta="Plazo de entrega"
              valor={cotizacion.plazo_entrega_dias ? `${cotizacion.plazo_entrega_dias} días` : null}
            />
            <Dato etiqueta="Forma de pago" valor={cotizacion.forma_pago} />
            <Dato
              etiqueta="Vendedor"
              valor={vendedor ? `${vendedor.nombres} ${vendedor.apellidos}` : null}
            />
            {cotizacion.fecha_aprobacion && (
              <Dato etiqueta="Aprobada" valor={fecha(cotizacion.fecha_aprobacion)} />
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera titulo="Resumen económico" />
          <TarjetaCuerpo>
            <div className="space-y-2">
              <Linea etiqueta="Subtotal" valor={moneda(cotizacion.subtotal, mon)} />
              {Number(cotizacion.descuento ?? 0) > 0 && (
                <Linea etiqueta="Descuento" valor={`− ${moneda(cotizacion.descuento, mon)}`} />
              )}
              <Linea
                etiqueta={`IGV (${porcentaje(cotizacion.igv_porcentaje, 0)})`}
                valor={moneda(cotizacion.igv, mon)}
              />
              <div className="flex justify-between border-t border-borde pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular">{moneda(cotizacion.total, mon)}</span>
              </div>
            </div>

            {cotizacion.condiciones && (
              <div className="mt-4 border-t border-borde pt-3">
                <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">
                  Condiciones
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-texto-suave">
                  {cotizacion.condiciones}
                </p>
              </div>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <div className="lg:col-span-3">
          <Partidas
            cotizacionId={id}
            partidas={partidas}
            moneda={mon}
            editable={editable && puede(perfil, 'cotizaciones.editar')}
          />
        </div>
      </div>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm last:border-0">
      <span className="text-texto-suave">{etiqueta}</span>
      <span className="text-right font-medium text-texto">{valor || '—'}</span>
    </div>
  )
}

function Linea({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-texto-suave">{etiqueta}</span>
      <span className="tabular text-texto">{valor}</span>
    </div>
  )
}
