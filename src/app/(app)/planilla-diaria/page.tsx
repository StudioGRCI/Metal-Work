import { ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  horasExtrasPorDecidir,
  listarPlanillasDiarias,
  planillaPorEnviar,
  reglaHorasExtras,
  type PersonaPorEnviar,
} from '@/lib/datos/planilla-diaria'
import {
  ESTADO_PLANILLA,
  estadoDePlanilla,
  montoExtras,
  montoOrdinarias,
  personasTexto,
  valorHora,
  type ReglaHorasExtras,
} from '@/lib/dominio/planilla-diaria'
import { horasCortas } from '@/lib/dominio/rrhh'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { EnviarPlanilla } from './enviar'

export const metadata = { title: 'Planilla diaria' }

/** Lo que se le pagaría a una persona con lo que está por enviar, igual que lo calcula la base. */
function estimado(p: PersonaPorEnviar, regla: ReglaHorasExtras) {
  if (p.remuneracion === null) return null
  const hora = valorHora(p.remuneracion)
  return p.dias.reduce(
    (n, d) => n + (d.concepto === 'ORDINARIAS' ? montoOrdinarias(hora, d.horas) : montoExtras(hora, d.tramo1, d.tramo2, regla)),
    0,
  )
}

export default async function PaginaPlanillaDiaria() {
  const perfil = await exigirPermiso(['planilla_diaria.preparar', 'planilla_diaria.pagar', 'planilla_diaria.ver'])
  const arma = puede(perfil, 'planilla_diaria.preparar')
  const paga = puede(perfil, 'planilla_diaria.pagar')

  const [planillas, porEnviar, porDecidir, regla] = await Promise.all([
    listarPlanillasDiarias(),
    arma ? planillaPorEnviar() : Promise.resolve([]),
    arma ? horasExtrasPorDecidir() : Promise.resolve([]),
    arma ? reglaHorasExtras() : Promise.resolve(null),
  ])
  const conRemuneracion = porEnviar.filter((p) => p.remuneracion !== null)
  const sinRemuneracion = porEnviar.filter((p) => p.remuneracion === null)
  const total = regla ? conRemuneracion.reduce((n, p) => n + (estimado(p, regla) ?? 0), 0) : 0
  const porPagar = planillas.filter((p) => ['POR_PAGAR', 'PAGO_PARCIAL'].includes(estadoDePlanilla(p.anulado_en, p.gente)))

  return (
    <>
      <EncabezadoPagina
        titulo="Planilla diaria"
        descripcion={
          arma
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
              descripcion={
                conRemuneracion.length > 0
                  ? `${personasTexto(conRemuneracion.length)} · ${moneda(total)}. Sale de los reportes con los dos vistos buenos que todavía no están en una planilla.`
                  : 'Aparece aquí lo validado por Gerencia y Recursos Humanos que todavía no está en una planilla.'
              }
              acciones={
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
                    const monto = regla ? estimado(p, regla) : null
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
                                ) : (
                                  <span className="font-medium text-acento">
                                    <span className="tabular">{horasCortas(d.horas)}</span> extras
                                    {regla && ` (${tramos(d.tramo1, d.tramo2, regla)})`}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </TD>
                        <TD className="tabular text-right align-top">{monto === null ? 'Sin remuneración' : moneda(monto)}</TD>
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
            descripcion={
              porPagar.length > 0
                ? `${porPagar.length} por pagar. Cada una sale con número y no se borra: se anula con su motivo.`
                : 'Cada una sale con número y no se borra: se anula con su motivo.'
            }
          />
          {planillas.length === 0 ? (
            <TarjetaCuerpo>
              <p className="text-sm text-texto-suave">
                {arma ? 'Todavía no se mandó ninguna. Envía la primera con «Enviar a Tesorería».' : 'Todavía no llega ninguna de Recursos Humanos.'}
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
