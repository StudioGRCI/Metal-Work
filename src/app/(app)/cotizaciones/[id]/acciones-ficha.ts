'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

async function exigirEdicion() {
  const perfil = await exigirSesion()
  // La ficha técnica y los accesorios son parte de la cotización de trabajo, y
  // esa la arma Administración con `cotizaciones.costear`. La base ya lo acepta
  // desde la migración 041; esto solo dejaba de acompañarla.
  if (!puede(perfil, ['cotizaciones.editar', 'cotizaciones.costear'])) {
    return 'No tienes permiso para editar la cotización.'
  }
  return null
}

/** Trae una ficha preescrita y reemplaza la que la cotización tuviera. */
export async function aplicarPlantilla(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({ cotizacion_id: z.string().uuid(), plantilla_id: z.string().uuid() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Elige la plantilla que quieres aplicar.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('aplicar_plantilla_ficha', {
    p_cotizacion: analisis.data.cotizacion_id,
    p_plantilla: analisis.data.plantilla_id,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${analisis.data.cotizacion_id}`)
  return { ok: true, mensaje: `Ficha aplicada: ${data ?? 0} líneas.` }
}

/**
 * La ficha de esta cotización pasa a ser plantilla de su carrocería.
 *
 * Es lo que convierte el catálogo en una base que se corrige sola: la primera
 * vez que Diseño escribe la ficha de una carrocería que no tenía, la guarda y
 * la siguiente cotización de esa carrocería ya nace con ella. La función de la
 * base exige `cotizaciones.costear`, el mismo permiso que esta acción.
 */
export async function guardarComoPlantilla(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  // Aquí sí es solo `costear`, que es lo que exige la función de la base: si la
  // acción dejara pasar a quien solo puede editar, el botón fallaría siempre
  // para ese rol. El permiso de la acción y el de la base son el mismo.
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.costear')) {
    return { ok: false, error: 'La ficha la guarda como plantilla quien la costea.' }
  }

  const analisis = z
    .object({
      cotizacion_id: z.string().uuid(),
      nombre: z
        .string()
        .trim()
        .min(3, 'Ponle un nombre a la plantilla, corto y reconocible')
        .max(120, 'El nombre es demasiado largo'),
      predeterminada: z.string().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el nombre.' }
  }

  const v = analisis.data
  const supabase = await createClient()
  const { error } = await supabase.rpc('guardar_cotizacion_como_plantilla', {
    p_cotizacion: v.cotizacion_id,
    p_nombre: v.nombre,
    p_predeterminada: v.predeterminada === 'on',
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  revalidatePath(`/cotizaciones/trabajo/${v.cotizacion_id}`)
  revalidatePath('/carrocerias')
  return {
    ok: true,
    mensaje: `Guardada como «${v.nombre}». La próxima cotización de esta carrocería ya nace con esta ficha.`,
  }
}

/** Los datos que cambian en cada cotización: medidas, garantía, plazo. */
export async function guardarCabeceraTecnica(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      cotizacion_id: z.string().uuid(),
      modelo: z.string().trim().optional(),
      tipo: z.string().trim().optional(),
      largo_m: z.string().trim().optional(),
      ancho_m: z.string().trim().optional(),
      alto_m: z.string().trim().optional(),
      capacidad: z.string().trim().optional(),
      peso_neto_tn: z.string().trim().optional(),
      garantia_meses: z.coerce.number().int().min(0).max(120).default(12),
      // La garantía de la casa se parte por sistema —«01 año fallas de
      // fabricación / 6 meses en sistema hidráulico»— y un número de meses no
      // alcanza. Los tres campos los pinta la ficha; si no se declaran acá, zod
      // los descarta sin decir nada y la pantalla responde «guardado».
      garantia_texto: z.string().trim().optional(),
      peso_tolerancia: z.string().trim().optional(),
      no_incluye: z.string().trim().optional(),
      incluye_igv: z.string().optional(),
      plazo_en_habiles: z.string().optional(),
      nota: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const numero = (texto?: string) => {
    const t = texto?.trim()
    if (!t) return null
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizaciones')
    .update({
      modelo: nulo(v.modelo),
      tipo: nulo(v.tipo),
      largo_m: numero(v.largo_m),
      ancho_m: numero(v.ancho_m),
      alto_m: numero(v.alto_m),
      capacidad: nulo(v.capacidad),
      peso_neto_tn: numero(v.peso_neto_tn),
      garantia_meses: v.garantia_meses,
      garantia_texto: nulo(v.garantia_texto),
      peso_tolerancia: nulo(v.peso_tolerancia),
      no_incluye: nulo(v.no_incluye),
      incluye_igv: v.incluye_igv === 'on',
      plazo_en_habiles: v.plazo_en_habiles === 'on',
      nota: nulo(v.nota),
    })
    .eq('id', v.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Ficha actualizada.' }
}

/** Agrega una línea suelta a la ficha, para lo que la plantilla no cubre. */
export async function agregarLineaFicha(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      cotizacion_id: z.string().uuid(),
      seccion: z.string().trim().min(2, 'Ponle nombre a la sección'),
      etiqueta: z.string().trim().optional(),
      detalle: z.string().trim().min(3, 'Falta el detalle'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la línea.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // La línea nueva se pone al final de su sección; si la sección no existe, al
  // final de la ficha.
  const { data: existentes } = await supabase
    .from('cotizacion_especificaciones')
    .select('seccion, orden_seccion, orden_linea')
    .eq('cotizacion_id', v.cotizacion_id)

  const lineas = existentes ?? []
  const deLaSeccion = lineas.filter((l) => l.seccion === v.seccion.toUpperCase())
  const ordenSeccion = deLaSeccion.length
    ? deLaSeccion[0].orden_seccion
    : Math.max(0, ...lineas.map((l) => l.orden_seccion)) + 1
  const ordenLinea = deLaSeccion.length
    ? Math.max(...deLaSeccion.map((l) => l.orden_linea)) + 1
    : 1

  const { error } = await supabase.from('cotizacion_especificaciones').insert({
    cotizacion_id: v.cotizacion_id,
    seccion: v.seccion.toUpperCase(),
    orden_seccion: ordenSeccion,
    orden_linea: ordenLinea,
    etiqueta: nulo(v.etiqueta),
    detalle: v.detalle,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Línea agregada.' }
}

/** Quita una línea de la ficha. */
export async function quitarLineaFicha(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({ id: z.string().uuid(), cotizacion_id: z.string().uuid() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('cotizacion_especificaciones')
    .delete()
    .eq('id', analisis.data.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${analisis.data.cotizacion_id}`)
  return { ok: true }
}

/** Agrega un accesorio al equipamiento ofrecido. */
export async function agregarAccesorio(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      cotizacion_id: z.string().uuid(),
      cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
      unidad: z.string().trim().default('unid'),
      descripcion: z.string().trim().min(3, 'Falta la descripción'),
      incluye_el_accesorio: z.string().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el accesorio.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data: previos } = await supabase
    .from('cotizacion_accesorios')
    .select('orden')
    .eq('cotizacion_id', v.cotizacion_id)

  const { error } = await supabase.from('cotizacion_accesorios').insert({
    cotizacion_id: v.cotizacion_id,
    orden: Math.max(0, ...(previos ?? []).map((a) => a.orden)) + 1,
    cantidad: v.cantidad,
    unidad: v.unidad || 'unid',
    descripcion: v.descripcion,
    incluye_el_accesorio: v.incluye_el_accesorio === 'on',
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Accesorio agregado.' }
}

/** Quita un accesorio del equipamiento ofrecido. */
export async function quitarAccesorio(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({ id: z.string().uuid(), cotizacion_id: z.string().uuid() })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizacion_accesorios')
    .delete()
    .eq('id', analisis.data.id)
    .eq('cotizacion_id', analisis.data.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/cotizaciones/${analisis.data.cotizacion_id}`)
  return { ok: true }
}

/**
 * Corregir una línea de la ficha sin quitarla y volver a escribirla: el espesor
 * que salió mal, la etiqueta que no era. Se comprueba que el UPDATE tocó su
 * fila —un UPDATE que no encuentra fila no es un error para Postgres, y la
 * pantalla diría «guardado» sin haber guardado nada.
 */
export async function editarLineaFicha(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      id: z.string().uuid(),
      cotizacion_id: z.string().uuid(),
      etiqueta: z.string().trim().optional(),
      detalle: z.string().trim().min(3, 'Falta el detalle'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la línea.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizacion_especificaciones')
    .update({ etiqueta: nulo(v.etiqueta), detalle: v.detalle })
    .eq('id', v.id)
    .eq('cotizacion_id', v.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se pudo guardar la línea de la ficha.' }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Línea actualizada.' }
}

/** Corregir un accesorio ya ofrecido: la cantidad, la unidad o si se incluye. */
export async function editarAccesorio(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      id: z.string().uuid(),
      cotizacion_id: z.string().uuid(),
      cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
      unidad: z.string().trim().default('unid'),
      descripcion: z.string().trim().min(3, 'Falta la descripción'),
      observacion: z.string().trim().optional(),
      incluye_el_accesorio: z.string().optional(),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el accesorio.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizacion_accesorios')
    .update({
      cantidad: v.cantidad,
      unidad: v.unidad || 'unid',
      descripcion: v.descripcion,
      observacion: nulo(v.observacion),
      incluye_el_accesorio: v.incluye_el_accesorio === 'on',
    })
    .eq('id', v.id)
    .eq('cotizacion_id', v.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se pudo guardar el accesorio.' }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Accesorio actualizado.' }
}
