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

export async function obtenerOrden(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ordenes_trabajo')
    .select(
      'id, numero, estado, prioridad, tipo_trabajo, descripcion, especificaciones_tecnicas, datos_tecnicos, fecha_registro, fecha_inicio_programada, fecha_fin_programada, fecha_entrega_comprometida, fecha_inicio_real, fecha_fin_real, avance_porcentaje, horas_estimadas, horas_reales, moneda, monto_presupuestado, motivo_pausa, motivo_anulacion, observaciones, creado_en, cliente:clientes!inner(id, razon_social, numero_documento, telefono, correo), unidad:unidades(id, placa, marca, modelo, anio, tipo_vehiculo, numero_chasis), sede:sedes!inner(id, nombre), tipo_carroceria:tipos_carroceria(id, nombre), responsable:usuarios!ordenes_trabajo_responsable_id_fkey(id, nombres, apellidos), supervisor:usuarios!ordenes_trabajo_supervisor_id_fkey(id, nombres, apellidos), cotizacion:cotizaciones(id, numero, total, moneda)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar la orden: ${error.message}`)
  return data
}

export async function listarEtapas(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_tablero_etapas')
    .select('*')
    .eq('orden_id', ordenId)
    .order('orden_secuencia')

  if (error) throw new Error(`No se pudieron cargar las etapas: ${error.message}`)
  return data ?? []
}

export async function listarInspecciones(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_inspecciones')
    .select(
      'id, numero, fecha, resultado, observaciones, acciones_correctivas, fecha_levantamiento, inspector:usuarios!ot_inspecciones_inspector_id_fkey(nombres, apellidos)',
    )
    .eq('orden_id', ordenId)
    .order('fecha', { ascending: false })

  if (error) throw new Error(`No se pudieron cargar las inspecciones: ${error.message}`)
  return data ?? []
}

export async function listarHorasOrden(ordenId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('parte_detalle')
    .select(
      'id, horas, horas_extra, horas_totales, descripcion, parte:partes_diarios!inner(numero, fecha, estado), usuario:usuarios!inner(nombres, apellidos), etapa:ot_etapas!inner(etapa_catalogo_id, catalogo:etapas_catalogo!inner(nombre))',
    )
    .eq('orden_id', ordenId)
    .order('id', { ascending: false })
    .limit(200)

  if (error) throw new Error(`No se pudieron cargar las horas: ${error.message}`)
  return data ?? []
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

/** Indicadores del tablero principal. */
export async function indicadoresTablero(sedeId?: string | null) {
  const supabase = await createClient()

  let consulta = supabase
    .from('ot_resumen')
    .select('id, estado, prioridad, dias_atraso, avance_porcentaje, monto_presupuestado')
  if (sedeId) consulta = consulta.eq('sede_id', sedeId)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron cargar los indicadores: ${error.message}`)

  const filas = data ?? []
  const abiertas = filas.filter((o) => ESTADOS_ABIERTOS.includes(o.estado as Enums<'estado_ot'>))

  return {
    abiertas: abiertas.length,
    enProceso: filas.filter((o) => o.estado === 'EN_PROCESO').length,
    pausadas: filas.filter((o) => o.estado === 'PAUSADA').length,
    atrasadas: abiertas.filter((o) => (o.dias_atraso ?? 0) > 0).length,
    urgentes: abiertas.filter((o) => o.prioridad === 'URGENTE').length,
    porEstado: Object.entries(
      filas.reduce<Record<string, number>>((acc, o) => {
        const clave = o.estado ?? 'SIN_ESTADO'
        acc[clave] = (acc[clave] ?? 0) + 1
        return acc
      }, {}),
    ).map(([estado, cantidad]) => ({ estado, cantidad })),
  }
}
