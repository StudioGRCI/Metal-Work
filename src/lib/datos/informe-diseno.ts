import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { finSemanaDiseno } from '@/lib/dominio/semana-diseno'

/**
 * El informe semanal de una semana con sus dos tablas: la planificación de
 * modelado (`diseno_tareas`) y el avance de planos (`diseno_entregas_planos`).
 *
 * Mientras el informe está abierto se lee lo vivo; enviado, la copia sellada
 * (`contenido_enviado`), que es lo que revisó Diseño y recibe Administración.
 * El código interno y si es CM o SR vienen de `identificacion_ot_diseno`: el
 * colaborador no lee `unidades` (migración 20261001201500).
 */
const Tarea = z.object({
  id: z.string(), orden_id: z.string(), integrante_id: z.string(), tipo: z.string(), componente: z.string(),
  fecha_inicio: z.string(), fecha_entrega: z.string(), observacion: z.string().nullable(), ot: z.string(),
  codigo_interno: z.string().nullable().optional(), tipo_unidad: z.string().nullable().optional(), responsable: z.string(),
})
const Entrega = z.object({
  id: z.string(), orden_id: z.string(), integrante_id: z.string(), tipo_plano: z.string(), n_planos: z.number(),
  n_piezas: z.number(), fecha_entrega: z.string().nullable(), estado: z.string(), entregado_a: z.array(z.string()),
  ot: z.string(), codigo_interno: z.string().nullable().optional(), tipo_unidad: z.string().nullable().optional(),
  responsable: z.string(),
})
// Las copias anteriores al formato no traen entregas: salen vacías, no rompen.
const ContenidoEnviado = z.object({ tareas: z.array(Tarea), entregas: z.array(Entrega).optional().default([]) })

export type TareaInforme = z.infer<typeof Tarea> & { creado_por?: string }
export type EntregaInforme = z.infer<typeof Entrega> & { creado_por?: string }

export async function datosInformeDiseno(inicio: string) {
  const db = await createClient()
  const fin = finSemanaDiseno(inicio)
  const [informe, tareas, entregas] = await Promise.all([
    db.from('diseno_informes')
      .select('id,numero,semana_inicio,responsable,resumen,incidencias,acciones,no_conformidades,indicadores,plan_siguiente,conclusiones,estado,observacion_revision,enviado_en,revisado_en,recibido_en,contenido_enviado')
      .eq('semana_inicio', inicio).maybeSingle(),
    db.from('diseno_tareas')
      .select('id,orden_id,integrante_id,tipo,componente,fecha_inicio,fecha_entrega,observacion,creado_por')
      .lte('fecha_inicio', fin).gte('fecha_entrega', inicio)
      .order('fecha_inicio').order('creado_en').limit(300),
    db.from('diseno_entregas_planos')
      .select('id,orden_id,integrante_id,tipo_plano,n_planos,n_piezas,fecha_entrega,estado,entregado_a,creado_por')
      .eq('semana_inicio', inicio)
      .order('fecha_entrega', { nullsFirst: false }).order('creado_en').limit(300),
  ])
  if (informe.error || tareas.error || entregas.error) throw new Error('No se pudo cargar el informe semanal de Diseño.')

  if (informe.data?.contenido_enviado && informe.data.estado !== 'BORRADOR' && informe.data.estado !== 'OBSERVADO') {
    const copia = ContenidoEnviado.safeParse(informe.data.contenido_enviado)
    if (!copia.success) throw new Error('El contenido enviado no se pudo leer. Solicita revisión a Administración.')
    return { informe: informe.data, inicio, fin, enviado: true, tareas: copia.data.tareas as TareaInforme[], entregas: copia.data.entregas as EntregaInforme[] }
  }

  const idsOrden = [...new Set([...(tareas.data ?? []).map((t) => t.orden_id), ...(entregas.data ?? []).map((e) => e.orden_id)])]
  const idsPersona = [...new Set([...(tareas.data ?? []).map((t) => t.integrante_id), ...(entregas.data ?? []).map((e) => e.integrante_id)])]
  const [ordenes, personas] = await Promise.all([
    idsOrden.length ? db.rpc('identificacion_ot_diseno', { p_ordenes: idsOrden }) : Promise.resolve({ data: [], error: null }),
    idsPersona.length ? db.from('ot_equipo_diseno').select('id,nombre').in('id', idsPersona) : Promise.resolve({ data: [], error: null }),
  ])
  if (ordenes.error || personas.error) throw new Error('No se pudieron cargar las OT o las personas del informe.')
  const ordenPorId = new Map((ordenes.data ?? []).map((o) => [o.orden_id, o]))
  const personaPorId = new Map((personas.data ?? []).map((p) => [p.id, p.nombre]))
  const deLaOt = (id: string) => {
    const o = ordenPorId.get(id)
    return { ot: o?.numero ?? 'OT no disponible', codigo_interno: o?.codigo_interno ?? null, tipo_unidad: o?.tipo_unidad ?? null }
  }

  return {
    informe: informe.data,
    inicio, fin,
    enviado: false,
    tareas: (tareas.data ?? []).map((t): TareaInforme => ({
      ...t, ...deLaOt(t.orden_id), responsable: personaPorId.get(t.integrante_id) ?? 'Sin nombre',
    })),
    entregas: (entregas.data ?? []).map((e): EntregaInforme => ({
      ...e, ...deLaOt(e.orden_id), responsable: personaPorId.get(e.integrante_id) ?? 'Sin nombre',
    })),
  }
}

export type DatosInformeDiseno = Awaited<ReturnType<typeof datosInformeDiseno>>
