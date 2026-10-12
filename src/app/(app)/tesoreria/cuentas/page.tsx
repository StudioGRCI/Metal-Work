import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_PLANILLA, definir } from '@/lib/dominio/estados'
import { diasHasta, fecha, moneda, periodo, type CodigoMoneda } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { Movimiento, NuevaCuenta } from './formularios'

export const metadata={title:'Cuentas de Tesorería'}

export default async function PaginaCuentas() {
  await exigirPermiso('tesoreria.ver_documentos')
  const db=await createClient()
  const [cobrar,pagar,pendientes,ordenes,planillas]=await Promise.all([
    db.from('v_cuentas_cobrar_ot').select('id,numero_ot,numero_documento,fecha_vencimiento,moneda,total,cobrado,saldo').order('fecha_vencimiento').limit(100),
    db.from('v_cuentas_pagar').select('id,numero_ot,proveedor,numero_documento,fecha_vencimiento,moneda,total,pagado,saldo').order('fecha_vencimiento').limit(100),
    db.from('v_compras_credito_sin_comprobante').select('orden_compra_id,numero_ot,proveedor,referencia,fecha_compra,fecha_vencimiento,moneda,total_estimado').order('fecha_vencimiento').limit(100),
    db.from('ordenes_trabajo').select('id,numero').neq('estado','ANULADA').order('creado_en',{ascending:false}).limit(100),
    db.rpc('resumen_planilla_por_ot'),
  ])
  for(const r of [cobrar,pagar,pendientes,ordenes,planillas]) if(r.error) throw new Error(`No se pudieron cargar las cuentas: ${r.error.message}`)
  return <><EncabezadoPagina titulo="Cuentas de Tesorería" descripcion="Cobros de OT, pagos de comprobantes y compras a crédito pendientes de factura." />
    <Tarjeta className="mb-5"><TarjetaCabecera titulo="Cuenta por cobrar de una OT" descripcion="Registra la factura y su vencimiento; cada abono reduce el saldo." /><TarjetaCuerpo><NuevaCuenta ordenes={ordenes.data??[]} /></TarjetaCuerpo></Tarjeta>
    <div className="grid gap-5 xl:grid-cols-2">
      <Tarjeta>
        <TarjetaCabecera titulo="Cuentas por cobrar" descripcion="Facturas emitidas para las OT, de la que vence antes a la que vence después." />
        <TarjetaCuerpo className="space-y-3">
          {(cobrar.data??[]).length===0 ? <p className="text-sm text-texto-suave">Sin cuentas por cobrar registradas.</p> : (cobrar.data??[]).map(c=>
            <article key={c.id} className="rounded-[var(--radius-base)] border border-borde p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium text-texto">OT {c.numero_ot} · {c.numero_documento}</p>
                <p className="tabular text-sm font-semibold text-texto">Saldo {moneda(c.saldo, codigoMoneda(c.moneda))}</p>
              </div>
              <p className="text-xs text-texto-suave">
                <Vencimiento dia={c.fecha_vencimiento} saldo={Number(c.saldo)} /> · Total {moneda(c.total, codigoMoneda(c.moneda))}
                {Number(c.cobrado)>0 && ` · cobrado ${moneda(c.cobrado, codigoMoneda(c.moneda))}`}
              </p>
              {Number(c.saldo)>0&&c.id&&<Movimiento id={c.id} tipo="cobro" saldo={Number(c.saldo)} />}
            </article>)}
        </TarjetaCuerpo>
      </Tarjeta>
      <Tarjeta>
        <TarjetaCabecera titulo="Cuentas por pagar" descripcion="Comprobantes a crédito que registró Contabilidad, de la que vence antes a la que vence después." />
        <TarjetaCuerpo className="space-y-3">
          {(pagar.data??[]).length===0 ? <p className="text-sm text-texto-suave">Sin cuentas por pagar registradas.</p> : (pagar.data??[]).map(c=>
            <article key={c.id} className="rounded-[var(--radius-base)] border border-borde p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-medium text-texto">{c.proveedor} · {c.numero_documento}</p>
                <p className="tabular text-sm font-semibold text-texto">Saldo {moneda(c.saldo, codigoMoneda(c.moneda))}</p>
              </div>
              <p className="text-xs text-texto-suave">
                OT {c.numero_ot??'—'} · <Vencimiento dia={c.fecha_vencimiento} saldo={Number(c.saldo)} /> · Total {moneda(c.total, codigoMoneda(c.moneda))}
                {Number(c.pagado)>0 && ` · pagado ${moneda(c.pagado, codigoMoneda(c.moneda))}`}
              </p>
              {Number(c.saldo)>0&&c.id&&<Movimiento id={c.id} tipo="pago" saldo={Number(c.saldo)} />}
            </article>)}
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
    <Tarjeta className="mt-5">
      <TarjetaCabecera titulo="Compras a crédito sin comprobante" descripcion="Logística marcó crédito; Contabilidad aún debe vincular la factura." />
      <TarjetaCuerpo className="space-y-2">
        {(pendientes.data??[]).length===0 ? <p className="text-sm text-texto-suave">No hay compras a crédito pendientes de factura.</p> : (pendientes.data??[]).map(c=>
          <div key={c.orden_compra_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-[var(--radius-base)] border border-borde p-3 text-sm">
            <span>
              <span className="text-texto">OT {c.numero_ot} · {c.proveedor}{c.referencia ? ` · ${c.referencia}` : ''}</span>
              <span className="block text-xs text-texto-suave">Comprada el {fecha(c.fecha_compra)} · <Vencimiento dia={c.fecha_vencimiento} saldo={Number(c.total_estimado ?? 1)} /></span>
            </span>
            <strong className="tabular">{c.total_estimado===null ? <span className="font-normal text-aviso">Precio pendiente</span> : moneda(c.total_estimado, codigoMoneda(c.moneda))}</strong>
          </div>)}
      </TarjetaCuerpo>
    </Tarjeta>
    <Tarjeta className="mt-5">
      <TarjetaCabecera titulo="Planillas distribuidas por OT" descripcion="Resumen de las planillas cerradas por RR. HH.; los nombres del personal permanecen en RR. HH." />
      <TarjetaCuerpo className="space-y-2">
        {(planillas.data??[]).length===0 ? <p className="text-sm text-texto-suave">Todavía no hay planillas cerradas.</p> : (planillas.data??[]).map((p,i)=>
          <p key={`${p.orden_id}-${p.tipo}-${p.periodo}-${i}`} className="flex flex-wrap justify-between gap-2 rounded-[var(--radius-base)] border border-borde p-3 text-sm">
            <span>OT {p.numero_ot} · {definir(TIPO_PLANILLA, p.tipo).etiqueta} · {periodo(p.periodo)}</span>
            <strong className="tabular">{moneda(p.monto, codigoMoneda(p.moneda))}</strong>
          </p>)}
      </TarjetaCuerpo>
    </Tarjeta>
  </>
}

function codigoMoneda(codigo: string | null): CodigoMoneda {
  return codigo === 'USD' ? 'USD' : 'PEN'
}

/** El vencimiento dicho como se lee: lo que ya venció con saldo se marca en rojo. */
function Vencimiento({ dia, saldo }: { dia: string | null; saldo: number }) {
  const faltan = diasHasta(dia)
  if (faltan === null) return <>Sin vencimiento</>
  if (saldo > 0 && faltan < 0) {
    return <span className="text-peligro">Venció el {fecha(dia)}, hace {-faltan} {faltan === -1 ? 'día' : 'días'}</span>
  }
  if (saldo > 0 && faltan === 0) return <span className="text-aviso">Vence hoy</span>
  return <>Vence {fecha(dia)}</>
}
