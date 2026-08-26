import 'server-only'

import { INFORMES, type Informe, informePorClave } from '@/lib/dominio/informes'
import { type PerfilSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

export type Fila = Record<string, unknown>

export type Resumen = {
  ordenes_abiertas: number
  ordenes_entregadas: number
  entregas_a_tiempo: number
  horas_taller: number
  unidades_atrasadas: number
  costo_periodo: number | null
  venta_periodo: number | null
  utilidad_periodo: number | null
}

/** Los informes que esta persona puede abrir. */
export function informesVisibles(perfil: PerfilSesion): Informe[] {
  return INFORMES.filter((i) => i.permisos.every((p) => puede(perfil, p)))
}

/** Corre un informe del catálogo. La base vuelve a comprobar los permisos. */
export async function correrInforme(clave: string, desde: string, hasta: string) {
  const informe = informePorClave(clave)
  if (!informe) throw new Error(`No existe el informe ${clave}`)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    informe.funcion as 'informe_produccion',
    { p_desde: desde, p_hasta: hasta },
  )

  if (error) throw new Error(`No se pudo calcular el informe: ${error.message}`)
  return (data ?? []) as unknown as Fila[]
}

/** Las cifras de portada del período. */
export async function resumenDelPeriodo(desde: string, hasta: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('informe_resumen', {
    p_desde: desde,
    p_hasta: hasta,
  })

  if (error) throw new Error(`No se pudo calcular el resumen: ${error.message}`)
  const fila = (data ?? [])[0]
  return (fila ?? null) as unknown as Resumen | null
}

/**
 * El período por defecto: el mes que corre. Se devuelve en AAAA-MM-DD, que es
 * lo que entiende tanto la base como el campo de fecha del navegador.
 */
export function periodoPorDefecto() {
  const hoy = new Date()
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  return { desde: aTexto(primero), hasta: aTexto(hoy) }
}

function aTexto(d: Date) {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** Acepta una fecha de la URL solo si tiene forma de fecha. */
export function comoFecha(valor: unknown, porDefecto: string) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : porDefecto
}
