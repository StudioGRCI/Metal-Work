/**
 * Leer la cabecera de una cotización de la casa (migración 102).
 *
 * Las cotizaciones se arman en Word y salen en PDF con texto de verdad, y todas
 * abren igual —comprobado con la 3522-2025 y la 3668-2026—:
 *
 *   COTIZACION N° 3522- 2025          ← a veces «N° 3668 – 2026», con guion largo
 *   Fecha   : 24/09/2025
 *   Señores : SULLON CARMEN JOSE GUILLERMO
 *   RUC     : 10028410625
 *   FURGÓN SEMIREMOLQUE CRUCERO DOBLE NIVEL - SUSPENSION NEUMÁTICA   ← el título
 *
 * De ahí sale todo lo que el formulario necesita. El nombre del archivo sigue
 * otra costumbre de la casa («COT. N° 3522- PRODUCTO - CLIENTE 24-09-25.pdf»)
 * y rellena lo que el texto no dio, que pasa con un PDF escaneado.
 *
 * Dos trampas que ya estaban en los papeles:
 *   · El membrete trae «RUC:20601538840», que es el de Metal Work. Ese no es
 *     nunca el del cliente.
 *   · Los campos de la ficha se copian de una cotización a otra: la 3668 es una
 *     cama baja y su «TIPO» dice «TOLVA VOLQUETE GRANELERA». Lo que se fabrica
 *     se lee del título, no de la ficha.
 *
 * Sin imports a propósito: se prueba con node contra los PDF reales.
 */

export const RUC_METAL_WORK = '20601538840'

export type DocumentoCliente = { tipo: 'RUC' | 'DNI'; numero: string }

export type CabeceraCotizacion = {
  numero: string | null
  /** YYYY-MM-DD */
  fecha: string | null
  cliente: string | null
  documento: DocumentoCliente | null
  /** El título, tal como lo escribió Ventas. */
  producto: string | null
}

const VACIA: CabeceraCotizacion = { numero: null, fecha: null, cliente: null, documento: null, producto: null }

const limpiar = (t: string) => t.replace(/\s+/g, ' ').trim()

function documentoDe(tipo: string, numero: string): DocumentoCliente | null {
  if (numero === RUC_METAL_WORK) return null
  if (/^\d{11}$/.test(numero)) return { tipo: 'RUC', numero }
  if (/^\d{8}$/.test(numero) && tipo.toUpperCase() === 'DNI') return { tipo: 'DNI', numero }
  return null
}

/** Lo que dice la primera hoja. */
export function leerTextoDeCotizacion(texto: string): CabeceraCotizacion {
  const lineas = texto
    .split(/\r?\n/)
    .map(limpiar)
    .filter(Boolean)
  if (lineas.length === 0) return { ...VACIA }

  const todo = lineas.join('\n')
  const salida: CabeceraCotizacion = { ...VACIA }

  const numero = todo.match(/COTIZACI[OÓ]N\s*N\s*[°º.]?\s*(\d{3,6})\s*[-–—]\s*(\d{4})/i)
  if (numero) salida.numero = `${numero[1]}-${numero[2]}`

  const fecha = todo.match(/Fecha\s*:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
  if (fecha) salida.fecha = `${fecha[3]}-${fecha[2].padStart(2, '0')}-${fecha[1].padStart(2, '0')}`

  const senores = lineas.findIndex((l) => /^Se[ñn]or(es|a|)\s*:/i.test(l))
  if (senores >= 0) {
    const nombre = limpiar(lineas[senores].replace(/^Se[ñn]or(es|a|)\s*:/i, ''))
    if (nombre.length >= 3) salida.cliente = nombre
  }

  // El documento del cliente es el primero que no es el de la casa, y se busca
  // desde «Señores» hacia abajo: el membrete puede venir antes.
  let finCabecera = senores
  for (let i = Math.max(senores, 0); i < Math.min(lineas.length, Math.max(senores, 0) + 4); i++) {
    const m = lineas[i].match(/\b(RUC|DNI)\s*:?\s*(\d{8}|\d{11})\b/i)
    const doc = m ? documentoDe(m[1], m[2]) : null
    if (doc) {
      salida.documento = doc
      finCabecera = i
      break
    }
  }

  // El título es la primera línea con letras después de la cabecera, que no sea
  // el comienzo de la ficha.
  if (finCabecera >= 0) {
    for (let i = finCabecera + 1; i < Math.min(lineas.length, finCabecera + 4); i++) {
      const l = lineas[i].replace(/^[−–—\-\s]+/, '')
      if (/^(ESPECIFICACI|MARCA\s*:|RUC\b|Fecha\s*:)/i.test(l)) break
      if (/[A-ZÁÉÍÓÚÑ]{3,}/i.test(l) && l.length >= 6) {
        salida.producto = l
        break
      }
    }
  }

  return salida
}

/** «COT. N° 3522- FURGON CRUCERO DOBLE NIVEL - SULLON CARMEN JOSE  24-09-25.pdf» */
export function leerNombreDeArchivo(nombre: string): CabeceraCotizacion {
  const base = limpiar(nombre.replace(/\.pdf$/i, ''))
  const m = base.match(/^COT(?:IZACI[OÓ]N)?\.?\s*N\s*[°º.]?\s*(\d{3,6})\s*-\s*(.+?)\s+-\s+(.+?)[\s-]+(\d{2})-(\d{2})-(\d{2})$/i)
  if (!m) {
    const solo = base.match(/^COT(?:IZACI[OÓ]N)?\.?\s*N\s*[°º.]?\s*(\d{3,6})\b/i)
    return solo ? { ...VACIA, numero: solo[1] } : { ...VACIA }
  }
  const anio = `20${m[6]}`
  return {
    numero: `${m[1]}-${anio}`,
    fecha: `${anio}-${m[5]}-${m[4]}`,
    cliente: limpiar(m[3]),
    documento: null,
    producto: limpiar(m[2]),
  }
}

/** El texto manda; el nombre del archivo rellena lo que falte. */
export function unirLecturas(delTexto: CabeceraCotizacion, delNombre: CabeceraCotizacion): CabeceraCotizacion {
  const numero =
    delTexto.numero ??
    (delNombre.numero && !delNombre.numero.includes('-') && delTexto.fecha
      ? `${delNombre.numero}-${delTexto.fecha.slice(0, 4)}`
      : delNombre.numero)
  return {
    numero,
    fecha: delTexto.fecha ?? delNombre.fecha,
    cliente: delTexto.cliente ?? delNombre.cliente,
    documento: delTexto.documento ?? delNombre.documento,
    producto: delTexto.producto ?? delNombre.producto,
  }
}

// ----------------------------------------------------------------- catálogo

/** Mayúsculas, sin tildes, solo letras y números. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

// Palabras que están en casi todos los títulos y no dicen qué carrocería es.
const DE_RELLENO = new Set([
  'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'CON', 'SIN', 'PARA', 'Y', 'EN', 'TIPO',
  'SEMIRREMOLQUE', 'SEMIREMOLQUE', 'SEMI', 'REMOLQUE', 'CARROCERIA', 'UNIDAD',
  'EJE', 'EJES', 'SUSPENSION', 'NEUMATICA', 'MECANICA', 'SN', 'SM',
])

// Singular y plural, masculino y femenino: «granelera» es el «granelero» del catálogo.
const raiz = (palabra: string) => (palabra.length > 4 ? palabra.replace(/[AOS]+$/, '') : palabra)

function palabras(texto: string): string[] {
  return normalizar(texto)
    .split(' ')
    .filter((p) => p.length >= 2 && !DE_RELLENO.has(p) && !/^\d+$/.test(p))
    .map(raiz)
}

export type PropuestaCarroceria = { id: string; nombre: string; completa: boolean }

/**
 * La carrocería del catálogo que nombra el título. Gana la que tiene todas sus
 * palabras en el título y, entre esas, la más específica («Tolva volquete ·
 * granelero» antes que «Tolva para volquete»). Si ninguna entra completa, la que
 * comparte más de la mitad; si tampoco, ninguna: mejor elegir a mano que
 * proponer una equivocada.
 */
export function proponerCarroceria(
  producto: string | null,
  catalogo: { id: string; nombre: string }[],
): PropuestaCarroceria | null {
  if (!producto) return null
  const delTitulo = new Set(palabras(producto))
  if (delTitulo.size === 0) return null

  let mejor: { item: { id: string; nombre: string }; aciertos: number; total: number } | null = null
  for (const item of catalogo) {
    const suyas = [...new Set(palabras(item.nombre))]
    if (suyas.length === 0) continue
    const aciertos = suyas.filter((p) => delTitulo.has(p)).length
    if (aciertos === 0) continue
    const ratio = aciertos / suyas.length
    const mejorRatio = mejor ? mejor.aciertos / mejor.total : -1
    if (ratio > mejorRatio || (ratio === mejorRatio && mejor && aciertos > mejor.aciertos)) {
      mejor = { item, aciertos, total: suyas.length }
    }
  }

  if (!mejor) return null
  const completa = mejor.aciertos === mejor.total
  if (!completa && mejor.aciertos / mejor.total <= 0.5) return null
  return { id: mejor.item.id, nombre: mejor.item.nombre, completa }
}

/**
 * El cliente registrado que es el de la cotización: por su documento, que no
 * se equivoca; si no trae documento, por la razón social escrita igual.
 */
export function buscarCliente<T extends { id: string; razon_social: string; numero_documento: string | null }>(
  cabecera: Pick<CabeceraCotizacion, 'cliente' | 'documento'>,
  clientes: T[],
): T | null {
  if (cabecera.documento) {
    const porDocumento = clientes.find((c) => c.numero_documento === cabecera.documento!.numero)
    if (porDocumento) return porDocumento
  }
  if (cabecera.cliente) {
    const nombre = normalizar(cabecera.cliente)
    return clientes.find((c) => normalizar(c.razon_social) === nombre) ?? null
  }
  return null
}

/** «FURGÓN SEMIREMOLQUE CRUCERO DOBLE NIVEL - SUSPENSION NEUMÁTICA» → «Furgón semiremolque crucero doble nivel» */
export function nombreParaCatalogo(producto: string): string {
  const principal = limpiar(producto.split(/\s+[-–—]\s+/)[0] ?? producto).toLowerCase()
  return principal.charAt(0).toUpperCase() + principal.slice(1)
}
