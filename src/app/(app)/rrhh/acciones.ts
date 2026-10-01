'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const uuid=z.string().uuid()
const volver=()=>revalidatePath('/rrhh')

export async function crearPlanilla(_previo:unknown, datos:FormData):Promise<ResultadoAccion> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const v=z.object({tipo:z.enum(['TALLER','ADMINISTRATIVA','SUBCONTRATOS']),periodo:z.iso.date(),moneda:z.enum(['PEN','USD']),observacion:z.string().trim().max(1000)}).safeParse(Object.fromEntries(datos))
  if(!v.success || !v.data.periodo.endsWith('-01')) return {ok:false,error:'Elige tipo, mes y moneda. El período debe empezar el día 1.'}
  const db=await createClient()
  const {data,error}=await db.from('planillas').insert(v.data).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Planilla en borrador creada.'}
}

export async function agregarPersona(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const v=z.object({planilla_id:uuid,nombre:z.string().trim().min(3).max(160),documento:z.string().trim().max(20),monto:z.coerce.number().min(0).multipleOf(0.01)}).safeParse(Object.fromEntries(datos))
  if(!v.success) return {ok:false,error:'Indica planilla, nombre y monto válidos.'}
  const db=await createClient()
  const {data,error}=await db.from('planilla_personas').insert({...v.data,documento:v.data.documento||null}).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Persona o subcontrato agregado.'}
}

export async function distribuirPersona(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const v=z.object({persona_id:uuid,orden_id:uuid,porcentaje:z.coerce.number().positive().max(100).multipleOf(0.01)}).safeParse(Object.fromEntries(datos))
  if(!v.success) return {ok:false,error:'Elige la persona, OT y porcentaje entre 0.01 y 100.'}
  const db=await createClient()
  const {data,error}=await db.from('planilla_distribuciones').upsert(v.data,{onConflict:'persona_id,orden_id'}).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Porcentaje de la OT guardado.'}
}

export async function cerrarPlanilla(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const id=uuid.safeParse(datos.get('planilla_id'))
  if(!id.success) return {ok:false,error:'Planilla no válida.'}
  const db=await createClient()
  const {data,error}=await db.rpc('cerrar_planilla',{p_planilla:id.data})
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(data!==id.data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Planilla cerrada con 100 % distribuido por persona.'}
}

/**
 * Repartir en partes iguales el costo de varias personas entre varias OT de
 * una vez. Reemplaza el reparto que tuvieran esas personas.
 */
export async function repartirEnPartesIguales(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const planilla=uuid.safeParse(datos.get('planilla_id'))
  const personas=z.array(uuid).min(1).max(300).safeParse(datos.getAll('persona_id'))
  const ordenes=z.array(uuid).min(1).max(50).safeParse(datos.getAll('orden_id'))
  if(!planilla.success) return {ok:false,error:'Planilla no válida.'}
  if(!personas.success) return {ok:false,error:'Marca al menos una persona.'}
  if(!ordenes.success) return {ok:false,error:'Marca entre una y cincuenta OT.'}
  const db=await createClient()
  const {data,error}=await db.rpc('repartir_planilla_en_partes_iguales',{p_planilla:planilla.data,p_personas:personas.data,p_ordenes:ordenes.data})
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  volver()
  const parte=Math.floor(10000/ordenes.data.length)/100
  return {ok:true,mensaje:`${data} ${data===1?'persona repartida':'personas repartidas'}: ${ordenes.data.length===1?'100 %':`${parte} % en cada una de las ${ordenes.data.length} OT`}.`}
}
