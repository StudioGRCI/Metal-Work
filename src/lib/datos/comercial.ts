import 'server-only'

import { type PerfilSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import type { Enums, Tablas } from '@/types/database'

export type Cliente = Tablas<'clientes'>
export type Unidad = Tablas<'unidades'>

export const CLIENTES_POR_PAGINA = 25

export async function listarClientes(filtros: { busqueda?: string; pagina?: number } = {}) {
  const supabase = await createClient()
  const pagina = Math.max(1, filtros.pagina ?? 1)
  const desde = (pagina - 1) * CLIENTES_POR_PAGINA

  let consulta = supabase
    .from('clientes')
    .select('id, tipo_documento, numero_documento, razon_social, nombre_comercial, telefono, correo, distrito, provincia, activo, unidades(count), ordenes_trabajo(count)', { count: 'exact' })
    .eq('activo', true)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(`razon_social.ilike.%${t}%,nombre_comercial.ilike.%${t}%,numero_documento.ilike.%${t}%`)
  }

  const { data, error, count } = await consulta
    .order('razon_social')
    .range(desde, desde + CLIENTES_POR_PAGINA - 1)

  if (error) throw new Error(`No se pudieron listar los clientes: ${error.message}`)

  return {
    clientes: data ?? [],
    total: count ?? 0,
    pagina,
    paginas: Math.max(1, Math.ceil((count ?? 0) / CLIENTES_POR_PAGINA)),
  }
}

export async function obtenerCliente(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('clientes')
    .select('*, vendedor:usuarios!clientes_vendedor_id_fkey(id, nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar el cliente: ${error.message}`)
  return data
}

export async function listarUnidades(filtros: { clienteId?: string; busqueda?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('unidades')
    .select('id, placa, tipo_vehiculo, marca, modelo, anio, numero_chasis, capacidad_m3, capacidad_toneladas, activo, cliente:clientes!inner(id, razon_social), tipo_carroceria:tipos_carroceria(nombre)')
    .eq('activo', true)

  if (filtros.clienteId) consulta = consulta.eq('cliente_id', filtros.clienteId)

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')
    consulta = consulta.or(`placa.ilike.%${t}%,marca.ilike.%${t}%,modelo.ilike.%${t}%,numero_chasis.ilike.%${t}%`)
  }

  const { data, error } = await consulta.order('placa').limit(300)
  if (error) throw new Error(`No se pudieron listar las unidades: ${error.message}`)

  return data ?? []
}

export async function contactosDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('contactos_cliente')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('es_principal', { ascending: false })

  return data ?? []
}

export async function ordenesDeCliente(clienteId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('ot_resumen')
    .select('id, numero, estado, descripcion, placa, avance_porcentaje, fecha_registro')
    .eq('cliente_id', clienteId)
    .order('fecha_registro', { ascending: false })
    .limit(50)

  return data ?? []
}

// ---------------------------------------------------------------- cotizaciones

export type EstadoCotizacion = Enums<'estado_cotizacion'>

/**
 * La bandeja de cada mano del circuito: qué estados le toca mover a quien tiene
 * ese permiso. OBSERVADA aparece dos veces a propósito —una cotización devuelta
 * la retoma Ventas o Administración, según qué haya pedido corregir Gerencia—.
 */
const BANDEJA_POR_PERMISO: Record<string, readonly EstadoCotizacion[]> = {
  'cotizaciones.editar': ['BORRADOR', 'OBSERVADA'],
  'cotizaciones.costear': ['EN_COSTEO', 'OBSERVADA'],
  'cotizaciones.revisar': ['EN_REVISION'],
}

/**
 * Los estados que le toca mover a quien está mirando. Vacío si no tiene ninguna
 * de las tres manos: a ese «me toca a mí» no le devolvería nada y la pantalla
 * ni siquiera le ofrece la pastilla.
 *
 * ADMIN pasa por `puede()` sin tener permisos y se lleva las tres bandejas
 * juntas: su «me toca» es el circuito entero. Está bien —no hay trabajo suyo
 * que separar— pero probar esta bandeja como ADMIN no prueba nada; hay que
 * entrar con el rol que hace ese trabajo.
 */

/**
 * La bandeja de Administración: lo que Ventas ya cotizó y espera su detalle.
 *
 * Va aparte de listarCotizaciones porque no es la misma pregunta. La de venta
 * responde «cómo va lo que ofrecimos»; esta responde «qué me toca armar», y
 * para eso necesita dos números que la otra no trae: el precio que se prometió
 * y el costo que llevan sumadas las partidas. Ordena por lo que lleva más
 * tiempo esperando, que es el orden en el que hay que atenderlas.
 */
export async function listarCotizacionesDeTrabajo(filtros: { estado?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('cotizaciones')
    .select('id, numero, fecha_emision, estado, moneda, precio_venta, costo_estimado, costeo_pedido_en, costeo_listo_en, motivo_observacion, cliente:clientes!inner(razon_social), unidad:unidades!cotizaciones_unidad_id_fkey(placa, codigo_interno, numero_chasis, marca, modelo), tipo_carroceria:tipos_carroceria(nombre)')

  if (filtros.estado) {
    consulta = consulta.eq('estado', filtros.estado as EstadoCotizacion)
  } else {
    // Por defecto, el trabajo del área: lo que espera costeo, lo que Gerencia
    // devolvió, lo que ya subió a revisión —para poder seguirlo sin buscarlo— y
    // lo que Gerencia ya aprobó, porque la empresa pidió que el visto «les salga
    // a ambos»: es lo que le dice a Administración que su trabajo pasó.
    consulta = consulta.in('estado', ['EN_COSTEO', 'OBSERVADA', 'EN_REVISION', 'REVISADA'])
  }

  const { data, error } = await consulta
    .order('costeo_pedido_en', { ascending: true, nullsFirst: false })
    .order('numero', { ascending: false })
    .limit(200)

  if (error) {
    throw new Error(`No se pudieron listar las cotizaciones de trabajo: ${error.message}`)
  }
  return data ?? []
}

export function estadosQueMeTocan(perfil: PerfilSesion | null): EstadoCotizacion[] {
  const estados = new Set<EstadoCotizacion>()
  for (const [permiso, suyos] of Object.entries(BANDEJA_POR_PERMISO)) {
    if (puede(perfil, permiso)) for (const estado of suyos) estados.add(estado)
  }
  return [...estados]
}

export async function listarCotizaciones(
  filtros: {
    estado?: string
    busqueda?: string
    /** Solo las que le toca mover a `perfil`, según su permiso. */
    meToca?: boolean
    perfil?: PerfilSesion | null
  } = {},
) {
  const supabase = await createClient()

  // Los tres sellos del circuito viajan con la fila: sin ellos la lista no
  // puede decir cuánto lleva parada una cotización en la etapa donde está.
  let consulta = supabase
    .from('cotizaciones')
    .select('id, numero, fecha_emision, fecha_vencimiento, estado, moneda, total, costeo_pedido_en, costeo_listo_en, revisada_en, cliente:clientes!inner(razon_social), unidad:unidades!cotizaciones_unidad_id_fkey(placa, codigo_interno, numero_chasis, marca, modelo), tipo_carroceria:tipos_carroceria(nombre)')

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado as EstadoCotizacion)

  if (filtros.meToca) {
    const mios = estadosQueMeTocan(filtros.perfil ?? null)
    // A quien no tiene ninguna de las tres manos no le toca nada. Se corta acá:
    // un `in` con la lista vacía no devuelve «ninguna», es una consulta rota.
    if (mios.length === 0) return []
    consulta = consulta.in('estado', mios)
  }

  if (filtros.busqueda?.trim()) {
    const t = filtros.busqueda.trim().replace(/[%,()]/g, '')

    // El número es columna de la cotización, pero la razón social y la placa
    // viven en otras tablas, y un `or` de PostgREST no mezcla una columna propia
    // con las de un embebido: lo escrito así se buscaría en una columna que no
    // existe. Se resuelven primero los ids que coinciden —los uuid no llevan
    // comas ni paréntesis, así que entran limpios en el `in`— y la cotización se
    // busca por su llave, como haría un `join`.
    const [clientes, unidades] = await Promise.all([
      supabase.from('clientes').select('id').ilike('razon_social', `%${t}%`).limit(200),
      supabase
        .from('unidades')
        .select('id')
        .or(`placa.ilike.%${t}%,codigo_interno.ilike.%${t}%,numero_chasis.ilike.%${t}%`)
        .limit(200),
    ])

    const condiciones = [`numero.ilike.%${t}%`]
    const idsCliente = (clientes.data ?? []).map((c) => c.id)
    const idsUnidad = (unidades.data ?? []).map((u) => u.id)
    if (idsCliente.length > 0) condiciones.push(`cliente_id.in.(${idsCliente.join(',')})`)
    if (idsUnidad.length > 0) condiciones.push(`unidad_id.in.(${idsUnidad.join(',')})`)

    consulta = consulta.or(condiciones.join(','))
  }

  const { data, error } = await consulta
    .order('fecha_emision', { ascending: false })
    .order('numero', { ascending: false })
    .limit(200)

  if (error) throw new Error(`No se pudieron listar las cotizaciones: ${error.message}`)
  return data ?? []
}

export async function obtenerCotizacion(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizaciones')
    .select('*, cliente:clientes!inner(id, razon_social, numero_documento), unidad:unidades!cotizaciones_unidad_id_fkey(id, placa, marca, modelo, codigo_interno, numero_chasis), tipo_carroceria:tipos_carroceria(id, nombre), vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombres, apellidos), anulador:usuarios!cotizaciones_anulada_por_fkey(nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar la cotización: ${error.message}`)
  return data
}

export async function partidasDeCotizacion(cotizacionId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizacion_partidas')
    .select('*')
    .eq('cotizacion_id', cotizacionId)
    .order('orden_secuencia')

  if (error) throw new Error(`No se pudieron cargar las partidas: ${error.message}`)
  return data ?? []
}

export type ResumenComercial = {
  /** Las que este perfil tiene que mover ahora. */
  meTocan: number
  /** Enviadas al cliente y todavía sin respuesta. */
  esperandoCliente: number
  /** Las que Gerencia ya aprobó y siguen sin salir. */
  listasParaEnviar: number
  /** Del mes en curso, pasado a soles con el cambio que cada una congeló. */
  ofrecidoDelMes: number
  cerradoDelMes: number
  cotizadasDelMes: number
  cerradasDelMes: number
}

/**
 * Las cifras de ventas del tablero.
 *
 * Todo en soles, convertido con el tipo de cambio que **cada cotización
 * congeló**: sumar dólares y soles en la misma cifra es sumar peras y manzanas,
 * y convertir todo con el cambio de hoy reescribiría el mes cada mañana. Para
 * eso está esa columna.
 *
 * Se lee de una sola consulta y se cuenta en memoria. Son decenas de filas al
 * mes, no millones: cinco consultas de agregación costarían más que traerlas.
 */
export async function resumenComercial(perfil: PerfilSesion | null): Promise<ResumenComercial> {
  const supabase = await createClient()

  const hoy = new Date()
  const desdeMes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`

  const { data, error } = await supabase
    .from('cotizaciones')
    .select('estado, total, tipo_cambio, fecha_emision')
    .neq('estado', 'ANULADA')
    .limit(1000)

  if (error) throw new Error(`No se pudo resumir lo comercial: ${error.message}`)

  const filas = data ?? []
  const mios = new Set(estadosQueMeTocan(perfil))
  const enSoles = (f: { total: number | null; tipo_cambio: number | null }) =>
    Number(f.total ?? 0) * (Number(f.tipo_cambio) || 1)

  const delMes = filas.filter((f) => (f.fecha_emision ?? '') >= desdeMes)

  return {
    meTocan: filas.filter((f) => mios.has(f.estado as EstadoCotizacion)).length,
    esperandoCliente: filas.filter((f) => f.estado === 'ENVIADA').length,
    listasParaEnviar: filas.filter((f) => f.estado === 'REVISADA').length,
    cotizadasDelMes: delMes.length,
    ofrecidoDelMes: delMes.reduce((s, f) => s + enSoles(f), 0),
    cerradasDelMes: delMes.filter((f) => f.estado === 'APROBADA').length,
    cerradoDelMes: delMes
      .filter((f) => f.estado === 'APROBADA')
      .reduce((s, f) => s + enSoles(f), 0),
  }
}
