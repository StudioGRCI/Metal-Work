'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { hoyLima } from '@/lib/format'

const esquemaCotizacion = z.object({
  cliente_id: z.string().uuid('Selecciona un cliente'),
  // El precio lo pone Ventas y manda sobre el papel: el total impreso sale de
  // acá, no de la suma de las partidas. Puede entrar vacío mientras se arma la
  // cotización y escribirse antes de mandarla a costear.
  precio_venta: z.coerce.number().min(0, 'El precio no puede ser negativo').optional(),
  unidad_id: z.string().uuid().optional().or(z.literal('')),
  // Quién vende y a quién se le dirige el papel. Los dos salen impresos —el
  // vendedor firma abajo y el contacto encabeza el «Señores»— y hasta ahora no
  // había dónde escribirlos: el vendedor se heredaba del cliente si alguien se
  // lo había asignado alguna vez, y el contacto no se llenaba nunca, así que la
  // cotización salía con «Atención —» y «Correo —».
  vendedor_id: z.string().uuid().optional().or(z.literal('')),
  contacto_id: z.string().uuid().optional().or(z.literal('')),
  tipo_carroceria_id: z.string().uuid().optional().or(z.literal('')),
  sede_id: z.string().uuid().optional().or(z.literal('')),
  fecha_emision: z.string().optional(),
  validez_dias: z.coerce.number().int().min(1).max(365).default(15),
  moneda: z.enum(['PEN', 'USD']).default('PEN'),
  plazo_entrega_dias: z.coerce.number().int().min(0).max(999).default(0),
  forma_pago: z.string().trim().optional(),
  condiciones: z.string().trim().optional(),
  observaciones: z.string().trim().optional(),
  // Los cuatro datos que la casa escribe en todas sus cotizaciones y que hasta
  // ahora no tenían dónde guardarse: terminaban a mano dentro de «observaciones»
  // o se perdían. Llevan el mismo nombre que su columna (migración 045).
  //
  // Desde cuándo cuenta el plazo —«después de emitida la orden de compra», «a
  // partir del abono en la cuenta de la empresa»—, la garantía tal como se
  // redacta y partida por sistema, la tolerancia del peso —«+/- 5%»— y las
  // advertencias en negativo, que no son accesorios sino lo contrario: «NO
  // INCLUYE AROS NI LLANTAS».
  plazo_desde: z.string().trim().optional(),
  garantia_texto: z.string().trim().optional(),
  peso_tolerancia: z.string().trim().optional(),
  no_incluye: z.string().trim().optional(),
})

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

type CabeceraCotizacion = Database['public']['Tables']['cotizaciones']['Insert']

/**
 * Los cuatro rótulos que la casa escribe en todas sus cotizaciones.
 *
 * Van opcionales a propósito: los escriben dos pantallas distintas —el plazo
 * entra por la cabecera y los otros tres por la ficha técnica— y una clave que
 * no viajó no es una clave vacía. Si se mandaran siempre, el formulario que no
 * las tiene las pondría en nulo y borraría lo que la otra pantalla guardó.
 */
type RotulosDeLaCasa = {
  plazo_desde?: string | null
  garantia_texto?: string | null
  peso_tolerancia?: string | null
  no_incluye?: string | null
}

/**
 * La cabecera tal como se guarda. Es la misma en el alta y en la edición, y por
 * eso se arma en un solo sitio: escrita dos veces, un campo nuevo entra por una
 * y se olvida en la otra —que es justo lo que había pasado con estos cuatro—.
 */
function cabeceraGuardable(
  v: z.infer<typeof esquemaCotizacion>,
): CabeceraCotizacion & RotulosDeLaCasa {
  return {
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
    // Estos cuatro los escriben dos pantallas distintas: el plazo entra por la
    // cabecera y los otros tres por la ficha técnica. Si se mandaran siempre,
    // el formulario que no los tiene los enviaría vacíos y la primera
    // corrección de cabecera borraría lo que la ficha guardó, sin avisar. Solo
    // viaja lo que de verdad venía en el formulario.
    // Con `soloSiVino` y no directos: la pantalla de ficha técnica guarda la
    // misma fila sin preguntar por el vendedor ni por el contacto, y mandarlos
    // siempre los borraría en cuanto Administración tocara la ficha.
    ...soloSiVino('vendedor_id', v.vendedor_id),
    ...soloSiVino('contacto_id', v.contacto_id),
    ...soloSiVino('plazo_desde', v.plazo_desde),
    ...soloSiVino('garantia_texto', v.garantia_texto),
    ...soloSiVino('peso_tolerancia', v.peso_tolerancia),
    ...soloSiVino('no_incluye', v.no_incluye),
  }
}

/**
 * Un campo que el formulario no trajo no se toca; uno que trajo vacío se borra
 * a propósito. La diferencia entre «no me lo preguntaron» y «lo dejé en blanco»
 * es la que hace que dos pantallas puedan escribir la misma fila sin pisarse.
 */
function soloSiVino(clave: string, valor: string | undefined) {
  return valor === undefined ? {} : { [clave]: nulo(valor) }
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
    .insert(cabeceraGuardable(v) as CabeceraCotizacion)
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
  // Quien escribe la cotización y quien la costea son dos áreas distintas, y las
  // políticas de la base aceptan a las dos. Pedir solo `editar` dejaba a
  // Administración mirando botones que no funcionaban.
  if (!puede(perfil, ['cotizaciones.editar', 'cotizaciones.costear'])) {
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
  // Quien escribe la cotización y quien la costea son dos áreas distintas, y las
  // políticas de la base aceptan a las dos. Pedir solo `editar` dejaba a
  // Administración mirando botones que no funcionaban.
  if (!puede(perfil, ['cotizaciones.editar', 'cotizaciones.costear'])) {
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
function permisoDelCambio(estado: string): string[] {
  if (estado === 'EN_REVISION') return ['cotizaciones.costear']
  if (estado === 'REVISADA' || estado === 'OBSERVADA') return ['cotizaciones.revisar']
  if (estado === 'APROBADA' || estado === 'RECHAZADA') return ['cotizaciones.aprobar']
  // Anular una aprobada es de Gerencia, que tiene `anular` y no `editar`. Si
  // acá se pidiera solo `editar`, el único que ve el botón sería el único al
  // que la acción rechaza: la base distingue el caso por su cuenta.
  if (estado === 'ANULADA') return ['cotizaciones.editar', 'cotizaciones.anular']
  // Mandar a costear lo hace Ventas; retomar el costeo de una devuelta y
  // devolverla a ventas, Administración. Las dos manos entran por acá.
  return ['cotizaciones.editar', 'cotizaciones.costear']
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
 * Días corridos sobre una fecha plana (YYYY-MM-DD). La cuenta va en UTC a
 * propósito: la fecha de partida ya viene resuelta en hora de Lima y volver a
 * pasarla por la zona del servidor la correría un día.
 */
function sumarDiasCorridos(desde: string, dias: number): string {
  const fecha = new Date(`${desde}T00:00:00Z`)
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

/**
 * Lo que se espera gastar en UNA unidad, que es lo que presupuesta una orden.
 *
 * Si nadie costeó la cotización el resultado es cero, y así queda: la orden
 * nace sin presupuesto y la pantalla de costos muestra todo el gasto como
 * desviación. Es feo y es cierto. Rellenarlo con el precio de venta sería
 * cómodo y mentiroso —el taller vería en verde un trabajo que se pasó—, que es
 * exactamente lo que hacía antes.
 */
function presupuestoDeUnaUnidad(cotizacion: {
  costo_estimado?: number | null
  concepto_cantidad?: number | null
  tipo_cambio?: number | null
}): number {
  const unidades = Math.max(Number(cotizacion.concepto_cantidad) || 1, 1)
  // El cambio pasa la cifra a soles. En una cotización en soles vale 1 —eso lo
  // fija la base, no la falta de dato— así que la cuenta es la misma para las
  // dos monedas y no hace falta preguntar por la moneda acá.
  const aSoles = Number(cotizacion.tipo_cambio) || 1
  return Math.round(((Number(cotizacion.costo_estimado) || 0) * aSoles) / unidades * 100) / 100
}

/**
 * La ficha técnica de la cotización, en el texto que el taller lee en la orden.
 * Cada sección con sus líneas debajo, en el orden en que se imprimieron.
 */
function fichaComoTexto(
  lineas: { seccion: string; etiqueta: string | null; detalle: string }[],
): string | null {
  if (lineas.length === 0) return null

  const renglones: string[] = []
  let seccion: string | null = null

  for (const linea of lineas) {
    if (linea.seccion !== seccion) {
      if (seccion !== null) renglones.push('')
      seccion = linea.seccion
      renglones.push(seccion)
    }
    renglones.push(linea.etiqueta ? `- ${linea.etiqueta}: ${linea.detalle}` : `- ${linea.detalle}`)
  }

  return renglones.join('\n')
}

/**
 * Abre una orden de trabajo a partir de una cotización aprobada y baja con ella
 * lo que se le prometió al cliente por escrito: el presupuesto, la ficha técnica
 * —espesores y medidas—, los accesorios y la fecha de entrega contada como la
 * cuenta la casa.
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
    // El concepto es el nombre del trabajo que se imprimió; `plazo_en_habiles`
    // dice cómo se cuenta el plazo, y las medidas son las que el taller va a
    // fabricar. Sin traerlos, la orden nace con el nombre de una partida y con
    // una fecha contada en días corridos.
    .select(
      'id, estado, cliente_id, unidad_id, tipo_carroceria_id, moneda, tipo_cambio, total, costo_estimado, concepto, concepto_cantidad, plazo_entrega_dias, plazo_en_habiles, largo_m, ancho_m, alto_m, capacidad, observaciones, partidas:cotizacion_partidas(descripcion)',
    )
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

  // Lo que no se pudo bajar se junta acá y se avisa al final: la orden se crea
  // igual, pero nadie se queda creyendo que bajó completa.
  const avisos: string[] = []

  // La ficha técnica de la cotización —espesores, normas de soldadura, medidas—
  // es lo que el taller tiene que fabricar, y hasta ahora se quedaba en el papel
  // del cliente. Se lee con la misma llave que la cotización, así que quien
  // llegó hasta acá ya la tiene.
  const { data: lineasFicha, error: errorFicha } = await supabase
    .from('cotizacion_especificaciones')
    .select('seccion, etiqueta, detalle')
    .eq('cotizacion_id', cotizacionId)
    .order('orden_seccion')
    .order('orden_linea')

  if (errorFicha) avisos.push(`no bajó la ficha técnica: ${mensajeDeError(errorFicha)}`)

  // El tablero del taller nombra la unidad con esta descripción. Tiene que ser
  // el concepto —el nombre del trabajo que se le imprimió al cliente—, no la
  // primera partida del presupuesto: «Plancha ASTM A-36 de 6 mm» no nombra a
  // ninguna unidad.
  const partidas = (cotizacion.partidas ?? []) as { descripcion: string }[]
  const descripcion =
    nulo(cotizacion.concepto) ?? partidas[0]?.descripcion ?? 'Trabajo según cotización aprobada'

  // La casa promete SIEMPRE en días hábiles: 45 días hábiles contados corridos
  // caen nueve días antes de lo prometido, y el semáforo de atraso mediría
  // contra esa fecha inventada. La cuenta la hace la base, que es la que tiene
  // el calendario laboral —domingos y feriados—, con la misma función que ya
  // usan las órdenes de servicio.
  //
  // Y se parte del día del taller: `Date.now()` en el servidor está en UTC, y
  // toda orden abierta después de las siete de la noche se fechaba un día más
  // adelante.
  const hoy = hoyLima()
  let entrega: string | null = null

  if (cotizacion.plazo_entrega_dias) {
    if (cotizacion.plazo_en_habiles) {
      const { data: fechaHabil, error: errorFecha } = await supabase.rpc('sumar_dias_habiles', {
        p_desde: hoy,
        p_dias: cotizacion.plazo_entrega_dias,
      })

      // Todavía no se creó nada: se para acá antes que abrir la orden con una
      // fecha comprometida inventada, que es contra la que después se mide el
      // atraso y por la que responde la empresa.
      if (errorFecha) {
        return {
          ok: false,
          error: `No se pudo calcular la fecha de entrega con el calendario laboral: ${mensajeDeError(errorFecha)}`,
        }
      }

      entrega = fechaHabil
    } else {
      entrega = sumarDiasCorridos(hoy, cotizacion.plazo_entrega_dias)
    }
  }

  const { data: orden, error } = await supabase
    .from('ordenes_trabajo')
    .insert({
      cliente_id: cotizacion.cliente_id,
      unidad_id: cotizacion.unidad_id,
      cotizacion_id: cotizacion.id,
      tipo_carroceria_id: cotizacion.tipo_carroceria_id,
      sede_id: sedeId,
      descripcion,
      // La orden va SIEMPRE en soles, aunque se haya cotizado en dólares. No es
      // un detalle de formato: el costo real que se le va a comparar —material
      // del almacén, horas del personal, indirectos— está todo en soles. Una
      // orden en dólares con gastos en soles compara peras con manzanas y la
      // desviación deja de significar nada. El puente es el tipo de cambio que
      // la cotización congeló, y por eso queda escrito en ella.
      moneda: 'PEN',
      // El presupuesto de la orden es lo que se espera GASTAR, no lo que se le
      // cobró al cliente: contra él se mide después la desviación del taller.
      // Hasta el circuito de tres manos daba igual —el total de la cotización
      // era la suma de las partidas— pero desde que Ventas fija el precio y
      // Administración costea, `total` es el precio de venta y `costo_estimado`
      // el costo. Copiar el total hacía nacer la orden con el precio, y un
      // trabajo 50 % pasado de costo se veía en verde.
      //
      // Y va dividido: la cotización es por todo el lote —el papel imprime el
      // unitario dividiendo igual— mientras que cada orden es de una unidad.
      monto_presupuestado: presupuestoDeUnaUnidad(cotizacion),
      fecha_entrega_comprometida: entrega,
      observaciones: cotizacion.observaciones,
      // Las medidas prometidas van a las columnas de la sección 4 del formato de
      // OT; el resto de la ficha, al texto que el taller lee al costado.
      largo_m: cotizacion.largo_m,
      ancho_m: cotizacion.ancho_m,
      alto_m: cotizacion.alto_m,
      capacidad_carga: cotizacion.capacidad,
      especificaciones_tecnicas: fichaComoTexto(lineasFicha ?? []),
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
    avisos.push(`no se pudo arrastrar el presupuesto: ${mensajeDeError(errorPresupuesto)}`)
  }

  // Los accesorios que se cotizaron son los que el taller tiene que montar y
  // verificar antes de entregar. `armar_ficha_ot` los copia a la ficha de la OT
  // y baja además los pasos de verificación de esa carrocería.
  //
  // Va por la función y no por un insert propio a propósito: escribir
  // `ot_accesorios` desde acá exigiría `ordenes.editar`, que quien abre órdenes
  // no tiene por qué tener. La función corre con permisos propios y es
  // idempotente —no copia si ya hay ficha—, así que el disparador que la vuelve
  // a llamar cuando la orden deja de ser borrador no duplica nada.
  //
  // Se baja ya, con la orden recién abierta y todavía en borrador, porque acá la
  // carrocería no está por decidirse: la fijó la cotización que el cliente
  // aprobó, y el taller necesita la lista desde el primer día.
  const { error: errorFichaOT } = await supabase.rpc('armar_ficha_ot', { p_orden: orden.id })

  if (errorFichaOT) {
    avisos.push(
      `no bajaron los accesorios ni los pasos de verificación: ${mensajeDeError(errorFichaOT)}`,
    )
  }

  revalidatePath('/ordenes')
  revalidatePath(`/cotizaciones/${cotizacionId}`)

  // La orden ya quedó creada; se dice qué falta para que se cargue a mano en
  // lugar de dejar pensar que todo salió bien.
  if (avisos.length > 0) {
    return { ok: false, error: `La orden se creó, pero ${avisos.join('; ')}.` }
  }

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
  // Esto es de Ventas y solo de Ventas: el precio y el nombre del trabajo son lo
  // que se le prometió al cliente. Quien costea arma el detalle, no cambia la
  // promesa.
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
  // Esto es de Ventas y solo de Ventas: el precio y el nombre del trabajo son lo
  // que se le prometió al cliente. Quien costea arma el detalle, no cambia la
  // promesa.
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
    .update(cabeceraGuardable(v) as CabeceraCotizacion)
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
  // Quien escribe la cotización y quien la costea son dos áreas distintas, y las
  // políticas de la base aceptan a las dos. Pedir solo `editar` dejaba a
  // Administración mirando botones que no funcionaban.
  if (!puede(perfil, ['cotizaciones.editar', 'cotizaciones.costear'])) {
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

/**
 * Borrar un borrador que nunca salió de la oficina.
 *
 * La regla de la casa —un documento numerado no se borra— sigue en pie y la
 * defiende la base: una cotización enviada, revisada o aprobada se anula con su
 * motivo y queda como evidencia. Pero un borrador es una hoja a medio escribir;
 * obligar a anularlo llena la lista de papeles anulados que nadie emitió.
 */
export async function eliminarCotizacion(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['cotizaciones.editar', 'cotizaciones.anular'])) {
    return { ok: false, error: 'No tienes permiso para borrar cotizaciones.' }
  }

  const id = String(datos.get('cotizacion_id') ?? '')
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Solicitud inválida.' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cotizaciones')
    .delete()
    // El filtro por estado hace que una carrera —alguien la envía mientras otro
    // la borra— termine en cero filas y no en un documento emitido que
    // desaparece.
    .eq('id', id)
    .eq('estado', 'BORRADOR')
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) {
    return {
      ok: false,
      error: 'No se pudo borrar: la cotización ya salió de borrador. Anúlala con su motivo.',
    }
  }

  revalidatePath('/cotizaciones')
  redirect('/cotizaciones')
}
