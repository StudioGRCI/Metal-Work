import {EncabezadoPagina} from '@/components/estructura/encabezado-pagina'
import {EnlaceBoton} from '@/components/ui/enlace-boton'
import {TableroMateriales} from '../materiales/atencion/tablero'
import {cargarAtencionMateriales} from '@/lib/datos/atencion-materiales'
import {proveedoresParaCompra} from '@/lib/datos/proveedores'
import {exigirPermiso, puede} from '@/lib/sesion'

export const metadata={title:'Compras · Logística'}
export default async function PaginaCompras() {
 const perfil=await exigirPermiso('compras.crear')
 const [d,proveedores]=await Promise.all([
  cargarAtencionMateriales({verRequerimientos:true,verExistencias:false,verCompras:true,crearCompra:true,recibir:false,despachar:false}),
  proveedoresParaCompra(),
 ])
 return <><EncabezadoPagina titulo="Compras de Logística" descripcion="Agrupa insumos derivados por Almacén. Sus solicitudes y entregas siguen disponibles dentro de cada OT."
  acciones={<div className="flex flex-wrap gap-2"><EnlaceBoton href="/proveedores" variante="contorno">Proveedores</EnlaceBoton><EnlaceBoton href="/compras/aprobacion" variante="contorno">Aprobación de compras</EnlaceBoton></div>}/>
 <TableroMateriales lineas={d.lineas} existencias={d.existencias} compras={d.compras} areas={[]} responsables={[]} puedeCrearCompra puedeVerCompras puedeAdjuntarDocumentos puedeAprobarDiseno={false} puedeRevisarStock={false} puedeRecibir={false} puedeDespachar={false} clavesRecepcion={{}} clavesDespacho={{}} clavesDocumento={Object.fromEntries(d.compras.map(c=>[c.orden_compra_id??'',crypto.randomUUID()]))}
  proveedores={proveedores} puedeRegistrarProveedor={puede(perfil,'proveedores.editar')}/></>
}
