import 'server-only'

import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { MAXIMO_UNIDADES_PARA_ELEGIR } from '@/lib/dominio/tramites'
import { createClient } from '@/lib/supabase/server'

/*
 * Los trámites (plan «El puesto de Tramitador», entrega 1, migración
 * 20261126997100). Todo se lee por `tramites_visibles`, que decide quién ve
 * —el Tramitador, Gerencia y Administración, todos; Ventas, solo los de una
 * unidad— y trae el tipo, la unidad, el cliente y la OT: quien ve el trámite no
 * siempre lee esas tablas. También dice qué puede hacer quien pregunta en cada
 * uno, con la misma regla que la función que escribe. El expediente (entrega 2,
 * migración 20261127002000) se lee por `tramites_archivos` y
 * `tramites_gestiones`, con la misma regla de quién ve. El origen, la
 * renovación y «por vencer» son de la entrega 4 (migración 20261127170000).
 */

export type Tramite = {
  id: string
  numero: string
  estado: string
  /** El estado, o POR_ANULAR mientras espera el visto de Gerencia (`SITUACION_TRAMITE`). */
  situacion: string
  creado_en: string
  actualizado_en: string | null
  tipo_id: string
  tipo: string
  se_renueva: boolean
  ambito: string
  entidad: string
  asunto: string
  expediente: string | null
  fecha_inicio: string | null
  fecha_limite: string | null
  /** Los días que faltan para la fecha límite, contados en la base con la fecha de Lima; negativo si ya pasó. */
  dias_para_limite: number | null
  vencido: boolean
  nota: string | null
  unidad_id: string | null
  placa: string | null
  codigo_interno: string | null
  carroceria: string | null
  cliente: string | null
  orden_id: string | null
  orden_numero: string | null
  /** Quién lo registró; vacío en el que abrió la base (`origen`). */
  registro: string | null
  registro_puesto: string | null
  anulacion_pedida_en: string | null
  anulacion_pidio: string | null
  motivo_anulacion: string | null
  anulacion_rechazada_en: string | null
  anulacion_rechazo: string | null
  anulacion_rechazo_motivo: string | null
  anulado_en: string | null
  anulo: string | null
  puede_actualizar: boolean
  puede_pedir_anulacion: boolean
  puede_resolver_anulacion: boolean
  /** La fecha del documento final, si está concluido (o lo estaba al anularse). */
  fecha_conclusion: string | null
  /** Hasta cuándo vale el documento final de uno que se renueva. */
  vigente_hasta: string | null
  concluido_en: string | null
  concluyo: string | null
  /** Cuántos archivos en pie tiene su expediente. */
  archivos: number
  /** Subir archivos, anotar gestiones y retirar lo subido por error. */
  puede_llevar_expediente: boolean
  /** Cerrarlo con su documento final: ya se presentó y no espera el visto de Gerencia. */
  puede_concluir: boolean
  /** `ORIGEN_TRAMITE`: lo registró alguien, lo abrió la OT al terminar o es una renovación. */
  origen: string
  /** Abierto y dentro de los días de aviso de su tipo: lo que Gerencia cuenta como «por vencer». */
  por_vencer: boolean
  /** En una renovación, el trámite cuyo documento renueva. */
  renueva_a: string | null
  renueva_numero: string | null
  /** Su renovación: la que está en pie o, si se anularon, la última. */
  renovado_con: string | null
  renovado_numero: string | null
  renovado_estado: string | null
  /** «Renovar ahora»: concluido, se renueva y no tiene una renovación en pie. */
  puede_renovar: boolean
}

type Fila = { [K in keyof Tramite]: Tramite[K] | null }

function aTramite(f: Fila): Tramite | null {
  if (!f.id || !f.numero || !f.estado || !f.situacion || !f.creado_en || !f.tipo_id || !f.ambito) return null
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    situacion: f.situacion,
    creado_en: f.creado_en,
    actualizado_en: f.actualizado_en,
    tipo_id: f.tipo_id,
    tipo: f.tipo ?? '',
    se_renueva: f.se_renueva === true,
    ambito: f.ambito,
    entidad: f.entidad ?? '',
    asunto: f.asunto ?? '',
    expediente: f.expediente,
    fecha_inicio: f.fecha_inicio,
    fecha_limite: f.fecha_limite,
    dias_para_limite: f.dias_para_limite,
    vencido: f.vencido === true,
    nota: f.nota,
    unidad_id: f.unidad_id,
    placa: f.placa,
    codigo_interno: f.codigo_interno,
    carroceria: f.carroceria,
    cliente: f.cliente,
    orden_id: f.orden_id,
    orden_numero: f.orden_numero,
    registro: f.registro,
    registro_puesto: f.registro_puesto,
    anulacion_pedida_en: f.anulacion_pedida_en,
    anulacion_pidio: f.anulacion_pidio,
    motivo_anulacion: f.motivo_anulacion,
    anulacion_rechazada_en: f.anulacion_rechazada_en,
    anulacion_rechazo: f.anulacion_rechazo,
    anulacion_rechazo_motivo: f.anulacion_rechazo_motivo,
    anulado_en: f.anulado_en,
    anulo: f.anulo,
    puede_actualizar: f.puede_actualizar === true,
    puede_pedir_anulacion: f.puede_pedir_anulacion === true,
    puede_resolver_anulacion: f.puede_resolver_anulacion === true,
    fecha_conclusion: f.fecha_conclusion,
    vigente_hasta: f.vigente_hasta,
    concluido_en: f.concluido_en,
    concluyo: f.concluyo,
    archivos: f.archivos ?? 0,
    puede_llevar_expediente: f.puede_llevar_expediente === true,
    puede_concluir: f.puede_concluir === true,
    origen: f.origen ?? 'MANUAL',
    por_vencer: f.por_vencer === true,
    renueva_a: f.renueva_a,
    renueva_numero: f.renueva_numero,
    renovado_con: f.renovado_con,
    renovado_numero: f.renovado_numero,
    renovado_estado: f.renovado_estado,
    puede_renovar: f.puede_renovar === true,
  }
}

/** Cuántos trámites abiertos trae la lista como mucho: el tope de filas de la API. */
export const MAXIMO_VIVOS = 1000

/** Cuántos concluidos trae la lista como mucho: los más recientes. Los abiertos van todos. */
export const MAXIMO_CONCLUIDOS = 200

/** Cuántos anulados trae la lista como mucho: los más recientes. */
export const MAXIMO_ANULADOS = 200

const SELECT =
  'id, numero, estado, situacion, creado_en, actualizado_en, tipo_id, tipo, se_renueva, ambito, entidad, asunto, expediente, fecha_inicio, fecha_limite, dias_para_limite, vencido, nota, unidad_id, placa, codigo_interno, carroceria, cliente, orden_id, orden_numero, registro, registro_puesto, anulacion_pedida_en, anulacion_pidio, motivo_anulacion, anulacion_rechazada_en, anulacion_rechazo, anulacion_rechazo_motivo, anulado_en, anulo, puede_actualizar, puede_pedir_anulacion, puede_resolver_anulacion, fecha_conclusion, vigente_hasta, concluido_en, concluyo, archivos, puede_llevar_expediente, puede_concluir, origen, por_vencer, renueva_a, renueva_numero, renovado_con, renovado_numero, renovado_estado, puede_renovar'

/**
 * Los trámites que ve quien pregunta, del más reciente al más viejo: todos los
 * vivos y los últimos anulados. Con `busqueda`, los que la llevan en su número,
 * su tipo, su entidad, lo que se tramita, su expediente, la placa, el código
 * interno, el cliente o la OT: el filtro va en la base, así que encuentra
 * también los que pasan del tope.
 */
export async function listarTramites(busqueda?: string | null): Promise<Tramite[]> {
  const supabase = await createClient()
  const filtros = filtrosDeBusqueda(
    ['numero', 'tipo', 'entidad', 'asunto', 'expediente', 'placa', 'codigo_interno', 'cliente', 'orden_numero'],
    busqueda,
  )
  const consulta = () => {
    let c = supabase.rpc('tramites_visibles', { p_id: null }).select(SELECT)
    for (const filtro of filtros) c = c.or(filtro)
    return c
  }
  // Lo abierto se lee entero: con el tope, un trámite viejo sin cerrar salía de
  // la lista sin que nadie lo terminara. El tope es para lo concluido y lo anulado.
  const [vivos, concluidos, anulados] = await Promise.all([
    // Por la situación y no por el estado: el concluido que espera el visto de
    // Gerencia para anularse es «Por anular», y tiene que salir aunque haya más
    // concluidos que el tope.
    consulta().not('situacion', 'in', '(ANULADO,CONCLUIDO)').order('creado_en', { ascending: false }).range(0, MAXIMO_VIVOS - 1),
    // Los que se cerraron último, que es como los ordena su vista.
    consulta().eq('situacion', 'CONCLUIDO').order('concluido_en', { ascending: false }).range(0, MAXIMO_CONCLUIDOS - 1),
    consulta().eq('situacion', 'ANULADO').order('creado_en', { ascending: false }).range(0, MAXIMO_ANULADOS - 1),
  ])
  const error = vivos.error ?? concluidos.error ?? anulados.error
  if (error) throw new Error(`No se pudieron leer los trámites: ${error.message}`)
  return ([...(vivos.data ?? []), ...(concluidos.data ?? []), ...(anulados.data ?? [])] as Fila[])
    .flatMap((f) => aTramite(f) ?? [])
    .sort((x, y) => y.creado_en.localeCompare(x.creado_en))
}

/** Un trámite. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarTramite(id: string): Promise<Tramite | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('tramites_visibles', { p_id: id }).select(SELECT)
  if (error) throw new Error(`No se pudo leer el trámite: ${error.message}`)
  return ((data ?? []) as Fila[]).flatMap((f) => aTramite(f) ?? [])[0] ?? null
}

export type ArchivoDelTramite = {
  id: string
  /** `CLASE_DE_ARCHIVO`: el cargo, un recibo, otro documento o el documento final. */
  clase: string
  descripcion: string | null
  nombre: string | null
  mime: string
  tamano: number
  subido_en: string
  subio: string
  retirado_en: string | null
  retiro: string | null
  retiro_motivo: string | null
  puede_retirar: boolean
}

/**
 * Los archivos del expediente de un trámite, del más reciente al más viejo,
 * como los ve quien pregunta (`tramites_archivos`): los retirados, solo quien
 * ve todos los trámites.
 */
export async function archivosDelTramite(id: string): Promise<ArchivoDelTramite[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('tramites_archivos', { p_tramite: id })
    .select('id, clase, descripcion, nombre, mime, tamano, subido_en, subio, retirado_en, retiro, retiro_motivo, puede_retirar')
  if (error) throw new Error(`No se pudo leer el expediente del trámite: ${error.message}`)
  return (data ?? []).flatMap((a) =>
    a.id && a.clase && a.subido_en
      ? [
          {
            id: a.id,
            clase: a.clase,
            descripcion: a.descripcion,
            nombre: a.nombre,
            mime: a.mime ?? '',
            tamano: a.tamano ?? 0,
            subido_en: a.subido_en,
            subio: a.subio ?? '',
            retirado_en: a.retirado_en,
            retiro: a.retiro,
            retiro_motivo: a.retiro_motivo,
            puede_retirar: a.puede_retirar === true,
          },
        ]
      : [],
  )
}

export type GestionDelTramite = { id: string; fecha: string; detalle: string; anotado_en: string; anoto: string }

/** Las gestiones anotadas de un trámite, de la más reciente a la más vieja (`tramites_gestiones`). */
export async function gestionesDelTramite(id: string): Promise<GestionDelTramite[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('tramites_gestiones', { p_tramite: id }).select('id, fecha, detalle, anotado_en, anoto')
  if (error) throw new Error(`No se pudieron leer las gestiones del trámite: ${error.message}`)
  return (data ?? []).flatMap((g) =>
    g.id && g.fecha && g.detalle && g.anotado_en ? [{ id: g.id, fecha: g.fecha, detalle: g.detalle, anotado_en: g.anotado_en, anoto: g.anoto ?? '' }] : [],
  )
}

export type TipoDeTramite = {
  id: string
  nombre: string
  entidad: string
  ambito: string
  se_renueva: boolean
  dias_aviso: number[]
  activo: boolean
  /** Si se abre solo al terminar la OT de la unidad, a cuántos días hábiles del término. */
  dias_desde_termino_ot: number | null
  /** Con lo anterior: solo si la unidad todavía no tiene placa. */
  solo_sin_placa: boolean
}

/**
 * El catálogo de tipos de trámite, por ámbito y por nombre. La política decide
 * qué lee quien pregunta: Ventas, solo los de una unidad.
 */
export async function tiposDeTramite(): Promise<TipoDeTramite[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tramite_tipos')
    .select('id, nombre, entidad, ambito, se_renueva, dias_aviso, activo, dias_desde_termino_ot, solo_sin_placa')
    .order('ambito', { ascending: false })
    .order('nombre')
  if (error) throw new Error(`No se pudo leer el catálogo de tipos de trámite: ${error.message}`)
  return (data ?? []).map((t) => ({ ...t, dias_aviso: t.dias_aviso ?? [] }))
}

export type OtDeLaUnidad = { id: string; numero: string; estado: string }

export type UnidadParaTramitar = {
  id: string
  placa: string | null
  codigo_interno: string | null
  carroceria: string | null
  marca: string | null
  cliente: string | null
  /** Las OT de la unidad que no están anuladas, la más reciente primero. */
  ordenes: OtDeLaUnidad[]
}

function aOrdenes(valor: unknown): OtDeLaUnidad[] {
  if (!Array.isArray(valor)) return []
  return valor.flatMap((o) => {
    if (!o || typeof o !== 'object') return []
    const { id, numero, estado } = o as Record<string, unknown>
    return typeof id === 'string' && typeof numero === 'string' ? [{ id, numero, estado: typeof estado === 'string' ? estado : '' }] : []
  })
}

/** Las unidades de los clientes con sus OT, para elegir de cuál es el trámite. Las lee quien registra (`tramites.gestionar`). */
export async function unidadesParaTramitar(): Promise<UnidadParaTramitar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('tramites_unidades_para_elegir').range(0, MAXIMO_UNIDADES_PARA_ELEGIR - 1)
  if (error) throw new Error(`No se pudo leer la lista de unidades: ${error.message}`)
  return (data ?? []).flatMap((u) =>
    u.id
      ? [
          {
            id: u.id,
            placa: u.placa,
            codigo_interno: u.codigo_interno,
            carroceria: u.carroceria,
            marca: u.marca,
            cliente: u.cliente,
            ordenes: aOrdenes(u.ordenes),
          },
        ]
      : [],
  )
}

export type TramiteDeLaOrden = {
  id: string
  numero: string
  tipo: string
  /** `ORIGEN_TRAMITE`: OT si lo abrió la OT al terminar. */
  origen: string
  estado: string
  situacion: string
  fecha_limite: string | null
  fecha_conclusion: string | null
  vencido: boolean
  /** Si quien mira puede abrir su ficha. */
  ve: boolean
  /** Si su tipo es de los que abre la OT (tarjeta y placas), venga de la OT o registrado a mano. */
  de_la_regla: boolean
}

/**
 * Los trámites sin anular de una OT, para quien ve la OT (`tramites_de_la_orden`):
 * en qué van, no su expediente. Si no se pueden leer, la OT se muestra igual,
 * sin ellos: la consulta se cae con el error, y quien llama decide.
 */
export async function tramitesDeLaOrden(ordenId: string): Promise<TramiteDeLaOrden[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc('tramites_de_la_orden', { p_orden: ordenId })
    .select('id, numero, tipo, origen, estado, situacion, fecha_limite, fecha_conclusion, vencido, ve, de_la_regla')
  if (error) throw new Error(`No se pudieron leer los trámites de la OT: ${error.message}`)
  return (data ?? []).flatMap((t) =>
    t.id && t.numero && t.estado
      ? [
          {
            id: t.id,
            numero: t.numero,
            tipo: t.tipo ?? '',
            origen: t.origen ?? 'MANUAL',
            estado: t.estado,
            situacion: t.situacion ?? t.estado,
            fecha_limite: t.fecha_limite,
            fecha_conclusion: t.fecha_conclusion,
            vencido: t.vencido === true,
            ve: t.ve === true,
            de_la_regla: t.de_la_regla === true,
          },
        ]
      : [],
  )
}
