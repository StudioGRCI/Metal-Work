import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { obtenerCotizacion, partidasDeCotizacion } from '@/lib/datos/comercial'
import {
  accesoriosDeCotizacion,
  fichaDeCotizacion,
  plantillasDisponibles,
} from '@/lib/datos/ficha'
import { fecha, moneda, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { FichaTecnica } from '../../[id]/ficha-tecnica'
import { Partidas } from '../../[id]/partidas'

export async function generateMetadata({
  params,
}: PageProps<'/cotizaciones/trabajo/[id]'>): Promise<Metadata> {
  const { id } = await params
  const cotizacion = await obtenerCotizacion(id)
  return {
    title: cotizacion ? `Cotización de trabajo ${cotizacion.numero}` : 'Cotización no encontrada',
  }
}

/**
 * La cotización de trabajo: lo que Administración arma para poder comprar el
 * material y programar el taller.
 *
 * Tiene pantalla propia y no es una sección de la cotización de venta. Se
 * intentó lo segundo dos veces —los mismos bloques en la misma página,
 * escondidos con condiciones— y las dos veces la empresa lo devolvió: son dos
 * documentos, los hace gente distinta y el vendedor no tiene por qué ver el
 * costo del acero. Una condición se olvida en el siguiente cambio de estado;
 * una ruta distinta, no.
 *
 * De la venta se muestra solo lo que hace falta para costear —a quién, qué y a
 * qué precio se ofreció— y en modo lectura.
 */
export default async function PaginaCotizacionDeTrabajo({
  params,
}: PageProps<'/cotizaciones/trabajo/[id]'>) {
  // Entrar acá es entrar a la cotización de trabajo: hace falta poder costear o
  // poder revisar. Con `cotizaciones.ver` a secas se vería el costo del material
  // desde Ventas, que es justo lo que se quiso separar.
  const perfil = await exigirPermiso(['cotizaciones.costear', 'cotizaciones.revisar'])
  const { id } = await params

  const cotizacion = await obtenerCotizacion(id)
  if (!cotizacion) notFound()

  const [partidas, ficha, accesorios, plantillas] = await Promise.all([
    partidasDeCotizacion(id),
    fichaDeCotizacion(id),
    accesoriosDeCotizacion(id),
    plantillasDisponibles(cotizacion.tipo_carroceria_id),
  ])

  const estado = definir(ESTADO_COTIZACION, cotizacion.estado)
  const mon = (cotizacion.moneda ?? 'PEN') as CodigoMoneda
  const cliente = cotizacion.cliente as unknown as { razon_social: string } | null
  const unidad = cotizacion.unidad as unknown as
    | { placa: string | null; marca: string | null; modelo: string | null }
    | null
  const carroceria = cotizacion.tipo_carroceria as unknown as { nombre: string } | null

  // Se costea mientras está en costeo o devuelta. Después del visto de Gerencia
  // no se toca: para cambiar una partida hay que devolverla. Lo defiende la
  // base; acá solo se cuenta.
  const puedeCostear =
    ['EN_COSTEO', 'OBSERVADA'].includes(cotizacion.estado as string) &&
    puede(perfil, 'cotizaciones.costear')

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Cotización de trabajo', ruta: '/cotizaciones/trabajo' },
          { titulo: cotizacion.numero },
        ]}
        titulo={`Cotización de trabajo ${cotizacion.numero}`}
        descripcion={cliente?.razon_social ?? undefined}
        acciones={
          <div className="flex items-center gap-2">
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            <EnlaceBoton href={`/cotizaciones/${id}`} variante="secundario">
              Ver la cotización de venta
            </EnlaceBoton>
          </div>
        }
      />

      {/* Lo que Ventas decidió, en lectura. Está acá para no obligar a saltar de
          pantalla a mirar sobre qué se costea, y no se edita: el precio y el
          concepto son de Ventas. */}
      <Tarjeta className="mb-4">
        <TarjetaCabecera
          titulo="Lo que se ofreció"
          descripcion="Lo escribió Ventas. Acá se mira, se cambia en la cotización de venta."
        />
        <TarjetaCuerpo className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          <Dato etiqueta="Trabajo" valor={cotizacion.concepto ?? carroceria?.nombre} />
          <Dato etiqueta="Unidad" valor={unidad ? nombreDeUnidad(unidad) : null} />
          <Dato
            etiqueta="Precio ofrecido"
            valor={
              cotizacion.precio_venta !== null
                ? moneda(Number(cotizacion.precio_venta), mon)
                : null
            }
          />
          <Dato etiqueta="Entrega" valor={fecha(cotizacion.fecha_vencimiento)} />
        </TarjetaCuerpo>
      </Tarjeta>

      <div className="space-y-4">
        <Partidas cotizacionId={id} partidas={partidas} moneda={mon} editable={puedeCostear} />

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
            garantia_texto: cotizacion.garantia_texto,
            peso_tolerancia: cotizacion.peso_tolerancia,
            no_incluye: cotizacion.no_incluye,
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
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-texto-tenue uppercase">{etiqueta}</p>
      <p className="text-sm text-texto">{valor || '—'}</p>
    </div>
  )
}
