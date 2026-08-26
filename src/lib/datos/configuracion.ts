import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type Feriado = {
  fecha: string
  nombre: string
  ambito: string
  laborable: boolean
  observacion: string | null
}

/** El calendario laboral: qué días hay taller y qué fechas no. */
export async function calendarioLaboral(anio: number) {
  const supabase = await createClient()

  const [empresa, feriados] = await Promise.all([
    supabase.from('empresa').select('dias_laborables').limit(1).maybeSingle(),
    supabase
      .from('feriados')
      .select('fecha, nombre, ambito, laborable, observacion')
      .gte('fecha', `${anio}-01-01`)
      .lte('fecha', `${anio}-12-31`)
      .order('fecha'),
  ])

  if (empresa.error) throw new Error(`No se pudo leer la empresa: ${empresa.error.message}`)
  if (feriados.error) throw new Error(`No se pudieron leer los feriados: ${feriados.error.message}`)

  return {
    diasLaborables: (empresa.data?.dias_laborables ?? [1, 2, 3, 4, 5, 6]) as number[],
    feriados: (feriados.data ?? []) as unknown as Feriado[],
  }
}

/** Los catálogos que gobiernan el taller, para tenerlos a la vista. */
export async function catalogosDelTaller() {
  const supabase = await createClient()

  const [carrocerias, etapas, fichas, verificaciones] = await Promise.all([
    supabase
      .from('tipos_carroceria')
      .select('id, codigo, nombre, horas_hombre_estandar, activo')
      .order('orden_secuencia'),
    supabase
      .from('etapas_catalogo')
      .select('id, codigo, nombre, orden_secuencia, horas_estandar, requiere_inspeccion, activo')
      .eq('activo', true)
      .order('orden_secuencia'),
    supabase.from('plantillas_ficha').select('id, nombre, activa, tipo:tipos_carroceria(nombre)').order('nombre'),
    supabase
      .from('plantillas_verificacion')
      .select('tipo_carroceria_id, tipo:tipos_carroceria(nombre)')
      .order('numero'),
  ])

  const primero = [carrocerias, etapas, fichas, verificaciones].find((r) => r.error)
  if (primero?.error) throw new Error(`No se pudieron leer los catálogos: ${primero.error.message}`)

  // Los pasos de verificación se resumen por carrocería: cuántos tiene cada una.
  const porTipo = new Map<string, { nombre: string; pasos: number }>()
  for (const v of verificaciones.data ?? []) {
    const clave = (v.tipo_carroceria_id as string | null) ?? 'generica'
    const nombre = (v.tipo as unknown as { nombre: string } | null)?.nombre ?? 'Lista genérica'
    const actual = porTipo.get(clave) ?? { nombre, pasos: 0 }
    actual.pasos += 1
    porTipo.set(clave, actual)
  }

  return {
    carrocerias: carrocerias.data ?? [],
    etapas: etapas.data ?? [],
    fichas: (fichas.data ?? []).map((f) => ({
      id: f.id as string,
      nombre: f.nombre as string,
      activa: f.activa as boolean,
      carroceria: (f.tipo as unknown as { nombre: string } | null)?.nombre ?? null,
    })),
    verificaciones: [...porTipo.values()],
  }
}
