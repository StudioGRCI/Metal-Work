import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { finSemanaDiseno } from '@/lib/dominio/semana-diseno'
import {z} from 'zod'

const contenidoEnviado=z.object({
 tareas:z.array(z.object({id:z.string(),orden_id:z.string(),integrante_id:z.string(),tipo:z.string(),componente:z.string(),fecha_inicio:z.string(),fecha_entrega:z.string(),observacion:z.string().nullable(),ot:z.string(),responsable:z.string()})),
 planos:z.array(z.object({id:z.string(),ot:z.string(),numero:z.union([z.string(),z.number()]),nombre:z.string(),area:z.string(),responsable:z.string(),entregado_en:z.string(),estado:z.string()})),
})

export async function datosInformeDiseno(inicio: string) {
  const db = await createClient()
  const fin = finSemanaDiseno(inicio)
  const [informe, tareas, versiones] = await Promise.all([
    db.from('diseno_informes')
      .select('id,numero,semana_inicio,responsable,resumen,incidencias,acciones,no_conformidades,indicadores,plan_siguiente,conclusiones,estado,observacion_revision,enviado_en,revisado_en,recibido_en,contenido_enviado')
      .eq('semana_inicio', inicio).maybeSingle(),
    db.from('diseno_tareas')
      .select('id,orden_id,integrante_id,tipo,componente,fecha_inicio,fecha_entrega,observacion')
      .lte('fecha_inicio', fin).gte('fecha_entrega', inicio)
      .order('fecha_inicio').limit(300),
    db.from('ot_plano_versiones')
      .select('id,plano_id,area_id,revision_diseno_en,estado')
      .eq('revision_diseno', 'APROBADO')
      .gte('revision_diseno_en', `${inicio}T00:00:00-05:00`)
      .lt('revision_diseno_en', `${fin}T23:59:59.999-05:00`)
      .order('revision_diseno_en').limit(300),
  ])
  if (informe.error || tareas.error || versiones.error) throw new Error('No se pudo cargar el informe semanal de Diseño.')
  if(informe.data?.contenido_enviado && informe.data.estado!=='BORRADOR' && informe.data.estado!=='OBSERVADO') {
    const copia=contenidoEnviado.safeParse(informe.data.contenido_enviado)
    if(!copia.success)throw new Error('El contenido enviado no se pudo leer. Solicita revisión a Administración.')
    return {informe:informe.data,inicio,fin,tareas:copia.data.tareas,planos:copia.data.planos}
  }
  const idsPlano = [...new Set((versiones.data ?? []).map(v => v.plano_id))]
  const planos = idsPlano.length
    ? await db.from('ot_planos').select('id,orden_id,numero_plano,nombre,integrante_diseno_id').in('id', idsPlano)
    : { data: [], error: null }
  if (planos.error) throw new Error('No se pudieron cargar los planos del informe.')
  const idsOrden = [...new Set([...(tareas.data ?? []).map(t => t.orden_id), ...(planos.data ?? []).map(p => p.orden_id)])]
  const idsPersona = [...new Set([...(tareas.data ?? []).map(t => t.integrante_id), ...(planos.data ?? []).map(p => p.integrante_diseno_id).filter((id): id is string => Boolean(id))])]
  const idsArea = [...new Set((versiones.data ?? []).map(v => v.area_id))]
  const [ordenes, personas, areas] = await Promise.all([
    idsOrden.length ? db.from('ordenes_trabajo').select('id,numero,tipo_carroceria_id').in('id', idsOrden) : Promise.resolve({ data: [], error: null }),
    idsPersona.length ? db.from('ot_equipo_diseno').select('id,nombre').in('id', idsPersona) : Promise.resolve({ data: [], error: null }),
    idsArea.length ? db.from('areas').select('id,nombre').in('id', idsArea) : Promise.resolve({ data: [], error: null }),
  ])
  if (ordenes.error || personas.error || areas.error) throw new Error('No se pudieron cargar las OT o las personas del informe.')
  const ordenPorId = new Map((ordenes.data ?? []).map(o => [o.id, o]))
  const personaPorId = new Map((personas.data ?? []).map(p => [p.id, p]))
  const planoPorId = new Map((planos.data ?? []).map(p => [p.id, p]))
  const areaPorId = new Map((areas.data ?? []).map(a => [a.id, a]))
  return {
    informe: informe.data,
    inicio, fin,
    tareas: (tareas.data ?? []).map(t => ({
      ...t, ot: ordenPorId.get(t.orden_id)?.numero ?? 'OT no disponible',
      responsable: personaPorId.get(t.integrante_id)?.nombre ?? 'Sin nombre',
    })),
    planos: (versiones.data ?? []).map(v => {
      const plano = planoPorId.get(v.plano_id)
      return {
        id: v.id, ot: ordenPorId.get(plano?.orden_id ?? '')?.numero ?? 'OT no disponible',
        numero: plano?.numero_plano ?? '—', nombre: plano?.nombre ?? 'Plano',
        area: areaPorId.get(v.area_id)?.nombre ?? 'Área',
        responsable: personaPorId.get(plano?.integrante_diseno_id ?? '')?.nombre ?? 'Sin asignar',
        entregado_en: v.revision_diseno_en ?? '', estado: v.estado,
      }
    }),
  }
}
