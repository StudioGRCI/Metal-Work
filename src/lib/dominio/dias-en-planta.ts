/**
 * Cuánto lleva un vehículo en la planta, o cuánto estuvo (plan 3, entrega 3.2).
 *
 * Del que sigue adentro, los días los cuenta la base con la fecha de Lima
 * (`dias_en_espera_de`, migración 20261125140000): 0 es que entró hoy. Del que
 * ya salió, son los días entre la fecha de Lima de su ingreso y la de su salida,
 * que no dependen de la hora en que se mira. Sin alias de importación, para que
 * la prueba lo corra con `node --test`.
 */

/** Los días entre dos fechas de Lima (YYYY-MM-DD): 0 si son el mismo día. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)
}

/** «Entró hoy», «1 día en planta», «5 días en planta». */
export function textoEnPlanta(dias: number): string {
  if (dias <= 0) return 'Entró hoy'
  return dias === 1 ? '1 día en planta' : `${dias} días en planta`
}

/** «Salió el mismo día», «Estuvo 1 día», «Estuvo 12 días». */
export function textoEstuvo(dias: number): string {
  if (dias <= 0) return 'Salió el mismo día'
  return dias === 1 ? 'Estuvo 1 día' : `Estuvo ${dias} días`
}
