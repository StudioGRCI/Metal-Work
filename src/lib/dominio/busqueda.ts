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
const DENTRO = /([a-z0-9])[._/-]+(?=[a-z0-9])/g
const LETRAS = 24

/**
 * Las palabras que se buscan, en minúsculas y sin tildes; «S.A.C.» es una sola
 * palabra, «sac», y no tres letras sueltas que están en casi todo. Pocas y
 * cortas —cinco y veinticuatro letras entre todas—: cada letra viaja en la dirección
 * de la consulta, una vez por columna, y una dirección demasiado larga la
 * rechaza el servidor.
 */
export function palabrasDeBusqueda(texto: string | null | undefined): string[] {
  const palabras: string[] = []
  let letras = 0
  for (const p of plano(texto ?? '').replace(DENTRO, '$1').split(/[^a-z0-9]+/)) {
    if (!p || palabras.length === 5 || letras >= LETRAS) continue
    palabras.push(p.slice(0, LETRAS - letras))
    letras += p.length
  }
  return palabras
}

/**
 * Minúsculas y sin tildes, y la ñ como n: en el taller se escribe «nunez» y
 * «pena» sin buscar la tecla, y tienen que encontrar a NÚÑEZ y a PEÑA.
 */
function plano(texto: string) {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

// Solo las tildes del castellano (y la diéresis de la u), en minúscula: el `~*`
// de Postgres iguala «Ú» con «ú» en una base UTF-8 (`'NÚÑEZ' ~* 'ú'` da
// verdadero en Supabase y en el banco), y cada letra de más alarga la dirección.
// La O y el cero van juntos, como en `llaveParecido`: en los códigos internos se
// escriben uno por otro («SR_O4» y «SR_04»).
const VARIANTES: Record<string, string> = {
  a: 'aá',
  e: 'eé',
  i: 'ií',
  o: 'oó0',
  '0': '0o',
  u: 'uúü',
  n: 'nñ',
}

/**
 * Una palabra como expresión regular que encuentra sus versiones con tilde y
 * con los signos de `DENTRO` entre letra y letra: «sac» encuentra «S.A.C.» y
 * «sr04», «SR_04». Solo lleva letras, números, corchetes, esos signos y `?`
 * —`palabrasDeBusqueda` no dejó nada más—, y entre las comillas del filtro
 * nada de eso es un mando para PostgREST.
 */
export function expresionSinTildes(palabra: string): string {
  return [...palabra].map((c) => (VARIANTES[c] ? `[${VARIANTES[c]}]` : c)).join('[._/-]?')
}

/**
 * El filtro `or` de PostgREST para una palabra: aparece en alguna de las
 * columnas. Con varias palabras se encadena un `.or()` por palabra, y
 * PostgREST los junta con «y»: cada palabra tiene que estar en alguna columna.
 */
export function filtroDePalabra(columnas: string[], palabra: string): string {
  const expresion = expresionSinTildes(palabra)
  return columnas.map((c) => `${c}.imatch."${expresion}"`).join(',')
}

/**
 * Lo mismo para una lista ya leída: cada palabra está en alguno de los campos,
 * leídos también sin los signos de `DENTRO` y con la O igual al cero, como hace
 * la expresión.
 */
export function coincide(palabras: string[], campos: (string | null | undefined)[]): boolean {
  if (palabras.length === 0) return true
  const cero = (t: string) => t.replace(/o/g, '0')
  const textos = campos.map((c) => cero(plano(c ?? ''))).flatMap((t) => [t, t.replace(/[._/-]+/g, '')])
  return palabras.every((p) => textos.some((t) => t.includes(cero(p))))
}
