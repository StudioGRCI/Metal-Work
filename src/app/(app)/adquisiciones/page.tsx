import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { comprasSinFactura, controlDeFacturas, enlacesDeComprobantes, type ControlDeFactura } from '@/lib/datos/adquisiciones'
import { documentosDeCompraParaTesoreria } from '@/lib/datos/tesoreria'
import { ESTADO_COMPROBANTE, TIPO_COMPROBANTE, definir } from '@/lib/dominio/estados'
import { CONTROL_FACTURA_COMPRA } from '@/lib/dominio/finanzas'
import { lecturaDeFila } from '@/lib/dominio/lectura-factura'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { AvisosDelDetector, avisosDeFacturaRegistrada, InsigniaDelDetector } from './detector'
import { DocumentosDeCompras } from './documentos-compras'
import { CompletarAdquisicion, FormularioAdquisicion } from './formulario'

export const metadata = { title: 'Adquisiciones' }

const codigo = (m: string | null) => (m === 'USD' ? 'USD' : 'PEN')

/**
 * Todo lo comprado, por factura. Contabilidad registra cada factura con las OC
 * que cubre (una o varias, migración 20261015122000) y aquí mismo se ve si su
 * total calza con el de sus OC: es solo un aviso. Tesorería y Logística la
 * consultan; Tesorería la paga en Cuentas por pagar.
 */
export default async function PaginaAdquisiciones() {
  const perfil = await exigirPermiso('adquisiciones.ver')
  const registra = puede(perfil, 'adquisiciones.registrar')
  const verDocumentosCompra = puede(perfil, 'tesoreria.ver_documentos')
  const supabase = await createClient()
  const [adquisiciones, sinFactura, ordenes, documentos, documentosCompra] = await Promise.all([
    supabase
      .from('adquisiciones')
      .select(
        'id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado, registrado_por, ruta_storage, documento_compra_id, lectura_fuente, lectura_total, lectura_moneda, lectura_numero, lectura_ordenes',
      )
      .order('creado_en', { ascending: false })
      .limit(100),
    comprasSinFactura(),
    registra
      ? supabase.from('ordenes_trabajo').select('id, numero').neq('estado', 'ANULADA').order('creado_en', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    registra
      ? supabase.from('documentos_compra_material').select('id, nombre_archivo').eq('tipo', 'FACTURA').order('creado_en', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null }),
    verDocumentosCompra ? documentosDeCompraParaTesoreria() : Promise.resolve([]),
  ])
  if (adquisiciones.error) throw new Error(`No se pudieron leer adquisiciones: ${adquisiciones.error.message}`)
  if (ordenes.error) throw new Error(`No se pudieron leer las OT: ${ordenes.error.message}`)
  if (documentos.error) throw new Error(`No se pudieron leer las facturas existentes: ${documentos.error.message}`)

  const filas = adquisiciones.data ?? []
  const ids = filas.map((a) => a.id)
  const [controles, urls, saldos] = await Promise.all([
    controlDeFacturas(ids),
    enlacesDeComprobantes(filas),
    ids.length ? supabase.from('v_cuentas_pagar').select('id, pagado, saldo').in('id', ids) : Promise.resolve({ data: [], error: null }),
  ])
  if (saldos.error) throw new Error(`No se pudo leer lo pagado de cada factura: ${saldos.error.message}`)
  const saldoDe = new Map((saldos.data ?? []).map((s) => [s.id, s]))
  const avisosDe = new Map(
    filas.map((a) => [a.id, a.estado === 'BORRADOR' ? [] : avisosDeFacturaRegistrada({ ...a, lectura: lecturaDeFila(a) }, controles.get(a.id) ?? null)]),
  )
  const noCalzan = filas.filter((a) => controles.get(a.id)?.control === 'NO_CALZA' || (avisosDe.get(a.id)?.length ?? 0) > 0).length

  return (
    <>
      <EncabezadoPagina
        titulo="Adquisiciones"
        descripcion="Todo lo comprado, por factura: Contabilidad registra cada factura con las OC que cubre, y aquí se ve si su total calza con el de sus OC. Tesorería la paga en Cuentas por pagar."
      />

      {registra && (
        <Tarjeta className="mb-5">
          <TarjetaCabecera titulo="Nuevo comprobante" descripcion="Marca las OC que cubre la factura y adjunta el PDF." />
          <TarjetaCuerpo>
            <FormularioAdquisicion
              ordenes={ordenes.data ?? []}
              compras={sinFactura}
              documentos={documentos.data ?? []}
            />
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <Tarjeta>
        <TarjetaCabecera
          titulo="Comprobantes registrados"
          descripcion={
            noCalzan > 0
              ? `${noCalzan === 1 ? 'Una factura no calza' : `${noCalzan} facturas no calzan`} con sus OC o con lo que dice el papel: revisa si falta una OC, si cubre otra cosa o si hay que corregirla.`
              : 'Cada factura con sus OC y lo que falta pagarle.'
          }
        />
        <TarjetaCuerpo className="space-y-2">
          {filas.length === 0 ? (
            <p className="text-sm text-texto-suave">Todavía no hay comprobantes. Contabilidad los registra con el formulario de arriba.</p>
          ) : (
            filas.map((a) => {
              const estado = definir(ESTADO_COMPROBANTE, a.estado)
              const control = controles.get(a.id) ?? null
              const cuenta = saldoDe.get(a.id)
              const url = urls.get(a.id)
              const avisos = avisosDe.get(a.id) ?? []
              return (
                <article key={a.id} className="grid gap-1 rounded-[var(--radius-base)] border border-borde p-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-medium text-texto">
                      {a.proveedor} · <span className="tabular">{a.numero_documento}</span>
                      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                      {control && <Control control={control} />}
                      <InsigniaDelDetector avisos={avisos} />
                    </p>
                    <p className="text-xs text-texto-suave">
                      {definir(TIPO_COMPROBANTE, a.tipo).etiqueta} · {a.condicion_pago === 'CREDITO' ? 'crédito' : 'contado'} · emitido{' '}
                      {fecha(a.fecha_emision)} · vence {fecha(a.fecha_vencimiento)}
                    </p>
                    {control && <OrdenesDeLaFactura control={control} total={Number(a.total)} monedaFactura={a.moneda} />}
                    <AvisosDelDetector avisos={avisos} />
                    {a.estado === 'BORRADOR' && a.registrado_por === perfil.id && <CompletarAdquisicion id={a.id} />}
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-acento hover:underline sm:min-h-0">
                        Abrir PDF
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="tabular font-semibold text-texto">{moneda(a.total, codigo(a.moneda))}</p>
                    {cuenta &&
                      (Number(cuenta.saldo) <= 0 ? (
                        <p className="text-xs text-exito">Pagada</p>
                      ) : (
                        <p className="tabular text-xs text-texto-suave">
                          {Number(cuenta.pagado) > 0 ? 'Saldo' : 'Por pagar'} {moneda(cuenta.saldo, codigo(a.moneda))}
                        </p>
                      ))}
                  </div>
                </article>
              )
            })
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta className="mt-5">
        <TarjetaCabecera
          titulo="OC que esperan su factura"
          descripcion="Las OC aprobadas que van con factura y todavía no están en ninguna factura registrada."
        />
        <TarjetaCuerpo className="space-y-2">
          {sinFactura.length === 0 ? (
            <p className="text-sm text-texto-suave">Ninguna OC espera su factura.</p>
          ) : (
            sinFactura.map((c) => (
              <div
                key={c.orden_compra_id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[var(--radius-base)] border border-borde p-3 text-sm"
              >
                <span>
                  <span className="text-texto">
                    <span className="tabular">{c.numero ?? c.referencia}</span> · {c.proveedor}
                  </span>
                  <span className="block text-xs text-texto-suave">
                    {c.numero_ot ? `OT ${c.numero_ot}` : 'Para almacén'} · {c.condicion_pago === 'CREDITO' ? 'crédito' : 'contado'} · emitida el{' '}
                    {fecha(c.creado_en)}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {c.en_borrador && <Insignia tono="aviso">En un borrador</Insignia>}
                  <strong className="tabular">
                    {c.sin_precio ? <span className="font-normal text-aviso">Precio pendiente</span> : moneda(c.total, codigo(c.moneda))}
                  </strong>
                </span>
              </div>
            ))
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      {verDocumentosCompra && <DocumentosDeCompras documentos={documentosCompra} />}
    </>
  )
}

function Control({ control }: { control: ControlDeFactura }) {
  const def = CONTROL_FACTURA_COMPRA[control.control] ?? { etiqueta: control.control, tono: 'neutro' as const }
  return <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
}

/** Las OC de la factura y, si no calza, cuánto difiere. */
function OrdenesDeLaFactura({ control, total, monedaFactura }: { control: ControlDeFactura; total: number; monedaFactura: string }) {
  if (control.ordenes.length === 0) return null
  const m = codigo(monedaFactura)
  return (
    <>
      <p className="text-xs text-texto-suave">
        {control.ordenes.length === 1 ? 'OC ' : `${control.ordenes.length} OC: `}
        {control.ordenes.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ' · '}
            <span className="tabular text-texto">{o.numero ?? o.referencia}</span>
            {o.numero_ot && ` (OT ${o.numero_ot})`}{' '}
            {o.sin_precio ? 'sin precio' : <span className="tabular">{moneda(o.total, codigo(o.moneda))}</span>}
          </span>
        ))}
      </p>
      {control.control === 'NO_CALZA' && control.total_oc !== null && control.diferencia !== null && (
        <p className="text-xs text-aviso">
          La factura dice {moneda(total, m)} y sus OC suman {moneda(control.total_oc, m)}: {control.diferencia > 0 ? 'sobran' : 'faltan'}{' '}
          {moneda(Math.abs(control.diferencia), m)}.
        </p>
      )}
    </>
  )
}
