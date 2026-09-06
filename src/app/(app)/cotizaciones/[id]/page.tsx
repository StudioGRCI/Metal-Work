import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ChevronRight, Tag } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha, fechaHora, moneda, numero, porcentaje } from '@/lib/format'
import { cn } from '@/lib/utils'
import { obtenerCotizacion, partidasDeCotizacion } from '@/lib/datos/comercial'
import { catalogosOrden } from '@/lib/datos/ordenes'
import { pagosDeCotizacion } from '@/lib/datos/pagos'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { CodigoMoneda } from '@/lib/format'

import { AccionesCotizacion } from './acciones-cotizacion'
import { ConceptoImpreso } from './concepto-impreso'
import { EditarCotizacion } from './editar-cotizacion'
import { PagosDelCliente } from './pagos'

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

  // La ficha, los accesorios y las plantillas ya no se piden acá: son de la
  // cotización de trabajo y se cargan en su pantalla. Las partidas sí, pero
  // solo para saber si hay con qué descargar el papel —no se listan—.
  const puedeVerPagos = puede(perfil, 'pagos.ver')

  const [partidas, catalogos, pagos] = await Promise.all([
    partidasDeCotizacion(id),
    puede(perfil, 'ordenes.crear') || puede(perfil, 'cotizaciones.editar')
      ? catalogosOrden()
      : Promise.resolve(null),
    puedeVerPagos ? pagosDeCotizacion(id) : Promise.resolve(null),
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

  /*
   * Esta pantalla es la cotización de VENTA y solo eso.
   *
   * Las partidas, la ficha técnica, los accesorios, el costo y el margen son la
   * cotización de TRABAJO: los arma Administración y viven en
   * `/cotizaciones/trabajo/[id]`. Estuvieron acá escondidos con condiciones y la
   * empresa lo devolvió tres veces; la última, con el costo y el margen puestos
   * detrás de un permiso, que al administrador —que los tiene todos— no le tapa
   * nada. No queda ninguna bandera de este tipo en la página, y no vuelve: si
   * alguna vez parece hacer falta un bloque de costeo acá, la respuesta es que
   * va en la otra pantalla.
   */

  // La cabecera —cliente, unidad, condiciones y el precio— se corrige mientras
  // la cotización se está armando, y solo entonces.
  const puedeEditarCabecera =
    ['BORRADOR', 'EN_COSTEO', 'OBSERVADA'].includes(cotizacion.estado as string) &&
    puede(perfil, 'cotizaciones.editar')

  // El precio, y solo el precio. El costo y el margen se calculan y se miran en
  // la cotización de trabajo.
  const precioVenta = Number(cotizacion.precio_venta ?? 0)
  const hayPrecio = cotizacion.precio_venta !== null && precioVenta > 0

  /*
   * El tipo de cambio se congela al emitir. `tipo_cambio_vigente()` responde 1
   * cuando la tabla `tipos_cambio` está vacía —no porque el dólar valga un sol,
   * sino porque no tiene nada que responder—, así que una cotización en dólares
   * congelada en 1 es una que se emitió sin tipo de cambio cargado.
   */
  const tipoCambio = Number(cotizacion.tipo_cambio ?? 1)
  const cambioSinCargar = mon === 'USD' && tipoCambio === 1

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

      {/* El número que hace que Gerencia apruebe un precio equivocado: la
          cotización se lee bien en dólares, y todo lo que después la pasa a
          soles la lee por menos de un tercio de lo que vale. */}
      {cambioSinCargar && (
        <div
          role="alert"
          className="mb-4 rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2.5 text-sm text-aviso"
        >
          <p className="text-[11px] font-medium tracking-wide uppercase">
            El tipo de cambio no está cargado
          </p>
          <p className="mt-1">
            Esta cotización está en dólares y quedó congelada con el dólar a S/ 1.00, que es lo que
            responde la base cuando nadie cargó ninguno. Los importes de acá abajo están bien —son
            dólares—, pero todo lo que los pasa a soles sale por menos de un tercio: el presupuesto
            que esta cotización le arrastra a su orden de trabajo nace corto y el taller se lo come
            con la primera compra de material.
          </p>
          <p className="mt-1">
            Cárgalo en{' '}
            <Link href="/configuracion" className="font-medium underline">
              Configuración
            </Link>{' '}
            antes de dar el visto a este precio. Cargarlo no corrige esta cotización —cada documento
            se queda con el cambio que tenía al emitirse—: esta hay que rehacerla.
          </p>
        </div>
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
                    tipo_unidad: cotizacion.tipo_unidad,
                    capacidad: cotizacion.capacidad,
                    sede_id: cotizacion.sede_id,
                    vendedor_id: cotizacion.vendedor_id,
                    fecha_emision: cotizacion.fecha_emision,
                    validez_dias: cotizacion.validez_dias,
                    garantia_meses: cotizacion.garantia_meses,
                    moneda: cotizacion.moneda,
                    plazo_entrega_dias: cotizacion.plazo_entrega_dias,
                    plazo_desde: cotizacion.plazo_desde,
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
            {/* Solo el precio. El costo estimado y el margen son cifras de
                costeo y estaban acá detrás de un permiso, que es la condición que
                la empresa ya mandó quitar dos veces: al administrador —que tiene
                todos los permisos— la cotización de venta le enseñaba lo que
                cuesta el acero y cuánto se gana, en la pantalla del vendedor.
                Viven en la cotización de trabajo, junto a las partidas de las
                que salen. */}
            <div className="mb-3 grid gap-2">
              <Indicador
                titulo="Precio de venta"
                icono={Tag}
                tono="acento"
                valor={hayPrecio ? moneda(precioVenta, mon) : '—'}
                pie={hayPrecio ? 'Lo que se le ofrece al cliente' : 'Ventas todavía no lo puso'}
              />
            </div>

            <Dato etiqueta="Emisión" valor={fecha(cotizacion.fecha_emision)} />
            <Dato etiqueta="Vence" valor={fecha(cotizacion.fecha_vencimiento)} />
            <Dato etiqueta="Unidad" valor={textoUnidad} />
            <Dato etiqueta="Carrocería" valor={carroceria?.nombre} />
            <Dato
              etiqueta="Plazo de entrega"
              valor={cotizacion.plazo_entrega_dias ? `${cotizacion.plazo_entrega_dias} días` : null}
            />
            {/* Solo cuando es en dólares: en soles vale siempre 1 y gastar un
                renglón en eso es ruido. Es el número con el que se pasa a soles
                todo lo de arriba, y hasta ahora no se veía en ninguna pantalla. */}
            {mon === 'USD' && (
              <Dato
                etiqueta="Tipo de cambio"
                valor={
                  cambioSinCargar
                    ? 'S/ 1.000 por dólar — sin cargar'
                    : `S/ ${numero(tipoCambio, 3)} por dólar`
                }
              />
            )}
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


        {/* Los pagos van en la cotización y no en la orden porque el adelanto
            llega antes de que la orden exista: es lo que hace que se emita. Y
            porque es acá donde está el precio contra el que se cuentan. */}
        {puedeVerPagos && (
          <div className="lg:col-span-3">
            <PagosDelCliente
              cotizacionId={id}
              pagos={pagos?.pagos ?? []}
              resumen={pagos?.resumen ?? null}
              puedeRegistrar={puede(perfil, 'pagos.registrar')}
            />
          </div>
        )}

        {/* En vez de los bloques de trabajo: dónde está la cotización y quién
            la tiene. Al vendedor le basta con eso; el detalle es de la otra
            pantalla y de la otra gente. */}
        <div className="lg:col-span-3">
          <EnEsperaDe estado={cotizacion.estado} />
        </div>
      </div>
    </>
  )
}

/**
 * Qué le está pasando a la cotización mientras no está en manos de Ventas.
 *
 * La cotización de venta no muestra partidas, ficha ni accesorios en ningún
 * estado: son la cotización de trabajo, la arma Administración y vive en su
 * propia pantalla. Acá solo se dice en qué punto va, que es lo que el vendedor
 * necesita para contestarle al cliente.
 */
function EnEsperaDe({ estado }: { estado: string }) {
  const QUE_PASA: Record<string, { titulo: string; detalle: string }> = {
    BORRADOR: {
      titulo: 'En ventas',
      detalle:
        'Escribe el concepto, pon el precio y pásala a cotización de trabajo para que Administración la costee.',
    },
    EN_COSTEO: {
      titulo: 'En espera de costeo',
      detalle:
        'Administración está armando la cotización de trabajo: las partidas, la ficha técnica y los accesorios. Cuando termine, pasa a Gerencia.',
    },
    EN_REVISION: {
      titulo: 'Con Gerencia',
      detalle: 'Administración terminó el costeo y Gerencia la está revisando.',
    },
    OBSERVADA: {
      titulo: 'Devuelta por Gerencia',
      detalle: 'Volvió con observaciones. Administración la corrige y la sube otra vez.',
    },
    REVISADA: {
      titulo: 'Lista para enviar',
      detalle: 'Gerencia dio el visto. Ya se puede descargar el papel y mandárselo al cliente.',
    },
    ENVIADA: {
      titulo: 'Con el cliente',
      detalle: 'Se le envió y todavía no contesta.',
    },
  }

  const que = QUE_PASA[estado]
  if (!que) return null

  // Solo dice en qué punto va. El botón que abría la cotización de trabajo se
  // fue: desde la pantalla de Ventas no se entra al costeo, ni siquiera con
  // permiso. Quien costea llega por su propia entrada del menú.
  return (
    <Tarjeta>
      <TarjetaCabecera titulo={que.titulo} descripcion={que.detalle} />
    </Tarjeta>
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
