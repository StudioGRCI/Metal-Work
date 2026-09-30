import {EncabezadoPagina} from '@/components/estructura/encabezado-pagina'
import {TableroMateriales} from '../materiales/atencion/tablero'
import {cargarAtencionMateriales} from '@/lib/datos/atencion-materiales'
import {exigirPermiso} from '@/lib/sesion'

export const metadata={title:'Compras · Logística'}
export default async function PaginaCompras() {
 await exigirPermiso('compras.crear')
 const d=await cargarAtencionMateriales({verRequerimientos:true,verExistencias:false,verCompras:true,crearCompra:true,recibir:false,despachar:false})
 return <><EncabezadoPagina titulo="Compras de Logística" descripcion="Agrupa insumos derivados por Almacén. Sus solicitudes y entregas siguen disponibles dentro de cada OT."/>
 <TableroMateriales lineas={d.lineas} existencias={d.existencias} compras={d.compras} areas={[]} responsables={[]} puedeCrearCompra puedeVerCompras puedeAdjuntarDocumentos puedeAprobarDiseno={false} puedeRevisarStock={false} puedeRecibir={false} puedeDespachar={false} clavesRecepcion={{}} clavesDespacho={{}} clavesDocumento={Object.fromEntries(d.compras.map(c=>[c.orden_compra_id??'',crypto.randomUUID()]))}/></>
}
