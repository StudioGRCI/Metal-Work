import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  decisionesHorasExtras,
  horasExtrasPorDecidir,
  reglaHorasExtras,
  saldoDeHoras,
  usosDelSaldo,
} from '@/lib/datos/planilla-diaria'
import { DECISION_EXTRAS, JORNADA_HORAS, montoExtras, valorHora } from '@/lib/dominio/planilla-diaria'
import { horasCortas } from '@/lib/dominio/rrhh'
import { fecha, fechaHora, hoyLima, moneda } from '@/lib/format'
import { editaComoRrhh, exigirPermiso, puede } from '@/lib/sesion'

import { AnularExtras, DecidirExtras, FormularioReglaExtras, UsarSaldo } from './controles'

export const metadata = { title: 'Horas extras' }

export default async function PaginaHorasExtras() {
  const perfil = await exigirPermiso(['planilla_diaria.preparar', 'planilla_diaria.ver'])
  const decide = editaComoRrhh(perfil, 'planilla_diaria.preparar')
  const hoy = hoyLima()

  const [porDecidir, saldos, decisiones, usos, regla] = await Promise.all([
    horasExtrasPorDecidir(),
    saldoDeHoras(),
    decisionesHorasExtras(),
    usosDelSaldo(),
    reglaHorasExtras(),
  ])
  const horasPorDecidir = porDecidir.reduce((n, e) => n + e.por_decidir, 0)
  const conSaldo = saldos.filter((s) => s.saldo > 0)

  return (
    <>
      <EncabezadoPagina
        titulo="Horas extras"
        ayuda={`Lo que pasa de ${JORNADA_HORAS} horas en un día, sumando los reportes diarios que validaron Gerencia y Recursos Humanos. ${
          decide
            ? 'Decide si se pagan (entran a la próxima planilla diaria con su recargo) o se reservan para otra ocasión (pasan al saldo de la persona).'
            : 'Recursos Humanos decide si se pagan o se reservan para otra ocasión.'
        }`}
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Horas extras' }]}
      />

      <div className="max-w-4xl space-y-5">
        <Tarjeta className="overflow-hidden" data-por-decidir>
          <TarjetaCabecera
            titulo="Por decidir"
            descripcion={
              porDecidir.length > 0
                ? `${horasCortas(horasPorDecidir)} en ${porDecidir.length} ${porDecidir.length === 1 ? 'jornada' : 'jornadas'}`
                : 'Nada por decidir.'
            }
            ayuda={`Las ${horasCortas(regla.horas_tramo1)} primeras de cada día van con ${regla.recargo_tramo1} % y las siguientes con ${regla.recargo_tramo2} %.`}
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona y día</TH>
                <TH className="text-right">Extras</TH>
                {decide && <TH className="text-right">Acción</TH>}
              </tr>
            </TablaCabecera>
            <tbody>
              {porDecidir.length === 0 ? (
                <SinDatos
                  titulo="Sin horas extras por decidir"
                  descripcion={`Aparecen cuando alguien pasa de ${JORNADA_HORAS} horas en un día en reportes ya validados por las dos áreas.`}
                />
              ) : (
                porDecidir.map((e) => {
                  const pago = e.remuneracion === null ? null : montoExtras(valorHora(e.remuneracion), e.tramo1, e.tramo2, regla)
                  return (
                    <TR key={`${e.trabajador_id}-${e.fecha}`} data-extras={e.nombre}>
                      <TD>
                        <p className="font-medium text-texto">{e.nombre}</p>
                        <p className="text-xs text-texto-suave">
                          <span className="tabular">{fecha(e.fecha)}</span> · trabajó <span className="tabular">{horasCortas(e.horas_del_dia)}</span>
                          {e.cargo && ` · ${e.cargo}`}
                        </p>
                      </TD>
                      <TD className="text-right">
                        <p className="tabular font-semibold text-acento">{horasCortas(e.por_decidir)}</p>
                        <p className="text-xs text-texto-suave">
                          {[
                            e.tramo1 > 0 && `${horasCortas(e.tramo1)} al ${regla.recargo_tramo1} %`,
                            e.tramo2 > 0 && `${horasCortas(e.tramo2)} al ${regla.recargo_tramo2} %`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {decide && (
                          <p className="text-xs text-texto-suave">{pago === null ? 'Sin remuneración' : `Pagarlas: ${moneda(pago)}`}</p>
                        )}
                      </TD>
                      {decide && (
                        <TD className="text-right">
                          <DecidirExtras id={crypto.randomUUID()} trabajadorId={e.trabajador_id} fecha={e.fecha} />
                        </TD>
                      )}
                    </TR>
                  )
                })
              )}
            </tbody>
          </Tabla>
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Saldo de horas reservadas"
            ayuda="Las horas extras que se reservaron, menos las que la persona ya usó en un permiso o un descanso."
          />
          <Tabla>
            <TablaCabecera>
              <tr>
                <TH>Persona</TH>
                <TH className="hidden text-right sm:table-cell">Reservadas</TH>
                <TH className="hidden text-right sm:table-cell">Usadas</TH>
                <TH className="text-right">Saldo</TH>
                {decide && <TH className="text-right">Acción</TH>}
              </tr>
            </TablaCabecera>
            <tbody>
              {saldos.length === 0 ? (
                <SinDatos titulo="Nadie tiene horas reservadas" descripcion="Aparecen aquí cuando se reservan horas extras." />
              ) : (
                saldos.map((s) => (
                  <TR key={s.trabajador_id} data-saldo={s.nombre}>
                    <TD>
                      <p className="font-medium text-texto">{s.nombre}</p>
                      <p className="text-xs text-texto-suave">{s.cargo ?? 'Sin cargo'}</p>
                    </TD>
                    <TD className="tabular hidden text-right sm:table-cell">{horasCortas(s.reservadas)}</TD>
                    <TD className="tabular hidden text-right sm:table-cell">{horasCortas(s.usadas)}</TD>
                    <TD className="tabular text-right font-semibold text-texto">{horasCortas(s.saldo)}</TD>
                    {decide && (
                      <TD className="text-right">
                        {s.saldo > 0 && <UsarSaldo id={crypto.randomUUID()} trabajadorId={s.trabajador_id} nombre={s.nombre} saldo={s.saldo} hoy={hoy} />}
                      </TD>
                    )}
                  </TR>
                ))
              )}
            </tbody>
          </Tabla>
          {conSaldo.length > 0 && (
            <p className="border-t border-borde px-4 py-2 text-xs text-texto-suave">
              {conSaldo.length} {conSaldo.length === 1 ? 'persona tiene' : 'personas tienen'} horas para usar.
            </p>
          )}
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Lo decidido" ayuda="Una decisión equivocada se anula y sus horas vuelven a esperar, mientras no estén en una planilla." />
          {decisiones.length === 0 ? (
            <TarjetaCuerpo>
              <p className="text-sm text-texto-suave">Todavía no se decidió ninguna hora extra.</p>
            </TarjetaCuerpo>
          ) : (
            <ul className="divide-y divide-borde">
              {decisiones.map((d) => {
                const def = DECISION_EXTRAS[d.decision]
                return (
                  <li key={d.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${d.anulado_en ? 'opacity-60' : ''}`}>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-texto">
                        {d.nombre} · <span className="tabular">{fecha(d.fecha)}</span>
                      </p>
                      <p className="text-xs text-texto-suave">
                        <span className="tabular">{horasCortas(d.horas)}</span> · decidido el {fechaHora(d.creado_en)}
                        {d.anulado_en
                          ? ` · anulado: ${d.motivo_anulacion}`
                          : d.decision === 'PAGAR' &&
                            (d.planilla ? (
                              <>
                                {' · entró a '}
                                <Link href={`/planilla-diaria/${d.planilla.id}`} className="font-mono text-acento underline">
                                  {d.planilla.numero}
                                </Link>
                              </>
                            ) : (
                              ' · espera la próxima planilla'
                            ))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.anulado_en ? <Insignia tono="neutro">Anulada</Insignia> : <Insignia tono={def.tono}>{def.etiqueta}</Insignia>}
                      {decide && !d.anulado_en && !d.planilla && (
                        <AnularExtras
                          tipo="decision"
                          id={d.id}
                          detalle={`${d.nombre}, ${fecha(d.fecha)}: ${horasCortas(d.horas)} ${d.decision === 'PAGAR' ? 'para pagar' : 'reservadas'}. Vuelven a esperar tu decisión.`}
                        />
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Tarjeta>

        {usos.length > 0 && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera titulo="Horas usadas del saldo" />
            <ul className="divide-y divide-borde">
              {usos.map((u) => (
                <li key={u.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${u.anulado_en ? 'opacity-60' : ''}`}>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-texto">
                      {u.nombre} · <span className="tabular">{fecha(u.fecha)}</span> · <span className="tabular">{horasCortas(u.horas)}</span>
                    </p>
                    <p className="text-xs text-texto-suave">{u.anulado_en ? `Anulado: ${u.motivo_anulacion}` : u.motivo}</p>
                  </div>
                  {decide && !u.anulado_en && (
                    <AnularExtras tipo="uso" id={u.id} detalle={`${u.nombre}, ${fecha(u.fecha)}: ${horasCortas(u.horas)}. Vuelven a su saldo.`} />
                  )}
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}

        <Tarjeta>
          <TarjetaCabecera
            titulo="La regla de las horas extras"
            descripcion={`Hoy: las ${horasCortas(regla.horas_tramo1)} primeras de cada día con ${regla.recargo_tramo1} % y las siguientes con ${regla.recargo_tramo2} %`}
            ayuda="Sobre la hora de la persona (su remuneración mensual entre 240). Es lo mínimo de ley o más; cambiarla no toca lo ya enviado a Tesorería."
          />
          {decide && (
            <TarjetaCuerpo>
              <FormularioReglaExtras horasTramo1={regla.horas_tramo1} recargoTramo1={regla.recargo_tramo1} recargoTramo2={regla.recargo_tramo2} />
            </TarjetaCuerpo>
          )}
        </Tarjeta>
      </div>
    </>
  )
}
