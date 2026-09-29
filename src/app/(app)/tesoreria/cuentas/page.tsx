import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { fecha } from '@/lib/format'
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
    db.from('v_compras_credito_sin_comprobante').select('orden_compra_id,numero_ot,proveedor,fecha_vencimiento,moneda,total_estimado').order('fecha_vencimiento').limit(100),
    db.from('ordenes_trabajo').select('id,numero').neq('estado','ANULADA').order('creado_en',{ascending:false}).limit(100),
    db.rpc('resumen_planilla_por_ot'),
  ])
  for(const r of [cobrar,pagar,pendientes,ordenes,planillas]) if(r.error) throw new Error(`No se pudieron cargar las cuentas: ${r.error.message}`)
  return <><EncabezadoPagina titulo="Cuentas de Tesorería" descripcion="Cobros de OT, pagos de comprobantes y compras a crédito pendientes de factura." />
    <Tarjeta className="mb-5"><TarjetaCabecera titulo="Cuenta por cobrar de una OT" descripcion="Registra la factura y su vencimiento; cada abono reduce el saldo." /><TarjetaCuerpo><NuevaCuenta ordenes={ordenes.data??[]} /></TarjetaCuerpo></Tarjeta>
    <div className="grid gap-5 xl:grid-cols-2">
      <Tarjeta><TarjetaCabecera titulo="Cuentas por cobrar" descripcion="Facturas emitidas para las OT." /><TarjetaCuerpo className="space-y-3">{(cobrar.data??[]).length===0?<p className="text-sm text-texto-suave">Sin cuentas por cobrar registradas.</p>:(cobrar.data??[]).map(c=><article key={c.id} className="rounded-lg border border-borde p-3"><p className="font-medium text-texto">OT {c.numero_ot} · {c.numero_documento}</p><p className="text-xs text-texto-suave">Vence {fecha(c.fecha_vencimiento)} · Total {c.moneda} {Number(c.total).toFixed(2)}</p><p className="tabular text-sm font-semibold text-texto">Saldo {c.moneda} {Number(c.saldo).toFixed(2)}</p>{Number(c.saldo)>0&&c.id&&<Movimiento id={c.id} tipo="cobro" saldo={Number(c.saldo)} />}</article>)}</TarjetaCuerpo></Tarjeta>
      <Tarjeta><TarjetaCabecera titulo="Cuentas por pagar" descripcion="Comprobantes a crédito que registró Contabilidad." /><TarjetaCuerpo className="space-y-3">{(pagar.data??[]).length===0?<p className="text-sm text-texto-suave">Sin cuentas por pagar registradas.</p>:(pagar.data??[]).map(c=><article key={c.id} className="rounded-lg border border-borde p-3"><p className="font-medium text-texto">{c.proveedor} · {c.numero_documento}</p><p className="text-xs text-texto-suave">OT {c.numero_ot??'—'} · Vence {fecha(c.fecha_vencimiento)} · Total {c.moneda} {Number(c.total).toFixed(2)}</p><p className="tabular text-sm font-semibold text-texto">Saldo {c.moneda} {Number(c.saldo).toFixed(2)}</p>{Number(c.saldo)>0&&c.id&&<Movimiento id={c.id} tipo="pago" saldo={Number(c.saldo)} />}</article>)}</TarjetaCuerpo></Tarjeta>
    </div>
    <Tarjeta className="mt-5"><TarjetaCabecera titulo="Compras a crédito sin comprobante" descripcion="Logística marcó crédito; Contabilidad aún debe vincular la factura." /><TarjetaCuerpo className="space-y-2">{(pendientes.data??[]).length===0?<p className="text-sm text-texto-suave">No hay compras a crédito pendientes de factura.</p>:(pendientes.data??[]).map(c=><p key={c.orden_compra_id} className="rounded-lg border border-borde p-3 text-sm">OT {c.numero_ot} · {c.proveedor} · vence {fecha(c.fecha_vencimiento)} · {c.moneda} {c.total_estimado===null?'precio pendiente':Number(c.total_estimado).toFixed(2)} · ID {c.orden_compra_id}</p>)}</TarjetaCuerpo></Tarjeta>
    <Tarjeta className="mt-5"><TarjetaCabecera titulo="Planillas distribuidas por OT" descripcion="Resumen de las planillas cerradas por RR. HH.; los nombres del personal permanecen en RR. HH." /><TarjetaCuerpo className="space-y-2">{(planillas.data??[]).length===0?<p className="text-sm text-texto-suave">Todavía no hay planillas cerradas.</p>:(planillas.data??[]).map((p,i)=><p key={`${p.orden_id}-${p.tipo}-${p.periodo}-${i}`} className="flex flex-wrap justify-between gap-2 rounded-lg border border-borde p-3 text-sm"><span>OT {p.numero_ot} · {p.tipo} · {p.periodo.slice(0,7)}</span><strong className="tabular">{p.moneda} {Number(p.monto).toFixed(2)}</strong></p>)}</TarjetaCuerpo></Tarjeta>
  </>
}
