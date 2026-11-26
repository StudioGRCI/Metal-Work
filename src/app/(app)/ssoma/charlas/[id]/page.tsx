import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarCharlaSsoma } from '@/lib/datos/ssoma'
import { TIPO_CHARLA_SSOMA } from '@/lib/dominio/ssoma'
import { fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { Galeria } from '../../galeria'
import { AnularCharla } from '../controles'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'Seguridad: charla' }

/**
 * Una charla o inducción: qué se habló, quién la dio, sus fotos y quiénes
 * asistieron. La ven SSOMA y Gerencia; la anula SSOMA, con su motivo.
 */
export default async function PaginaCharlaSsoma({ params }: PageProps<'/ssoma/charlas/[id]'>) {
  const perfil = await exigirPermiso(['ssoma.ver', 'ssoma.gestionar'])
  const { id } = await params
  if (!GUID.test(id)) notFound()
  // El mismo permiso que pide `ssoma_anular_charla`.
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const c = await cargarCharlaSsoma(id)
  if (!c) notFound()
  const tipo = TIPO_CHARLA_SSOMA[c.tipo]
  const anulada = Boolean(c.anulado_en)
  const mes = c.fecha.slice(0, 7)
  const etiqueta = tipo?.etiqueta ?? 'Charla'

  return (
    <>
      <EncabezadoPagina
        titulo={c.tema}
        descripcion={`${etiqueta} del ${fecha(c.fecha)} · ${c.expositor}`}
        migas={[
          { titulo: 'SSOMA', ruta: '/ssoma' },
          { titulo: 'Charlas e inducciones', ruta: `/ssoma/charlas?mes=${mes}` },
          { titulo: etiqueta },
        ]}
        acciones={gestiona && !anulada && <AnularCharla id={c.id} tema={c.tema} />}
      />

      <div className="space-y-5">
        {anulada && (
          <div role="note" className="rounded-[var(--radius-base)] border border-borde bg-neutro-suave px-4 py-3 text-sm text-texto" data-charla-anulada>
            <p className="font-medium">
              Anulada{c.anulo ? ` por ${c.anulo}` : ''}
              {c.anulado_en ? ` el ${fechaHora(c.anulado_en)}` : ''}
            </p>
            <p className="mt-1">Ya no cuenta como asistencia.</p>
            {c.motivo_anulacion && <p className="mt-1 text-texto-suave">Motivo: {c.motivo_anulacion}</p>}
          </div>
        )}

        <Tarjeta>
          <TarjetaCuerpo>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Qué fue">{tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : c.tipo}</Dato>
              <Dato titulo="Fecha">{fecha(c.fecha)}</Dato>
              <Dato titulo="Quién la dio">{c.expositor}</Dato>
              <Dato titulo="Asistentes">{c.asistentes.length}</Dato>
              <Dato titulo="Registró">
                {c.registro ?? '—'} <span className="text-xs text-texto-suave">· {fechaHora(c.creado_en)}</span>
              </Dato>
            </div>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera titulo={`Fotos · ${c.fotosDeLaCharla.length}`} />
          <TarjetaCuerpo>
            {c.fotosDeLaCharla.length === 0 ? (
              <p className="text-sm text-texto-suave">Se registró sin fotos.</p>
            ) : (
              <Galeria fotos={c.fotosDeLaCharla} texto={(f) => `Foto ${f.orden} de la charla «${c.tema}»`} />
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo={`Quiénes asistieron · ${c.asistentes.length}`} />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona</TH>
                <TH className="hidden sm:table-cell">Cargo</TH>
                <TH className="hidden sm:table-cell">Área</TH>
              </tr>
            </TablaCabecera>
            <tbody>
              {c.asistentes.length === 0 ? (
                <SinDatos titulo="Sin asistentes" descripcion="" />
              ) : (
                c.asistentes.map((p) => (
                  <TR key={p.id} data-asistio={p.id}>
                    <TD className="align-top">
                      <p className="text-sm text-texto">{p.nombre}</p>
                      <p className="text-xs text-texto-suave sm:hidden">{[p.cargo, p.area].filter(Boolean).join(' · ')}</p>
                    </TD>
                    <TD className="hidden align-top text-sm text-texto sm:table-cell">{p.cargo ?? '—'}</TD>
                    <TD className="hidden align-top text-sm text-texto sm:table-cell">{p.area ?? '—'}</TD>
                  </TR>
                ))
              )}
            </tbody>
          </Tabla>
        </Tarjeta>
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
