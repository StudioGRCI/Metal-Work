import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Enums } from '@/types/database'

export type EstadoParte = Enums<'estado_parte_diario'>

export async function listarPartes(filtros: { estado?: string; sede?: string } = {}) {
  const supabase = await createClient()

  let consulta = supabase
    .from('partes_diarios')
    .select('id, numero, fecha, estado, total_horas, total_horas_extra, observaciones, sede:sedes!inner(nombre), responsable:usuarios!partes_diarios_responsable_id_fkey(nombres, apellidos), detalle:parte_detalle(count)')

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado as EstadoParte)
  if (filtros.sede) consulta = consulta.eq('sede_id', filtros.sede)

  const { data, error } = await consulta.order('fecha', { ascending: false }).limit(120)
  if (error) throw new Error(`No se pudieron listar los partes: ${error.message}`)

  return data ?? []
}

export async function obtenerParte(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('partes_diarios')
    .select('*, sede:sedes!inner(id, nombre), responsable:usuarios!partes_diarios_responsable_id_fkey(nombres, apellidos), aprobador:usuarios!partes_diarios_aprobado_por_fkey(nombres, apellidos)')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar el parte: ${error.message}`)
  return data
}

export async function lineasDeParte(parteId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('parte_detalle')
    .select('id, horas, horas_extra, horas_totales, descripcion, orden_id, etapa_id, usuario_id, usuario:usuarios!inner(nombres, apellidos), orden:ordenes_trabajo!inner(numero, descripcion), etapa:ot_etapas!inner(catalogo:etapas_catalogo!inner(nombre))')
    .eq('parte_id', parteId)
    .order('creado_en')

  if (error) throw new Error(`No se pudieron cargar las horas del parte: ${error.message}`)
  return data ?? []
}

/** Operarios activos, órdenes abiertas y sedes: lo que necesita el formulario. */
export async function catalogosParte(sedeId?: string | null) {
  const supabase = await createClient()

  const [operarios, ordenes, sedes] = await Promise.all([
    supabase
      .from('usuarios')
      .select('id, nombres, apellidos, costo_hora')
      .eq('activo', true)
      .eq('es_operario', true)
      .order('apellidos'),
    supabase
      .from('ot_resumen')
      .select('id, numero, descripcion, cliente, placa, sede_id')
      .in('estado', ['APROBADA', 'PROGRAMADA', 'EN_PROCESO', 'CONTROL_CALIDAD'])
      .order('numero'),
    supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre'),
  ])

  return {
    operarios: operarios.data ?? [],
    // Solo tiene sentido imputar horas a órdenes del mismo taller. Postgres no
    // declara NOT NULL en las columnas de una vista, así que se descartan las
    // filas incompletas y se devuelve una forma ya limpia para la interfaz.
    ordenes: (ordenes.data ?? [])
      .filter((o) => o.id && o.numero && (!sedeId || o.sede_id === sedeId))
      .map((o) => ({
        id: o.id as string,
        numero: o.numero as string,
        descripcion: o.descripcion ?? '',
        cliente: o.cliente,
        placa: o.placa,
      })),
    sedes: sedes.data ?? [],
  }
}

export async function etapasDeOrden(ordenId: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('ot_tablero_etapas')
    .select('etapa_id, etapa, estado, orden_secuencia')
    .eq('orden_id', ordenId)
    .order('orden_secuencia')

  return data ?? []
}
