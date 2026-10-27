import { Download, FileText, Hash, History, Hourglass, MessageSquareWarning, ReceiptText } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoTope } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { etiquetaDeMime } from '@/lib/archivo-cotizacion'
import { catalogosDeCotizacion, listarCotizacionesPdf } from '@/lib/datos/cotizaciones-pdf'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { estadoFacturaVenta } from '@/lib/dominio/finanzas'
import { diaLima, fecha as fmtFecha, hora, hoyLima, moneda as formatoMoneda } from '@/lib/format'
import { exigirPermiso, puede, puedeCorregirCotizacion, puedeQuitarCotizacion } from '@/lib/sesion'

import { AprobarConOt, CorregirCotizacion, QuitarCotizacion, RevisarCotizacion } from './acciones-cotizacion'
import { SubirCotizacion } from './subir-cotizacion'

export const metadata = { title: 'Cotización' }

const ESTADOS: Record<string, { etiqueta: string; tono: 'aviso' | 'exito' | 'peligro' }> = {
  POR_REVISAR: { etiqueta: 'Por revisar', tono: 'aviso' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro' },
}

/** «Abrir el PDF» se ve en el navegador; el Word se baja. */
function EnlaceArchivo({ url, mime, nombre }: { url: string; mime: string | null; nombre: string | null }) {
  const word = etiquetaDeMime(mime) === 'Word'
  const Icono = word ? Download : FileText
  return (
    <a
      href={url}
      target={word ? undefined : '_blank'}
      rel="noreferrer"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
    >
      <Icono aria-hidden className="size-4 shrink-0" />
      <span className="break-words">
        {word ? 'Bajar el Word' : 'Abrir el PDF'}
        {nombre ? ` · ${nombre}` : ''}
      </span>
    </a>
  )
}

/**
 * El camino corto de la cotización (migraciones 101 a 103): el vendedor sube la
 * que ya le mandó al cliente, en PDF o en Word; Gerencia la rechaza con su
 * observación —y el vendedor sube ahí mismo la corrección— o la aprueba dando
 * el código interno de la unidad y subiendo la OT, todo junto (migración
 * 20261016900000). Desde ahí el código interno es la referencia del trabajo.
 *
 * La cotización se arma en Word: rehacerla dentro del sistema era escribir dos
 * veces lo mismo. Lo que el sistema sí guarda es la traza —quién la subió, qué
 * observó Gerencia en cada vuelta, quién la aprobó, qué orden salió— y el papel.
 */
const FILTROS_ESTADO = ['POR_REVISAR', 'APROBADA_MES', 'APROBADA_SIN_OT', 'RECHAZADA', 'CON_OT', 'ANULADA'] as const
type FiltroEstado = (typeof FILTROS_ESTADO)[number]

// «Aprobadas del mes»: las que Gerencia aprobó desde el día 1 del mes en el
// taller. Es la cifra «Aprobadas este mes» del Dashboard, y su enlace llega aquí.
function aprobadaEsteMes(c: { estado: string | null; revisado_en: string | null }, mes: string) {
  return c.estado === 'APROBADA' && !!c.revisado_en && diaLima(c.revisado_en).slice(0, 7) === mes
}

function enFiltro(
  c: { estado: string | null; orden_id: string | null; revisado_en: string | null },
  filtro: FiltroEstado | null,
  mes: string,
) {
  switch (filtro) {
    case 'POR_REVISAR':
      return c.estado === 'POR_REVISAR'
    case 'APROBADA_MES':
      return aprobadaEsteMes(c, mes)
    case 'APROBADA_SIN_OT':
      return c.estado === 'APROBADA' && !c.orden_id
    case 'RECHAZADA':
      return c.estado === 'RECHAZADA'
    case 'CON_OT':
      return Boolean(c.orden_id)
    case 'ANULADA':
      return c.estado === 'ANULADA'
    default:
      return c.estado !== 'ANULADA'
  }
}

export default async function PaginaCotizacionesPdf({ searchParams }: PageProps<'/cotizaciones/pdf'>) {
  const perfil = await exigirPermiso(['cotizaciones.ver_pdf_comercial', 'cotizaciones.ver_aprobadas', 'tesoreria.ver_documentos'])
  const params = await searchParams

  const puedeSubir = puede(perfil, 'cotizaciones.crear')
  const revisa = puede(perfil, 'cotizaciones.revisar')
  const veCodigos = puede(perfil, 'codigos_internos.ver')

  const [todas, catalogos] = await Promise.all([
    listarCotizacionesPdf(),
    puedeSubir ? catalogosDeCotizacion() : Promise.resolve({ clientes: [], carrocerias: [] }),
  ])

  // «Las tuyas»: Ventas recorta la lista a lo que subió. Es el recorte con que
  // el Dashboard cuenta sus cifras, y su enlace llega con `de=mias`.
  const soloMias = puedeSubir && params.de === 'mias'
  const cotizaciones = soloMias ? todas.filter((c) => c.registrado_por === perfil.id) : todas

  const mes = hoyLima().slice(0, 7)
  const porRevisar = cotizaciones.filter((c) => c.estado === 'POR_REVISAR').length
  const delMes = cotizaciones.filter((c) => aprobadaEsteMes(c, mes)).length
  const sinOrden = cotizaciones.filter((c) => c.estado === 'APROBADA' && !c.orden_id).length
  const rechazadas = cotizaciones.filter((c) => c.estado === 'RECHAZADA').length
  const conOrden = cotizaciones.filter((c) => Boolean(c.orden_id)).length
  const anuladas = cotizaciones.filter((c) => c.estado === 'ANULADA').length

  // Los filtros y la búsqueda se resuelven en memoria: la lista ya viene entera
  // (hasta 200) y así los enlaces del Dashboard y de la campana caen en lo suyo.
  const filtro = (FILTROS_ESTADO as readonly string[]).includes(String(params.estado))
    ? (params.estado as FiltroEstado)
    : null
  const palabras = palabrasDeBusqueda(typeof params.q === 'string' ? params.q : '')
  const buscada = (c: (typeof cotizaciones)[number]) => coincide(palabras, [c.numero, c.cliente, c.carroceria])
  // Sin filtro, primero lo que quien mira puede mover: Gerencia ve arriba las
  // que esperan su visto y las aprobadas de antes que quedaron sin código;
  // Ventas, las suyas rechazadas. El orden por fecha se conserva dentro de cada grupo.
  const meToca = (c: (typeof cotizaciones)[number]) =>
    (revisa && (c.estado === 'POR_REVISAR' || (c.estado === 'APROBADA' && !c.orden_id))) ||
    (puedeCorregirCotizacion(perfil, c) && !c.facturada)
  const visibles = cotizaciones
    .filter((c) => enFiltro(c, filtro, mes) && buscada(c))
    .sort((a, b) => Number(meToca(b)) - Number(meToca(a)))

  const opciones = [
    { valor: null, etiqueta: `Vigentes (${cotizaciones.length - anuladas})` },
    { valor: 'POR_REVISAR', etiqueta: `Por revisar (${porRevisar})` },
    { valor: 'APROBADA_MES', etiqueta: `Aprobadas del mes (${delMes})` },
    { valor: 'APROBADA_SIN_OT', etiqueta: `Aprobadas sin código (${sinOrden})` },
    { valor: 'RECHAZADA', etiqueta: `Rechazadas (${rechazadas})` },
    { valor: 'CON_OT', etiqueta: `Con código y OT (${conOrden})` },
    { valor: 'ANULADA', etiqueta: `Anuladas (${anuladas})` },
  ]

  return (
    <>
      <EncabezadoPagina
        titulo="Cotización"
        ayuda="Ventas sube la cotización y Gerencia la aprueba dando el código interno de la unidad y subiendo su OT. Aprobada, la ven también Contabilidad, que la factura, y Tesorería, que la cobra."
        acciones={puedeSubir && <SubirCotizacion clientes={catalogos.clientes} carrocerias={catalogos.carrocerias} />}
      />

      {todas.length > 0 && (
        <>
          <BuscadorSimple ruta="/cotizaciones/pdf" etiqueta="Buscar cotizaciones" marcador="Número, cliente o carrocería" />
          <PastillaFiltro
            ruta="/cotizaciones/pdf"
            clave="estado"
            opciones={opciones}
            params={params}
            activo={filtro}
            etiqueta="Filtrar por estado"
            className={puedeSubir ? 'mt-4 mb-2' : 'mt-4 mb-4'}
          />
          {puedeSubir && (
            <PastillaFiltro
              ruta="/cotizaciones/pdf"
              clave="de"
              opciones={[
                { valor: null, etiqueta: 'De todos' },
                { valor: 'mias', etiqueta: `Las que subiste (${todas.filter((c) => c.registrado_por === perfil.id).length})` },
              ]}
              params={params}
              activo={soloMias ? 'mias' : null}
              etiqueta="Filtrar por quién la subió"
              className="mb-4"
            />
          )}
        </>
      )}

      {cotizaciones.length > 0 && visibles.length === 0 && (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">Ninguna cotización con ese filtro</p>
            <p className="mt-1 text-sm text-texto-suave">
              Prueba con otro estado o quita la búsqueda.{' '}
              <Link href="/cotizaciones/pdf" className="text-acento hover:underline">
                Ver todas
              </Link>
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      {cotizaciones.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">
              {soloMias && todas.length > 0 ? 'Todavía no subiste ninguna cotización' : 'Todavía no hay cotizaciones subidas'}
            </p>
            <p className="mt-1 text-sm text-texto-suave">
              {soloMias && todas.length > 0 ? (
                <>
                  Las demás están en{' '}
                  <Link href="/cotizaciones/pdf" className="text-acento hover:underline">
                    De todos
                  </Link>
                  .
                </>
              ) : puedeSubir ? (
                'Sube la primera con «Subir cotización», arriba: el PDF o el Word que se le mandó al cliente.'
              ) : (
                'Las sube el vendedor cuando se la manda al cliente.'
              )}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {visibles.map((c) => {
            const estado = ESTADOS[c.estado ?? ''] ?? { etiqueta: c.estado ?? '—', tono: 'neutro' as const }
            const quitable = puedeQuitarCotizacion(perfil, c)
            // La facturada ya no se corrige (la base lo impide): sin el botón,
            // y con la razón a la vista para quien lo habría tenido.
            const corregiria = puedeCorregirCotizacion(perfil, c)
            const corrige = corregiria && !c.facturada
            const version = c.version ?? 1
            const versionAnterior = c.versiones[0]

            return (
              // Con `id`: el aviso de la campana aterriza en esta fila (`#id`).
              <li key={c.id} id={c.id ?? undefined} className="scroll-mt-20 target:[&>div]:border-acento">
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-texto">{c.numero}</span>
                        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                        {version > 1 && (
                          <span className="text-xs font-medium text-texto-suave">versión {version}</span>
                        )}
                      </span>
                      <span className="text-xs text-texto-tenue">
                        {c.registrado_por_nombre ?? 'Ventas'} · {fmtFecha(c.creado_en)} {hora(c.creado_en)}
                      </span>
                    </div>

                    <p className="text-sm text-texto">
                      {c.cliente ?? 'Cliente reservado'}
                      {c.carroceria && <span className="text-texto-suave"> · {c.carroceria}</span>}
                    </p>

                    <p className="text-sm font-semibold tabular text-texto">
                      {c.monto_venta !== null && c.monto_venta !== undefined
                        ? `Total de venta: ${formatoMoneda(c.monto_venta, c.moneda ?? 'PEN')}`
                        : 'Monto total pendiente de confirmar'}
                    </p>

                    {c.url ? <EnlaceArchivo url={c.url} mime={c.mime_type} nombre={c.nombre_archivo} /> : (
                      <p role="alert" className="text-sm text-aviso">No se pudo abrir el archivo de esta cotización. Recarga la página; si continúa, avisa al administrador.</p>
                    )}

                    {c.estado === 'RECHAZADA' && c.observacion && (
                      <div className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-2 text-sm text-peligro">
                        <MessageSquareWarning aria-hidden className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <p>
                            <span className="font-medium">{c.revisado_por_nombre ?? 'Gerencia'} la rechazó</span>
                            {c.revisado_en ? ` el ${fmtFecha(c.revisado_en)}` : ''}: {c.observacion}
                          </p>
                          {corrige && (
                            <p className="mt-0.5 text-xs">Corrígela y súbela con «Subir corrección»: vuelve a Gerencia con el mismo número.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {c.estado === 'ANULADA' && (
                      <p className="rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-2 text-sm text-peligro">
                        Anulada: {c.observacion || 'Consulta el motivo con Gerencia.'} El número y el archivo se conservan en el historial.
                      </p>
                    )}

                    {c.estado === 'POR_REVISAR' && versionAnterior && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <History aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">Corregida {fmtFecha(c.archivo_subido_en)}.</span>{' '}
                          La nueva versión espera a Gerencia. La anterior era {versionAnterior.estado_al_archivar === 'APROBADA' ? 'aprobada' : 'rechazada'}.
                        </span>
                      </p>
                    )}

                    {c.estado === 'APROBADA' && (
                      <p className="text-[11px] text-texto-tenue">
                        Aprobada por {c.revisado_por_nombre ?? 'Gerencia'}
                        {c.revisado_en ? ` el ${fmtFecha(c.revisado_en)}` : ''}
                      </p>
                    )}

                    {c.facturas.length > 0 && (
                      <p className="flex flex-wrap items-center gap-1.5 text-xs text-texto-suave">
                        <ReceiptText aria-hidden className="size-3.5" />
                        {c.facturas.map((f) => (
                          <Insignia key={f.id} tono={estadoFacturaVenta(f).tono}>
                            Factura {f.numero} · {formatoMoneda(f.total, f.moneda === 'USD' ? 'USD' : 'PEN')} · {estadoFacturaVenta(f).etiqueta.toLowerCase()}
                          </Insignia>
                        ))}
                      </p>
                    )}

                    {c.versiones.length > 0 && (
                      <details className="group rounded-[var(--radius-base)] border border-borde">
                        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 px-2.5 text-xs font-medium text-texto-suave sm:min-h-8">
                          <History aria-hidden className="size-3.5" />
                          Historial: {c.versiones.length} {c.versiones.length === 1 ? 'versión anterior' : 'versiones anteriores'}
                        </summary>
                        <ol className="space-y-2 border-t border-borde px-2.5 py-2">
                          {c.versiones.map((v) => (
                            <li key={v.id} className="space-y-0.5 text-xs">
                              <p className="text-texto">
                                <span className="font-medium">Versión {v.version} · {v.estado_al_archivar === 'APROBADA' ? 'aprobada' : 'rechazada'}</span>
                                <span className="text-texto-tenue">
                                  {' '}
                                  · subida {fmtFecha(v.subido_en)}
                                  {v.rechazado_en ? ` · revisada por ${v.rechazado_por_nombre ?? 'Gerencia'} el ${fmtFecha(v.rechazado_en)}` : ''}
                                </span>
                              </p>
                              <p className="text-texto-suave">«{v.observacion}»</p>
                              {v.url ? <EnlaceArchivo url={v.url} mime={v.mime_type} nombre={v.nombre_archivo} /> : (
                                <p className="text-aviso">Archivo no disponible. Recarga la página o avisa al administrador.</p>
                              )}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {/* Una aprobada de antes que quedó sin OT: quien no es Gerencia
                        tiene que saber por qué no avanza y quién la destraba. */}
                    {!revisa && c.estado === 'APROBADA' && !c.orden_id && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">Falta que Gerencia le dé su código interno y cargue la OT.</span>{' '}
                          Sin código no se factura ni Diseño empieza.
                        </span>
                      </p>
                    )}

                    {c.orden_id && (
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <Hash aria-hidden className="size-4 text-texto-suave" />
                        {c.codigo_interno ? (
                          veCodigos ? (
                            <Link
                              href={`/codigos-internos/detalle?codigo=${encodeURIComponent(c.codigo_interno)}`}
                              className="font-mono font-medium break-all text-acento hover:underline"
                            >
                              {c.codigo_interno}
                            </Link>
                          ) : (
                            <span className="font-mono font-medium break-all text-texto">{c.codigo_interno}</span>
                          )
                        ) : (
                          <span className="text-texto-suave">Sin código interno</span>
                        )}
                        <span className="text-texto-suave">· OT {c.orden_numero}</span>
                        <Insignia tono={definir(ESTADO_OT, c.orden_estado).tono}>
                          {definir(ESTADO_OT, c.orden_estado).etiqueta}
                        </Insignia>
                      </p>
                    )}
                    {corregiria && c.facturada && (
                      <p className="text-xs text-texto-suave">
                        Ya está facturada: no se corrige. Si hay que cambiarla, Contabilidad anula primero la factura.
                      </p>
                    )}
                    {(revisa && c.estado === 'POR_REVISAR' || revisa && c.estado === 'APROBADA' && !c.orden_id || corrige || quitable) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {revisa && c.estado === 'POR_REVISAR' && c.id && (
                          <RevisarCotizacion id={c.id} numero={c.numero ?? 'cotización'} tipoUnidad={c.tipo_unidad} conOrden={Boolean(c.orden_id)} />
                        )}
                        {!c.orden_id && revisa && c.estado === 'APROBADA' && c.id && (
                          <AprobarConOt cotizacionId={c.id} numero={c.numero ?? 'cotización'} tipoUnidad={c.tipo_unidad} yaAprobada />
                        )}
                        {corrige && c.id && (
                          <CorregirCotizacion id={c.id} numero={c.numero ?? ''} observacion={c.observacion}
                            rechazada={c.estado === 'RECHAZADA'} aprobada={c.estado === 'APROBADA'}
                            version={c.version ?? 1} clienteId={c.cliente_id ?? ''} carroceriaId={c.tipo_carroceria_id ?? ''}
                            clientes={catalogos.clientes} carrocerias={catalogos.carrocerias} />
                        )}
                        {!c.orden_id && quitable && c.id && <QuitarCotizacion id={c.id} numero={c.numero ?? ''} />}
                      </div>
                    )}
                  </TarjetaCuerpo>
                </Tarjeta>
              </li>
            )
          })}
        </ul>
      )}

      <AvisoTope mostradas={todas.length} tope={200} />
    </>
  )
}
