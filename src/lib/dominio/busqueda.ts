/**
 * Cómo busca un buscador del sistema: sin importar tildes ni mayúsculas, por
 * palabras sueltas en cualquier orden, y sin que una coma o un paréntesis
 * escritos rompan la pantalla.
 *
 * Antes cada lista armaba su `ilike` a mano: «camion» no encontraba «CAMIÓN»,
 * «cisterna agua» no encontraba «CISTERNA DE AGUA», y en Materiales «plancha,
 * a36» tiraba la pantalla entera, porque la coma parte el filtro `or` de
 * PostgREST.
 */

/**
 * Los signos que van dentro de una sigla o un código: «S.A.C.», «SR_04», «A-36»,
 * «3/16». Escritos o no, la palabra es la misma.
 */
const SIGNOS = /[._/-]+/

/**
 * Un trozo entre espacios con signos dentro: si es sigla —letras sueltas— o
 * código —con números—, es una sola palabra; si no, son varias. «S.A.C.» es
 * «sac» y «SR_04» es «sr04», pero «Mercedes-Benz» son «mercedes» y «benz»:
 * pegado no lo encontraba la base, que en una palabra larga sin números no
 * admite signos entre letras.
 */
function trozos(texto: string): string[] {
  const partes = texto.split(SIGNOS).filter(Boolean)
  return partes.every((p) => p.length === 1) || partes.some((p) => /\d/.test(p)) ? [partes.join('')] : partes
}

/**
 * Una sigla de razón social escrita con espacios es una palabra: «S R L» es
 * «srl». Sueltas, cada letra está en casi todo y «S R L» traía 10 de los 15
 * clientes (producción, 2026-10-20). Solo esas siglas: «transportes a y b»
 * unido en «ayb» ya no encontraba «TRANSPORTES A Y B», porque la base busca
 * con espacios solo las de `SIGLAS_DE_EMPRESA`.
 */
function siglasConEspacios(texto: string): string {
  return texto.replace(/(?<![a-z0-9])[a-z](?: +[a-z](?![a-z0-9]))+/g, (letras) => {
    const sigla = letras.replace(/ +/g, '')
    return SIGLAS_DE_EMPRESA.has(sigla) ? sigla : letras
  })
}

/**
 * Las palabras que se buscan, en minúsculas y sin tildes; «S.A.C.» es una sola
 * palabra, «sac», y no tres letras sueltas que están en casi todo. Una letra
 * sola —la «y» de «Peña y Núñez»— o una palabra de enlace —«transportes de
 * peña»— no se busca si hay otras: está en todo, o no está en el nombre.
 */

const DE_ENLACE = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'en', 'con', 'por'])
export function palabrasDeBusqueda(texto: string | null | undefined): string[] {
  const todas = siglasConEspacios(plano(texto ?? '')).split(/[^a-z0-9._/-]+/).flatMap(trozos).filter(Boolean)
  const utiles = todas.filter((p) => (p.length > 1 && !DE_ENLACE.has(p)) || /\d/.test(p))
  // Si hay que cortar, se quedan primero las que distinguen —con números y
  // siglas—: «… HORIZONTE PERÚ S.A.C.» perdía «sac» y salía su gemelo E.I.R.L.
  // El orden no cambia lo que se encuentra: tienen que estar todas.
  const pesa = (p: string) => (/\d/.test(p) ? 0 : p.length <= 4 ? 1 : 2)
  const ordenadas = (utiles.length ? utiles : todas).map((p, i) => ({ p, i }))
    .sort((a, b) => pesa(a.p) - pesa(b.p) || a.i - b.i).map(({ p }) => p)
  return ordenadas.slice(0, 10).map((p) => p.slice(0, 20))
}

/**
 * Lo que cabe en la dirección de la consulta. Cada palabra viaja una vez por
 * columna, y una dirección demasiado larga la rechaza el servidor: pasado este
 * tope, las palabras que sobran no filtran en la base (salen más filas, nunca
 * menos). Una búsqueda de verdad —«transportes peña y núñez s.a.c.» en cuatro
 * columnas— usa menos de la mitad.
 */
const TOPE_DE_LA_DIRECCION = 5000

/**
 * Minúsculas y sin tildes, y la ñ como n: en el taller se escribe «nunez» y
 * «pena» sin buscar la tecla, y tienen que encontrar a NÚÑEZ y a PEÑA.
 */
function plano(texto: string) {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

// Solo las tildes del castellano (y la diéresis de la u). Las mayúsculas con
// tilde van escritas: el `~*` de Postgres iguala «a» con «A» siempre, pero «ú»
// con «Ú» solo si la base no está en intercalación «C», y la de producción no
// se comprobó. La O y el cero van juntos, como en `llaveParecido`: en los
// códigos internos se escriben uno por otro («SR_O4» y «SR_04»).
const VARIANTES: Record<string, string> = {
  a: 'aáÁ',
  e: 'eéÉ',
  i: 'iíÍ',
  o: 'oóÓ0',
  '0': '0o',
  u: 'uúüÚÜ',
  n: 'nñÑ',
}

/**
 * Una palabra como expresión regular que encuentra sus versiones con tilde y
 * con los `SIGNOS` entre letra y letra: «sac» encuentra «S.A.C.» y «S A C», y
 * «sr04», «SR_04». Solo lleva letras, números, corchetes, esos signos, el
 * espacio y los mandos de la expresión (`? + | ^ $ ( )`) —`palabrasDeBusqueda`
 * no dejó nada más—, y entre las comillas del filtro nada de eso es un mando
 * para PostgREST.
 */
export function expresionSinTildes(palabra: string): string {
  // Los signos entre letra y letra solo hacen falta en siglas y códigos —cortos
  // o con números—; en «transportes» triplicaban el largo de la dirección.
  // Con números también el espacio: «2x14» encuentra «2 X 1/4», como hace
  // `coincide`. En una sigla no, que «sac» saltaría a «planchaS ACero».
  const entre = /\d/.test(palabra) ? '[ ._/-]?' : palabra.length <= 4 ? '[._/-]?' : ''
  const letras = [...palabra].map((c) => (VARIANTES[c] ? `[${VARIANTES[c]}]` : c))
  const pegada = letras.join(entre)
  // La sigla de empresa también escrita con espacios —«TALLERES EJEMPLO S R L»—,
  // pero solo como letras sueltas entre dos no-letras: así «sac» no salta a
  // «planchaS ACero». Solo esas: en toda palabra corta («agua», «tubo») la
  // expresión doble no cabía en la dirección con las demás palabras.
  if (SIGLAS_DE_EMPRESA.has(palabra)) return `${pegada}|(^|${NO_LETRA})${letras.join('[ ._/-]+')}(${NO_LETRA}|$)`
  return pegada
}

/** Las siglas de razón social, que en los registros viejos van con espacios. */
const SIGLAS_DE_EMPRESA = new Set(['sa', 'saa', 'sac', 'sacs', 'srl', 'scrl', 'eirl'])

/**
 * Lo que no es letra, también para Postgres, que no tiene `\b`. El filtro no
 * distingue mayúsculas (`imatch`), así que `a-z` vale también por `A-Z`; las
 * letras con tilde no van, porque cada una ocupa seis caracteres en la
 * dirección.
 */
const NO_LETRA = '[^a-z]'

/**
 * El filtro `or` de PostgREST para una palabra: aparece en alguna de las
 * columnas. Con varias palabras se encadena un `.or()` por palabra, y
 * PostgREST los junta con «y»: cada palabra tiene que estar en alguna columna.
 */
export function filtroDePalabra(columnas: string[], palabra: string): string {
  const expresion = expresionSinTildes(palabra)
  return columnas.map((c) => `${c}.imatch."${expresion}"`).join(',')
}

/** Un filtro por palabra, de la primera en adelante, mientras quepan en la dirección. */
export function filtrosDeBusqueda(columnas: string[], texto: string | null | undefined): string[] {
  const filtros: string[] = []
  let largo = 0
  for (const palabra of palabrasDeBusqueda(texto)) {
    const filtro = filtroDePalabra(columnas, palabra)
    largo += encodeURIComponent(filtro).length
    if (filtros.length && largo > TOPE_DE_LA_DIRECCION) break
    filtros.push(filtro)
  }
  return filtros
}

/**
 * Lo mismo para una lista ya leída: cada palabra está en alguno de los campos,
 * leídos también sin los `SIGNOS` y con la O igual al cero, como hace
 * la expresión (aquí algo más generosa: «transportes» está en «TRANS-PORTES»). Una medida —una palabra con números— se busca además sin
 * espacios: en el taller se anota «2X1/4» lo que el catálogo tiene como
 * «2 X 1/4». Una palabra sin números no salta espacios: «sac» no está en
 * «PLANCHAS ACERO».
 */
export function coincide(palabras: string[], campos: (string | null | undefined)[]): boolean {
  if (palabras.length === 0) return true
  const cero = (t: string) => t.replace(/o/g, '0')
  const textos = campos.map((c) => cero(plano(c ?? ''))).flatMap((t) => [t, t.replace(/[._/-]+/g, '')])
  const pegados = textos.map((t) => t.replace(/[^a-z0-9]+/g, ''))
  // «S R L» en el campo es «srl», como en la expresión: solo letras sueltas.
  const siglas = campos.map((c) =>
    plano(c ?? '').replace(/(?<![a-z0-9])[a-z](?:[ ._/-]+[a-z](?![a-z0-9]))+/g, (sigla) => sigla.replace(/[^a-z]/g, '')),
  )
  return palabras.every(
    (p) =>
      textos.some((t) => t.includes(cero(p))) ||
      (/\d/.test(p) && pegados.some((t) => t.includes(cero(p)))) ||
      siglas.some((t) => t.includes(p)),
  )
}
