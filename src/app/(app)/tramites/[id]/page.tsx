import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarTramite, type Tramite } from '@/lib/datos/tramites'
import { AMBITO_TRAMITE, nombreDeLaUnidad, PERMISOS_TRAMITES, plazoDelTramite, SITUACION_TRAMITE } from '@/lib/dominio/tramites'
import { fecha, fechaHora, hoyLima } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { ActualizarTramite, AprobarAnulacion, AvisoDelTramite, NoAprobarAnulacion, PedirAnulacion } from './controles'

export const metadata = { title: 'Trámite' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un trámite: en qué va, su plazo, de quién es y lo que se sabe de él. Arriba,
 * lo que le toca a quien mira, como lo dice la base (`puede_*`), con el mismo
 * permiso que la función que escribe.
 */
export default async function PaginaTramite({ params }: PageProps<'/tramites/[id]'>) {
  const perfil = await exigirSesion()
  if (!puede(perfil, [...PERMISOS_TRAMITES])) redirect('/sin-permiso')
  const { id } = await params
  if (!FORMA_DE_ID.test(id)) notFound()
  const t = await cargarTramite(id)
  if (!t) notFound()
  // El número de la OT lleva a ella solo si quien mira abre las OT.
  const veOt = puede(perfil, ['ordenes.ver', 'ordenes.listar'])
  const s = SITUACION_TRAMITE[t.situacion]
  const plazo = plazoDelTramite(t.dias_para_limite)
  const deQuien = t.ambito === 'UNIDAD' ? nombreDeLaUnidad(t) : 'De la empresa'

  const acciones = (
    <>
      {t.puede_resolver_anulacion && <AprobarAnulacion id={t.id} numero={t.numero} motivo={t.motivo_anulacion} pidio={t.anulacion_pidio} />}
      {t.puede_resolver_anulacion && <NoAprobarAnulacion id={t.id} numero={t.numero} />}
      {t.puede_actualizar && <ActualizarTramite tramite={t} hoy={hoyLima()} />}
      {t.puede_pedir_anulacion && <PedirAnulacion id={t.id} numero={t.numero} />}
    </>
  )

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{t.numero}</span>}
        descripcion={[t.tipo, deQuien, t.cliente].filter(Boolean).join(' · ')}
        migas={[{ titulo: 'Trámites', ruta: '/tramites' }, { titulo: t.numero }]}
        acciones={acciones}
        estado={<AvisoDelTramite />}
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-center gap-2" data-situacion={t.situacion}>
              {s ? <Insignia tono={s.tono}>{s.etiqueta}</Insignia> : t.situacion}
              {plazo && (
                <Insignia tono={plazo.tono} className="tabular" data-plazo={t.dias_para_limite ?? undefined}>
                  {plazo.texto}
                </Insignia>
              )}
              {t.se_renueva && <Insignia tono="info">Se renueva</Insignia>}
            </div>
            <QueSigue tramite={t} />
            {t.situacion === 'POR_ANULAR' && (
              <div className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm" data-pedido-de-anulacion>
                <p className="font-medium text-texto">
                  {t.anulacion_pidio ?? 'Quien lo lleva'} pidió anularlo{t.anulacion_pedida_en ? `, ${fechaHora(t.anulacion_pedida_en)}` : ''}
                </p>
                {t.motivo_anulacion && <p className="mt-1 whitespace-pre-wrap text-texto">{t.motivo_anulacion}</p>}
              </div>
            )}
            <div>
              <p className="text-xs text-texto-suave">Qué se tramita</p>
              <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{t.asunto}</p>
            </div>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Entidad">{t.entidad}</Dato>
              <Dato titulo="N.º de expediente">{t.expediente ?? <Falta>Sin número todavía</Falta>}</Dato>
              <Dato titulo="Se presentó el">{t.fecha_inicio ? fecha(t.fecha_inicio) : <Falta>Todavía no se presenta</Falta>}</Dato>
              <Dato titulo="Fecha límite">{t.fecha_limite ? fecha(t.fecha_limite) : <Falta>Sin fecha límite</Falta>}</Dato>
            </div>
            {t.nota && (
              <div data-nota>
                <p className="text-xs text-texto-suave">{t.estado === 'OBSERVADO' ? 'Qué observó la entidad' : 'Nota'}</p>
                <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{t.nota}</p>
              </div>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera titulo="De quién es" />
          <TarjetaCuerpo>
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Tipo">
                {t.tipo}
                <span className="block text-xs text-texto-suave">{AMBITO_TRAMITE[t.ambito]?.etiqueta ?? t.ambito}</span>
              </Dato>
              {t.ambito === 'UNIDAD' && <Dato titulo="Unidad">{nombreDeLaUnidad(t)}</Dato>}
              {t.cliente && <Dato titulo="Cliente">{t.cliente}</Dato>}
              {t.orden_numero && (
                <Dato titulo="OT">
                  {veOt && t.orden_id ? (
                    <Link href={`/ordenes/${t.orden_id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
                      {t.orden_numero}
                    </Link>
                  ) : (
                    <span className="tabular font-semibold">{t.orden_numero}</span>
                  )}
                </Dato>
              )}
              <Dato titulo="Registró">
                {[t.registro, t.registro_puesto].filter(Boolean).join(' · ')}
                <span className="block text-xs text-texto-suave">{fechaHora(t.creado_en)}</span>
              </Dato>
            </div>
          </TarjetaCuerpo>
        </Tarjeta>

        {(t.anulado_en || t.anulacion_rechazada_en) && (
          <Tarjeta>
            <TarjetaCabecera titulo="Anulación" />
            <TarjetaCuerpo className="space-y-3 text-sm">
              {t.anulado_en && (
                <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2" data-anulado>
                  <p className="font-medium text-texto">
                    Anulado con el visto de {t.anulo ?? 'Gerencia'}, {fechaHora(t.anulado_en)}
                  </p>
                  {t.motivo_anulacion && <p className="mt-1 whitespace-pre-wrap text-texto">{t.motivo_anulacion}</p>}
                  <p className="mt-1 text-xs text-texto-suave">
                    Lo pidió {t.anulacion_pidio ?? 'quien lo lleva'}
                    {t.anulacion_pedida_en ? `, ${fechaHora(t.anulacion_pedida_en)}` : ''}
                  </p>
                </div>
              )}
              {t.anulacion_rechazada_en && (
                <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2" data-anulacion-no-aprobada>
                  <p className="font-medium text-texto">
                    {t.anulacion_rechazo ?? 'Gerencia'} no aprobó anularlo, {fechaHora(t.anulacion_rechazada_en)}
                  </p>
                  {t.anulacion_rechazo_motivo && <p className="mt-1 whitespace-pre-wrap text-texto">{t.anulacion_rechazo_motivo}</p>}
                  <p className="mt-1 text-xs text-texto-suave">
                    Lo había pedido {t.anulacion_pidio ?? 'quien lo lleva'}
                    {t.motivo_anulacion ? `: «${t.motivo_anulacion}»` : ''}
                  </p>
                </div>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </div>
    </>
  )
}

/** Qué sigue y quién lo hace, en una línea: lo que le toca a quien mira, o a quién espera. */
function QueSigue({ tramite: t }: { tramite: Tramite }) {
  let texto: string | null = null
  if (t.puede_resolver_anulacion) {
    texto = 'Te toca: aprueba la anulación o di por qué no. Mientras tanto el trámite no se cambia.'
  } else if (t.situacion === 'POR_ANULAR') {
    texto = 'Espera el visto de Gerencia para anularse. Hasta que responda, no se cambia.'
  } else if (t.situacion === 'ANULADO') {
    texto = null
  } else if (t.puede_actualizar) {
    texto =
      t.estado === 'POR_INICIAR'
        ? 'Te toca: cuando lo presentes ante la entidad, anota la fecha y su número de expediente.'
        : t.estado === 'OBSERVADO'
          ? 'Te toca: subsana lo que observó la entidad y vuelve a ponerlo «En trámite».'
          : 'En la entidad. Anota aquí cada cambio: una observación, una nueva fecha límite.'
  } else {
    texto = SITUACION_TRAMITE[t.situacion]?.descripcion ?? null
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

function Falta({ children }: { children: React.ReactNode }) {
  return <span className="text-texto-suave">{children}</span>
}
