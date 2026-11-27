import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { AccionesDeFila, SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { archivosDelTramite, cargarTramite, gestionesDelTramite, type ArchivoDelTramite, type GestionDelTramite, type Tramite } from '@/lib/datos/tramites'
import { AMBITO_TRAMITE, CLASE_DE_ARCHIVO, nombreDeLaUnidad, PERMISOS_TRAMITES, plazoDelTramite, SITUACION_TRAMITE } from '@/lib/dominio/tramites'
import { fecha, fechaHora, hoyLima, tamanoArchivo } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { ActualizarTramite, AprobarAnulacion, AvisoDelTramite, NoAprobarAnulacion, PedirAnulacion } from './controles'
import { AnotarGestion, CerrarTramite, RetirarArchivo, SubirArchivo } from './expediente'

export const metadata = { title: 'Trámite' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un trámite: en qué va, su plazo, su expediente (los archivos y las gestiones,
 * entrega 2), de quién es y lo que se sabe de él. Arriba, lo que le toca a
 * quien mira, como lo dice la base (`puede_*`), con el mismo permiso que la
 * función que escribe.
 */
export default async function PaginaTramite({ params }: PageProps<'/tramites/[id]'>) {
  const perfil = await exigirSesion()
  if (!puede(perfil, [...PERMISOS_TRAMITES])) redirect('/sin-permiso')
  const { id } = await params
  if (!FORMA_DE_ID.test(id)) notFound()
  const [t, archivos, gestiones] = await Promise.all([cargarTramite(id), archivosDelTramite(id), gestionesDelTramite(id)])
  if (!t) notFound()
  const hoy = hoyLima()
  const enPie = archivos.filter((a) => !a.retirado_en)
  const retirados = archivos.filter((a) => a.retirado_en)
  const documentoFinal = enPie.find((a) => a.clase === 'DOCUMENTO_FINAL') ?? null
  // El número de la OT lleva a ella solo si quien mira abre las OT.
  const veOt = puede(perfil, ['ordenes.ver', 'ordenes.listar'])
  const s = SITUACION_TRAMITE[t.situacion]
  const plazo = plazoDelTramite(t.dias_para_limite)
  const deQuien = t.ambito === 'UNIDAD' ? nombreDeLaUnidad(t) : 'De la empresa'

  const acciones = (
    <>
      {/* La respuesta lleva la hora del pedido que esta ficha muestra: si se volvió a pedir, la base no responde por ella. */}
      {t.puede_resolver_anulacion && t.anulacion_pedida_en && (
        <AprobarAnulacion id={t.id} numero={t.numero} motivo={t.motivo_anulacion} pidio={t.anulacion_pidio} pedido={t.anulacion_pedida_en} />
      )}
      {t.puede_resolver_anulacion && t.anulacion_pedida_en && <NoAprobarAnulacion id={t.id} numero={t.numero} pedido={t.anulacion_pedida_en} />}
      {t.puede_actualizar && <ActualizarTramite tramite={t} hoy={hoy} />}
      {t.puede_concluir && <CerrarTramite tramite={t} hoy={hoy} />}
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
              {t.se_renueva && t.situacion !== 'ANULADO' && <Insignia tono="info">Se renueva</Insignia>}
            </div>
            <QueSigue tramite={t} />
            {/* El cierre: cuándo, quién y el documento que lo prueba, a un toque. */}
            {t.concluido_en && (
              <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm" data-concluido>
                <p className="font-medium text-texto">
                  {/* «Concluido» ya lo dice la insignia: aquí, de cuándo es su documento. */}
                  {t.estado === 'ANULADO' ? 'Estaba concluido: el ' : 'El '}
                  documento final es del {fecha(t.fecha_conclusion)}
                </p>
                {t.vigente_hasta && <p className="mt-1 text-texto">Vale hasta el {fecha(t.vigente_hasta)}.</p>}
                <p className="mt-1 text-xs text-texto-suave">
                  Lo cerró {t.concluyo ?? 'quien lo lleva'}, {fechaHora(t.concluido_en)}
                </p>
                {documentoFinal && (
                  <Link
                    href={`/tramites/archivo/${documentoFinal.id}`}
                    target="_blank"
                    prefetch={false}
                    className="mt-1 inline-flex min-h-11 items-center font-medium text-acento hover:underline"
                    data-ver-documento-final
                  >
                    Ver el documento final
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </Link>
                )}
              </div>
            )}
            {t.situacion === 'POR_ANULAR' && (
              <div className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm" data-pedido-de-anulacion>
                <p className="font-medium text-texto">
                  {t.anulacion_pidio ?? 'Quien lo lleva'} pidió anularlo{t.anulacion_pedida_en ? `, ${fechaHora(t.anulacion_pedida_en)}` : ''}
                </p>
                {t.motivo_anulacion && <p className="mt-1 whitespace-pre-wrap text-texto">{t.motivo_anulacion}</p>}
              </div>
            )}
            {/* Por qué se anuló, o por qué no: arriba, junto a cómo va. En el teléfono quedaba al fondo. */}
            {t.anulado_en && (
              <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm" data-anulado>
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
              <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm" data-anulacion-no-aprobada>
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

        <Tarjeta id="expediente">
          <TarjetaCabecera
            titulo="Expediente"
            // Vacío, lo dice el cuerpo de la tarjeta: aquí sería repetirlo.
            descripcion={enPie.length === 0 ? undefined : `${enPie.length} ${enPie.length === 1 ? 'archivo' : 'archivos'}`}
            ayuda="El cargo de presentación, los recibos de las tasas, lo que haga falta guardar y, al final, el documento que entrega la entidad. PDF o foto, hasta 20 MB cada uno. Un archivo no se borra: el que se subió por error se retira, con su motivo."
            acciones={t.puede_llevar_expediente ? <SubirArchivo tramiteId={t.id} numero={t.numero} /> : undefined}
          />
          {/* El verde de subir y de retirar, junto a su botón: en el teléfono el encabezado queda lejos. */}
          <AvisoDelTramite donde="expediente" className="border-b border-borde px-4 py-2" />
          <TarjetaCuerpo className="space-y-4">
            {enPie.length === 0 ? (
              <SinDatos
                compacto
                titulo="El expediente está vacío"
                descripcion={
                  t.puede_llevar_expediente
                    ? t.estado === 'POR_INICIAR'
                      ? 'Sube el cargo cuando presentes el trámite, y cada recibo que pagues.'
                      : 'Sube el cargo de presentación y cada recibo que pagues.'
                    : t.situacion === 'ANULADO'
                      ? 'El trámite se anuló sin archivos.'
                      : 'Quien lleva el trámite todavía no subió ningún archivo.'
                }
              />
            ) : (
              <ul className="divide-y divide-borde" data-archivos>
                {enPie.map((a) => (
                  <FilaDeArchivo key={a.id} archivo={a} cierraElTramite={a.clase === 'DOCUMENTO_FINAL' && t.estado === 'CONCLUIDO'} />
                ))}
              </ul>
            )}
            {retirados.length > 0 && (
              <Pliegue titulo={`Retirados (${retirados.length})`} data-archivos-retirados="">
                <ul className="divide-y divide-borde">
                  {retirados.map((a) => (
                    <FilaDeArchivo key={a.id} archivo={a} cierraElTramite={false} />
                  ))}
                </ul>
              </Pliegue>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta id="gestiones">
          <TarjetaCabecera
            titulo="Gestiones"
            descripcion={gestiones.length === 0 ? undefined : `${gestiones.length} ${gestiones.length === 1 ? 'anotada' : 'anotadas'}`}
            ayuda="La bitácora del trámite: cada ida a la entidad, cada llamada, cada entrega, con su fecha. Lo anotado no se corrige ni se borra."
            acciones={t.puede_llevar_expediente ? <AnotarGestion tramiteId={t.id} numero={t.numero} hoy={hoy} /> : undefined}
          />
          <AvisoDelTramite donde="gestiones" className="border-b border-borde px-4 py-2" />
          <TarjetaCuerpo>
            {gestiones.length === 0 ? (
              <SinDatos
                compacto
                titulo="Todavía no hay gestiones"
                descripcion={
                  t.puede_llevar_expediente
                    ? 'Anota cada vez que vayas a la entidad o te respondan: así se sabe qué se hizo y cuándo.'
                    : 'Quien lleva el trámite todavía no anotó ninguna.'
                }
              />
            ) : (
              <ol className="divide-y divide-borde" data-gestiones>
                {gestiones.map((g) => (
                  <FilaDeGestion key={g.id} gestion={g} />
                ))}
              </ol>
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
  } else if (t.situacion === 'CONCLUIDO') {
    texto = t.puede_llevar_expediente
      ? 'El expediente sigue abierto para lo que venga después: el cargo de entrega al cliente, una gestión.'
      : 'El documento que entregó la entidad está en el expediente.'
  } else if (t.puede_actualizar) {
    texto =
      t.estado === 'POR_INICIAR'
        ? 'Te toca: cuando lo presentes ante la entidad, anota la fecha y su número de expediente, y sube el cargo.'
        : t.estado === 'OBSERVADO'
          ? 'Te toca: subsana lo que observó la entidad y vuelve a ponerlo «En trámite».'
          : 'En la entidad. Anota cada gestión y, cuando te entreguen el documento, ciérralo subiéndolo.'
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

/** Un archivo del expediente: qué es, quién lo subió y cuándo, y abrirlo. El retirado dice por qué. */
function FilaDeArchivo({ archivo: a, cierraElTramite }: { archivo: ArchivoDelTramite; cierraElTramite: boolean }) {
  const clase = CLASE_DE_ARCHIVO[a.clase]
  // Cómo se lee: su descripción, o el nombre con que se subió.
  const nombre = a.descripcion ?? a.nombre ?? clase?.etiqueta ?? 'Archivo'
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0" data-archivo={a.clase} data-retirado={a.retirado_en ? '' : undefined}>
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {clase ? <Insignia tono={a.retirado_en ? 'neutro' : clase.tono}>{clase.etiqueta}</Insignia> : a.clase}
          {a.retirado_en && <Insignia tono="neutro">Retirado</Insignia>}
        </div>
        <p className={a.retirado_en ? 'text-sm break-words text-texto-suave line-through' : 'text-sm font-medium break-words text-texto'}>{nombre}</p>
        <p className="text-xs break-words text-texto-suave">
          {[a.descripcion ? a.nombre : null, tamanoArchivo(a.tamano), `Lo subió ${a.subio}, ${fechaHora(a.subido_en)}`].filter(Boolean).join(' · ')}
        </p>
        {a.retirado_en && (
          <p className="text-xs break-words text-texto" data-motivo-del-retiro>
            Lo retiró {a.retiro ?? 'quien lleva el trámite'}, {fechaHora(a.retirado_en)}: {a.retiro_motivo}
          </p>
        )}
      </div>
      <AccionesDeFila>
        <EnlaceBoton href={`/tramites/archivo/${a.id}`} target="_blank" prefetch={false} variante="contorno" tamano="sm" aria-label={`Ver ${nombre} (se abre en otra pestaña)`} data-ver-archivo>
          Ver
        </EnlaceBoton>
        {a.puede_retirar && <RetirarArchivo id={a.id} nombre={nombre} esElFinal={cierraElTramite} />}
      </AccionesDeFila>
    </li>
  )
}

/** Una gestión de la bitácora: su fecha, qué se hizo y quién la anotó. */
function FilaDeGestion({ gestion: g }: { gestion: GestionDelTramite }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-gestion>
      <p className="tabular text-xs font-medium text-texto-suave">{fecha(g.fecha)}</p>
      <p className="mt-1 max-w-3xl text-sm break-words whitespace-pre-wrap text-texto">{g.detalle}</p>
      <p className="mt-1 text-xs text-texto-suave">
        Anotó {g.anoto}, {fechaHora(g.anotado_en)}
      </p>
    </li>
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
