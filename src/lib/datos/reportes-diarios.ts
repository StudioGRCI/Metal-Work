import 'server-only'

import { BUCKET_FOTOS_REPORTE, type LadoValidacion } from '@/lib/dominio/reporte-diario'
import { createClient } from '@/lib/supabase/server'

/**
 * Un trabajo realizado, con su avance y la actividad que avanza: la de un plano,
 * la de un subcontrato o una propia. Los de antes del 2026-10-20 van sin ella.
 */
export type TrabajoReporte = {
  id: string
  orden: number
  descripcion: string
  avance: number
  actividad_id: string | null
  plano_id: string | null
  subcontrato_id: string | null
}

type FilaTrabajo = Omit<TrabajoReporte, 'plano_id' | 'subcontrato_id'> & {
  actividad: Uno<{ plano_id: string | null; subcontrato_id: string | null }>
}

/**
 * Una persona del reporte con sus horas. `costeo` solo lo sabe RR. HH., que ve
 * el tareo: para el supervisor y Gerencia llega `null`.
 */
export type PersonaReporte = {
  id: string
  trabajo_id: string | null
  trabajador_id: string
  nombre: string
  cargo: string | null
  horas: number
  costeo: 'EN_COSTEO' | 'ESPERA_COSTO' | 'ANULADO' | null
}

/** Un reporte en la lista: lo justo para reconocerlo y contar su gente y sus horas. */
export type ReporteListado = {
  id: string
  fecha: string
  codigo_interno: string
  asunto: string
  descripcion: string
  personal_general: boolean
  registrado_por: string
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  visto_gerencia_en: string | null
  visto_rrhh_en: string | null
  observado_en: string | null
  observacion_area: LadoValidacion | null
  observacion: string | null
  /** El reporte observado que este corrige. */
  reemplaza_a: string | null
  area: string | null
  trabajos: TrabajoReporte[]
  personal: { trabajador_id: string; horas: number }[]
  fotos: number
}

/** El reporte completo, con su personal y sus fotos firmadas. */
export type ReporteDetalle = Omit<ReporteListado, 'personal' | 'fotos'> & {
  personal: PersonaReporte[]
  fotos: { id: string; orden: number; ruta: string; enlace: string | null }[]
  /** El reporte que corrigió a este, si lo observaron y el supervisor ya lo subió de nuevo. */
  corregido_por: string | null
  /**
   * Los otros códigos que subieron con este, en el mismo envío: los guardó la
   * misma transacción (`registrar_reportes_diarios`), así que comparten autor e
   * instante.
   */
  del_mismo_envio: { id: string; codigo_interno: string; anulado_en: string | null }[]
}

type Uno<T> = T | T[] | null
/** Una relación 1 a 1 llega como objeto; si llegara como lista, se toma la primera. */
function unico<T>(valor: Uno<T>): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

const COLUMNAS_REPORTE =
  'id, fecha, codigo_interno, asunto, descripcion, personal_general, registrado_por, creado_en, anulado_en, motivo_anulacion,' +
  ' visto_gerencia_en, visto_rrhh_en, observado_en, observacion_area, observacion, reemplaza_a,' +
  ' area:areas(nombre),' +
  ' trabajos:reporte_diario_trabajos!reporte_diario_trabajos_reporte_id_fkey(id, orden, descripcion, avance, actividad_id,' +
  ' actividad:codigo_actividades!reporte_diario_trabajos_actividad_id_fkey(plano_id, subcontrato_id))'

type FilaReporte = Omit<ReporteListado, 'area' | 'trabajos' | 'personal' | 'fotos'> & {
  area: Uno<{ nombre: string }>
  trabajos: FilaTrabajo[] | null
}

function cabecera(fila: FilaReporte) {
  return {
    ...fila,
    area: unico(fila.area)?.nombre ?? null,
    trabajos: [...(fila.trabajos ?? [])]
      .sort((a, b) => a.orden - b.orden)
      .map(({ actividad, ...t }) => ({
        ...t,
        plano_id: unico(actividad)?.plano_id ?? null,
        subcontrato_id: unico(actividad)?.subcontrato_id ?? null,
      })),
  }
}

/** Del primer día de un mes `YYYY-MM` al primero del siguiente, como texto. */
function rangoDelMes(mes: string) {
  const [anio, m] = mes.split('-').map(Number)
  const hasta = `${m === 12 ? anio + 1 : anio}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  return { desde: `${mes}-01`, hasta }
}

/**
 * Los reportes de un mes (`YYYY-MM`), del más reciente al más viejo, con los
 * anulados. El RLS decide cuáles: al supervisor, los suyos; a RR. HH. y
 * Gerencia, todos.
 */
export async function listarReportesDiarios(mes: string): Promise<ReporteListado[]> {
  const supabase = await createClient()
  const { desde, hasta } = rangoDelMes(mes)
  const { data, error } = await supabase
    .from('reportes_diarios')
    .select(
      `${COLUMNAS_REPORTE},` +
        ' personal:reporte_diario_personal!reporte_diario_personal_reporte_id_fkey(trabajador_id, horas),' +
        ' fotos:reporte_diario_fotos!reporte_diario_fotos_reporte_id_fkey(id)',
    )
    .gte('fecha', desde)
    .lt('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(500)
  if (error) throw new Error(`No se pudieron leer los reportes diarios: ${error.message}`)
  type Fila = FilaReporte & { personal: { trabajador_id: string; horas: number | string }[] | null; fotos: { id: string }[] | null }
  return ((data ?? []) as unknown as Fila[]).map((f) => ({
    ...cabecera(f),
    personal: (f.personal ?? []).map((p) => ({ trabajador_id: p.trabajador_id, horas: Number(p.horas) })),
    fotos: (f.fotos ?? []).length,
  }))
}

/**
 * Un reporte con todo lo suyo, o `null` si no existe o quien mira no lo puede
 * ver. `veCosteo`: quien mira es RR. HH. y lee el tareo; para los demás el
 * tareo llega vacío y el estado del costeo no se muestra.
 */
export async function reporteDiario(id: string, veCosteo: boolean): Promise<ReporteDetalle | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('reportes_diarios')
    .select(
      `${COLUMNAS_REPORTE},` +
        ' personal:reporte_diario_personal!reporte_diario_personal_reporte_id_fkey(id, trabajo_id, trabajador_id, nombre, cargo, horas,' +
        ' tareo:tareos!tareos_reporte_linea_id_fkey(id, anulado_en)),' +
        ' fotos:reporte_diario_fotos!reporte_diario_fotos_reporte_id_fkey(id, orden, ruta)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el reporte diario: ${error.message}`)
  if (!data) return null

  type Linea = Omit<PersonaReporte, 'costeo' | 'horas'> & { horas: number | string; tareo: Uno<{ id: string; anulado_en: string | null }> }
  const fila = data as unknown as FilaReporte & {
    personal: Linea[] | null
    fotos: { id: string; orden: number; ruta: string }[] | null
  }
  const fotos = [...(fila.fotos ?? [])].sort((a, b) => a.orden - b.orden)
  const [enlaces, corregido, hermanos] = await Promise.all([
    enlacesDeFotos(fotos.map((f) => f.ruta)),
    fila.observado_en
      ? supabase.from('reportes_diarios').select('id').eq('reemplaza_a', id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    // Una corrección entra sola: no tiene hermanos. Los del día de esa persona
    // son pocos; el instante se compara aquí, al milisegundo: igualarlo en la
    // consulta depende de cuántos decimales devuelve la API.
    fila.reemplaza_a
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from('reportes_diarios')
          .select('id, codigo_interno, anulado_en, creado_en')
          .eq('registrado_por', fila.registrado_por)
          .eq('fecha', fila.fecha)
          .neq('id', id)
          .order('codigo_interno')
          .limit(50),
  ])
  if (hermanos.error) throw new Error(`No se pudieron leer los otros códigos del reporte: ${hermanos.error.message}`)

  return {
    ...cabecera(fila),
    personal: (fila.personal ?? []).map(({ tareo, ...l }) => {
      const t = unico(tareo)
      return {
        ...l,
        horas: Number(l.horas),
        costeo: !veCosteo ? null : !t ? 'ESPERA_COSTO' : t.anulado_en ? 'ANULADO' : 'EN_COSTEO',
      }
    }),
    fotos: fotos.map((f) => ({ ...f, enlace: enlaces[f.ruta] ?? null })),
    corregido_por: corregido.data?.id ?? null,
    del_mismo_envio: (hermanos.data ?? [])
      .filter((h) => Date.parse(h.creado_en) === Date.parse(fila.creado_en))
      .map(({ id: hermano, codigo_interno, anulado_en }) => ({ id: hermano, codigo_interno, anulado_en })),
  }
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_REPORTE).createSignedUrls(rutas, 3600)
  // Sin enlaces la pantalla igual sirve: el reporte se lee sin las fotos.
  if (error || !data) return {} as Record<string, string>
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

/** Una persona que el supervisor puede poner en su reporte: sin DNI, cuenta ni costo. */
export type PersonaDisponible = { id: string; nombres: string; apellidos: string; cargo: string | null; area_id: string | null; area: string | null }

/** El personal activo que registró RR. HH., para elegir en el reporte. */
export async function personalParaReporte(): Promise<PersonaDisponible[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reporte_diario_personal_disponible')
  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`)
  // Los tipos generados ven nullable toda columna de una función; id, nombres y apellidos nunca lo son.
  return (data ?? []).flatMap((p) =>
    p.id && p.nombres && p.apellidos ? [{ ...p, id: p.id, nombres: p.nombres, apellidos: p.apellidos }] : [],
  )
}

/** Las horas de los reportes que esperan el costo mensual de cada persona. Solo RR. HH. */
export type HorasEsperandoCosto = { trabajador_id: string; nombre: string; horas: number; lineas: number; desde: string }

export async function horasEsperandoCosto(): Promise<HorasEsperandoCosto[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_horas_esperando_costo')
  if (error) throw new Error(`No se pudieron leer las horas que esperan costo: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.trabajador_id
      ? [{ trabajador_id: f.trabajador_id, nombre: f.nombre ?? 'Persona', horas: Number(f.horas), lineas: Number(f.lineas), desde: f.desde ?? '' }]
      : [],
  )
}

/** Sobre qué puede reportar el supervisor en un código: un plano o un subcontrato de su área, o una actividad que ya abrió. */
export type OpcionDeTrabajo = {
  tipo: 'PLANO' | 'SUBCONTRATO' | 'ACTIVIDAD'
  id: string
  etiqueta: string
  area: string | null
  /** El último avance reportado; `null` si todavía nadie lo reportó. */
  avance: number | null
  ultima_fecha: string | null
  /** El porcentaje de la unidad, en los planos. */
  peso: number | null
  /** El menor avance de un día posterior al del reporte, que este día no puede alcanzar. */
  tope: number | null
  tope_fecha: string | null
}

/**
 * Lo que el supervisor puede elegir en un código, con lo que llevaba cada cosa
 * el día del reporte (`fecha`; hoy si no se da). `corrige`: su reporte
 * observado, que no se cuenta.
 */
export async function opcionesDeTrabajo(codigo: string, corrige: string | null, fecha: string | null): Promise<OpcionDeTrabajo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reporte_diario_opciones', {
    p_codigo: codigo,
    p_corrige: corrige ?? undefined,
    p_fecha: fecha ?? undefined,
  })
  // El código viaja con el error para que la acción lo traduzca (`mensajeDeError`).
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return (data ?? []).flatMap((o) =>
    o.id && (o.tipo === 'PLANO' || o.tipo === 'SUBCONTRATO' || o.tipo === 'ACTIVIDAD')
      ? [
          {
            tipo: o.tipo,
            id: o.id,
            etiqueta: o.etiqueta ?? '',
            area: o.area,
            avance: o.avance === null ? null : Number(o.avance),
            ultima_fecha: o.ultima_fecha,
            peso: o.peso === null ? null : Number(o.peso),
            tope: o.tope === null ? null : Number(o.tope),
            tope_fecha: o.tope_fecha,
          },
        ]
      : [],
  )
}
