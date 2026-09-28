'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

async function exigirEdicion() {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'configuracion.editar')) {
    return 'Cambiar la configuración es de administración.'
  }
  return null
}

/** Qué días de la semana hay taller. */
export async function guardarDiasLaborables(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const dias = datos
    .getAll('dia')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)

  if (dias.length === 0) {
    return { ok: false, error: 'Algún día tiene que haber taller.' }
  }

  const supabase = await createClient()
  const { data: empresa } = await supabase.from('empresa').select('id').limit(1).maybeSingle()
  if (!empresa) return { ok: false, error: 'No se encontró la empresa.' }

  const { data, error } = await supabase
    .from('empresa')
    .update({ dias_laborables: dias })
    .eq('id', empresa.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Calendario guardado. Los plazos en días hábiles ya lo usan.' }
}

/** Trae los feriados nacionales del año: la base no pisa lo ya cargado. */
export async function sembrarFeriados(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({ anio: z.coerce.number().int().min(2020).max(2100) })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Revisa el año.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('sembrar_feriados', { p_anio: analisis.data.anio })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return {
    ok: true,
    mensaje:
      Number(data) > 0
        ? `${data} feriados nacionales cargados para ${analisis.data.anio}.`
        : `Los feriados de ${analisis.data.anio} ya estaban cargados.`,
  }
}

/** Un feriado propio de la empresa: aniversario, paro, lo que sea. */
export async function agregarFeriado(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha'),
      nombre: z.string().trim().min(3, 'Ponle nombre al feriado'),
    })
    .safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el feriado.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('feriados').insert({
    fecha: analisis.data.fecha,
    nombre: analisis.data.nombre,
    ambito: 'EMPRESA',
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Feriado agregado.' }
}

/**
 * En un feriado marcado como laborable el taller sí trabaja: es como la
 * empresa decide «este feriado lo recuperamos».
 */
export async function alternarFeriadoLaborable(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = z
    .object({
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      laborable: z.enum(['si', 'no']),
    })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Datos incompletos.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('feriados')
    .update({ laborable: analisis.data.laborable === 'si' })
    .eq('fecha', analisis.data.fecha)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/configuracion')
  return { ok: true }
}

const esquemaCarroceria = z
  .object({
    nombre: z.string().trim().min(3, 'Ponle nombre al tipo de carrocería'),
    descripcion: z.string().trim().optional(),
    // Semirremolque o carrocería montada: el SR/CM de su código de producto.
    tipo_unidad: z.enum(['SEMIRREMOLQUE', 'CARROCERIA_MONTADA']).optional(),
    // La habitual de esta carrocería, escrita como la escriben ellos.
    capacidad: z.string().trim().max(60).optional(),
  })

/**
 * Alta de un tipo de carrocería desde configuración.
 *
 * El catálogo no puede frenar una venta: si el cliente pide algo que no
 * está, el vendedor lo da de alta con su nombre y sigue. El código se arma
 * del nombre; las horas y los precios de referencia los ajusta administración
 * después, desde Configuración.
 */
export async function crearCarroceria(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string; nombre: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.crear', 'configuracion.editar', 'cotizaciones.crear'])) {
    return { ok: false, error: 'No tienes permiso para agregar tipos de carrocería.' }
  }

  const analisis = esquemaCarroceria.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // El código sale del nombre: mayúsculas, sin tildes, con guiones bajos.
  const codigo = v.nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

  // Si ya existe uno con ese nombre se devuelve el que estaba para no duplicar el catálogo.
  const { data: existente } = await supabase
    .from('tipos_carroceria')
    .select('id, nombre')
    .eq('codigo', codigo)
    .maybeSingle()

  if (existente) {
    return {
      ok: true,
      mensaje: `Ese tipo ya estaba en el catálogo: ${existente.nombre}. Quedó elegido.`,
      datos: existente,
    }
  }

  const { data, error } = await supabase
    .from('tipos_carroceria')
    .insert({
      codigo,
      nombre: v.nombre,
      descripcion: v.descripcion?.trim() || null,
      tipo_unidad: v.tipo_unidad ?? null,
      capacidad: v.capacidad?.trim() || null,
      orden_secuencia: 99,
    })
    .select('id, nombre')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Tipo de carrocería agregado. Administración le pondrá sus horas de referencia.', datos: data }
}

const esquemaEditarCarroceria = z.object({
  id: z.string().uuid(),
  nombre: z.string().trim().min(3).max(120),
  descripcion: z.string().trim().max(1000).optional(),
  activo: z.enum(['true', 'false']).transform((v) => v === 'true'),
})

export async function editarCarroceria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = esquemaEditarCarroceria.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  const v = analisis.data
  if (!puede(perfil, ['configuracion.editar', 'cotizaciones.crear'])) {
    return { ok: false, error: 'No tienes permiso para editar el catálogo.' }
  }
  const supabase = await createClient()
  const resultado = puede(perfil, 'configuracion.editar')
    ? await supabase.from('tipos_carroceria').update({ nombre: v.nombre, descripcion: nuloSiVacio(v.descripcion) }).eq('id', v.id).select('id').maybeSingle()
    : await supabase.rpc('editar_carroceria_ventas', { p_id: v.id, p_nombre: v.nombre, p_descripcion: v.descripcion ?? '', p_activo: v.activo })
  if (resultado.error) return { ok: false, error: mensajeDeError(resultado.error) }
  if (!resultado.data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/carrocerias')
  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Carrocería actualizada.' }
}

const esquemaMedidasCarroceria = z.object({
  id: z.string().uuid(),
  modelo: z.string().trim().optional(),
  tipo: z.string().trim().optional(),
  largo_m: z.string().trim().optional(),
  ancho_m: z.string().trim().optional(),
  alto_m: z.string().trim().optional(),
  capacidad: z.string().trim().optional(),
  peso_neto_tn: z.string().trim().optional(),
})

/**
 * Una cifra que puede venir vacía, con coma decimal o mal escrita.
 *
 * La coma es la que está a mano en el teclado y hay navegadores que la mandan
 * tal cual; sin cambiarla por punto, `Number()` devuelve NaN y se rechaza un
 * número que estaba bien escrito. Vacío es vacío —se borra el dato— y no cero,
 * que en una medida significa otra cosa.
 */
function medidaOpcional(texto?: string): number | null {
  const limpio = texto?.trim().replace(',', '.')
  if (!limpio) return null
  const n = Number(limpio)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Medidas técnicas de referencia para el catálogo de carrocerías.
 */
export async function guardarMedidasCarroceria(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = esquemaMedidasCarroceria.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa las medidas.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tipos_carroceria')
    .update({
      modelo: nuloSiVacio(v.modelo),
      tipo: nuloSiVacio(v.tipo),
      largo_m: medidaOpcional(v.largo_m),
      ancho_m: medidaOpcional(v.ancho_m),
      alto_m: medidaOpcional(v.alto_m),
      capacidad: nuloSiVacio(v.capacidad),
      peso_neto_tn: medidaOpcional(v.peso_neto_tn),
    })
    .eq('id', v.id)
    // Sin esto, una política de RLS que esconda la fila deja el UPDATE en cero
    // filas y la pantalla dice «guardado» sin haber guardado nada.
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo guardar: tu perfil no tiene permiso para cambiar el catálogo.',
    }
  }

  revalidatePath('/configuracion')
  return {
    ok: true,
    mensaje: 'Medidas técnicas guardadas en el catálogo.',
  }
}

function nuloSiVacio(valor?: string) {
  const t = valor?.trim()
  return t ? t : null
}

