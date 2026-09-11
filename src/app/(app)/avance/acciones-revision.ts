'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * El visto bueno del jefe de producción y la corrección de quien reportó, sobre
 * los tres reportes del día:
 *
 *   · `hoja`  → ot_actividad_avances, la hoja por área de una orden.
 *   · `orden` → ot_avances, el avance con foto de la orden.
 *   · `flota` → flota_avances, los trabajos sin orden.
 *
 * Aprobar u observar exige `produccion.aprobar_reportes`, el mismo permiso que
 * las políticas de UPDATE de las tres tablas suman para eso (migración 097).
 * Corregir lo decide la política de cada tabla —el autor, o quien reporta en el
 * área—, y qué pasa con la revisión al corregir lo decide el disparador: lo
 * observado vuelve a «por aprobar», lo aprobado no se toca.
 *
 * Toda escritura termina en `.select('id')`: una fila que el RLS esconde no es
 * un error para Postgres, y sin esa comprobación la pantalla diría «listo» sin
 * haber hecho nada.
 */
const TABLAS = {
  hoja: 'ot_actividad_avances',
  orden: 'ot_avances',
  flota: 'flota_avances',
} as const

type Clase = keyof typeof TABLAS

// Las tres tablas comparten `id`, `fecha` y las columnas de la revisión, que es
// todo lo que se toca por esta vía: el tipo de una sirve para las tres.
async function tablaDeReporte(clase: Clase) {
  const supabase = await createClient()
  return supabase.from(TABLAS[clase] as 'flota_avances')
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

function revalidarReportes() {
  revalidatePath('/avance', 'layout')
  revalidatePath('/ordenes/[id]', 'page')
}

// ------------------------------------------------------------ aprobar u observar
const esquemaRevision = z.object({
  clase: z.enum(['hoja', 'orden', 'flota']),
  id: z.string().uuid(),
  decision: z.enum(['APROBADO', 'OBSERVADO']),
  observacion: z.string().trim().max(500, 'La observación es muy larga: dilo en pocas palabras.').optional(),
})

export async function revisarReporte(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.aprobar_reportes')) {
    return { ok: false, error: 'El visto bueno de los reportes lo da el jefe de producción.' }
  }

  const analisis = esquemaRevision.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'No se pudo identificar el reporte.' }
  }

  const v = analisis.data
  const observacion = v.observacion ?? ''
  if (v.decision === 'OBSERVADO' && observacion.length < 3) {
    return { ok: false, error: 'Escribe qué hay que corregir: es lo que le llega a quien lo reportó.' }
  }

  // Al aprobar no se manda la observación: la de antes se queda como historia.
  const cambio =
    v.decision === 'OBSERVADO'
      ? { revision: 'OBSERVADO' as const, observacion }
      : { revision: 'APROBADO' as const }

  const tabla = await tablaDeReporte(v.clase)
  const { data, error } = await tabla.update(cambio).eq('id', v.id).select('id').maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidarReportes()
  return {
    ok: true,
    mensaje: v.decision === 'OBSERVADO' ? 'Observación enviada.' : 'Aprobado.',
  }
}

// --------------------------------------------------------- aprobar todo el día
const esquemaDia = z.object({ fecha: z.string().regex(ES_FECHA, 'Falta el día') })

/**
 * Aprueba de una vez lo que queda por aprobar de un día, en las tres tablas.
 * Antes cuenta cuántos esperaban con el mismo filtro: si se aprueban menos, algo
 * los escondió o alguien los tocó entretanto, y hay que decirlo.
 */
export async function aprobarElDia(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.aprobar_reportes')) {
    return { ok: false, error: 'El visto bueno de los reportes lo da el jefe de producción.' }
  }

  const analisis = esquemaDia.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Falta el día.' }
  const { fecha } = analisis.data

  const clases = Object.keys(TABLAS) as Clase[]

  const conteos = await Promise.all(
    clases.map(async (clase) =>
      (await tablaDeReporte(clase))
        .select('id', { count: 'exact', head: true })
        .eq('fecha', fecha)
        .eq('revision', 'PENDIENTE'),
    ),
  )
  const fallaConteo = conteos.find((c) => c.error)?.error
  if (fallaConteo) return { ok: false, error: mensajeDeError(fallaConteo) }

  const esperaban = conteos.reduce((suma, c) => suma + (c.count ?? 0), 0)
  if (esperaban === 0) return { ok: true, mensaje: 'No quedaba nada por aprobar ese día.' }

  const aprobados = await Promise.all(
    clases.map(async (clase) =>
      (await tablaDeReporte(clase))
        .update({ revision: 'APROBADO' })
        .eq('fecha', fecha)
        .eq('revision', 'PENDIENTE')
        .select('id'),
    ),
  )
  const falla = aprobados.find((a) => a.error)?.error
  const cuantos = aprobados.reduce((suma, a) => suma + (a.data?.length ?? 0), 0)

  if (cuantos > 0) revalidarReportes()
  if (falla) {
    return {
      ok: false,
      error:
        cuantos > 0
          ? `Se aprobaron ${cuantos}, pero no todos: ${mensajeDeError(falla)}`
          : mensajeDeError(falla),
    }
  }
  if (cuantos === 0) return { ok: false, error: NO_TOCO_NADA }

  if (cuantos < esperaban) {
    return {
      ok: true,
      mensaje: `Se aprobaron ${cuantos} de ${esperaban}. Vuelve a cargar para ver cuáles quedaron.`,
    }
  }
  return { ok: true, mensaje: cuantos === 1 ? 'Reporte aprobado.' : `${cuantos} reportes aprobados.` }
}

// -------------------------------------------------------------------- eliminar
const esquemaEliminar = z.object({
  clase: z.enum(['hoja', 'orden', 'flota']),
  id: z.string().uuid(),
})

/**
 * Borrar un reporte (migración 099): el autor mientras no esté aprobado, el
 * jefe cualquiera. Las filas de las fotos se van en cascada con la base; los
 * archivos viven en Storage y se piden aparte, después, con las rutas que se
 * leyeron antes de borrar. Si el archivo no se puede quitar, el reporte igual
 * quedó borrado: se avisa, no se deshace.
 */
export async function eliminarReporte(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['produccion.registrar', 'produccion.aprobar_reportes'])) {
    return { ok: false, error: 'No tienes permiso para borrar reportes del taller.' }
  }

  const analisis = esquemaEliminar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar el reporte.' }
  const v = analisis.data

  const supabase = await createClient()

  let rutas: string[] = []
  if (v.clase === 'orden') {
    const { data } = await supabase.from('ot_avance_fotos').select('ruta_storage').eq('avance_id', v.id)
    rutas = (data ?? []).map((f) => f.ruta_storage)
  } else if (v.clase === 'flota') {
    const { data } = await supabase.from('flota_avance_fotos').select('ruta_storage').eq('avance_id', v.id)
    rutas = (data ?? []).map((f) => f.ruta_storage)
  }

  const tabla = await tablaDeReporte(v.clase)
  const { data, error } = await tabla.delete().eq('id', v.id).select('id').maybeSingle()

  // El disparador de la 099 dice por qué no se borra el que movió la etapa; ese
  // mensaje ya viene redactado y pasa tal cual.
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo borrar: puede que ya lo hayan aprobado, o que no sea tuyo. Vuelve a cargar la pantalla.',
    }
  }

  revalidarReportes()

  if (rutas.length > 0) {
    const { error: errorFotos } = await supabase.storage.from('fotos-avance').remove(rutas)
    if (errorFotos) {
      return { ok: true, mensaje: 'Reporte eliminado. Sus fotos quedaron guardadas: avísale al administrador.' }
    }
  }
  return { ok: true, mensaje: 'Reporte eliminado.' }
}

// ------------------------------------------------------------------- corregir
const nulo = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : null)
const id = z.string().uuid()

const esquemaCorreccion = z.discriminatedUnion('clase', [
  z.object({
    clase: z.literal('flota'),
    id,
    descripcion: z.string().trim().min(5, 'Cuenta qué se hizo'),
    avance_porcentaje: z.string().trim().optional(),
    impedimento: z.string().trim().max(500).optional(),
  }),
  z.object({
    clase: z.literal('orden'),
    id,
    descripcion: z.string().trim().min(5, 'Cuenta qué se hizo en la unidad'),
    impedimento: z.string().trim().max(500).optional(),
  }),
  z.object({
    clase: z.literal('hoja'),
    id,
    avance_pct: z.coerce
      .number()
      .min(0.01, 'El avance del día tiene que ser mayor que cero')
      .max(100, 'El avance del día va hasta 100'),
    nota: z.string().trim().max(500).optional(),
  }),
])

/**
 * Corregir lo que dice un reporte. El porcentaje del avance con foto no está
 * aquí a propósito: mueve la etapa al registrarse, y la base no lo deja cambiar
 * después —el bueno va en un avance nuevo—.
 */
export async function corregirReporte(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['produccion.registrar', 'produccion.aprobar_reportes'])) {
    return { ok: false, error: 'No tienes permiso para corregir reportes del taller.' }
  }

  const analisis = esquemaCorreccion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  let resultado
  if (v.clase === 'flota') {
    const porcentaje = v.avance_porcentaje?.trim() ? Number(v.avance_porcentaje) : null
    if (porcentaje !== null && (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
      return { ok: false, error: 'El avance va de 0 a 100, a ojo.' }
    }
    resultado = await supabase
      .from('flota_avances')
      .update({ descripcion: v.descripcion, avance_porcentaje: porcentaje, impedimento: nulo(v.impedimento) })
      .eq('id', v.id)
      .select('id')
      .maybeSingle()
  } else if (v.clase === 'orden') {
    resultado = await supabase
      .from('ot_avances')
      .update({ descripcion: v.descripcion, impedimento: nulo(v.impedimento) })
      .eq('id', v.id)
      .select('id')
      .maybeSingle()
  } else {
    resultado = await supabase
      .from('ot_actividad_avances')
      .update({ avance_pct: v.avance_pct, nota: nulo(v.nota) })
      .eq('id', v.id)
      .select('id')
      .maybeSingle()
  }

  const { data, error } = resultado
  if (error) {
    return {
      ok: false,
      error: error.message.includes('uq_flota_avance_no_se_repite') || error.message.includes('uq_ot_avance_no_se_repite')
        ? 'Ya hay otro reporte de ese día con esas mismas palabras.'
        : mensajeDeError(error),
    }
  }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo corregir: puede que ya lo hayan aprobado, o que ya no esté a tu nombre. Vuelve a cargar la pantalla.',
    }
  }

  revalidarReportes()
  return { ok: true, mensaje: 'Reporte corregido.' }
}
