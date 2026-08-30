import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * El control de plazos por área.
 *
 * Es la traducción del `CONTROL DE PLAZOS - MWP - 2026.xlsx` de la empresa:
 * siete hojas, una por área, con las unidades en producción, sus fechas y una
 * observación donde el área escribe qué la trabó. Acá es una sola consulta y el
 * área es un filtro, porque la pregunta que se hace Gerencia —«¿qué está
 * vencido?»— cruza las siete hojas y en el Excel obliga a abrirlas una por una.
 *
 * La responsabilidad es del **área**, no de una persona: un área es siempre un
 * equipo. Por eso se agrupa por área y no por responsable.
 */
/** Los cinco del semáforo. Se valida acá para que un `?plazo=` inventado en la
 *  dirección no llegue a la consulta como texto suelto. */
const SEMAFOROS = ['VIGENTE', 'POR_VENCER', 'VENCIDO', 'CUMPLIDO', 'CUMPLIDO_TARDE'] as const
export type Semaforo = (typeof SEMAFOROS)[number]

function semaforoValido(valor?: string): Semaforo | undefined {
  return SEMAFOROS.includes(valor as Semaforo) ? (valor as Semaforo) : undefined
}

export async function plazosPorArea(filtros: { area?: string; plazo?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('v_plazos_por_area')
    .select('*')
    // Lo más urgente arriba: lo que menos días le quedan. Los nulos —etapas sin
    // fecha comprometida— al final, que no hay nada que reclamarles.
    .order('dias', { ascending: true, nullsFirst: false })
    .order('orden_numero')

  if (filtros.area) consulta = consulta.eq('area_codigo', filtros.area)

  const plazo = semaforoValido(filtros.plazo)
  if (plazo) consulta = consulta.eq('plazo', plazo)

  const { data, error } = await consulta

  if (error) throw new Error(`No se pudo cargar el control de plazos: ${error.message}`)
  return data ?? []
}

export type FilaPlazo = Awaited<ReturnType<typeof plazosPorArea>>[number]

/**
 * Cuántas etapas tiene cada área y en qué semáforo.
 *
 * Va aparte de la lista porque las pastillas de filtro tienen que contar sobre
 * el total, no sobre lo que quedó filtrado: si contaran lo filtrado, encender
 * «Vencido» dejaría todas las demás áreas en cero y parecería que no hay nada.
 */
export async function resumenDePlazos() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_plazos_por_area')
    .select('area_codigo, area_nombre, plazo')

  if (error) throw new Error(`No se pudo contar el control de plazos: ${error.message}`)

  const porArea = new Map<string, { codigo: string; nombre: string; total: number; vencidas: number }>()
  const porPlazo: Record<string, number> = {}

  for (const fila of data ?? []) {
    const codigo = fila.area_codigo ?? 'SIN'
    const area = porArea.get(codigo) ?? {
      codigo,
      nombre: fila.area_nombre ?? 'Sin área asignada',
      total: 0,
      vencidas: 0,
    }
    area.total += 1
    if (fila.plazo === 'VENCIDO') area.vencidas += 1
    porArea.set(codigo, area)

    if (fila.plazo) porPlazo[fila.plazo] = (porPlazo[fila.plazo] ?? 0) + 1
  }

  return {
    areas: [...porArea.values()].sort((a, b) => b.vencidas - a.vencidas || b.total - a.total),
    porPlazo,
    total: data?.length ?? 0,
  }
}

/** Todo lo que se reportó de una etapa, lo más nuevo arriba. */
export async function reportesDeEtapa(etapaId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_etapa_reportes')
    .select(
      'id, texto, creado_en, verificado_en, autor:usuarios!ot_etapa_reportes_creado_por_fkey(nombres, apellidos), verificador:usuarios!ot_etapa_reportes_verificado_por_fkey(nombres, apellidos)',
    )
    .eq('etapa_id', etapaId)
    .order('creado_en', { ascending: false })

  if (error) throw new Error(`No se pudieron cargar los reportes: ${error.message}`)
  return data ?? []
}
