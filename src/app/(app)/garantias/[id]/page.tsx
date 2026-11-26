import { FilePlus2 } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarReclamo, otsParaEnlazar } from '@/lib/datos/garantias'
import { definir, ESTADO_OT } from '@/lib/dominio/estados'
import { CAUSA_GARANTIA, SITUACION_RECLAMO } from '@/lib/dominio/garantias'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { AnotarCausa, AnularReclamo, AvisoDelReclamo, EnlazarOt, NoProcede } from './controles'

export const metadata = { title: 'Reclamo de garantía' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un reclamo de garantía: qué reclama el cliente, su unidad, su OT de garantía,
 * cómo se cerró y sus fotos. Arriba, lo que le toca a quien mira, como lo dice
 * la base (`puede_*`), con el mismo permiso que la función que escribe.
 */
export default async function PaginaReclamo({ params }: PageProps<'/garantias/[id]'>) {
  const perfil = await exigirSesion()
  const { id } = await params
  if (!FORMA_DE_ID.test(id)) notFound()
  const r = await cargarReclamo(id)
  if (!r) notFound()
  const ots = r.puede_enlazar ? await otsParaEnlazar(r.id) : []
  // La OT nueva nace desde el reclamo con su cliente y su unidad, y queda enlazada.
  const abreOt = r.puede_enlazar && puede(perfil, 'ordenes.crear')
  // El número de la OT lleva a ella solo si quien mira abre las OT.
  const veOt = puede(perfil, ['ordenes.ver', 'ordenes.listar'])
  const s = SITUACION_RECLAMO[r.situacion]
  const causa = r.causa ? CAUSA_GARANTIA[r.causa] : null
  const unidad = [r.placa ?? 'Sin placa', r.codigo_interno, r.carroceria].filter(Boolean).join(' · ')

  const acciones = (
    <>
      {abreOt && (
        <EnlaceBoton href={`/ordenes/nueva?reclamo=${r.id}`} data-abrir-ot>
          <FilePlus2 aria-hidden className="size-4" />
          Abrir su OT de garantía
        </EnlaceBoton>
      )}
      {r.puede_enlazar && ots.length > 0 && <EnlazarOt id={r.id} numero={r.numero} ots={ots} />}
      {r.puede_causa && <AnotarCausa id={r.id} numero={r.numero} />}
      {r.puede_no_procede && <NoProcede id={r.id} numero={r.numero} />}
      {r.puede_anular && <AnularReclamo id={r.id} numero={r.numero} />}
    </>
  )

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{r.numero}</span>}
        descripcion={`${unidad} · ${r.cliente}`}
        migas={[{ titulo: 'Reclamos de garantía', ruta: '/garantias' }, { titulo: r.numero }]}
        acciones={acciones}
        estado={<AvisoDelReclamo />}
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-center gap-2" data-situacion={r.situacion}>
              {s ? <Insignia tono={s.tono}>{s.etiqueta}</Insignia> : r.situacion}
              <DiasEnEspera dias={r.dias_en_espera} desde={r.creado_en} quien={s?.quien} verQuien />
            </div>
            <QueSigue reclamo={r} abreOt={abreOt} hayOts={ots.length > 0} />
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Unidad">{unidad}</Dato>
              <Dato titulo="Cliente">{r.cliente}</Dato>
              {r.trae && <Dato titulo="Quién lo trae">{r.trae}</Dato>}
              {r.contacto && <Dato titulo="Contacto">{r.contacto}</Dato>}
              <Dato titulo="Registró">
                {[r.registro, r.registro_puesto].filter(Boolean).join(' · ')}
                <span className="block text-xs text-texto-suave">{fechaHora(r.creado_en)}</span>
              </Dato>
            </div>
            <div>
              <p className="text-xs text-texto-suave">Qué reclama el cliente</p>
              <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{r.descripcion}</p>
            </div>
          </TarjetaCuerpo>
        </Tarjeta>

        {(r.orden_numero || r.cerrado_en || r.anulado_en) && (
          <Tarjeta>
            <TarjetaCabecera titulo="Cómo se atendió" />
            <TarjetaCuerpo className="space-y-3 text-sm">
              {r.orden_numero && (
                <div data-ot-del-reclamo>
                  <p className="text-xs text-texto-suave">OT de garantía</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2">
                    {veOt && r.orden_id ? (
                      <Link href={`/ordenes/${r.orden_id}`} className="tabular font-semibold text-acento hover:underline">
                        {r.orden_numero}
                      </Link>
                    ) : (
                      <span className="tabular font-semibold text-texto">{r.orden_numero}</span>
                    )}
                    {r.orden_estado && <Insignia tono={definir(ESTADO_OT, r.orden_estado).tono}>{definir(ESTADO_OT, r.orden_estado).etiqueta}</Insignia>}
                  </p>
                  {r.ot_enlazada_en && (
                    <p className="text-xs text-texto-suave">
                      Enlazada{r.enlazo ? ` por ${r.enlazo}` : ''}, {fechaHora(r.ot_enlazada_en)}
                    </p>
                  )}
                </div>
              )}
              {r.estado === 'CERRADO' && (
                <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2" data-causa>
                  <p className="flex flex-wrap items-center gap-2 font-medium text-texto">
                    Causa: {causa ? <Insignia tono={causa.tono}>{causa.etiqueta}</Insignia> : r.causa}
                  </p>
                  {r.causa_detalle && <p className="mt-1 whitespace-pre-wrap text-texto">{r.causa_detalle}</p>}
                  <p className="mt-1 text-xs text-texto-suave">
                    La anotó {[r.cerro, r.cerro_puesto].filter(Boolean).join(' · ')}
                    {r.cerrado_en ? `, ${fechaHora(r.cerrado_en)}` : ''}
                  </p>
                </div>
              )}
              {r.estado === 'NO_PROCEDE' && (
                <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2" data-no-procede>
                  <p className="font-medium text-texto">No procede</p>
                  {r.no_procede_motivo && <p className="mt-0.5 whitespace-pre-wrap text-texto-suave">{r.no_procede_motivo}</p>}
                  <p className="mt-1 text-xs text-texto-suave">
                    Lo cerró {[r.cerro, r.cerro_puesto].filter(Boolean).join(' · ')}
                    {r.cerrado_en ? `, ${fechaHora(r.cerrado_en)}` : ''}
                  </p>
                </div>
              )}
              {r.anulado_en && (
                <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2" data-anulado>
                  <p className="font-medium text-texto">
                    Anulado{r.anulo ? ` por ${r.anulo}` : ''}, {fechaHora(r.anulado_en)}
                  </p>
                  {r.motivo_anulacion && <p className="mt-0.5 whitespace-pre-wrap text-texto-suave">{r.motivo_anulacion}</p>}
                </div>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Tarjeta>
          <TarjetaCabecera titulo={`Fotos${r.fotosDelReclamo.length > 0 ? ` · ${r.fotosDelReclamo.length}` : ''}`} />
          <TarjetaCuerpo>
            {r.fotosDelReclamo.length === 0 ? (
              <SinDatos compacto titulo="Sin fotos" descripcion="El reclamo se registró sin fotos." />
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {r.fotosDelReclamo.map((f) => (
                  <li key={f.id}>
                    {f.enlace ? (
                      <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
                        {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
                        <img src={f.enlace} alt={`Foto ${f.orden} del reclamo ${r.numero}`} className="aspect-square w-full object-cover" loading="lazy" />
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
      </div>
    </>
  )
}

/** Qué sigue y quién lo hace, en una línea: lo que le toca a quien mira, o a quién espera. */
function QueSigue({
  reclamo: r,
  abreOt,
  hayOts,
}: {
  reclamo: NonNullable<Awaited<ReturnType<typeof cargarReclamo>>>
  abreOt: boolean
  hayOts: boolean
}) {
  let texto: string | null = null
  if (r.puede_enlazar) {
    const antes = r.situacion === 'OT_ANULADA' ? `Su OT ${r.orden_numero ?? ''} se anuló. ` : ''
    texto = abreOt
      ? `${antes}Te toca: abre su OT de garantía${hayOts ? ' o enlaza la que ya abriste' : ''}. Si no es una garantía, ciérralo como «No procede».`
      : `${antes}Te toca enlazar su OT de garantía.`
  } else if (r.puede_causa) {
    texto = 'Te toca: la garantía está terminada. Anota por qué falló y el reclamo se cierra.'
  } else if (r.situacion === 'EN_TALLER') {
    texto = 'El taller trabaja su OT de garantía. Cuando Administración la dé por terminada, Calidad anota la causa.'
  } else if (r.situacion !== 'CERRADO' && r.situacion !== 'NO_PROCEDE' && r.situacion !== 'ANULADO') {
    texto = SITUACION_RECLAMO[r.situacion]?.descripcion ?? null
  }
  if (!texto) return null
  return (
    <p className="max-w-3xl text-sm text-texto" data-que-sigue>
      {texto}
    </p>
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
