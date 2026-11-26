'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion, NO_TOCO_NADA } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { CUENTA_YA_NO_ACTIVA } from '@/lib/dominio/areas'
import { codigoDeCarroceria, nombreDeCarroceria } from '@/lib/dominio/medidas-carroceria'
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
    // Las mismas reglas que al editar: un nombre que el alta dejaba pasar
    // (130 caracteres, solo signos) después no dejaba ni desactivarla.
    nombre: z.string('Ponle nombre al tipo de carrocería.').trim()
      .min(3, 'Ponle nombre al tipo de carrocería, de al menos 3 letras.')
      .max(120, 'El nombre va en 120 caracteres como máximo.')
      .regex(/[\p{L}\p{N}]/u, 'El nombre debe incluir letras o números.'),
    descripcion: z.string().trim().optional(),
    // Semirremolque o carrocería montada: el SR/CM de su código de producto.
    // «Sin definir» llega vacío: es lo que trae la ventana y la carrocería
    // entra sin tipo. El enum solo aceptaba la falta del campo, y la ventana
    // decía «Invalid input» (H4 de diseño, cuadragésima tercera pasada).
    tipo_unidad: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['SEMIRREMOLQUE', 'CARROCERIA_MONTADA'], 'Elige si es semirremolque o carrocería montada, o déjalo sin definir.').optional(),
    ),
    // La habitual de esta carrocería, escrita como la escriben ellos.
    capacidad: z.string().trim().max(60, 'La capacidad va en 60 caracteres como máximo.').optional(),
  })

/**
 * Alta de un tipo de carrocería.
 *
 * El catálogo no puede frenar una venta ni la carga de una OT: si el cliente
 * pide algo que no está, el vendedor o Administración lo da de alta con su
 * nombre y sigue. El código se arma del nombre; las medidas técnicas las
 * completa después Diseño e Ingeniería, desde Carrocerías.
 */
export async function crearCarroceria(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string; nombre: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['ordenes.crear', 'diseno.carrocerias', 'cotizaciones.crear'])) {
    return { ok: false, error: 'No tienes permiso para agregar tipos de carrocería.' }
  }

  const analisis = esquemaCarroceria.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // «Ya estaba» se decide por el nombre, no por el código: el código es el de
  // la empresa (TOL, C34…) y no cambia al renombrar, así que buscarlo armado
  // del nombre daba por existente otra carrocería, o ninguna.
  const comoNombre = nombreDeCarroceria(v.nombre)
  const { data: catalogo, error: alLeer } = await supabase
    .from('tipos_carroceria')
    .select('id, nombre, codigo, activo')
  if (alLeer) return { ok: false, error: mensajeDeError(alLeer) }
  const iguales = (catalogo ?? []).filter((t) => nombreDeCarroceria(t.nombre) === comoNombre)
  const existente = iguales.find((t) => t.activo) ?? iguales[0]

  if (existente) {
    return {
      ok: true,
      mensaje: `Ese tipo ya estaba en el catálogo: ${existente.nombre}. Quedó elegido.`,
      datos: { id: existente.id, nombre: existente.nombre },
    }
  }

  // El código nuevo sale del nombre; si otra carrocería ya lo usa con otro
  // nombre, lleva un número para no chocar con ella.
  const usados = new Set((catalogo ?? []).map((t) => t.codigo))
  const armado = codigoDeCarroceria(v.nombre)
  let codigo = armado
  for (let n = 2; usados.has(codigo); n++) codigo = `${armado}_${n}`

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
  revalidatePath('/carrocerias')
  return { ok: true, mensaje: 'Tipo de carrocería agregado. Diseño e Ingeniería completa sus medidas en Carrocerías.', datos: data }
}

// Cada regla lleva su aviso: sin él, zod contesta en inglés («Too small:
// expected string to have >=3 characters») y eso es lo que leía la persona.
// Si está activa no lo decide esta ventana: el campo oculto traía lo que había
// al pintarse la página, y guardar el nombre reactivaba la carrocería que otro
// había desactivado mientras tanto. Llega todavía de las pestañas de antes.
const esquemaEditarCarroceria = z.object({
  id: z.guid('No se reconoció la carrocería: vuelve a cargar la pantalla.'),
  nombre: z.string('Escribe un nombre de al menos 3 letras.').trim()
    .min(3, 'Escribe un nombre de al menos 3 letras.')
    .max(120, 'El nombre va en 120 caracteres como máximo.')
    .regex(/[\p{L}\p{N}]/u, 'El nombre debe incluir letras o números.'),
  descripcion: z.string().trim().max(1000, 'La descripción va en 1000 caracteres como máximo.').optional(),
})

/**
 * Ventas corrige por su función, que pide también si está activa: se manda la
 * que tiene ahora, leída con su sesión, para no deshacer lo que otro cambió.
 */
async function editarComoVentas(
  supabase: Awaited<ReturnType<typeof createClient>>,
  v: z.infer<typeof esquemaEditarCarroceria>,
) {
  const { data: actual, error } = await supabase.from('tipos_carroceria').select('activo').eq('id', v.id).maybeSingle()
  if (error || !actual) return { data: null, error }
  return supabase.rpc('editar_carroceria_ventas', { p_id: v.id, p_nombre: v.nombre, p_descripcion: v.descripcion ?? '', p_activo: actual.activo })
}

export async function editarCarroceria(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = esquemaEditarCarroceria.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  const v = analisis.data
  if (!puede(perfil, ['diseno.carrocerias', 'cotizaciones.crear'])) {
    return { ok: false, error: 'No tienes permiso para corregir el catálogo de carrocerías.' }
  }
  const supabase = await createClient()
  // Diseño corrige la fila con su permiso, el mismo que pide la política;
  // Ventas, solo nombre, descripción y si está activa, por su función.
  const resultado = puede(perfil, 'diseno.carrocerias')
    ? await supabase.from('tipos_carroceria').update({ nombre: v.nombre, descripcion: nuloSiVacio(v.descripcion) }).eq('id', v.id).select('id').maybeSingle()
    : await editarComoVentas(supabase, v)
  if (resultado.error) return { ok: false, error: mensajeDeError(resultado.error) }
  if (!resultado.data) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/carrocerias')
  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/configuracion')
  return { ok: true, mensaje: 'Carrocería actualizada.' }
}

const esquemaMedidasCarroceria = z.object({
  id: z.guid(),
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
 * Medidas técnicas de referencia para el catálogo de carrocerías. Las lleva
 * Diseño e Ingeniería (`diseno.carrocerias`, el mismo permiso que acepta la
 * política de `tipos_carroceria`).
 */
export async function guardarMedidasCarroceria(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.carrocerias')) {
    return { ok: false, error: 'No tienes permiso para cambiar las medidas de las carrocerías.' }
  }

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
  revalidatePath('/carrocerias')
  return {
    ok: true,
    mensaje: 'Medidas técnicas guardadas en el catálogo.',
  }
}

/**
 * La cuenta responsable de un área (`areas.jefe_id`), o ninguna. Solo el
 * administrador del sistema: la política `editar_areas` pide lo mismo que
 * `exigirEdicion` (`es_admin()` o `configuracion.editar`, que solo tiene el
 * puesto ADMIN). Que la cuenta esté activa lo exige la base
 * (`fn_area_responsable_activo`, migración 20261125205000).
 */
export async function asignarResponsableDeArea(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const problema = await exigirEdicion()
  if (problema) return { ok: false, error: 'Asignar el responsable de un área es del administrador del sistema.' }

  const analisis = z
    .object({ area_id: z.guid(), jefe_id: z.union([z.literal(''), z.guid()]) })
    .safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Elige una cuenta de la lista.' }
  const v = analisis.data

  const supabase = await createClient()
  // Una cuenta dada de baja no se guarda, tampoco la que ya estaba: se mira
  // antes de escribir. El disparador cubre la que se da de baja entretanto.
  if (v.jefe_id) {
    const { data: elegida, error: errorCuenta } = await supabase
      .from('usuarios')
      .select('activo')
      .eq('id', v.jefe_id)
      .maybeSingle()
    if (errorCuenta) return { ok: false, error: mensajeDeError(errorCuenta) }
    if (!elegida?.activo) {
      revalidatePath('/configuracion')
      return { ok: false, error: CUENTA_YA_NO_ACTIVA }
    }
  }
  const { data, error } = await supabase
    .from('areas')
    .update({ jefe_id: v.jefe_id || null })
    .eq('id', v.area_id)
    // Una fila que el RLS esconde no es un error: sin esto diría «listo» sin
    // haber guardado nada.
    // La cuenta, para saber si sigue activa: el disparador no vuelve a juzgar
    // la que no cambió, y «Guardar» con la dada de baja no es «listo».
    .select('nombre, jefe_heredado, responsable:usuarios!areas_jefe_id_fkey(activo)')
    .maybeSingle()

  if (error) {
    // La cuenta se dio de baja con la ventana abierta (el disparador de la
    // migración 20261125205000): la lista se pone al día y deja de ofrecerla.
    if (error.code === '23514') {
      revalidatePath('/configuracion')
      return { ok: false, error: CUENTA_YA_NO_ACTIVA }
    }
    return { ok: false, error: mensajeDeError(error) }
  }
  if (!data) return { ok: false, error: NO_TOCO_NADA }
  const cuenta = data.responsable as unknown as { activo: boolean } | null
  if (v.jefe_id && !cuenta?.activo) {
    revalidatePath('/configuracion')
    return { ok: false, error: CUENTA_YA_NO_ACTIVA }
  }

  revalidatePath('/configuracion')
  return {
    ok: true,
    mensaje: v.jefe_id
      ? `${data.nombre} ya tiene su cuenta responsable.`
      : // A la que otra área lleva, la base le anota la cuenta de esa (migración 20261126998500).
        data.jefe_heredado
        ? `${data.nombre} quedó sin cuenta propia: responde la del área que la lleva.`
        : `${data.nombre} quedó sin cuenta responsable.`,
  }
}

function nuloSiVacio(valor?: string) {
  const t = valor?.trim()
  return t ? t : null
}
