import type { Tono } from '@/components/ui/etiqueta-estado'

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** De dónde nace la orden de compra. */
export const ORIGEN_COMPRA: Record<string, Def> = {
  REQUERIMIENTO: { etiqueta: 'Requerimiento', tono: 'neutro', descripcion: 'Nace de una solicitud de materiales de antes de los RQ.' },
  DIRECTA: { etiqueta: 'Directa', tono: 'info', descripcion: 'Logística compra para el almacén, sin requerimiento.' },
  // En la base va como directa (sin la solicitud de una OT), pero compra insumos de uno o varios RQ.
  RQ: { etiqueta: 'De RQ', tono: 'neutro', descripcion: 'Compra insumos de uno o varios requerimientos, cada uno con su código interno.' },
}

/**
 * En qué va el recojo del conductor. Sin recojo, la entrega la marca Logística.
 * «En recojo» lo marca él con «Salgo a recoger» (migración 20261013121000).
 */
export const RECOJO_COMPRA: Record<string, Def> = {
  POR_RECOGER: { etiqueta: 'Pendiente de recojo', tono: 'aviso', descripcion: 'El conductor tiene que ir al proveedor.' },
  EN_RECOJO: { etiqueta: 'En recojo', tono: 'info', descripcion: 'El conductor salió a recogerla al proveedor.' },
  RECOGIDO: { etiqueta: 'Recogida', tono: 'info', descripcion: 'El conductor la tiene y va hacia el almacén.' },
  DEJADO: { etiqueta: 'En almacén', tono: 'exito', descripcion: 'El conductor la dejó; Almacén valida el ingreso.' },
}

/** El intento que no se pudo: la compra volvió a «Por programar» de Logística. */
export const RECOJO_NO_LOGRADO: Def = { etiqueta: 'No se pudo · volvió a Logística', tono: 'aviso', descripcion: 'El conductor avisó que no se pudo recoger, con su motivo.' }

/** El estado del servicio. La aprobación de Gerencia va aparte, en `APROBACION_COMPRA`. */
export const ESTADO_SERVICIO: Record<string, Def> = {
  EMITIDA: { etiqueta: 'Emitida', tono: 'neutro', descripcion: 'Emitida; se inicia cuando Gerencia la aprueba.' },
  EN_EJECUCION: { etiqueta: 'En ejecución', tono: 'info', descripcion: 'El proveedor está haciendo el trabajo.' },
  CONFORME: { etiqueta: 'Conforme', tono: 'exito', descripcion: 'El trabajo volvió bien: Tesorería puede pagar.' },
  ANULADA: { etiqueta: 'Anulada', tono: 'peligro', descripcion: 'Anulada con su motivo.' },
}

/**
 * Por qué una orden de servicio no sale en papel, o `null` si sale. El papel es
 * lo que se le entrega al contratista: sale solo la que Gerencia aprobó. La que
 * se anuló después de aprobada sale con su marca de anulada, como evidencia; la
 * que se anuló antes nunca se le entregó a nadie.
 */
export function servicioSinPapel(aprobacion: string, estado: string): string | null {
  if (aprobacion === 'APROBADA') return null
  if (estado === 'ANULADA') return 'se anuló antes de que Gerencia la aprobara: nunca se entregó al contratista.'
  if (aprobacion === 'RECHAZADA') return 'Gerencia la rechazó. Si el servicio sigue, emite otra.'
  return 'espera la aprobación de Gerencia antes de entregarse al contratista.'
}

export type ValidacionIngreso = 'PENDIENTE' | 'OBSERVADO' | 'VALIDADO' | null

/**
 * Una compra deja una fila por línea en el almacén: PENDIENTE si alguna espera
 * a Almacén; si no, OBSERVADO si alguna se observó; VALIDADO si todas entraron.
 */
export function validacionDeCompra(estados: string[]): ValidacionIngreso {
  if (estados.length === 0) return null
  if (estados.includes('PENDIENTE')) return 'PENDIENTE'
  if (estados.includes('OBSERVADO')) return 'OBSERVADO'
  return 'VALIDADO'
}

/** Lo que hizo Almacén con lo que dejó el conductor, una vez dejado. */
export const VALIDACION_INGRESO: Record<string, Def> = {
  PENDIENTE: { etiqueta: 'Por validar en almacén', tono: 'aviso', descripcion: 'El conductor la dejó; Almacén tiene que validar el ingreso en su kardex.' },
  OBSERVADO: { etiqueta: 'Observada por Almacén', tono: 'peligro', descripcion: 'Almacén no la recibió completa: lee su observación en el kardex.' },
  VALIDADO: { etiqueta: 'Validada por Almacén', tono: 'exito', descripcion: 'Entró al kardex y ya se puede despachar.' },
}

/** Qué le toca hacer ahora a quien mira una compra, en una frase. */
export function situacionCompra(c: {
  aprobacion: string
  recojo: string | null
  entregado_almacen_en: string | null
  /** Solo cuando se sabe: PENDIENTE, OBSERVADO o VALIDADO. */
  validacion?: string | null
}): { etiqueta: string; tono: Tono } {
  if (c.aprobacion === 'POR_APROBAR') return { etiqueta: 'Espera a Gerencia', tono: 'aviso' }
  if (c.aprobacion === 'RECHAZADA') return { etiqueta: 'Rechazada', tono: 'peligro' }
  if (c.aprobacion === 'ANULADA') return { etiqueta: 'Anulada', tono: 'peligro' }
  if (c.recojo === 'DEJADO' && c.validacion && VALIDACION_INGRESO[c.validacion]) {
    const v = VALIDACION_INGRESO[c.validacion]
    return { etiqueta: v.etiqueta, tono: v.tono }
  }
  if (c.recojo) {
    const r = RECOJO_COMPRA[c.recojo]
    return { etiqueta: r?.etiqueta ?? c.recojo, tono: r?.tono ?? 'neutro' }
  }
  if (c.entregado_almacen_en) return { etiqueta: 'Entregada a Almacén', tono: 'exito' }
  return { etiqueta: 'Por mandar a recojo', tono: 'neutro' }
}

/** Una compra se puede mandar a recojo si ya se puede enviar y nadie la llevó todavía. */
export function puedeIrARecojo(c: { aprobacion: string; recojo: string | null; entregado_almacen_en: string | null }) {
  return (c.aprobacion === 'APROBADA' || c.aprobacion === 'NO_REQUERIDA') && !c.recojo && !c.entregado_almacen_en
}

/**
 * La guía de remisión que Contabilidad carga en la gestión de compras
 * (migración 20261015140000): un PDF en este bucket, con la ruta
 * compra/{oc}/{guía}.pdf que la base comprueba.
 */
export const BUCKET_GUIAS_REMISION = 'guias-remision'
export const MAXIMO_MB_GUIA = 10

export function rutaGuiaRemision(compraId: string, guiaId: string) {
  return `compra/${compraId}/${guiaId}.pdf`
}

/** Serie y número como figuran en la guía: T001-00000123. La base exige lo mismo. */
export const NUMERO_GUIA = /^[A-Z0-9]{1,4}-[0-9]{1,10}$/

export function normalizarNumeroGuia(texto: string) {
  return texto.trim().replace(/\s+/g, '').toUpperCase()
}

/** Un número del padrón que el teléfono puede marcar: lo que se lee y lo que marca. */
export type TelefonoParaLlamar = { texto: string; numero: string }

const soloCifras = (t: string) => t.replace(/\D/g, '')

/**
 * Lo que marca un celular en el Perú para un trozo del padrón, o nada si no se
 * sabe a qué número llama:
 * - Celular: 9 cifras que empiezan en 9.
 * - Fijo con su código: el 0 y el código de la ciudad, 9 cifras en total
 *   («(01) 445-5667», «(044) 23-4567»).
 * - Fijo de Lima escrito sin el 01: 7 cifras. Desde un celular no entra sin el
 *   código de la ciudad, así que se le pone; se sigue leyendo como está escrito.
 * - Con el 51 del país, «+51» y el número sin su 0.
 * Seis u ocho cifras sueltas no dicen de qué ciudad son, o son un DNI; once que
 * no empiezan en 51, un RUC: sin botón, y el texto del padrón queda a la vista
 * (`telefonoDiceMas`).
 */
function loQueMarca(trozo: string): string | null {
  const cifras = soloCifras(trozo)
  const conElPais = (resto: string) => {
    const numero = resto.replace(/^0/, '')
    if (numero.length === 9 && numero.startsWith('9')) return `+51${numero}`
    if (numero.length === 8 && !numero.startsWith('9')) return `+51${numero}`
    return null
  }
  if (trozo.trim().startsWith('+')) {
    if (cifras.startsWith('51')) return conElPais(cifras.slice(2))
    return cifras.length >= 8 && cifras.length <= 12 ? `+${cifras}` : null
  }
  if ((cifras.length === 10 || cifras.length === 11) && cifras.startsWith('51')) return conElPais(cifras.slice(2))
  if (cifras.length === 9 && (cifras.startsWith('9') || cifras.startsWith('0'))) return cifras
  if (cifras.length === 7 && !cifras.startsWith('0')) return `01${cifras}`
  return null
}

/**
 * Los números a los que el conductor puede llamar, sacados del teléfono del
 * padrón, que es texto libre: «999 000 111 - 988 000 222», «(01) 445-5667 anexo
 * 205», «Cel. 999000111 RPM #948123». Cada uno con lo que se lee y lo que marca
 * el teléfono. Juntar todos los dígitos en un solo `tel:` marcaba un número que
 * no existe, y un anexo pegado al número, otro que tampoco.
 *
 * Ante la duda no hay botón: lo que no se reconoce queda escrito en la tarjeta
 * (`telefonoDiceMas`) y el conductor lo marca a mano.
 */
export function telefonosParaLlamar(texto: string | null | undefined): TelefonoParaLlamar[] {
  if (!texto) return []
  const vistos = new Set<string>()
  const numeros: TelefonoParaLlamar[] = []
  const sumar = (trozo: string) => {
    const numero = loQueMarca(trozo)
    if (!numero) return false
    // El mismo número escrito con y sin el 51 o el 0 del código es uno solo.
    const llave = numero.replace(/^\+51/, '').replace(/^0/, '')
    if (!vistos.has(llave)) {
      vistos.add(llave)
      numeros.push({ texto: trozo.trim().replace(/[\s.\-–—(]+$/, ''), numero })
    }
    return true
  }
  // Lo que sigue a «anexo», «ext.», «int.» u «opción» no es parte del número, y el fax no se llama: se corta ahí, con sus cifras.
  for (const parte of texto.split(/\b(?:anexos?|anx|extensi[oó]n|ext|interno|int|opci[oó]n|opc|fax)\b\.?\s*:?\s*[\d\s-]*\d|\b(?:anexos?|anx|extensi[oó]n|ext|interno|int|opci[oó]n|opc|fax)\b\.?/i)) {
    // Cada tirada de cifras con sus espacios, guiones, puntos y paréntesis.
    // «(+51) 999…» empieza en el paréntesis, para que el texto no quede con uno suelto.
    for (const hallado of parte.matchAll(/\(?\+?\(?\d[\d\s().\-–—]*\d/g)) {
      const candidato = hallado[0]
      const antes = parte.slice(0, hallado.index)
      // «RPM #948123» y «*123456» son claves de la red de antes, no números: no se marcan desde cualquier teléfono.
      if (/[#*]\s*$/.test(antes)) continue
      if (/\b(?:rpm|rpc)\b\W*$/i.test(antes) && soloCifras(candidato).length !== 9) continue
      const porGuion = candidato.split(/\s*[-–—]\s*/).filter(Boolean)
      // «4455667-123» y «999000111-12»: un número entero y, tras el guion, su anexo. Solo si lo de
      // antes del guion ya es un número completo: en «51 (01) 445-5667», «51 (01) 445» no lo es.
      const antesDelGuion = porGuion[0]?.trim() ?? ''
      const completo = /^\d{7}$/.test(antesDelGuion) || /^[09]\d{8}$/.test(soloCifras(antesDelGuion))
      if (!candidato.startsWith('+') && porGuion.length === 2 && completo && soloCifras(porGuion[1]).length <= 4) {
        sumar(porGuion[0])
        continue
      }
      if (sumar(candidato)) continue
      // Dos números unidos por un guion o seguidos sin separador: cada trozo, si sirve solo.
      const sueltos = porGuion.length > 1 && porGuion.every(loQueMarca) ? porGuion : candidato.split(/\s+/).filter(Boolean)
      if (sueltos.length > 1 && sueltos.every(loQueMarca)) {
        sueltos.forEach(sumar)
        continue
      }
      // Dos celulares escritos de corrido, «999 000 111 988 000 222»: nueve cifras cada uno, los dos con su 9.
      const cifras = soloCifras(candidato)
      if (cifras.length === 18 && !candidato.includes('+') && cifras[0] === '9' && cifras[9] === '9') {
        for (const celular of [cifras.slice(0, 9), cifras.slice(9)]) sumar(celular.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'))
      }
    }
  }
  return numeros
}

/**
 * Si el teléfono del padrón dice algo que los botones de llamar no dicen: un
 * anexo, un nombre, un horario, una clave RPM o un número que no se reconoció.
 * Entonces la tarjeta lo muestra entero además de los botones. «Cel.» y «Tel.»
 * delante de un número no cuentan.
 */
export function telefonoDiceMas(texto: string | null | undefined, numeros: TelefonoParaLlamar[]) {
  if (!texto) return false
  const sinRotulos = texto.replace(/(?:cel(?:ular)?|tel[eé]fonos?|telf?|fijo|m[oó]vil)\.?\s*:?(?![\p{L}])/giu, '')
  if (/[\p{L}#*]/u.test(sinRotulos)) return true
  return soloCifras(texto).length !== numeros.reduce((suma, t) => suma + soloCifras(t.texto).length, 0)
}

/**
 * Las fotos que el conductor suma al marcar «Ya la recogí»: la guía firmada o el
 * bulto. Opcionales, hasta tres y de hasta 5 MB, como exige la base (migración
 * 20261125500000). Van en `{cuenta}/{compra}/` del bucket privado.
 */
export const BUCKET_FOTOS_RECOJO = 'fotos-recojo'
export const MAXIMO_FOTOS_RECOJO = 3
export const MAXIMO_MB_FOTO_RECOJO = 5

/** «No se pudo recoger»: el motivo que lee Logística para volver a programarla. Lo mismo exige la base. */
export const MOTIVO_NO_LOGRADO = { minimo: 10, maximo: 500 }

/** La dirección del proveedor en el mapa del teléfono: abre la aplicación de mapas si la hay, o el navegador. */
export function enlaceAlMapa(direccion: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`
}

/**
 * Lo que el conductor recogió y dejó en un día, en el orden en que pasó. Sale
 * de las horas que ya guarda cada compra; no hay otra tabla.
 */
export type PasoDelDia = { compra: string; nombre: string; proveedor: string; paso: 'RECOGIDO' | 'DEJADO' | 'NO_LOGRADO'; en: string }

/**
 * También el último «No se pudo recoger» de hoy (`no_logrado`): la compra sale
 * de la lista del conductor y, sin esta línea, no quedaba en ningún lado de su
 * pantalla que lo avisó.
 */
export function pasosDelDia(
  compras: {
    id: string
    nombre: string
    proveedor: string
    recogido_en: string | null
    dejado_en: string | null
    no_logrado?: { registrado_en: string } | null
  }[],
  dia: string,
  diaDe: (instante: string) => string,
): PasoDelDia[] {
  const pasos: PasoDelDia[] = []
  for (const c of compras) {
    if (c.recogido_en && diaDe(c.recogido_en) === dia) pasos.push({ compra: c.id, nombre: c.nombre, proveedor: c.proveedor, paso: 'RECOGIDO', en: c.recogido_en })
    if (c.dejado_en && diaDe(c.dejado_en) === dia) pasos.push({ compra: c.id, nombre: c.nombre, proveedor: c.proveedor, paso: 'DEJADO', en: c.dejado_en })
    const intento = c.no_logrado?.registrado_en
    if (intento && diaDe(intento) === dia) pasos.push({ compra: c.id, nombre: c.nombre, proveedor: c.proveedor, paso: 'NO_LOGRADO', en: intento })
  }
  return pasos.sort((a, b) => new Date(a.en).getTime() - new Date(b.en).getTime())
}

/**
 * Para qué es una compra por aprobar: el código y el RQ de cada insumo, la OT y
 * su unidad, o el almacén en la compra directa. Lo dicen igual Aprobación de
 * compras y «Por decidir».
 */
export function destinoDeCompra(c: {
  tipo: 'OC' | 'OS'
  origen: string
  requerimientos: string[]
  codigos: string[]
  codigo_interno: string | null
  ordenes: string[]
  unidades: string[]
}): string {
  // La que compra insumos de RQ va al código interno de cada uno.
  if (c.requerimientos.length > 0) return [c.codigos.join(', '), c.requerimientos.join(', ')].filter(Boolean).join(' · ')
  if (c.origen === 'DIRECTA') return 'Para el almacén'
  const partes = [c.codigo_interno, c.ordenes.length ? `OT ${c.ordenes.join(', ')}` : null, ...c.unidades].filter(Boolean)
  return partes.length ? partes.join(' · ') : c.tipo === 'OS' ? 'Sin OT' : 'OT —'
}
