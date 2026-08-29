import 'server-only'

/**
 * El tipo de cambio publicado por SUNAT, traído de fuera de la casa.
 *
 * La empresa cotiza en dólares y costea en soles: el puente entre las dos cosas
 * es esta cifra, y hasta hoy había que escribirla a mano todos los días. Cuando
 * nadie la escribía, la base respondía 1 —no porque el dólar valga un sol, sino
 * porque no tenía nada que responder— y una cotización de US$ 40,000 abría una
 * orden presupuestada en S/ 40,000.
 *
 * SUNAT no publica un servicio abierto: lo que se consulta es `apis.net.pe`,
 * que republica lo que SUNAT publica. Por eso lo que se guarda lleva de dónde
 * salió —`fuente`—: dentro de un año, ante una diferencia con el papel del
 * banco, esa columna es la única forma de saber a quién se le preguntó.
 *
 * Dos cosas que este servicio hace y que hay que aguantar:
 *
 * 1. **Contesta 200 con un cuerpo de error.** Cuando corta por exceso de
 *    consultas manda `<html>…429 Too Many Requests…</html>` con estado 200. Un
 *    cargador que mire solo el estado guardaría basura, o peor, un `NaN` que
 *    termina en la columna `venta`. Acá no se cree el estado: se cree el JSON,
 *    y solo si trae las dos cifras y son creíbles.
 * 2. **Corta rápido.** Dos consultas seguidas ya devuelven 429. Por eso esto se
 *    llama una vez al día desde el cron, y desde el botón solo cuando falta el
 *    día que se pide.
 */

/** Lo poco que se necesita del servicio, ya comprobado. */
export type CambioDeSunat = {
  fecha: string
  compra: number
  venta: number
  fuente: string
}

export type ResultadoSunat =
  | { ok: true; cambio: CambioDeSunat }
  | { ok: false; error: string; reintentable: boolean }

const SERVICIO = 'https://api.apis.net.pe/v1/tipo-cambio-sunat'
const FUENTE = 'SUNAT vía apis.net.pe'

/**
 * Las mismas defensas que la carga a mano, porque el que se equivoca acá es un
 * servicio de fuera y nadie lo va a revisar. Un cambio de tres cifras es el
 * punto decimal perdido (365 en vez de 3.65) y multiplica por cien lo que se
 * presupueste; una venta menor que la compra son las dos cifras cambiadas de
 * sitio, y la venta es la que congelan los documentos.
 */
function cifraCreible(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : Number(valor)
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null
  return n
}

export async function traerDeSunat(fecha: string, milisegundos = 10_000): Promise<ResultadoSunat> {
  let respuesta: Response
  try {
    respuesta = await fetch(`${SERVICIO}?fecha=${encodeURIComponent(fecha)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(milisegundos),
      cache: 'no-store',
    })
  } catch (e) {
    // Se cayó la red o venció el tiempo: mañana vuelve a intentarse solo. No es
    // motivo para dejar de cotizar, es motivo para cargarlo a mano si urge.
    return {
      ok: false,
      reintentable: true,
      error: `No se pudo consultar a SUNAT: ${e instanceof Error ? e.message : 'sin respuesta'}. Cárgalo a mano si hace falta hoy.`,
    }
  }

  const texto = await respuesta.text()

  // El estado no sirve para decidir: el servicio manda el 429 dentro de un 200.
  // Lo único que vale es que el cuerpo sea el JSON esperado.
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    const cortado = texto.replace(/\s+/g, ' ').slice(0, 120)
    const saturado = /429|too many requests/i.test(texto)
    return {
      ok: false,
      reintentable: true,
      error: saturado
        ? 'SUNAT (apis.net.pe) está cortando las consultas por exceso de pedidos. Se reintenta mañana; si urge, cárgalo a mano.'
        : `El servicio no contestó en JSON (${respuesta.status}): ${cortado}`,
    }
  }

  const dato = crudo as Record<string, unknown>
  const compra = cifraCreible(dato.compra)
  const venta = cifraCreible(dato.venta)

  if (compra === null || venta === null) {
    return {
      ok: false,
      reintentable: true,
      error: `El servicio contestó sin un cambio utilizable para el ${fecha}: ${JSON.stringify(crudo).slice(0, 120)}`,
    }
  }

  if (venta < compra) {
    return {
      ok: false,
      reintentable: false,
      error: `El servicio devolvió una venta (${venta}) menor que la compra (${compra}) para el ${fecha}. No se guarda: cárgalo a mano mirando el papel.`,
    }
  }

  // Se respeta la fecha que devuelve el servicio, no la que se pidió: en fin de
  // semana y feriados SUNAT no publica y contesta con la del último día hábil.
  // Guardarlo bajo la fecha pedida inventaría una publicación que no existió.
  const fechaPublicada = typeof dato.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dato.fecha)
    ? dato.fecha
    : fecha

  return { ok: true, cambio: { fecha: fechaPublicada, compra, venta, fuente: FUENTE } }
}
