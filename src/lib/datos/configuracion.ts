import 'server-only'

import { etiquetasDePuesto, puesto } from '@/lib/format'
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
      // Las medidas técnicas del catálogo que usa Diseño en la ficha de OT.
      .select(
        'id, codigo, nombre, horas_hombre_estandar, activo, modelo, tipo, largo_m, ancho_m, alto_m, capacidad, peso_neto_tn',
      )
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
  const porTipo = new Map<string, { id: string; nombre: string; pasos: number }>()
  for (const v of verificaciones.data ?? []) {
    const clave = (v.tipo_carroceria_id as string | null) ?? 'generica'
    const nombre = (v.tipo as unknown as { nombre: string } | null)?.nombre ?? 'Lista genérica'
    const actual = porTipo.get(clave) ?? { id: clave, nombre, pasos: 0 }
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

export type AreaConResponsable = {
  id: string
  codigo: string
  nombre: string
  /** El nombre del organigrama: se conserva hasta que todas tengan cuenta. */
  encargado: string | null
  /** La cuenta responsable, nombrada por su puesto (migración 109). */
  responsable: { id: string; etiqueta: string; activo: boolean } | null
  /**
   * La cuenta no es propia: es la del área que la lleva, que la base le anota
   * sola (`areas.jefe_heredado`, migración 20261126998500).
   */
  heredada: boolean
  /**
   * El área cuyo puesto lleva también esta (a Ingeniería la lleva Diseño), con
   * la cuenta que tiene hoy: es la que responde si esta no tiene una propia.
   */
  llevadaPor: { id: string; nombre: string; cuenta: { etiqueta: string; activo: boolean } | null } | null
  /**
   * Las áreas que esta lleva. Su cuenta responde por las que no tienen una
   * `propia`.
   */
  lleva: { nombre: string; propia: boolean }[]
}

/** Una cuenta activa que se puede asignar: `etiqueta` es su puesto (`etiquetasDePuesto`). */
export type CuentaParaResponsable = { id: string; etiqueta: string; area_id: string | null }

/**
 * Las áreas del organigrama con su cuenta responsable (`areas.jefe_id`), el
 * área que lleva a cada una si la hay (`areas.llevada_por_id`) y las
 * cuentas activas que se pueden asignar. Solo para el administrador del
 * sistema: la pantalla no lo pide para nadie más.
 */
export async function areasConResponsable() {
  const supabase = await createClient()

  const [areas, cuentas] = await Promise.all([
    supabase
      .from('areas')
      // Entre `areas` y `usuarios` hay dos llaves, una por lado: se nombra la del responsable.
      .select('id, codigo, nombre, encargado, jefe_heredado, llevada_por_id, responsable:usuarios!areas_jefe_id_fkey(id, puesto, correo, activo)')
      .eq('activo', true)
      .order('orden_secuencia'),
    // Por puesto (migración 109); el correo distingue dos cuentas con el mismo.
    supabase.from('usuarios').select('id, puesto, correo, area_id').eq('activo', true).order('cargo'),
  ])

  if (areas.error) throw new Error(`No se pudieron leer las áreas: ${areas.error.message}`)
  if (cuentas.error) throw new Error(`No se pudieron leer las cuentas: ${cuentas.error.message}`)

  type Cuenta = { id: string; puesto: string | null; correo: string | null; area_id: string | null }
  const activas = (cuentas.data ?? []) as unknown as Cuenta[]
  const etiquetas = etiquetasDePuesto(activas)

  const filas = areas.data ?? []
  // La dada de baja no está entre las activas: se nombra por su puesto a secas.
  const cuentaDe = (a: (typeof filas)[number]) => {
    const r = a.responsable as unknown as (Omit<Cuenta, 'area_id'> & { activo: boolean }) | null
    return r && { id: r.id, etiqueta: etiquetas.get(r.id) ?? puesto(r), activo: r.activo }
  }
  const sinId = (c: ReturnType<typeof cuentaDe>) => c && { etiqueta: c.etiqueta, activo: c.activo }
  // La que lleva a otra está en la misma lista: solo un área activa lleva a otra (`fn_area_llevada_por`).
  const porId = new Map(filas.map((a) => [a.id as string, a]))

  return {
    areas: filas.map((a): AreaConResponsable => {
      const laLleva = a.llevada_por_id ? porId.get(a.llevada_por_id as string) : undefined
      return {
        id: a.id as string,
        codigo: a.codigo as string,
        nombre: a.nombre as string,
        encargado: (a.encargado as string | null)?.trim() || null,
        responsable: cuentaDe(a),
        heredada: Boolean(a.responsable && a.jefe_heredado),
        llevadaPor: laLleva
          ? { id: laLleva.id as string, nombre: laLleva.nombre as string, cuenta: sinId(cuentaDe(laLleva)) }
          : null,
        lleva: filas
          .filter((b) => b.llevada_por_id === a.id)
          .map((b) => ({ nombre: b.nombre as string, propia: Boolean(b.responsable && !b.jefe_heredado) })),
      }
    }),
    cuentas: activas
      .map((c): CuentaParaResponsable => ({ id: c.id, etiqueta: etiquetas.get(c.id) ?? puesto(c), area_id: c.area_id }))
      .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es')),
  }
}
