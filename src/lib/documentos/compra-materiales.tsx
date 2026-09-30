import {Document,Page,Text,View,StyleSheet} from '@react-pdf/renderer'
import {cantidad,fecha,moneda} from '@/lib/format'
import {importeCompra,totalCompra} from '@/lib/dominio/compra-materiales'

export type LineaCompraPdf={id:string;ot:string;codigo:string;material:string;unidad:string;cantidad:number;precio:number|null}
const s=StyleSheet.create({page:{padding:35,fontFamily:'Helvetica',fontSize:9,color:'#16283d'},title:{fontSize:20,fontFamily:'Helvetica-Bold',lineHeight:1.3,marginBottom:8},sub:{color:'#526174',fontSize:9,lineHeight:1.4},cab:{backgroundColor:'#dde8f5',padding:7,flexDirection:'row'},row:{padding:7,flexDirection:'row',borderBottomWidth:0.5,borderColor:'#d6dce4'},material:{width:'48%'},ot:{width:'15%'},qty:{width:'12%',textAlign:'right'},price:{width:'12%',textAlign:'right'},total:{width:'13%',textAlign:'right'},foot:{position:'absolute',bottom:20,left:35,right:35,fontSize:8,color:'#526174'}})
export function DocumentoCompraMateriales({referencia,proveedor,entrega,condicion,dias,divisa,lineas}:{referencia:string;proveedor:string;entrega:string|null;condicion:string;dias:number;divisa:'PEN'|'USD';lineas:LineaCompraPdf[]}) {
 const total=totalCompra(lineas)
 return <Document title={'Orden de compra '+referencia}><Page size="A4" style={s.page}>
 <Text style={s.sub}>METAL WORK PERÚ S.A.C.</Text><Text style={s.title}>Orden de compra {referencia}</Text>
 <Text style={s.sub}>Proveedor: {proveedor}</Text><Text style={s.sub}>Entrega estimada: {fecha(entrega)} · Pago: {condicion==='CREDITO'?`Crédito a ${dias} días`:'Contado'} · {divisa}</Text>
 <View style={[s.cab,{marginTop:22}]} fixed><Text style={s.material}>INSUMO / UNIDAD</Text><Text style={s.ot}>OT</Text><Text style={s.qty}>CANTIDAD</Text><Text style={s.price}>P. UNITARIO</Text><Text style={s.total}>IMPORTE</Text></View>
 {lineas.map(l=><View key={l.id} style={s.row} wrap={false}><View style={s.material}><Text>{l.material}</Text><Text style={s.sub}>{l.codigo} · {l.unidad}</Text></View><Text style={s.ot}>{l.ot}</Text><Text style={s.qty}>{cantidad(l.cantidad)}</Text><Text style={s.price}>{l.precio===null?'Pendiente':moneda(l.precio,divisa)}</Text><Text style={s.total}>{l.precio===null?'Pendiente':moneda(importeCompra(l.cantidad,l.precio),divisa)}</Text></View>)}
 <Text style={[s.title,{fontSize:12,marginTop:18,textAlign:'right'}]}>{lineas.some(l=>l.precio===null)?'Total parcial: ':'Total: '}{moneda(total,divisa)}</Text>
 <Text style={s.sub}>Importes según los precios registrados. La factura y la recepción se registran en el sistema; este documento no acredita pago ni recepción.</Text>
 <Text style={s.foot} fixed render={({pageNumber,totalPages})=>`Metal Work · ${referencia} · ${pageNumber} de ${totalPages}`}/>
 </Page></Document>
}
