/**
 * Cómo se llama una unidad cuando todavía no tiene placa.
 *
 * La empresa fabrica carrocerías sobre chasis que muchas veces no están
 * matriculados: la placa llega meses después, con la tarjeta de propiedad, que
 * es un trámite del final del trabajo. Hasta entonces la unidad existe igual —se
 * cotiza, se le abre orden, se le compra material— y hay que poder nombrarla.
 *
 * El orden no es caprichoso, es el de lo que identifica de verdad:
 *
 *   1. La placa, cuando la tiene: es como la llama todo el mundo.
 *   2. El código interno de fabricación (VSC_SR_O4_6_26/30), que es como la
 *      llama el taller mientras se construye.
 *   3. El número de chasis, que es lo único que trae un camión recién comprado.
 *   4. La marca y el modelo, que al menos dicen qué camión es.
 *
 * Una sola función para las veinticinco pantallas que la muestran: si cada una
 * resolviera lo suyo, la misma unidad se llamaría distinto en el tablero y en la
 * orden, y nadie sabría que son la misma.
 */
export type UnidadNombrable = {
  placa?: string | null
  codigo_interno?: string | null
  numero_chasis?: string | null
  marca?: string | null
  modelo?: string | null
}

function limpio(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

/** El nombre de la unidad para una lista o un renglón. */
export function nombreDeUnidad(unidad: UnidadNombrable | null | undefined): string {
  if (!unidad) return 'Sin unidad asignada'

  const placa = limpio(unidad.placa)
  if (placa) return placa

  const codigo = limpio(unidad.codigo_interno)
  if (codigo) return codigo

  const chasis = limpio(unidad.numero_chasis)
  if (chasis) return `Chasis ${chasis}`

  const marca = [limpio(unidad.marca), limpio(unidad.modelo)].filter(Boolean).join(' ')
  if (marca) return `${marca}, sin placa`

  return 'Unidad sin placa'
}

/**
 * `true` cuando lo que se está mostrando NO es la placa. Sirve para que la
 * pantalla lo diga en vez de dejar creer que ese texto es una matrícula: quien
 * lee «Chasis 9BM…» tiene que saber que esa unidad todavía no está matriculada.
 */
export function todaviaSinPlaca(unidad: UnidadNombrable | null | undefined): boolean {
  return Boolean(unidad) && !limpio(unidad?.placa)
}
