'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

async function exigirDiseno() {
  const perfil = await exigirSesion()
  return puede(perfil, ['diseno.planos', 'diseno.subir_pdf']) ? perfil : null
}

export async function registrarTareaDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirDiseno()
  if (!perfil) return { ok: false, error: 'Solo Diseño registra sus tareas.' }
  const entrada = z.object({
    id: z.string().uuid(),
    orden_id: z.string().uuid(),
    integrante_id: z.string().uuid(),
    tipo: z.enum(['MODELADO','PLOTEO','CREACION_PLANO','REVISION','SOPORTE','OTRA']),
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

export async function guardarInformeDiseno(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirDiseno()
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
