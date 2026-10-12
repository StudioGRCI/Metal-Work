import {renderToBuffer} from '@react-pdf/renderer'
import {NextResponse} from 'next/server'
import {exigirPermiso} from '@/lib/sesion'
import {createClient} from '@/lib/supabase/server'
import {DocumentoCompraMateriales} from '@/lib/documentos/compra-materiales'
import {APROBACION_COMPRA, compraDetenida} from '@/lib/dominio/proveedores'

export async function GET(_request:Request,context:RouteContext<'/compras/[id]/pdf'>) {
 await exigirPermiso(['compras.ver','almacen.recibir'])
 const {id}=await context.params;const db=await createClient()
 const [compra,detalles]=await Promise.all([
   db.from('ordenes_compra_materiales').select('id,referencia,proveedor,fecha_estimada,condicion_pago,dias_credito,moneda,aprobacion,padron:proveedores(tipo_documento,numero_documento)').eq('id',id).maybeSingle(),
   db.from('orden_compra_material_detalles').select('id,cantidad,precio_unitario,requerimiento_detalle_id,requerimiento_id').eq('orden_compra_id',id).order('id'),
 ])
 if(compra.error||detalles.error)return NextResponse.json({error:'No se pudo leer la compra.'},{status:500})
 if(!compra.data)return NextResponse.json({error:'La compra no está disponible.'},{status:404})
 // Una compra por aprobar o rechazada no sale en papel: el papel es lo que se
 // le manda al proveedor.
 if(compraDetenida(compra.data.aprobacion))return NextResponse.json({error:`La compra ${compra.data.referencia} no se puede descargar: ${APROBACION_COMPRA[compra.data.aprobacion]?.descripcion??'espera aprobación.'}`},{status:409})
 const padron=compra.data.padron
 const ids=(detalles.data??[]).map(d=>d.requerimiento_detalle_id)
 const lineas=ids.length?await db.from('v_atencion_materiales').select('detalle_id,numero_ot,material,material_codigo,unidad').in('detalle_id',ids):{data:[],error:null}
 if(lineas.error)return NextResponse.json({error:'No se pudieron identificar los insumos.'},{status:500})
 const porId=new Map((lineas.data??[]).map(l=>[l.detalle_id,l]))
 if(ids.some(id=>!porId.has(id)))return NextResponse.json({error:'No tienes acceso a todas las solicitudes de esta compra.'},{status:403})
 const buffer=await renderToBuffer(<DocumentoCompraMateriales referencia={compra.data.referencia} proveedor={compra.data.proveedor} proveedorDocumento={padron?`${padron.tipo_documento} ${padron.numero_documento}`:null} entrega={compra.data.fecha_estimada} condicion={compra.data.condicion_pago} dias={compra.data.dias_credito} divisa={compra.data.moneda==='USD'?'USD':'PEN'} lineas={(detalles.data??[]).map(d=>{const l=porId.get(d.requerimiento_detalle_id);return {id:d.id,ot:l?.numero_ot??'—',codigo:l?.material_codigo??'',material:l?.material??'',unidad:l?.unidad??'',cantidad:d.cantidad,precio:d.precio_unitario}})}/> )
 return new NextResponse(new Uint8Array(buffer),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="MW-Compra-${compra.data.referencia.replace(/[^a-zA-Z0-9-]/g,'_')}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
}
