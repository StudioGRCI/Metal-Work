'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'

const esquemaCotizacion = z.object({
  cliente_id: z.string().uuid('Selecciona un cliente'),
  // El precio lo pone Ventas y manda sobre el papel: el total impreso sale de
  // acá, no de la suma de las partidas. Puede entrar vacío mientras se arma la
  // cotización y escribirse antes de mandarla a costear.
  precio_venta: z.coerce.number().min(0, 'El precio no puede ser negativo').optional(),
  unidad_id: z.string().uuid().optional().or(z.literal('')),
  tipo_carroceria_id: z.string().uuid().optional().or(z.literal('')),
  sede_id: z.string().uuid().optional().or(z.literal('')),
  fecha_emision: z.string().optional(),
  validez_dias: z.coerce.number().int().min(1).max(365).default(15),
  moneda: z.enum(['PEN', 'USD']).default('PEN'),
  plazo_entrega_dias: z.coerce.number().int().min(0).max(999).default(0),
  forma_pago: z.string().trim().optional(),
  condiciones: z.string().trim().optional(),
  observaciones: z.string().trim().optional(),
})

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

export async function crearCotizacion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.crear')) {
    return { ok: false, error: 'No tienes permiso para elaborar cotizaciones.' }
  }

  const analisis = esquemaCotizacion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizaciones')
    .insert({
      cliente_id: v.cliente_id,
      precio_venta: v.precio_venta,
      unidad_id: nulo(v.unidad_id),
      tipo_carroceria_id: nulo(v.tipo_carroceria_id),
      sede_id: nulo(v.sede_id),
      fecha_emision: v.fecha_emision || undefined,
      validez_dias: v.validez_dias,
      moneda: v.moneda,
      plazo_entrega_dias: v.plazo_entrega_dias,
      forma_pago: nulo(v.forma_pago),
      condiciones: nulo(v.condiciones),
      observaciones: nulo(v.observaciones),
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/cotizaciones')
  redirect(`/cotizaciones/${data.id}`)
}

const esquemaPartida = z.object({
  cotizacion_id: z.string().uuid(),
  descripcion: z.string().trim().min(3, 'Describe la partida'),
  detalle: z.string().trim().optional(),
  unidad_medida: z.string().trim().optional(),
  cantidad: z.coerce.number().positive('La cantidad debe ser mayor que cero'),
  precio_unitario: z.coerce.number().min(0, 'El precio no puede ser negativo'),
  descuento_porcentaje: z.coerce.number().min(0).max(100).default(0),
  tipo_costo: z.enum(['MATERIAL', 'MANO_OBRA', 'SERVICIO', 'OTRO']).default('MATERIAL'),
})

export async function agregarPartida(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.editar')) {
    return { ok: false, error: 'No tienes permiso para modificar cotizaciones.' }
  }

  const analisis = esquemaPartida.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la partida.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // La posición se calcula aquí para que las partidas salgan en el orden en que
  // se cargaron; el subtotal lo recalcula la base, no se confía en el cliente.
  const { count } = await supabase
    .from('cotizacion_partidas')
    .select('id', { count: 'exact', head: true })
    .eq('cotizacion_id', v.cotizacion_id)

  const { error } = await supabase.from('cotizacion_partidas').insert({
    cotizacion_id: v.cotizacion_id,
    orden_secuencia: (count ?? 0) + 1,
    descripcion: v.descripcion,
    detalle: nulo(v.detalle),
    unidad_medida: nulo(v.unidad_medida) ?? 'UND',
    cantidad: v.cantidad,
    precio_unitario: v.precio_unitario,
    descuento_porcentaje: v.descuento_porcentaje,
    tipo_costo: v.tipo_costo,
  })

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Partida agregada.' }
}

export async function eliminarPartida(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.editar')) {
    return { ok: false, error: 'No tienes permiso para modificar cotizaciones.' }
  }

  const id = String(datos.get('partida_id') ?? '')
  const cotizacionId = String(datos.get('cotizacion_id') ?? '')
  if (!id || !cotizacionId) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()
  const { error } = await supabase.from('cotizacion_partidas').delete().eq('id', id)

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/cotizaciones/${cotizacionId}`)
  return { ok: true, mensaje: 'Partida eliminada.' }
}

const esquemaEstado = z.object({
  cotizacion_id: z.string().uuid(),
  estado: z.enum([
    'BORRADOR',
    'EN_COSTEO',
    'EN_REVISION',
    'OBSERVADA',
    'REVISADA',
    'ENVIADA',
    'APROBADA',
    'RECHAZADA',
    'VENCIDA',
    'ANULADA',
  ]),
  motivo: z.string().trim().optional(),
})

/**
 * Cada paso del circuito lo da una mano distinta, y el permiso lo dice.
 *
 * Ventas escribe y manda a costear; Administración arma la cotización de trabajo
 * y la sube a revisión; Gerencia da el visto o la devuelve. Registrar la
 * respuesta del cliente —aprobada o rechazada— no es ninguna de las tres: es
 * anotar lo que el cliente contestó, y por eso tiene permiso propio.
 *
 * Este mapa es un espejo del que exige la base en fn_cotizacion_transicion. Acá
 * sirve para dar un mensaje entendible antes de intentarlo; el que manda es el
 * de allá, porque la pantalla esconde botones y quien entra por otra puerta no
 * ve pantallas.
 */
function permisoDelCambio(estado: string) {
  if (estado === 'EN_REVISION') return 'cotizaciones.costear'
  if (estado === 'REVISADA' || estado === 'OBSERVADA') return 'cotizaciones.revisar'
  if (estado === 'APROBADA' || estado === 'RECHAZADA') return 'cotizaciones.aprobar'
  return 'cotizaciones.editar'
}

/** Lo que el sistema responde cuando el paso salió bien, en su idioma. */
const AVISO_DEL_PASO: Record<string, string> = {
  EN_COSTEO: 'Pasó a cotización de trabajo. Administración la tiene en su bandeja.',
  EN_REVISION: 'El costeo quedó listo. Gerencia la tiene para revisar.',
  REVISADA: 'Visto puesto: ya se le puede mandar al cliente.',
  OBSERVADA: 'Devuelta con la observación.',
  BORRADOR: 'Vuelve a ventas.',
  ANULADA: 'Cotización anulada.',
}

export async function cambiarEstadoCotizacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()

  const analisis = esquemaEstado.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'Solicitud inválida.' }
  const { cotizacion_id, estado, motivo } = analisis.data

  if (!puede(perfil, permisoDelCambio(estado))) {
    return { ok: false, error: 'No tienes permiso para este cambio de estado.' }
  }

  // Anular una aprobada deshace lo que el cliente ya aceptó: eso lo decide
  // Gerencia, no quien redacta borradores. La base exige lo mismo; acá se
  // comprueba antes para dar un mensaje entendible en lugar de un error SQL.
  if (estado === 'ANULADA') {
    const supabase = await createClient()
    const { data: previa } = await supabase
      .from('cotizaciones')
      .select('estado')
      .eq('id', cotizacion_id)
      .maybeSingle()

    if (previa?.estado === 'APROBADA' && !puede(perfil, 'cotizaciones.anular')) {
      return {
        ok: false,
        error: 'Anular una cotización aprobada por el cliente le corresponde a Gerencia.',
      }
    }
  }

  if (estado === 'RECHAZADA' && !motivo) {
    return { ok: false, error: 'Indica el motivo del rechazo.' }
  }

  // Devolver una cotización sin decir qué corregir es mandar a alguien a
  // adivinar. La base exige lo mismo; acá se pregunta antes para no gastar el
  // viaje.
  if (estado === 'OBSERVADA' && !motivo) {
    return { ok: false, error: 'Escribe qué es lo que hay que corregir antes de devolverla.' }
  }

  // Anular pide motivo y deja rastro; la base sella quién y cuándo.
  if (estado === 'ANULADA' && !motivo) {
    return { ok: false, error: 'Indica el motivo de la anulación.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizaciones')
    .update({
      estado,
      ...(estado === 'RECHAZADA' ? { motivo_rechazo: motivo } : {}),
      ...(estado === 'ANULADA' ? { motivo_anulacion: motivo } : {}),
      ...(estado === 'OBSERVADA' ? { motivo_observacion: motivo } : {}),
    })
    .eq('id', cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  // Un UPDATE que no encuentra fila no es un error para Postgres: si el RLS la
  // escondió, sin esto la pantalla diría «listo» sin haber movido nada.
  if (!data) {
    return { ok: false, error: 'No se pudo mover la cotización: vuelve a cargar la pantalla.' }
  }

  revalidatePath(`/cotizaciones/${cotizacion_id}`)
  revalidatePath('/cotizaciones')
  return { ok: true, mensaje: AVISO_DEL_PASO[estado] ?? 'Estado actualizado.' }
}

/**
 * Una cotización descargada es una cotización que salió al cliente: al bajar el
 * PDF de un borrador, el documento pasa a ENVIADA sin que nadie tenga que
 * acordarse de marcarlo. La llama la ruta del PDF **después** de armar el
 * archivo: marcar antes dejaba cotizaciones «enviadas» que nunca llegaron a
 * salir porque la descarga había fallado.
 *
 * Si no procede -no es un borrador, no tiene el permiso, o alguien la anuló
 * mientras tanto- no marca nada y la descarga sigue su curso igual: el papel
 * ya está armado y negárselo al vendedor no arregla nada.
 */
export async function marcarEnviadaAlDescargar(cotizacionId: string): Promise<void> {
  if (!z.string().uuid().safeParse(cotizacionId).success) return

  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.editar')) return

  const supabase = await createClient()

  // Una sola sentencia: entre leer el estado y escribirlo, otro pudo anularla.
  // El filtro por estado hace que la carrera termine en cero filas, no en una
  // transición inventada, y el error de la base se registra en lugar de
  // desaparecer.
  //
  // El filtro por total es la misma guarda que ya aplica la ruta del PDF,
  // repetida acá a propósito: una cotización en cero no se envía por ningún
  // camino, ni aunque alguien llame a esta función desde otro sitio.
  const { error } = await supabase
    .from('cotizaciones')
    .update({ estado: 'ENVIADA' })
    .eq('id', cotizacionId)
    // Antes salía desde el borrador: el vendedor bajaba el papel y la cotización
    // se daba por enviada sin que nadie la hubiera mirado. Ahora sale del visto
    // de Gerencia, que es el paso que existe justamente para eso.
    .eq('estado', 'REVISADA')
    .gt('total', 0)

  if (error) {
    console.error('No se pudo marcar la cotización como enviada:', mensajeDeError(error))
    return
  }

  revalidatePath(`/cotizaciones/${cotizacionId}`)
  revalidatePath('/cotizaciones')
}

/**
 * Abre una orden de trabajo a partir de una cotización aprobada y arrastra sus
 * partidas al presupuesto de la orden.
 */
export async function convertirEnOrden(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'ordenes.crear')) {
    return { ok: false, error: 'No tienes permiso para abrir órdenes de trabajo.' }
  }

  const cotizacionId = String(datos.get('cotizacion_id') ?? '')
  const sedeId = String(datos.get('sede_id') ?? '')
  if (!cotizacionId || !sedeId) return { ok: false, error: 'Indica el taller donde se ejecutará.' }

  const supabase = await createClient()

  const { data: cotizacion, error: errorCot } = await supabase
    .from('cotizaciones')
    .select('id, estado, cliente_id, unidad_id, tipo_carroceria_id, moneda, total, plazo_entrega_dias, observaciones, partidas:cotizacion_partidas(descripcion)')
    .eq('id', cotizacionId)
    .maybeSingle()

  if (errorCot) return { ok: false, error: mensajeDeError(errorCot) }
  if (!cotizacion) return { ok: false, error: 'La cotización no existe.' }
  if (cotizacion.estado !== 'APROBADA') {
    return { ok: false, error: 'Solo se puede abrir una orden desde una cotización aprobada.' }
  }

  const { data: existente } = await supabase
    .from('ordenes_trabajo')
    .select('id, numero')
    .eq('cotizacion_id', cotizacionId)
    .maybeSingle()

  if (existente) {
    return { ok: false, error: `Esta cotización ya generó la orden ${existente.numero}.` }
  }

  const partidas = (cotizacion.partidas ?? []) as { descripcion: string }[]
  const descripcion =
    partidas[0]?.descripcion ?? 'Trabajo según cotización aprobada'

  const entrega = cotizacion.plazo_entrega_dias
    ? new Date(Date.now() + cotizacion.plazo_entrega_dias * 86400000).toISOString().slice(0, 10)
    : null

  const { data: orden, error } = await supabase
    .from('ordenes_trabajo')
    .insert({
      cliente_id: cotizacion.cliente_id,
      unidad_id: cotizacion.unidad_id,
      cotizacion_id: cotizacion.id,
      tipo_carroceria_id: cotizacion.tipo_carroceria_id,
      sede_id: sedeId,
      descripcion,
      moneda: cotizacion.moneda,
      monto_presupuestado: cotizacion.total ?? 0,
      fecha_entrega_comprometida: entrega,
      observaciones: cotizacion.observaciones,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  // El presupuesto detallado se arrastra desde las partidas de la cotización.
  const { error: errorPresupuesto } = await supabase.rpc(
    'generar_presupuesto_desde_cotizacion',
    { p_orden_id: orden.id },
  )

  if (errorPresupuesto) {
    // La orden ya quedó creada; se avisa para que el usuario cargue el
    // presupuesto a mano en lugar de dejarlo pensar que todo salió bien.
    revalidatePath('/ordenes')
    return {
      ok: false,
      error: `La orden se creó, pero no se pudo arrastrar el presupuesto: ${errorPresupuesto.message}`,
    }
  }

  revalidatePath('/ordenes')
  revalidatePath(`/cotizaciones/${cotizacionId}`)
  redirect(`/ordenes/${orden.id}`)
}

// =============================================================================
// EDITAR LO QUE YA ESTÁ ESCRITO
// -----------------------------------------------------------------------------
// Hasta acá una cotización se armaba y no se corregía: la partida solo se
// agregaba o se borraba, y la cabecera quedaba como se creó. En el taller una
// cotización se negocia —cambia el plazo, baja el precio, el cliente pide otra
// carrocería— y rehacerla entera solo para corregir una cifra gasta un número
// de la serie sin motivo.
//
// Las tres acciones de acá comprueban que el UPDATE tocó de verdad su fila. Un
// UPDATE que no encuentra fila no es un error para Postgres: si el RLS la
// escondió, la acción respondería «guardado» sin haber guardado nada. Es el
// fallo mudo de las migraciones 036 y 037, y no se repite.
// =============================================================================

const esquemaConcepto = z.object({
  cotizacion_id: z.string().uuid(),
  concepto: z.string().trim().max(400, 'El concepto es demasiado largo').optional(),
  concepto_cantidad: z.coerce.number().positive('La cantidad debe ser mayor que cero').default(1),
  concepto_unidad: z.string().trim().min(1).max(10).default('UND'),
})

/** El nombre del trabajo tal como va impreso, con su cantidad y su unidad. */
export async function editarConcepto(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.editar')) {
    return { ok: false, error: 'No tienes permiso para modificar cotizaciones.' }
  }

  const analisis = esquemaConcepto.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el concepto.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizaciones')
    .update({
      concepto: nulo(v.concepto),
      concepto_cantidad: v.concepto_cantidad,
      concepto_unidad: v.concepto_unidad.toUpperCase(),
    })
    .eq('id', v.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se pudo guardar el concepto: la cotización ya no admite cambios.' }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Concepto guardado.' }
}

const esquemaEdicion = esquemaCotizacion.extend({ cotizacion_id: z.string().uuid() })

/** La cabecera: a quién se le cotiza, sobre qué unidad y con qué condiciones. */
export async function editarCotizacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.editar')) {
    return { ok: false, error: 'No tienes permiso para modificar cotizaciones.' }
  }

  const analisis = esquemaEdicion.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizaciones')
    .update({
      cliente_id: v.cliente_id,
      precio_venta: v.precio_venta,
      unidad_id: nulo(v.unidad_id),
      tipo_carroceria_id: nulo(v.tipo_carroceria_id),
      sede_id: nulo(v.sede_id),
      fecha_emision: v.fecha_emision || undefined,
      validez_dias: v.validez_dias,
      moneda: v.moneda,
      plazo_entrega_dias: v.plazo_entrega_dias,
      forma_pago: nulo(v.forma_pago),
      condiciones: nulo(v.condiciones),
      observaciones: nulo(v.observaciones),
    })
    .eq('id', v.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return { ok: false, error: 'No se pudo guardar: la cotización ya no admite cambios.' }
  }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  revalidatePath('/cotizaciones')
  return { ok: true, mensaje: 'Cotización actualizada.' }
}

const esquemaPartidaEditada = esquemaPartida.extend({ partida_id: z.string().uuid() })

/** Corregir una partida ya cargada, sin tener que quitarla y volver a ponerla. */
export async function editarPartida(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'cotizaciones.editar')) {
    return { ok: false, error: 'No tienes permiso para modificar cotizaciones.' }
  }

  const analisis = esquemaPartidaEditada.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la partida.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // El subtotal no viaja: lo recalcula la base a partir de cantidad, precio y
  // descuento, igual que al agregarla.
  const { data, error } = await supabase
    .from('cotizacion_partidas')
    .update({
      descripcion: v.descripcion,
      detalle: nulo(v.detalle),
      unidad_medida: nulo(v.unidad_medida) ?? 'UND',
      cantidad: v.cantidad,
      precio_unitario: v.precio_unitario,
      descuento_porcentaje: v.descuento_porcentaje,
      tipo_costo: v.tipo_costo,
    })
    .eq('id', v.partida_id)
    .eq('cotizacion_id', v.cotizacion_id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo guardar la partida: la cotización ya está cerrada o no la tienes a la vista.',
    }
  }

  revalidatePath(`/cotizaciones/${v.cotizacion_id}`)
  return { ok: true, mensaje: 'Partida actualizada.' }
}
