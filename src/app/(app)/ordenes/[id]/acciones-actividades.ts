'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { areaDeActividad } from '@/lib/datos/actividades'
import { exigirSesion, puede, puedeHojaDeArea } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La hoja del área se escribe con dos manos y cada una tiene su permiso, que es
 * exactamente el que la base va a pedir:
 *
 *   · Armar la lista y ponerle el peso a cada actividad: `produccion.actividades`
 *     —el jefe de maestranza y el supervisor de producción—.
 *   · Reportar el avance del día: `produccion.registrar`, el mismo con el que se
 *     carga el parte diario. El operario reporta pero no arma la lista.
 *
 * Los topes no se comprueban acá sino en la base, y por eso los mensajes se
 * traducen: que las actividades de un área no pasen del 100 % y que lo
 * reportado no pase del 100 % de la actividad son reglas del negocio, no de la
 * pantalla, y tienen que valer aunque se escriba por otra vía.
 *
 * Y hay un tercer filtro, el del área: la hoja de Maestranza no la escribe el
 * supervisor de Acabados. Eso lo decide el RLS —`puede_hoja_de_area`— y acá se
 * comprueba lo mismo, con `puedeHojaDeArea`, solo para poder decir por qué. Sin
 * esta comprobación el UPDATE afecta cero filas y no da error: el fallo mudo de
 * siempre.
 */
const REGLAS: Record<string, string> = {
  uq_ot_actividad: 'Esa área ya tiene una actividad con ese nombre en esta orden.',
  uq_avance_del_dia: 'Ya reportaste esta actividad hoy. Corrige el reporte de hoy en vez de agregar otro.',
  ot_actividad_avances_avance_pct_check: 'El avance del día tiene que estar entre 1 y 100.',
  ot_actividades_peso_pct_check: 'El peso tiene que estar entre 0 y 100.',
}

function traducir(error: { message: string }) {
  for (const [regla, texto] of Object.entries(REGLAS)) {
    if (error.message.includes(regla)) return texto
  }
  // Los topes vienen como `raise exception` con el mensaje ya redactado para
  // quien lo lee: «Las actividades de Producción … no pueden pasar de 100».
  return mensajeDeError(error)
}

const nulo = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : null)

const esquemaActividad = z.object({
  orden_id: z.string().uuid(),
  area_id: z.string().uuid('Elige el área'),
  nombre: z.string().trim().min(3, 'Escribe qué actividad es'),
  referencia: z.string().trim().optional(),
  detalle: z.string().trim().optional(),
  peso_pct: z.coerce.number().min(0).max(100).default(0),
  orden_secuencia: z.coerce.number().int().min(1).max(999).default(1),
  // Según el cronograma, si lo hay (migración 099): desde y hasta cuándo.
  fecha_inicio_plan: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'La fecha de inicio no se entiende').optional(),
  fecha_fin_plan: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'La fecha de fin no se entiende').optional(),
})

export async function agregarActividad(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.actividades')) {
    return { ok: false, error: 'La lista de actividades la arma el jefe del área.' }
  }

  const analisis = esquemaActividad.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data

  if (!puedeHojaDeArea(perfil, v.area_id)) {
    return { ok: false, error: 'Esa hoja es de otra área: cada uno arma la suya.' }
  }

  const inicio = nulo(v.fecha_inicio_plan)
  const fin = nulo(v.fecha_fin_plan)
  if (inicio && fin && fin < inicio) {
    return { ok: false, error: 'La actividad no puede terminar antes de empezar.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_actividades')
    .insert({
      orden_id: v.orden_id,
      area_id: v.area_id,
      nombre: v.nombre,
      referencia: nulo(v.referencia),
      detalle: nulo(v.detalle),
      peso_pct: v.peso_pct,
      orden_secuencia: v.orden_secuencia,
      fecha_inicio_plan: inicio,
      fecha_fin_plan: fin,
      creado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Actividad agregada.' }
}

const esquemaPeso = z.object({
  id: z.string().uuid(),
  orden_id: z.string().uuid(),
  peso_pct: z.coerce.number().min(0).max(100),
})

export async function cambiarPesoActividad(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.actividades')) {
    return { ok: false, error: 'El peso lo pone el jefe del área.' }
  }

  const analisis = esquemaPeso.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el peso.' }
  }

  const v = analisis.data

  if (!puedeHojaDeArea(perfil, await areaDeActividad(v.id))) {
    return { ok: false, error: 'Ese peso es de la hoja de otra área.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_actividades')
    .update({ peso_pct: v.peso_pct })
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Peso corregido.' }
}

const esquemaQuitar = z.object({ id: z.string().uuid(), orden_id: z.string().uuid() })

export async function quitarActividad(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.actividades')) {
    return { ok: false, error: 'La lista la arma el jefe del área.' }
  }

  const analisis = esquemaQuitar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar la actividad.' }

  const v = analisis.data
  const supabase = await createClient()

  // Con avances reportados no se borra: es el diario del taller y el hueco no
  // lo puede explicar nadie después.
  const { data: reportada } = await supabase
    .from('v_ot_actividades')
    .select('nombre, reportes, area_id')
    .eq('id', v.id)
    .maybeSingle()

  if (!puedeHojaDeArea(perfil, reportada?.area_id ?? null)) {
    return { ok: false, error: 'Esa actividad es de la hoja de otra área.' }
  }

  if (reportada && Number(reportada.reportes ?? 0) > 0) {
    return {
      ok: false,
      error: `«${reportada.nombre}» ya tiene avances reportados: se puede corregir, pero no quitar.`,
    }
  }

  const { data, error } = await supabase
    .from('ot_actividades')
    .delete()
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Actividad quitada.' }
}

// ------------------------------------------------------------- el cronograma
const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

const esquemaFilaCronograma = z.object({
  area_id: z.string().uuid(),
  nombre: z.string().trim().min(1).max(200),
  referencia: z.string().trim().max(200).nullable().optional(),
  peso_pct: z.number().min(0).max(100),
  inicio: z.string().regex(ES_FECHA).nullable().optional(),
  fin: z.string().regex(ES_FECHA).nullable().optional(),
})

/**
 * Cargar el cronograma de un Excel, ya leído en el navegador (`leerCronograma`).
 * La base vuelve a validarlo todo y lo carga de una vez o nada
 * (`cargar_cronograma`, migración 099). Acá se comprueba lo mismo que el RLS
 * —que cada fila sea de un área propia— para poder decir cuál no lo es.
 */
export async function cargarCronograma(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.actividades')) {
    return { ok: false, error: 'El cronograma lo carga el supervisor del área o el jefe.' }
  }

  const orden = z.string().uuid().safeParse(datos.get('orden_id'))
  if (!orden.success) return { ok: false, error: 'No se pudo identificar la orden.' }

  let filas: z.infer<typeof esquemaFilaCronograma>[]
  try {
    const analisis = z.array(esquemaFilaCronograma).min(1).max(500).safeParse(JSON.parse(String(datos.get('filas') ?? '[]')))
    if (!analisis.success) return { ok: false, error: 'El cronograma trae filas que no se entienden: revisa el archivo.' }
    filas = analisis.data
  } catch {
    return { ok: false, error: 'El cronograma no se pudo leer: vuelve a elegir el archivo.' }
  }

  const ajena = filas.find((f) => !puedeHojaDeArea(perfil, f.area_id))
  if (ajena) {
    return { ok: false, error: `«${ajena.nombre}» es de la hoja de otra área: cada uno carga la suya.` }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cargar_cronograma', { p_orden: orden.data, p_filas: filas })

  if (error) return { ok: false, error: traducir(error) }
  const r = data as { nuevas?: number; actualizadas?: number } | null
  if (!r) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${orden.data}`)
  revalidatePath('/avance')

  const nuevas = r.nuevas ?? 0
  const actualizadas = r.actualizadas ?? 0
  return {
    ok: true,
    mensaje: `Cronograma cargado: ${nuevas} ${nuevas === 1 ? 'actividad nueva' : 'actividades nuevas'} y ${actualizadas} ${actualizadas === 1 ? 'actualizada' : 'actualizadas'}.`,
  }
}

const esquemaAvance = z.object({
  actividad_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  fecha: z.string().min(1, 'Falta la fecha'),
  avance_pct: z.coerce.number().min(0.01, 'El avance del día tiene que ser mayor que cero').max(100),
  nota: z.string().trim().optional(),
})

/** El reporte del día: lo que se avanzó hoy, no el acumulado. */
export async function reportarAvance(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para reportar avance de producción.' }
  }

  const analisis = esquemaAvance.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  }

  const v = analisis.data

  if (!puedeHojaDeArea(perfil, await areaDeActividad(v.actividad_id))) {
    return { ok: false, error: 'Ese avance es de otra área: cada uno reporta lo suyo.' }
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_actividad_avances')
    .insert({
      actividad_id: v.actividad_id,
      orden_id: v.orden_id,
      fecha: v.fecha,
      avance_pct: v.avance_pct,
      nota: nulo(v.nota),
      reportado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Avance del día reportado.' }
}
