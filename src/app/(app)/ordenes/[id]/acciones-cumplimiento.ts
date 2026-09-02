'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * El MW-FOR-ING-8 se escribe con tres manos y cada acción exige la suya,
 * porque es exactamente lo que la base va a pedir:
 *
 *   - Diseño arma la hoja —planos, piezas, pesos, la fecha en que entregó el
 *     plano— con `diseno.planos`.
 *   - Maestranza y Producción llenan su bloque con `produccion.registrar`, el
 *     mismo permiso con el que cargan un parte diario.
 *
 * La política de UPDATE de las piezas acepta a las dos, y un disparador mira
 * qué columnas cambiaron y exige el permiso de esa mano. Si acá se pidiera
 * otro, el UPDATE afectaría cero filas sin error y la pantalla diría «guardado»
 * sin haber guardado: por eso cada escritura vuelve con `.select('id')` y se
 * comprueba que tocó su fila.
 */
const NO_TOCO_NADA = 'No se pudo guardar: vuelve a cargar la orden y comprueba que sigue a la vista.'

/**
 * Las reglas de la hoja que la base defiende con `check`. Postgres las nombra
 * por su constraint y `mensajeDeError` las traduce como «no cumple la regla
 * ck_pieza_…», que para quien reporta no dice nada: acá se dicen en su idioma.
 */
const REGLAS: Record<string, string> = {
  ck_pieza_mtz_habilitado: 'Para marcar «habilitado» hay que poner la fecha de inicio.',
  ck_pieza_mtz_entregado: 'Para marcar «entregado» la pieza tiene que estar habilitada y con fecha de culminación.',
  ck_pieza_prd_recibido: 'Para marcar «recibido» hay que poner la fecha de recepción, y Maestranza tiene que haberla entregado.',
  ck_pieza_prd_armado: 'Para marcar «armado» hay que poner la fecha de inicio, y la pieza tiene que estar recibida.',
  ck_pieza_ensamble: 'Un ensamble no pasa por Maestranza: Producción lo empieza y lo arma.',
  ck_pieza_fechas_mtz: 'La culminación no puede ser anterior al inicio del habilitado.',
  ck_pieza_fechas_prd: 'El inicio del armado no puede ser anterior a la recepción.',
  uq_ot_plano: 'Esta orden ya tiene un plano con ese número.',
}

function explicar(error: { message: string; code?: string }): string {
  const regla = /constraint "([^"]+)"/.exec(error.message)?.[1]
  if (regla && REGLAS[regla]) return REGLAS[regla]
  return mensajeDeError(error)
}

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

/** Una fecha del formulario: vacía es nula, y lo demás lo valida la base. */
const fechaOpcional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha no tiene forma de fecha').nullable())

const marcado = z.string().optional().transform((v) => v === 'on' || v === 'true')

async function exigirDiseno() {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false as const, error: 'Los planos y las piezas los arma Diseño.' }
  }
  return { ok: true as const, perfil }
}

async function exigirTaller() {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false as const, error: 'El habilitado y el armado los reportan Maestranza y Producción.' }
  }
  return { ok: true as const, perfil }
}

// ============================================================== los planos
const esquemaPlano = z.object({
  orden_id: z.string().uuid(),
  numero_plano: z.string().trim().min(1, 'Ponle número al plano').max(20, 'El número del plano es demasiado largo'),
  nombre: z.string().trim().min(2, 'Ponle nombre al plano').max(120),
  peso_pct: z.coerce.number().min(0, 'El peso no puede ser negativo').max(100, 'Ningún plano pesa más de 100'),
  fecha_entrega: fechaOpcional,
  observacion: z.string().trim().max(500).optional(),
})

/** Diseño agrega un plano: un grupo de piezas con su peso en la unidad. */
export async function agregarPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaPlano.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el plano.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // Al final de la lista; el orden se corrige después si hace falta.
  const { data: previos } = await supabase
    .from('ot_planos')
    .select('orden_secuencia')
    .eq('orden_id', v.orden_id)

  const { data, error } = await supabase
    .from('ot_planos')
    .insert({
      orden_id: v.orden_id,
      orden_secuencia: Math.max(0, ...(previos ?? []).map((p) => p.orden_secuencia)) + 1,
      numero_plano: v.numero_plano,
      nombre: v.nombre,
      peso_pct: v.peso_pct,
      fecha_entrega: v.fecha_entrega,
      observacion: nulo(v.observacion),
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: `Plano ${v.numero_plano} agregado.` }
}

const esquemaEditarPlano = esquemaPlano.extend({ plano_id: z.string().uuid() })

/** Corregir un plano: el nombre, el peso, la fecha en que se entregó. */
export async function editarPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaEditarPlano.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el plano.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_planos')
    .update({
      numero_plano: v.numero_plano,
      nombre: v.nombre,
      peso_pct: v.peso_pct,
      fecha_entrega: v.fecha_entrega,
      observacion: nulo(v.observacion),
    })
    .eq('id', v.plano_id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Plano actualizado.' }
}

const esquemaEntrega = z.object({
  plano_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  fecha_entrega: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha de entrega'),
})

/**
 * Diseño da por entregado el plano. Es la fecha que destraba a Maestranza: sin
 * ella la base no deja reportar el habilitado de ninguna pieza del plano.
 */
export async function entregarPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaEntrega.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Elige la fecha.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_planos')
    .update({ fecha_entrega: v.fecha_entrega })
    .eq('id', v.plano_id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Plano entregado al taller.' }
}

const esquemaQuitar = z.object({ id: z.string().uuid(), orden_id: z.string().uuid() })

/** Quitar un plano que todavía no tiene trabajo reportado; la base lo defiende. */
export async function quitarPlano(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaQuitar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_planos')
    .delete()
    .eq('id', v.id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Plano quitado.' }
}

// ============================================================== las piezas
const esquemaPiezas = z.object({
  plano_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  // Una pieza por línea, como en la hoja: «# | nombre | cantidad». La cantidad
  // es opcional (1) y «ENS» como número marca un ensamble.
  lista: z.string().trim().min(1, 'Escribe al menos una pieza'),
})

type PiezaNueva = {
  numero_pieza: string
  nombre: string
  cantidad: number
  es_ensamble: boolean
}

/**
 * Lee la lista tal como Diseño la pega desde su hoja: separada por «|», por
 * tabulador o por punto y coma. Devuelve la primera línea que no se entiende
 * para que se corrija, en lugar de cargar la mitad.
 */
function leerPiezas(texto: string): { piezas: PiezaNueva[] } | { error: string } {
  const piezas: PiezaNueva[] = []
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  for (const linea of lineas) {
    const partes = linea.split(/\s*[|;\t]\s*/).map((p) => p.trim())
    if (partes.length < 2 || !partes[0] || !partes[1]) {
      return { error: `No se entiende la línea «${linea}». Escribe: número | nombre | cantidad.` }
    }
    const numero = partes[0].slice(0, 20)
    const nombre = partes[1].slice(0, 120)
    const cantidad = partes[2] ? Number(partes[2].replace(',', '.')) : 1
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return { error: `La cantidad de «${nombre}» tiene que ser un número mayor que cero.` }
    }
    piezas.push({
      numero_pieza: numero,
      nombre,
      cantidad,
      es_ensamble: /^ens/i.test(numero) || /^ensambl/i.test(nombre),
    })
  }

  if (piezas.length === 0) return { error: 'Escribe al menos una pieza.' }
  return { piezas }
}

/** Diseño agrega las piezas de un plano, una por línea. */
export async function agregarPiezas(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaPiezas.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa las piezas.' }
  }

  const v = analisis.data
  const leidas = leerPiezas(v.lista)
  if ('error' in leidas) return { ok: false, error: leidas.error }

  const supabase = await createClient()

  const { data: previas } = await supabase
    .from('ot_piezas')
    .select('orden_secuencia')
    .eq('plano_id', v.plano_id)
  let siguiente = Math.max(0, ...(previas ?? []).map((p) => p.orden_secuencia)) + 1

  const { data, error } = await supabase
    .from('ot_piezas')
    .insert(
      leidas.piezas.map((p) => ({
        plano_id: v.plano_id,
        orden_id: v.orden_id,
        orden_secuencia: siguiente++,
        numero_pieza: p.numero_pieza,
        nombre: p.nombre,
        cantidad: p.cantidad,
        es_ensamble: p.es_ensamble,
      })),
    )
    .select('id')

  if (error) return { ok: false, error: explicar(error) }
  if (!data || data.length !== leidas.piezas.length) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: `${data.length} pieza${data.length === 1 ? '' : 's'} agregada${data.length === 1 ? '' : 's'}.` }
}

const esquemaEditarPieza = z.object({
  pieza_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  numero_pieza: z.string().trim().min(1, 'Ponle número a la pieza').max(20),
  nombre: z.string().trim().min(2, 'Ponle nombre a la pieza').max(120),
  cantidad: z.coerce.number().positive('La cantidad tiene que ser mayor que cero'),
  es_ensamble: marcado,
  observacion: z.string().trim().max(500).optional(),
})

/** Corregir lo que Diseño dibujó de una pieza. */
export async function editarPieza(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaEditarPieza.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la pieza.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_piezas')
    .update({
      numero_pieza: v.numero_pieza,
      nombre: v.nombre,
      cantidad: v.cantidad,
      es_ensamble: v.es_ensamble,
      observacion: nulo(v.observacion),
    })
    .eq('id', v.pieza_id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Pieza actualizada.' }
}

/** Quitar una pieza. */
export async function quitarPieza(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirDiseno()
  if (!guarda.ok) return guarda

  const analisis = esquemaQuitar.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_piezas')
    .delete()
    .eq('id', v.id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  return { ok: true, mensaje: 'Pieza quitada.' }
}

// ========================================================== lo que reporta el taller
const esquemaMaestranza = z.object({
  pieza_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  mtz_inicio: fechaOpcional,
  mtz_habilitado: marcado,
  mtz_culminacion: fechaOpcional,
  mtz_entregado: marcado,
  mtz_observacion: z.string().trim().max(500).optional(),
})

/**
 * Maestranza reporta su bloque: cuándo empezó a habilitar, si ya está
 * habilitada, cuándo terminó y si ya la entregó a Producción. Las reglas —un
 * visto sin fecha, un entregado sin habilitar, un inicio anterior a la entrega
 * del plano— las dice la base con sus propias palabras.
 */
export async function reportarMaestranza(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirTaller()
  if (!guarda.ok) return guarda

  const analisis = esquemaMaestranza.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_piezas')
    .update({
      mtz_inicio: v.mtz_inicio,
      mtz_habilitado: v.mtz_habilitado,
      mtz_culminacion: v.mtz_culminacion,
      mtz_entregado: v.mtz_entregado,
      mtz_observacion: nulo(v.mtz_observacion),
    })
    .eq('id', v.pieza_id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/plazos')
  return { ok: true, mensaje: 'Maestranza reportó.' }
}

const esquemaProduccion = z.object({
  pieza_id: z.string().uuid(),
  orden_id: z.string().uuid(),
  prd_recepcion: fechaOpcional,
  prd_recibido: marcado,
  prd_inicio: fechaOpcional,
  prd_armado: marcado,
  prd_observacion: z.string().trim().max(500).optional(),
})

/** Producción reporta su bloque: cuándo recibió la pieza y cuándo la armó. */
export async function reportarProduccion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const guarda = await exigirTaller()
  if (!guarda.ok) return guarda

  const analisis = esquemaProduccion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('ot_piezas')
    .update({
      prd_recepcion: v.prd_recepcion,
      prd_recibido: v.prd_recibido,
      prd_inicio: v.prd_inicio,
      prd_armado: v.prd_armado,
      prd_observacion: nulo(v.prd_observacion),
    })
    .eq('id', v.pieza_id)
    .eq('orden_id', v.orden_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: explicar(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/plazos')
  return { ok: true, mensaje: 'Producción reportó.' }
}
