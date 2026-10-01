import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_COMPROBANTE, TIPO_COMPROBANTE, definir } from '@/lib/dominio/estados'
import { fecha, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { CompletarAdquisicion, FormularioAdquisicion } from './formulario'

export const metadata = { title: 'Adquisiciones' }

export default async function PaginaAdquisiciones() {
  const perfil = await exigirPermiso('adquisiciones.ver')
  const supabase = await createClient()
  const [adquisiciones, ordenes, compras, documentos] = await Promise.all([
    supabase.from('adquisiciones').select('id, tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado, orden_id, registrado_por, ruta_storage, documento_compra_id').order('creado_en', { ascending: false }).limit(100),
    puede(perfil,'adquisiciones.registrar') ? supabase.from('ordenes_trabajo').select('id, numero').neq('estado','ANULADA').order('creado_en',{ascending:false}).limit(100) : Promise.resolve({data:[],error:null}),
    puede(perfil,'adquisiciones.registrar') ? supabase.from('ordenes_compra_materiales').select('id, proveedor, referencia, condicion_pago').order('creado_en',{ascending:false}).limit(100) : Promise.resolve({data:[],error:null}),
    puede(perfil,'adquisiciones.registrar') ? supabase.from('documentos_compra_material').select('id, nombre_archivo').eq('tipo','FACTURA').order('creado_en',{ascending:false}).limit(100) : Promise.resolve({data:[],error:null}),
  ])
  if (adquisiciones.error) throw new Error(`No se pudieron leer adquisiciones: ${adquisiciones.error.message}`)
  if (ordenes.error) throw new Error(`No se pudieron leer las OT: ${ordenes.error.message}`)
  if (compras.error) throw new Error(`No se pudieron leer las compras: ${compras.error.message}`)
  if (documentos.error) throw new Error(`No se pudieron leer las facturas existentes: ${documentos.error.message}`)
  const rutasPropias=(adquisiciones.data??[]).flatMap(a=>a.ruta_storage?[a.ruta_storage]:[])
  const enlaces=rutasPropias.length ? await supabase.storage.from('comprobantes-financieros').createSignedUrls(rutasPropias,600) : {data:[],error:null}
  if(enlaces.error) throw new Error('No se pudieron preparar los enlaces temporales a los comprobantes.')
  const urls=new Map((enlaces.data??[]).filter(e=>e.path&&e.signedUrl).map(e=>[e.path,e.signedUrl]))
  const idsDocs=(adquisiciones.data??[]).flatMap(a=>a.documento_compra_id?[a.documento_compra_id]:[])
  const docs=idsDocs.length ? await supabase.from('documentos_compra_material').select('id,ruta_storage').in('id',idsDocs) : {data:[],error:null}
  if(docs.error) throw new Error('No se pudieron leer las facturas vinculadas de Logística.')
  const rutasDocs=(docs.data??[]).map(d=>d.ruta_storage)
  const enlacesDocs=rutasDocs.length ? await supabase.storage.from('documentos-compras').createSignedUrls(rutasDocs,600) : {data:[],error:null}
  if(enlacesDocs.error) throw new Error('No se pudieron preparar los enlaces de facturas de Logística.')
  const urlsDocs=new Map((enlacesDocs.data??[]).filter(e=>e.path&&e.signedUrl).map(e=>[e.path,e.signedUrl]))
  const rutasPorDoc=new Map((docs.data??[]).map(d=>[d.id,d.ruta_storage]))
  const filas=(adquisiciones.data??[]).map(a=>({
    ...a,
    url:a.ruta_storage?urls.get(a.ruta_storage):a.documento_compra_id?urlsDocs.get(rutasPorDoc.get(a.documento_compra_id)??''):null,
  }))
  return <>
    <EncabezadoPagina titulo="Adquisiciones" descripcion="Contabilidad registra facturas y recibos; Tesorería ve los vencimientos y pagos." />
    {puede(perfil,'adquisiciones.registrar') && <Tarjeta className="mb-5"><TarjetaCabecera titulo="Nuevo comprobante" descripcion="Adjunta el PDF y relaciona la OT si corresponde." /><TarjetaCuerpo><FormularioAdquisicion ordenes={ordenes.data ?? []} compras={compras.data ?? []} documentos={documentos.data ?? []} /></TarjetaCuerpo></Tarjeta>}
    <Tarjeta><TarjetaCabecera titulo="Comprobantes registrados" descripcion="La condición de crédito genera saldo pendiente para Tesorería." />
      <TarjetaCuerpo className="space-y-2">{filas.length===0 ? <p className="text-sm text-texto-suave">Todavía no hay comprobantes.</p> : filas.map(a=><article key={a.id} className="grid gap-1 rounded-lg border border-borde p-3 sm:grid-cols-[1fr_auto]">
        <div><p className="flex flex-wrap items-center gap-2 font-medium text-texto">{a.proveedor} · {a.numero_documento}<Insignia tono={definir(ESTADO_COMPROBANTE, a.estado).tono}>{definir(ESTADO_COMPROBANTE, a.estado).etiqueta}</Insignia></p><p className="text-xs text-texto-suave">{definir(TIPO_COMPROBANTE, a.tipo).etiqueta} · emitido {fecha(a.fecha_emision)} · vence {fecha(a.fecha_vencimiento)}</p>
          {a.estado==='BORRADOR'&&a.registrado_por===perfil.id&&<CompletarAdquisicion id={a.id} />}
          {a.url&&<a href={a.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-medium text-acento hover:underline">Abrir PDF</a>}</div>
        <p className="tabular text-right font-semibold text-texto">{moneda(a.total, a.moneda==='USD'?'USD':'PEN')}</p>
      </article>)}</TarjetaCuerpo></Tarjeta>
  </>
}
