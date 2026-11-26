import { Download, FileText, Hourglass, ReceiptText } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { FacturaDeVenta } from '@/components/finanzas/factura-de-venta'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { bandejaDeFacturacion, type CotizacionParaFacturar } from '@/lib/datos/facturacion'
import { recorridoDeCotizaciones, type Recorridos } from '@/lib/datos/recorrido'
import { PERMISOS_BAJAR_COTIZACION, rutaParaBajarCotizacion } from '@/lib/descarga'
import { nombreMoneda } from '@/lib/dominio/caja'
import { comoVaLaUnidad, esperaFactura, rotuloDeCodigos, totalConIgv, type UnidadDeCotizacion } from '@/lib/dominio/finanzas'
import { describirRecorridoDeLaCotizacion, haceDias } from '@/lib/dominio/recorrido'
import { fecha, hoyLima, moneda, parteDe, porcentaje, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularFactura, FacturarUnidad, RegistrarFactura } from './acciones-factura'

export const metadata = { title: 'Facturación' }

const codigo = (m: string | null): CodigoMoneda => (m === 'USD' ? 'USD' : 'PEN')

/** Lo facturado vigente de la cotización, en su moneda. */
function facturadoDe(c: CotizacionParaFacturar) {
  return c.facturas.filter((f) => !f.anulada_en && f.moneda === c.moneda).reduce((n, f) => n + Number(f.total), 0)
}

/** Alguna factura vigente va en otra moneda que la cotización: no se puede decir qué parte cubre. */
function enOtraMoneda(c: CotizacionParaFacturar) {
  return c.facturas.some((f) => !f.anulada_en && f.moneda !== c.moneda)
}

type Estado = { etiqueta: string; tono: 'aviso' | 'exito' | 'neutro' }

/**
 * En qué va una unidad para Contabilidad, por su OT y sus facturas vigentes
 * (`comoVaLaUnidad`, la misma regla que la cabecera del código). Con la mitad
 * facturada decía «Facturada» en verde y Contabilidad leía que no le quedaba
 * nada por facturar (auditoría del 27/10/2026). `sola`: la cotización es de
 * una unidad, y se dice como siempre.
 */
function estadoDeUnidad(u: UnidadDeCotizacion, sola: boolean): Estado {
  const como = comoVaLaUnidad(u)
  if (como === 'SIN_OT') return { etiqueta: sola ? 'Sin código interno' : 'Falta su OT', tono: 'neutro' }
  if (como === 'POR_FACTURAR') return { etiqueta: 'Por facturar', tono: 'aviso' }
  // Facturada en dólares una cotización en soles (o al revés): no se compara, pero tampoco se la da por entera o por parte.
  if (como === 'OTRA_MONEDA') return { etiqueta: 'Facturada en otra moneda', tono: 'neutro' }
  if (como === 'EN_PARTE') return { etiqueta: 'Facturada en parte', tono: 'aviso' }
  return { etiqueta: 'Facturada', tono: 'exito' }
}

/**
 * En qué va la cotización entera. La de varias unidades (migración
 * 20261126998000) espera a Contabilidad mientras alguna unidad con su OT espera
 * factura; si las que tienen OT ya están facturadas y faltan OT, espera a
 * Administración y no se la llama «Por facturar».
 */
function estadoDe(c: CotizacionParaFacturar): Estado {
  const [primera] = c.unidades
  if (c.unidades.length === 1 && primera) return estadoDeUnidad(primera, true)
  const como = c.unidades.map(comoVaLaUnidad)
  const sinOt = como.filter((x) => x === 'SIN_OT').length
  if (sinOt === como.length) return { etiqueta: 'Sin código interno', tono: 'neutro' }
  if (c.unidades.some(esperaFactura)) {
    return { etiqueta: c.unidades.some((u) => u.facturas > 0) ? 'Facturada en parte' : 'Por facturar', tono: 'aviso' }
  }
  if (sinOt > 0) return { etiqueta: `Falta la OT de ${sinOt === 1 ? 'una unidad' : `${sinOt} unidades`}`, tono: 'neutro' }
  if (como.includes('OTRA_MONEDA')) return { etiqueta: 'Facturada en otra moneda', tono: 'neutro' }
  return { etiqueta: 'Facturada', tono: 'exito' }
}

/** Lo que espera factura: alguna unidad con su OT, sin factura vigente o facturada en parte (Plan 10.1). */
const porFacturar = (c: CotizacionParaFacturar) => c.unidades.some(esperaFactura)

/** La unidad que más espera su factura, entre las que la esperan. */
function laQueMasEspera(c: CotizacionParaFacturar): UnidadDeCotizacion | null {
  return c.unidades.filter(esperaFactura).reduce<UnidadDeCotizacion | null>((max, u) => (max === null || (u.dias ?? -1) > (max.dias ?? -1) ? u : max), null)
}

/**
 * Quién tiene la unidad que espera factura y desde cuándo. Contabilidad la
 * tiene desde que su OT tiene código interno; la que está en corrección la
 * tiene quien dice su recorrido (Gerencia o Ventas), con sus días: contarlos
 * desde el código le daba a Gerencia una demora que no era suya, y la misma
 * tarjeta decía otra en su recorrido (auditoría de diseño, segunda vuelta).
 */
function esperaDe(
  c: CotizacionParaFacturar,
  u: UnidadDeCotizacion | null,
  recorridos: Recorridos | null,
): { dias: number | null; desde: string | null; quien: string | null } | null {
  if (!c.cotizacion_id) return null
  if (!c.en_correccion) return u ? { dias: u.dias, desde: u.desde, quien: 'Contabilidad' } : null
  const ahora = recorridos?.get(c.cotizacion_id)?.find((p) => p.situacion === 'AHORA')
  return ahora ? { dias: ahora.dias, desde: ahora.en, quien: ahora.puesto } : null
}

/** Cuánto le falta facturar a la unidad, en la moneda de la cotización; nulo si no tiene total. */
const faltaDe = (u: UnidadDeCotizacion): number | null => (u.parte === null ? null : Math.max(0, u.parte - u.facturado))

/** Una unidad que espera factura, con su cotización: una fila de «Por facturar». */
type Pendiente = { c: CotizacionParaFacturar; u: UnidadDeCotizacion }

/**
 * La factura de venta cuelga del código interno (migración 20261015124000):
 * cada cotización que Gerencia aprobó llega aquí con el cliente, su RUC y su
 * dirección fiscal; cuando Administración carga la OT con el código interno de
 * la unidad, Contabilidad registra la factura que emitió en SUNAT, con su PDF,
 * y la factura entra sola a las cuentas por cobrar de Tesorería. La cotización
 * de varias unidades lleva una OT y un código por unidad, y cada factura dice
 * de cuál es, o que es por toda la cotización (migración 20261126998000).
 */
export default async function PaginaFacturacion() {
  const perfil = await exigirPermiso(['contabilidad.facturar', 'cotizaciones.ver_aprobadas'])
  const puedeBajar = puede(perfil, PERMISOS_BAJAR_COTIZACION)
  const factura = puede(perfil, 'contabilidad.facturar')
  const bandeja = await bandejaDeFacturacion()
  const hoy = hoyLima()
  const ids = bandeja.flatMap((c) => (c.cotizacion_id ? [c.cotizacion_id] : []))
  // El recorrido va aparte: si no se puede leer, la pantalla sigue con lo demás y lo dice en su lugar.
  // Los días de cada unidad vienen con la bandeja.
  const recorridos = await recorridoDeCotizaciones(ids).catch((e: unknown) => {
    console.error('Facturación: no se pudo leer el recorrido.', e)
    return null
  })
  const diasDe = (c: CotizacionParaFacturar) => laQueMasEspera(c)?.dias ?? null
  // Lo que espera factura va primero, de lo más antiguo a lo más nuevo, y la que está en
  // corrección después, porque no se puede facturar todavía; luego lo facturado y al final
  // lo que espera su OT.
  const turno = (c: CotizacionParaFacturar) => (!c.unidades.some((u) => u.codigo) ? 3 : porFacturar(c) ? (c.en_correccion ? 1 : 0) : 2)
  const cotizaciones = [...bandeja].sort((a, b) => turno(a) - turno(b) || (turno(a) === 0 ? (diasDe(b) ?? -1) - (diasDe(a) ?? -1) : 0))
  // Una fila por unidad que espera factura: cada una lleva la suya. Primero las que Contabilidad
  // puede facturar ya, de la que más espera a la que menos; las que están en corrección, al final.
  const pendientes: Pendiente[] = cotizaciones
    .flatMap((c) => c.unidades.filter(esperaFactura).map((u) => ({ c, u })))
    .sort((a, b) => Number(Boolean(a.c.en_correccion)) - Number(Boolean(b.c.en_correccion)) || (a.c.en_correccion ? 0 : (b.u.dias ?? -1) - (a.u.dias ?? -1)))

  return (
    <>
      <EncabezadoPagina
        titulo="Facturación"
        ayuda={`Las cotizaciones aprobadas, por código interno: registra la factura que emitiste en SUNAT y Tesorería la tiene por cobrar.${
          bandeja.some((c) => c.unidades.length > 1) ? ' La cotización de varias unidades lleva un código por unidad: la factura dice de cuál es, o que es por toda la cotización.' : ''
        }`}
      />

      <div className="space-y-5">
      {cotizaciones.length > 0 && <PorFacturar pendientes={pendientes} recorridos={recorridos} />}

      {cotizaciones.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-col items-center py-8 text-center">
            <span className="rounded-full bg-acento-suave p-3 text-acento">
              <ReceiptText aria-hidden className="size-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-texto">Todavía no hay cotizaciones aprobadas</p>
            <p className="mt-1 max-w-lg text-sm text-texto-suave">
              Cuando Gerencia apruebe una y Administración cargue su OT con el código interno, aparece aquí para facturarla.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <section aria-labelledby="todas-las-aprobadas" className="space-y-3">
        <h2 id="todas-las-aprobadas" className="text-[15px] font-semibold text-texto">
          Cotizaciones aprobadas
        </h2>
        <ul className="space-y-3">
          {cotizaciones.map((c) => {
            const estado = estadoDe(c)
            const m = codigo(c.moneda)
            const total = totalConIgv(c.monto_venta === null ? null : Number(c.monto_venta), c.incluye_igv)
            const facturado = facturadoDe(c)
            const facturadoPct = total === null || enOtraMoneda(c) ? null : parteDe(facturado, total)
            const falta = total === null || enOtraMoneda(c) ? 0 : Math.max(0, total - facturado)
            const aguarda = esperaDe(c, laQueMasEspera(c), recorridos)
            const varias = c.unidades.length > 1
            const conOt = c.unidades.filter((u) => u.codigo)
            const sinOt = c.unidades.length - conOt.length
            return (
              // Con `id`: el aviso de la campana aterriza en esta cotización (`#id`).
              <li key={c.cotizacion_id} id={c.cotizacion_id ?? undefined} className="scroll-mt-20" data-cotizacion={c.numero ?? undefined}>
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div>
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-texto">{rotuloDeCodigos(c.unidades)}</span>
                          {/* La que está en corrección no espera a Contabilidad: no se la llama «Por facturar». */}
                          {c.en_correccion && porFacturar(c) ? (
                            <Insignia>En corrección</Insignia>
                          ) : (
                            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                          )}
                          {porFacturar(c) && aguarda && (
                            <DiasEnEspera dias={aguarda.dias} desde={aguarda.desde} quien={aguarda.quien} verQuien={Boolean(c.en_correccion)} />
                          )}
                        </p>
                        <p className="mt-0.5 text-sm text-texto">
                          {c.cliente ?? 'Cliente sin registrar'}
                          <span className="text-texto-suave">
                            {' '}
                            · cotización {c.numero}
                            {varias && ` · ${c.unidades.length} unidades`}
                            {c.carroceria && ` · ${c.carroceria}`}
                          </span>
                        </p>
                        <p className="text-xs text-texto-suave">
                          {c.cliente_documento ?? 'Sin documento'}
                          {c.cliente_direccion ? ` · ${c.cliente_direccion}` : ' · Sin dirección fiscal: pídela a Administración'}
                        </p>
                      </div>
                      {c.aprobada_en && <p className="text-xs text-texto-tenue">Aprobada el {fecha(c.aprobada_en)}</p>}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="font-semibold tabular text-texto">
                        {total === null
                          ? 'Total de venta sin registrar'
                          : `Total de venta: ${moneda(total, m)}${c.incluye_igv === null ? ' (falta confirmar si incluye IGV)' : ' con IGV'}`}
                      </span>
                      {facturado > 0 && (
                        <span className="tabular text-texto-suave">
                          Facturado: <span className="text-texto">{moneda(facturado, m)}</span>
                          {facturadoPct !== null && ` · ${porcentaje(facturadoPct)}`}
                          {falta > 0.005 && (
                            <>
                              {' '}
                              · falta <span className="text-aviso">{moneda(falta, m)}</span>
                            </>
                          )}
                        </span>
                      )}
                      {c.url ? (
                        <a
                          href={c.url}
                          target={c.archivo_mime === 'application/pdf' ? '_blank' : undefined}
                          rel="noreferrer"
                          className="inline-flex min-h-11 items-center gap-1.5 text-acento hover:underline sm:min-h-0"
                        >
                          {c.archivo_mime === 'application/pdf' ? <FileText aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
                          {c.archivo_mime === 'application/pdf' ? 'Abrir la cotización' : 'Bajar la cotización'}
                        </a>
                      ) : (
                        <span role="alert" className="text-aviso">No se pudo abrir la cotización. Recarga la página.</span>
                      )}
                      {/* Guardado desde el visor, el PDF sale con el nombre interno del archivo. */}
                      {c.url && c.archivo_mime === 'application/pdf' && c.cotizacion_id && puedeBajar && (
                        <a
                          href={rutaParaBajarCotizacion(c.cotizacion_id)}
                          aria-label={`Descargar la cotización ${c.numero}`}
                          className="inline-flex min-h-11 items-center gap-1.5 text-acento hover:underline sm:min-h-0"
                        >
                          <Download aria-hidden className="size-4" />
                          Descargar
                        </a>
                      )}
                    </div>

                    {c.en_correccion && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-aviso-suave px-2.5 py-1.5 text-xs text-aviso">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>Ventas está corrigiendo esta cotización y Gerencia todavía no aprueba la versión nueva: se factura cuando la apruebe, porque el total puede cambiar.</span>
                      </p>
                    )}

                    {sinOt > 0 && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-neutro-suave px-2.5 py-1.5 text-xs text-texto-suave">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          {!varias
                            ? 'Falta que Administración cargue la OT con el código interno de la unidad: la factura se registra en ese código.'
                            : `Falta que Administración cargue la OT de ${
                                sinOt === c.unidades.length ? `las ${sinOt} unidades` : sinOt === 1 ? 'una unidad' : `${sinOt} unidades`
                              }: cada unidad se factura cuando tiene la suya, y la factura por toda la cotización, cuando estén todas.`}
                        </span>
                      </p>
                    )}

                    {varias && <Unidades cotizacion={c} moneda={m} recorridos={recorridos} factura={factura} />}

                    {c.facturas.length > 0 && (
                      <div className="space-y-2 border-t border-borde pt-3">
                        {c.facturas.map((f) => (
                          <FacturaDeVenta
                            key={f.id}
                            factura={f}
                            acciones={
                              factura && !f.anulada_en && !f.cobros.some((b) => !b.anulado_en) && f.id && f.numero ? (
                                <AnularFactura facturaId={f.id} numero={f.numero} />
                              ) : null
                            }
                          />
                        ))}
                      </div>
                    )}

                    {/* La base no deja facturar mientras la corrección espera a Gerencia (migración 20261026140000). */}
                    {factura && c.cotizacion_id && conOt.length > 0 && !c.en_correccion && (
                      <RegistrarFactura
                        cotizacionId={c.cotizacion_id}
                        numeroCotizacion={c.numero ?? ''}
                        codigoInterno={conOt[0]?.codigo ?? ''}
                        hoy={hoy}
                        monedaCotizacion={m}
                        totalCotizacion={total}
                        facturado={facturado}
                        unidades={
                          varias ? c.unidades.map((u) => ({ numero: u.numero, codigo: u.codigo, parte: u.parte, facturado: u.facturado })) : undefined
                        }
                      />
                    )}

                    {/* Para consultar: de la cotización a la factura y al cobro, quién hizo cada paso y quién la tiene ahora. */}
                    <Recorrido
                      pasos={recorridos ? describirRecorridoDeLaCotizacion((c.cotizacion_id && recorridos.get(c.cotizacion_id)) || []) : null}
                      className="rounded-[var(--radius-base)] border border-borde"
                      relleno="px-2.5"
                      femenino
                    />
                  </TarjetaCuerpo>
                </Tarjeta>
              </li>
            )
          })}
        </ul>
        </section>
      )}
      </div>
    </>
  )
}

/**
 * Las unidades de una cotización de varias (migración 20261126998000): cada una
 * con el código de su OT, en qué va su factura, lo que le toca del total y lo
 * que le falta. La que espera factura dice desde cuándo.
 */
function Unidades({
  cotizacion: c,
  moneda: m,
  recorridos,
  factura,
}: {
  cotizacion: CotizacionParaFacturar
  moneda: CodigoMoneda
  recorridos: Recorridos | null
  /** Quien mira registra facturas: cada unidad que espera lleva su «Facturar». */
  factura: boolean
}) {
  const otra: CodigoMoneda = m === 'USD' ? 'PEN' : 'USD'
  return (
    <section aria-label={`Unidades de la cotización ${c.numero}`} className="border-t border-borde pt-3">
      <h3 className="text-xs font-semibold text-texto-suave">Unidades</h3>
      <ul className="mt-1 divide-y divide-borde">
        {c.unidades.map((u) => {
          const estado = estadoDeUnidad(u, false)
          const falta = faltaDe(u)
          const espera = esperaFactura(u) && !c.en_correccion ? esperaDe(c, u, recorridos) : null
          return (
            <li key={u.numero} data-unidad={u.numero} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-texto">Unidad {u.numero}</span>
                {u.codigo && <span className="tabular whitespace-nowrap text-texto-suave">código {u.codigo}</span>}
                <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                {espera && <DiasEnEspera dias={espera.dias} desde={espera.desde} quien={espera.quien} />}
                {factura && c.cotizacion_id && u.codigo && esperaFactura(u) && !c.en_correccion && (
                  <FacturarUnidad cotizacionId={c.cotizacion_id} unidad={u.numero} />
                )}
              </p>
              <p className="tabular text-xs text-texto-suave">
                {u.parte === null ? (
                  'Sin total registrado'
                ) : (
                  <>
                    Le toca <span className="whitespace-nowrap text-texto">{moneda(u.parte, m)}</span>
                  </>
                )}
                {u.facturado > 0 && (
                  <>
                    {' '}
                    · facturado <span className="whitespace-nowrap">{moneda(u.facturado, m)}</span>
                  </>
                )}
                {u.facturado > 0 && falta !== null && falta > 0.005 && (
                  <>
                    {' '}
                    ·{' '}
                    <span className="whitespace-nowrap">
                      falta <span className="text-aviso">{moneda(falta, m)}</span>
                    </span>
                  </>
                )}
                {u.facturadoOtraMoneda > 0 && (
                  <>
                    {' '}
                    · en {nombreMoneda(otra)}, <span className="whitespace-nowrap">{moneda(u.facturadoOtraMoneda, otra)}</span>
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Lo que Contabilidad tiene por facturar, arriba y en una tabla: cada unidad
 * de una cotización aprobada que ya tiene su OT con código interno y no tiene
 * factura o la tiene por una parte, con lo que falta y los días que lleva
 * esperando desde que la OT tiene código (DKS, Plan 10). Cada fila baja a la
 * tarjeta de su cotización.
 */
function PorFacturar({ pendientes, recorridos }: { pendientes: Pendiente[]; recorridos: Recorridos | null }) {
  // La que más espera, entre las que Contabilidad puede facturar ya.
  const masAntigua = pendientes.reduce<number | null>((max, { c, u }) => {
    const d = c.en_correccion ? null : u.dias
    return d === null ? max : Math.max(max ?? 0, d)
  }, null)
  // Mientras todas las cotizaciones son de una unidad, se dice como siempre: «cotizaciones».
  const porUnidad = pendientes.some(({ c }) => c.unidades.length > 1)
  const descripcion =
    pendientes.length === 0
      ? null
      : `${
          porUnidad
            ? pendientes.length === 1
              ? 'Una unidad espera'
              : `${pendientes.length} unidades esperan`
            : pendientes.length === 1
              ? 'Una cotización espera'
              : `${pendientes.length} cotizaciones esperan`
        } su factura${
          masAntigua !== null && masAntigua > 0 ? `; la que más espera, desde ${haceDias(masAntigua)}` : ''
        }.`
  return (
    <Tarjeta id="por-facturar" className="overflow-hidden">
      <TarjetaCabecera
        titulo="Por facturar"
        descripcion={descripcion}
        ayuda={
          porUnidad
            ? 'Cada unidad de una cotización aprobada que ya tiene su OT con código interno y no tiene factura, o la tiene por una parte de lo que le toca. La cotización de varias unidades sale una vez por cada unidad que espera. Los días se cuentan desde que la OT tiene código interno, con la fecha de Lima, también los de la que está facturada en parte. La que está en corrección va al final: la tiene Gerencia o Ventas y no se factura hasta que vuelva aprobada. Toca una para ir a su tarjeta y registrar la factura.'
            : 'Las cotizaciones aprobadas que ya tienen su OT con código interno y no tienen factura, o la tienen por una parte del total. Los días se cuentan desde que la OT tiene código interno, con la fecha de Lima, también los de la que está facturada en parte. La que está en corrección va al final: la tiene Gerencia o Ventas y no se factura hasta que vuelva aprobada. Toca una para ir a su tarjeta y registrar la factura.'
        }
      />
      {pendientes.length === 0 ? (
        <div className="px-4 py-4">
          <SinDatos
            compacto
            titulo="Nada por facturar"
            descripcion="Cuando Administración cargue la OT con su código interno de una cotización aprobada, aparece aquí."
          />
        </div>
      ) : (
        <Tabla aria-label={`${porUnidad ? 'Unidades' : 'Cotizaciones'} por facturar, de la que más espera a la que menos`}>
          <TablaCabecera>
            <tr>
              <TH>Código interno</TH>
              <TH className="hidden sm:table-cell">Cliente y cotización</TH>
              <TH className="hidden text-right sm:table-cell">Falta facturar</TH>
              <TH className="text-right">Espera</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {pendientes.map(({ c, u }) => {
              const m = codigo(c.moneda)
              const falta = faltaDe(u)
              const enParte = u.facturas > 0
              const e = esperaDe(c, u, recorridos)
              const faltaTexto = falta === null ? null : moneda(falta, m)
              const deVarias = c.unidades.length > 1 ? `Unidad ${u.numero} de ${c.unidades.length}` : null
              return (
                // Toda la fila lleva a su tarjeta: el enlace del código la cubre con su `::after`.
                <TR key={`${c.cotizacion_id}:${u.numero}`} data-por-facturar={u.codigo ?? undefined} className="relative">
                  <TD className="align-top">
                    <Link
                      href={`#${c.cotizacion_id}`}
                      className="font-medium text-acento after:absolute after:inset-0 after:content-[''] hover:underline"
                    >
                      <span className="tabular">{u.codigo}</span>
                    </Link>
                    {(enParte || c.en_correccion) && (
                      <p className="mt-0.5 flex flex-wrap gap-1">
                        {enParte && <Insignia tono="aviso">En parte</Insignia>}
                        {c.en_correccion && <Insignia>En corrección</Insignia>}
                      </p>
                    )}
                    <DetalleEnTelefono>
                      <p className="text-sm break-words text-texto">{c.cliente ?? 'Cliente sin registrar'}</p>
                      <p className="text-xs text-texto-suave">
                        Cotización {c.numero}
                        {deVarias && ` · ${deVarias.toLowerCase()}`} ·{' '}
                        {faltaTexto === null ? (
                          'sin total registrado'
                        ) : (
                          <>
                            falta <span className="tabular whitespace-nowrap text-texto">{faltaTexto}</span>
                          </>
                        )}
                      </p>
                    </DetalleEnTelefono>
                  </TD>
                  <TD className="hidden align-top sm:table-cell">
                    <p className="break-words">{c.cliente ?? 'Cliente sin registrar'}</p>
                    <p className="text-xs text-texto-suave">
                      Cotización {c.numero}
                      {deVarias && ` · ${deVarias.toLowerCase()}`}
                    </p>
                  </TD>
                  <TD className="tabular hidden text-right align-top whitespace-nowrap sm:table-cell">{faltaTexto ?? 'Sin total registrado'}</TD>
                  <TD className="text-right align-top">
                    {e?.dias != null ? (
                      <DiasEnEspera dias={e.dias} desde={e.desde} quien={e.quien} verQuien={Boolean(c.en_correccion)} />
                    ) : (
                      <span className="text-xs text-texto-tenue">—</span>
                    )}
                  </TD>
                </TR>
              )
            })}
          </tbody>
        </Tabla>
      )}
    </Tarjeta>
  )
}
