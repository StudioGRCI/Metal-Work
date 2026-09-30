'use server'
import {readSheet} from 'read-excel-file/node'
import {unzipSync} from 'fflate'
import {revalidatePath} from 'next/cache'
import {z} from 'zod'
import {exigirPermiso} from '@/lib/sesion'
import {createClient} from '@/lib/supabase/server'
import {mensajeDeError,NO_TOCO_NADA,type ResultadoAccion} from '@/lib/acciones'
import {leerPlanillaMwp,lineaPlanilla,type LineaPlanilla} from '@/lib/dominio/planilla-mwp'

export async function leerExcelPlanilla(_previo:unknown,datos:FormData):Promise<ResultadoAccion<{hoja:string;lineas:LineaPlanilla[]}>> {
 await exigirPermiso('rrhh.gestionar_planillas')
 const archivo=datos.get('archivo'),hoja=datos.get('hoja')
 if(!(archivo instanceof File)||archivo.size===0||archivo.size>3*1024*1024||typeof hoja!=='string'||!/^RESUMEN .+ MWP - \d{4}$/i.test(hoja.trim()))return {ok:false,error:'Elige un Excel de hasta 3 MB y la hoja RESUMEN del mes MWP.'}
 try{
   const bytes=new Uint8Array(await archivo.arrayBuffer())
   if(bytes[0]!==80||bytes[1]!==75)return {ok:false,error:'El archivo no es un libro XLSX válido.'}
   let descomprimido=0,entradas=0
   // Inspeccionar el directorio ZIP sin extraer: impide expandir un XLSX pequeño en cientos de MB.
   unzipSync(bytes,{filter:entrada=>{descomprimido+=entrada.originalSize;entradas++;if(descomprimido>30*1024*1024||entradas>2000)throw new Error('El Excel contiene demasiados datos. Usa solamente la planilla del mes.');return false}})
   const filas=await readSheet(Buffer.from(bytes),hoja.trim(),{trim:false})
   const lineas=leerPlanillaMwp(filas)
   return {ok:true,datos:{hoja:hoja.trim(),lineas}}
 }catch(error){return {ok:false,error:error instanceof Error?error.message:'No se pudo leer el detalle de Metal Work.'}}
}

export async function confirmarImportacion(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
 await exigirPermiso('rrhh.gestionar_planillas')
 const cab=z.object({planilla_id:z.string().uuid(),importacion_id:z.string().uuid(),hoja:z.string().regex(/^RESUMEN .+ MWP - \d{4}$/i),lineas:z.string().max(1000000)}).safeParse(Object.fromEntries(datos))
 if(!cab.success)return {ok:false,error:'Revisa la planilla, hoja y personas seleccionadas.'}
 let raw:unknown;try{raw=JSON.parse(cab.data.lineas)}catch{return {ok:false,error:'El detalle no se pudo leer. Vuelve a cargar el Excel.'}}
 const lineas=z.array(lineaPlanilla).min(1).max(300).safeParse(raw)
 if(!lineas.success)return {ok:false,error:'El detalle contiene importes o personas inválidos.'}
 const db=await createClient();const p=await db.from('planillas').select('periodo,moneda').eq('id',cab.data.planilla_id).maybeSingle()
 if(p.error)return {ok:false,error:mensajeDeError(p.error)}
 if(!p.data||p.data.moneda!=='PEN')return {ok:false,error:'Este resumen se importa únicamente en una planilla en soles.'}
 const meses=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
 const mes=meses[Number(p.data.periodo.slice(5,7))-1]
 if(cab.data.hoja.toUpperCase()!==`RESUMEN ${mes} MWP - ${p.data.periodo.slice(0,4)}`)return {ok:false,error:'El mes y año de la hoja no corresponden a esta planilla.'}
 const {data,error}=await db.rpc('importar_detalle_planilla',{p_id:cab.data.importacion_id,p_planilla:cab.data.planilla_id,p_hoja:cab.data.hoja,p_lineas:lineas.data})
 if(error)return {ok:false,error:mensajeDeError(error)}
 if(data!==cab.data.importacion_id)return {ok:false,error:NO_TOCO_NADA}
 revalidatePath('/rrhh')
 return {ok:true,mensaje:`${lineas.data.length} personas importadas. Distribuye su costo entre las OT antes de cerrar la planilla.`}
}
