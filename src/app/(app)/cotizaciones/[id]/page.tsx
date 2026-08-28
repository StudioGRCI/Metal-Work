import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir } from '@/lib/dominio/estados'
import { fecha, fechaHora, moneda, porcentaje } from '@/lib/format'
import { obtenerCotizacion, partidasDeCotizacion } from '@/lib/datos/comercial'
import {
  accesoriosDeCotizacion,
  fichaDeCotizacion,
  plantillasDisponibles,
} from '@/lib/datos/ficha'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { CodigoMoneda } from '@/lib/format'

import { AccionesCotizacion } from './acciones-cotizacion'
import { ConceptoImpreso } from './concepto-impreso'
import { EditarCotizacion } from './editar-cotizacion'
import { FichaTecnica } from './ficha-tecnica'
import { Partidas } from './partidas'

export async function generateMetadata({
  params,
}: PageProps<'/cotizaciones/[id]'>): Promise<Metadata> {
  const { id } = await params
  const cotizacion = await obtenerCotizacion(id)
  return { title: cotizacion ? `Cotización ${cotizacion.numero}` : 'Cotización no encontrada' }
}

export default async function PaginaCotizacion({
  params,
  searchParams,
}: PageProps<'/cotizaciones/[id]'>) {
  const perfil = await exigirPermiso('cotizaciones.ver')
  const { id } = await params

  // La ruta del PDF devuelve aquí con el motivo cuando no hay papel que
  // entregar: un enlace de descarga que falla no muestra nada por sí solo.
  const { aviso } = await searchParams

  const cotizacion = await obtenerCotizacion(id)
  if (!cotizacion) notFound()

  const [partidas, catalogos, ficha, accesorios, plantillas] = await Promise.all([
    partidasDeCotizacion(id),
    puede(perfil, 'ordenes.crear') || puede(perfil, 'cotizaciones.editar')
      ? catalogosOrden()
      : Promise.resolve(null),
    fichaDeCotizacion(id),
    accesoriosDeCotizacion(id),
    plantillasDisponibles(cotizacion.tipo_carroceria_id),
  ])

  // La ficha se edita mientras la cotización no esté cerrada: una aprobada es
  // lo que el cliente aceptó, y cambiarla por detrás sería otra cosa.
  const editaFicha =
    puede(perfil, 'cotizaciones.editar') &&
    ['BORRADOR', 'ENVIADA'].includes(cotizacion.estado as string)

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
  const anulador = cotizacion.anulador as unknown as { nombres: string; apellidos: string } | null
  const editable = cotizacion.estado === 'BORRADOR' || cotizacion.estado === 'ENVIADA'

  // Lo que se imprime cuando nadie escribió el concepto: es de donde salía la
  // descripción antes de que el campo existiera.
  const sugerenciaConcepto =
    [carroceria?.nombre, cotizacion.capacidad].filter(Boolean).join(' · ') || 'Trabajo cotizado'

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
          // El nombre del cliente lleva a su ficha; en el teléfono se marca con
          // el dedo, así que el enlace ocupa 44 px de alto.
          <Link
            href={`/clientes/${cliente.id}`}
            className="inline-flex min-h-11 items-center hover:underline sm:min-h-0"
          >
            {cliente.razon_social} · {cliente.numero_documento}
          </Link>
        }
        acciones={
          <AccionesCotizacion
            cotizacion={{ id: cotizacion.id, estado: cotizacion.estado, numero: cotizacion.numero }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
            sedes={catalogos?.sedes ?? []}
            ordenExistente={orden}
            tienePartidas={partidas.length > 0}
          />
        }
      />

      {typeof aviso === 'string' && aviso && (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso"
        >
          {aviso}
        </p>
      )}

      {cotizacion.estado === 'RECHAZADA' && cotizacion.motivo_rechazo && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Rechazada:</strong> {cotizacion.motivo_rechazo}
        </p>
      )}

      {/* La anulada se conserva y cuenta su historia: sin esto, el número
          desaparecido de la serie no lo explica nadie. */}
      {cotizacion.estado === 'ANULADA' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Anulada:</strong> {cotizacion.motivo_anulacion || 'sin motivo registrado'}
          {anulador && ` · ${anulador.nombres} ${anulador.apellidos}`}
          {cotizacion.anulada_en && ` · ${fechaHora(cotizacion.anulada_en)}`}
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
          <TarjetaCabecera
            titulo="Datos de la cotización"
            acciones={
              editable && puede(perfil, 'cotizaciones.editar') && catalogos ? (
                <EditarCotizacion
                  catalogos={catalogos}
                  unidadActual={
                    cotizacion.unidad_id && unidad
                      ? { id: cotizacion.unidad_id, placa: unidad.placa }
                      : null
                  }
                  cotizacion={{
                    id: cotizacion.id,
                    cliente_id: cotizacion.cliente_id,
                    unidad_id: cotizacion.unidad_id,
                    tipo_carroceria_id: cotizacion.tipo_carroceria_id,
                    sede_id: cotizacion.sede_id,
                    fecha_emision: cotizacion.fecha_emision,
                    validez_dias: cotizacion.validez_dias,
                    moneda: cotizacion.moneda,
                    plazo_entrega_dias: cotizacion.plazo_entrega_dias,
                    forma_pago: cotizacion.forma_pago,
                    condiciones: cotizacion.condiciones,
                    observaciones: cotizacion.observaciones,
                  }}
                />
              ) : null
            }
          />
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
          <ConceptoImpreso
            cotizacionId={id}
            concepto={cotizacion.concepto}
            cantidad={Number(cotizacion.concepto_cantidad ?? 1)}
            unidad={cotizacion.concepto_unidad ?? 'UND'}
            total={Number(cotizacion.total ?? 0)}
            moneda={mon}
            sugerencia={sugerenciaConcepto}
            editable={editable && puede(perfil, 'cotizaciones.editar')}
          />
        </div>

        <div className="lg:col-span-3">
          <Partidas
            cotizacionId={id}
            partidas={partidas}
            moneda={mon}
            editable={editable && puede(perfil, 'cotizaciones.editar')}
          />
        </div>

        {/* La ficha técnica es el cuerpo de la cotización de esta empresa: es
            lo que el taller fabrica y contra lo que el cliente reclama. */}
        <div className="lg:col-span-3">
          <FichaTecnica
            cotizacionId={id}
            cabecera={{
              modelo: cotizacion.modelo,
              tipo: cotizacion.tipo,
              largo_m: cotizacion.largo_m,
              ancho_m: cotizacion.ancho_m,
              alto_m: cotizacion.alto_m,
              capacidad: cotizacion.capacidad,
              peso_neto_tn: cotizacion.peso_neto_tn,
              garantia_meses: cotizacion.garantia_meses,
              incluye_igv: cotizacion.incluye_igv,
              plazo_en_habiles: cotizacion.plazo_en_habiles,
              plazo_entrega_dias: cotizacion.plazo_entrega_dias,
              nota: cotizacion.nota,
            }}
            secciones={ficha}
            accesorios={accesorios}
            plantillas={plantillas}
            puedeEditar={editaFicha}
          />
        </div>
      </div>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm last:border-0">
      {/* El rótulo no se parte: en el teléfono, una forma de pago larga lo
          dejaba en tres líneas de una palabra cada una. */}
      <span className="shrink-0 text-texto-suave">{etiqueta}</span>
      <span className="text-right font-medium wrap-break-word text-texto">{valor || '—'}</span>
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
