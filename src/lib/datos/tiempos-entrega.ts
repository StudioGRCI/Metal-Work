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

export async function etapasConTiempos(codigo: string): Promise<EtapaConTiempos[]> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(
    () => supabase.rpc('tiempos_de_entrega_etapas', { p_codigo: normalizarCodigo(codigo) }),
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
