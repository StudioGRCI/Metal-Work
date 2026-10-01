import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * La base de datos de carrocerías: lo que la casa ya fabricó, con su ficha
 * técnica preescrita, sus accesorios y sus pasos de verificación.
 *
 * Es lo que ve Diseño e Ingeniería antes de cotizar: elegir una carrocería
 * trae su ficha puesta (migración 071) y acá se mira qué trae cada una y de
 * qué OT salió. Las plantillas son de solo lectura: se corrigen por migración,
 * para que un espesor no cambie sin que quede escrito de dónde salió el nuevo.
 * El nombre y las medidas técnicas de cada carrocería sí los corrige Diseño
 * (`diseno.carrocerias`, migración 20261001213000).
 */
export type PlantillaResumen = {
  id: string
  nombre: string
  descripcion: string | null
  predeterminada: boolean
  capacidad_habitual: string | null
  fuentes: string[]
  lineas: number
  accesorios: number
}

export type CarroceriaConFicha = {
  id: string
  codigo: string
  nombre: string
  tipo_unidad: string | null
  capacidad: string | null
  descripcion: string | null
  activo: boolean
  horas_hombre_estandar: number
  modelo: string | null
  tipo: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  peso_neto_tn: number | null
  plantillas: PlantillaResumen[]
  pasos_verificacion: number
}

export async function carroceriasConFicha(incluirInactivas = false, incluirDetalleTecnico = true): Promise<CarroceriaConFicha[]> {
  const supabase = await createClient()
  let consultaTipos = supabase
    .from('tipos_carroceria')
    .select('id, codigo, nombre, descripcion, tipo_unidad, capacidad, activo, horas_hombre_estandar, modelo, tipo, largo_m, ancho_m, alto_m, peso_neto_tn')
  if (!incluirInactivas) consultaTipos = consultaTipos.eq('activo', true)

  const { data: tipos, error: errorTipos } = await consultaTipos.order('nombre')
  if (errorTipos) throw new Error(`No se pudo leer el catálogo de carrocerías: ${errorTipos.message}`)
  // El banco local devuelve los numeric como texto; Supabase, como número.
  const base = (tipos ?? []).map((t) => ({
    id: t.id,
    codigo: t.codigo,
    nombre: t.nombre,
    tipo_unidad: t.tipo_unidad,
    capacidad: t.capacidad,
    descripcion: t.descripcion,
    activo: t.activo,
    horas_hombre_estandar: Number(t.horas_hombre_estandar ?? 0),
    modelo: t.modelo,
    tipo: t.tipo,
    largo_m: t.largo_m === null ? null : Number(t.largo_m),
    ancho_m: t.ancho_m === null ? null : Number(t.ancho_m),
    alto_m: t.alto_m === null ? null : Number(t.alto_m),
    peso_neto_tn: t.peso_neto_tn === null ? null : Number(t.peso_neto_tn),
  }))
  if (!incluirDetalleTecnico) {
    return base.map((t) => ({ ...t, plantillas: [], pasos_verificacion: 0 }))
  }

  const [plantillas, pasos] = await Promise.all([
    supabase
      .from('plantillas_ficha')
      .select(
        'id, tipo_carroceria_id, nombre, descripcion, predeterminada, capacidad_habitual, fuentes, lineas:plantilla_ficha_lineas(count), accesorios:plantilla_ficha_accesorios(count)',
      )
      .eq('activa', true)
      .order('predeterminada', { ascending: false })
      .order('nombre'),
    supabase.from('plantillas_verificacion').select('tipo_carroceria_id'),
  ])

  if (plantillas.error) throw new Error(`No se pudieron leer las fichas: ${plantillas.error.message}`)
  if (pasos.error) throw new Error(`No se pudo leer la verificación: ${pasos.error.message}`)

  const porTipo = new Map<string, PlantillaResumen[]>()
  for (const p of plantillas.data ?? []) {
    if (!p.tipo_carroceria_id) continue
    const lista = porTipo.get(p.tipo_carroceria_id) ?? []
    lista.push({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      predeterminada: p.predeterminada,
      capacidad_habitual: p.capacidad_habitual,
      fuentes: p.fuentes ?? [],
      lineas: (p.lineas as unknown as { count: number }[])?.[0]?.count ?? 0,
      accesorios: (p.accesorios as unknown as { count: number }[])?.[0]?.count ?? 0,
    })
    porTipo.set(p.tipo_carroceria_id, lista)
  }

  const pasosPorTipo = new Map<string, number>()
  for (const v of pasos.data ?? []) {
    const clave = v.tipo_carroceria_id ?? 'GENERICA'
    pasosPorTipo.set(clave, (pasosPorTipo.get(clave) ?? 0) + 1)
  }

  return base.map((t) => ({
    ...t,
    plantillas: porTipo.get(t.id) ?? [],
    // Sin lista propia, la OT usa la genérica: se dice cuántos pasos tiene esa.
    pasos_verificacion: pasosPorTipo.get(t.id) ?? pasosPorTipo.get('GENERICA') ?? 0,
  }))
}

export type LineaPlantilla = {
  seccion: string
  orden_seccion: number
  orden_linea: number
  etiqueta: string | null
  detalle: string
}

export type SeccionPlantilla = { seccion: string; lineas: LineaPlantilla[] }

/** Una plantilla entera: cabecera, ficha por secciones, accesorios y verificación. */
export async function plantillaEntera(id: string) {
  const supabase = await createClient()

  const { data: plantilla, error } = await supabase
    .from('plantillas_ficha')
    .select(
      'id, nombre, descripcion, activa, predeterminada, tipo_unidad, capacidad_habitual, fuentes, tipo_carroceria_id, tipo:tipos_carroceria(id, codigo, nombre, tipo_unidad, capacidad)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo leer la plantilla: ${error.message}`)
  if (!plantilla) return null

  const [lineas, accesorios, verificacion] = await Promise.all([
    supabase
      .from('plantilla_ficha_lineas')
      .select('seccion, orden_seccion, orden_linea, etiqueta, detalle')
      .eq('plantilla_id', id)
      .order('orden_seccion')
      .order('orden_linea'),
    supabase
      .from('plantilla_ficha_accesorios')
      .select('orden, cantidad, unidad, descripcion, incluye_el_accesorio')
      .eq('plantilla_id', id)
      .order('orden'),
    plantilla.tipo_carroceria_id
      ? supabase
          .from('plantillas_verificacion')
          .select('numero, descripcion')
          .eq('tipo_carroceria_id', plantilla.tipo_carroceria_id)
          .order('numero')
      : Promise.resolve({ data: [], error: null }),
  ])

  if (lineas.error) throw new Error(`No se pudo leer la ficha: ${lineas.error.message}`)
  if (accesorios.error) throw new Error(`No se pudieron leer los accesorios: ${accesorios.error.message}`)
  if (verificacion.error) throw new Error(`No se pudo leer la verificación: ${verificacion.error.message}`)

  const secciones: SeccionPlantilla[] = []
  for (const linea of (lineas.data ?? []) as LineaPlantilla[]) {
    const ultima = secciones[secciones.length - 1]
    if (ultima && ultima.seccion === linea.seccion) ultima.lineas.push(linea)
    else secciones.push({ seccion: linea.seccion, lineas: [linea] })
  }

  return {
    ...plantilla,
    tipo: plantilla.tipo as unknown as {
      id: string
      codigo: string
      nombre: string
      tipo_unidad: string | null
      capacidad: string | null
    } | null,
    secciones,
    accesorios: accesorios.data ?? [],
    verificacion: verificacion.data ?? [],
  }
}
