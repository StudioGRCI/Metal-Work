import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { descuentosPorAplicar, type DescuentoPorAplicar } from '@/lib/datos/rrhh'
import {
  horasExtrasPorDecidir,
  listarPlanillasDiarias,
  planillaPorEnviar,
  reglaHorasExtras,
  type PersonaPorEnviar,
} from '@/lib/datos/planilla-diaria'
import {
  ESTADO_PLANILLA,
  aplicarDescuentos,
  estadoDePlanilla,
  montoExtras,
  montoOrdinarias,
  personasTexto,
  valorHora,
  type ReglaHorasExtras,
} from '@/lib/dominio/planilla-diaria'
import { horasCortas } from '@/lib/dominio/rrhh'
import { fecha, moneda } from '@/lib/format'
import { editaComoRrhh, exigirPermiso, puede } from '@/lib/sesion'

import { EnviarPlanilla } from './enviar'

export const metadata = { title: 'Planilla diaria' }

/**
 * Lo que se le pagaría a una persona con lo que está por enviar, igual que lo
 * calcula la base: sus horas, y lo que hay por restarle o devolverle.
 */
function estimado(p: PersonaPorEnviar, regla: ReglaHorasExtras, descuentos: DescuentoPorAplicar[]) {
  if (p.remuneracion === null) return null
  const hora = valorHora(p.remuneracion)
  const bruto = p.dias.reduce(
    (n, d) => n + (d.concepto === 'EXTRAS' ? montoExtras(hora, d.tramo1, d.tramo2, regla) : montoOrdinarias(hora, d.horas)),
    0,
  )
  return { bruto, ...aplicarDescuentos(bruto, descuentos) }
}

export default async function PaginaPlanillaDiaria() {
  const perfil = await exigirPermiso(['planilla_diaria.preparar', 'planilla_diaria.pagar', 'planilla_diaria.ver'])
  const arma = puede(perfil, 'planilla_diaria.preparar')
  // La manda solo RR. HH.; el administrador la ve (migración 20261020167000).
  const envia = editaComoRrhh(perfil, 'planilla_diaria.preparar')
  const paga = puede(perfil, 'planilla_diaria.pagar')

  const [planillas, porEnviar, porDecidir, regla, descuentos] = await Promise.all([
    listarPlanillasDiarias(),
    arma ? planillaPorEnviar() : Promise.resolve([]),
    arma ? horasExtrasPorDecidir() : Promise.resolve([]),
    arma ? reglaHorasExtras() : Promise.resolve(null),
    // Lo que la planilla le va a restar o devolver a cada persona (migración 20261026200000).
    arma ? descuentosPorAplicar() : Promise.resolve([]),
  ])
  const descuentosDe = (id: string) => descuentos.filter((d) => d.trabajador_id === id)
  const conRemuneracion = porEnviar.filter((p) => p.remuneracion !== null)
  const sinRemuneracion = porEnviar.filter((p) => p.remuneracion === null)
  const total = regla ? conRemuneracion.reduce((n, p) => n + (estimado(p, regla, descuentosDe(p.trabajador_id))?.neto ?? 0), 0) : 0
  // La gente de taller con algo por restar o devolver y sin horas por pagar: espera su próxima planilla.
  // Quien está de baja ya no tiene próxima planilla: lo dicen Tardanzas y Permisos.
  const enEspera = [
    ...new Map(
      descuentos
        .filter((d) => d.planilla === 'TALLER' && d.activo && !porEnviar.some((p) => p.trabajador_id === d.trabajador_id))
        .map((d) => [d.trabajador_id, d.nombre]),
    ).values(),
  ]
  const porPagar = planillas.filter((p) => ['POR_PAGAR', 'PAGO_PARCIAL'].includes(estadoDePlanilla(p.anulado_en, p.gente)))

  return (
    <>
      <EncabezadoPagina
        titulo="Planilla diaria"
        ayuda={
          envia
            ? 'Lo que se le paga a la gente por sus horas de los reportes diarios que validaron Gerencia y Recursos Humanos: hasta 8 horas por día son ordinarias; las extras, las que decidiste pagar. La armas y la mandas a Tesorería, que paga y adjunta comprobante y boleta; tú entregas las boletas.'
            : paga
              ? 'Las planillas que manda Recursos Humanos con las horas validadas de cada persona. Paga a cada una a su cuenta, adjunta el comprobante y su boleta de pago.'
              : 'Las planillas diarias que Recursos Humanos manda a Tesorería, con lo que se le paga a cada persona por sus horas validadas.'
        }
        migas={[{ titulo: 'Planilla diaria' }]}
      />

      <div className="space-y-5">
        {arma && (
          <Tarjeta className="overflow-hidden" data-por-enviar>
            <TarjetaCabecera
              titulo="Por enviar a Tesorería"
              descripcion={conRemuneracion.length > 0 ? `${personasTexto(conRemuneracion.length)} · ${moneda(total)}` : undefined}
              ayuda="Sale de los reportes con los dos vistos buenos de Gerencia y Recursos Humanos que todavía no están en una planilla, y de los permisos justificados con horas extras reservadas, que se pagan a la hora ordinaria. A cada persona se le resta lo que tiene por tardanzas (cada tres en el mes, el porcentaje de la regla de su remuneración) y por los permisos que decidiste descontar; lo que no alcanza queda para la siguiente planilla."
              acciones={
                envia &&
                conRemuneracion.length > 0 && (
                  <EnviarPlanilla id={crypto.randomUUID()} resumen={`${personasTexto(conRemuneracion.length)} por ${moneda(total)}`} />
                )
              }
            />
            {porDecidir.length > 0 && (
              <p className="border-b border-borde bg-aviso-suave px-4 py-2 text-sm text-texto">
                Hay {porDecidir.length} {porDecidir.length === 1 ? 'jornada' : 'jornadas'} con horas extras por decidir: entran a la planilla solo las que
                decidas pagar, en{' '}
                <Link href="/rrhh/horas-extras" className="font-medium text-acento underline">
                  Horas extras
                </Link>
                .
              </p>
            )}
            {sinRemuneracion.length > 0 && (
              <p className="border-b border-borde bg-aviso-suave px-4 py-2 text-sm text-texto">
                Sin remuneración mensual no entran: {sinRemuneracion.map((p) => p.nombre).join(', ')}. Pónsela en{' '}
                <Link href="/rrhh/personal" className="font-medium text-acento underline">
                  Personal
                </Link>
                .
              </p>
            )}
            {enEspera.length > 0 && (
              <p className="border-b border-borde bg-superficie-2 px-4 py-2 text-sm text-texto-suave">
                Con descuentos que esperan su próxima planilla: {enEspera.join(', ')}. Se restan cuando tengan horas por pagar; los ves en{' '}
                <Link href="/rrhh/tardanzas" className="font-medium text-acento underline">
                  Tardanzas
                </Link>{' '}
                y{' '}
                <Link href="/rrhh/permisos" className="font-medium text-acento underline">
                  Permisos
                </Link>
                .
              </p>
            )}
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TH>Persona</TH>
                  <TH>Días</TH>
                  <TH className="text-right">A pagar</TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {porEnviar.length === 0 ? (
                  <SinDatos
                    titulo="Nada por enviar"
                    descripcion="Cuando Gerencia y Recursos Humanos validen un reporte diario, sus horas aparecen aquí."
                  />
                ) : (
                  porEnviar.map((p) => {
                    const suyos = descuentosDe(p.trabajador_id)
                    const monto = regla ? estimado(p, regla, suyos) : null
                    return (
                      <TR key={p.trabajador_id} className={p.remuneracion === null ? 'opacity-60' : undefined}>
                        <TD className="align-top">
                          <p className="font-medium text-texto">{p.nombre}</p>
                          <p className="text-xs text-texto-suave">{p.cargo ?? 'Sin cargo'}</p>
                        </TD>
                        <TD className="align-top">
                          <ul className="space-y-0.5 text-xs">
                            {p.dias.map((d) => (
                              <li key={`${d.fecha}-${d.concepto}`}>
                                <span className="tabular">{fecha(d.fecha)}</span> ·{' '}
                                {d.concepto === 'ORDINARIAS' ? (
                                  <>
                                    <span className="tabular">{horasCortas(d.horas)}</span> ordinarias
                                  </>
                                ) : d.concepto === 'PERMISO' ? (
                                  <>
                                    <span className="tabular">{horasCortas(d.horas)}</span> de permiso justificado con extras
                                  </>
                                ) : (
                                  <span className="font-medium text-acento">
                                    <span className="tabular">{horasCortas(d.horas)}</span> extras
                                    {regla && ` (${tramos(d.tramo1, d.tramo2, regla)})`}
                                  </span>
                                )}
                              </li>
                            ))}
                            {suyos.map((d, i) => {
                              // Lo que esta planilla resta o devuelve; lo que no alcanza espera a la siguiente.
                              const aplica = monto ? monto.aplicados[i] : d.monto
                              const queda = monto && d.monto > 0 ? d.monto - monto.aplicados[i] : 0
                              return (
                                <li
                                  key={`${d.concepto}-${d.fecha}`}
                                  className={aplica === 0 ? 'text-texto-suave' : d.monto > 0 ? 'text-peligro' : 'text-exito'}
                                  data-descuento={d.concepto}
                                >
                                  {aplica !== 0 && (
                                    <>
                                      <span className="tabular whitespace-nowrap">
                                        {d.monto > 0 ? '− ' : '+ '}
                                        {moneda(Math.abs(aplica))}
                                      </span>{' '}
                                      ·{' '}
                                    </>
                                  )}
                                  {d.detalle}
                                  {queda > 0 && (
                                    <span className="text-texto-suave">
                                      {' '}
                                      (<span className="tabular whitespace-nowrap">{moneda(queda)}</span> quedan para la siguiente)
                                    </span>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        </TD>
                        <TD className="tabular text-right align-top whitespace-nowrap">
                          {monto === null ? (
                            'Sin remuneración'
                          ) : (
                            <>
                              {moneda(monto.neto)}
                              {monto.restado !== 0 && <p className="text-xs text-texto-suave">de {moneda(monto.bruto)}</p>}
                            </>
                          )}
                        </TD>
                      </TR>
                    )
                  })
                )}
              </tbody>
            </Tabla>
          </Tarjeta>
        )}

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Planillas enviadas"
            descripcion={porPagar.length > 0 ? `${porPagar.length} por pagar` : undefined}
            ayuda="Cada una sale con número y no se borra: se anula con su motivo."
          />
          {planillas.length === 0 ? (
            <TarjetaCuerpo>
              <p className="text-sm text-texto-suave">
                {envia ? 'Todavía no se mandó ninguna. Envía la primera con «Enviar a Tesorería».' : 'Todavía no llega ninguna de Recursos Humanos.'}
              </p>
            </TarjetaCuerpo>
          ) : (
            <ul className="divide-y divide-borde">
              {planillas.map((p) => {
                const estado = estadoDePlanilla(p.anulado_en, p.gente)
                const pagadas = p.gente.filter((g) => g.pago_id).length
                const boletas = p.gente.filter((g) => g.boleta_ruta).length
                const entregadas = p.gente.filter((g) => g.boleta_entregada_en).length
                return (
                  <li key={p.id}>
                    <Link
                      href={`/planilla-diaria/${p.id}`}
                      className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-superficie-2 ${p.anulado_en ? 'opacity-60' : ''}`}
                      data-planilla={p.numero}
                    >
                      <div className="min-w-0">
                        <p className={`font-mono text-sm font-semibold text-texto ${p.anulado_en ? 'line-through' : ''}`}>{p.numero}</p>
                        <p className="text-xs text-texto-suave">
                          {fecha(p.fecha)} · {personasTexto(p.personas)} · <span className="tabular">{moneda(p.total)}</span>
                        </p>
                        {!p.anulado_en && (
                          <p className="text-xs text-texto-suave">
                            Pagadas {pagadas} de {p.personas} · boletas {boletas} · entregadas {entregadas}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Insignia tono={ESTADO_PLANILLA[estado].tono}>{ESTADO_PLANILLA[estado].etiqueta}</Insignia>
                        <ChevronRight aria-hidden className="size-4 text-texto-suave" />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Tarjeta>
      </div>
    </>
  )
}

/** «2 al 25 %, 1 al 35 %». */
function tramos(t1: number, t2: number, regla: ReglaHorasExtras) {
  const partes = []
  if (t1 > 0) partes.push(`${horasCortas(t1)} al ${regla.recargo_tramo1} %`)
  if (t2 > 0) partes.push(`${horasCortas(t2)} al ${regla.recargo_tramo2} %`)
  return partes.join(', ')
}
