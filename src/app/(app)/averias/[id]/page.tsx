import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarAveria, rqParaEnlazar, type DetalleAveria } from '@/lib/datos/averias'
import { recorridoDeAverias } from '@/lib/datos/recorrido'
import { ESTADO_AVERIA, horas, horasParadoSugeridas, TIPO_AVERIA } from '@/lib/dominio/averias'
import { ESTADO_EQUIPO, type EstadoEquipo } from '@/lib/dominio/equipos'
import { describirRecorridoDeLaAveria } from '@/lib/dominio/recorrido'
import { ESTADO_REQUERIMIENTO_DEL_CODIGO } from '@/lib/dominio/requerimientos'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import {
  AnularAveria,
  AtenderAveria,
  AvisoDeLaFicha,
  CerrarAveria,
  ConfirmarAveria,
  EnlazarRequerimiento,
  QuitarRequerimiento,
} from './controles'

export const metadata = { title: 'Reporte de avería' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un reporte de avería: qué le pasa al equipo, cómo lo atiende Mantenimiento,
 * su recorrido y sus fotos. Quien lo reportó ve cómo va y confirma si quedó
 * bien; su área, también lo ve; Mantenimiento lo atiende y Gerencia lo consulta.
 * Lo que cada quien ve lo decide la base.
 */
export default async function PaginaAveria({ params }: PageProps<'/averias/[id]'>) {
  const perfil = await exigirSesion()
  const { id } = await params
  if (!FORMA_DE_ID.test(id)) notFound()
  const [a, recorridos] = await Promise.all([
    cargarAveria(id),
    // Sin recorrido la ficha igual sirve: el componente dice que no se pudo leer.
    recorridoDeAverias([id]).catch((e: unknown) => {
      console.error(e)
      return null
    }),
  ])
  if (!a) notFound()

  // El mismo permiso que piden las funciones de la base.
  const atiende = puede(perfil, 'averias.atender')
  const enAtencion = a.estado === 'EN_ATENCION'
  const vigenteParaMantenimiento = a.estado === 'REPORTADA' || enAtencion
  // Solo quien la reportó confirma; la base lo vuelve a mirar.
  const confirma = a.es_mia && a.estado === 'CERRADA'
  const opcionesRq = atiende && enAtencion ? await rqParaEnlazar() : []

  const tipo = TIPO_AVERIA[a.tipo]
  const estado = ESTADO_AVERIA[a.estado]
  const anulada = a.estado === 'ANULADA'
  const estadoEquipo = ESTADO_EQUIPO[a.equipo_estado as EstadoEquipo]
  const veTodo = puede(perfil, ['averias.atender', 'averias.ver'])

  const acciones = (
    <>
      {confirma && <ConfirmarAveria id={a.id} numero={a.numero} detieneElTrabajo={a.detiene_trabajo} />}
      {atiende && enAtencion && (
        <CerrarAveria
          id={a.id}
          numero={a.numero}
          horasSugeridas={horasParadoSugeridas(a.equipo_parado_desde)}
          dejaOperativo={a.equipo_parado_desde != null}
        />
      )}
      {atiende && vigenteParaMantenimiento && <AtenderAveria id={a.id} numero={a.numero} diagnostico={a.diagnostico} />}
      {atiende && vigenteParaMantenimiento && <AnularAveria id={a.id} numero={a.numero} paroElEquipo={a.paro_el_equipo} />}
    </>
  )

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{a.numero}</span>}
        descripcion={`${tipo?.etiqueta ?? a.tipo} · ${a.equipo_codigo} · ${a.equipo_descripcion}`}
        migas={[{ titulo: veTodo ? 'Averías de equipos' : 'Reportar avería', ruta: '/averias' }, { titulo: a.numero }]}
        acciones={acciones}
        estado={<AvisoDeLaFicha averia={a.id} />}
      />

      <div className="space-y-5">
        <QuienLaTiene averia={a} atiende={atiende} />

        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Tipo">
                <span className="flex flex-wrap gap-1.5">
                  {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : a.tipo}
                  {/* Lo urgente se pinta en rojo solo mientras espera a Mantenimiento, como en la lista; después se lee en texto. */}
                  {a.detiene_trabajo &&
                    (anulada ? (
                      <Insignia>Decía que detiene el trabajo</Insignia>
                    ) : vigenteParaMantenimiento ? (
                      <Insignia tono="peligro">Detiene el trabajo</Insignia>
                    ) : (
                      <Insignia>Detenía el trabajo</Insignia>
                    ))}
                  {a.riesgo_personas &&
                    (anulada ? (
                      <Insignia>Decía que es un riesgo para las personas</Insignia>
                    ) : vigenteParaMantenimiento ? (
                      <Insignia tono="peligro">Riesgo para las personas</Insignia>
                    ) : (
                      <Insignia>Era un riesgo para las personas</Insignia>
                    ))}
                </span>
              </Dato>
              <Dato titulo="Cómo va">{estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : a.estado}</Dato>
              <Dato titulo="Equipo">
                {a.equipo_codigo} · {a.equipo_descripcion}
              </Dato>
              {(a.area || a.equipo_ubicacion) && <Dato titulo="Dónde">{[a.area, a.equipo_ubicacion].filter(Boolean).join(' · ')}</Dato>}
              <Dato titulo="El equipo hoy">{estadoEquipo ? <Insignia tono={estadoEquipo.tono}>{estadoEquipo.etiqueta}</Insignia> : a.equipo_estado}</Dato>
              <Dato titulo="Reportó">
                {[a.reporto, a.reporto_puesto].filter(Boolean).join(' · ')}
                <span className="block text-xs text-texto-suave">{fechaHora(a.creado_en)}</span>
              </Dato>
            </div>
            <div>
              <p className="text-xs text-texto-suave">Qué hace el equipo</p>
              <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{a.descripcion}</p>
            </div>
            {a.paro_el_equipo && vigenteParaMantenimiento && (
              <p className="text-xs text-texto-suave" data-dejo-parado>
                Este reporte tiene el equipo parado en el padrón. Vuelve a operativo cuando Mantenimiento cierre la avería.
              </p>
            )}
            {anulada && (
              <div className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-3 py-2 text-sm" data-anulada>
                <p className="font-medium text-texto">
                  Anulado{a.anulo ? ` por ${a.anulo}` : ''}
                  {a.anulado_en ? `, ${fechaHora(a.anulado_en)}` : ''}
                </p>
                {a.motivo_anulacion && <p className="mt-0.5 whitespace-pre-wrap text-texto-suave">{a.motivo_anulacion}</p>}
              </div>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Atencion averia={a} atiende={atiende} opcionesRq={opcionesRq} />

        <Tarjeta className="overflow-hidden">
          <Recorrido pasos={recorridos ? describirRecorridoDeLaAveria(recorridos.get(a.id) ?? []) : null} femenino />
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera titulo={`Fotos${a.fotosDelReporte.length > 0 ? ` · ${a.fotosDelReporte.length}` : ''}`} />
          <TarjetaCuerpo>
            {a.fotosDelReporte.length === 0 ? (
              <SinDatos compacto titulo="Sin fotos" descripcion="El reporte se envió sin fotos." />
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {a.fotosDelReporte.map((f) => (
                  <li key={f.id}>
                    {f.enlace ? (
                      <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
                        {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
                        <img src={f.enlace} alt={`Foto ${f.orden} del reporte ${a.numero}`} className="aspect-square w-full object-cover" loading="lazy" />
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

/**
 * Lo primero que se lee: a quién espera el reporte y qué falta, dicho para
 * quien mira. Lo que esa persona puede hacer está en los botones de arriba.
 */
function QuienLaTiene({ averia: a, atiende }: { averia: DetalleAveria; atiende: boolean }) {
  let texto: string | null = null
  if (a.estado === 'REPORTADA') {
    texto = atiende ? 'Espera tu diagnóstico: revisa el equipo y toca «Atender».' : 'Mantenimiento todavía no la revisa.'
  } else if (a.estado === 'EN_ATENCION') {
    texto = atiende
      ? 'La estás atendiendo. Enlaza el RQ si pediste repuestos, y ciérrala con el trabajo hecho cuando quede.'
      : 'Mantenimiento la está atendiendo.'
    if (a.veces_reabierta > 0) texto = `Volvió porque no quedó bien. ${texto}`
  } else if (a.estado === 'CERRADA') {
    texto = a.es_mia
      ? 'Mantenimiento la cerró. Prueba el equipo y toca «¿Quedó bien?».'
      : 'Mantenimiento la cerró: espera que quien la reportó confirme si quedó bien.'
  }
  if (!texto) return null
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-4 py-3 text-sm text-texto"
      data-quien-la-tiene={a.espera_de ?? undefined}
    >
      <p className="font-medium">{texto}</p>
      <DiasEnEspera
        dias={a.dias_en_espera}
        desde={a.espera_desde}
        quien={a.espera_de === 'QUIEN_REPORTO' ? 'quien la reportó' : 'Mantenimiento'}
      />
    </div>
  )
}

/** Lo que anotó Mantenimiento: diagnóstico, repuestos, trabajo hecho y horas parado; y lo que dijo quien la reportó. */
function Atencion({
  averia: a,
  atiende,
  opcionesRq,
}: {
  averia: DetalleAveria
  atiende: boolean
  opcionesRq: Awaited<ReturnType<typeof rqParaEnlazar>>
}) {
  const enlaza = atiende && a.estado === 'EN_ATENCION'
  const cerrada = a.estado === 'CERRADA' || a.estado === 'CONFIRMADA'
  if (a.estado === 'ANULADA' && !a.diagnostico) return null
  return (
    <Tarjeta data-atencion>
      <TarjetaCabecera titulo="Atención de Mantenimiento" />
      <TarjetaCuerpo className="space-y-5">
        {!a.diagnostico ? (
          <SinDatos compacto titulo="Todavía sin diagnóstico" descripcion="Mantenimiento anota aquí qué tiene el equipo cuando lo revisa." />
        ) : (
          <Bloque titulo="Diagnóstico" pie={[a.atendio, a.atendida_en ? fechaHora(a.atendida_en) : null]}>
            {a.diagnostico}
          </Bloque>
        )}

        {a.veces_reabierta > 0 && a.estado === 'EN_ATENCION' && a.nota_de_quien_reporto && (
          <div className="rounded-[var(--radius-base)] border border-aviso/40 bg-aviso-suave px-3 py-2 text-sm" data-no-quedo-bien>
            <p className="font-medium text-texto">
              No quedó bien{a.veces_reabierta > 1 ? ` (${a.veces_reabierta} veces)` : ''}: lo dijo quien la reportó
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-texto">{a.nota_de_quien_reporto}</p>
          </div>
        )}

        {(a.diagnostico || a.requerimientos.length > 0) && (
          <section aria-labelledby={`repuestos-${a.id}`} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`repuestos-${a.id}`} className="text-xs font-medium text-texto-suave">
                Repuestos pedidos
              </h3>
              {enlaza && <EnlazarRequerimiento averia={a.id} opciones={opcionesRq} />}
            </div>
            {a.requerimientos.length === 0 ? (
              <p className="text-sm text-texto-suave">
                {enlaza ? 'Si pediste repuestos con un RQ, enlázalo para que se vea cómo va.' : 'Ninguno enlazado.'}
              </p>
            ) : (
              <ul className="divide-y divide-borde rounded-[var(--radius-base)] border border-borde">
                {a.requerimientos.map((r) => {
                  const est = ESTADO_REQUERIMIENTO_DEL_CODIGO[r.estado]
                  return (
                    <li key={r.enlace} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm" data-rq-enlazado={r.numero}>
                      {r.puede_abrir ? (
                        <Link href={`/requerimientos?rq=${r.requerimiento}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
                          {r.numero}
                        </Link>
                      ) : (
                        <span className="tabular font-semibold text-texto">{r.numero}</span>
                      )}
                      {est ? <Insignia tono={est.tono}>{est.etiqueta}</Insignia> : r.estado}
                      <span className="min-w-[12rem] flex-1 text-texto">{r.nota}</span>
                      {enlaza && <QuitarRequerimiento averia={a.id} enlace={r.enlace} numero={r.numero} />}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {cerrada && a.trabajo_hecho && (
          <Bloque titulo="Trabajo hecho" pie={[a.cerro, a.cerrada_en ? fechaHora(a.cerrada_en) : null]}>
            {a.trabajo_hecho}
            {a.horas_parado != null && (
              <span className="mt-2 block text-sm" data-horas-parado={a.horas_parado}>
                <span className="text-texto-suave">Parado: </span>
                <span className="tabular font-medium">{horas(a.horas_parado)}</span>
              </span>
            )}
          </Bloque>
        )}

        {a.estado === 'CONFIRMADA' && (
          <Bloque titulo="Quien la reportó confirmó que quedó bien" pie={[a.confirmada_en ? fechaHora(a.confirmada_en) : null]}>
            {a.nota_de_quien_reporto ?? 'Sin nota.'}
          </Bloque>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function Bloque({ titulo, pie, children }: { titulo: string; pie: (string | null)[]; children: React.ReactNode }) {
  const linea = pie.filter(Boolean).join(' · ')
  return (
    <div>
      <p className="text-xs font-medium text-texto-suave">{titulo}</p>
      <div className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{children}</div>
      {linea && <p className="mt-1 text-xs text-texto-suave">{linea}</p>}
    </div>
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
