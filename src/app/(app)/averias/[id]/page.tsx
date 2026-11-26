import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarAveria } from '@/lib/datos/averias'
import { recorridoDeAverias } from '@/lib/datos/recorrido'
import { ESTADO_AVERIA, TIPO_AVERIA } from '@/lib/dominio/averias'
import { ESTADO_EQUIPO, type EstadoEquipo } from '@/lib/dominio/equipos'
import { describirRecorridoDeLaAveria } from '@/lib/dominio/recorrido'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { AnularAveria, AvisoDeLaAnulacion } from './controles'

export const metadata = { title: 'Reporte de avería' }

const FORMA_DE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un reporte de avería: qué le pasa al equipo, su recorrido y sus fotos. Quien
 * lo reportó ve cómo va; su área, también; Mantenimiento y Gerencia, todos. Lo
 * que cada quien ve lo decide la base.
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

  const tipo = TIPO_AVERIA[a.tipo]
  const estado = ESTADO_AVERIA[a.estado]
  const anulada = a.estado === 'ANULADA'
  // El mismo permiso que pide `averias_anular`.
  const anula = puede(perfil, 'averias.atender') && !anulada
  const estadoEquipo = ESTADO_EQUIPO[a.equipo_estado as EstadoEquipo]
  const veTodo = puede(perfil, ['averias.atender', 'averias.ver'])

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{a.numero}</span>}
        descripcion={`${tipo?.etiqueta ?? a.tipo} · ${a.equipo_codigo} · ${a.equipo_descripcion}`}
        migas={[{ titulo: veTodo ? 'Averías de equipos' : 'Reportar avería', ruta: '/averias' }, { titulo: a.numero }]}
        acciones={anula && <AnularAveria id={a.id} numero={a.numero} paroElEquipo={a.paro_el_equipo} />}
        estado={<AvisoDeLaAnulacion />}
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Tipo">
                <span className="flex flex-wrap gap-1.5">
                  {tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : a.tipo}
                  {/* Anulado, lo urgente ya no se pinta en rojo, como en la lista: se lee en texto. */}
                  {a.detiene_trabajo && (anulada ? <Insignia>Decía que detiene el trabajo</Insignia> : <Insignia tono="peligro">Detiene el trabajo</Insignia>)}
                  {a.riesgo_personas &&
                    (anulada ? <Insignia>Decía que es un riesgo para las personas</Insignia> : <Insignia tono="peligro">Riesgo para las personas</Insignia>)}
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
            {a.paro_el_equipo && !anulada && (
              <p className="text-xs text-texto-suave" data-dejo-parado>
                Este reporte dejó el equipo parado en el padrón. Vuelve a operativo cuando Mantenimiento cierre la avería.
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

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <div className="tabular text-texto">{children}</div>
    </div>
  )
}
