import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarReporteSsoma, type DetalleReporteSsoma } from '@/lib/datos/ssoma'
import { diasEnEspera, ESTADO_REPORTE_SSOMA, TIPO_REPORTE_SSOMA } from '@/lib/dominio/ssoma'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { AnularReporte } from './controles'

export const metadata = { title: 'Reporte de seguridad' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un reporte de seguridad: qué pasó, su recorrido y sus fotos. Quien lo reportó
 * ve cómo va; el área donde pasó lo ve sin el nombre de quien reportó y sin las
 * fotos; SSOMA y Gerencia lo ven entero. Lo que cada quien ve lo decide la base.
 */
export default async function PaginaReporteSsoma({ params }: PageProps<'/ssoma/[id]'>) {
  const perfil = await exigirSesion()
  const { id } = await params
  if (!GUID.test(id)) notFound()
  const r = await cargarReporteSsoma(id)
  if (!r) notFound()

  const tipo = TIPO_REPORTE_SSOMA[r.tipo]
  const estado = ESTADO_REPORTE_SSOMA[r.estado]
  const anulado = r.estado === 'ANULADO'
  // El mismo permiso que pide `ssoma_anular_reporte`.
  const anula = puede(perfil, 'ssoma.gestionar') && !anulado
  const delArea = r.alcance === 'AREA'

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{r.numero}</span>}
        descripcion={`${tipo?.etiqueta ?? r.tipo} · ${r.area} · ${r.lugar}`}
        migas={[{ titulo: 'SSOMA', ruta: '/ssoma' }, { titulo: r.numero }]}
        acciones={anula && <AnularReporte id={r.id} numero={r.numero} />}
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Qué se reporta">{tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : r.tipo}</Dato>
              <Dato titulo="Cómo va">{estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : r.estado}</Dato>
              <Dato titulo="Dónde">
                {r.area} · {r.lugar}
              </Dato>
              <Dato titulo="Cuándo pasó">{fechaHora(r.ocurrido_en)}</Dato>
              {r.hubo_atencion !== null && <Dato titulo="Atención médica">{r.hubo_atencion ? 'Sí hubo' : 'No hubo'}</Dato>}
            </div>
            <div>
              <p className="text-xs text-texto-suave">{r.tipo === 'CONDICION_INSEGURA' ? 'Qué se vio' : 'Qué pasó'}</p>
              <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{r.descripcion}</p>
            </div>
            {delArea && (
              <p className="text-xs text-texto-suave" data-alcance-area>
                Lo ves porque pasó en tu área. Quién lo reportó y las fotos los ven solo SSOMA y Gerencia.
              </p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Recorrido reporte={r} />

        {!delArea && (
          <Tarjeta>
            <TarjetaCabecera titulo={`Fotos${r.fotosDelReporte.length > 0 ? ` · ${r.fotosDelReporte.length}` : ''}`} />
            <TarjetaCuerpo>
              {r.fotosDelReporte.length === 0 ? (
                <p className="text-sm text-texto-suave">El reporte se envió sin fotos.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {r.fotosDelReporte.map((f) => (
                    <li key={f.id}>
                      {f.enlace ? (
                        <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
                          {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
                          <img src={f.enlace} alt={`Foto ${f.orden} del reporte ${r.numero}`} className="aspect-square w-full object-cover" loading="lazy" />
                        </a>
                      ) : (
                        <p className="flex aspect-square items-center justify-center rounded-lg border border-borde p-2 text-center text-xs text-texto-suave">
                          La foto {f.orden} no se pudo abrir ahora
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </div>
    </>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <div className="tabular text-texto">{children}</div>
    </div>
  )
}

type Paso = {
  clave: string
  titulo: string
  /** Quién lo hizo o quién lo tiene. */
  quien: string | null
  cuando: string | null
  detalle: string | null
  tono: Tono
  /** El paso donde está ahora: todavía no terminó. */
  actual?: boolean
}

const PUNTO: Partial<Record<Tono, string>> = {
  exito: 'bg-exito',
  aviso: 'bg-aviso',
  peligro: 'bg-peligro',
  neutro: 'bg-texto-tenue',
}

/**
 * El recorrido del reporte: quién lo tiene y desde cuándo. Sale de la fila
 * misma. Cuando el componente «Recorrido» del Plan 0 esté en main, este bloque
 * se cambia por él; los pasos son los mismos.
 */
function pasosDe(r: DetalleReporteSsoma): Paso[] {
  const pasos: Paso[] = [
    {
      clave: 'reportado',
      titulo: 'Reportado',
      quien:
        r.alcance === 'AREA'
          ? null
          : [r.reporto && [r.reporto, r.reporto_puesto].filter(Boolean).join(' · '), r.a_nombre_de && `a nombre de ${r.a_nombre_de}${r.a_nombre_de_cargo ? ` (${r.a_nombre_de_cargo})` : ''}`]
              .filter(Boolean)
              .join(', ') || null,
      cuando: r.creado_en,
      detalle: null,
      tono: 'exito',
    },
  ]
  if (r.estado === 'ANULADO') {
    pasos.push({
      clave: 'anulado',
      titulo: 'Anulado por SSOMA',
      quien: r.anulo,
      cuando: r.anulado_en,
      detalle: r.motivo_anulacion,
      tono: 'neutro',
    })
  } else {
    const espera = diasEnEspera(r.dias_en_espera)
    pasos.push({
      clave: 'en-ssoma',
      titulo: 'Lo tiene SSOMA',
      quien: espera ? `desde ${espera}` : null,
      cuando: null,
      detalle: 'SSOMA lo revisa, anota la causa y define qué se corrige y quién.',
      tono: 'aviso',
      actual: true,
    })
  }
  return pasos
}

function Recorrido({ reporte }: { reporte: DetalleReporteSsoma }) {
  const pasos = pasosDe(reporte)
  return (
    <Tarjeta>
      <TarjetaCabecera titulo="Recorrido" ayuda="Por dónde va el reporte: quién lo tiene ahora y desde cuándo." />
      <TarjetaCuerpo>
        <ol className="space-y-0" data-recorrido>
          {pasos.map((p, i) => (
            <li key={p.clave} className="relative flex gap-3 pb-4 last:pb-0" aria-current={p.actual ? 'step' : undefined}>
              {i < pasos.length - 1 && <span aria-hidden className="absolute top-5 bottom-0 left-[5px] w-px bg-borde" />}
              <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--superficie)]', PUNTO[p.tono] ?? 'bg-acento')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-texto">
                  {p.titulo}
                  {p.quien && <span className="font-normal text-texto-suave"> · {p.quien}</span>}
                </p>
                {p.cuando && (
                  <time dateTime={p.cuando} className="tabular block text-xs text-texto-suave">
                    {fechaHora(p.cuando)}
                  </time>
                )}
                {p.detalle && <p className="mt-0.5 max-w-2xl text-xs whitespace-pre-wrap text-texto-suave">{p.detalle}</p>}
              </div>
            </li>
          ))}
        </ol>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
