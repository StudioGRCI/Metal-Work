import Link from 'next/link'
import { Plus } from 'lucide-react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_COTIZACION, ORDEN_ESTADO_COTIZACION, definir, opciones } from '@/lib/dominio/estados'
import { diasHasta, fecha, moneda } from '@/lib/format'
import { estadosQueMeTocan, listarCotizaciones } from '@/lib/datos/comercial'
import { exigirPermiso, puede } from '@/lib/sesion'
import type { CodigoMoneda } from '@/lib/format'

export const metadata = { title: 'Cotizaciones' }

// Las pastillas de estado salen del mismo mapa con el que se pinta la insignia
// de cada fila, en el orden en que ocurre el circuito y no en el del enum: quien
// mira la bandeja lee de arriba abajo el camino que recorre el papel.
const FILTROS_ESTADO = opciones(ESTADO_COTIZACION, ORDEN_ESTADO_COTIZACION)

/**
 * De quién es la pelota en cada estado. La insignia dice dónde está parada la
 * cotización; esto dice a quién hay que ir a buscar, que es justo lo que la
 * lista no contaba. Los estados cerrados no salen: ahí ya no le toca a nadie.
 */
const LE_TOCA_A: Record<string, string> = {
  BORRADOR: 'le toca a Ventas',
  EN_COSTEO: 'le toca a Administración',
  EN_REVISION: 'le toca a Gerencia',
  OBSERVADA: 'vuelve a Ventas o Administración',
  REVISADA: 'Ventas la manda al cliente',
  ENVIADA: 'espera respuesta del cliente',
}

/**
 * Desde cuándo lleva esperando en la etapa donde está.
 *
 * Solo tres estados tienen sello propio. En «En ventas» y en «Devuelta» la base
 * no guarda cuándo entró —no hay columna de cuándo la devolvió Gerencia— y se
 * prefiere una raya antes que un número inventado: un dato de espera equivocado
 * es peor que ninguno, porque se usa para ir a reclamar.
 */
function esperandoDesde(cotizacion: {
  estado: string
  costeo_pedido_en: string | null
  costeo_listo_en: string | null
  revisada_en: string | null
}) {
  if (cotizacion.estado === 'EN_COSTEO') return cotizacion.costeo_pedido_en
  if (cotizacion.estado === 'EN_REVISION') return cotizacion.costeo_listo_en
  if (cotizacion.estado === 'REVISADA') return cotizacion.revisada_en
  return null
}

/** Los días parados en esta etapa, con el tono que ya merece la espera. */
function espera(desde: string | null) {
  const restantes = diasHasta(desde)
  if (restantes === null) return null

  const dias = Math.max(0, -restantes)
  return {
    texto: dias === 0 ? 'hoy' : `${dias} ${dias === 1 ? 'día' : 'días'}`,
    // Un par de días es el trámite normal; de tres para arriba es una
    // cotización olvidada, y a la semana ya se le pasó el turno al cliente.
    clase: dias >= 7 ? 'text-peligro' : dias >= 3 ? 'text-aviso' : 'text-texto-suave',
  }
}

/**
 * Qué dice la tabla cuando no sale ninguna fila. Son tres vacíos distintos y el
 * siguiente paso de cada uno también: la bandeja vacía es una buena noticia, el
 * filtro vacío se arregla soltando el filtro, y la lista vacía de verdad se
 * arregla dando de alta la primera.
 */
function estadoVacio(mio: boolean, hayFiltro: boolean) {
  if (mio) {
    return {
      titulo: 'No tienes nada pendiente',
      descripcion: 'Ninguna cotización está esperando por ti en este momento.',
    }
  }
  if (hayFiltro) {
    return {
      titulo: 'Con este filtro no sale ninguna',
      descripcion: 'Prueba con otro estado, con otra búsqueda, o mira todas las cotizaciones.',
    }
  }
  return {
    titulo: 'Aún no hay cotizaciones',
    descripcion: 'Elabora la primera para presentarle el precio al cliente.',
  }
}

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

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  // «Me toca a mí» y un estado suelto se pisan: la pastilla que se pulsa apaga
  // la clave de la otra, y si alguien llega con las dos escritas en la URL manda
  // la bandeja, que es la pregunta más concreta de las dos.
  const mio = params.mio === '1'
  const estado = !mio && typeof params.estado === 'string' ? params.estado : undefined

  const cotizaciones = await listarCotizaciones({ estado, busqueda, meToca: mio, perfil })
  const puedeCrear = puede(perfil, 'cotizaciones.crear')
  const hayFiltro = Boolean(estado || mio || busqueda)
  const vacio = estadoVacio(mio, hayFiltro)

  // La bandeja solo se le ofrece a quien tiene alguna mano en el circuito; al
  // que únicamente mira no le devolvería ninguna fila. Qué estados son los suyos
  // lo decide la consulta, no esta pantalla.
  const tieneBandeja = estadosQueMeTocan(perfil).length > 0

  const filtros = [
    { valor: null, etiqueta: 'Todas' },
    ...(tieneBandeja ? [{ valor: '1', etiqueta: 'Me toca a mí', clave: 'mio' }] : []),
    ...FILTROS_ESTADO,
  ]

  return (
    <>
      <EncabezadoPagina
        titulo="Cotizaciones"
        descripcion="Ventas pone el precio, Administración arma el costeo y Gerencia da el visto antes de que el papel salga al cliente."
        acciones={
          puedeCrear && (
            <EnlaceBoton href="/cotizaciones/nueva">
              <Plus aria-hidden className="size-4" />
              Nueva cotización
            </EnlaceBoton>
          )
        }
      />

      <BuscadorSimple
        ruta="/cotizaciones"
        etiqueta="Buscar cotizaciones"
        marcador="Buscar por número, cliente o placa"
      />

      <PastillaFiltro
        ruta="/cotizaciones"
        clave="estado"
        opciones={filtros}
        params={params}
        activo={mio ? '1' : (estado ?? null)}
        etiqueta="Filtrar por estado"
        className="my-4"
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
              {/* La espera aparece un tramo más tarde que las otras: es la
                  columna nueva y no vale que empuje al Total fuera de la hoja.
                  Hasta ese ancho el dato viaja pegado al estado. */}
              <TH className="hidden md:table-cell">Esperando</TH>
              <TH className="text-right">Total</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {cotizaciones.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={vacio.titulo}
                descripcion={vacio.descripcion}
                accion={
                  hayFiltro ? (
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
                const desde = esperandoDesde(c)
                const parada = espera(desde)
                const mano = LE_TOCA_A[c.estado]

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
                      {/* La insignia dice dónde está; esta línea, de quién es la
                          pelota. Debajo del ancho en que aparece la columna de
                          espera, los días viajan acá pegados al responsable. */}
                      {(mano || parada) && (
                        <p className="mt-0.5 text-[11px] text-texto-suave">
                          {mano}
                          {parada && (
                            <span className={`md:hidden ${parada.clase}`}>
                              {mano ? ' · ' : ''}
                              {parada.texto}
                            </span>
                          )}
                        </p>
                      )}
                    </TD>
                    <TD className="hidden whitespace-nowrap md:table-cell">
                      {parada ? (
                        <>
                          <span className={`tabular ${parada.clase}`}>{parada.texto}</span>
                          <p className="text-[11px] text-texto-tenue">desde {fecha(desde)}</p>
                        </>
                      ) : (
                        <span className="text-texto-tenue">—</span>
                      )}
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
