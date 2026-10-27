import { notFound } from 'next/navigation'

import { AdjuntarContrato, ContratoVigente } from '@/components/estructura/contrato-adjunto'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { subcontratoDetalle, type ReciboHonorarios } from '@/lib/datos/subcontratos'
import { BUCKET_SUBCONTRATOS, ESTADO_RECIBO, ESTADO_SUBCONTRATO, cuentasDeSubcontrato, estadoDeRecibo, estadoDeSubcontrato, nombreDeAreaSubcontrato } from '@/lib/dominio/subcontratos'
import { fecha, fechaHora, hoyLima, moneda, parteDe, porcentaje } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { adjuntarContratoSubcontrato } from '../acciones'
import { EnlaceArchivo } from '../enlace-archivo'
import { AnularConMotivo, CambiarEstado, CorregirSubcontrato, SubirRecibo } from './controles'

export const metadata = { title: 'Subcontrato' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaSubcontrato({ params, searchParams }: PageProps<'/subcontratos/[id]'>) {
  const perfil = await exigirPermiso(['subcontratos.gestionar', 'subcontratos.ver', 'subcontratos.pagar'])
  const gestiona = puede(perfil, 'subcontratos.gestionar')
  const { id } = await params
  // Al registrar con contrato, si el subcontrato entró y el contrato no, llega aquí con ?contrato=pendiente.
  const contratoPendiente = (await searchParams).contrato === 'pendiente'
  if (!GUID.test(id)) notFound()
  const [s, codigos] = await Promise.all([subcontratoDetalle(id), gestiona ? codigosParaElegir() : Promise.resolve(null)])
  if (!s) notFound()

  const estado = estadoDeSubcontrato(s.estado)
  const vigente = estado === 'VIGENTE'
  const anulado = estado === 'ANULADO'
  const c = cuentasDeSubcontrato(s.monto, s.recibos)
  const sub = s.subcontratista
  const conRecibosVigentes = s.recibos.some((r) => !r.anulado_en)
  const area = nombreDeAreaSubcontrato(s.area_codigo)

  return (
    <>
      <EncabezadoPagina
        titulo={<span className={`font-mono ${anulado ? 'line-through' : ''}`}>{s.numero}</span>}
        descripcion={
          <>
            {sub?.nombre ?? 'Subcontratista'} · <span className="tabular font-medium text-texto">{s.codigo_interno}</span> ·{' '}
            {area ?? 'sin área'} · {moneda(s.monto, s.moneda)} pactado
          </>
        }
        migas={[{ titulo: 'Subcontratos', ruta: '/subcontratos' }, { titulo: s.numero }]}
        acciones={
          <>
            <Insignia tono={ESTADO_SUBCONTRATO[estado].tono}>{ESTADO_SUBCONTRATO[estado].etiqueta}</Insignia>
            {gestiona && vigente && <SubirRecibo subcontratoId={s.id} hoy={hoyLima()} moneda={s.moneda} />}
            {gestiona && vigente && <CorregirSubcontrato subcontrato={s} codigos={codigos} />}
            {gestiona && !anulado && <CambiarEstado id={s.id} terminar={vigente} />}
            {gestiona && !anulado && !conRecibosVigentes && (
              <AnularConMotivo
                tipo="subcontrato"
                id={s.id}
                subcontratoId={s.id}
                titulo={`Anular el subcontrato ${s.numero}`}
                descripcion="No se borra: queda con su motivo como evidencia y ya no recibe recibos."
              />
            )}
          </>
        }
      />

      {anulado && (
        <p className="mb-4 rounded-lg border border-peligro bg-peligro-suave px-3 py-2 text-sm text-texto">
          Anulado el {fechaHora(s.anulado_en)}: {s.motivo_anulacion}
        </p>
      )}
      {!anulado && !area && (
        <p className="mb-4 rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-sin-area>
          Este subcontrato es de antes de que se eligiera el área: ni Producción ni Acabados lo ven.
          {gestiona && (vigente ? ' Elige para cuál va con «Corregir».' : ' Reábrelo y elige el área con «Corregir».')}
        </p>
      )}
      {contratoPendiente && !anulado && s.contratos.length === 0 && (
        <p role="alert" className="mb-4 rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-contrato-pendiente>
          El subcontrato quedó registrado, pero el contrato no se subió.{' '}
          <a href="#contrato" className="font-medium text-acento underline">
            Adjúntalo aquí
          </a>
          .
        </p>
      )}
      {estado === 'TERMINADO' && (
        <p className="mb-4 rounded-lg border border-borde bg-superficie-2 px-3 py-2 text-sm text-texto">
          Terminado el {fecha(s.terminado_en)}: ya no recibe recibos, y los que tiene se siguen pagando.
          {gestiona && ' Si falta un recibo, reábrelo.'}
        </p>
      )}

      <div className="max-w-4xl space-y-5">
        <Tarjeta>
          <TarjetaCabecera
            titulo="Cómo va"
            ayuda="Lo recibido es el bruto de los recibos vigentes; Tesorería paga el neto, después de la retención."
          />
          <TarjetaCuerpo>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-cuentas>
              {/* Cada monto con lo que es del pactado o del neto, en porcentaje (DKS, 27/10/2026: porcentaje y costo). */}
              <Cifra etiqueta="Pactado" valor={moneda(s.monto, s.moneda)} />
              <Cifra
                etiqueta={`Recibido (${c.recibos} ${c.recibos === 1 ? 'recibo' : 'recibos'})`}
                valor={moneda(c.recibido, s.moneda)}
                pie={parteDe(c.recibido, s.monto) === null ? undefined : `${porcentaje(parteDe(c.recibido, s.monto))} del pactado`}
              />
              <Cifra
                etiqueta={c.porRecibir < 0 ? 'Recibido de más' : 'Falta recibir'}
                valor={moneda(Math.abs(c.porRecibir), s.moneda)}
                pie={parteDe(Math.abs(c.porRecibir), s.monto) === null ? undefined : `${porcentaje(parteDe(Math.abs(c.porRecibir), s.monto))} del pactado`}
                tono={c.porRecibir < 0 ? 'text-peligro' : undefined}
              />
              {/* El porcentaje sale de los recibos: no todos llevan retención. */}
              <Cifra
                etiqueta="Retenido"
                valor={moneda(c.retenido, s.moneda)}
                pie={parteDe(c.retenido, c.recibido) === null ? 'Ningún recibo todavía' : `${porcentaje(parteDe(c.retenido, c.recibido))} de lo recibido`}
              />
              <Cifra
                etiqueta="Pagado por Tesorería"
                valor={moneda(c.pagado, s.moneda)}
                pie={parteDe(c.pagado, c.pagado + c.porPagar) === null ? undefined : `${porcentaje(parteDe(c.pagado, c.pagado + c.porPagar))} del neto`}
                tono={c.pagado > 0 ? 'text-exito' : undefined}
              />
              <Cifra
                etiqueta="Por pagar"
                valor={moneda(c.porPagar, s.moneda)}
                pie={parteDe(c.porPagar, c.pagado + c.porPagar) === null ? undefined : `${porcentaje(parteDe(c.porPagar, c.pagado + c.porPagar))} del neto`}
                tono={c.porPagar > 0 ? 'text-aviso' : undefined}
              />
            </dl>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo="Recibos por honorarios"
            ayuda={
              gestiona
                ? 'Sube cada recibo cuando llegue. Tesorería lo paga a la cuenta del subcontratista y adjunta el voucher, que aparece aquí.'
                : 'Cada recibo con su archivo y, cuando Tesorería lo paga, su voucher.'
            }
          />
          {s.recibos.length === 0 ? (
            <TarjetaCuerpo>
              <p className="text-sm text-texto-suave">
                {gestiona && vigente ? 'Todavía no hay recibos. Sube el primero con «Subir recibo por honorarios».' : 'No tiene recibos.'}
              </p>
            </TarjetaCuerpo>
          ) : (
            <ul className="divide-y divide-borde">
              {s.recibos.map((r) => (
                <Recibo key={r.id} r={r} subcontratoId={s.id} gestiona={gestiona} />
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta id="contrato" className="scroll-mt-20">
          <TarjetaCabecera
            titulo="Contrato"
            ayuda="El contrato firmado con el subcontratista. Si llega otra versión (una adenda, el firmado que reemplaza al borrador), se adjunta encima y la anterior queda como evidencia. El supervisor del área no lo ve: lleva el monto."
            acciones={
              gestiona &&
              !anulado && (
                <AdjuntarContrato
                  bucket={BUCKET_SUBCONTRATOS}
                  carpeta={s.id}
                  numero={s.numero}
                  hay={s.contratos.length > 0}
                  adjuntar={adjuntarContratoSubcontrato.bind(null, s.id)}
                />
              )
            }
          />
          <TarjetaCuerpo>
            <ContratoVigente
              contratos={s.contratos}
              sinContrato={gestiona && !anulado ? 'Adjúntalo con «Adjuntar contrato» cuando lo tengas.' : 'Lo adjunta Administración.'}
            />
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera titulo="Datos del subcontrato" />
          <TarjetaCuerpo>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs text-texto-suave">Trabajo</dt>
                <dd className="whitespace-pre-line text-texto">{s.descripcion}</dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Código interno</dt>
                <dd className="tabular font-medium text-texto">{s.codigo_interno}</dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Para qué área va</dt>
                <dd className="text-texto" data-area>
                  {area ?? <span className="text-aviso">Sin área</span>}
                  {area && <span className="block text-xs text-texto-suave">Su supervisor lo ve, sin montos.</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Fechas del contrato</dt>
                <dd className="text-texto">
                  {s.fecha_inicio || s.fecha_fin ? `${fecha(s.fecha_inicio)} → ${fecha(s.fecha_fin)}` : 'Sin fechas'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Fechas reales (referenciales)</dt>
                <dd className="text-texto" data-fechas-reales>
                  {s.inicio_real ? (
                    <>
                      {`Empezó el ${fecha(s.inicio_real)}${s.fin_real ? ` · terminó el ${fecha(s.fin_real)}` : ' · todavía no termina'}`}
                      <span className="block text-xs text-texto-suave">
                        Las marcó {s.fechas_reales_por ?? 'el supervisor del área'}
                        {s.fechas_reales_en && ` el ${fecha(s.fechas_reales_en)}`}
                      </span>
                    </>
                  ) : (
                    <span className="text-texto-suave">El supervisor del área todavía no las marca.</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Subcontratista</dt>
                <dd className="text-texto">
                  {sub?.nombre ?? '—'}
                  {sub && <span className="tabular block text-xs text-texto-suave">RUC {sub.ruc}{sub.telefono && ` · ${sub.telefono}`}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Cuenta donde se le paga</dt>
                <dd className="text-texto" data-cuenta>
                  {sub?.numero_cuenta || sub?.cci ? (
                    <>
                      {sub.banco}
                      {sub.numero_cuenta && <span className="tabular block">{sub.numero_cuenta}</span>}
                      {sub.cci && <span className="tabular block text-xs text-texto-suave">CCI {sub.cci}</span>}
                    </>
                  ) : (
                    <span className="text-aviso">Sin cuenta: corrígelo en «Subcontratistas» para que Tesorería sepa dónde pagar.</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-texto-suave">Registrado</dt>
                <dd className="text-texto">{fechaHora(s.creado_en)}</dd>
              </div>
            </dl>
          </TarjetaCuerpo>
        </Tarjeta>
      </div>
    </>
  )
}

function Cifra({ etiqueta, valor, pie, tono }: { etiqueta: string; valor: string; pie?: string; tono?: string }) {
  return (
    <div>
      <dt className="text-xs text-texto-suave">{etiqueta}</dt>
      <dd className={`tabular text-base font-semibold ${tono ?? 'text-texto'}`}>
        {valor}
        {pie && <span className="block text-xs font-normal text-texto-suave">{pie}</span>}
      </dd>
    </div>
  )
}

function Recibo({ r, subcontratoId, gestiona }: { r: ReciboHonorarios; subcontratoId: string; gestiona: boolean }) {
  const estado = estadoDeRecibo(r)
  const pago = r.pagos.find((p) => !p.anulado_en) ?? null
  const anulados = r.pagos.filter((p) => p.anulado_en)
  return (
    <li className={`space-y-2 px-4 py-3 ${r.anulado_en ? 'opacity-60' : ''}`} data-recibo={r.numero}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-texto">
            <span className={`tabular ${r.anulado_en ? 'line-through' : ''}`}>{r.numero}</span>
            <span className="font-normal text-texto-suave"> · {fecha(r.fecha_emision)}</span>
          </p>
          {r.concepto && <p className="text-xs text-texto-suave">{r.concepto}</p>}
          <p className="mt-1 text-xs text-texto">
            Bruto <span className="tabular">{moneda(r.monto_bruto, r.moneda)}</span>
            {r.retencion_porcentaje > 0 ? (
              <>
                {' '}
                · retención {porcentaje(r.retencion_porcentaje)} <span className="tabular">{moneda(r.retencion_monto, r.moneda)}</span>
              </>
            ) : (
              ' · sin retención'
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular text-base font-semibold text-texto">{moneda(r.monto_neto, r.moneda)}</p>
          <p className="text-[11px] text-texto-suave">neto a pagar</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Insignia tono={ESTADO_RECIBO[estado].tono}>
          {pago ? `Pagado el ${fecha(pago.fecha_pago)}` : ESTADO_RECIBO[estado].etiqueta}
        </Insignia>
        <EnlaceArchivo enlace={r.enlace} texto="Recibo" />
        {pago && (
          <>
            <EnlaceArchivo enlace={pago.enlace} texto="Voucher" />
            {pago.operacion && <span className="tabular text-texto-suave">Op. {pago.operacion}</span>}
          </>
        )}
        {gestiona && !r.anulado_en && !pago && (
          <AnularConMotivo
            tipo="recibo"
            id={r.id}
            subcontratoId={subcontratoId}
            titulo={`Anular el recibo ${r.numero}`}
            descripcion="No se borra: queda con su motivo y su archivo, y Tesorería ya no lo ve por pagar. Si el recibo está bien pero mal copiado, anúlalo y súbelo de nuevo."
          />
        )}
      </div>
      {r.anulado_en && <p className="text-xs text-peligro">Anulado el {fechaHora(r.anulado_en)}: {r.motivo_anulacion}</p>}
      {anulados.map((p) => (
        <p key={p.id} className="text-xs text-texto-suave">
          Tesorería anuló un pago del {fecha(p.fecha_pago)} el {fechaHora(p.anulado_en)}: {p.motivo_anulacion}
        </p>
      ))}
    </li>
  )
}
