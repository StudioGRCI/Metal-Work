'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { fecha as fechaDelDia, hoyLima, numero } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { traerDeSunat } from '@/lib/tipo-cambio/sunat'
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

  const { error } = await supabase
    .from('empresa')
    .update({ dias_laborables: dias })
    .eq('id', empresa.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

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
  const { error } = await supabase
    .from('feriados')
    .update({ laborable: analisis.data.laborable === 'si' })
    .eq('fecha', analisis.data.fecha)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true }
}

const esquemaCarroceria = z.object({
  nombre: z.string().trim().min(3, 'Ponle nombre al tipo de carrocería'),
  descripcion: z.string().trim().optional(),
})

/**
 * Alta de un tipo de carrocería desde donde se cotiza.
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
  if (!puede(perfil, ['cotizaciones.crear', 'ordenes.crear', 'configuracion.editar'])) {
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

  // Si ya existe uno con ese nombre se devuelve el que estaba: la meta es
  // seguir cotizando, no duplicar el catálogo.
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
      orden_secuencia: 99,
    })
    .select('id, nombre')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Tipo de carrocería agregado. Administración le pondrá sus horas de referencia.', datos: data }
}

const esquemaTipoCambio = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha del tipo de cambio.'),
  compra: z.string().trim().min(1, 'Falta el tipo de cambio compra.'),
  venta: z.string().trim().min(1, 'Falta el tipo de cambio venta.'),
})

/**
 * Un tipo de cambio escrito a mano.
 *
 * La coma decimal es la que está a mano en el teclado y hay navegadores que la
 * mandan tal cual: sin cambiarla por punto, Number() devuelve NaN y se rechaza
 * un número que estaba bien escrito. La columna es numeric(10,4), así que se
 * redondea a cuatro decimales acá y no se descubre el recorte al releerlo.
 */
function cifraDeCambio(texto: string): number | null {
  const n = Number(texto.replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 10000) / 10000
}

/**
 * El tipo de cambio del día: es lo que le falta a la base para poder costear en
 * dólares. Mientras la tabla está vacía, `tipo_cambio_vigente()` devuelve 1 y
 * cada cotización en dólares se congela con el dólar a un sol.
 *
 * La fecha es la clave primaria: cargar dos veces el mismo día corrige, no
 * duplica. Corregirlo tampoco reescribe la historia —cada documento congela su
 * tipo de cambio al emitirse—, así que lo ya emitido se queda con el que tenía.
 */
export async function registrarTipoCambio(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const analisis = esquemaTipoCambio.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el tipo de cambio.' }
  }

  const compra = cifraDeCambio(analisis.data.compra)
  const venta = cifraDeCambio(analisis.data.venta)
  if (compra === null || venta === null) {
    return { ok: false, error: 'La compra y la venta van en soles por dólar y mayores que cero: 3.62 y 3.65.' }
  }

  // Un cambio de tres cifras es siempre el punto decimal que se quedó en el
  // camino (365 en vez de 3.65). Congelado, multiplica por cien el presupuesto
  // de la orden y nadie lo vuelve a mirar.
  if (compra > 100 || venta > 100) {
    return { ok: false, error: 'El tipo de cambio va en soles por dólar: 3.65, no 365.' }
  }

  // Ningún banco vende más barato de lo que compra: cuando pasa, las dos cifras
  // entraron cambiadas de sitio. Y la que congelan los documentos es la venta,
  // así que dejarla pasar mete el error en todo lo que se emita después.
  if (venta < compra) {
    return { ok: false, error: 'La venta no puede ser menor que la compra: parece que están cambiadas de sitio.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('tipos_cambio')
    .upsert(
      { fecha: analisis.data.fecha, compra, venta, fuente: 'MANUAL' },
      { onConflict: 'fecha' },
    )

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return {
    ok: true,
    mensaje: `Tipo de cambio del ${fechaDelDia(analisis.data.fecha)} guardado, venta ${numero(venta, 3)}. Lo que se emita desde acá ya lo usa; lo ya emitido conserva el suyo.`,
  }
}

/**
 * Traerlo de SUNAT en vez de escribirlo.
 *
 * Escribirlo a mano todos los días es una tarea que alguien deja de hacer un
 * martes cualquiera, y el sistema no se cae cuando eso pasa: sigue costeando
 * con el cambio de la última vez que alguien se acordó. Este botón —y el mismo
 * trabajo, una vez al día, desde el cron— es lo que hace que dejar de acordarse
 * no cueste plata.
 *
 * No pisa lo que ya está: si el día pedido ya tiene cambio, no consulta. El
 * servicio corta con 429 a la segunda consulta seguida, y además un valor
 * corregido a mano no se reemplaza por el automático a espaldas de quien lo
 * corrigió.
 */
export async function traerTipoCambioDeSunat(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const pedida = String(datos.get('fecha') ?? '')
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : hoyLima()

  const supabase = await createClient()

  const { data: yaEsta } = await supabase
    .from('tipos_cambio')
    .select('fecha, venta, fuente')
    .eq('fecha', fecha)
    .maybeSingle()

  if (yaEsta) {
    return {
      ok: true,
      mensaje: `El ${fechaDelDia(fecha)} ya tenía cambio cargado (venta ${numero(yaEsta.venta, 3)}, ${yaEsta.fuente}). No se volvió a consultar.`,
    }
  }

  const resultado = await traerDeSunat(fecha)
  if (!resultado.ok) return { ok: false, error: resultado.error }

  const { cambio } = resultado
  const { error } = await supabase
    .from('tipos_cambio')
    .upsert(
      { fecha: cambio.fecha, compra: cambio.compra, venta: cambio.venta, fuente: cambio.fuente },
      { onConflict: 'fecha' },
    )

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')

  // SUNAT no publica sábados, domingos ni feriados: contesta con el último día
  // hábil. Se dice, porque si no parece que el botón no hizo caso a la fecha.
  const otroDia = cambio.fecha !== fecha
  return {
    ok: true,
    mensaje: otroDia
      ? `SUNAT no publicó el ${fechaDelDia(fecha)}; se guardó el del ${fechaDelDia(cambio.fecha)}, venta ${numero(cambio.venta, 3)}.`
      : `Tipo de cambio del ${fechaDelDia(cambio.fecha)} traído de SUNAT, venta ${numero(cambio.venta, 3)}.`,
  }
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
 * Las medidas de referencia de un tipo de carrocería.
 *
 * Son lo que la cotización copia al elegir el tipo: una tolva volquete de piso
 * circular mide lo que mide, y escribirlo en cada cotización terminaba en fichas
 * con rayas. Copiadas a la cotización se pueden corregir ahí —«a veces no todas
 * terminan igual»— sin que eso toque este catálogo.
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
    mensaje: 'Medidas guardadas. Las cotizaciones nuevas de este tipo las traen solas.',
  }
}

function nuloSiVacio(valor?: string) {
  const t = valor?.trim()
  return t ? t : null
}

/**
 * Quién firma las cotizaciones.
 *
 * Vacío es una opción válida —el papel cierra entonces con la razón social— así
 * que el campo se guarda tal cual: aquí «no hay nadie elegido» es una decisión,
 * no un olvido, y confundir las dos cosas dejaría el nombre viejo pegado para
 * siempre.
 */
export async function guardarQuienFirma(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: problema }

  const elegido = String(datos.get('gerente_general_id') ?? '').trim()
  if (elegido && !/^[0-9a-f-]{36}$/i.test(elegido)) {
    return { ok: false, error: 'Elige a alguien de la lista.' }
  }

  const supabase = await createClient()
  const { data: empresa } = await supabase.from('empresa').select('id').limit(1).maybeSingle()
  if (!empresa) return { ok: false, error: 'No se encontró la ficha de la empresa.' }

  const { error } = await supabase
    .from('empresa')
    .update({ gerente_general_id: elegido || null })
    .eq('id', empresa.id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/configuracion')
  return {
    ok: true,
    mensaje: elegido
      ? 'Guardado. Las cotizaciones que se impriman desde ahora cierran con ese nombre.'
      : 'Guardado. Las cotizaciones cierran con el nombre de la empresa.',
  }
}
