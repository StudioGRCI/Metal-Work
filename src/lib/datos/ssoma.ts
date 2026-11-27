import 'server-only'

import { BUCKET_FOTOS_SSOMA, ordenDeAcciones, type AlcanceAccionSsoma, type AlcanceSsoma } from '@/lib/dominio/ssoma'
import { createClient } from '@/lib/supabase/server'

/*
 * Los reportes de seguridad (migración 20261125150100). Todo se lee por
 * `ssoma_reportes_visibles`, que decide qué ve quien pregunta: SSOMA y Gerencia
 * todo, cada quien lo suyo, y el área donde pasó el hecho sin quién lo reportó,
 * sin a nombre de quién y sin fotos. La pantalla no arma ese filtro: lo que la
 * función no devuelve, no existe para ella.
 */

export type ReporteSsoma = {
  id: string
  numero: string
  tipo: string
  area: string
  lugar: string
  descripcion: string
  ocurrido_en: string
  /** Solo de un accidente: si hubo atención médica. Nunca el diagnóstico. */
  hubo_atencion: boolean | null
  estado: string
  creado_en: string
  /** Los días que lleva en SSOMA, contados en la base con la fecha de Lima; `null` si ya no espera. */
  dias_en_espera: number | null
  alcance: AlcanceSsoma
  /** Quién lo reportó y su puesto: `null` para quien lo ve por ser del área. */
  reporto: string | null
  reporto_puesto: string | null
  /** A nombre de qué trabajador sin cuenta se reportó, y su cargo. */
  a_nombre_de: string | null
  a_nombre_de_cargo: string | null
  fotos: number
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
}

type Fila = { [K in keyof ReporteSsoma]: ReporteSsoma[K] | null } & { area_id: string | null; area_codigo: string | null }

function aReporte(f: Fila): ReporteSsoma | null {
  if (!f.id || !f.numero || !f.tipo || !f.estado || !f.creado_en || !f.ocurrido_en) return null
  return {
    id: f.id,
    numero: f.numero,
    tipo: f.tipo,
    area: f.area ?? '',
    lugar: f.lugar ?? '',
    descripcion: f.descripcion ?? '',
    ocurrido_en: f.ocurrido_en,
    hubo_atencion: f.hubo_atencion,
    estado: f.estado,
    creado_en: f.creado_en,
    dias_en_espera: f.dias_en_espera,
    alcance: f.alcance === 'TODOS' || f.alcance === 'PROPIO' || f.alcance === 'ACCION' ? f.alcance : 'AREA',
    reporto: f.reporto,
    reporto_puesto: f.reporto_puesto,
    a_nombre_de: f.a_nombre_de,
    a_nombre_de_cargo: f.a_nombre_de_cargo,
    fotos: f.fotos ?? 0,
    anulado_en: f.anulado_en,
    anulo: f.anulo,
    motivo_anulacion: f.motivo_anulacion,
  }
}

/** Cuántos reportes trae la lista como mucho: los más recientes. */
export const MAXIMO_REPORTES_SSOMA = 200

/**
 * Los reportes que ve quien pregunta, del más reciente al más viejo. Con
 * `porClasificarPrimero` (SSOMA), los que esperan su clasificación van antes, del
 * más viejo al más nuevo, y se piden aparte: el tope de la lista no se lleva al
 * que más espera.
 */
export async function listarReportesSsoma({ porClasificarPrimero = false }: { porClasificarPrimero?: boolean } = {}): Promise<{
  reportes: ReporteSsoma[]
  /** Qué consulta llegó al tope: la lista dice cuál se cortó. */
  cortados: { porClasificar: boolean; recientes: boolean }
}> {
  const supabase = await createClient()
  const recientes = supabase
    .rpc('ssoma_reportes_visibles', { p_id: null })
    .order('creado_en', { ascending: false })
    .order('numero', { ascending: false })
    .range(0, MAXIMO_REPORTES_SSOMA - 1)
  const [porClasificar, resto] = await Promise.all([
    porClasificarPrimero
      ? supabase
          .rpc('ssoma_reportes_visibles', { p_id: null })
          .eq('estado', 'REPORTADO')
          .order('creado_en', { ascending: true })
          .order('numero', { ascending: true })
          .range(0, MAXIMO_REPORTES_SSOMA - 1)
      : null,
    porClasificarPrimero ? recientes.neq('estado', 'REPORTADO') : recientes,
  ])
  const error = porClasificar?.error ?? resto.error
  if (error) throw new Error(`No se pudieron leer los reportes de seguridad: ${error.message}`)
  return {
    reportes: ([...(porClasificar?.data ?? []), ...(resto.data ?? [])] as Fila[]).flatMap((f) => aReporte(f) ?? []),
    cortados: {
      porClasificar: (porClasificar?.data?.length ?? 0) >= MAXIMO_REPORTES_SSOMA,
      recientes: (resto.data?.length ?? 0) >= MAXIMO_REPORTES_SSOMA,
    },
  }
}

/** Una foto del reporte, con su enlace firmado por una hora. */
export type FotoSsoma = { id: string; orden: number; enlace: string | null }

export type DetalleReporteSsoma = ReporteSsoma & { fotosDelReporte: FotoSsoma[] }

/** Un reporte con sus fotos. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarReporteSsoma(id: string): Promise<DetalleReporteSsoma | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_reportes_visibles', { p_id: id })
  if (error) throw new Error(`No se pudo leer el reporte de seguridad: ${error.message}`)
  const reporte = ((data ?? []) as Fila[]).flatMap((f) => aReporte(f) ?? [])[0]
  if (!reporte) return null
  // El área no ve las fotos: la función le dice cero y la tabla no le deja leerlas.
  if (reporte.fotos === 0) return { ...reporte, fotosDelReporte: [] }

  const { data: filas, error: errorFotos } = await supabase
    .from('ssoma_reporte_fotos')
    .select('id, orden, ruta')
    .eq('reporte_id', id)
    .order('orden')
  if (errorFotos) throw new Error(`No se pudieron leer las fotos del reporte: ${errorFotos.message}`)
  const fotos = filas ?? []
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return { ...reporte, fotosDelReporte: fotos.map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null })) }
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_SSOMA).createSignedUrls(rutas, 3600)
  // Sin enlaces la pantalla igual sirve y lo dice en cada foto («no se pudo abrir
  // ahora»); el motivo queda en el registro del servidor, no se traga.
  if (error || !data) {
    console.error('No se pudieron firmar las fotos del reporte de seguridad:', error?.message ?? 'sin respuesta')
    return {} as Record<string, string>
  }
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

export type AreaParaReportar = { id: string; nombre: string }

/** Las áreas de la empresa, en el orden del proceso: dónde pasó. */
export async function areasParaReportar(): Promise<AreaParaReportar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id, nombre').eq('activo', true).order('orden_secuencia')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

export type PersonaParaReportar = { id: string; nombre: string; cargo: string | null; area: string | null }

/**
 * La lista de RR. HH. para reportar a nombre de un trabajador sin cuenta: solo
 * nombre, cargo y área. Pide `ssoma.reportar_por_otro`; quien no lo tiene no la llama.
 */
export async function personalParaReportar(): Promise<PersonaParaReportar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_personal_para_elegir')
  if (error) throw new Error(`No se pudo leer la lista del personal: ${error.message}`)
  return (data ?? []).flatMap((p) => (p.id && p.nombre ? [{ id: p.id, nombre: p.nombre, cargo: p.cargo, area: p.area }] : []))
}

/*
 * Entrega 15.2 (migración 20261126151500): la clasificación, la causa y las
 * acciones correctivas. Lo que cada quien ve lo deciden
 * `ssoma_seguimiento_de_reportes`, `ssoma_acciones_a_la_vista` y
 * `ssoma_historia_de_accion`; la clasificación y la causa llegan vacías a quien
 * no es SSOMA ni Gerencia.
 */

export type SeguimientoSsoma = {
  /** La última clasificación y su causa: solo para SSOMA y Gerencia; `null` para los demás o si falta. */
  clasificacion: string | null
  hubo_atencion: boolean | null
  dias_perdidos: number | null
  causa: string | null
  clasifico: string | null
  clasificado_en: string | null
  /** Cuándo se cerró la última de sus acciones; `null` mientras quede alguna abierta. */
  cerrado_en: string | null
  /** Las acciones vigentes (sin las anuladas), y de ellas las abiertas, las vencidas y las cerradas. */
  acciones: number
  abiertas: number
  vencidas: number
  cerradas: number
}

const SIN_SEGUIMIENTO: SeguimientoSsoma = {
  clasificacion: null,
  hubo_atencion: null,
  dias_perdidos: null,
  causa: null,
  clasifico: null,
  clasificado_en: null,
  cerrado_en: null,
  acciones: 0,
  abiertas: 0,
  vencidas: 0,
  cerradas: 0,
}

/** Cómo va cada uno de estos reportes, si quien pregunta lo ve, por su id. */
export async function seguimientoDeReportes(ids: string[]): Promise<Record<string, SeguimientoSsoma>> {
  if (ids.length === 0) return {}
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_seguimiento_de_reportes', {
    p_ids: ids,
  })
  if (error) throw new Error(`No se pudo leer cómo van los reportes de seguridad: ${error.message}`)
  const porReporte: Record<string, SeguimientoSsoma> = {}
  for (const f of data ?? []) {
    if (!f.reporte) continue
    porReporte[f.reporte] = {
      clasificacion: f.clasificacion,
      hubo_atencion: f.hubo_atencion,
      dias_perdidos: f.dias_perdidos,
      causa: f.causa,
      clasifico: f.clasifico,
      clasificado_en: f.clasificado_en,
      cerrado_en: f.cerrado_en,
      acciones: f.acciones ?? 0,
      abiertas: f.abiertas ?? 0,
      vencidas: f.vencidas ?? 0,
      cerradas: f.cerradas ?? 0,
    }
  }
  return porReporte
}

/** El seguimiento de un reporte, o vacío si todavía no lo tiene. */
export function seguimientoDe(porReporte: Record<string, SeguimientoSsoma>, id: string) {
  return porReporte[id] ?? SIN_SEGUIMIENTO
}

export type AccionSsoma = {
  id: string
  /** De un reporte (con su número y su tipo) o del hallazgo de una inspección: nunca de los dos. */
  reporte_id: string | null
  reporte_numero: string | null
  reporte_tipo: string
  respuesta_id: string | null
  inspeccion_id: string | null
  /** El día de la inspección (`YYYY-MM-DD`) y lo que se encontró en ella. */
  inspeccion_fecha: string | null
  hallazgo: string | null
  area: string
  descripcion: string
  responsable_id: string
  responsable: string
  responsable_puesto: string | null
  /** `YYYY-MM-DD`, en Lima. */
  fecha_limite: string
  estado: string
  /** Los días que le faltan a una abierta (negativo si ya venció), contados en la base con la fecha de Lima. */
  dias_para_vencer: number | null
  creado_en: string
  asigno: string | null
  cerrado_en: string | null
  cerro: string | null
  nota_cierre: string | null
  /** Las fotos del último cierre: 0 para quien la ve solo por el reporte. */
  fotos: number
  anulado_en: string | null
  motivo_anulacion: string | null
  alcance: AlcanceAccionSsoma
}

/** Cuántas acciones trae la lista como mucho. */
export const MAXIMO_ACCIONES_SSOMA = 300

/**
 * Las acciones que ve quien pregunta: de un reporte, de una inspección, una
 * sola o todas. Ya ordenadas: las vencidas arriba, después las abiertas por su
 * fecha, las cerradas y las anuladas. El orden lo pone la base antes del tope:
 * si no, las más viejas, que suelen ser las vencidas, eran las primeras en
 * quedar fuera.
 */
export async function listarAccionesSsoma({
  reporte = null,
  inspeccion = null,
  id = null,
}: { reporte?: string | null; inspeccion?: string | null; id?: string | null } = {}) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('ssoma_acciones_a_la_vista', { p_reporte: reporte, p_inspeccion: inspeccion, p_id: id })
    .order('orden', { ascending: true })
    .order('fecha_limite', { ascending: true })
    .order('creado_en', { ascending: false })
    .range(0, MAXIMO_ACCIONES_SSOMA - 1)
  if (error) throw new Error(`No se pudieron leer las acciones correctivas: ${error.message}`)
  const acciones: AccionSsoma[] = (data ?? []).flatMap((f) =>
    f.id &&
    ((f.reporte_id && f.reporte_numero) || (f.inspeccion_id && f.respuesta_id)) &&
    f.descripcion &&
    f.responsable_id &&
    f.fecha_limite &&
    f.estado &&
    f.creado_en
      ? [
          {
            id: f.id,
            reporte_id: f.reporte_id,
            reporte_numero: f.reporte_numero,
            reporte_tipo: f.reporte_tipo ?? '',
            respuesta_id: f.respuesta_id,
            inspeccion_id: f.inspeccion_id,
            inspeccion_fecha: f.inspeccion_fecha,
            hallazgo: f.hallazgo,
            area: f.area ?? '',
            descripcion: f.descripcion,
            responsable_id: f.responsable_id,
            responsable: f.responsable ?? '',
            responsable_puesto: f.responsable_puesto,
            fecha_limite: f.fecha_limite,
            estado: f.estado,
            dias_para_vencer: f.dias_para_vencer,
            creado_en: f.creado_en,
            asigno: f.asigno,
            cerrado_en: f.cerrado_en,
            cerro: f.cerro,
            nota_cierre: f.nota_cierre,
            fotos: f.fotos ?? 0,
            anulado_en: f.anulado_en,
            motivo_anulacion: f.motivo_anulacion,
            alcance: f.alcance === 'TODOS' || f.alcance === 'RESPONSABLE' ? f.alcance : 'REPORTE',
          },
        ]
      : [],
  )
  return ordenDeAcciones(acciones)
}

export type PasoDeAccion = {
  id: string
  tipo: string
  responsable: string | null
  fecha_limite: string | null
  nota: string | null
  hizo: string
  hizo_puesto: string | null
  creado_en: string
  /** Las fotos de un cierre, con su enlace firmado por una hora. */
  fotosDelCierre: FotoSsoma[]
}

/**
 * La historia de una acción, con las fotos de cada cierre. La ven SSOMA,
 * Gerencia y su responsable; a los demás la base les da vacía.
 */
export async function historiaDeAccion(accion: string): Promise<PasoDeAccion[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_historia_de_accion', {
    p_accion: accion,
  })
  if (error) throw new Error(`No se pudo leer la historia de la acción: ${error.message}`)
  const pasos = (data ?? []).flatMap((p) =>
    p.id && p.tipo && p.creado_en
      ? [
          {
            id: p.id,
            tipo: p.tipo,
            responsable: p.responsable,
            fecha_limite: p.fecha_limite,
            nota: p.nota,
            hizo: p.hizo ?? '',
            hizo_puesto: p.hizo_puesto,
            creado_en: p.creado_en,
            fotos: p.fotos ?? 0,
          },
        ]
      : [],
  )
  const conFotos = pasos.filter((p) => p.fotos > 0).map((p) => p.id)
  if (conFotos.length === 0) return pasos.map(({ fotos: _, ...p }) => ({ ...p, fotosDelCierre: [] }))

  const { data: filas, error: errorFotos } = await supabase
    .from('ssoma_accion_fotos')
    .select('id, evento_id, orden, ruta')
    .in('evento_id', conFotos)
    .order('orden')
  if (errorFotos) throw new Error(`No se pudieron leer las fotos de la evidencia: ${errorFotos.message}`)
  const fotos = filas ?? []
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return pasos.map(({ fotos: _, ...p }) => ({
    ...p,
    fotosDelCierre: fotos
      .filter((f) => f.evento_id === p.id)
      .map((f) => ({
        id: f.id,
        orden: f.orden,
        enlace: enlaces[f.ruta] ?? null,
      })),
  }))
}

export type CuentaParaAsignar = {
  id: string
  nombre: string
  puesto: string | null
  area: string | null
}

/** Las cuentas activas a las que SSOMA puede encargar una acción: nombre, puesto y área. Pide `ssoma.gestionar`. */
export async function cuentasParaAsignar(): Promise<CuentaParaAsignar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_cuentas_para_asignar')
  if (error) throw new Error(`No se pudo leer la lista de cuentas: ${error.message}`)
  return (data ?? []).flatMap((c) => (c.id && c.nombre ? [{ id: c.id, nombre: c.nombre, puesto: c.puesto, area: c.area }] : []))
}

/*
 * Entrega 15.3 (migración 20261126985000): las charlas e inducciones. Las leen
 * solo SSOMA y Gerencia; a los demás las funciones les devuelven nada. De RR. HH.
 * llega solo nombre, cargo y área.
 */

export type CharlaSsoma = {
  id: string
  tipo: string
  tema: string
  expositor: string
  fecha: string
  asistentes: number
  fotos: number
  registro: string | null
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
}

/** Las charlas e inducciones de un mes («2026-11»), la más reciente arriba; las anuladas también. */
export async function listarCharlasDelMes(mes: string): Promise<CharlaSsoma[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_charlas_del_mes', { p_mes: `${mes}-01` })
  if (error) throw new Error(`No se pudieron leer las charlas: ${error.message}`)
  return (data ?? []).flatMap((c) =>
    c.id && c.tipo && c.tema && c.expositor && c.fecha
      ? [
          {
            id: c.id,
            tipo: c.tipo,
            tema: c.tema,
            expositor: c.expositor,
            fecha: c.fecha,
            asistentes: c.asistentes ?? 0,
            fotos: c.fotos ?? 0,
            registro: c.registro,
            anulado_en: c.anulado_en,
            anulo: c.anulo,
            motivo_anulacion: c.motivo_anulacion,
          },
        ]
      : [],
  )
}

export type PersonaDeLaLista = { id: string; nombre: string; cargo: string | null; area: string | null }
export type FaltoEnElMes = PersonaDeLaLista & { ultima: string | null }
/** En la lista para marcar va también quien se fue en los últimos 60 días: pudo estar en una charla de antes. */
export type PersonaParaMarcar = PersonaDeLaLista & { enPlanta: boolean }

/**
 * Quien estaba en la planta ese mes (no la lista de hoy: quien entró después no faltó) y no asistió a
 * ninguna charla ni inducción vigente del mes, con la última vez que asistió; y cuántos estaban.
 */
export async function noAsistieronEnElMes(mes: string): Promise<{ faltaron: FaltoEnElMes[]; activos: number }> {
  const supabase = await createClient()
  const [faltaron, activos] = await Promise.all([
    supabase.rpc('ssoma_no_asistieron', { p_mes: `${mes}-01` }),
    supabase.rpc('ssoma_personal_del_mes', { p_mes: `${mes}-01` }),
  ])
  const error = faltaron.error ?? activos.error
  if (error) throw new Error(`No se pudo leer quién no asistió: ${error.message}`)
  return {
    faltaron: (faltaron.data ?? []).flatMap((p) =>
      p.id && p.nombre ? [{ id: p.id, nombre: p.nombre, cargo: p.cargo, area: p.area, ultima: p.ultima }] : [],
    ),
    activos: activos.data ?? 0,
  }
}

/**
 * La lista de RR. HH. para marcar asistentes: solo nombre, cargo, área y si sigue en la planta (quien se
 * fue en los últimos 60 días también va). Si estaba ese día lo decide la base al registrar. Pide `ssoma.gestionar`.
 */
export async function personalParaCharla(): Promise<PersonaParaMarcar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_personal_para_charla')
  if (error) throw new Error(`No se pudo leer la lista del personal: ${error.message}`)
  return (data ?? []).flatMap((p) =>
    p.id && p.nombre ? [{ id: p.id, nombre: p.nombre, cargo: p.cargo, area: p.area, enPlanta: p.en_planta !== false }] : [],
  )
}

export type DetalleCharlaSsoma = {
  id: string
  tipo: string
  tema: string
  expositor: string
  fecha: string
  registro: string | null
  creado_en: string
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
  asistentes: PersonaDeLaLista[]
  fotosDeLaCharla: FotoSsoma[]
}

/** Una charla con sus asistentes y sus fotos. `null` si no existe o si quien mira no es SSOMA ni Gerencia. */
export async function cargarCharlaSsoma(id: string): Promise<DetalleCharlaSsoma | null> {
  const supabase = await createClient()
  const [charla, asistentes, fotos] = await Promise.all([
    supabase.rpc('ssoma_charla', { p_id: id }),
    supabase.rpc('ssoma_asistentes_de_charla', { p_charla: id }),
    supabase.from('ssoma_charla_fotos').select('id, orden, ruta').eq('charla_id', id).order('orden'),
  ])
  const error = charla.error ?? asistentes.error ?? fotos.error
  if (error) throw new Error(`No se pudo leer la charla: ${error.message}`)
  const c = (charla.data ?? [])[0]
  if (!c?.id || !c.tipo || !c.tema || !c.expositor || !c.fecha || !c.creado_en) return null
  const filas = fotos.data ?? []
  const enlaces = await enlacesDeFotos(filas.map((f) => f.ruta))
  return {
    id: c.id,
    tipo: c.tipo,
    tema: c.tema,
    expositor: c.expositor,
    fecha: c.fecha,
    registro: c.registro,
    creado_en: c.creado_en,
    anulado_en: c.anulado_en,
    anulo: c.anulo,
    motivo_anulacion: c.motivo_anulacion,
    asistentes: (asistentes.data ?? []).flatMap((p) => (p.id && p.nombre ? [{ id: p.id, nombre: p.nombre, cargo: p.cargo, area: p.area }] : [])),
    fotosDeLaCharla: filas.map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null })),
  }
}

/*
 * Entrega 15.4 (migración 20261126997500): las inspecciones con lista de
 * verificación por área. Las leen SSOMA y Gerencia; el responsable de una acción
 * ve la inspección solo con el hallazgo que le toca. Lo decide la base.
 */

export type InspeccionSsoma = {
  id: string
  area_id: string
  area: string
  /** `YYYY-MM-DD`, en Lima. */
  fecha: string
  tipo: string
  observacion: string | null
  registro: string | null
  creado_en: string
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
  /** Lo que se marcó y cómo van sus acciones: en cero para quien la ve solo por su acción. */
  puntos: number
  conformes: number
  no_conformes: number
  no_aplica: number
  /** Los hallazgos que se quedaron sin ninguna acción viva. */
  sin_accion: number
  abiertas: number
  vencidas: number
  cerradas: number
  /** `TODOS` (SSOMA y Gerencia) o `RESPONSABLE` (tiene a cargo una de sus acciones). */
  alcance: 'TODOS' | 'RESPONSABLE'
}

/** Cuántas inspecciones trae la lista como mucho. */
export const MAXIMO_INSPECCIONES_SSOMA = 100

async function leerInspecciones(id: string | null): Promise<InspeccionSsoma[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('ssoma_inspecciones_a_la_vista', { p_id: id })
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .range(0, MAXIMO_INSPECCIONES_SSOMA - 1)
  if (error) throw new Error(`No se pudieron leer las inspecciones: ${error.message}`)
  return (data ?? []).flatMap((i) =>
    i.id && i.area_id && i.fecha && i.tipo && i.creado_en
      ? [
          {
            id: i.id,
            area_id: i.area_id,
            area: i.area ?? '',
            fecha: i.fecha,
            tipo: i.tipo,
            observacion: i.observacion,
            registro: i.registro,
            creado_en: i.creado_en,
            anulado_en: i.anulado_en,
            anulo: i.anulo,
            motivo_anulacion: i.motivo_anulacion,
            puntos: i.puntos ?? 0,
            conformes: i.conformes ?? 0,
            no_conformes: i.no_conformes ?? 0,
            no_aplica: i.no_aplica ?? 0,
            sin_accion: i.sin_accion ?? 0,
            abiertas: i.abiertas ?? 0,
            vencidas: i.vencidas ?? 0,
            cerradas: i.cerradas ?? 0,
            alcance: i.alcance === 'TODOS' ? 'TODOS' : 'RESPONSABLE',
          },
        ]
      : [],
  )
}

/** Las inspecciones, la más reciente arriba; las anuladas también. Solo las que la base deja ver. */
export function listarInspeccionesSsoma() {
  return leerInspecciones(null)
}

export type RespuestaDeInspeccion = { id: string; orden: number; texto: string; resultado: string; hallazgo: string | null }

/** Una inspección con sus puntos. `null` si no existe o si quien mira no la puede ver. */
export async function cargarInspeccionSsoma(id: string): Promise<{ inspeccion: InspeccionSsoma; respuestas: RespuestaDeInspeccion[] } | null> {
  const supabase = await createClient()
  const [inspecciones, respuestas] = await Promise.all([leerInspecciones(id), supabase.rpc('ssoma_respuestas_de_inspeccion', { p_inspeccion: id })])
  if (respuestas.error) throw new Error(`No se pudieron leer los puntos de la inspección: ${respuestas.error.message}`)
  const inspeccion = inspecciones[0]
  if (!inspeccion) return null
  return {
    inspeccion,
    respuestas: (respuestas.data ?? []).flatMap((r) =>
      r.id && r.texto && r.resultado ? [{ id: r.id, orden: r.orden ?? 0, texto: r.texto, resultado: r.resultado, hallazgo: r.hallazgo }] : [],
    ),
  }
}

export type AreaParaInspeccionar = { id: string; nombre: string; jefe_id: string | null }

/** Las áreas que se inspeccionan, en el orden del proceso, con su responsable: a quien se propone la acción. */
export async function areasParaInspeccionar(): Promise<AreaParaInspeccionar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id, nombre, jefe_id').eq('activo', true).order('orden_secuencia')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

export type AreaInspeccionada = {
  area_id: string
  area: string
  /** Cuántos puntos tiene hoy la lista con que se inspecciona. */
  puntos: number
  ultima_id: string | null
  ultima: string | null
  /** Los días desde la última, contados en la base con la fecha de Lima. */
  dias: number | null
  abiertas: number
  vencidas: number
}

/** Cada área activa con su última inspección vigente y las acciones que salieron de sus inspecciones. */
export async function inspeccionesPorArea(): Promise<AreaInspeccionada[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_inspecciones_por_area')
  if (error) throw new Error(`No se pudo leer cuándo se inspeccionó cada área: ${error.message}`)
  return (data ?? []).flatMap((a) =>
    a.area_id && a.area
      ? [
          {
            area_id: a.area_id,
            area: a.area,
            puntos: a.puntos ?? 0,
            ultima_id: a.ultima_id,
            ultima: a.ultima,
            dias: a.dias,
            abiertas: a.abiertas ?? 0,
            vencidas: a.vencidas ?? 0,
          },
        ]
      : [],
  )
}

export type PuntoDeLista = {
  id: string
  /** Sin área: se revisa en todas. */
  area_id: string | null
  texto: string
  orden: number
  activo: boolean
  retirado_en: string | null
}

/** La lista de verificación entera, con los puntos retirados: la leen SSOMA y Gerencia. */
export async function puntosDeLaLista(): Promise<PuntoDeLista[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('ssoma_lista_puntos')
    .select('id, area_id, texto, orden, activo, retirado_en')
    .order('orden')
    .order('creado_en')
  if (error) throw new Error(`No se pudo leer la lista de verificación: ${error.message}`)
  return data ?? []
}

/*
 * Entrega 15.5 (migración 20261126999100): la entrega de EPP por persona. Almacén
 * registra la salida del equipo; SSOMA anota a quién le tocó y hasta cuándo le
 * dura. Lo leen SSOMA y Gerencia; a los demás las funciones les devuelven nada.
 * De RR. HH. llega solo nombre, cargo y área, y de Almacén nunca el precio.
 */

export type SalidaDeEpp = {
  movimiento_id: string
  /** El número de la salida de Almacén (SA-0001-2026). */
  numero: string | null
  fecha: string
  material: string
  unidad: string | null
  cantidad: number
  devuelto: number
  asignado: number
  por_asignar: number
  /** Volvió a Almacén más de lo que quedaba sin asignar: hay entregas que anular. */
  asignado_de_mas: number
  recibio: string | null
  /** Cuántos días de duración se le dio la última vez a ese equipo, para proponerlos. */
  dias_sugeridos: number | null
  /** SSOMA dijo que lo que queda por asignar no se reparte por persona: ya no espera en su lista. */
  sin_reparto: boolean
  motivo_sin_reparto: string | null
  dijo_sin_reparto: string | null
  /** A quién le tocó: las entregas que valen (sin las anuladas), por nombre. Viene con la salida, sin tope. */
  a_quien: PersonaDeLaSalida[]
  /** De la lista para marcar, quién no estaba en la planta el día de la salida. Solo le llega a quien anota. */
  no_estaban: string[]
}

/** Una persona a la que le tocó parte de una salida. */
export type PersonaDeLaSalida = { id: string; trabajador_id: string; persona: string; cantidad: number }

/** `a_quien` llega como JSON: solo se toma lo que tiene la forma esperada. */
function personasDeLaSalida(json: unknown): PersonaDeLaSalida[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((x) => {
    if (!x || typeof x !== 'object') return []
    const { id, trabajador_id, persona, cantidad } = x as Record<string, unknown>
    return typeof id === 'string' && typeof trabajador_id === 'string' && typeof persona === 'string'
      ? [{ id, trabajador_id, persona, cantidad: Number(cantidad ?? 0) }]
      : []
  })
}

/**
 * Las salidas del almacén de EPP: las de los últimos 60 días y, hasta 180 días atrás, las que tienen algo
 * por asignar; las que esperan por SSOMA, primero. (`p_movimiento` trae una sola, de cualquier fecha: lo usan
 * las funciones de la base y sus pruebas, no la pantalla.)
 */
export async function salidasDeEpp(): Promise<SalidaDeEpp[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_salidas_de_epp', { p_movimiento: null })
  if (error) throw new Error(`No se pudieron leer las salidas de EPP: ${error.message}`)
  return (data ?? []).flatMap((s) =>
    s.movimiento_id && s.fecha && s.material
      ? [
          {
            movimiento_id: s.movimiento_id,
            numero: s.numero,
            fecha: s.fecha,
            material: s.material,
            unidad: s.unidad,
            cantidad: Number(s.cantidad ?? 0),
            devuelto: Number(s.devuelto ?? 0),
            asignado: Number(s.asignado ?? 0),
            por_asignar: Number(s.por_asignar ?? 0),
            asignado_de_mas: Number(s.asignado_de_mas ?? 0),
            recibio: s.recibio,
            dias_sugeridos: s.dias_sugeridos,
            sin_reparto: s.sin_reparto === true,
            motivo_sin_reparto: s.motivo_sin_reparto,
            dijo_sin_reparto: s.dijo_sin_reparto,
            a_quien: personasDeLaSalida(s.a_quien),
            no_estaban: Array.isArray(s.no_estaban) ? s.no_estaban.filter((i): i is string => typeof i === 'string') : [],
          },
        ]
      : [],
  )
}

/** Lo que espera del EPP: salidas por anotar, equipo vencido y todo lo que está por renovar. */
export type EppPorAtender = { porAsignar: number; vencidos: number; porRenovar: number }

/**
 * Las tres cuentas del encabezado y de las pestañas, sin traer las listas: lo que cuenta es lo mismo que
 * listan `ssoma_salidas_de_epp` y «Por renovar», y no tiene tope. A quien no ve SSOMA, ceros.
 */
export async function eppPorAtender(): Promise<EppPorAtender> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_epp_por_atender').single()
  if (error) throw new Error(`No se pudo leer lo que espera del EPP: ${error.message}`)
  return { porAsignar: data?.por_asignar ?? 0, vencidos: data?.vencidos ?? 0, porRenovar: data?.por_renovar ?? 0 }
}

/**
 * La lista de RR. HH. para anotar una entrega (los activos y quien se fue en los últimos 180 días): solo
 * nombre, cargo, área y si sigue en la planta. Quién no estaba el día de cada salida lo dice la salida
 * (`no_estaban`), y la base lo vuelve a comprobar al anotar. Pide `ssoma.gestionar`.
 */
export async function personalParaEpp(): Promise<PersonaParaMarcar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_personal_para_epp')
  if (error) throw new Error(`No se pudo leer la lista del personal: ${error.message}`)
  return (data ?? []).flatMap((p) =>
    p.id && p.nombre ? [{ id: p.id, nombre: p.nombre, cargo: p.cargo, area: p.area, enPlanta: p.en_planta !== false }] : [],
  )
}

export type EntregaDeEpp = {
  id: string
  trabajador_id: string
  persona: string
  cargo: string | null
  area: string | null
  en_planta: boolean
  movimiento_id: string
  numero_salida: string | null
  material: string
  unidad: string | null
  cantidad: number
  entregado_el: string
  renovar_el: string
  /** VIGENTE, RENOVADA, SIN_RENOVACION o ANULADA: lo calcula la base. */
  estado: string
  /** De una vigente: VENCIDA, POR_VENCER o AL_DIA. */
  situacion: string | null
  /** Los días hasta la renovación (negativos si ya pasó), contados en la base con la fecha de Lima. */
  dias: number
  registro: string | null
  creado_en: string
  sin_renovacion_en: string | null
  saco_de_renovar: string | null
  motivo_sin_renovacion: string | null
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
}

/** Cuántas entregas trae una lectura como mucho. */
export const MAXIMO_ENTREGAS_EPP = 500

/**
 * Las entregas de EPP de una persona, o las que están por renovar (vigentes, de quien sigue en la planta,
 * vencidas o por vencer en 15 días). A quién le tocó cada salida no sale de aquí: viene con la salida.
 */
export async function entregasDeEpp({
  trabajador = null,
  porRenovar = false,
}: {
  trabajador?: string | null
  porRenovar?: boolean
} = {}): Promise<EntregaDeEpp[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('ssoma_epp_entregas_a_la_vista', { p_trabajador: trabajador, p_movimiento: null, p_por_renovar: porRenovar })
    .range(0, MAXIMO_ENTREGAS_EPP - 1)
  if (error) throw new Error(`No se pudieron leer las entregas de EPP: ${error.message}`)
  return (data ?? []).flatMap((e) =>
    e.id && e.trabajador_id && e.persona && e.movimiento_id && e.material && e.entregado_el && e.renovar_el && e.estado && e.creado_en
      ? [
          {
            id: e.id,
            trabajador_id: e.trabajador_id,
            persona: e.persona,
            cargo: e.cargo,
            area: e.area,
            en_planta: e.en_planta !== false,
            movimiento_id: e.movimiento_id,
            numero_salida: e.numero_salida,
            material: e.material,
            unidad: e.unidad,
            cantidad: Number(e.cantidad ?? 0),
            entregado_el: e.entregado_el,
            renovar_el: e.renovar_el,
            estado: e.estado,
            situacion: e.situacion,
            dias: e.dias ?? 0,
            registro: e.registro,
            creado_en: e.creado_en,
            sin_renovacion_en: e.sin_renovacion_en,
            saco_de_renovar: e.saco_de_renovar,
            motivo_sin_renovacion: e.motivo_sin_renovacion,
            anulado_en: e.anulado_en,
            anulo: e.anulo,
            motivo_anulacion: e.motivo_anulacion,
          },
        ]
      : [],
  )
}

export type PersonaConEpp = {
  id: string
  persona: string
  cargo: string | null
  area: string | null
  en_planta: boolean
  vigentes: number
  vencidas: number
  por_vencer: number
  /** La renovación más cercana de lo que tiene vigente. */
  proxima: string | null
}

/** Cada persona en la planta con lo que tiene de EPP; con `trabajador`, esa sola, siga o no en la planta. */
export async function eppPorPersona(trabajador: string | null = null): Promise<PersonaConEpp[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('ssoma_epp_por_persona', { p_trabajador: trabajador })
  if (error) throw new Error(`No se pudo leer el EPP de cada persona: ${error.message}`)
  return (data ?? []).flatMap((p) =>
    p.id && p.persona
      ? [
          {
            id: p.id,
            persona: p.persona,
            cargo: p.cargo,
            area: p.area,
            en_planta: p.en_planta !== false,
            vigentes: p.vigentes ?? 0,
            vencidas: p.vencidas ?? 0,
            por_vencer: p.por_vencer ?? 0,
            proxima: p.proxima,
          },
        ]
      : [],
  )
}
