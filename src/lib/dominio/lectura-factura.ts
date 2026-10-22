/**
 * El detector de la factura de compra: lee el total, la moneda, el número y las
 * OC que menciona la factura, y avisa si no calzan con lo que se registra.
 * Nunca frena nada: la factura se registra igual (decisión 12 de DKS, 14/10).
 *
 * Lee dos cosas:
 *   · el XML de SUNAT (UBL 2.1), que es el documento legal y trae cada dato en
 *     su etiqueta: `cbc:PayableAmount` es el importe total; `cac:OrderReference`,
 *     la orden de compra;
 *   · el texto del PDF (o lo que el OCR sacó de un escaneo), que es la
 *     representación impresa: «Importe Total : S/ 1,180.00», «Observación:
 *     OC-5583-MW».
 *
 * Sin imports a propósito: se prueba con node (lectura-factura.test.mjs).
 */

export type FuenteLectura = 'XML' | 'PDF' | 'OCR'

export type LecturaFactura = {
  fuente: FuenteLectura
  /** El importe total, con IGV; null si no se encontró. */
  total: number | null
  moneda: 'PEN' | 'USD' | null
  /** Serie y número, como F001-1234 (sin los ceros de relleno). */
  numero: string | null
  /** YYYY-MM-DD */
  fecha_emision: string | null
  /** Las OC que menciona, por su número sin ceros a la izquierda: «5583» de OC-5583-MW. */
  ordenes: string[]
}

const limpiar = (t: string) => t.replace(/\s+/g, ' ').trim()

/** «1,180.00», «1.180,00», «1 180.00» o «1180» → 1180. Null si no es un importe. */
export function importeDeTexto(crudo: string): number | null {
  const raw = crudo.replace(/\s/g, '')
  if (!/^\d[\d.,]*$/.test(raw)) return null
  const punto = raw.lastIndexOf('.')
  const coma = raw.lastIndexOf(',')
  let normal: string
  if (punto >= 0 && coma >= 0) {
    const decimal = punto > coma ? '.' : ','
    normal = raw.replace(decimal === '.' ? /,/g : /\./g, '').replace(decimal, '.')
  } else if (punto >= 0 || coma >= 0) {
    const sep = punto >= 0 ? '.' : ','
    const partes = raw.split(sep)
    normal = partes.length === 2 && partes[1].length <= 2 ? `${partes[0]}.${partes[1]}` : partes.join('')
  } else normal = raw
  const n = Number(normal)
  return Number.isFinite(n) && n > 0 && n < 1e10 ? Math.round(n * 100) / 100 : null
}

/** El número de una OC sin prefijo ni ceros: «OC-0583-MW» → «583». Null si no tiene número. */
export function numeroDeOc(numero: string | null | undefined): string | null {
  const m = (numero ?? '').toUpperCase().match(/(\d{1,7})/)
  return m ? String(Number(m[1])) : null
}

/** «F001-00001234» o «f001 - 1234» → «F001-1234»; null si no es serie y número. */
export function numeroDeFactura(texto: string | null | undefined): string | null {
  const m = (texto ?? '').toUpperCase().match(/\b([FEB][A-Z0-9]{3})\s*[-–]\s*0*(\d{1,8})\b/)
  return m ? `${m[1]}-${Number(m[2])}` : null
}

/**
 * Las OC que menciona un texto: «OC-5583-MW», «OC N° 5583», «O/C 5583»,
 * «Orden de compra: 5583-MW». Sin repetir, en el orden en que aparecen.
 */
export function ordenesMencionadas(texto: string): string[] {
  const t = limpiar(texto).toUpperCase()
  const patrones = [
    /\bO\s*\.?\s*C\s*\.?\s*(?:N\s*[°ºO]\.?|NRO\.?|NUM\.?|#)?\s*[-–:]?\s*0*(\d{1,7})\b/g,
    /\bO\s*\/\s*C\s*(?:N\s*[°ºO]\.?|NRO\.?|#)?\s*[-–:]?\s*0*(\d{1,7})\b/g,
    /\bORDEN\s+DE\s+COMPRA\s*(?:N\s*[°ºO]\.?|NRO\.?|#)?\s*[-–:]?\s*(?:OC\s*[-–]?\s*)?0*(\d{1,7})\b/g,
  ]
  const vistas: { n: string; en: number }[] = []
  for (const p of patrones) {
    for (const m of t.matchAll(p)) {
      if (m.index === undefined) continue
      const n = String(Number(m[1]))
      if (n !== '0' && !vistas.some((v) => v.n === n)) vistas.push({ n, en: m.index })
    }
  }
  return vistas.sort((a, b) => a.en - b.en).map((v) => v.n)
}

/** Lo que pide la factura como total, del rótulo más fuerte al más débil. */
const ROTULOS_DE_TOTAL = [
  /\bIMPORTE\s+TOTAL\b/,
  /\bTOTAL\s+A\s+PAGAR\b/,
  /\bTOTAL\s+PRECIO\s+DE\s+VENTA\b/,
  /\bTOTAL\s+(?:DE\s+LA\s+)?VENTA\b/,
  /\bMONTO\s+TOTAL\b/,
  /\bTOTAL\s+(?:GENERAL|FACTURA)\b/,
  /(?:^|[^A-Z])TOTAL\b/,
]
/** Rótulos con la palabra TOTAL que no son el total: subtotales, impuestos, la detracción, el neto. */
const NO_ES_TOTAL = /\b(?:SUB\s*-?\s*TOTAL|IGV|I\.G\.V|IMPUESTO|GRAVAD|EXONERAD|INAFECT|GRATUIT|DESCUENTO|ANTICIPO|ISC|ICBPER|PERCEPCI|RETENCI|DETRACCI|NETO|PENDIENTE|CUOTA|VALOR\s+DE\s+VENTA|CANTIDAD|ITEMS?)\b/

const IMPORTE = /(S\s*\/\s*\.?|US\s*\$|USD|PEN|\$)?\s*(\d{1,3}(?:[,. ]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)\b/g

function monedaDe(simbolo: string): 'PEN' | 'USD' | null {
  if (/US\s*\$|USD|\$/.test(simbolo)) return 'USD'
  if (/S\s*\/|PEN/.test(simbolo)) return 'PEN'
  return null
}

function totalDelTexto(lineas: string[]): { total: number; moneda: 'PEN' | 'USD' | null } | null {
  for (const rotulo of ROTULOS_DE_TOTAL) {
    for (let i = 0; i < lineas.length; i++) {
      const linea = lineas[i]
      const m = linea.match(rotulo)
      if (!m || m.index === undefined) continue
      // El rótulo entero: desde el importe anterior hasta el siguiente («SUB TOTAL»,
      // «TOTAL OP. GRAVADAS», «TOTAL IGV»), sin mirar los importes de al lado.
      const desde = m.index + m[0].length
      const rotuloEntero = `${linea.slice(0, m.index).split(/\d/).at(-1) ?? ''}${m[0]}${linea.slice(desde).split(/\d/)[0]}`
      if (NO_ES_TOTAL.test(rotuloEntero)) continue
      // El importe va en la misma línea, después del rótulo, o en la siguiente.
      const tramos = [linea.slice(desde), lineas[i + 1] ?? '']
      for (const [k, tramo] of tramos.entries()) {
        if (k === 1 && !/^\s*(?:S\s*\/|US\s*\$|USD|PEN|\$)?\s*\d[\d.,\s]*$/.test(tramo)) break
        const importes = [...tramo.matchAll(IMPORTE)].filter((x) => x[2] && /[.,]\d{1,2}$|\d{3,}/.test(x[2]))
        const elegido = importes.find((x) => x[1]) ?? importes[0]
        const total = elegido ? importeDeTexto(elegido[2]) : null
        if (elegido && total) return { total, moneda: monedaDe(elegido[1] ?? '') }
      }
    }
  }
  return null
}

function fechaDelTexto(t: string): string | null {
  const m = t.match(/FECHA\s+(?:DE\s+)?EMISI[OÓ]N\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const iso = t.match(/FECHA\s+(?:DE\s+)?EMISI[OÓ]N\s*:?\s*(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
}

/** Lo que dice el texto de una factura (el PDF o lo que leyó el OCR). */
export function leerFacturaDeTexto(texto: string, fuente: 'PDF' | 'OCR' = 'PDF'): LecturaFactura {
  const lineas = texto.split(/\r?\n/).map((l) => limpiar(l).toUpperCase()).filter(Boolean)
  const t = lineas.join('\n')
  const total = totalDelTexto(lineas)
  let moneda = total?.moneda ?? null
  if (!moneda) {
    if (/D[OÓ]LAR(?:ES)?(?:\s+AMERICANOS)?\b|US\s*\$|\bUSD\b/.test(t)) moneda = 'USD'
    else if (/\bSOLES\b|S\s*\/|\bPEN\b/.test(t)) moneda = 'PEN'
  }
  return {
    fuente,
    total: total?.total ?? null,
    moneda,
    numero: numeroDeFactura(t),
    fecha_emision: fechaDelTexto(t),
    ordenes: ordenesMencionadas(t),
  }
}

/** Lo que dice el XML de SUNAT (UBL 2.1). */
export function leerFacturaDeXml(xml: string): LecturaFactura {
  const etiqueta = (nombre: string, dentro = xml) =>
    dentro.match(new RegExp(`<(?:\\w+:)?${nombre}\\b([^>]*)>([^<]*)</(?:\\w+:)?${nombre}>`))
  const monetario = xml.match(/<(?:\w+:)?LegalMonetaryTotal\b[^>]*>([\s\S]*?)<\/(?:\w+:)?LegalMonetaryTotal>/)?.[1] ?? ''
  const pagable = etiqueta('PayableAmount', monetario) ?? etiqueta('PayableAmount')
  const total = pagable ? Number(pagable[2].trim()) : NaN
  const atributo = pagable?.[1].match(/currencyID\s*=\s*"([A-Z]{3})"/)?.[1] ?? null
  const codigo = (etiqueta('DocumentCurrencyCode')?.[2].trim() ?? atributo ?? '').toUpperCase()
  // El número del comprobante es el primer ID con forma de serie y número.
  const numero = [...xml.matchAll(/<(?:\w+:)?ID\b[^>]*>([^<]*)<\/(?:\w+:)?ID>/g)]
    .map((m) => numeroDeFactura(m[1]))
    .find(Boolean) ?? null
  const fecha = etiqueta('IssueDate')?.[2].trim() ?? null
  const referencias = [...xml.matchAll(/<(?:\w+:)?OrderReference\b[^>]*>([\s\S]*?)<\/(?:\w+:)?OrderReference>/g)]
    .flatMap((m) => {
      const id = etiqueta('ID', m[1])?.[2] ?? ''
      return numeroDeOc(id) ? [numeroDeOc(id) as string] : []
    })
  // Las observaciones también nombran la OC: se lee el texto sin etiquetas.
  const texto = xml.replace(/<[^>]+>/g, ' ')
  const ordenes = [...new Set([...referencias, ...ordenesMencionadas(texto)])]
  return {
    fuente: 'XML',
    total: Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : null,
    moneda: codigo === 'USD' ? 'USD' : codigo === 'PEN' ? 'PEN' : null,
    numero,
    fecha_emision: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
    ordenes,
  }
}

/** Si la lectura encontró algo que valga la pena guardar. */
export function lecturaUtil(l: LecturaFactura | null): l is LecturaFactura {
  return Boolean(l && (l.total !== null || l.numero || l.ordenes.length > 0))
}

/** Una OC tal como la ve el detector: la marcada en la factura o la que espera la suya. */
export type OcParaDetector = { numero: string | null; referencia: string }

export type AvisoDelDetector =
  | { tipo: 'TOTAL'; leido: number; registrado: number; moneda: 'PEN' | 'USD' }
  | { tipo: 'MONEDA'; leida: 'PEN' | 'USD'; registrada: string }
  | { tipo: 'NUMERO'; leido: string; registrado: string }
  /** `espera`: si la OC espera su factura y se puede marcar; null si no se sabe (la factura ya está registrada). */
  | { tipo: 'OC_NO_MARCADA'; oc: string; espera: boolean | null }
  | { tipo: 'OC_NO_MENCIONADA'; oc: string }

const etiquetaOc = (o: OcParaDetector) => o.numero ?? o.referencia

/**
 * Lo que no calza entre la factura leída y lo que se registra: el total, la
 * moneda, el número, las OC que la factura menciona y no están marcadas, y las
 * marcadas que la factura no menciona (solo si menciona alguna).
 */
export function avisosDelDetector(entrada: {
  lectura: LecturaFactura
  total: number | null
  moneda: string
  numero: string
  marcadas: OcParaDetector[]
  /** Las OC que esperan su factura: para decir si la mencionada se puede marcar. */
  disponibles?: OcParaDetector[]
}): AvisoDelDetector[] {
  const { lectura: l } = entrada
  const avisos: AvisoDelDetector[] = []
  if (l.moneda && entrada.moneda && l.moneda !== entrada.moneda) {
    avisos.push({ tipo: 'MONEDA', leida: l.moneda, registrada: entrada.moneda })
  }
  if (l.total !== null && entrada.total !== null && Math.abs(l.total - entrada.total) >= 0.01) {
    avisos.push({ tipo: 'TOTAL', leido: l.total, registrado: entrada.total, moneda: l.moneda ?? (entrada.moneda === 'USD' ? 'USD' : 'PEN') })
  }
  const escrito = numeroDeFactura(entrada.numero)
  if (l.numero && escrito && l.numero !== escrito) avisos.push({ tipo: 'NUMERO', leido: l.numero, registrado: escrito })
  if (l.ordenes.length > 0) {
    const marcadas = new Map(entrada.marcadas.flatMap((o) => (numeroDeOc(o.numero) ? [[numeroDeOc(o.numero) as string, o] as const] : [])))
    const disponibles = new Map(
      (entrada.disponibles ?? []).flatMap((o) => (numeroDeOc(o.numero) ? [[numeroDeOc(o.numero) as string, o] as const] : [])),
    )
    for (const n of l.ordenes) {
      if (marcadas.has(n)) continue
      const espera = disponibles.get(n)
      avisos.push({
        tipo: 'OC_NO_MARCADA',
        oc: espera ? etiquetaOc(espera) : `OC ${n}`,
        espera: entrada.disponibles ? Boolean(espera) : null,
      })
    }
    for (const [n, o] of marcadas) {
      if (!l.ordenes.includes(n)) avisos.push({ tipo: 'OC_NO_MENCIONADA', oc: etiquetaOc(o) })
    }
  }
  return avisos
}

/**
 * El aviso en palabras, para la pantalla. `dinero` formatea el importe. Con
 * `registrada`, la factura ya está registrada: sus OC están enlazadas, no marcadas.
 */
export function textoDelAviso(
  a: AvisoDelDetector,
  dinero: (monto: number, moneda: 'PEN' | 'USD') => string,
  { registrada = false }: { registrada?: boolean } = {},
): string {
  switch (a.tipo) {
    case 'TOTAL':
      return `La factura dice ${dinero(a.leido, a.moneda)} y se registró ${dinero(a.registrado, a.moneda)}.`
    case 'MONEDA':
      return `La factura está en ${a.leida === 'USD' ? 'dólares' : 'soles'} y se registró en ${a.registrada === 'USD' ? 'dólares' : 'soles'}.`
    case 'NUMERO':
      return `La factura es la ${a.leido} y se registró como ${a.registrado}.`
    case 'OC_NO_MARCADA':
      if (registrada || a.espera === null) return `La factura menciona la ${a.oc} y no está entre sus OC.`
      return a.espera
        ? `La factura menciona la ${a.oc} y no está marcada.`
        : `La factura menciona la ${a.oc}, que no espera factura: ya tiene una registrada, es de otro proveedor o no existe.`
    case 'OC_NO_MENCIONADA':
      return `La ${a.oc} ${registrada ? 'es de esta factura' : 'está marcada'} y la factura no la menciona.`
  }
}

/**
 * La factura frente a su orden de compra, cuando Logística la adjunta: si el
 * total no calza con el de la orden (con IGV, la misma tolerancia de S/ 1 que
 * Adquisiciones), si está en otra moneda, si nombra otra OC o si el número que
 * se escribió no es el suyo. Para que el error se vea en la orden antes de que
 * llegue a Contabilidad.
 */
export function avisosDeLaOrden(
  entrada: {
    lectura: LecturaFactura
    total: number | null
    moneda: string
    numero?: string | null
    /** El número de la factura que se escribió en el formulario. */
    anotada?: string | null
  },
  dinero: (monto: number, moneda: 'PEN' | 'USD') => string,
): string[] {
  const { lectura: l } = entrada
  const avisos: string[] = []
  const m: 'PEN' | 'USD' = entrada.moneda === 'USD' ? 'USD' : 'PEN'
  if (l.moneda && l.moneda !== m) {
    avisos.push(`La factura está en ${l.moneda === 'USD' ? 'dólares' : 'soles'} y la orden en ${m === 'USD' ? 'dólares' : 'soles'}.`)
  } else if (l.total !== null && entrada.total !== null && entrada.total > 0 && Math.abs(l.total - entrada.total) > 1) {
    avisos.push(
      `La factura dice ${dinero(l.total, m)} y la orden suma ${dinero(entrada.total, m)}: revisa cantidades y precios, o si la factura es de otra compra.`,
    )
  }
  const escrita = numeroDeFactura(entrada.anotada)
  if (l.numero && escrita && l.numero !== escrita) {
    avisos.push(`La factura es la ${l.numero} y se anotó como ${escrita}: revisa el número.`)
  }
  const propia = numeroDeOc(entrada.numero)
  if (propia && l.ordenes.length > 0 && !l.ordenes.includes(propia)) {
    avisos.push(`La factura menciona ${l.ordenes.map((n) => `la OC ${n}`).join(' y ')}, y esta es la ${entrada.numero}: revisa que sea su factura.`)
  }
  return avisos
}

/** Para guardar lo leído con el comprobante, y para leerlo de vuelta. */
export function lecturaDeFila(f: {
  lectura_fuente: string | null
  lectura_total: number | string | null
  lectura_moneda: string | null
  lectura_numero: string | null
  lectura_ordenes: string[] | null
}): LecturaFactura | null {
  if (f.lectura_fuente !== 'XML' && f.lectura_fuente !== 'PDF' && f.lectura_fuente !== 'OCR') return null
  return {
    fuente: f.lectura_fuente,
    total: f.lectura_total === null ? null : Number(f.lectura_total),
    moneda: f.lectura_moneda === 'USD' ? 'USD' : f.lectura_moneda === 'PEN' ? 'PEN' : null,
    numero: f.lectura_numero,
    fecha_emision: null,
    ordenes: f.lectura_ordenes ?? [],
  }
}
