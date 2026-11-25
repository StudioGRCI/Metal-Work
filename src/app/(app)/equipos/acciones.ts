'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { CODIGO_MAL_ESCRITO, CODIGO_REPETIDO, CODIGO_VACIO, ESTADOS_EQUIPO, FORMA_DEL_CODIGO, limpiarCodigo } from '@/lib/dominio/equipos'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

// Los mismos permisos que aceptan las políticas de `equipos` y
// `equipo_categorias` para escribir, y la función `equipo_cambiar_a_cargo`. Si
// se separan, la escritura afecta cero filas sin error y la pantalla dice
// «guardado» sin haber guardado nada.
const GESTIONAR = 'equipos.gestionar'
const ASIGNAR = 'equipos.asignar'

const texto = (maximo: number, que: string) => z.string().trim().max(maximo, `${que} pasa de ${maximo} caracteres.`).optional()

const esquemaEquipo = z
  .object({
    id: z.guid(),
    alta: z.enum(['si', 'no']),
    codigo: z
      .string()
      .transform(limpiarCodigo)
      .pipe(
        z
          .string()
          .max(20, 'El código pasa de 20 caracteres.')
          .refine((c) => c === '' || (c.length >= 2 && FORMA_DEL_CODIGO.test(c)), CODIGO_MAL_ESCRITO),
      ),
    descripcion: z.string().trim().min(2, 'Falta la descripción del equipo.').max(200, 'La descripción pasa de 200 caracteres.'),
    categoria_id: z.guid('Elige la categoría del equipo.'),
    area_id: z.guid('Elige el área del equipo.'),
    marca: texto(80, 'La marca'),
    serie_maquina: texto(60, 'La serie de máquina'),
    serie_cabezal: texto(60, 'La serie de cabezal'),
    ubicacion: texto(120, 'La ubicación'),
    a_cargo_de: texto(120, 'El nombre de quien lo tiene a cargo'),
    observaciones: texto(1000, 'Las observaciones'),
    estado: z.enum(ESTADOS_EQUIPO).optional(),
    estado_nota: texto(300, 'El motivo del estado'),
  })
  .superRefine((v, ctx) => {
    if (v.alta === 'no' && v.codigo === '') {
      ctx.addIssue({ code: 'custom', path: ['codigo'], message: CODIGO_VACIO })
    }
    if (v.alta === 'si' && v.estado && v.estado !== 'OPERATIVO' && (v.estado_nota ?? '').length < 3) {
      ctx.addIssue({ code: 'custom', path: ['estado_nota'], message: 'Di qué tiene el equipo para no dejarlo como operativo.' })
    }
  })

function nulo(valor: string | undefined | null) {
  const t = valor?.trim()
  return t ? t : null
}

/** Dos textos son el mismo si solo cambian los espacios o las mayúsculas, que la base normaliza. */
function mismoTexto(a: string | null | undefined, b: string | null | undefined) {
  const limpio = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, '').toUpperCase()
  return limpio(a) === limpio(b)
}

function errorDeEquipo(error: { message: string; code?: string }) {
  if (error.message.includes('uq_equipos_codigo')) return CODIGO_REPETIDO
  if (error.message.includes('ck_equipos_codigo')) return CODIGO_MAL_ESCRITO
  if (error.message.includes('ck_equipos_estado_nota')) return 'Di qué tiene el equipo para dejarlo con observación o parado.'
  if (error.message.includes('uq_equipo_categorias_nombre')) return 'Ya hay una categoría con ese nombre.'
  if (error.message.includes('uq_equipo_categorias_prefijo')) return 'Ese prefijo ya es de otra categoría.'
  if (error.message.includes('ck_equipo_categorias_prefijo')) return 'El prefijo va con letras, números y guiones, como AM-04.'
  return mensajeDeError(error)
}

const COLUMNAS_DE_VUELTA =
  'id, codigo, descripcion, categoria_id, marca, serie_maquina, serie_cabezal, area_id, ubicacion, a_cargo_de, estado, estado_nota, observaciones, creado_por'

/**
 * Da de alta o corrige un equipo. El id del alta lo pone el navegador: si la
 * respuesta se pierde y se vuelve a enviar, es el mismo equipo y no entra dos
 * veces con dos códigos seguidos.
 */
export async function guardarEquipo(_previo: unknown, datos: FormData): Promise<ResultadoAccion<{ codigo: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, GESTIONAR)) return { ok: false, error: 'Tu perfil no puede registrar ni corregir equipos.' }

  const analisis = esquemaEquipo.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del equipo.' }
  const v = analisis.data

  const fila = {
    descripcion: v.descripcion,
    categoria_id: v.categoria_id,
    area_id: v.area_id,
    marca: nulo(v.marca),
    serie_maquina: nulo(v.serie_maquina),
    serie_cabezal: nulo(v.serie_cabezal),
    ubicacion: nulo(v.ubicacion),
    observaciones: nulo(v.observaciones),
  }
  const supabase = await createClient()

  if (v.alta === 'no') {
    // Con `.select()`: un UPDATE que el RLS esconde afecta cero filas sin error.
    const { data, error } = await supabase
      .from('equipos')
      .update({ ...fila, codigo: v.codigo })
      .eq('id', v.id)
      .select('codigo')
      .maybeSingle()
    if (error) return { ok: false, error: errorDeEquipo(error) }
    if (!data) return { ok: false, error: NO_TOCO_NADA }
    revalidatePath('/equipos')
    return { ok: true, mensaje: `Equipo ${data.codigo} actualizado.`, datos: data }
  }

  const estado = v.estado ?? 'OPERATIVO'
  // «A cargo de» va en el alta; después se cambia solo con su botón
  // (`cambiarACargoDe`). Si «Editar» lo mandara, devolvería en silencio el que
  // estaba al pintar la lista y borraría lo que Almacén anotó entretanto.
  const nueva = {
    ...fila,
    id: v.id,
    codigo: v.codigo,
    a_cargo_de: nulo(v.a_cargo_de),
    estado,
    estado_nota: estado === 'OPERATIVO' ? null : nulo(v.estado_nota),
  }
  const { data, error } = await supabase.from('equipos').insert(nueva).select('codigo').single()
  if (!error) {
    revalidatePath('/equipos')
    return { ok: true, mensaje: `Equipo registrado como ${data.codigo}.`, datos: data }
  }

  if (error.code === '23505' && error.message.includes('equipos_pkey')) {
    // El mismo envío otra vez: la respuesta de la primera se perdió.
    const { data: existente } = await supabase.from('equipos').select(COLUMNAS_DE_VUELTA).eq('id', v.id).maybeSingle()
    if (existente && existente.creado_por === perfil.id) {
      const igual =
        (v.codigo === '' || existente.codigo === v.codigo) &&
        existente.categoria_id === nueva.categoria_id &&
        existente.area_id === nueva.area_id &&
        existente.estado === nueva.estado &&
        mismoTexto(existente.descripcion, nueva.descripcion) &&
        mismoTexto(existente.marca, nueva.marca) &&
        mismoTexto(existente.serie_maquina, nueva.serie_maquina) &&
        mismoTexto(existente.serie_cabezal, nueva.serie_cabezal) &&
        mismoTexto(existente.ubicacion, nueva.ubicacion) &&
        mismoTexto(existente.a_cargo_de, nueva.a_cargo_de) &&
        mismoTexto(existente.estado_nota, nueva.estado_nota) &&
        mismoTexto(existente.observaciones, nueva.observaciones)
      revalidatePath('/equipos')
      if (igual) return { ok: true, mensaje: `Equipo registrado como ${existente.codigo}.`, datos: { codigo: existente.codigo } }
      return {
        ok: false,
        error: `El equipo ya quedó registrado la primera vez que lo enviaste, como ${existente.codigo}: recarga la pantalla y corrígelo con «Editar».`,
      }
    }
  }
  return { ok: false, error: errorDeEquipo(error) }
}

/** Operativo, con observación o parado. Lo que no es operativo dice qué tiene. */
export async function cambiarEstadoEquipo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, GESTIONAR)) return { ok: false, error: 'Tu perfil no puede cambiar el estado de un equipo.' }

  const analisis = z
    .object({ id: z.guid(), estado: z.enum(ESTADOS_EQUIPO), estado_nota: texto(300, 'El motivo') })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el estado del equipo.' }
  const v = analisis.data
  const nota = nulo(v.estado_nota)
  if (v.estado !== 'OPERATIVO' && (nota ?? '').length < 3) {
    return { ok: false, error: `Di qué tiene el equipo para dejarlo ${v.estado === 'PARADO' ? 'parado' : 'con observación'}.` }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('equipos')
    .update({ estado: v.estado, estado_nota: v.estado === 'OPERATIVO' ? null : nota })
    .eq('id', v.id)
    .eq('activo', true)
    .select('codigo')
    .maybeSingle()
  if (error) return { ok: false, error: errorDeEquipo(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/equipos')
  return { ok: true, mensaje: `Estado de ${data.codigo} actualizado.` }
}

/** Un equipo no se borra: se da de baja con su motivo. La base sella quién y cuándo. */
export async function darDeBajaEquipo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, GESTIONAR)) return { ok: false, error: 'Tu perfil no puede dar de baja equipos.' }

  const analisis = z.object({ id: z.guid(), baja_motivo: texto(300, 'El motivo') }).safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'No se reconoció el equipo. Vuelve a cargar la pantalla.' }
  const v = analisis.data
  const motivo = nulo(v.baja_motivo)
  if ((motivo ?? '').length < 5) return { ok: false, error: 'Di por qué se da de baja el equipo (5 letras o más).' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('equipos')
    .update({ activo: false, baja_motivo: motivo })
    .eq('id', v.id)
    .eq('activo', true)
    .select('codigo')
    .maybeSingle()
  if (error) return { ok: false, error: errorDeEquipo(error) }
  if (!data) {
    // El mismo envío otra vez (se perdió la respuesta): ya quedó, no es un fallo.
    const { data: ya } = await supabase.from('equipos').select('codigo, activo, baja_motivo, baja_por').eq('id', v.id).maybeSingle()
    if (ya && !ya.activo && ya.baja_por === perfil.id && mismoTexto(ya.baja_motivo, motivo)) {
      revalidatePath('/equipos')
      return { ok: true, mensaje: `El equipo ${ya.codigo} ya había quedado de baja.` }
    }
    if (ya && !ya.activo) return { ok: false, error: `El equipo ${ya.codigo} ya estaba dado de baja. Recarga la pantalla.` }
    return { ok: false, error: NO_TOCO_NADA }
  }

  revalidatePath('/equipos')
  return { ok: true, mensaje: `Equipo ${data.codigo} dado de baja. Queda en el padrón como evidencia.` }
}

/**
 * Vuelve a poner en uso un equipo dado de baja, con el motivo. La baja no se
 * pierde: queda en `equipo_bajas` con la reactivación.
 */
export async function reactivarEquipo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, GESTIONAR)) return { ok: false, error: 'Tu perfil no puede reactivar equipos.' }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().trim().min(5, 'Di por qué vuelve a usarse el equipo (5 letras o más).').max(300, 'El motivo pasa de 300 caracteres.'),
    })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el motivo.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('equipo_reactivar', { p_equipo: analisis.data.id, p_motivo: analisis.data.motivo }).maybeSingle()
  if (error) return { ok: false, error: errorDeEquipo(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/equipos')
  return { ok: true, mensaje: data.ya_estaba ? `El equipo ${data.codigo} ya estaba en uso.` : `Equipo ${data.codigo} reactivado: vuelve al padrón.` }
}

/** Quién tiene el equipo. Es lo único del padrón que también cambia Almacén. */
export async function cambiarACargoDe(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ASIGNAR)) return { ok: false, error: 'Tu perfil no puede cambiar quién tiene a cargo un equipo.' }

  const analisis = z
    .object({ id: z.guid(), a_cargo_de: z.string().trim().max(120, 'El nombre pasa de 120 caracteres.') })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa quién lo tiene a cargo.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('equipo_cambiar_a_cargo', { p_equipo: analisis.data.id, p_a_cargo: analisis.data.a_cargo_de })
  if (error) return { ok: false, error: errorDeEquipo(error) }

  revalidatePath('/equipos')
  const quien = analisis.data.a_cargo_de.replace(/\s+/g, ' ').toUpperCase()
  return { ok: true, mensaje: quien ? `Anotado: lo tiene a cargo ${quien}.` : 'Quedó sin nadie a cargo.' }
}

/** Una categoría nueva, con el prefijo de sus códigos si lo tiene. */
export async function crearCategoria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, GESTIONAR)) return { ok: false, error: 'Tu perfil no puede agregar categorías de equipos.' }

  const analisis = z
    .object({
      nombre: z.string().trim().min(2, 'Falta el nombre de la categoría.').max(60, 'El nombre pasa de 60 caracteres.'),
      prefijo: z
        .string()
        .transform(limpiarCodigo)
        .pipe(z.string().max(12, 'El prefijo pasa de 12 caracteres.').refine((p) => p === '' || FORMA_DEL_CODIGO.test(p), 'El prefijo va con letras, números y guiones, como AM-04.')),
    })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la categoría.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('equipo_categorias')
    .insert({ nombre: analisis.data.nombre, prefijo: analisis.data.prefijo || null })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: errorDeEquipo(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/equipos')
  return { ok: true, mensaje: `Categoría «${analisis.data.nombre}» agregada.` }
}
