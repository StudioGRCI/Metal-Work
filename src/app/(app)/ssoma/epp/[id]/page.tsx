import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { AccionesDeFila, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { entregasDeEpp, eppPorPersona, type EntregaDeEpp } from '@/lib/datos/ssoma'
import { cuandoSeRenueva, ESTADO_ENTREGA_EPP, tonoDeRenovacion } from '@/lib/dominio/ssoma'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularEntrega, EstadoDeLaEntrega, NoSeRenueva } from '../controles'

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata = { title: 'Seguridad: EPP de una persona' }

/**
 * La hoja de EPP de una persona de la lista de RR. HH.: el equipo que tiene
 * vigente, con cuándo le toca renovarlo, y lo que tuvo antes. La ven SSOMA y
 * Gerencia; de la persona se lee solo nombre, cargo y área.
 */
export default async function PaginaEppDePersona({ params }: PageProps<'/ssoma/epp/[id]'>) {
  // Los mismos permisos con que la base deja leer las entregas (`puede_ver_reportes_ssoma`).
  const perfil = await exigirPermiso(['ssoma.ver', 'ssoma.gestionar'])
  // El mismo permiso que piden `ssoma_anular_entrega_epp` y `ssoma_epp_no_se_renueva`.
  const gestiona = puede(perfil, 'ssoma.gestionar')
  const { id } = await params
  if (!GUID.test(id)) notFound()
  const [personas, entregas] = await Promise.all([eppPorPersona(id), entregasDeEpp({ trabajador: id })])
  const p = personas[0]
  if (!p) notFound()

  // Lo vigente, por la fecha en que toca renovarlo; lo demás, lo más reciente arriba (así llega de la base).
  const vigentes = entregas.filter((e) => e.estado === 'VIGENTE').sort((a, b) => a.renovar_el.localeCompare(b.renovar_el))
  const historial = entregas.filter((e) => e.estado !== 'VIGENTE')

  return (
    <>
      <EncabezadoPagina
        titulo={p.persona}
        descripcion={[p.cargo, p.area].filter(Boolean).join(' · ') || undefined}
        migas={[{ titulo: 'SSOMA', ruta: '/ssoma' }, { titulo: 'EPP por persona', ruta: '/ssoma/epp?vista=personas' }, { titulo: p.persona }]}
        estado={gestiona ? <EstadoDeLaEntrega /> : undefined}
      />

      <div className="space-y-5">
        {!p.en_planta && (
          <p role="note" className="rounded-[var(--radius-base)] border border-borde bg-neutro-suave px-4 py-3 text-sm text-texto" data-ya-no-esta>
            Ya no está en la planta, según RR. HH.: lo que tiene anotado no sale en «Por renovar».
          </p>
        )}

        <Tarjeta className="overflow-hidden" data-epp-vigente={vigentes.length}>
          <TarjetaCabecera
            titulo="Lo que tiene"
            descripcion={vigentes.length === 0 ? undefined : `${vigentes.length} ${vigentes.length === 1 ? 'equipo vigente' : 'equipos vigentes'}`}
            ayuda="El último de cada equipo que se le entregó. Cuando se le anota otro igual, el anterior pasa al historial."
          />
          {vigentes.length === 0 ? (
            <div className="px-4 pb-4">
              <SinDatos
                compacto
                titulo="No tiene EPP vigente anotado"
                descripcion={
                  gestiona
                    ? 'Las entregas se anotan desde la salida de Almacén del equipo.'
                    : 'SSOMA anota cada entrega desde la salida de Almacén del equipo.'
                }
                accion={
                  gestiona ? (
                    <Link href="/ssoma/epp?vista=salidas" className="text-sm font-medium text-acento underline underline-offset-2">
                      Ver las salidas de Almacén
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Tabla apilada>
              <TablaCabecera>
                <tr>
                  <TH>Equipo</TH>
                  <TH className="hidden md:table-cell">Entregado</TH>
                  <TH className="hidden md:table-cell">Renovación</TH>
                  {gestiona && (
                    <TH className="md:w-64">
                      <span className="sr-only">Acciones</span>
                    </TH>
                  )}
                </tr>
              </TablaCabecera>
              <tbody>
                {vigentes.map((e) => (
                  <TR key={e.id} data-entrega-epp={e.id} data-estado={e.estado} data-situacion={e.situacion ?? undefined}>
                    <TD className="align-top">
                      <p className="text-sm font-medium text-texto">{e.material}</p>
                      <p className="tabular text-xs text-texto-suave">
                        {cantidad(e.cantidad)} {e.unidad ?? ''}
                      </p>
                      {/* En el teléfono, lo demás va aquí. */}
                      <div className="mt-1.5 space-y-1 md:hidden">
                        <p className="tabular text-xs text-texto-suave">
                          Entregado el {fecha(e.entregado_el)}
                          {e.numero_salida ? ` · ${e.numero_salida}` : ''}
                        </p>
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-texto-suave">
                          <Insignia tono={tonoDeRenovacion(e.situacion)}>{cuandoSeRenueva(e.dias)}</Insignia>
                          <span className="tabular">renovar el {fecha(e.renovar_el)}</span>
                        </p>
                      </div>
                    </TD>
                    <TD className="hidden align-top md:table-cell">
                      <DeDonde e={e} />
                    </TD>
                    <TD className="hidden align-top md:table-cell">
                      <p className="tabular text-sm whitespace-nowrap text-texto">{fecha(e.renovar_el)}</p>
                      <p className="mt-1">
                        <Insignia tono={tonoDeRenovacion(e.situacion)}>{cuandoSeRenueva(e.dias)}</Insignia>
                      </p>
                    </TD>
                    {gestiona && (
                      <TD className="align-top">
                        <AccionesDeFila>
                          <NoSeRenueva entrega={e} />
                          <AnularEntrega entrega={e} />
                        </AccionesDeFila>
                      </TD>
                    )}
                  </TR>
                ))}
              </tbody>
            </Tabla>
          )}
        </Tarjeta>

        {historial.length > 0 && (
          <Tarjeta className="overflow-hidden" data-epp-historial={historial.length}>
            <TarjetaCabecera titulo="Historial" descripcion="Lo que ya se renovó, lo que no se renueva y lo anulado" />
            <Tabla apilada>
              <TablaCabecera>
                <tr>
                  <TH>Equipo</TH>
                  <TH className="hidden md:table-cell">Entregado</TH>
                  <TH className="hidden md:table-cell">Qué pasó</TH>
                  {gestiona && (
                    <TH className="md:w-32">
                      <span className="sr-only">Acciones</span>
                    </TH>
                  )}
                </tr>
              </TablaCabecera>
              <tbody>
                {historial.map((e) => (
                  <TR key={e.id} data-entrega-epp={e.id} data-estado={e.estado}>
                    <TD className="align-top">
                      <p className={e.estado === 'ANULADA' ? 'text-sm text-texto-suave line-through' : 'text-sm text-texto'}>{e.material}</p>
                      <p className="tabular text-xs text-texto-suave">
                        {cantidad(e.cantidad)} {e.unidad ?? ''}
                      </p>
                      <div className="mt-1.5 space-y-1 md:hidden">
                        <p className="tabular text-xs text-texto-suave">
                          Entregado el {fecha(e.entregado_el)}
                          {e.numero_salida ? ` · ${e.numero_salida}` : ''}
                        </p>
                        <QuePaso e={e} />
                      </div>
                    </TD>
                    <TD className="hidden align-top md:table-cell">
                      <DeDonde e={e} />
                    </TD>
                    <TD className="hidden align-top md:table-cell">
                      <QuePaso e={e} />
                    </TD>
                    {gestiona && (
                      <TD className="align-top">
                        {/* Lo que no está anulado todavía cuenta en su salida: si estaba mal anotado, se anula. */}
                        {e.estado !== 'ANULADA' && (
                          <AccionesDeFila>
                            <AnularEntrega entrega={e} />
                          </AccionesDeFila>
                        )}
                      </TD>
                    )}
                  </TR>
                ))}
              </tbody>
            </Tabla>
          </Tarjeta>
        )}
      </div>
    </>
  )
}

/** Cuándo se le entregó y con qué salida de Almacén. */
function DeDonde({ e }: { e: EntregaDeEpp }) {
  return (
    <>
      <p className="tabular text-sm whitespace-nowrap text-texto">{fecha(e.entregado_el)}</p>
      {e.numero_salida && <p className="tabular text-xs whitespace-nowrap text-texto-suave">{e.numero_salida}</p>}
    </>
  )
}

/** En qué quedó una entrega que ya no es la vigente, con quién lo dijo y por qué. */
function QuePaso({ e }: { e: EntregaDeEpp }) {
  const estado = ESTADO_ENTREGA_EPP[e.estado]
  return (
    <div className="max-w-md text-xs text-texto-suave">
      <p>{estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : e.estado}</p>
      {e.estado === 'RENOVADA' && <p className="mt-1">Después se le entregó otro igual. Tocaba renovarlo el {fecha(e.renovar_el)}.</p>}
      {e.estado === 'SIN_RENOVACION' && (
        <p className="mt-1 text-pretty">
          {e.motivo_sin_renovacion}
          {e.saco_de_renovar || e.sin_renovacion_en
            ? ` (${[e.saco_de_renovar, e.sin_renovacion_en ? fechaHora(e.sin_renovacion_en) : null].filter(Boolean).join(', ')})`
            : ''}
        </p>
      )}
      {e.estado === 'ANULADA' && (
        <p className="mt-1 text-pretty">
          {e.motivo_anulacion}
          {e.anulo || e.anulado_en ? ` (${[e.anulo, e.anulado_en ? fechaHora(e.anulado_en) : null].filter(Boolean).join(', ')})` : ''}
        </p>
      )}
    </div>
  )
}
