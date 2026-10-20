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

/**
 * Las palabras que se buscan, en minúsculas y sin tildes; «S.A.C.» es una sola
 * palabra, «sac», y no tres letras sueltas que están en casi todo. Una letra
 * sola —la «y» de «Peña y Núñez»— no se busca si hay otras: está en todo.
 */
export function palabrasDeBusqueda(texto: string | null | undefined): string[] {
  const todas = plano(texto ?? '').replace(DENTRO, '$1').split(/[^a-z0-9]+/).filter(Boolean)
  const utiles = todas.filter((p) => p.length > 1 || /\d/.test(p))
  return (utiles.length ? utiles : todas).slice(0, 8).map((p) => p.slice(0, 20))
}

/**
 * Lo que cabe en la dirección de la consulta. Cada palabra viaja una vez por
 * columna, y una dirección demasiado larga la rechaza el servidor: pasado este
 * tope, las palabras que sobran no filtran en la base (salen más filas, nunca
 * menos). Una búsqueda de verdad —«transportes peña y núñez s.a.c.» en cuatro
 * columnas— usa menos de la mitad.
 */
const TOPE_DE_LA_DIRECCION = 4000

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
 * con los signos de `DENTRO` entre letra y letra: «sac» encuentra «S.A.C.» y
 * «sr04», «SR_04». Solo lleva letras, números, corchetes, esos signos y `?`
 * —`palabrasDeBusqueda` no dejó nada más—, y entre las comillas del filtro
 * nada de eso es un mando para PostgREST.
 */
export function expresionSinTildes(palabra: string): string {
  // Los signos entre letra y letra solo hacen falta en siglas y códigos —cortos
  // o con números—; en «transportes» triplicaban el largo de la dirección.
  const entre = palabra.length <= 4 || /\d/.test(palabra) ? '[._/-]?' : ''
  return [...palabra].map((c) => (VARIANTES[c] ? `[${VARIANTES[c]}]` : c)).join(entre)
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
 * leídos también sin los signos de `DENTRO` y con la O igual al cero, como hace
 * la expresión. Una medida —una palabra con números— se busca además sin
 * espacios: en el taller se anota «2X1/4» lo que el catálogo tiene como
 * «2 X 1/4». Una palabra sin números no salta espacios: «sac» no está en
 * «PLANCHAS ACERO».
 */
export function coincide(palabras: string[], campos: (string | null | undefined)[]): boolean {
  if (palabras.length === 0) return true
  const cero = (t: string) => t.replace(/o/g, '0')
  const textos = campos.map((c) => cero(plano(c ?? ''))).flatMap((t) => [t, t.replace(/[._/-]+/g, '')])
  const pegados = textos.map((t) => t.replace(/[^a-z0-9]+/g, ''))
  return palabras.every((p) => textos.some((t) => t.includes(cero(p))) || (/\d/.test(p) && pegados.some((t) => t.includes(cero(p)))))
}
