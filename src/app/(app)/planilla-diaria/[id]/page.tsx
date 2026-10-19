import { FileText } from 'lucide-react'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cuentasParaPagar } from '@/lib/datos/caja'
import { planillaDiaria, type PagoPlanilla, type PersonaPlanilla } from '@/lib/datos/planilla-diaria'
import { ESTADO_PLANILLA, estadoDePlanilla, personasTexto } from '@/lib/dominio/planilla-diaria'
import { TIPO_CUENTA, horasCortas } from '@/lib/dominio/rrhh'
import { fecha, fechaHora, hoyLima, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularConMotivo, EntregarBoleta, RegistrarPago, SubirBoleta } from './acciones-planilla'

export const metadata = { title: 'Planilla diaria' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaPlanilla({ params }: PageProps<'/planilla-diaria/[id]'>) {
  const perfil = await exigirPermiso(['planilla_diaria.preparar', 'planilla_diaria.pagar', 'planilla_diaria.ver'])
  const arma = puede(perfil, 'planilla_diaria.preparar')
  const paga = puede(perfil, 'planilla_diaria.pagar')
  const { id } = await params
  if (!GUID.test(id)) notFound()
  const [p, cuentasCaja] = await Promise.all([
    planillaDiaria(id, arma || paga),
    // La cuenta de la que sale cada pago: la caja diaria se mueve sola (20261019100000).
    paga ? cuentasParaPagar() : Promise.resolve([]),
  ])
  if (!p) notFound()

  const anulada = p.anulado_en !== null
  const estado = estadoDePlanilla(p.anulado_en, p.gente)
  const pagosVigentes = p.pagos.filter((g) => !g.anulado_en)
  const porPagar = p.gente.filter((g) => !g.pago_id)
  const pagoDe = new Map(p.pagos.map((g) => [g.id, g]))
  const hoy = hoyLima()

  return (
    <>
      <EncabezadoPagina
        titulo={<span className={`font-mono ${anulada ? 'line-through' : ''}`}>{p.numero}</span>}
        descripcion={`Enviada por Recursos Humanos el ${fecha(p.fecha)} · ${personasTexto(p.personas)} · ${moneda(p.total)}`}
        migas={[{ titulo: 'Planilla diaria', ruta: '/planilla-diaria' }, { titulo: p.numero }]}
        acciones={
          <>
            <Insignia tono={ESTADO_PLANILLA[estado].tono}>{ESTADO_PLANILLA[estado].etiqueta}</Insignia>
            {paga && !anulada && porPagar.length > 0 && (
              <RegistrarPago
                planillaId={p.id}
                pagoId={crypto.randomUUID()}
                hoy={hoy}
                porPagar={porPagar.map((g) => ({ id: g.id, nombre: g.nombre, total: g.total }))}
                cuentas={cuentasCaja}
              />
            )}
            {arma && !anulada && pagosVigentes.length === 0 && (
              <AnularConMotivo
                tipo="planilla"
                id={p.id}
                planillaId={p.id}
                titulo={`Anular la planilla ${p.numero}`}
                descripcion="No se borra: queda con su motivo, y sus horas vuelven a esperar la siguiente planilla. Tesorería recibe el aviso."
              />
            )}
          </>
        }
      />

      {anulada && (
        <p className="mb-4 rounded-lg border border-peligro bg-peligro-suave px-3 py-2 text-sm text-texto">
          Anulada el {fechaHora(p.anulado_en)}: {p.motivo_anulacion} Sus horas volvieron a esperar la siguiente planilla.
        </p>
      )}

      <div className="max-w-4xl space-y-5">
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Lo que se le paga a cada persona"
            descripcion={
              paga
                ? 'Paga a la cuenta de cada persona y registra el pago con su comprobante; después adjunta su boleta de pago.'
                : arma
                  ? 'Cuando Tesorería adjunte la boleta de pago, entrégasela a la persona y márcala como entregada.'
                  : 'Las horas validadas de cada persona, con lo que se le paga.'
            }
          />
          <ul className="divide-y divide-borde">
            {p.gente.map((g) => (
              <Persona
                key={g.id}
                g={g}
                planillaId={p.id}
                pago={g.pago_id ? (pagoDe.get(g.pago_id) ?? null) : null}
                anulada={anulada}
                arma={arma}
                paga={paga}
                conCuenta={(arma || paga) && !anulada}
              />
            ))}
          </ul>
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Pagos" descripcion="Cada pago de Tesorería con su comprobante. Uno mal registrado se anula y su gente vuelve a quedar por pagar." />
          {p.pagos.length === 0 ? (
            <TarjetaCuerpo>
              <p className="text-sm text-texto-suave">{anulada ? 'Se anuló sin pagos.' : 'Tesorería todavía no registra pagos.'}</p>
            </TarjetaCuerpo>
          ) : (
            <ul className="divide-y divide-borde">
              {p.pagos.map((g) => {
                const de = p.gente.filter((x) => x.pago_id === g.id)
                return (
                  <li key={g.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${g.anulado_en ? 'opacity-60' : ''}`}>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium text-texto">
                        Pagado el {fecha(g.fecha_pago)}
                        {g.operacion && <span className="tabular font-normal text-texto-suave"> · Op. {g.operacion}</span>}
                      </p>
                      <p className="text-xs text-texto-suave">
                        {g.anulado_en
                          ? `Anulado el ${fechaHora(g.anulado_en)}: ${g.motivo_anulacion}`
                          : `${de.map((x) => x.nombre).join(', ')} · ${moneda(de.reduce((n, x) => n + x.total, 0))}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <EnlaceArchivo enlace={g.enlace} texto="Comprobante" />
                      {paga && !g.anulado_en && (
                        <AnularConMotivo
                          tipo="pago"
                          id={g.id}
                          planillaId={p.id}
                          titulo="Anular el pago"
                          descripcion="No se borra: queda con su motivo y su comprobante, y esas personas vuelven a quedar por pagar. La caja diaria anula su egreso."
                        />
                      )}
                    </div>
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

function Persona({
  g,
  planillaId,
  pago,
  anulada,
  arma,
  paga,
  conCuenta,
}: {
  g: PersonaPlanilla
  planillaId: string
  pago: PagoPlanilla | null
  anulada: boolean
  arma: boolean
  paga: boolean
  conCuenta: boolean
}) {
  return (
    <li className="space-y-3 px-4 py-3" data-persona={g.nombre}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-texto">{g.nombre}</p>
          <p className="text-xs text-texto-suave">{g.cargo ?? 'Sin cargo'}</p>
          <p className="mt-1 text-xs text-texto">
            <span className="tabular">{horasCortas(g.horas_ordinarias)}</span> ordinarias · <span className="tabular">{moneda(g.monto_ordinarias)}</span>
            {g.horas_extras > 0 && (
              <>
                {' · '}
                <span className="font-medium text-acento">
                  <span className="tabular">{horasCortas(g.horas_extras)}</span> extras · <span className="tabular">{moneda(g.monto_extras)}</span>
                </span>
              </>
            )}
          </p>
          {conCuenta && (
            <p className="mt-1 text-xs text-texto-suave" data-cuenta>
              {g.cuenta?.numero_cuenta ? (
                <>
                  {g.cuenta.banco} · {TIPO_CUENTA[g.cuenta.tipo_cuenta ?? '']?.etiqueta ?? g.cuenta.tipo_cuenta} ·{' '}
                  <span className="tabular text-texto">{g.cuenta.numero_cuenta}</span>
                  {g.cuenta.cci && <span className="tabular"> · CCI {g.cuenta.cci}</span>}
                </>
              ) : (
                'Sin cuenta registrada: pídela a Recursos Humanos'
              )}
            </p>
          )}
        </div>
        <p className="tabular text-right text-base font-semibold text-texto">{moneda(g.total)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {pago && !pago.anulado_en ? (
          <Insignia tono="exito">Pagado el {fecha(pago.fecha_pago)}</Insignia>
        ) : (
          <Insignia tono={anulada ? 'neutro' : 'aviso'}>{anulada ? 'Sin pagar' : 'Por pagar'}</Insignia>
        )}
        {g.boleta_ruta ? (
          <>
            <EnlaceArchivo enlace={g.boleta_enlace} texto="Boleta" />
            {g.boleta_entregada_en ? (
              <Insignia tono="exito">Boleta entregada el {fecha(g.boleta_entregada_en)}</Insignia>
            ) : (
              <Insignia tono="info">Boleta por entregar</Insignia>
            )}
          </>
        ) : (
          !anulada && <span className="text-texto-suave">Sin boleta todavía</span>
        )}
        {paga && !anulada && !g.boleta_entregada_en && (
          <SubirBoleta planillaId={planillaId} personaId={g.id} nombre={g.nombre} cambiar={Boolean(g.boleta_ruta)} />
        )}
        {arma && !anulada && g.boleta_ruta && !g.boleta_entregada_en && <EntregarBoleta planillaId={planillaId} personaId={g.id} />}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-texto-suave hover:text-texto">Ver los días</summary>
        <Tabla className="mt-2">
          <TablaCabecera>
            <tr>
              <TH>Día</TH>
              <TH>Horas</TH>
              <TH className="hidden text-right sm:table-cell">La hora</TH>
              <TH className="text-right">Monto</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {g.detalle.map((d) => (
              <TR key={`${d.fecha}-${d.concepto}-${d.horas}`}>
                <TD className="tabular">{fecha(d.fecha)}</TD>
                <TD>
                  {d.concepto === 'ORDINARIAS' ? (
                    <>
                      <span className="tabular">{horasCortas(d.horas)}</span> ordinarias
                    </>
                  ) : (
                    <>
                      <span className="tabular">{horasCortas(d.horas)}</span> extras
                      <span className="text-texto-suave">
                        {' '}
                        ({[
                          d.horas_tramo1 > 0 && `${horasCortas(d.horas_tramo1)} al ${d.recargo_tramo1} %`,
                          d.horas_tramo2 > 0 && `${horasCortas(d.horas_tramo2)} al ${d.recargo_tramo2} %`,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        )
                      </span>
                    </>
                  )}
                </TD>
                <TD className="tabular hidden text-right sm:table-cell">{moneda(d.valor_hora)}</TD>
                <TD className="tabular text-right">{moneda(d.monto)}</TD>
              </TR>
            ))}
          </tbody>
        </Tabla>
      </details>
    </li>
  )
}

function EnlaceArchivo({ enlace, texto }: { enlace: string | null; texto: string }) {
  if (!enlace) return <span className="text-xs text-texto-suave">{texto} (no se pudo abrir ahora)</span>
  return (
    <a
      href={enlace}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-borde px-2 text-xs font-medium text-acento hover:bg-superficie-2"
    >
      <FileText aria-hidden className="size-3.5" />
      {texto}
    </a>
  )
}
