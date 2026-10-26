'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { editaComoRrhh, exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

// Las planillas del mes las arma Recursos Humanos; el administrador las ve (migración 20261020167000).
const SOLO_RRHH='No tienes permiso para cambiar las planillas: el administrador las ve, pero no las cambia.'
const uuid=z.guid()
const volver=()=>revalidatePath('/rrhh')

export async function crearPlanilla(_previo:unknown, datos:FormData):Promise<ResultadoAccion> {
  if(!editaComoRrhh(await exigirPermiso('rrhh.gestionar_planillas'),'rrhh.gestionar_planillas')) return {ok:false,error:SOLO_RRHH}
  const v=z.object({tipo:z.enum(['TALLER','ADMINISTRATIVA','SUBCONTRATOS']),periodo:z.iso.date(),moneda:z.enum(['PEN','USD']),observacion:z.string().trim().max(1000)}).safeParse(Object.fromEntries(datos))
  if(!v.success || !v.data.periodo.endsWith('-01')) return {ok:false,error:'Elige tipo, mes y moneda. El período debe empezar el día 1.'}
  const db=await createClient()
  const {data,error}=await db.from('planillas').insert(v.data).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Planilla en borrador creada.'}
}

export async function agregarPersona(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  if(!editaComoRrhh(await exigirPermiso('rrhh.gestionar_planillas'),'rrhh.gestionar_planillas')) return {ok:false,error:SOLO_RRHH}
  const v=z.object({planilla_id:uuid,nombre:z.string().trim().min(3).max(160),documento:z.string().trim().max(20),monto:z.coerce.number().min(0).multipleOf(0.01)}).safeParse(Object.fromEntries(datos))
  if(!v.success) return {ok:false,error:'Indica planilla, nombre y monto válidos.'}
  const db=await createClient()
  const {data,error}=await db.from('planilla_personas').insert({...v.data,documento:v.data.documento||null}).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Persona o subcontrato agregado.'}
}

export async function cerrarPlanilla(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  if(!editaComoRrhh(await exigirPermiso('rrhh.gestionar_planillas'),'rrhh.gestionar_planillas')) return {ok:false,error:SOLO_RRHH}
  const id=uuid.safeParse(datos.get('planilla_id'))
  if(!id.success) return {ok:false,error:'Planilla no válida.'}
  const db=await createClient()
  const {data,error}=await db.rpc('cerrar_planilla',{p_planilla:id.data})
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(data!==id.data) return {ok:false,error:NO_TOCO_NADA}
  volver(); revalidatePath('/codigos-internos/detalle')
  // Qué pasa con su costo (el ajuste, o que queda como registro) lo dice la ventana antes de confirmar.
  return {ok:true,mensaje:'Planilla cerrada.'}
}

/**
 * Quitar a una persona de la planilla en borrador: corrige una carga
 * equivocada. La baja de quien dejó de trabajar va por
 * Personal.
 */
export async function quitarPersona(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
  if(!editaComoRrhh(await exigirPermiso('rrhh.gestionar_planillas'),'rrhh.gestionar_planillas')) return {ok:false,error:SOLO_RRHH}
  const id=uuid.safeParse(datos.get('persona_id'))
  if(!id.success) return {ok:false,error:'Persona no válida.'}
  const db=await createClient()
  const {data,error}=await db.rpc('quitar_persona_de_planilla',{p_persona:id.data})
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(data!==id.data) return {ok:false,error:NO_TOCO_NADA}
  volver(); return {ok:true,mensaje:'Persona quitada de la planilla.'}
}
