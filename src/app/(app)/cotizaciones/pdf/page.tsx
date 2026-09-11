import { FileText, MessageSquareWarning } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { catalogosDeCotizacion, listarCotizacionesPdf } from '@/lib/datos/cotizaciones-pdf'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { fecha as fmtFecha, hora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { EmitirOrden, QuitarCotizacion, RevisarCotizacion } from './acciones-cotizacion'
import { SubirCotizacion } from './subir-cotizacion'

export const metadata = { title: 'Cotización en PDF' }

const ESTADOS: Record<string, { etiqueta: string; tono: 'aviso' | 'exito' | 'peligro' }> = {
  POR_REVISAR: { etiqueta: 'Por revisar', tono: 'aviso' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro' },
}

/**
 * El camino corto de la cotización (migración 101): el vendedor sube el PDF que
 * ya le mandó al cliente, Gerencia lo aprueba o lo rechaza, y Administración
 * emite la orden de trabajo con su propio PDF. Ahí arranca el taller.
 *
 * La cotización se arma en Excel y se manda en PDF: rehacerla dentro del
 * sistema era escribir dos veces lo mismo. Lo que el sistema sí guarda es la
 * traza —quién la subió, quién la aprobó, qué orden salió— y el papel.
 */
export default async function PaginaCotizacionesPdf() {
  const perfil = await exigirPermiso('cotizaciones.ver')

  const puedeSubir = puede(perfil, 'cotizaciones.crear')
  const revisa = puede(perfil, 'cotizaciones.revisar')
  const emite = puede(perfil, 'ordenes.crear')

  const [cotizaciones, catalogos] = await Promise.all([
    listarCotizacionesPdf(),
    puedeSubir ? catalogosDeCotizacion() : Promise.resolve({ clientes: [], carrocerias: [] }),
  ])

  const porRevisar = cotizaciones.filter((c) => c.estado === 'POR_REVISAR').length
  const sinOrden = cotizaciones.filter((c) => c.estado === 'APROBADA' && !c.orden_id).length

  return (
    <>
      <EncabezadoPagina
        titulo="Cotización en PDF"
        descripcion="La cotización que se le mandó al cliente, tal como salió. Gerencia la aprueba o la rechaza, y con ella aprobada Administración emite la orden de trabajo."
        acciones={puedeSubir && <SubirCotizacion clientes={catalogos.clientes} carrocerias={catalogos.carrocerias} />}
      />

      {(porRevisar > 0 || sinOrden > 0) && (
        <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-texto-suave">
          {porRevisar > 0 && (
            <span>
              <span className="font-medium text-aviso">{porRevisar}</span> esperando a Gerencia
            </span>
          )}
          {sinOrden > 0 && (
            <span>
              <span className="font-medium text-acento">{sinOrden}</span> aprobadas sin orden de trabajo
            </span>
          )}
        </p>
      )}

      {cotizaciones.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">Todavía no hay cotizaciones subidas</p>
            <p className="mt-1 text-sm text-texto-suave">
              {puedeSubir
                ? 'Sube la primera con «Subir cotización», arriba: el PDF que se le mandó al cliente, con su número, de quién es y qué se fabrica.'
                : 'Las sube el vendedor cuando se la manda al cliente.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {cotizaciones.map((c) => {
            const estado = ESTADOS[c.estado ?? ''] ?? { etiqueta: c.estado ?? '—', tono: 'neutro' as const }
            const mia = c.registrado_por === perfil.id

            return (
              <li key={c.id}>
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-texto">{c.numero}</span>
                        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                      </span>
                      <span className="text-xs text-texto-tenue">
                        {c.registrado_por_nombre ?? 'Ventas'} · {fmtFecha(c.creado_en)} {hora(c.creado_en)}
                      </span>
                    </div>

                    <p className="text-sm text-texto">
                      {c.cliente ?? 'Cliente reservado'}
                      {c.carroceria && <span className="text-texto-suave"> · {c.carroceria}</span>}
                    </p>

                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-acento hover:underline sm:min-h-0"
                      >
                        <FileText aria-hidden className="size-4" />
                        Abrir el PDF{c.nombre_archivo ? ` · ${c.nombre_archivo}` : ''}
                      </a>
                    )}

                    {c.estado === 'RECHAZADA' && c.observacion && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
                        <MessageSquareWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          <span className="font-medium">{c.revisado_por_nombre ?? 'Gerencia'} la rechazó:</span>{' '}
                          {c.observacion}
                        </span>
                      </p>
                    )}

                    {c.estado === 'APROBADA' && (
                      <p className="text-[11px] text-texto-tenue">
                        Aprobada por {c.revisado_por_nombre ?? 'Gerencia'}
                        {c.revisado_en ? ` el ${fmtFecha(c.revisado_en)}` : ''}
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
                          <EmitirOrden cotizacionId={c.id} numero={c.numero ?? 'cotización'} />
                        )}
                        {mia && c.estado === 'POR_REVISAR' && c.id && (
                          <QuitarCotizacion id={c.id} numero={c.numero ?? ''} />
                        )}
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
