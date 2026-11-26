import { TriangleAlert } from 'lucide-react'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarInspeccionSsoma, cuentasParaAsignar, historiaDeAccion, listarAccionesSsoma } from '@/lib/datos/ssoma'
import { RESULTADO_INSPECCION, TIPO_INSPECCION_SSOMA } from '@/lib/dominio/ssoma'
import { fecha, fechaHora, hoyLima } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { AgregarAccion } from '../../[id]/controles'
import { FilaAccion } from '../../fila-accion'
import { AnularInspeccion } from '../controles'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'Seguridad: inspección' }

/**
 * Una inspección: el área, la fecha, cada punto de la lista con su resultado y,
 * de cada punto no conforme, lo que se encontró y la acción que lo corrige.
 * SSOMA y Gerencia la ven entera; quien tiene a cargo una de sus acciones ve
 * solo el hallazgo que le toca. Lo que cada quien ve lo decide la base.
 */
export default async function PaginaInspeccionSsoma({ params }: PageProps<'/ssoma/inspecciones/[id]'>) {
  // Sin permiso de módulo a propósito: llega también el responsable de una acción, de cualquier puesto.
  const perfil = await exigirSesion()
  const { id } = await params
  if (!GUID.test(id)) notFound()
  // El mismo permiso que piden las funciones de SSOMA en la base.
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const [detalle, acciones, cuentas] = await Promise.all([
    cargarInspeccionSsoma(id),
    listarAccionesSsoma({ inspeccion: id }),
    gestiona ? cuentasParaAsignar() : Promise.resolve([]),
  ])
  if (!detalle) notFound()
  const { inspeccion: i, respuestas } = detalle
  const historias = await Promise.all(acciones.map((a) => historiaDeAccion(a.id)))
  const hoy = hoyLima()

  const entera = i.alcance === 'TODOS'
  const anulada = Boolean(i.anulado_en)
  const tipo = TIPO_INSPECCION_SSOMA[i.tipo]
  const hallazgos = respuestas.filter((r) => r.resultado === 'NO_CONFORME')
  const vivas = acciones.filter((a) => a.estado !== 'ANULADA').length
  // Una inspección con acciones vigentes no se anula (`ssoma_anular_inspeccion`).
  const anula = gestiona && !anulada && vivas === 0

  return (
    <>
      <EncabezadoPagina
        titulo={`Inspección de ${i.area}`}
        descripcion={`${tipo?.etiqueta ?? 'Inspección'} del ${fecha(i.fecha)}`}
        migas={[
          { titulo: 'SSOMA', ruta: '/ssoma' },
          // La lista es de SSOMA y Gerencia: al responsable de una acción lo devuelve a las suyas.
          entera ? { titulo: 'Inspecciones', ruta: '/ssoma/inspecciones' } : { titulo: 'Mis acciones', ruta: '/ssoma?vista=acciones' },
          { titulo: i.area },
        ]}
        acciones={anula && <AnularInspeccion id={i.id} area={i.area} />}
      />

      <div className="space-y-5">
        {anulada && (
          <div role="note" className="rounded-[var(--radius-base)] border border-borde bg-neutro-suave px-4 py-3 text-sm text-texto" data-inspeccion-anulada>
            <p className="font-medium">
              Anulada{i.anulo ? ` por ${i.anulo}` : ''}
              {i.anulado_en ? ` el ${fechaHora(i.anulado_en)}` : ''}
            </p>
            <p className="mt-1">Ya no cuenta como la última inspección del área.</p>
            {i.motivo_anulacion && <p className="mt-1 text-texto-suave">Motivo: {i.motivo_anulacion}</p>}
          </div>
        )}

        {!entera && (
          <p role="note" className="rounded-[var(--radius-base)] border border-borde bg-superficie-2 px-4 py-3 text-sm text-texto" data-solo-mi-hallazgo>
            Ves de esta inspección solo lo que te toca: lo que se encontró y la acción que tienes a cargo. El resto lo ven SSOMA y Gerencia.
          </p>
        )}

        {entera && (
          <Tarjeta>
            <TarjetaCuerpo>
              <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
                <Dato titulo="Área">{i.area}</Dato>
                <Dato titulo="Fecha">{fecha(i.fecha)}</Dato>
                <Dato titulo="Cómo fue">{tipo ? <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia> : i.tipo}</Dato>
                <Dato titulo="Resultado">
                  <span data-resultado-inspeccion>
                    {i.conformes} {i.conformes === 1 ? 'conforme' : 'conformes'} · {i.no_conformes} no {i.no_conformes === 1 ? 'conforme' : 'conformes'}
                    {i.no_aplica > 0 ? ` · ${i.no_aplica} no ${i.no_aplica === 1 ? 'aplica' : 'aplican'}` : ''}
                  </span>
                </Dato>
                <Dato titulo="Registró">
                  {i.registro ?? '—'} <span className="text-xs text-texto-suave">· {fechaHora(i.creado_en)}</span>
                </Dato>
              </div>
              {i.observacion && (
                <div className="mt-4 text-sm">
                  <p className="text-xs text-texto-suave">Observación</p>
                  <p className="max-w-3xl whitespace-pre-wrap text-texto">{i.observacion}</p>
                </div>
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        <Tarjeta id="hallazgos" className="scroll-mt-20">
          <TarjetaCabecera
            titulo={entera ? `Hallazgos${hallazgos.length > 0 ? ` · ${hallazgos.length}` : ''}` : hallazgos.length === 1 ? 'El hallazgo' : 'Los hallazgos'}
            ayuda="Cada punto que no estaba conforme, con lo que se encontró y la acción que lo corrige. La acción la cierra su responsable con fotos de lo que hizo; SSOMA la revisa."
          />
          <TarjetaCuerpo>
            {hallazgos.length === 0 ? (
              <div data-sin-hallazgos>
                <SinDatos compacto titulo="Todo conforme" descripcion="En esta inspección no se encontró nada que corregir." />
              </div>
            ) : (
              <ol className="space-y-5">
                {hallazgos.map((h) => {
                  const suyas = acciones.flatMap((a, n) => (a.respuesta_id === h.id ? [{ accion: a, historia: historias[n] ?? [] }] : []))
                  const sinVigente = !suyas.some((s) => s.accion.estado !== 'ANULADA')
                  return (
                    <li key={h.id} className="rounded-[var(--radius-base)] border border-borde" data-hallazgo={h.id} data-sin-accion={sinVigente || undefined}>
                      <div className="space-y-1 border-b border-borde px-4 py-3">
                        <p className="text-xs text-texto-suave">
                          <span className="tabular">Punto {h.orden}</span> · {h.texto}
                        </p>
                        <p className="max-w-3xl text-sm font-medium whitespace-pre-wrap text-texto">{h.hallazgo}</p>
                      </div>
                      <div className="px-4 py-3">
                        {sinVigente && !anulada && (
                          <p className="mb-3 flex items-start gap-2 text-sm text-peligro" data-aviso-sin-accion>
                            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                            <span>
                              Este hallazgo quedó sin acción vigente: nadie tiene encargado corregirlo.
                              {gestiona ? ' Encárgale una con «Agregar acción».' : ''}
                            </span>
                          </p>
                        )}
                        {suyas.length > 0 && (
                          <ul className="divide-y divide-borde">
                            {suyas.map(({ accion, historia }) => (
                              <FilaAccion
                                key={accion.id}
                                accion={accion}
                                historia={historia}
                                esMia={accion.responsable_id === perfil.id}
                                gestiona={gestiona}
                                cuentaId={perfil.id}
                                cuentas={cuentas}
                                hoy={hoy}
                              />
                            ))}
                          </ul>
                        )}
                        {/* Otra acción es la excepción: va después de la que ya tiene. Sin ninguna vigente, es lo que toca. */}
                        {gestiona && !anulada && (
                          <div className={suyas.length > 0 ? 'mt-3 flex justify-end border-t border-borde pt-3' : 'flex justify-start'}>
                            <AgregarAccion
                              respuestaId={h.id}
                              numero={`hallazgo del punto ${h.orden}`}
                              cuentas={cuentas}
                              hoy={hoy}
                              discreto={!sinVigente}
                            />
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {entera && (
          <Tarjeta>
            <TarjetaCabecera
              titulo={`Lista de verificación · ${respuestas.length}`}
              ayuda="Los puntos como estaban escritos el día de la inspección: si después la lista cambió, aquí no cambia."
            />
            <TarjetaCuerpo>
              <ol className="divide-y divide-borde">
                {respuestas.map((r) => {
                  const resultado = RESULTADO_INSPECCION[r.resultado]
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0" data-respuesta={r.id} data-resultado={r.resultado}>
                      <p className="min-w-0 text-sm text-texto">
                        <span className="tabular text-texto-suave">{r.orden}.</span> {r.texto}
                      </p>
                      <span className="shrink-0">{resultado ? <Insignia tono={resultado.tono}>{resultado.etiqueta}</Insignia> : r.resultado}</span>
                    </li>
                  )
                })}
              </ol>
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
