import 'server-only'

import { filtrosDeBusqueda } from '@/lib/dominio/busqueda'
import { BUCKET_FOTOS_GARANTIAS } from '@/lib/dominio/garantias'
import { createClient } from '@/lib/supabase/server'

/*
 * Los reclamos de garantía (plan «Las demás áreas», A.2, migración
 * 20261126951000). Todo se lee por `garantias_reclamos_visibles`, que decide
 * quién ve (Ventas, Administración, Calidad, Gerencia y el área de Garantías)
 * y trae la unidad, el cliente y la OT: quien ve el reclamo no siempre lee esas
 * tablas. También dice qué puede hacer quien pregunta en cada uno, con la misma
 * regla que la función que escribe.
 */

export type ReclamoGarantia = {
  id: string
  numero: string
  estado: string
  /** En qué está y a quién espera, calculado en la base (`SITUACION_RECLAMO`). */
  situacion: string
  creado_en: string
  /** Los días que lleva abierto, contados en la base con la fecha de Lima; `null` si ya se cerró. */
  dias_en_espera: number | null
  descripcion: string
  trae: string | null
  contacto: string | null
  unidad_id: string
  placa: string | null
  codigo_interno: string | null
  carroceria: string | null
  cliente: string
  orden_id: string | null
  orden_numero: string | null
  orden_estado: string | null
  ot_enlazada_en: string | null
  enlazo: string | null
  no_procede_motivo: string | null
  causa: string | null
  causa_detalle: string | null
  cerrado_en: string | null
  cerro: string | null
  cerro_puesto: string | null
  registro: string
  registro_puesto: string | null
  fotos: number
  anulado_en: string | null
  anulo: string | null
  motivo_anulacion: string | null
  puede_enlazar: boolean
  puede_no_procede: boolean
  puede_causa: boolean
  puede_anular: boolean
}

type Fila = { [K in keyof ReclamoGarantia]: ReclamoGarantia[K] | null }

function aReclamo(f: Fila): ReclamoGarantia | null {
  if (!f.id || !f.numero || !f.estado || !f.situacion || !f.creado_en || !f.unidad_id) return null
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado,
    situacion: f.situacion,
    creado_en: f.creado_en,
    dias_en_espera: f.dias_en_espera,
    descripcion: f.descripcion ?? '',
    trae: f.trae,
    contacto: f.contacto,
    unidad_id: f.unidad_id,
    placa: f.placa,
    codigo_interno: f.codigo_interno,
    carroceria: f.carroceria,
    cliente: f.cliente ?? '',
    orden_id: f.orden_id,
    orden_numero: f.orden_numero,
    orden_estado: f.orden_estado,
    ot_enlazada_en: f.ot_enlazada_en,
    enlazo: f.enlazo,
    no_procede_motivo: f.no_procede_motivo,
    causa: f.causa,
    causa_detalle: f.causa_detalle,
    cerrado_en: f.cerrado_en,
    cerro: f.cerro,
    cerro_puesto: f.cerro_puesto,
    registro: f.registro ?? '',
    registro_puesto: f.registro_puesto,
    fotos: f.fotos ?? 0,
    anulado_en: f.anulado_en,
    anulo: f.anulo,
    motivo_anulacion: f.motivo_anulacion,
    puede_enlazar: f.puede_enlazar === true,
    puede_no_procede: f.puede_no_procede === true,
    puede_causa: f.puede_causa === true,
    puede_anular: f.puede_anular === true,
  }
}

/** Cuántos abiertos trae la lista como mucho: el tope de filas de la API. */
export const MAXIMO_ABIERTOS = 1000

/** Cuántos reclamos cerrados o anulados trae la lista como mucho: los más recientes. Los abiertos van todos. */
export const MAXIMO_RECLAMOS = 200

/** Los estados del reclamo que todavía esperan a alguien. */
const ESTADOS_ABIERTOS_RECLAMO = ['REGISTRADO', 'CON_OT'] as const

const SELECT = 'id, numero, estado, situacion, creado_en, dias_en_espera, descripcion, trae, contacto, unidad_id, placa, codigo_interno, carroceria, cliente, orden_id, orden_numero, orden_estado, ot_enlazada_en, enlazo, no_procede_motivo, causa, causa_detalle, cerrado_en, cerro, cerro_puesto, registro, registro_puesto, fotos, anulado_en, anulo, motivo_anulacion, puede_enlazar, puede_no_procede, puede_causa, puede_anular'

/**
 * Los reclamos que ve quien pregunta, del más reciente al más viejo: todos los
 * abiertos y los últimos cerrados o anulados. Con `busqueda`, los que la
 * llevan en su número, la placa, el código interno, el cliente, la OT o lo que
 * reclama: el filtro va en la base, así que encuentra también los que pasan del tope.
 */
export async function listarReclamos(busqueda?: string | null): Promise<ReclamoGarantia[]> {
  const supabase = await createClient()
  const filtros = filtrosDeBusqueda(['numero', 'placa', 'codigo_interno', 'cliente', 'orden_numero', 'descripcion'], busqueda)
  const consulta = () => {
    let c = supabase.rpc('garantias_reclamos_visibles', { p_id: null }).select(SELECT)
    for (const filtro of filtros) c = c.or(filtro)
    return c
  }
  // Lo que espera a alguien se lee entero: con el tope, un reclamo viejo sin
  // OT salía de la lista sin que nadie lo cerrara. El tope es para lo que ya quedó.
  const [abiertos, cerrados] = await Promise.all([
    consulta().in('estado', [...ESTADOS_ABIERTOS_RECLAMO]).order('creado_en', { ascending: false }).range(0, MAXIMO_ABIERTOS - 1),
    consulta()
      .not('estado', 'in', `(${ESTADOS_ABIERTOS_RECLAMO.join(',')})`)
      .order('creado_en', { ascending: false })
      .range(0, MAXIMO_RECLAMOS - 1),
  ])
  const error = abiertos.error ?? cerrados.error
  if (error) throw new Error(`No se pudieron leer los reclamos de garantía: ${error.message}`)
  return ([...(abiertos.data ?? []), ...(cerrados.data ?? [])] as Fila[])
    .flatMap((f) => aReclamo(f) ?? [])
    .sort((x, y) => y.creado_en.localeCompare(x.creado_en))
}

/** Una foto del reclamo, con su enlace firmado por una hora. */
export type FotoReclamo = { id: string; orden: number; enlace: string | null }

export type DetalleReclamo = ReclamoGarantia & { fotosDelReclamo: FotoReclamo[] }

/** Un reclamo con sus fotos. `null` si no existe o si quien mira no lo puede ver. */
export async function cargarReclamo(id: string): Promise<DetalleReclamo | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('garantias_reclamos_visibles', { p_id: id }).select(SELECT)
  if (error) throw new Error(`No se pudo leer el reclamo de garantía: ${error.message}`)
  const reclamo = ((data ?? []) as Fila[]).flatMap((f) => aReclamo(f) ?? [])[0]
  if (!reclamo) return null
  if (reclamo.fotos === 0) return { ...reclamo, fotosDelReclamo: [] }

  const { data: filas, error: errorFotos } = await supabase
    .from('garantia_reclamo_fotos')
    .select('id, orden, ruta')
    .eq('reclamo_id', id)
    .order('orden')
  if (errorFotos) throw new Error(`No se pudieron leer las fotos del reclamo: ${errorFotos.message}`)
  const fotos = filas ?? []
  const enlaces = await enlacesDeFotos(fotos.map((f) => f.ruta))
  return { ...reclamo, fotosDelReclamo: fotos.map((f) => ({ id: f.id, orden: f.orden, enlace: enlaces[f.ruta] ?? null })) }
}

/** Enlaces temporales para ver las fotos: el bucket es privado y la política decide quién. */
async function enlacesDeFotos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_FOTOS_GARANTIAS).createSignedUrls(rutas, 3600)
  // Sin enlaces la ficha igual sirve y lo dice en cada foto; el motivo queda en
  // el registro del servidor, no se traga.
  if (error || !data) {
    console.error('No se pudieron firmar las fotos del reclamo de garantía:', error?.message ?? 'sin respuesta')
    return {} as Record<string, string>
  }
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

export type UnidadParaReclamar = {
  id: string
  placa: string | null
  codigo_interno: string | null
  carroceria: string | null
  marca: string | null
  cliente: string
  /** El número del reclamo que la unidad ya tiene abierto, si tiene uno. */
  reclamo_abierto: string | null
}

/** Las unidades de los clientes, para elegir cuál vuelve. Las lee quien registra (`garantias.registrar`). */
export async function unidadesParaReclamar(): Promise<UnidadParaReclamar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('garantias_unidades_para_elegir')
  if (error) throw new Error(`No se pudo leer la lista de unidades: ${error.message}`)
  return (data ?? []).flatMap((u) =>
    u.id && u.cliente_id
      ? [
          {
            id: u.id,
            placa: u.placa,
            codigo_interno: u.codigo_interno,
            carroceria: u.carroceria,
            marca: u.marca,
            cliente: u.cliente ?? '',
            reclamo_abierto: u.reclamo_abierto,
          },
        ]
      : [],
  )
}

export type OtParaEnlazar = { id: string; numero: string; estado: string; creada: string | null }

/** Las OT de garantía de la unidad del reclamo que todavía no atienden otro: las lee Administración (`garantias.atender`). */
export async function otsParaEnlazar(reclamo: string): Promise<OtParaEnlazar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('garantias_ots_para_enlazar', { p_reclamo: reclamo })
  if (error) throw new Error(`No se pudieron leer las OT de garantía de la unidad: ${error.message}`)
  return (data ?? []).flatMap((o) => (o.orden && o.numero ? [{ id: o.orden, numero: o.numero, estado: o.estado ?? '', creada: o.creada }] : []))
}

/**
 * Lo que la OT nueva necesita del reclamo para nacer con él (`/ordenes/nueva?reclamo=`):
 * su cliente, su unidad y lo que reclama. `null` si no existe, si quien mira no
 * lo ve o si ya no espera su OT.
 */
export async function reclamoParaAbrirSuOt(id: string) {
  const reclamo = await cargarReclamo(id)
  if (!reclamo || !reclamo.puede_enlazar) return null
  const supabase = await createClient()
  const { data, error } = await supabase.from('garantia_reclamos').select('cliente_id').eq('id', id).maybeSingle()
  if (error) throw new Error(`No se pudo leer el cliente del reclamo: ${error.message}`)
  if (!data?.cliente_id) return null
  return { id: reclamo.id, numero: reclamo.numero, cliente_id: data.cliente_id, unidad_id: reclamo.unidad_id, descripcion: reclamo.descripcion }
}
