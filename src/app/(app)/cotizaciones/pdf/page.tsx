import { Download, FileText, History, Hourglass, MessageSquareWarning } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { etiquetaDeMime } from '@/lib/archivo-cotizacion'
import { catalogosDeCotizacion, listarCotizacionesPdf } from '@/lib/datos/cotizaciones-pdf'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { fecha as fmtFecha, hora } from '@/lib/format'
import { exigirPermiso, puede, puedeCorregirCotizacion, puedeQuitarCotizacion } from '@/lib/sesion'

import { CorregirCotizacion, EmitirOrden, QuitarCotizacion, RevisarCotizacion } from './acciones-cotizacion'
import { SubirCotizacion } from './subir-cotizacion'

export const metadata = { title: 'Cotización en PDF' }

const ESTADOS: Record<string, { etiqueta: string; tono: 'aviso' | 'exito' | 'peligro' }> = {
  POR_REVISAR: { etiqueta: 'Por revisar', tono: 'aviso' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
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
      <span className="break-all">
        {word ? 'Bajar el Word' : 'Abrir el PDF'}
        {nombre ? ` · ${nombre}` : ''}
      </span>
    </a>
  )
}

/**
 * El camino corto de la cotización (migraciones 101 a 103): el vendedor sube la
 * que ya le mandó al cliente, en PDF o en Word; Gerencia la aprueba o la
 * rechaza con su observación, y el vendedor sube ahí mismo la corrección; con
 * ella aprobada, Administración emite la orden de trabajo con su propio PDF.
 *
 * La cotización se arma en Word: rehacerla dentro del sistema era escribir dos
 * veces lo mismo. Lo que el sistema sí guarda es la traza —quién la subió, qué
 * observó Gerencia en cada vuelta, quién la aprobó, qué orden salió— y el papel.
 */
const FILTROS_ESTADO = ['POR_REVISAR', 'APROBADA_SIN_OT', 'RECHAZADA', 'CON_OT'] as const
type FiltroEstado = (typeof FILTROS_ESTADO)[number]

function enFiltro(c: { estado: string | null; orden_id: string | null }, filtro: FiltroEstado | null) {
  switch (filtro) {
    case 'POR_REVISAR':
      return c.estado === 'POR_REVISAR'
    case 'APROBADA_SIN_OT':
      return c.estado === 'APROBADA' && !c.orden_id
    case 'RECHAZADA':
      return c.estado === 'RECHAZADA'
    case 'CON_OT':
      return Boolean(c.orden_id)
    default:
      return true
  }
}

export default async function PaginaCotizacionesPdf({ searchParams }: PageProps<'/cotizaciones/pdf'>) {
  const perfil = await exigirPermiso('cotizaciones.ver')
  const params = await searchParams

  const puedeSubir = puede(perfil, 'cotizaciones.crear')
  const revisa = puede(perfil, 'cotizaciones.revisar')
  const emite = puede(perfil, 'ordenes.crear')

  const [cotizaciones, catalogos] = await Promise.all([
    listarCotizacionesPdf(),
    puedeSubir ? catalogosDeCotizacion() : Promise.resolve({ clientes: [], carrocerias: [] }),
  ])

  const porRevisar = cotizaciones.filter((c) => c.estado === 'POR_REVISAR').length
  const sinOrden = cotizaciones.filter((c) => c.estado === 'APROBADA' && !c.orden_id).length
  const rechazadas = cotizaciones.filter((c) => c.estado === 'RECHAZADA').length
  const conOrden = cotizaciones.filter((c) => Boolean(c.orden_id)).length

  // Los filtros y la búsqueda se resuelven en memoria: la lista ya viene entera
  // (hasta 200) y así los enlaces del Tablero y de la campana caen en lo suyo.
  const filtro = (FILTROS_ESTADO as readonly string[]).includes(String(params.estado))
    ? (params.estado as FiltroEstado)
    : null
  const busqueda = typeof params.q === 'string' ? params.q.trim().toLowerCase() : ''
  const coincide = (c: (typeof cotizaciones)[number]) =>
    !busqueda || [c.numero, c.cliente, c.carroceria].some((v) => (v ?? '').toLowerCase().includes(busqueda))
  // Sin filtro, primero lo que quien mira puede mover: Gerencia ve arriba las
  // que esperan su visto; Administración, las aprobadas sin orden; Ventas, las
  // suyas rechazadas. El orden por fecha se conserva dentro de cada grupo.
  const meToca = (c: (typeof cotizaciones)[number]) =>
    (revisa && c.estado === 'POR_REVISAR') ||
    (emite && c.estado === 'APROBADA' && !c.orden_id) ||
    puedeCorregirCotizacion(perfil, c)
  const visibles = cotizaciones
    .filter((c) => enFiltro(c, filtro) && coincide(c))
    .sort((a, b) => Number(meToca(b)) - Number(meToca(a)))

  const opciones = [
    { valor: null, etiqueta: `Todas (${cotizaciones.length})` },
    { valor: 'POR_REVISAR', etiqueta: `Por revisar (${porRevisar})` },
    { valor: 'APROBADA_SIN_OT', etiqueta: `Aprobadas sin OT (${sinOrden})` },
    { valor: 'RECHAZADA', etiqueta: `Rechazadas (${rechazadas})` },
    { valor: 'CON_OT', etiqueta: `Con OT (${conOrden})` },
  ]

  return (
    <>
      <EncabezadoPagina
        titulo="Cotización en PDF"
        descripcion="La cotización que se le mandó al cliente, en PDF o en Word. Gerencia la aprueba o la rechaza con su observación, y con ella aprobada Administración emite la orden de trabajo."
        acciones={puedeSubir && <SubirCotizacion clientes={catalogos.clientes} carrocerias={catalogos.carrocerias} />}
      />

      {cotizaciones.length > 0 && (
        <>
          <BuscadorSimple ruta="/cotizaciones/pdf" etiqueta="Buscar cotizaciones" marcador="Buscar por número, cliente o carrocería" />
          <PastillaFiltro
            ruta="/cotizaciones/pdf"
            clave="estado"
            opciones={opciones}
            params={params}
            activo={filtro}
            etiqueta="Filtrar por estado"
            className="mt-4 mb-4"
          />
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
            <p className="text-sm font-medium text-texto">Todavía no hay cotizaciones subidas</p>
            <p className="mt-1 text-sm text-texto-suave">
              {puedeSubir
                ? 'Sube la primera con «Subir cotización», arriba: el PDF o el Word que se le mandó al cliente.'
                : 'Las sube el vendedor cuando se la manda al cliente.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {visibles.map((c) => {
            const estado = ESTADOS[c.estado ?? ''] ?? { etiqueta: c.estado ?? '—', tono: 'neutro' as const }
            const quitable = puedeQuitarCotizacion(perfil, c)
            const corrige = puedeCorregirCotizacion(perfil, c)
            const version = c.version ?? 1
            const ultimoRechazo = c.versiones[0]

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

                    {c.url && <EnlaceArchivo url={c.url} mime={c.mime_type} nombre={c.nombre_archivo} />}

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

                    {c.estado === 'POR_REVISAR' && ultimoRechazo && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <History aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">Corregida {fmtFecha(c.archivo_subido_en)}.</span> Lo que se había observado:{' '}
                          {ultimoRechazo.observacion}
                        </span>
                      </p>
                    )}

                    {c.estado === 'APROBADA' && (
                      <p className="text-[11px] text-texto-tenue">
                        Aprobada por {c.revisado_por_nombre ?? 'Gerencia'}
                        {c.revisado_en ? ` el ${fmtFecha(c.revisado_en)}` : ''}
                      </p>
                    )}

                    {c.versiones.length > 0 && (
                      <details className="group rounded-[var(--radius-base)] border border-borde">
                        <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 px-2.5 text-xs font-medium text-texto-suave sm:min-h-8">
                          <History aria-hidden className="size-3.5" />
                          Historial: {c.versiones.length} {c.versiones.length === 1 ? 'versión rechazada' : 'versiones rechazadas'}
                        </summary>
                        <ol className="space-y-2 border-t border-borde px-2.5 py-2">
                          {c.versiones.map((v) => (
                            <li key={v.id} className="space-y-0.5 text-xs">
                              <p className="text-texto">
                                <span className="font-medium">Versión {v.version}</span>
                                <span className="text-texto-tenue">
                                  {' '}
                                  · subida {fmtFecha(v.subido_en)} · rechazada por {v.rechazado_por_nombre ?? 'Gerencia'}
                                  {v.rechazado_en ? ` el ${fmtFecha(v.rechazado_en)}` : ''}
                                </span>
                              </p>
                              <p className="text-peligro">«{v.observacion}»</p>
                              {v.url && <EnlaceArchivo url={v.url} mime={v.mime_type} nombre={v.nombre_archivo} />}
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {/* Quien no emite la orden —Diseño, Ventas, el taller— tiene que
                        saber por qué no puede avanzar y dónde va a seguir. */}
                    {!emite && c.estado === 'APROBADA' && !c.orden_id && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">Falta que Administración emita la orden de trabajo.</span>{' '}
                          En la orden se arman los planos, los materiales y las actividades de cada área.
                        </span>
                      </p>
                    )}

                    {c.orden_id ? (
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/ordenes/${c.orden_id}`} className="font-medium text-acento hover:underline">
                          Orden {c.orden_numero}
                        </Link>
                        <Insignia tono={definir(ESTADO_OT, c.orden_estado).tono}>
                          {definir(ESTADO_OT, c.orden_estado).etiqueta}
                        </Insignia>
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {revisa && c.estado === 'POR_REVISAR' && c.id && <RevisarCotizacion id={c.id} />}
                        {emite && c.estado === 'APROBADA' && c.id && (
                          <EmitirOrden cotizacionId={c.id} numero={c.numero ?? 'cotización'} tipoUnidad={c.tipo_unidad} />
                        )}
                        {corrige && c.id && (
                          <CorregirCotizacion id={c.id} numero={c.numero ?? ''} observacion={c.observacion} />
                        )}
                        {quitable && c.id && <QuitarCotizacion id={c.id} numero={c.numero ?? ''} />}
                      </div>
                    )}
                  </TarjetaCuerpo>
                </Tarjeta>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
