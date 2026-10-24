/**
 * Lo que una ventana puede preguntar a la base al volver a abrirse tras «No
 * llegó la respuesta»: si aquel envío entró (`useIdDelEnvio`, `consultarEnvio`).
 * Cada clave es una tabla donde el id del envío queda como id de la fila; la
 * transferencia, como `origen_id` de sus dos movimientos.
 */
export const CLAVES_DEL_ENVIO = [
  'requerimiento',
  'orden_compra',
  // La del tablero de la OT, que se emite sin factura ni comprobante.
  'orden_compra_del_tablero',
  'orden_servicio',
  'subcontrato',
  'contrato_subcontrato',
  'recibo_honorarios',
  'pago_recibo',
  'documento_compra',
  'documento_servicio',
  'factura_venta',
  'cobro_factura',
  'pago_factura',
  'toma_de_la_boleta',
  'pago_compra',
  'devolucion_compra',
  'pago_servicio',
  'pago_parte_boleta',
  'nota_credito',
  'reembolso_nota_credito',
  'movimiento_almacen',
  'movimiento_caja',
  'transferencia_caja',
] as const

export type ClaveDelEnvio = (typeof CLAVES_DEL_ENVIO)[number]

/**
 * Cuántos envíos pendientes de un mismo lugar pregunta la ventana de una vez:
 * uno por cada cuenta que pasó por la pestaña sin que se supiera si entró.
 */
export const MAXIMO_PENDIENTES = 5

/**
 * Lo que la base dice de un envío que entró (`consultarEnvio`), para que la
 * ventana lo cuente (`contarLoQueEntro`).
 */
export type LoQueEntro = {
  /** «La orden de compra», «El pago». */
  sujeto: string
  /** «Las órdenes de compra», «Los pagos»: para decir varios en una frase. */
  plural: string
  /** El número, el monto o el archivo; `null` si no hay qué nombrar. */
  detalle: string | null
  /** El archivo que no salió con él (la factura de la OC); `null` si nada. */
  falta: Falta | null
  /** «Lo que registres ahora será otra.» */
  cierre: string
  /** El puesto de la cuenta que lo registró, si no fue la de la sesión; `null` si fue ella. */
  autor: string | null
}

/** «Si le elegiste {que}, no se adjuntó: adjúntalo {donde}.» */
export type Falta = {
  /** «factura o comprobante», «contrato». */
  que: string
  /** «desde la fila de la orden». */
  donde: string
  /** Lo mismo para varios: «desde la fila de cada orden». */
  dondeVarios: string
}

/** Cuando lo que entró es de clases distintas, el cierre no toma el género de la primera. */
const CIERRE_DE_VARIAS = 'Lo que registres ahora irá aparte.'

/**
 * La nota de la ventana con lo que entró: lo de la sesión en una sola frase
 * —con cinco juntas, «que enviaste antes sí quedó» y «Lo que registres ahora»
 * salían cinco veces (vigesimoprimera pasada)—, y lo que salió de esta pestaña
 * a nombre de otra cuenta, con su número y quién tenía la sesión: antes decía
 * «a nombre de la cuenta que entró», y quien acababa de volver a entrar creía
 * que era ella.
 *
 * Los números van en orden, lo que falta se dice de los que les falta —en
 * plural si son varios— y el cierre es neutro si lo que entró es de clases
 * distintas: la factura y el comprobante no son ni «otra» ni «otro»
 * (vigesimosegunda pasada).
 */
export function contarLoQueEntro(propios: readonly LoQueEntro[], deOtra: LoQueEntro | null = null): string {
  const frases: string[] = []
  if (propios.length === 1) {
    const [lo] = propios
    frases.push(`${lo.sujeto} que enviaste antes sí quedó${conDetalle(lo.detalle)}.${decirLoQueFalta(propios)}`)
  } else if (propios.length > 1) {
    // De la misma clase van con su plural; si no (la factura y el comprobante de una OC), cada uno con su nombre.
    const iguales = propios.every((p) => p.plural === propios[0].plural)
    const enOrden = [...propios].sort((a, b) => (a.detalle ?? '').localeCompare(b.detalle ?? '', 'es', { numeric: true }))
    const detalles = iguales
      ? enOrden.flatMap((p) => (p.detalle ? [p.detalle] : []))
      : enOrden.map((p) => (p.detalle ? `${minuscula(p.sujeto)} ${p.detalle}` : minuscula(p.sujeto)))
    const sujeto = iguales ? `${propios[0].plural} que enviaste antes sí quedaron` : 'Lo que enviaste antes sí quedó'
    frases.push(`${sujeto}${conDetalle(enumerar(detalles))}.${decirLoQueFalta(enOrden)}`)
  }
  if (deOtra) {
    frases.push(
      `${deOtra.sujeto} que se envió antes desde esta pestaña sí quedó, a nombre de ${deOtra.autor ?? 'otra cuenta'}, que tenía la sesión${conDetalle(deOtra.detalle)}.`,
    )
  }
  const cierres = new Set([...propios, ...(deOtra ? [deOtra] : [])].map((lo) => lo.cierre))
  const cierre = cierres.size === 1 ? [...cierres][0] : cierres.size > 1 ? CIERRE_DE_VARIAS : null
  return (cierre ? [...frases, cierre] : frases).join(' ')
}

/**
 * Lo que no salió con lo que entró. Con uno solo, como siempre; con varios, se
 * nombra a cuáles les falta si no es a todos, y en plural si son más de uno.
 */
function decirLoQueFalta(lista: readonly LoQueEntro[]) {
  const grupos = new Map<string, { falta: Falta; detalles: (string | null)[] }>()
  for (const lo of lista) {
    if (!lo.falta) continue
    const llave = `${lo.falta.que}|${lo.falta.donde}`
    const grupo = grupos.get(llave) ?? { falta: lo.falta, detalles: [] }
    grupo.detalles.push(lo.detalle)
    grupos.set(llave, grupo)
  }
  return [...grupos.values()]
    .map(({ falta, detalles }) => {
      const nombrados = detalles.flatMap((d) => (d ? [d] : []))
      const a = detalles.length < lista.length && nombrados.length === detalles.length ? ` a ${enumerar(nombrados)}` : ''
      return detalles.length > 1
        ? ` Si${a} les elegiste ${falta.que}, no se adjuntó: adjúntalos ${falta.dondeVarios}.`
        : ` Si${a} le elegiste ${falta.que}, no se adjuntó: adjúntalo ${falta.donde}.`
    })
    .join('')
}

function conDetalle(detalle: string | null) {
  return detalle ? `: ${detalle}` : ''
}

function minuscula(texto: string) {
  return texto.charAt(0).toLowerCase() + texto.slice(1)
}

/** «a», «a y b», «a, b y c». */
function enumerar(partes: readonly string[]) {
  if (partes.length === 0) return null
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
}
