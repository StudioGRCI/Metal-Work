import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { pesoDeSemaforo, semaforoValido, type Semaforo } from '@/lib/dominio/tiempos-entrega'
import { createClient } from '@/lib/supabase/server'

/**
 * Los tiempos de entrega por código interno (migración 20261125100000). Todo
 * se lee por funciones que exigen `rrhh.tiempos_entrega`: Recursos Humanos no
 * lee las tablas de Diseño. El semáforo y los días hábiles ya vienen
 * calculados de la base.
 */

const n = (v: number | string | null | undefined) => Number(v ?? 0)

/** Un código sin entregar, como sale en el tablero. */
export type CodigoConTiempos = {
  codigo: string
  ot_numero: string | null
  ot_estado: string | null
  /** Cuántas OT abiertas tiene el código; la que se nombra es la que se entrega antes. */
  ots_abiertas: number
  cliente: string | null
  unidad: string | null
  fecha_entrega: string | null
  /** Días de taller hasta la entrega al cliente; negativo si ya pasó. */
  dias_habiles_entrega: number | null
  /** El color de la fecha de entrega sola, sin mirar las etapas. */
  semaforo_entrega: Semaforo
  etapas: number
  etapas_terminadas: number
  /** Etapas de arriba vencidas: cuenta una vez la etapa con su subetapa vencida. */
  etapas_vencidas: number
  etapas_por_vencer: number
  etapas_sin_fecha: number
  etapa_en_curso: string | null
  area_en_curso: string | null
  /** La fecha comprometida más próxima entre sus etapas sin terminar. */
  proxima_fecha: string | null
  semaforo: Semaforo
}

/** El renglón de un solo código, o nada si ya no está por entregar. */
export async function codigoConTiempos(codigo: string): Promise<CodigoConTiempos | null> {
  return (await leerCodigos(normalizarCodigo(codigo)))[0] ?? null
}

/** El tablero: lo vencido primero y, dentro de cada color, lo que vence antes. */
export async function codigosConTiempos(): Promise<CodigoConTiempos[]> {
  const filas = await leerCodigos(null)
  // La fecha que manda en la fila: la más próxima entre sus etapas y su entrega.
  const antes = (c: CodigoConTiempos) => [c.proxima_fecha, c.fecha_entrega].filter(Boolean).sort()[0] ?? '9999-12-31'
  return filas.sort(
    (a, b) => pesoDeSemaforo(a.semaforo) - pesoDeSemaforo(b.semaforo) || antes(a).localeCompare(antes(b)) || a.codigo.localeCompare(b.codigo),
  )
}

async function leerCodigos(codigo: string | null): Promise<CodigoConTiempos[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('tiempos_de_entrega_codigos', codigo ? { p_codigo: codigo } : {}),
    ['codigo'],
  )
  if (error) throw new Error(`No se pudieron leer los tiempos de entrega: ${error.message}`)
  return (data ?? []).flatMap((c): CodigoConTiempos[] =>
    c.codigo
      ? [
          {
            codigo: c.codigo,
            ot_numero: c.ot_numero,
            ot_estado: c.ot_estado,
            ots_abiertas: n(c.ots_abiertas),
            cliente: c.cliente,
            unidad: c.unidad,
            fecha_entrega: c.fecha_entrega,
            dias_habiles_entrega: c.dias_habiles_entrega,
            semaforo_entrega: semaforoValido(c.semaforo_entrega),
            etapas: n(c.etapas),
            etapas_terminadas: n(c.etapas_terminadas),
            etapas_vencidas: n(c.etapas_vencidas),
            etapas_por_vencer: n(c.etapas_por_vencer),
            etapas_sin_fecha: n(c.etapas_sin_fecha),
            etapa_en_curso: c.etapa_en_curso,
            area_en_curso: c.area_en_curso,
            proxima_fecha: c.proxima_fecha,
            semaforo: semaforoValido(c.semaforo),
          },
        ]
      : [],
  )
}

/** Una etapa del código con su semáforo. */
export type EtapaConTiempos = {
  id: string
  codigo: string
  orden: number
  nombre: string
  padre_id: string | null
  area: string | null
  inicio_plan: string | null
  fin_plan: string | null
  inicio_real: string | null
  fin_real: string | null
  nota: string | null
  ultimo_reporte: string | null
  avance_reportado: number | null
  semaforo: Semaforo
  /** Días de taller hasta la fecha comprometida; negativo si venció; vacío si terminó o no tiene fecha. */
  dias_habiles: number | null
}

/** Las etapas de un código, o las de todos con `null`. */
export async function etapasConTiempos(codigo: string | null): Promise<EtapaConTiempos[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('tiempos_de_entrega_etapas', codigo ? { p_codigo: normalizarCodigo(codigo) } : {}),
    ['codigo', 'orden', 'id'],
  )
  if (error) throw new Error(`No se pudieron leer las etapas: ${error.message}`)
  return (data ?? []).flatMap((e): EtapaConTiempos[] =>
    e.id && e.codigo
      ? [
          {
            id: e.id,
            codigo: e.codigo,
            orden: n(e.orden),
            nombre: e.nombre ?? '',
            padre_id: e.padre_id,
            area: e.area,
            inicio_plan: e.inicio_plan,
            fin_plan: e.fin_plan,
            inicio_real: e.inicio_real,
            fin_real: e.fin_real,
            nota: e.nota,
            ultimo_reporte: e.ultimo_reporte,
            avance_reportado: e.avance_reportado === null ? null : Number(e.avance_reportado),
            semaforo: semaforoValido(e.semaforo),
            dias_habiles: e.dias_habiles,
          },
        ]
      : [],
  )
}

/** Una actividad que un área reportó para el código, con su último avance. */
export type ActividadConAvance = {
  clave: string
  area: string | null
  descripcion: string
  avance: number
  ultima_fecha: string | null
  reportes: number
}

export async function actividadesConAvance(codigo: string): Promise<ActividadConAvance[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('tiempos_de_entrega_actividades', { p_codigo: normalizarCodigo(codigo) }),
    ['clave'],
  )
  if (error) throw new Error(`No se pudieron leer las actividades: ${error.message}`)
  return (data ?? [])
    .flatMap((a): ActividadConAvance[] =>
      a.clave
        ? [{ clave: a.clave, area: a.area, descripcion: a.descripcion ?? '', avance: n(a.avance), ultima_fecha: a.ultima_fecha, reportes: n(a.reportes) }]
        : [],
    )
    // Primero lo que falta; dentro, por área y por nombre.
    .sort(
      (a, b) =>
        Number(a.avance >= 100) - Number(b.avance >= 100) ||
        (a.area ?? '').localeCompare(b.area ?? '') ||
        a.descripcion.localeCompare(b.descripcion) ||
        a.clave.localeCompare(b.clave),
    )
}

/** Quién lleva una etapa (migración 20261125310000). */
export type ResponsableDeEtapa = { etapa_id: string; trabajador_id: string; nombre: string; area: string | null }

/**
 * Quién lleva cada etapa vigente, de un código o de todos, por etapa. La leen
 * RR. HH., Gerencia, Diseño y los supervisores: quien ya ve las etapas.
 */
export async function responsablesDeEtapas(codigo: string | null): Promise<Map<string, ResponsableDeEtapa>> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('responsables_de_etapas', codigo ? { p_codigo: normalizarCodigo(codigo) } : {}),
    ['codigo', 'etapa_id'],
  )
  if (error) throw new Error(`No se pudo leer quién lleva cada etapa: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((r): [string, ResponsableDeEtapa][] =>
      r.etapa_id && r.trabajador_id ? [[r.etapa_id, { etapa_id: r.etapa_id, trabajador_id: r.trabajador_id, nombre: r.nombre ?? '', area: r.area }]] : [],
    ),
  )
}

/** Una etapa sin terminar que lleva una persona, con su semáforo. */
export type EtapaDePersona = {
  etapa_id: string
  codigo: string
  etapa: string
  area_etapa: string | null
  fin_plan: string | null
  inicio_real: string | null
  semaforo: Semaforo
  dias_habiles: number | null
}

/** Lo que lleva cada persona, lo vencido primero. */
export type PersonaConEtapas = {
  trabajador_id: string
  nombre: string
  area: string | null
  etapas: EtapaDePersona[]
  semaforo: Semaforo
}

export async function etapasPorPersona(): Promise<PersonaConEtapas[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('tiempos_de_entrega_por_persona'), ['trabajador_id', 'etapa_id'])
  if (error) throw new Error(`No se pudo leer lo que lleva cada persona: ${error.message}`)
  const porPersona = new Map<string, PersonaConEtapas>()
  for (const f of data ?? []) {
    if (!f.trabajador_id || !f.etapa_id || !f.codigo) continue
    const persona =
      porPersona.get(f.trabajador_id) ??
      porPersona.set(f.trabajador_id, { trabajador_id: f.trabajador_id, nombre: f.nombre ?? '', area: f.area, etapas: [], semaforo: 'SIN_FECHA' }).get(f.trabajador_id)!
    persona.etapas.push({
      etapa_id: f.etapa_id,
      codigo: f.codigo,
      etapa: f.etapa ?? '',
      area_etapa: f.area_etapa,
      fin_plan: f.fin_plan,
      inicio_real: f.inicio_real,
      semaforo: semaforoValido(f.semaforo),
      dias_habiles: f.dias_habiles,
    })
  }
  const personas = [...porPersona.values()]
  for (const p of personas) {
    p.etapas.sort((a, b) => pesoDeSemaforo(a.semaforo) - pesoDeSemaforo(b.semaforo) || (a.fin_plan ?? '9999').localeCompare(b.fin_plan ?? '9999'))
    p.semaforo = p.etapas[0]?.semaforo ?? 'SIN_FECHA'
  }
  return personas.sort((a, b) => pesoDeSemaforo(a.semaforo) - pesoDeSemaforo(b.semaforo) || a.nombre.localeCompare(b.nombre))
}

/** El personal activo, para elegir quién lleva una etapa. Sin DNI ni pagos. */
export async function personasParaAsignar(): Promise<{ id: string; nombre: string; detalle: string | null }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trabajadores')
    .select('id, nombres, apellidos, cargo, area:areas(nombre)')
    .eq('activo', true)
    .order('apellidos')
    .order('nombres')
  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`)
  return (data ?? []).map((t) => {
    const area = Array.isArray(t.area) ? t.area[0] : t.area
    return { id: t.id, nombre: `${t.apellidos}, ${t.nombres}`, detalle: [area?.nombre, t.cargo].filter(Boolean).join(' · ') || null }
  })
}
