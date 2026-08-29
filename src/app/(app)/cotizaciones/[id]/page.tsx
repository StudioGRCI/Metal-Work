import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ChevronRight, Percent, Tag, Wallet } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador, type TonoIndicador } from '@/components/ui/indicador'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha, fechaHora, moneda, porcentaje } from '@/lib/format'
import { cn } from '@/lib/utils'
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
  const unidad = cotizacion.unidad as unknown as
    | { id: string; placa: string | null; marca: string | null; modelo: string | null }
    | null
  const carroceria = cotizacion.tipo_carroceria as unknown as { nombre: string } | null
  const vendedor = cotizacion.vendedor as unknown as { nombres: string; apellidos: string } | null
  const anulador = cotizacion.anulador as unknown as { nombres: string; apellidos: string } | null

  /*
   * Una sola bandera «editable» metía en la misma mano dos trabajos distintos.
   * Son dos:
   *
   * · Ventas escribe el concepto y pone el precio mientras la cotización está
   *   en sus manos —en ventas o devuelta—;
   * · Administración arma la cotización de trabajo —partidas, ficha técnica y
   *   accesorios— mientras está en costeo o devuelta.
   *
   * Desde que Gerencia da el visto no se toca nada: para cambiar una partida
   * hay que devolverla a costeo. Eso lo defiende la base; acá se cuenta.
   */
  const puedeVender =
    ['BORRADOR', 'OBSERVADA'].includes(cotizacion.estado as string) &&
    puede(perfil, 'cotizaciones.editar')

  const puedeCostear =
    ['EN_COSTEO', 'OBSERVADA'].includes(cotizacion.estado as string) &&
    puede(perfil, 'cotizaciones.costear')

  // La cabecera —cliente, unidad, condiciones y el precio— se corrige mientras
  // la cotización se está armando, y solo entonces.
  const puedeEditarCabecera =
    ['BORRADOR', 'EN_COSTEO', 'OBSERVADA'].includes(cotizacion.estado as string) &&
    puede(perfil, 'cotizaciones.editar')

  // El costo estimado y el margen son la cifra con la que Gerencia decide: los
  // ve quien tiene costos, no cualquiera que pueda abrir la cotización.
  const verCostos = puede(perfil, 'costos.ver')
  const precioVenta = Number(cotizacion.precio_venta ?? 0)
  const costoEstimado = Number(cotizacion.costo_estimado ?? 0)
  const hayPrecio = cotizacion.precio_venta !== null && precioVenta > 0
  const margen = precioVenta - costoEstimado

  // Lo que se imprime cuando nadie escribió el concepto: es de donde salía la
  // descripción antes de que el campo existiera.
  const sugerenciaConcepto =
    [carroceria?.nombre, cotizacion.capacidad].filter(Boolean).join(' · ') || 'Trabajo cotizado'

  // Cómo se nombra la unidad en la ficha: la placa cuando la tiene y, mientras
  // no llega, lo que la identifique. La marca solo se agrega si el nombre no la
  // trae ya, y se dice «sin placa» para que un código interno no se lea como
  // matrícula.
  const nombreUnidad = unidad ? nombreDeUnidad(unidad) : null
  const textoUnidad = nombreUnidad
    ? [
        nombreUnidad,
        unidad?.marca && !nombreUnidad.includes(unidad.marca) ? unidad.marca : null,
        todaviaSinPlaca(unidad) && !nombreUnidad.includes('sin placa') ? 'sin placa' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null

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

      <BarraCircuito estado={cotizacion.estado} />

      {/* Lo primero que se lee cuando volvió devuelta: sin esto, quien la abre
          ve «Devuelta» y no tiene forma de saber qué hay que corregir. */}
      {cotizacion.estado === 'OBSERVADA' && (
        <div className="mb-4 rounded-[var(--radius-base)] border border-peligro bg-peligro-suave px-3 py-2.5 text-sm text-peligro">
          <p className="text-[11px] font-medium tracking-wide uppercase">
            Gerencia la devolvió · hay que corregir
          </p>
          <p className="mt-1 whitespace-pre-wrap">
            {cotizacion.motivo_observacion || 'Sin observación escrita.'}
          </p>
        </div>
      )}

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
              puedeEditarCabecera && catalogos ? (
                <EditarCotizacion
                  catalogos={catalogos}
                  unidadActual={
                    cotizacion.unidad_id && unidad
                      ? { id: cotizacion.unidad_id, placa: nombreDeUnidad(unidad) }
                      : null
                  }
                  cotizacion={{
                    id: cotizacion.id,
                    cliente_id: cotizacion.cliente_id,
                    precio_venta: cotizacion.precio_venta,
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
            {/* El precio y lo que deja son lo primero que mira Gerencia antes de
                dar el visto; el resto de la ficha viene después.

                Las columnas se abren en la tableta —donde la tarjeta ocupa todo
                el ancho— y vuelven a abrirse en el monitor grande; entre medio
                la tarjeta es un tercio de la pantalla y tres cifras al lado no
                entran sin partirse. */}
            <div className={cn('mb-3 grid gap-2', verCostos && 'sm:grid-cols-2 xl:grid-cols-3')}>
              <Indicador
                titulo="Precio de venta"
                icono={Tag}
                tono="acento"
                valor={hayPrecio ? moneda(precioVenta, mon) : '—'}
                pie={hayPrecio ? 'Lo que se le ofrece al cliente' : 'Ventas todavía no lo puso'}
              />

              {verCostos && (
                <Indicador
                  titulo="Costo estimado"
                  icono={Wallet}
                  valor={moneda(costoEstimado, mon)}
                  pie="Suma de las partidas"
                />
              )}

              {verCostos && (
                <Indicador
                  titulo="Margen"
                  icono={Percent}
                  tono={margenTono(hayPrecio, margen)}
                  valor={hayPrecio ? moneda(margen, mon) : '—'}
                  pie={
                    hayPrecio
                      ? `${porcentaje((margen / precioVenta) * 100, 1)} del precio`
                      : 'Sin precio no hay margen que medir'
                  }
                />
              )}
            </div>

            <Dato etiqueta="Emisión" valor={fecha(cotizacion.fecha_emision)} />
            <Dato etiqueta="Vence" valor={fecha(cotizacion.fecha_vencimiento)} />
            <Dato etiqueta="Unidad" valor={textoUnidad} />
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
            editable={puedeVender}
          />
        </div>

        {/* Las partidas son la cotización de trabajo: con ellas se compra el
            material y se programa el taller. Las arma Administración. */}
        <div className="lg:col-span-3">
          <Partidas cotizacionId={id} partidas={partidas} moneda={mon} editable={puedeCostear} />
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
            puedeEditar={puedeCostear}
          />
        </div>
      </div>
    </>
  )
}

/** Las tres manos por las que pasa una cotización, más el cliente al final. */
const CIRCUITO = ['Ventas', 'Costeo', 'Gerencia', 'Cliente'] as const

/**
 * En qué punto del circuito está cada estado. Los que no figuran —anulada,
 * rechazada— salieron del circuito y no se pintan: para esos ya hay un aviso
 * que cuenta lo que pasó.
 */
const PASO_DEL_ESTADO: Record<string, number> = {
  BORRADOR: 0,
  EN_COSTEO: 1,
  OBSERVADA: 1,
  EN_REVISION: 2,
  REVISADA: 3,
  ENVIADA: 3,
  APROBADA: 3,
  VENCIDA: 3,
}

/** A quién le toca mover y qué tiene que hacer, dicho sin rodeos. */
const LE_TOCA: Record<string, string> = {
  BORRADOR: 'Le toca a Ventas: escribir el concepto, poner el precio y pasarla a cotización de trabajo.',
  EN_COSTEO: 'Le toca a Administración: armar las partidas, la ficha técnica y los accesorios.',
  EN_REVISION: 'Le toca a Gerencia: dar el visto o devolverla con lo que hay que corregir.',
  OBSERVADA: 'Le toca a Administración: corregir lo observado y volver a subirla a Gerencia.',
  REVISADA: 'Le toca a Ventas: descargar el papel y mandárselo al cliente.',
  ENVIADA: 'Le toca al cliente: el papel ya salió; queda anotar qué contestó.',
  APROBADA: 'Le toca a Administración: abrir la orden de trabajo.',
  VENCIDA: 'Le toca a Ventas: se pasó la validez, hay que reenviarla o dejarla.',
}

/**
 * La barra de arriba: en qué mano está la cotización y a quién le toca.
 *
 * Cotizar son tres actos —Ventas escribe y pone el precio, Administración arma
 * la cotización de trabajo, Gerencia da el visto— y hasta ayer la pantalla los
 * metía en uno solo: quien la abría veía una insignia y no sabía si le tocaba
 * mover a él o estaba esperando a otro.
 */
function BarraCircuito({ estado }: { estado: string }) {
  const paso = PASO_DEL_ESTADO[estado]
  if (paso === undefined) return null

  return (
    <div className="mb-4 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2.5">
      <ol aria-label="Circuito de la cotización" className="flex flex-wrap items-center gap-1">
        {CIRCUITO.map((etapa, i) => (
          <li key={etapa} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3 text-texto-tenue" />}
            {/* La etapa puesta se reconoce por el fondo, como las pastillas de
                los filtros; las ya pasadas quedan legibles y las que faltan,
                apagadas. El alto es de dedo en el teléfono. */}
            <span
              aria-current={i === paso ? 'step' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-[var(--radius-base)] px-2.5 text-sm whitespace-nowrap sm:h-7 sm:min-h-0',
                i === paso && 'bg-acento-suave font-medium text-acento',
                i < paso && 'text-texto-suave',
                i > paso && 'text-texto-tenue',
              )}
            >
              {etapa}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-1 px-0.5 text-sm text-texto-suave">{LE_TOCA[estado]}</p>
    </div>
  )
}

/**
 * El margen no es un adorno: si el costo se comió el precio, Gerencia tiene que
 * verlo antes de dar el visto, no después de fabricar.
 */
function margenTono(hayPrecio: boolean, margen: number): TonoIndicador {
  if (!hayPrecio) return 'neutro'
  if (margen <= 0) return 'peligro'
  return 'exito'
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
