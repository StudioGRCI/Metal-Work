import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type OrdenDeServicio = {
  id: string
  numero: string
  orden_id: string | null
  orden_numero: string | null
  cliente: string | null
  placa: string | null
  proveedor_id: string
  proveedor: string
  tipo_servicio: string
  descripcion: string
  especificacion: string | null
  estado: string
  fecha: string
  fecha_entrega: string | null
  plazo_dias: number | null
  fecha_conformidad: string | null
  moneda: string
  monto: number
  monto_base: number | null
  numero_factura: string | null
  fecha_factura: string | null
  atrasada: boolean
  etapa: string | null
}

/** Las órdenes de servicio, de la más reciente a la más vieja. */
export async function listarOrdenesDeServicio(
  filtros: { estado?: string; busqueda?: string; ordenId?: string } = {},
) {
  const supabase = await createClient()

  let consulta = supabase
    .from('os_resumen')
    .select('*')
    .order('fecha', { ascending: false })
    .order('numero', { ascending: false })
    .limit(300)

  if (filtros.estado && filtros.estado !== 'todas') {
    if (filtros.estado === 'abiertas') {
      consulta = consulta.in('estado', ['SOLICITADO', 'EN_EJECUCION', 'EJECUTADO'])
    } else {
      consulta = consulta.eq('estado', filtros.estado as 'SOLICITADO')
    }
  }

  if (filtros.ordenId) consulta = consulta.eq('orden_id', filtros.ordenId)

  const t = filtros.busqueda?.trim()
  if (t) {
    consulta = consulta.or(
      `numero.ilike.%${t}%,proveedor.ilike.%${t}%,descripcion.ilike.%${t}%,orden_numero.ilike.%${t}%`,
    )
  }

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron listar las órdenes de servicio: ${error.message}`)

  return (data ?? []) as unknown as OrdenDeServicio[]
}

/** Lo que necesita el formulario para crear una orden de servicio. */
export async function catalogosDeServicio() {
  const supabase = await createClient()

  const [proveedores, ordenes] = await Promise.all([
    supabase
      .from('proveedores')
      .select('id, razon_social, numero_documento')
      .eq('activo', true)
      .order('razon_social')
      .limit(500),
    supabase
      .from('ot_resumen')
      .select('id, numero, cliente, unidad_id, placa')
      .in('estado', ['PROGRAMADA', 'EN_PROCESO', 'PAUSADA', 'CONTROL_CALIDAD', 'TERMINADA'])
      .order('numero', { ascending: false })
      .limit(200),
  ])

  const fallo = proveedores.error ?? ordenes.error
  if (fallo) throw new Error(`No se pudieron cargar los catálogos: ${fallo.message}`)

  // La vista trae las columnas como opcionales porque nace de varios join; acá
  // ya sabemos que la orden existe, así que se descarta lo que venga sin id.
  const listaOrdenes = (ordenes.data ?? [])
    .filter((o): o is typeof o & { id: string; numero: string } => !!o.id && !!o.numero)
    .map((o) => ({
      id: o.id,
      numero: o.numero,
      cliente: o.cliente,
      // La unidad viaja aparte, y en null cuando la OT no tiene ninguna: así el
      // desplegable la nombra con `nombreDeUnidad` y no confunde «sin unidad» con
      // «unidad que todavía no tiene placa». `ot_resumen` hoy solo expone la
      // placa; cuando exponga también codigo_interno, numero_chasis, marca y
      // modelo se suman aquí y el nombre cae solo.
      unidad: o.unidad_id ? { placa: o.placa } : null,
    }))

  return { proveedores: proveedores.data ?? [], ordenes: listaOrdenes }
}

/** Cuánto se subcontrató y en qué estado está, para la cabecera del listado. */
export function resumirServicios(servicios: OrdenDeServicio[]) {
  const suma = (filtro: (s: OrdenDeServicio) => boolean) =>
    servicios.filter(filtro).reduce((total, s) => total + Number(s.monto_base ?? s.monto), 0)

  return {
    total: servicios.length,
    atrasadas: servicios.filter((s) => s.atrasada).length,
    comprometido: suma((s) => ['SOLICITADO', 'EN_EJECUCION'].includes(s.estado)),
    porConformar: servicios.filter((s) => s.estado === 'EJECUTADO').length,
    recibido: suma((s) => ['EJECUTADO', 'CONFORME', 'PAGADO'].includes(s.estado)),
  }
}
