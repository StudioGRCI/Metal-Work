import 'server-only'

import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { createClient } from '@/lib/supabase/server'

/*
 * Los trámites (plan «El puesto de Tramitador», entrega 1, migración
 * 20261126997100). Todo se lee por `tramites_visibles`, que decide quién ve
 * —el Tramitador, Gerencia y Administración, todos; Ventas, solo los de una
 * unidad— y trae el tipo, la unidad, el cliente y la OT: quien ve el trámite no
 * siempre lee esas tablas. También dice qué puede hacer quien pregunta en cada
 * uno, con la misma regla que la función que escribe.
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
  registro: string
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
    registro: f.registro ?? '',
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
  }
}

/** Cuántos trámites vivos trae la lista como mucho: el tope de filas de la API. */
export const MAXIMO_VIVOS = 1000

/** Cuántos anulados trae la lista como mucho: los más recientes. Los vivos van todos. */
export const MAXIMO_ANULADOS = 200

const SELECT =
  'id, numero, estado, situacion, creado_en, actualizado_en, tipo_id, tipo, se_renueva, ambito, entidad, asunto, expediente, fecha_inicio, fecha_limite, dias_para_limite, vencido, nota, unidad_id, placa, codigo_interno, carroceria, cliente, orden_id, orden_numero, registro, registro_puesto, anulacion_pedida_en, anulacion_pidio, motivo_anulacion, anulacion_rechazada_en, anulacion_rechazo, anulacion_rechazo_motivo, anulado_en, anulo, puede_actualizar, puede_pedir_anulacion, puede_resolver_anulacion'

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
  // Lo vivo se lee entero: con el tope, un trámite viejo sin cerrar salía de la
  // lista sin que nadie lo terminara. El tope es para lo anulado.
  const [vivos, anulados] = await Promise.all([
    consulta().neq('estado', 'ANULADO').order('creado_en', { ascending: false }).range(0, MAXIMO_VIVOS - 1),
    consulta().eq('estado', 'ANULADO').order('creado_en', { ascending: false }).range(0, MAXIMO_ANULADOS - 1),
  ])
  const error = vivos.error ?? anulados.error
  if (error) throw new Error(`No se pudieron leer los trámites: ${error.message}`)
  return ([...(vivos.data ?? []), ...(anulados.data ?? [])] as Fila[])
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

export type TipoDeTramite = {
  id: string
  nombre: string
  entidad: string
  ambito: string
  se_renueva: boolean
  dias_aviso: number[]
  activo: boolean
}

/**
 * El catálogo de tipos de trámite, por ámbito y por nombre. La política decide
 * qué lee quien pregunta: Ventas, solo los de una unidad.
 */
export async function tiposDeTramite(): Promise<TipoDeTramite[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('tramite_tipos')
    .select('id, nombre, entidad, ambito, se_renueva, dias_aviso, activo')
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
  const { data, error } = await supabase.rpc('tramites_unidades_para_elegir')
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
