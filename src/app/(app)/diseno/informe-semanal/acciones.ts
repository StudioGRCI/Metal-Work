'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { CLAVES_AREA, CLAVES_TAREA } from '@/lib/dominio/informe-diseno'
import { finSemanaDiseno, inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

async function exigirDiseno() {
  const perfil = await exigirSesion()
  return puede(perfil, 'diseno.preparar_informe') ? perfil : null
}

export async function registrarTareaDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirDiseno()
  if (!perfil) return { ok: false, error: 'Solo Diseño registra sus tareas.' }
  const entrada = z.object({
    id: z.string().uuid(),
    orden_id: z.string().uuid(),
    integrante_id: z.string().uuid(),
    tipo: z.enum(CLAVES_TAREA),
    componente: z.string().trim().min(2).max(200),
    fecha_inicio: z.iso.date(),
    fecha_entrega: z.iso.date(),
    observacion: z.string().trim().max(1500),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success || entrada.data.fecha_entrega < entrada.data.fecha_inicio) {
    return { ok: false, error: 'Indica OT, colaborador, tarea y fechas válidas.' }
  }
  const db = await createClient()
  const { data, error } = await db.from('diseno_tareas')
    .insert({ ...entrada.data, creado_por: perfil.id }).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/diseno/informe-semanal')
  return { ok: true, mensaje: 'Tarea de Diseño registrada para el informe semanal.' }
}

/**
 * Una fila del avance de planos, como en el formato: el entregable, cuántos
 * planos y piezas tiene, a qué áreas se entregó. La base comprueba que la
 * persona sea colaboradora de esa OT y que la semana no se haya enviado.
 */
export async function registrarEntregaPlanos(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirDiseno()
  if (!perfil) return { ok: false, error: 'Solo el colaborador de Diseño registra el avance de planos.' }
  const entrada = z.object({
    id: z.string().uuid(),
    semana_inicio: z.iso.date(),
    orden_id: z.string().uuid(),
    integrante_id: z.string().uuid(),
    tipo_plano: z.string().trim().min(2).max(200),
    n_planos: z.coerce.number().int().min(1).max(999),
    n_piezas: z.coerce.number().int().min(0).max(9999),
    fecha_entrega: z.union([z.iso.date(), z.literal('')]),
    estado: z.enum(['CULMINADO', 'EN_PROCESO']),
  }).safeParse(Object.fromEntries(datos))
  const areas = z.array(z.enum(CLAVES_AREA)).safeParse(datos.getAll('entregado_a'))
  if (!entrada.success || !areas.success) {
    return { ok: false, error: 'Indica la OT, la persona, el tipo de plano y cuántos planos y piezas son.' }
  }
  const v = entrada.data
  if (inicioSemanaDiseno(v.semana_inicio) !== v.semana_inicio) return { ok: false, error: 'La semana debe empezar un lunes.' }
  if (v.fecha_entrega && (v.fecha_entrega < v.semana_inicio || v.fecha_entrega > finSemanaDiseno(v.semana_inicio))) {
    return { ok: false, error: 'La fecha de entrega tiene que caer dentro de la semana del informe.' }
  }
  if (v.estado === 'CULMINADO' && areas.data.length === 0) {
    return { ok: false, error: 'Marca a qué área se entregaron los planos.' }
  }
  const db = await createClient()
  const { data, error } = await db.from('diseno_entregas_planos').insert({
    ...v, fecha_entrega: v.fecha_entrega || null, entregado_a: [...new Set(areas.data)], creado_por: perfil.id,
  }).select('id').maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/diseno/informe-semanal')
  return { ok: true, mensaje: `Entrega registrada: ${v.n_planos} ${v.n_planos === 1 ? 'plano' : 'planos'}.` }
}

/** Quitar una tarea o una entrega mal cargada. Solo las propias y con la semana abierta. */
export async function quitarRegistroInforme(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirDiseno()
  if (!perfil) return { ok: false, error: 'Solo el colaborador de Diseño corrige lo que registró.' }
  const entrada = z.object({ id: z.string().uuid(), tabla: z.enum(['tarea', 'entrega']) }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'No se entendió qué quitar. Vuelve a cargar la pantalla.' }
  const db = await createClient()
  const consulta = entrada.data.tabla === 'tarea'
    ? db.from('diseno_tareas').delete().eq('id', entrada.data.id).select('id').maybeSingle()
    : db.from('diseno_entregas_planos').delete().eq('id', entrada.data.id).select('id').maybeSingle()
  const { data, error } = await consulta
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se quitó: solo puedes quitar lo que registraste tú.' }
  revalidatePath('/diseno/informe-semanal')
  return { ok: true, mensaje: entrada.data.tabla === 'tarea' ? 'Tarea quitada.' : 'Entrega quitada.' }
}

export async function guardarInformeDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const sesion=await exigirSesion()
  const perfil=puede(sesion,'diseno.preparar_informe')?sesion:null
  if (!perfil) return { ok: false, error: 'Solo Diseño prepara el informe semanal.' }
  const entrada = z.object({
    semana_inicio: z.iso.date(),
    responsable: z.string().trim().min(2).max(120),
    resumen: z.string().trim().max(4000),
    incidencias: z.string().trim().max(4000),
    acciones: z.string().trim().max(4000),
    no_conformidades: z.string().trim().max(4000),
    indicadores: z.string().trim().max(4000),
    plan_siguiente: z.string().trim().max(4000),
    conclusiones: z.string().trim().max(4000),
  }).safeParse(Object.fromEntries(datos))
  if (!entrada.success) return { ok: false, error: 'Revisa la semana, responsable y extensión del informe.' }
  const v = entrada.data
  if (inicioSemanaDiseno(v.semana_inicio) !== v.semana_inicio) {
    return { ok: false, error: 'La semana debe empezar un lunes.' }
  }
  const db = await createClient()
  const { data: actual, error: lectura } = await db.from('diseno_informes')
    .select('id').eq('semana_inicio', v.semana_inicio).maybeSingle()
  if (lectura) return { ok: false, error: mensajeDeError(lectura) }
  const resultado = actual
    ? await db.from('diseno_informes').update({ ...v, actualizado_por: perfil.id })
        .eq('id', actual.id).select('id,numero').maybeSingle()
    : await db.from('diseno_informes').insert({ ...v, creado_por: perfil.id, actualizado_por: perfil.id })
        .select('id,numero').maybeSingle()
  if (resultado.error) return { ok: false, error: mensajeDeError(resultado.error) }
  if (!resultado.data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/diseno/informe-semanal')
  return { ok: true, mensaje: `Informe semanal N.º ${resultado.data.numero} guardado.` }
}

export async function transitarInforme(_previo:unknown,datos:FormData):Promise<ResultadoAccion> {
 const perfil=await exigirSesion()
 const v=z.object({informe_id:z.string().uuid(),estado:z.enum(['EN_REVISION','APROBADO','OBSERVADO']),observacion:z.string().trim().max(2000)}).safeParse(Object.fromEntries(datos))
 if(!v.success)return {ok:false,error:'Revisa la decisión y la observación.'}
 const permiso=v.data.estado==='EN_REVISION'?'diseno.preparar_informe':'diseno.revisar_informe'
 if(!puede(perfil,permiso))return {ok:false,error:'Tu usuario no puede realizar esta decisión.'}
 const db=await createClient();const {data,error}=await db.rpc('transitar_informe_diseno',{p_informe:v.data.informe_id,p_estado:v.data.estado,p_observacion:v.data.observacion||null})
 if(error)return {ok:false,error:mensajeDeError(error)}
 if(data!==v.data.informe_id)return {ok:false,error:NO_TOCO_NADA}
 revalidatePath('/diseno/informe-semanal')
 return {ok:true,mensaje:v.data.estado==='EN_REVISION'?'Informe enviado a Diseño.':v.data.estado==='APROBADO'?'Informe aprobado. El colaborador recibe el aviso.':'Observaciones enviadas al colaborador.'}
}
