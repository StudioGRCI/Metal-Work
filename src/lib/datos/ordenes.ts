import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Enums, Vistas } from '@/types/database'

export type ResumenOrden = Vistas<'ot_resumen'>

export type EstadoOrden = Enums<'estado_ot'>
export type PrioridadOrden = Enums<'prioridad_ot'>

export type FiltrosOrdenes = {
  busqueda?: string
  /** Un estado concreto, o 'ABIERTAS' para todo lo que sigue en taller. */
  estado?: EstadoOrden | 'ABIERTAS'
  prioridad?: PrioridadOrden
  sede?: string
  responsable?: string
  atrasadas?: boolean
  pagina?: number
}

const ESTADOS_VALIDOS: EstadoOrden[] = [
  'BORRADOR', 'APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'PAUSADA',
  'CONTROL_CALIDAD', 'TERMINADA', 'ENTREGADA', 'FACTURADA', 'ANULADA',
]

const PRIORIDADES_VALIDAS: PrioridadOrden[] = ['BAJA', 'NORMAL', 'ALTA', 'URGENTE']

/** Convierte un parámetro de la URL en un estado válido, o lo descarta. */
export function comoEstado(valor: unknown): EstadoOrden | 'ABIERTAS' | undefined {
  if (valor === 'ABIERTAS') return 'ABIERTAS'
  return ESTADOS_VALIDOS.find((e) => e === valor)
}

export function comoPrioridad(valor: unknown): PrioridadOrden | undefined {
  return PRIORIDADES_VALIDAS.find((p) => p === valor)
}

export const ORDENES_POR_PAGINA = 25

/** Estados en los que la orden sigue viva en el taller. */
const ESTADOS_ABIERTOS: Enums<'estado_ot'>[] = [
  'APROBADA',
  'PROGRAMADA',
  'EN_PROCESO',
  'PAUSADA',
  'CONTROL_CALIDAD',
]

export async function listarOrdenes(filtros: FiltrosOrdenes) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * ORDENES_POR_PAGINA

  let consulta = supabase.from('ot_resumen').select('*', { count: 'exact' })

  if (filtros.estado === 'ABIERTAS') {
    consulta = consulta.in('estado', ESTADOS_ABIERTOS)
  } else if (filtros.estado) {
    consulta = consulta.eq('estado', filtros.estado)
  }

  if (filtros.prioridad) consulta = consulta.eq('prioridad', filtros.prioridad)
  if (filtros.sede) consulta = consulta.eq('sede_id', filtros.sede)
  if (filtros.responsable) consulta = consulta.eq('responsable_id', filtros.responsable)
  if (filtros.atrasadas) consulta = consulta.gt('dias_atraso', 0)

  if (filtros.busqueda?.trim()) {
    // Busca por número de OT, cliente, placa o descripción del trabajo.
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(
      `numero.ilike.%${t}%,cliente.ilike.%${t}%,placa.ilike.%${t}%,descripcion.ilike.%${t}%`,
    )
  }

  const { data, error, count } = await consulta
    .order('fecha_registro', { ascending: false })
    .order('numero', { ascending: false })
    .range(desde, desde + ORDENES_POR_PAGINA - 1)

  if (error) throw new Error(`No se pudieron listar las órdenes: ${error.message}`)

  return {
    ordenes: data ?? [],
    total: count ?? 0,
    pagina,
    paginas: Math.max(1, Math.ceil((count ?? 0) / ORDENES_POR_PAGINA)),
  }
}

/**
 * Una orden con todo lo que la pantalla necesita.
 *
 * El cliente va con join normal y NO con `!inner`, y es la diferencia entre que
 * el taller pueda abrir una orden o no: con `!inner`, a quien no tiene
 * `clientes.ver` -operarios, supervisor, calidad, almacén, compras- el RLS le
 * esconde la fila del cliente y con ella desaparecía la orden entera. La
 * pantalla respondía «404, la dirección no existe» a seis personas que sí
 * tienen permiso para verla. Ahora la orden se abre y lo que no se ve es el
 * nombre del cliente, que es exactamente lo que el permiso dice.
 */
export async function obtenerOrden(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .select(
      'id, numero, estado, prioridad, tipo_trabajo, descripcion, especificaciones_tecnicas, datos_tecnicos, fecha_registro, fecha_inicio_programada, fecha_fin_programada, fecha_entrega_comprometida, fecha_inicio_real, fecha_fin_real, avance_porcentaje, horas_estimadas, horas_reales, moneda, monto_presupuestado, motivo_pausa, motivo_anulacion, observaciones, creado_en, largo_m, ancho_m, alto_m, capacidad_carga, ruedas, tipo_llantas, cantidad_ejes, tipo_suspension, colores, caracteristicas_especiales, correo_contacto, encargado_produccion_id, cliente:clientes(id, razon_social, numero_documento, telefono, correo), unidad:unidades(id, placa, marca, modelo, anio, tipo_vehiculo, numero_chasis, codigo_interno), sede:sedes!inner(id, nombre), tipo_carroceria:tipos_carroceria(id, nombre), responsable:usuarios!ordenes_trabajo_responsable_id_fkey(id, nombres, apellidos), supervisor:usuarios!ordenes_trabajo_supervisor_id_fkey(id, nombres, apellidos), cotizacion:cotizaciones(id, numero, total, moneda)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar la orden: ${error.message}`)
  return data
}

export async function listarEtapas(ordenId: string) {
  const supabase = await createClient()

  // Las observaciones no están en el tablero -que es una vista de avance- pero
  // el formulario las edita. Sin traerlas, el campo salía vacío y al guardar
  // pisaba lo anotado. Se piden aparte y se juntan por identificador de etapa.
  const [tablero, notas] = await Promise.all([
    supabase
      .from('ot_tablero_etapas')
      .select('*')
      .eq('orden_id', ordenId)
      .order('orden_secuencia'),
    supabase
      .from('ot_etapas')
      .select('id, observaciones')
      .eq('orden_id', ordenId),
  ])

  if (tablero.error) throw new Error(`No se pudieron cargar las etapas: ${tablero.error.message}`)

  const porEtapa = new Map((notas.data ?? []).map((n) => [n.id, n.observaciones]))
  return (tablero.data ?? []).map((e) => ({
    ...e,
    observaciones: e.etapa_id ? (porEtapa.get(e.etapa_id) ?? null) : null,
  }))
}

/** Catálogos que necesitan los formularios de alta y edición. */
export async function catalogosOrden() {
  const supabase = await createClient()

  const [clientes, sedes, tipos, responsables] = await Promise.all([
    supabase.from('clientes').select('id, razon_social, numero_documento').eq('activo', true).order('razon_social').limit(500),
    supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
    supabase.from('tipos_carroceria').select('id, nombre').eq('activo', true).order('orden_secuencia'),
    supabase.from('usuarios').select('id, nombres, apellidos').eq('activo', true).eq('es_operario', false).order('apellidos'),
  ])

  return {
    clientes: clientes.data ?? [],
    sedes: sedes.data ?? [],
    tiposCarroceria: tipos.data ?? [],
    responsables: responsables.data ?? [],
  }
}

export async function unidadesDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('unidades')
    .select('id, placa, marca, modelo')
    .eq('cliente_id', clienteId)
    .eq('activo', true)
    .order('placa')

  return data ?? []
}

/**
 * Indicadores del tablero principal.
 *
 * Los cuenta la base. Antes se traían todas las órdenes y se contaban en el
 * servidor, y eso tiene fecha de caducidad: PostgREST corta la respuesta en mil
 * filas sin dar error, así que a partir de mil órdenes el tablero habría
 * seguido diciendo «de 1000 registradas» para siempre.
 */
export async function indicadoresTablero(sedeId?: string | null) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc('indicadores_tablero', { p_sede_id: sedeId ?? undefined })
    .single()
  if (error) throw new Error(`No se pudieron cargar los indicadores: ${error.message}`)

  const porEstado = (data.por_estado ?? {}) as Record<string, number>
  return {
    abiertas: data.abiertas ?? 0,
    enProceso: data.en_proceso ?? 0,
    pausadas: data.pausadas ?? 0,
    atrasadas: data.atrasadas ?? 0,
    urgentes: data.urgentes ?? 0,
    total: data.total ?? 0,
    porEstado: Object.entries(porEstado).map(([estado, cantidad]) => ({
      estado,
      cantidad: Number(cantidad),
    })),
  }
}

/**
 * Las órdenes abiertas más atrasadas, para la tarjeta «Requieren atención».
 *
 * Se ordena por fecha comprometida ascendente, que es lo mismo que por días de
 * atraso descendente. Antes esta lista salía de las órdenes más RECIENTES, así
 * que una orden vieja y muy atrasada no aparecía y la tarjeta llegaba a decir
 * «ninguna orden atrasada» mientras el indicador de arriba contaba varias.
 */
export async function ordenesAtrasadas(limite = 6) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_resumen')
    .select('id, numero, cliente, placa, unidad_id, codigo_interno, marca, modelo, dias_atraso, fecha_entrega_comprometida')
    .in('estado', ESTADOS_ABIERTOS)
    .gt('dias_atraso', 0)
    .order('fecha_entrega_comprometida', { ascending: true })
    .order('numero')
    .limit(limite)

  if (error) throw new Error(`No se pudieron cargar las órdenes atrasadas: ${error.message}`)
  return data ?? []
}

/** Las fechas límite que las reglas de plazo de la empresa le imponen a la orden. */
export async function fechasClaveDeOrden(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_fechas_clave')
    .select(
      'limite_os_produccion, limite_diseno, limite_os_acabados, limite_certificados, limite_tarjeta_placas, primera_os, fecha_entrega',
    )
    .eq('orden_id', ordenId)
    .maybeSingle()

  if (error) throw new Error(`No se pudieron leer las fechas clave: ${error.message}`)
  return data as unknown as {
    limite_os_produccion: string | null
    limite_diseno: string | null
    limite_os_acabados: string | null
    limite_certificados: string | null
    limite_tarjeta_placas: string | null
    primera_os: string | null
    fecha_entrega: string | null
  } | null
}

/** Las tres compuertas de salida: papeles, tesorería y portería. */
export async function estadoDeSalida(ordenId: string) {
  const supabase = await createClient()

  const [liberacion, entrega] = await Promise.all([
    supabase
      .from('liberaciones_tesoreria')
      .select('liberado_en, observacion, liberador:usuarios!liberaciones_tesoreria_liberado_por_fkey(nombres, apellidos)')
      .eq('orden_id', ordenId)
      .maybeSingle(),
    supabase
      .from('ot_entregas')
      .select('id, fecha_entrega, salida_confirmada_en, confirmador:usuarios!ot_entregas_salida_confirmada_por_fkey(nombres, apellidos)')
      .eq('orden_id', ordenId)
      .maybeSingle(),
  ])

  if (liberacion.error) throw new Error(`No se pudo leer la liberación: ${liberacion.error.message}`)
  if (entrega.error) throw new Error(`No se pudo leer la entrega: ${entrega.error.message}`)

  return {
    liberacion: liberacion.data as unknown as {
      liberado_en: string
      observacion: string | null
      liberador: { nombres: string; apellidos: string } | null
    } | null,
    entrega: entrega.data as unknown as {
      id: string
      fecha_entrega: string
      salida_confirmada_en: string | null
      confirmador: { nombres: string; apellidos: string } | null
    } | null,
  }
}

export type EventoTimeline = {
  clave: string
  ocurrido_en: string
  categoria: string
  titulo: string
  detalle: string | null
  usuario: string | null
}

/**
 * La trazabilidad de la orden: la bitácora de eventos, del más reciente al
 * más viejo, con el nombre de quien lo hizo.
 */
export async function timelineDeOrden(ordenId: string, limite = 200): Promise<EventoTimeline[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('v_ot_timeline')
    .select('*')
    .eq('orden_id', ordenId)
    .order('ocurrido_en', { ascending: false })
    .limit(limite)

  if (error) throw new Error(`No se pudo cargar la trazabilidad: ${error.message}`)

  const filas = data ?? []

  // La vista solo trae usuario_id; los nombres se resuelven en una sola consulta.
  const ids = [...new Set(filas.map((f) => f.usuario_id).filter(Boolean))] as string[]
  const nombres = new Map<string, string>()

  if (ids.length > 0) {
    const { data: usuarios } = await supabase
      .from('usuarios')
      .select('id, nombres, apellidos')
      .in('id', ids)

    for (const u of usuarios ?? []) nombres.set(u.id, `${u.nombres} ${u.apellidos}`)
  }

  return filas
    .filter((f) => f.ocurrido_en)
    .map((f, i) => ({
      // La vista es una unión sin clave propia; el índice basta para React.
      clave: `${f.referencia_tabla ?? 'evento'}-${f.referencia_id ?? i}-${i}`,
      ocurrido_en: f.ocurrido_en as string,
      categoria: f.categoria ?? 'EVENTO',
      titulo: f.titulo ?? '',
      detalle: f.detalle,
      usuario: f.usuario_id ? (nombres.get(f.usuario_id) ?? null) : null,
    }))
}
