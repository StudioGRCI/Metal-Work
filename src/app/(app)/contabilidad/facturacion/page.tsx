import { Download, FileText, Hourglass, ReceiptText } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { FacturaDeVenta } from '@/components/finanzas/factura-de-venta'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Recorrido } from '@/components/ui/recorrido'
import { DetalleEnTelefono, SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { bandejaDeFacturacion, esperaDeFacturacion, type CotizacionParaFacturar, type EsperaDeFacturacion } from '@/lib/datos/facturacion'
import { recorridoDeCotizaciones } from '@/lib/datos/recorrido'
import { PERMISOS_BAJAR_COTIZACION, rutaParaBajarCotizacion } from '@/lib/descarga'
import { totalConIgv } from '@/lib/dominio/finanzas'
import { describirRecorridoDeLaCotizacion, haceDias } from '@/lib/dominio/recorrido'
import { fecha, hoyLima, moneda, parteDe, porcentaje, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularFactura, RegistrarFactura } from './acciones-factura'

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

/**
 * En qué va la cotización para Contabilidad, por su código y sus facturas
 * vigentes. Con la mitad facturada decía «Facturada» en verde y Contabilidad
 * leía que no le quedaba nada por facturar (auditoría del 27/10/2026).
 */
function estadoDe(c: CotizacionParaFacturar): { etiqueta: string; tono: 'aviso' | 'exito' | 'neutro' } {
  if (!c.codigo_interno) return { etiqueta: 'Sin código interno', tono: 'neutro' }
  if (!c.facturas.some((f) => !f.anulada_en)) return { etiqueta: 'Por facturar', tono: 'aviso' }
  const total = totalConIgv(c.monto_venta === null ? null : Number(c.monto_venta), c.incluye_igv)
  // Facturada en dólares una cotización en soles (o al revés): no se compara, pero tampoco se la da por entera o por parte.
  if (enOtraMoneda(c)) return { etiqueta: 'Facturada en otra moneda', tono: 'neutro' }
  if (total !== null && facturadoDe(c) < total - 0.005) return { etiqueta: 'Facturada en parte', tono: 'aviso' }
  return { etiqueta: 'Facturada', tono: 'exito' }
}

/** Lo que espera factura: con código interno, sin factura vigente o facturada en parte (Plan 10.1). */
const porFacturar = (c: CotizacionParaFacturar) => estadoDe(c).tono === 'aviso'

/** Cuánto falta facturar, en la moneda de la cotización; nulo si no tiene total. */
function faltaDe(c: CotizacionParaFacturar): number | null {
  const total = totalConIgv(c.monto_venta === null ? null : Number(c.monto_venta), c.incluye_igv)
  return total === null ? null : Math.max(0, total - facturadoDe(c))
}

/**
 * La factura de venta cuelga del código interno (migración 20261015124000):
 * cada cotización que Gerencia aprobó llega aquí con el cliente, su RUC y su
 * dirección fiscal; cuando Administración carga la OT con el código interno de
 * la unidad, Contabilidad registra la factura que emitió en SUNAT, con su PDF,
 * y la factura entra sola a las cuentas por cobrar de Tesorería.
 */
export default async function PaginaFacturacion() {
  const perfil = await exigirPermiso(['contabilidad.facturar', 'cotizaciones.ver_aprobadas'])
  const puedeBajar = puede(perfil, PERMISOS_BAJAR_COTIZACION)
  const factura = puede(perfil, 'contabilidad.facturar')
  const bandeja = await bandejaDeFacturacion()
  const hoy = hoyLima()
  const ids = bandeja.flatMap((c) => (c.cotizacion_id ? [c.cotizacion_id] : []))
  // Los días y el recorrido van aparte: si uno no se puede leer, la pantalla sigue con lo demás y lo dice en su lugar.
  const [espera, recorridos] = await Promise.all([
    esperaDeFacturacion(bandeja.filter(porFacturar).flatMap((c) => (c.cotizacion_id ? [c.cotizacion_id] : []))).catch((e: unknown) => {
      console.error('Facturación: no se pudieron contar los días en espera.', e)
      return null
    }),
    recorridoDeCotizaciones(ids).catch((e: unknown) => {
      console.error('Facturación: no se pudo leer el recorrido.', e)
      return null
    }),
  ])
  const diasDe = (c: CotizacionParaFacturar) => (c.cotizacion_id ? (espera?.get(c.cotizacion_id)?.dias ?? null) : null)
  // Lo que espera factura va primero, de lo más antiguo a lo más nuevo; después lo facturado y al final lo que espera su OT.
  const turno = (c: CotizacionParaFacturar) => (!c.codigo_interno ? 2 : porFacturar(c) ? 0 : 1)
  const cotizaciones = [...bandeja].sort((a, b) => turno(a) - turno(b) || (turno(a) === 0 ? (diasDe(b) ?? -1) - (diasDe(a) ?? -1) : 0))
  const pendientes = cotizaciones.filter(porFacturar)

  return (
    <>
      <EncabezadoPagina
        titulo="Facturación"
        ayuda="Las cotizaciones aprobadas, por código interno: registra la factura que emitiste en SUNAT y Tesorería la tiene por cobrar."
      />

      <div className="space-y-5">
      {cotizaciones.length > 0 && <PorFacturar pendientes={pendientes} espera={espera} />}

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
            return (
              // Con `id`: el aviso de la campana aterriza en esta cotización (`#id`).
              <li key={c.cotizacion_id} id={c.cotizacion_id ?? undefined} className="scroll-mt-20" data-cotizacion={c.numero ?? undefined}>
                <Tarjeta>
                  <TarjetaCuerpo className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div>
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-semibold text-texto">
                            {c.codigo_interno ? `Código ${c.codigo_interno}` : 'Sin código interno'}
                          </span>
                          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                          {porFacturar(c) && c.cotizacion_id && (
                            <DiasEnEspera
                              dias={espera?.get(c.cotizacion_id)?.dias}
                              desde={espera?.get(c.cotizacion_id)?.desde}
                              quien="Contabilidad"
                            />
                          )}
                        </p>
                        <p className="mt-0.5 text-sm text-texto">
                          {c.cliente ?? 'Cliente sin registrar'}
                          <span className="text-texto-suave">
                            {' '}
                            · cotización {c.numero}
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

                    {!c.codigo_interno && (
                      <p className="flex items-start gap-1.5 rounded-[var(--radius-base)] bg-neutro-suave px-2.5 py-1.5 text-xs text-texto-suave">
                        <Hourglass aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                        <span>Falta que Administración cargue la OT con el código interno de la unidad: la factura se registra en ese código.</span>
                      </p>
                    )}

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
                    {factura && c.cotizacion_id && c.codigo_interno && !c.en_correccion && (
                      <RegistrarFactura
                        cotizacionId={c.cotizacion_id}
                        numeroCotizacion={c.numero ?? ''}
                        codigoInterno={c.codigo_interno}
                        hoy={hoy}
                        monedaCotizacion={m}
                        totalCotizacion={total}
                        facturado={facturado}
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
 * Lo que Contabilidad tiene por facturar, arriba y en una tabla: cada
 * cotización aprobada con su OT y su código interno que no tiene factura o la
 * tiene por una parte, con lo que falta y los días que lleva esperando desde
 * que la OT tiene código (DKS, Plan 10). Cada fila baja a su tarjeta.
 */
function PorFacturar({ pendientes, espera }: { pendientes: CotizacionParaFacturar[]; espera: Map<string, EsperaDeFacturacion> | null }) {
  const masAntigua = pendientes.reduce<number | null>((max, c) => {
    const d = c.cotizacion_id ? (espera?.get(c.cotizacion_id)?.dias ?? null) : null
    return d === null ? max : Math.max(max ?? 0, d)
  }, null)
  const descripcion =
    pendientes.length === 0
      ? null
      : `${pendientes.length === 1 ? 'Una cotización espera' : `${pendientes.length} cotizaciones esperan`} su factura${
          masAntigua !== null && masAntigua > 0 ? `; la más antigua, ${haceDias(masAntigua)}` : ''
        }.`
  return (
    <Tarjeta id="por-facturar" className="overflow-hidden">
      <TarjetaCabecera
        titulo="Por facturar"
        descripcion={descripcion}
        ayuda="Las cotizaciones aprobadas que ya tienen su OT con código interno y no tienen factura, o la tienen por una parte del total. Los días se cuentan desde que la OT tiene código interno, con la fecha de Lima. Toca una para ir a su tarjeta y registrar la factura."
      />
      {espera === null && pendientes.length > 0 && (
        <p role="status" className="border-b border-borde px-4 py-2 text-xs text-aviso">
          No se pudieron contar los días en espera. Recarga la página; si continúa, avisa al administrador.
        </p>
      )}
      {pendientes.length === 0 ? (
        <div className="px-4 py-4">
          <SinDatos
            compacto
            titulo="Nada por facturar"
            descripcion="Cuando Administración cargue la OT con su código interno de una cotización aprobada, aparece aquí."
          />
        </div>
      ) : (
        <Tabla aria-label="Cotizaciones por facturar, de la que más espera a la que menos">
          <TablaCabecera>
            <tr>
              <TH>Código interno</TH>
              <TH className="hidden sm:table-cell">Cliente y cotización</TH>
              <TH className="hidden text-right sm:table-cell">Falta facturar</TH>
              <TH className="text-right">Espera</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {pendientes.map((c) => {
              const m = codigo(c.moneda)
              const falta = faltaDe(c)
              const enParte = c.facturas.some((f) => !f.anulada_en)
              const e = c.cotizacion_id ? espera?.get(c.cotizacion_id) : undefined
              const faltaTexto = falta === null ? 'Sin total' : moneda(falta, m)
              return (
                <TR key={c.cotizacion_id} data-por-facturar={c.codigo_interno ?? undefined}>
                  <TD className="align-top">
                    <Link href={`#${c.cotizacion_id}`} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
                      <span className="tabular">{c.codigo_interno}</span>
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
                        Cotización {c.numero} · falta <span className="tabular whitespace-nowrap text-texto">{faltaTexto}</span>
                      </p>
                    </DetalleEnTelefono>
                  </TD>
                  <TD className="hidden align-top sm:table-cell">
                    <p className="break-words">{c.cliente ?? 'Cliente sin registrar'}</p>
                    <p className="text-xs text-texto-suave">Cotización {c.numero}</p>
                  </TD>
                  <TD className="tabular hidden text-right align-top whitespace-nowrap sm:table-cell">{faltaTexto}</TD>
                  <TD className="text-right align-top">
                    {e?.dias != null ? (
                      <DiasEnEspera dias={e.dias} desde={e.desde} quien="Contabilidad" />
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
