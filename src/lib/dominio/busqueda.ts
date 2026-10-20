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
 * Las palabras que se buscan, en minúsculas y sin tildes. Pocas y cortas —cinco
 * y cuarenta letras entre todas—: cada letra viaja en la dirección de la
 * consulta, una vez por columna, y una dirección demasiado larga la rechaza el
 * servidor.
 */
export function palabrasDeBusqueda(texto: string | null | undefined): string[] {
  const palabras: string[] = []
  let letras = 0
  for (const p of plano(texto ?? '').split(/[^a-z0-9]+/)) {
    if (!p || palabras.length === 5 || letras >= 40) continue
    palabras.push(p.slice(0, 40 - letras))
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

// Solo las tildes del castellano (y la diéresis de la u). Las dos cajas van
// escritas: el `~*` de Postgres no siempre iguala «Á» con «á», según la
// configuración regional de la base.
const VARIANTES: Record<string, string> = {
  a: 'aáAÁ',
  e: 'eéEÉ',
  i: 'iíIÍ',
  o: 'oóOÓ',
  u: 'uúüUÚÜ',
  n: 'nñNÑ',
}

/**
 * Una palabra como expresión regular que encuentra sus versiones con tilde.
 * Solo sale de letras, números y corchetes —`palabrasDeBusqueda` ya dejó nada
 * más—, así que no lleva nada que PostgREST o la expresión lean como mando.
 */
export function expresionSinTildes(palabra: string): string {
  return [...palabra].map((c) => (VARIANTES[c] ? `[${VARIANTES[c]}]` : c)).join('')
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
 * Lo mismo para una lista ya leída: cada palabra está en alguno de los campos.
 * Aquí también se lee el texto sin signos, para que «sac» encuentre «S.A.C.» y
 * «sr04», «SR_04».
 */
export function coincide(palabras: string[], campos: (string | null | undefined)[]): boolean {
  if (palabras.length === 0) return true
  const texto = campos.map((c) => plano(c ?? '')).join(' ')
  const pegado = texto.replace(/[^a-z0-9]+/g, '')
  return palabras.every((p) => texto.includes(p) || pegado.includes(p))
}
